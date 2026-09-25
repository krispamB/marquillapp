import { ArtifactType, RunKind } from '../../database/schemas';
import { WorkflowStep } from '../workflow.constants';
import type { BuildSpec, WorkflowDefinition } from './workflow.types';

/**
 * A linear ordered step list. No DAG — these flows have no real branching, so
 * the variation axes are handled by composition rather than runtime edges.
 *
 * **The emitted sequence is honest**: only steps that actually run appear. It
 * feeds the SSE progress stream and the progress-bar math, so `total` must be
 * exact and the bar must have no skipped-step gaps.
 */
export function buildWorkflow({
  type,
  withResearch,
  kind,
}: BuildSpec): WorkflowDefinition {
  return {
    name: `artifact:${type}`,
    steps: [
      WorkflowStep.RESOLVE_INPUT,
      // Refine skips research unconditionally: it is cache-seeded from the run
      // record, so it re-charges no web-search surcharge and adds no latency.
      ...(withResearch && kind === RunKind.INITIAL
        ? [WorkflowStep.RESEARCH]
        : []),
      WorkflowStep.GENERATE, // dispatches on type internally
      ...(type === ArtifactType.DOCUMENT ? [WorkflowStep.RENDER_PDF] : []),
      WorkflowStep.PERSIST_VERSION,
    ],
  };
}
