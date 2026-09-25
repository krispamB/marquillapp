import { WorkflowQueue } from './workflow.queue';
import type { BuildInput } from './engine/workflow.types';

describe('WorkflowQueue', () => {
  describe('addArtifactRunJob', () => {
    it('should enqueue with the runId as jobId, the artifact:type name, and the retry budget', async () => {
      const service = new WorkflowQueue({} as any);
      const add = jest.fn().mockResolvedValue(undefined);
      (service as any).queue = { add };

      const input = {
        type: 'DOCUMENT',
        prompt: 'a carousel about deep modules',
        withResearch: true,
        kind: 'INITIAL',
        userId: 'user123',
        artifactId: 'artifact123',
        version: 1,
      } as unknown as BuildInput;

      await service.addArtifactRunJob('run123', input);

      expect(add).toHaveBeenCalledWith('artifact:DOCUMENT', input, {
        jobId: 'run123',
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: false,
      });
    });
  });
});
