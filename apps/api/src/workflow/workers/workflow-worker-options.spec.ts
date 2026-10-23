import { DOCUMENT_QUEUE_NAME, QUEUE_NAME } from '../workflow.constants';
import { workflowWorkerOptions } from './workflow-worker-options';

describe('workflowWorkerOptions', () => {
  it('should give each queue a concurrency of 1 and a 30 s lock when no key is set', () => {
    expect(workflowWorkerOptions({})).toEqual({
      [QUEUE_NAME]: {
        concurrency: 1,
        lockDuration: 30_000,
        maxStalledCount: 2,
        stalledInterval: 10_000,
      },
      [DOCUMENT_QUEUE_NAME]: {
        concurrency: 1,
        lockDuration: 30_000,
        maxStalledCount: 2,
        stalledInterval: 10_000,
      },
    });
  });

  it('should take each queue concurrency from its own key when both are set', () => {
    const options = workflowWorkerOptions({
      WORKFLOW_TEXT_CONCURRENCY: '10',
      WORKFLOW_DOCUMENT_CONCURRENCY: '2',
    });

    expect(options[QUEUE_NAME].concurrency).toBe(10);
    expect(options[DOCUMENT_QUEUE_NAME].concurrency).toBe(2);
  });

  it('should apply WORKFLOW_LOCK_DURATION_MS to both queues when it is set', () => {
    const options = workflowWorkerOptions({
      WORKFLOW_LOCK_DURATION_MS: '60000',
    });

    expect(options[QUEUE_NAME].lockDuration).toBe(60_000);
    expect(options[DOCUMENT_QUEUE_NAME].lockDuration).toBe(60_000);
  });

  it.each([
    ['WORKFLOW_TEXT_CONCURRENCY', '0'],
    ['WORKFLOW_DOCUMENT_CONCURRENCY', 'two'],
    ['WORKFLOW_LOCK_DURATION_MS', '999'],
  ])('should throw naming the key when %s is %p', (key, value) => {
    expect(() => workflowWorkerOptions({ [key]: value })).toThrow(key);
  });
});
