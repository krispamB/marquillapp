import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { RunKind, RunStatus, WorkflowRun } from '../database/schemas';
import type { ResearchResult } from '../agent/agent-runner.interface';
import type { RenderAttemptUsage } from '../carousel/render-usage.types';
import type { BuildInput, RunRecordHandle } from './engine/workflow.types';
import { FailureCode, WorkflowStep } from './workflow.constants';

export interface CreateRunInput {
  userId: string;
  artifactId: string;
  targetVersion: number;
  kind: RunKind;
  input: BuildInput;
}

/** The run behind one `(artifact, version)`; see `findRunsForVersions`. */
export interface VersionRun {
  artifactId: string;
  version: number;
  runId: string;
}

@Injectable()
export class WorkflowRunService {
  constructor(
    @InjectModel(WorkflowRun.name)
    private readonly workflowRunModel: Model<WorkflowRun>,
  ) {}

  async createRun(input: CreateRunInput): Promise<WorkflowRun> {
    return this.workflowRunModel.create({
      user: new Types.ObjectId(input.userId),
      artifact: new Types.ObjectId(input.artifactId),
      targetVersion: input.targetVersion,
      kind: input.kind,
      status: RunStatus.RUNNING,
      input: input.input,
      creditsUsed: 0,
    });
  }

  /**
   * The durable run record, or `null` for an unknown or malformed id. The SSE
   * endpoint reads it to owner-scope a stream before opening it and to
   * synthesize a snapshot when the Redis stream has already expired.
   */
  async getRun(runId: string): Promise<WorkflowRun | null> {
    if (!isValidObjectId(runId)) return null;
    return this.workflowRunModel.findById(runId);
  }

  async getLatestCompletedResearch(
    artifactId: string,
  ): Promise<ResearchResult | undefined> {
    if (!isValidObjectId(artifactId)) return undefined;

    const run = await this.workflowRunModel
      .findOne({
        artifact: new Types.ObjectId(artifactId),
        status: RunStatus.COMPLETED,
        researchContext: { $exists: true },
      })
      .sort({ createdAt: -1 });

    return run?.researchContext;
  }

  /**
   * The runs behind the given `(artifact, version)` Attempts, oldest first, so
   * a caller that keys them by target keeps the newest when a version somehow
   * has several. A pair with no run record yet (the moment between appending
   * an Attempt and creating its run) is absent.
   */
  async findRunsForVersions(
    targets: ReadonlyArray<{ artifactId: string; version: number }>,
  ): Promise<VersionRun[]> {
    const valid = targets.filter((target) =>
      isValidObjectId(target.artifactId),
    );
    if (valid.length === 0) return [];

    const runs = await this.workflowRunModel
      .find({
        $or: valid.map((target) => ({
          artifact: new Types.ObjectId(target.artifactId),
          targetVersion: target.version,
        })),
      })
      .select({ _id: 1, artifact: 1, targetVersion: 1 })
      .sort({ createdAt: 1 })
      .lean<
        Array<{
          _id: Types.ObjectId;
          artifact: Types.ObjectId;
          targetVersion: number;
        }>
      >()
      .exec();

    return runs.map((run) => ({
      artifactId: run.artifact.toString(),
      version: run.targetVersion,
      runId: run._id.toString(),
    }));
  }

  /**
   * The engine depends on `RunRecordHandle`, not on this service. Binding the
   * runId here keeps every call site from re-threading it.
   */
  handleFor(runId: string): RunRecordHandle {
    return {
      runId,
      setCurrentStep: (step: WorkflowStep) =>
        this.patch(runId, { currentStep: step }),
      saveResearchContext: (research: ResearchResult) =>
        this.patch(runId, { researchContext: research }),
      recordRenderAttempt: (usage: RenderAttemptUsage) =>
        this.appendRenderAttempt(runId, usage),
      getLatestCompletedResearch: (artifactId: string) =>
        this.getLatestCompletedResearch(artifactId),
      complete: (creditsUsed: number) =>
        this.patch(runId, { status: RunStatus.COMPLETED, creditsUsed }),
      fail: (failureCode: FailureCode, failureReason: string) =>
        this.patch(runId, {
          status: RunStatus.FAILED,
          failureCode,
          failureReason,
        }),
    };
  }

  private async patch(
    runId: string,
    fields: Partial<WorkflowRun>,
  ): Promise<void> {
    await this.workflowRunModel.updateOne(
      { _id: new Types.ObjectId(runId) },
      { $set: fields },
    );
  }

  private async appendRenderAttempt(
    runId: string,
    usage: RenderAttemptUsage,
  ): Promise<void> {
    await this.workflowRunModel.updateOne(
      { _id: new Types.ObjectId(runId) },
      { $push: { renderAttempts: usage } },
    );
  }
}
