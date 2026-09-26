"use client";
/* eslint-disable @next/next/no-img-element -- account and media previews use dynamic external URLs. */

import { MoreHorizontal } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ConnectedAccount, UserProfile } from "../lib/types";
import type { ArtifactDetailData } from "./artifactTypes";
import { ArtifactContentView } from "./ArtifactCompositionContent";
import type { ComposerPostMediaItem } from "./postMedia";

type DragState = {
  pointerId: number;
  startX: number;
  scrollLeft: number;
};

function PostImageCarousel({
  media,
  previewUrls,
}: {
  media: ComposerPostMediaItem[];
  previewUrls: Record<string, string>;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const imageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const dragRef = useRef<DragState | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const [currentImage, setCurrentImage] = useState(1);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  function closestImageIndex() {
    const rail = railRef.current;
    if (!rail) return currentImage - 1;

    const railRect = rail.getBoundingClientRect();
    const railCenter = railRect.left + railRect.width / 2;
    let closestIndex = currentImage - 1;
    let closestDistance = Number.POSITIVE_INFINITY;

    imageRefs.current.forEach((image, index) => {
      if (!image) return;
      const imageRect = image.getBoundingClientRect();
      const imageCenter = imageRect.left + imageRect.width / 2;
      const distance = Math.abs(imageCenter - railCenter);
      if (distance < closestDistance) {
        closestIndex = index;
        closestDistance = distance;
      }
    });

    return closestIndex;
  }

  function handleScroll() {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => {
      setCurrentImage(closestImageIndex() + 1);
      scrollFrameRef.current = null;
    });
  }

  function scrollToImage(index: number, behavior: ScrollBehavior = "smooth") {
    const rail = railRef.current;
    const image = imageRefs.current[index];
    if (!rail || !image) return;

    const railRect = rail.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    const railCenter = railRect.left + railRect.width / 2;
    const imageCenter = imageRect.left + imageRect.width / 2;
    rail.scrollTo({ left: rail.scrollLeft + imageCenter - railCenter, behavior });
    setCurrentImage(index + 1);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    const rail = railRef.current;
    if (!rail) return;

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: rail.scrollLeft,
    };
    rail.setPointerCapture(event.pointerId);
    setIsDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const rail = railRef.current;
    const drag = dragRef.current;
    if (!rail || !drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    rail.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
  }

  function finishDragging(event: ReactPointerEvent<HTMLDivElement>) {
    const rail = railRef.current;
    const drag = dragRef.current;
    if (!rail || !drag || drag.pointerId !== event.pointerId) return;

    dragRef.current = null;
    setIsDragging(false);
    if (rail.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId);
    scrollToImage(closestImageIndex());
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const nextIndex = Math.min(media.length - 1, Math.max(0, currentImage - 1 + direction));
    scrollToImage(nextIndex);
  }

  return (
    <div className="mq-composition-media-carousel">
      <div
        ref={railRef}
        className={`mq-composition-media-rail${isDragging ? " is-dragging" : ""}`}
        role="region"
        aria-label="Attached images"
        tabIndex={0}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDragging}
        onPointerCancel={finishDragging}
      >
        {media.map((item, index) => (
          <div
            key={item.id}
            ref={(node) => { imageRefs.current[index] = node; }}
            className="mq-composition-media-slide"
            role="group"
            aria-label={`Image ${index + 1} of ${media.length}`}
          >
            <img
              src={previewUrls[item.id]}
              alt={item.altText ?? item.title ?? `Attached image ${index + 1}`}
              draggable={false}
            />
          </div>
        ))}
      </div>
      <span className="mq-composition-media-count" aria-live="polite">
        {currentImage}/{media.length}
      </span>
    </div>
  );
}

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
  media: ComposerPostMediaItem[];
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

      {artifact.type === "POST" && readyMedia.length > 1 ? (
        <PostImageCarousel
          key={readyMedia.map((item) => item.id).join(":")}
          media={readyMedia}
          previewUrls={previewUrls}
        />
      ) : null}

      {artifact.type === "POST" && readyMedia.length === 1 ? (
        <div className="mq-composition-media-grid">
          {readyMedia[0].type === "VIDEO" ? (
            <video src={previewUrls[readyMedia[0].id]} controls aria-label={readyMedia[0].title ?? "Attached video"} />
          ) : (
            <img src={previewUrls[readyMedia[0].id]} alt={readyMedia[0].altText ?? readyMedia[0].title ?? "Attached image"} />
          )}
        </div>
      ) : null}

      <div className="mq-linkedin-actions"><span>Like</span><span>Comment</span><span>Repost</span><span>Send</span></div>
    </div>
  );
}
