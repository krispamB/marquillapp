import { apiFetch } from "./api";
import type {
  CompleteMediaUploadsResponse,
  InitiateMediaUploadsResponse,
  MediaUploadDeclaration,
  MediaUploadSlot,
  PostDetailResponse,
  PostMediaItem,
} from "./types";

// Media entries created before async uploads have no `status`; the handoff doc
// (§5/§11) says to treat an absent status exactly like `READY`. `PENDING` (slot
// issued, PUT/confirm not yet landed) and `UPLOADING` (background LinkedIn
// transfer) are both still in-flight.
export function isMediaInFlight(item: PostMediaItem): boolean {
  return item.status === "PENDING" || item.status === "UPLOADING";
}

export function isMediaReady(item: PostMediaItem): boolean {
  return item.status === undefined || item.status === "READY";
}

export function isMediaFailed(item: PostMediaItem): boolean {
  return item.status === "FAILED";
}

// ─── Presigned direct-to-R2 upload flow (handoff §2–§4) ──────────────────────

/**
 * Step 1 — declare every file you intend to upload and get back presigned R2
 * URLs. Blocked with 409 while another batch is still PENDING/UPLOADING, so
 * callers must serialize batches per post.
 */
export async function initiateMediaUploads(
  apiBase: string,
  postId: string,
  files: MediaUploadDeclaration[],
): Promise<MediaUploadSlot[]> {
  const res = await apiFetch(`${apiBase}/posts/${postId}/media/uploads`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });

  let parsed: InitiateMediaUploadsResponse | null = null;
  try {
    parsed = (await res.json()) as InitiateMediaUploadsResponse;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    throw new Error(parsed?.message || "Unable to start the media upload.");
  }

  const uploads = parsed?.data?.uploads ?? [];
  if (uploads.length !== files.length) {
    throw new Error("The server returned an unexpected number of upload slots.");
  }
  return uploads;
}

/**
 * Step 2 — PUT the file bytes straight to R2. This is a plain XHR (not
 * `apiFetch`): the presigned URL carries its own auth, and XHR gives real
 * per-file upload progress. Send exactly the `requiredHeaders`; a mismatched
 * Content-Type/Length is rejected by R2 with 403.
 *
 * `Content-Length` is a forbidden header the browser sets automatically from
 * the body — we skip it (setting it is a no-op) and rely on the blob's exact
 * byte size matching the declared `sizeBytes`.
 */
export function putFileToR2(
  slot: MediaUploadSlot,
  file: Blob,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", slot.uploadUrl, true);

    for (const [name, value] of Object.entries(slot.requiredHeaders)) {
      if (name.toLowerCase() === "content-length") continue;
      try {
        xhr.setRequestHeader(name, value);
      } catch {
        // Forbidden headers are silently managed by the browser.
      }
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`Upload failed (HTTP ${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection."));
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.send(file);
  });
}

/**
 * Step 3 — confirm the files that landed in R2. The server verifies each and
 * enqueues the background LinkedIn upload, flipping entries to `UPLOADING`.
 */
export async function completeMediaUploads(
  apiBase: string,
  postId: string,
  mediaIds: string[],
): Promise<PostMediaItem[]> {
  const res = await apiFetch(
    `${apiBase}/posts/${postId}/media/uploads/complete`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaIds }),
    },
  );

  let parsed: CompleteMediaUploadsResponse | null = null;
  try {
    parsed = (await res.json()) as CompleteMediaUploadsResponse;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    throw new Error(parsed?.message || "Unable to confirm the media upload.");
  }
  return parsed?.data ?? [];
}

export type BatchSettleResult = Record<string, "READY" | "FAILED">;

/**
 * Polls `GET /posts/:id` until every media entry in `tempMediaIds` (the temp
 * UUIDs from initiate) has settled, returning a READY/FAILED verdict per id.
 *
 * A READY entry has its `id` swapped from the temp UUID to the real LinkedIn
 * URN, so it stops matching by temp id — an id that no longer appears (and
 * isn't FAILED) is treated as READY. Ids still unsettled when the ceiling
 * elapses are reported FAILED so the UI can offer a retry.
 */
export async function pollBatchUntilSettled(
  apiBase: string,
  postId: string,
  tempMediaIds: string[],
  options?: { intervalMs?: number; timeoutMs?: number },
): Promise<BatchSettleResult> {
  const intervalMs = options?.intervalMs ?? 3000; // §6 suggested image cadence
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;
  const verdicts: BatchSettleResult = {};

  for (;;) {
    const res = await apiFetch(`${apiBase}/posts/${postId}`, {
      credentials: "include",
    });

    let parsed: PostDetailResponse | null = null;
    try {
      parsed = (await res.json()) as PostDetailResponse;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      throw new Error(parsed?.message || "Unable to check media upload status.");
    }

    const media = parsed?.data?.media ?? [];
    for (const tempId of tempMediaIds) {
      if (verdicts[tempId]) continue;
      const entry = media.find((item) => item.id === tempId);
      if (!entry) {
        // No longer matchable by temp id → swapped to a URN → READY.
        verdicts[tempId] = "READY";
      } else if (entry.status === "FAILED") {
        verdicts[tempId] = "FAILED";
      } else if (entry.status === "READY" || entry.status === undefined) {
        verdicts[tempId] = "READY";
      }
      // PENDING/UPLOADING → still in flight, leave unresolved.
    }

    if (tempMediaIds.every((id) => verdicts[id])) {
      return verdicts;
    }

    if (Date.now() >= deadline) {
      for (const id of tempMediaIds) {
        if (!verdicts[id]) verdicts[id] = "FAILED";
      }
      return verdicts;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
}
