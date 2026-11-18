import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';
import { isLinkedinAccessUsable } from '../common/HelperFn/linkedin-access.helper';
import { readIntEnv } from '../common/env';
import {
  AccountProvider,
  ConnectedAccount,
  LinkedinAccountType,
} from '../database/schemas/connected-account.schema';
import { Artifact } from '../database/schemas/artifact.schema';
import { Post, PostStatus } from '../database/schemas/post.schema';
import type { User } from '../database/schemas/user.schema';
import { EncryptionService } from '../encryption/encryption.service';
import { linkedinPostUrl } from '../post/linkedin-post-url';
import { resolveLinkedinAuthorUrn } from '../post/linkedin-author-urn';
import { resolveAccess } from './analytics-access';
import { AnalyticsCacheService } from './analytics-cache.service';
import {
  addDays,
  computeRange,
  utcMidnightMs,
  utcToday,
} from './analytics-range';
import type {
  AnalyticsAccess,
  AnalyticsAccountSummary,
  AnalyticsAudience,
  AnalyticsComputation,
  AnalyticsOverview,
  AnalyticsPosts,
  AnalyticsRange,
  AnalyticsRangeKey,
} from './interfaces';
import {
  LinkedinAnalyticsClient,
  type LinkedinAnalyticsApi,
} from './linkedin-analytics.client';
import { excerpt } from './little-text';
import {
  buildOrganizationAudience,
  buildOrganizationOverview,
  buildOrganizationPosts,
} from './organization-analytics';
import { bodyForAccess, emptyOverviewBody } from './overview-parts';
import {
  buildPersonOverview,
  buildPersonPosts,
  MAX_PERSON_POSTS,
  type PersonPostCandidate,
} from './person-analytics';

export const DEFAULT_ANALYTICS_RANGE: AnalyticsRangeKey = '28d';
/** A partial `ok` payload with a transient failure in it. */
export const PARTIAL_RESULT_TTL_SECONDS = 5 * 60;
/** `missing_scope` / `not_admin`: long enough not to burn quota re-asking. */
export const ACCESS_DENIED_TTL_SECONDS = 10 * 60;
/** `unavailable` with no stale copy: a short pause before asking again. */
export const UNAVAILABLE_TTL_SECONDS = 60;
/** The last good payload, served when LinkedIn fails. */
export const LAST_GOOD_TTL_SECONDS = 7 * 24 * 60 * 60;

const CACHE_PREFIX = 'analytics:v1';

type Endpoint = 'overview' | 'posts' | 'audience';

interface CachedPayload {
  access: AnalyticsAccess;
  fetchedAt: string;
  cached: boolean;
}

interface ServeSpec<T extends CachedPayload> {
  key: string;
  lastGoodKey: string;
  ttlSeconds: number;
  refresh: boolean;
  compute: () => Promise<AnalyticsComputation<T>>;
}

/** What one request needs to ask LinkedIn about one account. */
interface AccountContext {
  account: ConnectedAccount;
  accountId: string;
  accountType: LinkedinAccountType;
  /** Set when there is no usable token, so LinkedIn is not asked at all. */
  blocked: AnalyticsAccess | null;
  /**
   * The encrypted token to call LinkedIn with: the analytics app's for a
   * member, the main app's for a page.
   */
  encryptedToken: string | null;
  /** Changes whenever that token does, e.g. on reconnect. */
  tokenFingerprint: string;
}

