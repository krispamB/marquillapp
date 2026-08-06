"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { ConnectedAccount, UserProfile } from "../lib/types";

export default function LinkedInPreview({
  user,
  account,
  content,
  mediaName,
  mediaPreviewUrl,
  mediaType,
}: {
  user: UserProfile;
  account?: ConnectedAccount;
  content: string;
  mediaName: string | null;
  mediaPreviewUrl: string | null;
  mediaType: "image" | "video" | null;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const displayName = account?.displayName ?? user.name;
  const initials = displayName.slice(0, 2).toUpperCase() || "AO";
  const profileImageUrl = account?.avatarUrl ?? account?.profile?.picture;

  useEffect(() => {
    const element = contentRef.current;
    const frame = window.requestAnimationFrame(() => {
      setIsExpanded(false);
      if (!element || !content.trim()) {
        setCanExpand(false);
        return;
      }
      setCanExpand(element.scrollHeight > element.clientHeight + 1);
    });
    const measure = () => {
      if (element && content.trim() && !element.classList.contains("is-expanded")) {
        setCanExpand(element.scrollHeight > element.clientHeight + 1);
      }
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (element) observer?.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [content]);

  return (
    <div className="mq-linkedin-card">
      <div className="mq-linkedin-header">
        {profileImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profileImageUrl} alt="" className="mq-post-avatar mq-linkedin-avatar" />
        ) : <span className="mq-post-avatar">{initials}</span>}
        <span>
          <strong>{displayName}</strong>
          <small>{account?.headline ?? "Creator on LinkedIn"}</small>
          <small>Now · ◉</small>
        </span>
        <MoreHorizontal className="mq-more-dots" size={17} aria-label="More options" />
      </div>
      <div
        ref={contentRef}
        className={`mq-linkedin-content ${isExpanded ? "is-expanded" : "is-collapsed"} ${content ? "" : "is-placeholder"}`}
      >
        {content || <span className="mq-preview-placeholder">Your post preview will appear here.</span>}
      </div>
      {canExpand ? (
        <button
          type="button"
          className="mq-linkedin-see-more"
          onClick={() => setIsExpanded((expanded) => !expanded)}
          aria-expanded={isExpanded}
        >
          {isExpanded ? "Show less" : "…see more"}
        </button>
      ) : null}
      {mediaPreviewUrl ? (
        <div className="mq-preview-media">
          {mediaType === "video" ? (
            <video src={mediaPreviewUrl} controls aria-label={mediaName ?? "Attached video"} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaPreviewUrl} alt={mediaName ?? "Attached image"} />
          )}
        </div>
      ) : null}
      <div className="mq-linkedin-stats"><span>👍 Liked by 240 others</span><span>38 comments</span></div>
      <div className="mq-linkedin-actions"><span>Like</span><span>Comment</span><span>Repost</span><span>Send</span></div>
      <p className="mq-preview-cutoff-note">Mobile fold: 3 lines · approximately 140 characters</p>
    </div>
  );
}
