# LinkedIn analytics

The client contract is [`api/analytics.md`](./api/analytics.md). This note covers where each figure comes from, what it costs in LinkedIn calls, how it is cached, and what is known to be imperfect. Code: `src/analytics/`.

## Shape of the code

- `LinkedinAnalyticsClient` is the only HTTP layer. `session(token)` returns `LinkedinAnalyticsApi`, one method per LinkedIn call, so everything above it is tested against a fake. Base `https://api.linkedin.com/rest`; every call sends `Authorization: Bearer`, `X-Restli-Protocol-Version: 2.0.0` and `LinkedIn-Version` from `LINKEDIN_ANALYTICS_API_VERSION` (default `202610`). Each call has a 10 s `AbortSignal.timeout`, is never retried on a 4xx, and is retried once on a 5xx, a timeout or a network error.
- Query strings are built by hand (`restli.ts`). URNs are percent-encoded; the `(`, `)`, `:` and `,` of Rest.li records and `List(...)` are not. `URLSearchParams` would encode those and LinkedIn would reject the call.
- `person-analytics.ts` and `organization-analytics.ts` fire one request's calls concurrently, settle them independently (`settleSections`), and turn the answers into contract fields with the pure helpers in `analytics-range.ts`, `linkedin-normalize.ts`, `analytics-metrics.ts`, `little-text.ts` and `audience-facets.ts`.
- `AnalyticsService` checks ownership (404), the token (see "Two LinkedIn apps"), decides `access`, and owns caching and in-flight sharing. Organization URNs come from `resolveLinkedinAuthorUrn` (`src/post/linkedin-author-urn.ts`, shared with publishing). An organization `ConnectedAccount` holds its own encrypted copy of the member's token, refreshed whenever the member reconnects, so page analytics decrypt `accessToken` on the account itself. Member analytics decrypt `analyticsAccessToken` instead.

## Dates

All dates are UTC whole days. A range ends yesterday; today is never included. The previous period is the same number of days immediately before. Wherever LinkedIn has daily data, one call covers a single double-length window (previous start to the midnight after the range end, end exclusive) and the answer is split in two, so a comparison costs no extra call.

Zero-fill rule: a day missing from a successful daily answer is `0`, because LinkedIn omits days with no activity. The exception is organization follower gains: LinkedIn publishes them two days late, so a missing day after today − 2 is `null`. A failed call is never `0`: its metric is `null`, its series values are `null`, and its key goes in `unavailable`.

## Where each figure comes from

## Two LinkedIn apps

LinkedIn grants `r_member_postAnalytics` and `r_member_profileAnalytics` only through the Community Management API product, and only offers that product to an app that holds no other product. So Marquill has two LinkedIn developer apps:

| | Main app | Analytics app |
| --- | --- | --- |
| Env | `LINKEDIN_CLIENT_ID`, `_SECRET`, `_REDIRECT_URI` | `LINKEDIN_ANALYTICS_CLIENT_ID`, `_SECRET`, `_REDIRECT_URI` |
| Used for | Connecting an account, publishing, page analytics | Member analytics |
| Token stored as | `accessToken` (member and page accounts) | `analyticsAccessToken` on the `PERSON` account, `select: false` |
| Flow | `POST /auth/linkedin` → `/auth/linkedin/callback` | `POST /auth/linkedin/analytics` → `/auth/linkedin/analytics/callback` |

Rules:

