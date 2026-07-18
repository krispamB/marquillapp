import type {
  ConnectedAccount,
  PostDetailData,
  PostMediaItem,
  PostStatus,
} from "../lib/types";
import type { ArtifactDetailData } from "./artifactTypes";

export type InitialPostComposerData = {
  id: string;
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

function pinnedArtifactFromPost(post: PostDetailData): ArtifactDetailData {
  const reference = post.artifacts?.[0];
  const artifact = reference?.artifact;
  const version = reference?.version;
  const type = artifact?.type;
  if (!artifact?._id || (type !== "POST" && type !== "POLL" && type !== "DOCUMENT") || !version?.version || !version.content) {
    throw new Error("This post does not include a usable pinned artifact version.");
  }
  const status = version.status === "FAILED" || version.status === "GENERATING" ? version.status : "READY";
  return {
    id: artifact._id,
    type,
    title: artifact.title?.trim() || artifact.source?.prompt?.trim() || undefined,
    currentVersion: version.version,
    version: version.version,
    status,
    updatedAt: version.editedAt ?? version.createdAt ?? post.updatedAt,
    content: version.content,
  };
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

export function createInitialPostComposerData(post: PostDetailData): InitialPostComposerData {
  if (!post._id) throw new Error("The saved post does not include an ID.");
  return {
    id: post._id,
    status: normalizePostStatus(post.status),
    artifact: pinnedArtifactFromPost(post),
    account: accountFromPost(post),
    media: post.media ?? [],
    scheduledAt: post.scheduledAt,
  };
}
