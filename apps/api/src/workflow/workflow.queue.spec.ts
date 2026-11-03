import type { ConfigService } from '@nestjs/config';
import { WorkflowQueue } from './workflow.queue';
import { DOCUMENT_QUEUE_NAME, QUEUE_NAME } from './workflow.constants';
import type { BuildInput } from './engine/workflow.types';

const makeService = () => {
  const service = new WorkflowQueue({} as ConfigService);
  const queue = {
    add: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const documentQueue = {
    add: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
  Object.assign(service, { queue, documentQueue });
  return { service, mocks: { queue, documentQueue } };
};

const inputOf = (type: string) =>
  ({
    type,
    prompt: 'a carousel about deep modules',
    withResearch: true,
    kind: 'INITIAL',
    userId: 'user123',
    artifactId: 'artifact123',
    version: 1,
  }) as unknown as BuildInput;

const jobOptions = {
  jobId: 'run123',
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: true,
  removeOnFail: false,
};

let service: WorkflowQueue;
let mocks: ReturnType<typeof makeService>['mocks'];

beforeEach(() => {
  jest.clearAllMocks();
  ({ service, mocks } = makeService());
});

describe('WorkflowQueue', () => {
  describe('addArtifactRunJob', () => {
    it('should enqueue on the document queue with the runId as jobId, the artifact:type name, and the retry budget when the run is a DOCUMENT', async () => {
      const input = inputOf('DOCUMENT');

      await service.addArtifactRunJob('run123', input);

      expect(mocks.documentQueue.add).toHaveBeenCalledWith(
        'artifact:DOCUMENT',
        input,
        jobOptions,
      );
      expect(mocks.queue.add).not.toHaveBeenCalled();
    });

    it.each(['POST', 'POLL'])(
      'should enqueue on the text queue when the run is a %s',
      async (type) => {
        const input = inputOf(type);

        await service.addArtifactRunJob('run123', input);

        expect(mocks.queue.add).toHaveBeenCalledWith(
          `artifact:${type}`,
          input,
          jobOptions,
        );
        expect(mocks.documentQueue.add).not.toHaveBeenCalled();
      },
    );
  });

  describe('queueFor', () => {
    it('should return the queue with that name when given either queue name', () => {
      expect(service.queueFor(QUEUE_NAME)).toBe(mocks.queue);
      expect(service.queueFor(DOCUMENT_QUEUE_NAME)).toBe(mocks.documentQueue);
    });
  });

  describe('onModuleDestroy', () => {
    it('should close both queues when the module is destroyed', async () => {
      await service.onModuleDestroy();

      expect(mocks.queue.close).toHaveBeenCalledTimes(1);
      expect(mocks.documentQueue.close).toHaveBeenCalledTimes(1);
    });
  });
});
