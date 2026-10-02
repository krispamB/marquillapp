import { VersionStatus } from 'src/database/schemas';
import type { FailureCode } from 'src/workflow/workflow.constants';

/** The statuses an Attempt can have: it has not become `READY`. */
export type AttemptStatus = VersionStatus.GENERATING | VersionStatus.FAILED;

/**
 * The newest version of an Artifact when it is not the Current Version: an
 * in-flight Attempt, or a failed one kept as content-less history.
 */
export interface LatestAttempt {
  version: number;
  status: AttemptStatus;
  failureCode?: FailureCode;
  failureReason?: string;
  /** The run generating (or that generated) this Attempt. */
  runId?: string;
}

export interface ReportedVersion {
  version: number;
  status: VersionStatus;
  failureCode?: FailureCode;
  failureReason?: string;
}

/** Versions are appended as `max + 1`, so the highest number is the newest. */
export function newestVersion<T extends ReportedVersion>(
  versions: readonly T[],
): T | undefined {
  return versions.reduce<T | undefined>(
    (newest, candidate) =>
      !newest || candidate.version > newest.version ? candidate : newest,
    undefined,
  );
}

/**
 * The newest version, reported only when it is not the Current Version. A
 * newest version that is `READY` is always the Current Version, so anything
 * reported here is `GENERATING` or `FAILED`.
 */
export function latestAttemptOf(
  currentVersion: number | undefined,
  newest: ReportedVersion | undefined,
): Omit<LatestAttempt, 'runId'> | undefined {
  if (
    !newest ||
    newest.version === currentVersion ||
    newest.status === VersionStatus.READY
  ) {
    return undefined;
  }
  return {
    version: newest.version,
    status: newest.status,
    ...(newest.status === VersionStatus.FAILED && newest.failureCode
      ? { failureCode: newest.failureCode }
      : {}),
    ...(newest.status === VersionStatus.FAILED &&
    newest.failureReason !== undefined
      ? { failureReason: newest.failureReason }
      : {}),
  };
}

/**
 * An Artifact's status: `GENERATING` while an Attempt is in flight, else
 * `READY` once it has a Current Version, else `FAILED` (no version ever
 * became `READY`). `artifactStatusFilter` is the same rule as a Mongo filter.
 */
export function deriveArtifactStatus(
  attemptInFlight: boolean,
  currentVersion: number | undefined | null,
): VersionStatus {
  if (attemptInFlight) {
    return VersionStatus.GENERATING;
  }
  return currentVersion != null ? VersionStatus.READY : VersionStatus.FAILED;
}

/**
 * `deriveArtifactStatus` as a filter on stored artifact fields, so a status
 * filter runs before pagination. `currentVersion: null` matches a missing
 * field as well as an explicit null.
 */
export function artifactStatusFilter(
  status: VersionStatus,
): Record<string, unknown> {
  switch (status) {
    case VersionStatus.GENERATING:
      return { 'versions.status': VersionStatus.GENERATING };
    case VersionStatus.READY:
      return {
        'versions.status': { $ne: VersionStatus.GENERATING },
        currentVersion: { $ne: null },
      };
    case VersionStatus.FAILED:
      return {
        'versions.status': { $ne: VersionStatus.GENERATING },
        currentVersion: null,
      };
  }
}