/** What the client must do when the token used for this account is bad. */
function tokenRenewalAccess(ctx: AccountContext): AnalyticsAccess {
  return ctx.accountType === LinkedinAccountType.ORGANIZATION
    ? 'reconnect_required'
    : 'missing_scope';
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly ttl: Record<Endpoint, number>;
  /** Identical requests in flight share one set of LinkedIn calls. */
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    @InjectModel(ConnectedAccount.name)
    private readonly connectedAccountModel: Model<ConnectedAccount>,
    @InjectModel(Post.name)
    private readonly postModel: Model<Post>,
    @InjectModel(Artifact.name)
    private readonly artifactModel: Model<Artifact>,
    private readonly encryptionService: EncryptionService,
    private readonly linkedinClient: LinkedinAnalyticsClient,
    private readonly cache: AnalyticsCacheService,
    configService: ConfigService,
  ) {
    this.ttl = {
      overview: readIntEnv(
        configService,
        'ANALYTICS_OVERVIEW_CACHE_TTL_SECONDS',
        { default: 3600 },
      ),
      posts: readIntEnv(configService, 'ANALYTICS_POSTS_CACHE_TTL_SECONDS', {
        default: 21600,
      }),
      audience: readIntEnv(
        configService,
        'ANALYTICS_AUDIENCE_CACHE_TTL_SECONDS',
        { default: 86400 },
      ),
    };
  }

  async getOverview(
    user: User,
    connectedAccountId: string,
    rangeKey: AnalyticsRangeKey = DEFAULT_ANALYTICS_RANGE,
    refresh = false,
  ): Promise<AnalyticsOverview> {
    const ctx = await this.loadAccount(user, connectedAccountId);
    const range = computeRange(rangeKey);
    const account = this.summarize(ctx);
    const respond = (
      access: AnalyticsAccess,
      body = emptyOverviewBody(),
    ): AnalyticsOverview => ({
      account,
      access,
      range,
      fetchedAt: new Date().toISOString(),
      cached: false,
      ...bodyForAccess(access, body),
    });

    if (ctx.blocked) return respond(ctx.blocked);

    const payload = await this.serve<AnalyticsOverview>({
      ...this.keys(ctx, 'overview', range.key, range.end),
      refresh,
      compute: () =>
        this.withApi(ctx, respond(tokenRenewalAccess(ctx)), async (api) => {
          const built =
            ctx.accountType === LinkedinAccountType.ORGANIZATION
              ? await buildOrganizationOverview(
                  api,
                  resolveLinkedinAuthorUrn(ctx.account),
                  range,
                  utcToday(),
                )
              : await buildPersonOverview(api, range);
          const decision = resolveAccess(built.sections, ctx.accountType);
          return {
            payload: respond(decision.access, built.body),
            transientFailure: decision.transientFailure,
          };
        }),
    });
    // The account's name and photo are always the live ones.
    return { ...payload, account };
  }

  async getPosts(
    user: User,
    connectedAccountId: string,
    rangeKey: AnalyticsRangeKey = DEFAULT_ANALYTICS_RANGE,
    refresh = false,
  ): Promise<AnalyticsPosts> {
    const ctx = await this.loadAccount(user, connectedAccountId);
    const range = computeRange(rangeKey);
    const isOrganization = ctx.accountType === LinkedinAccountType.ORGANIZATION;
    const respond = (
      access: AnalyticsAccess,
      posts: AnalyticsPosts['posts'] = [],
      truncated = false,
    ): AnalyticsPosts => ({
      access,
      range,
      fetchedAt: new Date().toISOString(),
      cached: false,
      coverage: isOrganization ? 'all_posts' : 'marquill_posts',
      truncated: access === 'ok' ? truncated : false,
      posts: access === 'ok' ? posts : [],
    });

    if (ctx.blocked) return respond(ctx.blocked);

    return this.serve<AnalyticsPosts>({
      ...this.keys(ctx, 'posts', range.key, range.end),
      refresh,
      compute: () =>
        this.withApi(ctx, respond(tokenRenewalAccess(ctx)), async (api) => {
          if (isOrganization) {
            const built = await buildOrganizationPosts(
              api,
              resolveLinkedinAuthorUrn(ctx.account),
              range,
              (urns) => this.findPostIdsByChannelPostId(ctx.accountId, urns),
            );
            const decision = resolveAccess(built.sections, ctx.accountType);
            return {
              payload: respond(decision.access, built.rows, built.truncated),
              transientFailure: decision.transientFailure,
            };
          }

          const { candidates, truncated } = await this.findPersonPostCandidates(
            ctx.accountId,
            range,
          );
          const built = await buildPersonPosts(api, candidates);
          const decision = resolveAccess(built.sections, ctx.accountType);
          return {
            payload: respond(decision.access, built.rows, truncated),
            transientFailure: decision.transientFailure,
          };
        }),
    });
  }

  async getAudience(
    user: User,
    connectedAccountId: string,
    refresh = false,
  ): Promise<AnalyticsAudience> {
    const ctx = await this.loadAccount(user, connectedAccountId);
    const respond = (
      access: AnalyticsAccess,
      supported = true,
      totalFollowers: number | null = null,
      facets: AnalyticsAudience['facets'] = [],
    ): AnalyticsAudience => ({
      access,
      supported,
      fetchedAt: new Date().toISOString(),
      cached: false,
      totalFollowers: access === 'ok' ? totalFollowers : null,
      facets: access === 'ok' ? facets : [],
    });

    // LinkedIn has no member demographics: no call, nothing to cache.
    if (ctx.accountType !== LinkedinAccountType.ORGANIZATION) {
      return respond('ok', false);
    }
    if (ctx.blocked) return respond(ctx.blocked);

    return this.serve<AnalyticsAudience>({
      ...this.keys(ctx, 'audience', 'lifetime', computeRange('7d').end),
      refresh,
      compute: () =>
        this.withApi(ctx, respond(tokenRenewalAccess(ctx)), async (api) => {
          const built = await buildOrganizationAudience(
            api,
            resolveLinkedinAuthorUrn(ctx.account),
          );
          const decision = resolveAccess(built.sections, ctx.accountType);
          return {
            payload: respond(
              decision.access,
              true,
              built.totalFollowers,
              built.facets,
            ),
            transientFailure: decision.transientFailure,
          };
        }),
    });
  }

  /** The caller's LinkedIn account, or a 404. */
  private async loadAccount(
    user: User,
    connectedAccountId: string,
  ): Promise<AccountContext> {
    const account = await this.connectedAccountModel
      .findOne({
        _id: new Types.ObjectId(connectedAccountId),
        user: user._id,
        provider: AccountProvider.LINKEDIN,
      })
      .select('+analyticsAccessToken');
    if (!account) {
      throw new NotFoundException('Connected account not found');
    }
    const accountType = account.accountType ?? LinkedinAccountType.PERSON;
    // LinkedIn grants member analytics only to the analytics app, so a member
    // needs that second token; a page is read with the main one.
    const isPerson = accountType === LinkedinAccountType.PERSON;
    let blocked: AnalyticsAccess | null = null;
    if (!isLinkedinAccessUsable(account)) {
      blocked = 'reconnect_required';
    } else if (
      isPerson &&
      !isLinkedinAccessUsable({
        isActive: true,
        accessToken: account.analyticsAccessToken,
        accessTokenExpiresAt: account.analyticsAccessTokenExpiresAt,
      })
    ) {
      blocked = 'missing_scope';
    }
    const encryptedToken =
      (isPerson ? account.analyticsAccessToken : account.accessToken) ?? null;
    return {
      account,
      accountId: account._id.toString(),
      accountType,
      blocked,
      encryptedToken,
      tokenFingerprint: createHash('sha256')
        .update(encryptedToken ?? '')
        .digest('hex')
        .slice(0, 12),
    };
  }

  private summarize(ctx: AccountContext): AnalyticsAccountSummary {
    return {
      id: ctx.accountId,
      accountType: ctx.accountType,
      displayName: ctx.account.displayName ?? '',
      avatarUrl: ctx.account.avatarUrl ?? null,
    };
  }

  private keys(
    ctx: AccountContext,
    endpoint: Endpoint,
    variant: string,
    endDate: string,
  ): Pick<ServeSpec<CachedPayload>, 'key' | 'lastGoodKey' | 'ttlSeconds'> {
    return {
      key: `${CACHE_PREFIX}:${ctx.accountId}:${ctx.tokenFingerprint}:${endpoint}:${variant}:${endDate}`,
      lastGoodKey: `${CACHE_PREFIX}:last-good:${ctx.accountId}:${endpoint}:${variant}`,
      ttlSeconds: this.ttl[endpoint],
    };
  }

  /** Decrypts the token; one that will not decrypt has to be granted again. */
  private async withApi<T>(
    ctx: AccountContext,
    reconnect: T,
    run: (api: LinkedinAnalyticsApi) => Promise<AnalyticsComputation<T>>,
  ): Promise<AnalyticsComputation<T>> {
    let token: string;
    try {
      token = await this.encryptionService.decrypt(ctx.encryptedToken!);
    } catch (error) {
      this.logger.warn(
        `Could not decrypt the token of connected account ${ctx.accountId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { payload: reconnect, transientFailure: false };
    }
    return run(this.linkedinClient.session(token));
  }

  /**
   * Cache, then in-flight sharing, then LinkedIn. `refresh` skips the cache
   * read but still shares an in-flight fetch and overwrites the cache.
   */
  private async serve<T extends CachedPayload>(spec: ServeSpec<T>): Promise<T> {
    if (!spec.refresh) {
      const cached = await this.cache.get<T>(spec.key);
      if (cached) return { ...cached, cached: true };
    }

    const running = this.inflight.get(spec.key) as Promise<T> | undefined;
    if (running) return running;

    const promise = this.fetchAndStore(spec).finally(() => {
      this.inflight.delete(spec.key);
    });
    this.inflight.set(spec.key, promise);
    return promise;
  }

  private async fetchAndStore<T extends CachedPayload>(
    spec: ServeSpec<T>,
  ): Promise<T> {
    const { payload, transientFailure } = await spec.compute();

    switch (payload.access) {
      case 'ok':
        await Promise.all([
          this.cache.set(
            spec.key,
            payload,
            transientFailure
              ? Math.min(spec.ttlSeconds, PARTIAL_RESULT_TTL_SECONDS)
              : spec.ttlSeconds,
          ),
          this.cache.set(spec.lastGoodKey, payload, LAST_GOOD_TTL_SECONDS),
        ]);
        return payload;
      case 'missing_scope':
      case 'not_admin':
        await this.cache.set(spec.key, payload, ACCESS_DENIED_TTL_SECONDS);
        return payload;
      case 'unavailable': {
        const stale = await this.cache.get<T>(spec.lastGoodKey);
        if (stale) return { ...stale, cached: true };
        await this.cache.set(spec.key, payload, UNAVAILABLE_TTL_SECONDS);
        return payload;
      }
      default:
        // reconnect_required is never cached: a reconnect must show at once.
        return payload;
    }
  }

  /**
   * Marquill posts published to this account in the range, newest first, at
   * most 10 (a member's posts cannot be listed through the API).
   */
  private async findPersonPostCandidates(
    accountId: string,
    range: AnalyticsRange,
  ): Promise<{ candidates: PersonPostCandidate[]; truncated: boolean }> {
    const posts = await this.postModel
      .find({
        connectedAccount: new Types.ObjectId(accountId),
        status: PostStatus.PUBLISHED,
        publishedAt: {
          $gte: new Date(utcMidnightMs(range.start)),
          $lt: new Date(utcMidnightMs(addDays(range.end, 1))),
        },
        channelPostId: { $regex: /^urn:li:(share|ugcPost):/ },
      })
      .sort({ publishedAt: -1 })
      .limit(MAX_PERSON_POSTS + 1)
      .select('_id title channelPostId publishedAt artifacts')
      .lean<
        Array<
          Pick<
            Post,
            'title' | 'channelPostId' | 'publishedAt' | 'artifacts'
          > & {
            _id: Types.ObjectId;
          }
        >
      >()
      .exec();

    const kept = posts.slice(0, MAX_PERSON_POSTS);
    const commentary = await this.findPinnedCommentary(kept);

    return {
      truncated: posts.length > MAX_PERSON_POSTS,
      candidates: kept.map((post) => {
        const source = post.artifacts?.[0];
        const text =
          (source &&
            commentary.get(
              `${source.artifact.toString()}:${source.version}`,
            )) ||
          post.title ||
          '';
        return {
          urn: post.channelPostId!,
          postId: post._id.toString(),
          text: excerpt(text),
          publishedAt: new Date(post.publishedAt!).toISOString(),
          url: linkedinPostUrl(post.channelPostId) ?? null,
        };
      }),
    };
  }

  /** `artifactId:version` → the pinned version's commentary. */
  private async findPinnedCommentary(
    posts: Array<Pick<Post, 'artifacts'>>,
  ): Promise<Map<string, string>> {
    const ids = posts
      .map((post) => post.artifacts?.[0]?.artifact)
      .filter((id): id is Types.ObjectId => !!id);
    const commentary = new Map<string, string>();
    if (ids.length === 0) return commentary;

    const artifacts = await this.artifactModel
      .find({ _id: { $in: ids } })
      .select({ 'versions.version': 1, 'versions.content.commentary': 1 })
      .lean<
        Array<{
          _id: Types.ObjectId;
          versions?: Array<{
            version: number;
            content?: { commentary?: unknown };
          }>;
        }>
      >()
      .exec();
    for (const artifact of artifacts) {
      for (const version of artifact.versions ?? []) {
        const text = version.content?.commentary;
        if (typeof text === 'string' && text.trim()) {
          commentary.set(`${artifact._id.toString()}:${version.version}`, text);
        }
      }
    }
    return commentary;
  }

  /** LinkedIn post URN → Marquill Post id, for posts published through Marquill. */
  private async findPostIdsByChannelPostId(
    accountId: string,
    urns: string[],
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    if (urns.length === 0) return ids;
    const posts = await this.postModel
      .find({
        connectedAccount: new Types.ObjectId(accountId),
        channelPostId: { $in: urns },
      })
      .select('_id channelPostId')
      .lean<Array<{ _id: Types.ObjectId; channelPostId?: string }>>()
      .exec();
    for (const post of posts) {
      if (post.channelPostId) ids.set(post.channelPostId, post._id.toString());
    }
    return ids;
  }
}
