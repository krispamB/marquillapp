import { describe, expect, test } from "bun:test";
import { latestAttemptFeedback, resumeLatestAttempt } from "./artifactAttempt";

describe("resumeLatestAttempt", () => {
  test("does nothing when the newest version is the Current Version", () => {
    expect(resumeLatestAttempt({ currentVersion: 2 }, false)).toEqual({ action: "none" });
  });

  test("follows an in-flight refinement of the Current Version", () => {
    expect(resumeLatestAttempt({
      currentVersion: 1,
      latestAttempt: { version: 2, status: "GENERATING", runId: "run-2" },
    }, false)).toEqual({ action: "follow", kind: "REFINE", runId: "run-2" });
  });

  test("follows an in-flight first version as the initial run", () => {
    expect(resumeLatestAttempt({
      latestAttempt: { version: 1, status: "GENERATING", runId: "run-1" },
    }, false)).toEqual({ action: "follow", kind: "INITIAL", runId: "run-1" });
  });

  test("waits when the in-flight Attempt has no recorded run yet", () => {
    expect(resumeLatestAttempt({
      currentVersion: 1,
      latestAttempt: { version: 2, status: "GENERATING" },
    }, false)).toEqual({ action: "wait" });
  });

  test("leaves the outcome to the run already in the URL", () => {
    expect(resumeLatestAttempt({
      currentVersion: 1,
      latestAttempt: { version: 2, status: "FAILED" },
    }, true)).toEqual({ action: "wait" });
  });

  test("shows a failed refinement with its stored failure", () => {
    expect(resumeLatestAttempt({
      currentVersion: 1,
      latestAttempt: {
        version: 2,
        status: "FAILED",
        failureCode: "document.truncated",
        failureReason: "Out of tokens",
        runId: "run-2",
      },
    }, false)).toEqual({
      action: "show-failure",
      kind: "REFINE",
      failureCode: "document.truncated",
      failureReason: "Out of tokens",
    });
  });

  test("shows a failed first version as a failed initial run", () => {
    expect(resumeLatestAttempt({
      latestAttempt: { version: 1, status: "FAILED", failureCode: "internal" },
    }, false)).toMatchObject({ action: "show-failure", kind: "INITIAL", failureCode: "internal" });
  });
});

describe("latestAttemptFeedback", () => {
  test("returns the feedback that started the latest Attempt", () => {
    expect(latestAttemptFeedback({
      latestAttempt: { version: 2, status: "FAILED" },
      versions: [
        { version: 1, status: "READY" },
        { version: 2, status: "FAILED", refineFeedback: "Sharper" },
      ],
    })).toBe("Sharper");
  });

  test("returns nothing when there is no latest Attempt", () => {
    expect(latestAttemptFeedback({
      versions: [{ version: 1, status: "READY", refineFeedback: "Old" }],
    })).toBeUndefined();
  });
});
