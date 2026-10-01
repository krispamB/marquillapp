/**
 * Thrown by a run's artifact reads and writes when the user soft-deleted the
 * artifact while the run was in flight. The run then fails quietly: no credits,
 * and no message to a client that has already moved on.
 *
 * Kept free of imports so the workflow engine can classify it without loading
 * the database schemas.
 */
export class ArtifactDeletedError extends Error {
  constructor(artifactId: string) {
    super(`Artifact ${artifactId} was deleted during the run`);
    this.name = 'ArtifactDeletedError';
  }
}
