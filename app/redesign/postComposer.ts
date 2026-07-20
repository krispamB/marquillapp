import type {
  ConnectedAccount,
  PostDetailData,
  PostMediaItem,
  PostStatus,
} from "../lib/types";
import type { ArtifactDetailData } from "./artifactTypes";

export type InitialPostComposerData = {
  id: string;
  title: string;
  status: PostStatus;
  artifact: ArtifactDetailData;
  account: ConnectedAccount;
  media: PostMediaItem[];
  scheduledAt?: string;
};

function normalizePostStatus(value?: string): PostStatus {
  const status = String(value ?? "DRAFT").toUpperCase();
  if (status === "FAILED" || status === "SCHEDULED" || status === "PUBLISHED") return status;
  return "DRAFT";
}

export function pinnedArtifactReferenceFromPost(post: PostDetailData) {
  const reference = post.artifacts?.[0];
  const artifact = reference?.artifact;
  const version = reference?.version;
  if (!artifact?._id || !version?.version) {
    throw new Error("This post does not include a pinned artifact version.");
  }
  return { artifactId: artifact._id, version: version.version };
}

function accountFromPost(post: PostDetailData): ConnectedAccount {
  const account = post.connectedAccount;
  if (!account?._id) throw new Error("This post does not include its connected account.");
  return {
    id: account._id,
    provider: account.provider ?? "LINKEDIN",
    accountType: account.accountType === "PERSON" ? "PERSONAL" : account.accountType,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    vanityName: account.vanityName,
    headline: account.headline,
    profile: account.profile,
    isActive: account.isActive,
  };
}

export function createInitialPostComposerData(post: PostDetailData, artifact: ArtifactDetailData): InitialPostComposerData {
  if (!post._id) throw new Error("The saved post does not include an ID.");
  return {
    id: post._id,
    title: post.title?.trim() ?? "",
    status: normalizePostStatus(post.status),
    artifact,
    account: accountFromPost(post),
    media: post.media ?? [],
    scheduledAt: post.scheduledAt,
  };
}
