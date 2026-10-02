import type {
  ArtifactDetailData,
  ArtifactRunKind,
  RunFailureCode,
} from "./artifactTypes";

/**
 * What a freshly loaded conversation does about the artifact's latest Attempt,
 * which `GET /artifacts/:id` reports beside the Current Version.
 */
export type AttemptResumption =
  | { action: "none" }
  | { action: "wait" }
  | { action: "follow"; kind: ArtifactRunKind; runId: string }
  | {
      action: "show-failure";
      kind: ArtifactRunKind;
      failureCode?: RunFailureCode;
      failureReason?: string;
    };

/**
 * `followingUrlRun` is true when a `?run=` in the URL is already being
 * followed (or replayed), which then owns the run's progress and outcome.
 */
export function resumeLatestAttempt(
  detail: Pick<ArtifactDetailData, "currentVersion" | "latestAttempt">,
  followingUrlRun: boolean,
): AttemptResumption {
  const attempt = detail.latestAttempt;
  if (!attempt) return { action: "none" };
  if (followingUrlRun) return { action: "wait" };

  // Refine needs a Current Version, so an Attempt without one is the first run.
  const kind: ArtifactRunKind = detail.currentVersion === undefined ? "INITIAL" : "REFINE";
  if (attempt.status === "GENERATING") {
    return attempt.runId ? { action: "follow", kind, runId: attempt.runId } : { action: "wait" };
  }
  return {
    action: "show-failure",
    kind,
    failureCode: attempt.failureCode,
    failureReason: attempt.failureReason,
  };
}

/** The refine feedback that started the latest Attempt, from `includeVersions` metadata. */
export function latestAttemptFeedback(
  detail: Pick<ArtifactDetailData, "latestAttempt" | "versions">,
): string | undefined {
  const attempt = detail.latestAttempt;
  if (!attempt) return undefined;
  return detail.versions?.find((version) => version.version === attempt.version)?.refineFeedback;
}
