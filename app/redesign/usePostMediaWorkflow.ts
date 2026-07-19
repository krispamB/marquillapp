"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CreatePostMediaUploadsResponse,
  LinkedinImageDetailsResponse,
  PostDetailResponse,
  PostMediaItem,
} from "../lib/types";
import type { ArtifactType } from "./artifactTypes";
import { API_BASE, jsonRequest, readApi, sleep } from "./api";
import {
  deleteCachedMediaPreview,
  readCachedMediaPreview,
  writeCachedMediaPreview,
} from "./mediaPreviewCache";

const MAX_FILE_BYTES = 200 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "video/mp4"]);

function validateFiles(files: File[], media: PostMediaItem[]) {
  if (!files.length) throw new Error("Choose at least one file.");
  const invalid = files.find((file) => !allowedTypes.has(file.type));
  if (invalid) throw new Error(`${invalid.name} must be a JPEG, PNG, or MP4 file.`);
  const oversized = files.find((file) => file.size > MAX_FILE_BYTES);
  if (oversized) throw new Error(`${oversized.name} is larger than the 200 MB limit.`);
  const containsVideo = files.some((file) => file.type === "video/mp4");
  const existingVideo = media.some((item) => item.type === "VIDEO");
  if (containsVideo && (files.length !== 1 || media.length > 0)) throw new Error("A video must be the only media attached to a post.");
  if (!containsVideo && existingVideo) throw new Error("Remove the video before adding images.");
  if (!containsVideo && media.length + files.length > 20) throw new Error("A post can contain at most 20 images.");
}

export function mediaStatusLabel(item: PostMediaItem) {
  if (item.status === "FAILED") return "Upload failed";
  if (item.status === "READY") return item.type === "VIDEO" ? "Video ready" : "Image ready";
  return item.status === "PENDING" ? "Waiting to upload" : "Processing for LinkedIn";
}

