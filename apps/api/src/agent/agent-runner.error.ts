/**
 * The generated content failed the Zod union even after the inline repair retry.
 *
 * Terminal by construction (R2): the repair was a *warm* resample carrying the
 * exact validation error in its prompt, so a whole-job retry — which restarts
 * cold, with that context gone — is a strictly worse-informed resample than the
 * one that just failed. The `GENERATE` step maps this to a terminal
 * `WorkflowError`; every other failure it lets the LLM layer classify.
 */
export class ContentValidationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = 'ContentValidationError';
  }
}
