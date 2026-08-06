import { useCallback, useEffect, useRef, useState } from "react";
import {
  completeMediaUploads,
  initiateMediaUploads,
  pollBatchUntilSettled,
  putFileToR2,
} from "./media";
import type { MediaUploadDeclaration } from "./types";

// Client-side lifecycle of a single attached image, distinct from the server's
// media status. `processing` = R2 PUT done, waiting on the background LinkedIn
// upload to settle.
export type UploadTileStatus =
  | "queued"
  | "uploading"
  | "processing"
  | "ready"
  | "failed";

export type UploadTile = {
  status: UploadTileStatus;
  progress: number; // 0–100 during the R2 PUT
  mediaId?: string; // temp UUID from initiate
  error?: string;
};

// What the queue needs to upload one image. Either raw bytes (device files) or
// a URL to fetch first (stock photos, whose exact size/type we only learn after
// downloading the blob).
export type UploadInput = {
  blob?: Blob;
  url?: string;
  fileName: string;
  mimeType: string;
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Serialized, on-attach media upload queue for the presigned direct-to-R2 flow.
 *
 * The server allows only one upload batch in progress per post (a second
 * `initiate` while a batch is still PENDING/UPLOADING returns 409), so this runs
 * exactly one batch at a time: queued images are coalesced into a batch, PUT to
 * R2 in parallel with per-file progress, confirmed, then polled until each
 * settles READY/FAILED. Anything queued while a batch runs goes out as the next
 * batch. Tiles are addressed by a caller-supplied stable key.
 */
export function useMediaUploadQueue(opts: {
  apiBase: string;
  getPostId: () => string | undefined;
  isActive: () => boolean;
}) {
  const { apiBase } = opts;
  const [uploads, setUploads] = useState<Record<string, UploadTile>>({});

  const uploadsRef = useRef(uploads);
  useEffect(() => {
    uploadsRef.current = uploads;
  }, [uploads]);

  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const inputsRef = useRef(new Map<string, UploadInput>());
  const orderRef = useRef<string[]>([]);
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const patch = useCallback((key: string, next: Partial<UploadTile>) => {
    setUploads((prev) =>
      prev[key] ? { ...prev, [key]: { ...prev[key], ...next } } : prev,
    );
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    const postId = optsRef.current.getPostId();
    const queued = orderRef.current.filter(
      (key) => uploadsRef.current[key]?.status === "queued",
    );
    if (queued.length === 0) return;

    if (!postId) {
      queued.forEach((key) =>
        patch(key, {
          status: "failed",
          error: "Save the draft before adding media.",
        }),
      );
      return;
    }

    runningRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Resolve bytes for every queued tile (downloading stock photos first).
      const items: { key: string; blob: Blob; decl: MediaUploadDeclaration }[] =
        [];
      for (const key of queued) {
        const input = inputsRef.current.get(key);
        if (!input) continue;
        try {
          let blob: Blob;
          let mimeType: string;
          if (input.blob) {
            blob = input.blob;
            mimeType = input.mimeType || blob.type || "image/jpeg";
          } else {
            const resp = await fetch(input.url as string, {
              signal: controller.signal,
            });
            if (!resp.ok) throw new Error("Could not fetch the selected image.");
            blob = await resp.blob();
            mimeType = blob.type || input.mimeType || "image/jpeg";
          }
          patch(key, { status: "uploading", progress: 0, error: undefined });
          items.push({
            key,
            blob,
            decl: { fileName: input.fileName, mimeType, sizeBytes: blob.size },
          });
        } catch (error) {
          if (isAbortError(error)) throw error;
          patch(key, {
            status: "failed",
            error: error instanceof Error ? error.message : "Upload failed.",
          });
        }
      }
      if (items.length === 0) return;

      // Step 1: one initiate for the whole batch.
      const slots = await initiateMediaUploads(
        apiBase,
        postId,
        items.map((item) => item.decl),
      );

      // Step 2: PUT bytes to R2 in parallel with per-file progress.
      const putResults = await Promise.allSettled(
        items.map((item, index) =>
          putFileToR2(
            slots[index],
            item.blob,
            (percent) => patch(item.key, { progress: percent }),
            controller.signal,
          ),
        ),
      );

      const confirmed: { key: string; tempId: string }[] = [];
      putResults.forEach((result, index) => {
        const slot = slots[index];
        const item = items[index];
        if (result.status === "fulfilled") {
          patch(item.key, {
            status: "processing",
            progress: 100,
            mediaId: slot.mediaId,
          });
          confirmed.push({ key: item.key, tempId: slot.mediaId });
        } else if (!isAbortError(result.reason)) {
          patch(item.key, {
            status: "failed",
            error:
              result.reason instanceof Error
                ? result.reason.message
                : "Upload failed.",
          });
        }
      });
      if (confirmed.length === 0) return;

      // Step 3: confirm the files that landed.
      await completeMediaUploads(
        apiBase,
        postId,
        confirmed.map((entry) => entry.tempId),
      );

      // Step 4: poll until each settles, then classify per tile. Video takes
      // much longer to process on LinkedIn than images (handoff §6), so widen
      // the cadence and ceiling when the batch contains a video.
      const hasVideo = items.some((item) =>
        item.decl.mimeType.startsWith("video/"),
      );
      const verdicts = await pollBatchUntilSettled(
        apiBase,
        postId,
        confirmed.map((entry) => entry.tempId),
        hasVideo ? { intervalMs: 5000, timeoutMs: 600_000 } : undefined,
      );
      if (!optsRef.current.isActive()) return;
      confirmed.forEach(({ key, tempId }) => {
        patch(
          key,
          verdicts[tempId] === "FAILED"
            ? { status: "failed", error: "LinkedIn upload failed. Retry to try again." }
            : { status: "ready" },
        );
      });
    } catch (error) {
      if (!isAbortError(error)) {
        orderRef.current.forEach((key) => {
          const status = uploadsRef.current[key]?.status;
          if (
            status === "queued" ||
            status === "uploading" ||
            status === "processing"
          ) {
            patch(key, {
              status: "failed",
              error: error instanceof Error ? error.message : "Upload failed.",
            });
          }
        });
      }
    } finally {
      runningRef.current = false;
      abortRef.current = null;
      // Drain anything queued while this batch was running.
      if (
        optsRef.current.isActive() &&
        orderRef.current.some(
          (key) => uploadsRef.current[key]?.status === "queued",
        )
      ) {
        void run();
      }
    }
  }, [apiBase, patch]);

  // Kick the queue whenever a tile becomes queued (attach or retry).
  useEffect(() => {
    if (
      !runningRef.current &&
      Object.values(uploads).some((tile) => tile.status === "queued")
    ) {
      void run();
    }
  }, [uploads, run]);

  const enqueue = useCallback(
    (items: Array<{ key: string; input: UploadInput }>) => {
      if (items.length === 0) return;
      items.forEach(({ key, input }) => inputsRef.current.set(key, input));
      orderRef.current = [...orderRef.current, ...items.map((item) => item.key)];
      setUploads((prev) => {
        const next = { ...prev };
        items.forEach(({ key }) => {
          next[key] = { status: "queued", progress: 0 };
        });
        return next;
      });
    },
    [],
  );

  const retry = useCallback(
    (key: string) => {
      patch(key, { status: "queued", progress: 0, error: undefined });
    },
    [patch],
  );

  const removeKey = useCallback((key: string) => {
    inputsRef.current.delete(key);
    orderRef.current = orderRef.current.filter((entry) => entry !== key);
    setUploads((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    runningRef.current = false;
    inputsRef.current.clear();
    orderRef.current = [];
    setUploads({});
  }, []);

  const isUploading = Object.values(uploads).some(
    (tile) =>
      tile.status === "queued" ||
      tile.status === "uploading" ||
      tile.status === "processing",
  );

  return { uploads, enqueue, retry, removeKey, reset, isUploading };
}
