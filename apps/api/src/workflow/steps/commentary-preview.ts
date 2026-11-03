import type { AgentHooks } from '../../agent/agent-runner.interface';
import { RunEventType, type EmittedEvent } from '../engine/run-event.types';
import { WorkflowStep } from '../workflow.constants';

/** The least time between two `writing` progress events of one run. */
export const COMMENTARY_PREVIEW_INTERVAL_MS = 250;

/**
 * Bridges a streamed `generate` to the run's progress events: at most one
 * `step.progress { phase: 'writing', partial: { commentary } }` per
 * `COMMENTARY_PREVIEW_INTERVAL_MS`, and only when the commentary changed since
 * the last one (each event carries the whole commentary so far, so a skipped
 * one loses nothing). `onRewrite` emits `phase: 'rewrite'`, which tells the
 * client to drop its preview, and lets the next commentary through at once.
 */
export function commentaryPreview(
  emit: (event: EmittedEvent) => void,
): Required<Pick<AgentHooks, 'onCommentary' | 'onRewrite'>> {
  let sent = '';
  let sentAt = Number.NEGATIVE_INFINITY;

  return {
    onCommentary: (commentary) => {
      if (commentary === sent) return;
      const now = Date.now();
      if (now - sentAt < COMMENTARY_PREVIEW_INTERVAL_MS) return;
      sent = commentary;
      sentAt = now;
      emit({
        type: RunEventType.STEP_PROGRESS,
        data: {
          step: WorkflowStep.GENERATE,
          phase: 'writing',
          partial: { commentary },
        },
      });
    },
    onRewrite: () => {
      sent = '';
      sentAt = Number.NEGATIVE_INFINITY;
      emit({
        type: RunEventType.STEP_PROGRESS,
        data: { step: WorkflowStep.GENERATE, phase: 'rewrite' },
      });
    },
  };
}
