import { WorkflowStep } from '../workflow.constants';
import { RunDeadline } from './run-deadline';
import { WorkflowError } from './workflow.error';

describe('RunDeadline', () => {
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000;
  });

  describe('assertTimeLeft', () => {
    it('should pass when the deadline has not been reached', () => {
      const deadline = RunDeadline.after(500, now);
      clock = 1_499;

      expect(() =>
        deadline.assertTimeLeft(WorkflowStep.GENERATE, 'the draft'),
      ).not.toThrow();
    });

    it('should throw transient as render.unavailable in RENDER_PDF when the deadline has passed', () => {
      const deadline = RunDeadline.after(500, now);
      clock = 1_500;

      let error: unknown;
      try {
        deadline.assertTimeLeft(WorkflowStep.RENDER_PDF, 'render session 2');
      } catch (thrown: unknown) {
        error = thrown;
      }

      expect(error).toBeInstanceOf(WorkflowError);
      expect(error).toMatchObject({
        retryable: true,
        code: 'render.unavailable',
      });
      expect((error as WorkflowError).reason).toContain('render session 2');
    });

    it('should throw transient without a code outside RENDER_PDF when the deadline has passed', () => {
      const deadline = new RunDeadline(1_000, now);

      let error: unknown;
      try {
        deadline.assertTimeLeft(WorkflowStep.GENERATE, 'the draft');
      } catch (thrown: unknown) {
        error = thrown;
      }

      expect(error).toMatchObject({ retryable: true });
      expect((error as WorkflowError).code).toBeUndefined();
    });
  });

  describe('remainingMs', () => {
    it('should report the time left when the deadline has not been reached', () => {
      const deadline = RunDeadline.after(500, now);
      clock = 1_200;

      expect(deadline.remainingMs()).toBe(300);
    });

    it('should report zero when the deadline has passed', () => {
      const deadline = RunDeadline.after(500, now);
      clock = 1_700;

      expect(deadline.remainingMs()).toBe(0);
    });

    it('should report the time left after the reserve when a reserve is kept', () => {
      const deadline = RunDeadline.after(500, now);
      clock = 1_200;

      expect(deadline.remainingMs(100)).toBe(200);
    });

    it('should report zero when the reserve is more than the time left', () => {
      const deadline = RunDeadline.after(500, now);
      clock = 1_200;

      expect(deadline.remainingMs(400)).toBe(0);
    });
  });
});
