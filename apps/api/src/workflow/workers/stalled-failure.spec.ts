import { Job, UnrecoverableError } from 'bullmq';
import type { BuildInput } from '../engine/workflow.types';
import {
  STALLED_FAILURE_REASON,
  handleStalledFailure,
} from './stalled-failure';

const makeDeps = () => {
  const job = { id: 'run-1', data: {} } as unknown as Job<BuildInput>;
  const deps = {
    getJob: jest.fn().mockResolvedValue(job),
    onFailed: jest.fn().mockResolvedValue(undefined),
    logger: { warn: jest.fn() },
  };
  return { deps, fixtures: { job } };
};

describe('handleStalledFailure', () => {
  let deps: ReturnType<typeof makeDeps>['deps'];
  let fixtures: ReturnType<typeof makeDeps>['fixtures'];

  beforeEach(() => {
    ({ deps, fixtures } = makeDeps());
  });

  it('should hand the job to the failure handler as unrecoverable when it stalled out', async () => {
    await handleStalledFailure(
      { jobId: 'run-1', failedReason: STALLED_FAILURE_REASON },
      deps,
    );

    expect(deps.getJob).toHaveBeenCalledWith('run-1');
    expect(deps.onFailed).toHaveBeenCalledTimes(1);
    const [job, error] = deps.onFailed.mock.calls[0] as [Job, Error];
    expect(job).toBe(fixtures.job);
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect(error.message).toBe('job stalled more than allowable limit');
  });

  it('should ignore the event when the job failed for another reason', async () => {
    await handleStalledFailure(
      { jobId: 'run-1', failedReason: 'commentary must not be empty' },
      deps,
    );

    expect(deps.getJob).not.toHaveBeenCalled();
    expect(deps.onFailed).not.toHaveBeenCalled();
  });

  it('should warn and do nothing when the job is gone', async () => {
    deps.getJob.mockResolvedValue(undefined);

    await handleStalledFailure(
      { jobId: 'run-1', failedReason: STALLED_FAILURE_REASON },
      deps,
    );

    expect(deps.onFailed).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('run-1'),
    );
  });
});
