import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import {
  deleteCachedMediaPreview,
  readCachedMediaPreview,
  writeCachedMediaPreview,
} from "./mediaPreviewCache";

GlobalRegistrator.register();
afterEach(() => window.localStorage.clear());
afterAll(() => GlobalRegistrator.unregister());

const mediaId = "media-1";
const now = Date.parse("2026-07-19T12:00:00.000Z");

describe("media preview cache", () => {
  test("returns a cached URL while its numeric expiry is in the future", () => {
    writeCachedMediaPreview(mediaId, "https://cdn.example/image", now + 60_000, window.localStorage, now);

    expect(readCachedMediaPreview(mediaId, window.localStorage, now)).toBe("https://cdn.example/image");
  });

  test("normalizes numeric-string and ISO expiries", () => {
    expect(writeCachedMediaPreview("numeric", "https://cdn.example/numeric", String(now + 60_000), window.localStorage, now)).toBe(true);
    expect(writeCachedMediaPreview("iso", "https://cdn.example/iso", "2026-07-19T12:01:00.000Z", window.localStorage, now)).toBe(true);

    expect(readCachedMediaPreview("numeric", window.localStorage, now)).toBe("https://cdn.example/numeric");
    expect(readCachedMediaPreview("iso", window.localStorage, now)).toBe("https://cdn.example/iso");
  });

  test("removes expired and malformed entries", () => {
    window.localStorage.setItem("marquill:media-preview:expired", JSON.stringify({ downloadUrl: "https://cdn.example/expired", expiresAt: now - 1 }));
    window.localStorage.setItem("marquill:media-preview:malformed", "not-json");

    expect(readCachedMediaPreview("expired", window.localStorage, now)).toBeUndefined();
    expect(readCachedMediaPreview("malformed", window.localStorage, now)).toBeUndefined();
    expect(window.localStorage.getItem("marquill:media-preview:expired")).toBeNull();
    expect(window.localStorage.getItem("marquill:media-preview:malformed")).toBeNull();
  });

  test("does not cache missing, invalid, or expired expiries", () => {
    expect(writeCachedMediaPreview("missing", "https://cdn.example/missing", undefined, window.localStorage, now)).toBe(false);
    expect(writeCachedMediaPreview("invalid", "https://cdn.example/invalid", "not-a-date", window.localStorage, now)).toBe(false);
    expect(writeCachedMediaPreview("expired", "https://cdn.example/expired", now, window.localStorage, now)).toBe(false);
  });

  test("treats unavailable storage as a cache miss", () => {
    const unavailableStorage = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
      removeItem() { throw new Error("blocked"); },
    } as unknown as Storage;

    expect(readCachedMediaPreview(mediaId, unavailableStorage, now)).toBeUndefined();
    expect(writeCachedMediaPreview(mediaId, "https://cdn.example/image", now + 60_000, unavailableStorage, now)).toBe(false);
    expect(() => deleteCachedMediaPreview(mediaId, unavailableStorage)).not.toThrow();
  });

  test("deletes a cached media URL", () => {
    writeCachedMediaPreview(mediaId, "https://cdn.example/image", now + 60_000, window.localStorage, now);

    deleteCachedMediaPreview(mediaId, window.localStorage);

    expect(readCachedMediaPreview(mediaId, window.localStorage, now)).toBeUndefined();
  });
});
