import { describe, expect, test } from "bun:test";
import {
  POST_PREVIEW_CHARACTER_LIMIT,
  truncatePostPreview,
} from "./postPreviewCutoff";

describe("truncatePostPreview", () => {
  test("leaves copy below the cutoff unchanged", () => {
    const content = "a".repeat(139);
    expect(truncatePostPreview(content)).toEqual({ content, isTruncated: false });
  });

  test("leaves copy at the cutoff unchanged", () => {
    const content = "a".repeat(POST_PREVIEW_CHARACTER_LIMIT);
    expect(truncatePostPreview(content)).toEqual({ content, isTruncated: false });
  });

  test("cuts longer copy at 140 characters", () => {
    const content = "a".repeat(141);
    expect(truncatePostPreview(content)).toEqual({
      content: "a".repeat(POST_PREVIEW_CHARACTER_LIMIT),
      isTruncated: true,
    });
  });

  test("counts an emoji as one character", () => {
    const content = `${"a".repeat(139)}🚀b`;
    expect(truncatePostPreview(content)).toEqual({
      content: `${"a".repeat(139)}🚀`,
      isTruncated: true,
    });
  });
});
