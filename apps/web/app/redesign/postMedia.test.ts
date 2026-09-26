import { describe, expect, test } from "bun:test";
import { normalizePostMedia } from "./postMedia";

describe("normalizePostMedia", () => {
  test("normalizes legacy media before the composer indexes it by ID", () => {
    expect(normalizePostMedia([
      { _id: "legacy-media", title: "Legacy image" },
      { title: "Missing identifier" },
    ])).toEqual([
      {
        _id: "legacy-media",
        id: "legacy-media",
        title: "Legacy image",
        type: "IMAGE",
        status: "READY",
      },
    ]);
  });
});
