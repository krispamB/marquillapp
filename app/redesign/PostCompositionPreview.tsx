"use client";
/* eslint-disable @next/next/no-img-element -- account and media previews use dynamic external URLs. */

import { FileText, MoreHorizontal } from "lucide-react";
import type { ConnectedAccount, PostMediaItem, UserProfile } from "../lib/types";
import type { ArtifactDetailData } from "./artifactTypes";

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
  const commentary = artifact.content.commentary?.trim() ?? "";
  const readyMedia = media.filter((item) => item.status === "READY" && previewUrls[item.id]);

  return (
    <div className="mq-linkedin-card mq-composition-preview-card">
      <div className="mq-linkedin-header">
        {profileImageUrl ? <img src={profileImageUrl} alt="" className="mq-post-avatar mq-linkedin-avatar" /> : <span className="mq-post-avatar">{initials}</span>}
        <span><strong>{displayName}</strong><small>{account?.headline ?? "Creator on LinkedIn"}</small><small>Now · ◉</small></span>
        <MoreHorizontal className="mq-more-dots" size={17} aria-label="More options" />
      </div>

      {commentary ? <div className="mq-linkedin-content is-expanded">{commentary}</div> : null}

      {artifact.type === "POLL" && artifact.content.poll ? (
        <div className="mq-preview-poll">
          <strong>{artifact.content.poll.question}</strong>
          {artifact.content.poll.options.map((option) => <span key={option}>{option}</span>)}
          <small>{artifact.content.poll.durationDays} day poll</small>
        </div>
      ) : null}

      {artifact.type === "DOCUMENT" && artifact.content.document ? (
        <div className="mq-preview-document">
          <FileText size={28} />
          <span><strong>{artifact.title?.trim() || "LinkedIn document"}</strong><small>{artifact.content.document.pageCount ?? artifact.content.document.slides.length} pages · PDF</small></span>
          {artifact.content.document.pdfUrl ? <a href={artifact.content.document.pdfUrl} target="_blank" rel="noreferrer">Preview PDF</a> : null}
        </div>
      ) : null}

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

      <div className="mq-linkedin-stats"><span>👍 Liked by 240 others</span><span>38 comments</span></div>
      <div className="mq-linkedin-actions"><span>Like</span><span>Comment</span><span>Repost</span><span>Send</span></div>
    </div>
  );
}
