import { describe, expect, test } from "bun:test";
import type { ArtifactSummary } from "./artifactTypes";
import { previewCopy } from "./PostArtifactPicker";

const documentSummary = (preview: ArtifactSummary["preview"]): ArtifactSummary => ({
  id: "document-1",
  type: "DOCUMENT",
  status: "READY",
  preview,
});

describe("previewCopy", () => {
  test("prefers the commentary", () => {
    expect(previewCopy(documentSummary({ commentary: "  Swipe through.  ", pageCount: 4 }))).toBe("Swipe through.");
  });

  test("describes a document without commentary by its page count", () => {
    expect(previewCopy(documentSummary({ pageCount: 4, coverUrl: "https://signed.example/cover.png" }))).toBe("4-page document");
  });

  test("falls back to a generic hint when the preview is empty", () => {
    expect(previewCopy(documentSummary({}))).toBe("Open this artifact to review its latest READY version.");
  });
});