- **A token only works with the app that issued it.** The code exchange picks its credentials by issuer (`getLinkedinAccessToken(code, 'main' | 'analytics')`), and each flow keeps its `state` nonce under its own Redis prefix, so a state from one flow is rejected by the other.
- **The analytics grant is a second, optional consent** asked for on the Dashboard when one account is selected ("Turn on analytics", on the card shown when the account's `analyticsAccessTokenExpiresAt` is missing or past), never during the first connect. It needs a connected personal account. It never changes `accessToken`, `externalId` or `impersonatorUrn`, so publishing cannot be affected by it.
- **Member ids differ per app.** `urn:li:person:{id}` from the analytics app is not the id the main app stored, so the two grants are matched on `vanityName` (read with `r_basicprofile`). A different name is `409 LINKEDIN_ACCOUNT_MISMATCH`. When either name is missing the grant is accepted unchecked. Member analytics calls use `q=me` and global post URNs, so they never need the analytics app's member id.
- **Disconnecting** the personal account clears both tokens. Reconnecting through the main app keeps the analytics token.
- **Not configured** (any of the three env keys blank): the grant endpoint answers `503 LINKEDIN_ANALYTICS_NOT_CONFIGURED`, and member analytics report `missing_scope`.
- Neither app has refresh tokens here, so each token lasts 60 days; an expired analytics token is `missing_scope` again.

The Community Management product also covers publishing and page scopes (but not `r_organization_admin` or the OpenID Connect scopes). Once the analytics app reaches the Standard tier, everything could move to it and the main app could be retired. That is a migration, not a config change: every member has to reconnect, and `externalId` and `impersonatorUrn` must be rewritten because the member ids change. The Development tier (500 calls per app per day, twelve months) is too small to publish through.

### Member (`PERSON`, scopes `r_member_postAnalytics`, `r_member_profileAnalytics`)

| Contract field | LinkedIn call |
| --- | --- |
| `followers.total` | `memberFollowersCount?q=me` |
| `followers.gained`, series `followersGained` | `memberFollowersCount?q=dateRange`, double window |
| `impressions`, `reactions`, `comments`, `reposts` and their series | `memberCreatorPostAnalytics?q=me&aggregation=DAILY`, `queryType` `IMPRESSION`, `REACTION`, `COMMENT`, `RESHARE`, double window each |
| `membersReached` | `memberCreatorPostAnalytics?q=me&queryType=MEMBERS_REACHED&aggregation=TOTAL`, once for the range and once for the previous period (no DAILY for this metric) |
| `engagementRate` | `(reactions + comments + reposts) / impressions` from the totals above |
| posts: list | Marquill `Post`s for the account, `PUBLISHED` in the range with a `channelPostId`, newest 10 |
| posts: text | the pinned artifact version's `commentary`, else the post `title` |
| posts: figures | `memberCreatorPostAnalytics?q=entity&entity=(share:…)` or `(ugc:…)`, `aggregation=TOTAL`, `IMPRESSION`, `REACTION`, `COMMENT` |
| audience | none: LinkedIn has no member demographics (`supported: false`) |

`uniqueImpressions`, `clicks` and `pageViews` are `null` for members. `metricType` in member answers is ignored: it changed from an object to a string in 202605, and the code knows what it asked for.

### Page (`ORGANIZATION`, scopes `rw_organization_admin`, `r_organization_social`)

| Contract field | LinkedIn call |
| --- | --- |
| `followers.total`, audience `totalFollowers` | `networkSizes/{urn}?edgeType=COMPANY_FOLLOWED_BY_MEMBER` (`firstDegreeSize`) |
| `followers.gained`, series `followersGained` | `organizationalEntityFollowerStatistics` with DAY `timeIntervals`, double window; organic + paid gain |
| `impressions`, `uniqueImpressions`, `clicks`, `reactions` (`likeCount`), `comments`, `reposts` (`shareCount`) and series | `organizationalEntityShareStatistics` with DAY `timeIntervals`, double window |
| `pageViews` and series | `organizationPageStatistics` with DAY `timeIntervals`, double window (`allPageViews.pageViews`) |
| `engagementRate` | `(reactions + comments + reposts + clicks) / impressions` |
| posts: list and text | `posts?q=author&sortBy=CREATED&count=50` with `X-RestLi-Method: FINDER`; `PUBLISHED`, `MAIN_FEED`, published in range; little text turned into plain text |
| posts: figures | `organizationalEntityShareStatistics` without `timeIntervals`, `shares=List(…)` or `ugcPosts=List(…)`, 20 URNs per call; a post missing from the answer had no activity, so zeros |
| posts: `postId` | Marquill `Post` with the same `channelPostId` |
| audience facets | lifetime `organizationalEntityFollowerStatistics`: `followerCountsBySeniority` and `followerCountsByStaffCountRange`, `organicFollowerCount` only |

`membersReached` is `null` for pages. Daily `likeCount` can be negative (unlikes); the daily value is kept as given and period totals are clamped at 0.

## Calls per request

Counts are before retries (at most one extra per call, on a 5xx or a network failure). A cache hit costs none.

| Endpoint | `PERSON` | `ORGANIZATION` |
| --- | --- | --- |
| overview | 8 | 4 |
| posts | 3 per Marquill post in range, at most 30 | 1–2 listing pages + 1 per 20 share URNs + 1 per 20 ugcPost URNs; at most 6 |
| audience | 0 | 2 |

None uses BATCH_GET. The Community Management Development tier allows 100 calls per member and 500 per app per day; the cache below is what keeps the app inside that.

## Caching

Each computed payload is stored in Redis as JSON under `analytics:v1:{accountId}:{tokenFingerprint}:{endpoint}:{range}:{rangeEndDate}`. The range end date makes the key roll over at UTC midnight. The fingerprint is a hash of the stored encrypted token, so a reconnect or a new analytics grant starts fresh. For a member it is the analytics token's hash.

| Result | Stored for |
| --- | --- |
| `ok` | `ANALYTICS_OVERVIEW_CACHE_TTL_SECONDS` (1 h), `ANALYTICS_POSTS_CACHE_TTL_SECONDS` (6 h), `ANALYTICS_AUDIENCE_CACHE_TTL_SECONDS` (24 h) |
| `ok` with a section that failed with 429, 5xx or network | 5 minutes |
| `missing_scope`, `not_admin` | 10 minutes, so a missing permission doesn't burn quota |
| `unavailable` | 1 minute |
| `reconnect_required` | never |

Every `ok` payload is also written to a last-good key without a date or fingerprint, kept 7 days. When LinkedIn fails outright (`unavailable`) and a last-good copy exists, that copy is served with `cached: true` and its original `fetchedAt`.

A cached payload is served with `cached: true`; the overview's `account` block is always replaced with the live name and photo. `refresh=true` skips the cache read and overwrites the entry; it is throttled to 10 a minute per user in its own bucket (`AnalyticsThrottlerGuard`). Identical requests in flight in one process share one fetch (a map of promises keyed by the cache key). Redis reads and writes time out after 500 ms and fail open: a warning, and the request carries on as a miss.

## Access

Each LinkedIn call of a request is a section. `access` comes from all of them together:

1. any `401` → `reconnect_required` for a page, `missing_scope` for a member, whose analytics token is renewed by granting again (every call shares one token);
2. at least one success → `ok`, with failed sections listed in `unavailable`;
3. all failed and a `403` among them → `missing_scope` for a member, `not_admin` for a page;
4. all failed otherwise (429, 5xx, timeout, network, other 4xx) → `unavailable`, or the last-good copy.

An inactive account or a missing or expired main token is `reconnect_required` without a call. A member with no analytics token, or an expired one, is `missing_scope` without a call and without caching. A token that will not decrypt is `reconnect_required` for a page and `missing_scope` for a member.

## Known limitations

- **Member top posts are Marquill posts only.** LinkedIn does not let an app list a member's posts, so `coverage` is `marquill_posts` and posts made outside Marquill are missing.
- **Page figures are organic only.** Share statistics without a campaign filter exclude sponsored activity.
- **Follower lag.** Page follower gains for the last day of a range are usually `null`, and `followers.gained.value` sums only the published days, so it can trail the previous period, which is fully published.
- **Unique impressions are summed.** LinkedIn gives unique impressions per day; summing them counts someone who saw posts on two days twice. It is the only figure available. When no daily element carries the field, `uniqueImpressions` is `null` and listed in `unavailable`.
- **Per-post failures.** A post whose figure call failed keeps `null` for that figure in `posts`, rather than a guessed `0`.

Not yet verified against live data:

- Whether a daily `memberFollowersCount` element is the gain that day (assumed) or a running total. The docs are ambiguous; see the TODO in `linkedin-normalize.ts`.
- The maximum number of URNs in one `shares=List(…)` / `ugcPosts=List(…)`; 20 is a guess at a safe size. Whether one call can carry both lists is also unknown, so they are separate calls.
- Whether a 180-day `dateRange` (90d plus its previous period) is accepted by the member endpoints.
- Whether LinkedIn sends `Retry-After` on a 429. It is not read today; a 429 is simply not retried.

## Follow-ups

- Industry, job function and geography facets. Their URNs need lookups through endpoints that require BATCH_GET, which the Development tier forbids.
- Video analytics (views, watch time) for both account types.
- Shared in-flight de-duplication across API replicas (today it is per process).
