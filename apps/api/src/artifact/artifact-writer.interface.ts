import { ArtifactType, VersionStatus } from 'src/database/schemas';
import type { FailureCode } from 'src/workflow/workflow.constants';
import { ArtifactContent } from './schemas';

export { ArtifactDeletedError } from './artifact-deleted.error';

export interface VersionWriteOptions {
  title?: string;
}

export interface VersionRead {
  type: ArtifactType;
  version: number;
  status: VersionStatus;
}

export interface RefineContext {
  priorContent: ArtifactContent;
  feedback: string;
}

/**
 * What `failVersion` did. `NOT_GENERATING` covers a replayed failure and a
 * version that a promotion already made READY: neither is overwritten.
 */
export type FailVersionOutcome =
  | 'FAILED'
  | 'NOT_GENERATING'
  | 'ARTIFACT_DELETED';

// Narrow role interface consumed by the workflow engine's StepContext (#110):
// steps depend on this, not on the full ArtifactService surface.
export interface ArtifactWriter {
  /**
   * Promotes a `GENERATING` Attempt to `READY` and makes it the Current Version
   * in one conditional write. `content` is the complete version content, a
   * DOCUMENT's Document Version included. Idempotent: a replay that finds the
   * version already `READY` succeeds without writing (for a DOCUMENT, only with
   * the same `sourceSha256`).
   */
  promoteVersion(
    artifactId: string,
    version: number,
    content: ArtifactContent,
    options?: VersionWriteOptions,
  ): Promise<void>;
  readVersion(artifactId: string, version: number): Promise<VersionRead>;
  readRefineInput(artifactId: string, version: number): Promise<RefineContext>;
  // Called only by the engine's terminal-failure handler (#110). A failed
  // Attempt stays in the history as content-less record of what went wrong;
  // it is never resumed.
  failVersion(
    artifactId: string,
    version: number,
    failureCode: FailureCode,
    failureReason: string,
  ): Promise<FailVersionOutcome>;
}
