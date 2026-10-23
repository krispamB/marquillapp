import { BadRequestException, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { ArtifactType, RunKind } from 'src/database/schemas';
import { DEFAULT_DESIGN_SYSTEM_ID } from '../design-system/design-system.constants';
import { DesignSystemsService } from '../design-system/design-systems.service';
import { FeatureGatingService } from 'src/feature-gating/feature-gating.service';
import { WorkflowRunService } from 'src/workflow/workflow-run.service';
import { InflightRunLimiter } from '../workflow/inflight-run-limiter';
import { WorkflowQueue } from 'src/workflow/workflow.queue';
import type {
  BuildInput,
  DesignSystemPin,
} from 'src/workflow/engine/workflow.types';
import { ArtifactService, CreateArtifactInput } from './artifact.service';

export interface LaunchResult {
  artifactId: string;
  runId: string;
}

export interface RefineLaunchResult extends LaunchResult {
  version: number;
}

/**
 * Orchestrates artifact creation over HTTP: a fast balance pre-check, then the
 * `Artifact` → `WorkflowRun` → BullMQ-job chain that a single 202 hands to the
 * client as `{ artifactId, runId }`. The run is filled asynchronously by the
 * worker and watched over SSE — synchronous creation was rejected because
 * research + LLM + render take tens of seconds.
 */
@Injectable()
export class ArtifactGenerationService {
  constructor(
    private readonly artifactService: ArtifactService,
    private readonly workflowRunService: WorkflowRunService,
    private readonly featureGating: FeatureGatingService,
    private readonly workflowQueue: WorkflowQueue,
    private readonly designSystems: DesignSystemsService,
    private readonly inflight: InflightRunLimiter,
  ) {}

  async launchInitialRun(
    userId: string,
    input: CreateArtifactInput,
  ): Promise<LaunchResult> {
    // In the request path, before any spend: an unknown, superseded, retired or
    // unlisted slug is a 400.
    const designSystem = this.pinDesignSystem(input);

    // Pre-check research access and the headroom on one entitlement, so an
    // out-of-credits user gets a fast 403 rather than a queued run that fails
    // after doing work.
    await this.featureGating.assertLaunch(userId, {
      withResearch: input.withResearch,
    });

    // The run's id is chosen here so the in-flight slot is taken, over the
    // cap with a 429, before anything is written.
    const runId = new Types.ObjectId().toString();
    await this.inflight.reserve(userId, runId);

    try {
      const artifact = await this.artifactService.createArtifact(userId, input);
      const artifactId = artifact._id.toString();

      // The run's `input` and the BullMQ job payload are the same `BuildInput`:
      // the worker reads the job, an SSE cold start re-derives the step list
      // from the run's copy.
      const buildInput: BuildInput = {
        type: input.type,
        prompt: input.prompt,
        withResearch: input.withResearch,
        stylePreset: input.stylePreset,
        ...(designSystem ? { designSystem } : {}),
        kind: RunKind.INITIAL,
        userId,
        artifactId,
        version: 1,
      };

      await this.persistAndEnqueueRun(userId, artifactId, runId, buildInput);

      return { artifactId, runId };
    } catch (error: unknown) {
      await this.inflight.release(userId, runId);
      throw error;
    }
  }

  async launchRefineRun(
    userId: string,
    artifactId: string,
    feedback: string,
    designSystemId?: string,
  ): Promise<RefineLaunchResult> {
    // A refine reuses the run's research, so only the headroom is gated.
    await this.featureGating.assertLaunch(userId, { withResearch: false });

    const runId = new Types.ObjectId().toString();
    await this.inflight.reserve(userId, runId);

    try {
      // A DOCUMENT's pin is decided in the same call, before the Attempt is
      // appended: an unavailable pin or an unselectable switch appends nothing.
      const refinement = await this.artifactService.appendRefineVersion(
        userId,
        artifactId,
        feedback,
        designSystemId,
      );

      const buildInput: BuildInput = {
        type: refinement.type,
        prompt: refinement.prompt,
        withResearch: refinement.withResearch,
        stylePreset: refinement.stylePreset,
        ...(refinement.designSystem
          ? { designSystem: refinement.designSystem }
          : {}),
        kind: RunKind.REFINE,
        userId,
        artifactId,
        version: refinement.version,
      };

      await this.persistAndEnqueueRun(userId, artifactId, runId, buildInput);

      return { artifactId, version: refinement.version, runId };
    } catch (error: unknown) {
      await this.inflight.release(userId, runId);
      throw error;
    }
  }

  /**
   * The Design System Version a new DOCUMENT is pinned to: the requested
   * slug's ACTIVE version, or the default's. The pin rides the job payload,
   * so every job attempt renders against the same definition.
   */
  private pinDesignSystem(
    input: CreateArtifactInput,
  ): DesignSystemPin | undefined {
    if (input.type !== ArtifactType.DOCUMENT) {
      if (input.designSystemId !== undefined) {
        throw new BadRequestException(
          'designSystemId applies only to DOCUMENT artifacts',
        );
      }
      return undefined;
    }
    const { id, version } = this.designSystems.getActive(
      input.designSystemId ?? DEFAULT_DESIGN_SYSTEM_ID,
    );
    return { id, version };
  }

  private async persistAndEnqueueRun(
    userId: string,
    artifactId: string,
    runId: string,
    input: BuildInput,
  ): Promise<void> {
    await this.workflowRunService.createRun({
      runId,
      userId,
      artifactId,
      targetVersion: input.version,
      kind: input.kind,
      input,
    });

    await this.workflowQueue.addArtifactRunJob(runId, input);
  }
}
