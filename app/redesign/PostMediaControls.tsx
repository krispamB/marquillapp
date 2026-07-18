"use client";
/* eslint-disable @next/next/no-img-element -- media previews use short-lived signed URLs. */

import { ChangeEvent, useRef } from "react";
import Image from "next/image";
import { ImagePlus, RefreshCw, Trash2, Upload } from "lucide-react";
import type { PostMediaItem } from "../lib/types";
import { mediaStatusLabel } from "./usePostMediaWorkflow";

export default function PostMediaControls({
  error,
  isBusy,
  media,
  previewUrls,
  onChooseStock,
  onRefresh,
  onRemove,
  onUpload,
}: {
  error: string | null;
  isBusy: boolean;
  media: PostMediaItem[];
  previewUrls: Record<string, string>;
  onChooseStock: (provider: "pexels" | "unsplash") => void;
  onRefresh: () => void;
  onRemove: (item: PostMediaItem) => void;
  onUpload: (files: File[]) => Promise<boolean>;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasVideo = media.some((item) => item.type === "VIDEO");
  const hasPending = media.some((item) => item.status === "PENDING" || item.status === "UPLOADING");

  async function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    await onUpload(Array.from(event.target.files ?? []));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="mq-post-media-section">
      {error ? <div className="mq-media-inline-error"><span>{error}</span><button type="button" onClick={onRefresh} disabled={isBusy}><RefreshCw size={13} /> Refresh</button></div> : null}
      {media.length ? <div className="mq-post-media-list">{media.map((item) => <div key={item.id} className={`mq-post-media-item is-${item.status.toLowerCase()}`}>{previewUrls[item.id] && item.type === "IMAGE" ? <img src={previewUrls[item.id]} alt="" /> : <span><ImagePlus size={17} /></span>}<div><strong>{item.title ?? (item.type === "VIDEO" ? "Video" : "Image")}</strong><small>{mediaStatusLabel(item)}</small></div><button type="button" className="mq-icon-button" disabled={isBusy} onClick={() => onRemove(item)} aria-label={`Remove ${item.title ?? "media"}`}><Trash2 size={15} /></button></div>)}</div> : null}
      <div className="mq-post-media-actions">
        <button type="button" className="mq-chip-button mq-stock-button" disabled={isBusy || hasVideo || media.length >= 20} onClick={() => onChooseStock("pexels")}><Image src="/pexels.svg" alt="" width={15} height={15} /> Pexels</button>
        <button type="button" className="mq-chip-button mq-stock-button" disabled={isBusy || hasVideo || media.length >= 20} onClick={() => onChooseStock("unsplash")}><Image src="/unsplash.svg" alt="" width={15} height={15} /> Unsplash</button>
        <label className={`mq-chip-button ${isBusy ? "is-disabled" : ""}`}><Upload size={14} /> {isBusy ? "Working…" : "Upload"}<input ref={fileInputRef} type="file" accept="image/jpeg,image/png,video/mp4" multiple onChange={handleFileInput} hidden disabled={isBusy} /></label>
        {hasPending ? <button type="button" className="mq-chip-button" onClick={onRefresh} disabled={isBusy}><RefreshCw size={13} /> Refresh</button> : null}
        <small>Up to 20 images or one MP4 · 200 MB each</small>
      </div>
    </div>
  );
}
