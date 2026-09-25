import type { LinkedinImageDetailsData } from "../lib/types";

const CACHE_KEY_PREFIX = "marquill:media-preview:";

type CachedMediaPreview = {
  downloadUrl: string;
  expiresAt: number;
};

function cacheKey(mediaId: string) {
  return `${CACHE_KEY_PREFIX}${encodeURIComponent(mediaId)}`;
}

function browserLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function normalizeExpiry(value: LinkedinImageDetailsData["downloadUrlExpiresAt"]) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !value.trim()) return undefined;

  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) return numericValue;

  const dateValue = Date.parse(value);
  return Number.isFinite(dateValue) ? dateValue : undefined;
}

function removeEntry(mediaId: string, storage: Storage) {
  try {
    storage.removeItem(cacheKey(mediaId));
  } catch {
    // Browser storage is an optional optimization.
  }
}

export function readCachedMediaPreview(
  mediaId: string,
  storage: Storage | undefined = browserLocalStorage(),
  now = Date.now(),
) {
  if (!storage) return undefined;

  try {
    const rawEntry = storage.getItem(cacheKey(mediaId));
    if (!rawEntry) return undefined;

    const entry = JSON.parse(rawEntry) as Partial<CachedMediaPreview>;
    if (
      typeof entry.downloadUrl !== "string" ||
      !entry.downloadUrl.trim() ||
      typeof entry.expiresAt !== "number" ||
      !Number.isFinite(entry.expiresAt) ||
      entry.expiresAt <= now
    ) {
      removeEntry(mediaId, storage);
      return undefined;
    }

    return entry.downloadUrl;
  } catch {
    removeEntry(mediaId, storage);
    return undefined;
  }
}

export function writeCachedMediaPreview(
  mediaId: string,
  downloadUrl: string,
  downloadUrlExpiresAt: LinkedinImageDetailsData["downloadUrlExpiresAt"],
  storage: Storage | undefined = browserLocalStorage(),
  now = Date.now(),
) {
  if (!storage || !downloadUrl.trim()) return false;

  const expiresAt = normalizeExpiry(downloadUrlExpiresAt);
  if (expiresAt === undefined || expiresAt <= now) return false;

  try {
    storage.setItem(cacheKey(mediaId), JSON.stringify({ downloadUrl, expiresAt } satisfies CachedMediaPreview));
    return true;
  } catch {
    return false;
  }
}

export function deleteCachedMediaPreview(
  mediaId: string,
  storage: Storage | undefined = browserLocalStorage(),
) {
  if (storage) removeEntry(mediaId, storage);
}