export default function usePostMediaWorkflow({
  postId,
  artifactType,
  initialMedia = [],
  onStatus,
  request = readApi,
}: {
  postId?: string;
  artifactType?: ArtifactType;
  initialMedia?: PostMediaItem[];
  onStatus: (message: string) => void;
  request?: typeof readApi;
}) {
  const [media, setMedia] = useState<PostMediaItem[]>(initialMedia);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewRetryKey, setPreviewRetryKey] = useState(0);
  const previewRequestedRef = useRef(new Set<string>());
  const hasPendingMedia = useMemo(() => media.some((item) => item.status === "PENDING" || item.status === "UPLOADING"), [media]);

  async function refreshMedia() {
    if (!postId) return [];
    const response = await request<PostDetailResponse>(`${API_BASE}/posts/${postId}`);
    const next = response.data?.media ?? [];
    setMedia(next);
    return next;
  }

  useEffect(() => {
    if (!postId || !hasPendingMedia) return;
    let cancelled = false;
    let delay = 1500;
    void (async () => {
      while (!cancelled) {
        await sleep(delay);
        if (cancelled) return;
        try {
          const response = await request<PostDetailResponse>(`${API_BASE}/posts/${postId}`);
          const next = response.data?.media ?? [];
          if (cancelled) return;
          setMedia(next);
          if (!next.some((item) => item.status === "PENDING" || item.status === "UPLOADING")) return;
          setError(null);
        } catch (reason) {
          if (cancelled) return;
          setError(`${reason instanceof Error ? reason.message : "Unable to refresh media."} Retrying automatically…`);
        }
        delay = Math.min(Math.round(delay * 1.5), 10_000);
      }
    })();
    return () => { cancelled = true; };
  }, [hasPendingMedia, postId, request]);

  useEffect(() => {
    if (!postId) return;
    const candidates = media.filter((item) => item.status === "READY" && !previewUrls[item.id] && !previewRequestedRef.current.has(item.id));
    if (!candidates.length) return;
    let cancelled = false;
    let retryTimer: number | undefined;
    candidates.forEach((item) => previewRequestedRef.current.add(item.id));
    void Promise.all(candidates.map(async (item) => {
      try {
        const cachedUrl = readCachedMediaPreview(item.id);
        if (cachedUrl) return { id: item.id, url: cachedUrl };

        const response = await request<LinkedinImageDetailsResponse>(`${API_BASE}/posts/${postId}/media/${item.id}/preview`);
        if (!response.data?.downloadUrl) throw new Error("The media preview URL was unavailable.");
        writeCachedMediaPreview(item.id, response.data.downloadUrl, response.data.downloadUrlExpiresAt);
        return { id: item.id, url: response.data.downloadUrl };
      } catch (reason) {
        previewRequestedRef.current.delete(item.id);
        return { id: item.id, error: reason instanceof Error ? reason.message : "Unable to load a media preview." };
      }
    })).then((results) => {
      if (cancelled) return;
      const successful = results.filter((result): result is { id: string; url: string } => "url" in result);
      const failed = results.filter((result) => "error" in result);
      if (successful.length) setPreviewUrls((current) => ({ ...current, ...Object.fromEntries(successful.map((result) => [result.id, result.url])) }));
      if (failed.length) {
        setError(`${failed[0].error} Retrying preview…`);
        retryTimer = window.setTimeout(() => setPreviewRetryKey((value) => value + 1), 3000);
      } else {
        setError(null);
      }
    });
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [media, postId, previewRetryKey, previewUrls, request]);

  async function uploadFiles(files: File[]) {
    setIsMutating(true);
    setError(null);
    try {
      if (!postId || artifactType !== "POST") throw new Error("Attach a POST artifact before adding media.");
      validateFiles(files, media);
      const declared = await request<CreatePostMediaUploadsResponse>(
        `${API_BASE}/posts/${postId}/media/uploads`,
        jsonRequest({ files: files.map((file) => ({ fileName: file.name, mimeType: file.type, sizeBytes: file.size })) }, { method: "POST" }),
      );
      const slots = declared.data?.uploads ?? [];
      if (slots.length !== files.length) throw new Error("The upload service did not return a slot for every file.");
      setMedia((current) => [...current, ...slots.map((slot, index): PostMediaItem => ({ id: slot.mediaId, type: files[index].type === "video/mp4" ? "VIDEO" : "IMAGE", status: "PENDING", title: files[index].name, mimeType: files[index].type, sizeBytes: files[index].size }))]);
      await Promise.all(slots.map(async (slot, index) => {
        const response = await fetch(slot.uploadUrl, { method: "PUT", headers: slot.requiredHeaders, body: files[index] });
        if (!response.ok) throw new Error(`Upload failed for ${files[index].name}.`);
      }));
      await request(
        `${API_BASE}/posts/${postId}/media/uploads/complete`,
        jsonRequest({ mediaIds: slots.map((slot) => slot.mediaId) }, { method: "POST" }),
      );
      onStatus("Media is processing for LinkedIn…");
      await refreshMedia();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to upload media.");
      return false;
    } finally {
      setIsMutating(false);
    }
  }

  async function removeMedia(item: PostMediaItem) {
    if (!postId) return;
    setIsMutating(true);
    setError(null);
    try {
      const response = await request<{ data?: PostMediaItem[] }>(`${API_BASE}/posts/${postId}/media/${item.id}`, { method: "DELETE" });
      setMedia((current) => Array.isArray(response.data) ? response.data : current.filter((candidate) => candidate.id !== item.id));
      previewRequestedRef.current.delete(item.id);
      setPreviewUrls((current) => { const next = { ...current }; delete next[item.id]; return next; });
      deleteCachedMediaPreview(item.id);
      onStatus("Media removed");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to remove media.");
    } finally {
      setIsMutating(false);
    }
  }

  return {
    error,
    hasPendingMedia,
    isMutating,
    media,
    previewUrls,
    refreshMedia: async () => {
      try {
        setError(null);
        await refreshMedia();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to refresh media.");
      }
    },
    removeMedia,
    replaceMedia: setMedia,
    uploadFiles,
  };
}
