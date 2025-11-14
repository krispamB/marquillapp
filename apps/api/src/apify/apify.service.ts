import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApifyApiError, ApifyClient } from 'apify-client';
import { APIFY_CLIENT } from './apify.constants';

@Injectable()
export class ApifyService {
  private readonly logger: Logger;

  constructor(@Inject(APIFY_CLIENT) private client: ApifyClient) {
    this.logger = new Logger(ApifyService.name);
  }

  async startActor(actorId: string, input: Record<string, any>) {
    try {
      const run = await this.client.actor(actorId).call(input);
      this.logger.log(`Started actor ${actorId} with run ID: ${run.id}`);
      return run;
    } catch (error) {
      if (error instanceof ApifyApiError) {
        this.logger.error(
          `Actor ${actorId} failed with error: ${error.message}`,
        );
        throw error;
      }
      throw error;
    }
  }

  async getRun(runId: string) {
    try {
      return await this.client.run(runId).get();
    } catch (error) {
      if (error instanceof ApifyApiError) {
        this.logger.error(
          `Failed to get Actor run ${runId}. Failed with error: ${error.message}`,
        );
        throw error;
      }
      throw error;
    }
  }

  async getDatasetItems(datasetId: string) {
    try {
      return await this.client.dataset(datasetId).listItems();
    } catch (error) {
      if (error instanceof ApifyApiError) {
        this.logger.error(
          `Failed to get dataset Item${datasetId}. Failed with error: ${error.message}`,
        );
        throw error;
      }
      throw error;
    }
  }

  async waitForRun(runId: string, intervalMs = 10000) {
    while (true) {
      const run = await this.getRun(runId);
      if (!run) throw new Error(`Run ${runId} was not found`);
      if (run.status === 'SUCCEEDED') return run;
      if (['FAILED', 'ABORTED'].includes(run.status))
        throw new Error(`Run ${runId} failed`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
