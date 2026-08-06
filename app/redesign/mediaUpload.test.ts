import { describe, expect, test } from "bun:test";
import { aggregateUploadProgress } from "./mediaUpload";

describe("aggregateUploadProgress", () => {
  test("reports progress for one file", () => {
    expect(aggregateUploadProgress([25], [{ size: 100 }])).toBe(25);
    expect(aggregateUploadProgress([100], [{ size: 100 }])).toBe(100);
  });

  test("weights multi-file progress by byte size", () => {
    expect(aggregateUploadProgress([50, 0], [{ size: 100 }, { size: 300 }])).toBe(13);
    expect(aggregateUploadProgress([100, 150], [{ size: 100 }, { size: 300 }])).toBe(63);
  });

  test("clamps invalid byte counts", () => {
    expect(aggregateUploadProgress([-10, 500], [{ size: 100 }, { size: 300 }])).toBe(75);
  });
});
