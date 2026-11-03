import { RunEventType } from '../engine/run-event.types';
import { WorkflowStep } from '../workflow.constants';
import {
  COMMENTARY_PREVIEW_INTERVAL_MS,
  commentaryPreview,
} from './commentary-preview';

const writing = (commentary: string) => ({
  type: RunEventType.STEP_PROGRESS,
  data: {
    step: WorkflowStep.GENERATE,
    phase: 'writing',
    partial: { commentary },
  },
});

const rewrite = {
  type: RunEventType.STEP_PROGRESS,
  data: { step: WorkflowStep.GENERATE, phase: 'rewrite' },
};

let emit: jest.Mock;
let preview: ReturnType<typeof commentaryPreview>;

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-10-24T12:00:00Z') });
  emit = jest.fn();
  preview = commentaryPreview(emit);
});

afterEach(() => jest.useRealTimers());

describe('commentaryPreview', () => {
  it('should emit the first commentary at once', () => {
    preview.onCommentary('Wri');

    expect(emit.mock.calls).toEqual([[writing('Wri')]]);
  });

  it('should emit nothing while the commentary is still empty', () => {
    preview.onCommentary('');

    expect(emit).not.toHaveBeenCalled();
  });

  it('should hold back growth until the interval has passed since the last emit', () => {
    preview.onCommentary('W');
    jest.advanceTimersByTime(COMMENTARY_PREVIEW_INTERVAL_MS - 1);
    preview.onCommentary('Wr');
    expect(emit).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    preview.onCommentary('Wri');

    expect(emit).toHaveBeenLastCalledWith(writing('Wri'));
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('should emit nothing when the commentary has not changed since the last emit', () => {
    preview.onCommentary('Write');
    jest.advanceTimersByTime(COMMENTARY_PREVIEW_INTERVAL_MS * 4);
    preview.onCommentary('Write');

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('should keep the interval between 250 and 300 ms', () => {
    expect(COMMENTARY_PREVIEW_INTERVAL_MS).toBeGreaterThanOrEqual(250);
    expect(COMMENTARY_PREVIEW_INTERVAL_MS).toBeLessThanOrEqual(300);
  });

  describe('onRewrite', () => {
    it('should emit the rewrite phase and let the next commentary through at once', () => {
      preview.onCommentary('Draft');
      preview.onRewrite();
      preview.onCommentary('D');

      expect(emit.mock.calls).toEqual([
        [writing('Draft')],
        [rewrite],
        [writing('D')],
      ]);
    });

    it('should emit a repeat of the old commentary after a rewrite', () => {
      preview.onCommentary('Same');
      preview.onRewrite();
      preview.onCommentary('Same');

      expect(emit).toHaveBeenLastCalledWith(writing('Same'));
    });
  });
});
