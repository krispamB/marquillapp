"use client";
/* eslint-disable @next/next/no-img-element -- account and media previews use dynamic external URLs. */

import { MoreHorizontal } from "lucide-react";
import type { ConnectedAccount, PostMediaItem, UserProfile } from "../lib/types";
import type { ArtifactDetailData } from "./artifactTypes";
import { ArtifactContentView } from "./ArtifactCompositionContent";

export default function PostCompositionPreview({
  user,
  account,
  artifact,
  media,
  previewUrls,
}: {
  user: UserProfile;
  account?: ConnectedAccount;
  artifact: ArtifactDetailData;
  media: PostMediaItem[];
  previewUrls: Record<string, string>;
}) {
  const displayName = account?.displayName ?? user.name;
  const initials = displayName.slice(0, 2).toUpperCase() || "IN";
  const profileImageUrl = account?.avatarUrl ?? account?.profile?.picture;
  const readyMedia = media.filter((item) => item.status === "READY" && previewUrls[item.id]);

  return (
    <div className="mq-linkedin-card mq-composition-preview-card">
      <div className="mq-linkedin-header">
        {profileImageUrl ? <img src={profileImageUrl} alt="" className="mq-post-avatar mq-linkedin-avatar" /> : <span className="mq-post-avatar">{initials}</span>}
        <span><strong>{displayName}</strong><small>{account?.headline ?? "Creator on LinkedIn"}</small><small>Now · ◉</small></span>
        <MoreHorizontal className="mq-more-dots" size={17} aria-label="More options" />
      </div>

      <ArtifactContentView artifact={artifact} />

      {artifact.type === "POST" && readyMedia.length ? (
        <div className={`mq-composition-media-grid count-${Math.min(readyMedia.length, 4)}`}>
          {readyMedia.slice(0, 4).map((item, index) => item.type === "VIDEO" ? (
            <video key={item.id} src={previewUrls[item.id]} controls aria-label={item.title ?? "Attached video"} />
          ) : (
            <span key={item.id} className="mq-composition-media-image">
              <img src={previewUrls[item.id]} alt={item.altText ?? item.title ?? "Attached image"} />
              {index === 3 && readyMedia.length > 4 ? <b>+{readyMedia.length - 4}</b> : null}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mq-linkedin-actions"><span>Like</span><span>Comment</span><span>Repost</span><span>Send</span></div>
    </div>
  );
}
