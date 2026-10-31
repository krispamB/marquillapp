import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import {
  RunCandidateSource,
  RunCandidateSourceRole,
  RunKind,
  RunStatus,
  WorkflowRun,
  type StoredAcceptedCandidate,
} from '../database/schemas';
import { sha256Hex } from '../document-source/sha256';
import type { UsageRecord } from '../feature-gating/credit-meter.constants';
import type { ResearchResult } from '../agent/agent-runner.interface';
import type { RenderAttemptUsage } from '../document-render/render-usage.types';
import type {
  AcceptedCandidate,
  BuildInput,
  DocumentCheck,
  DocumentDiagnostics,
  RunFailOutcome,
  RunLlmUsage,
  RunRecordHandle,
  SavedResearch,
} from './engine/workflow.types';
import type { Usage } from '../llm/interfaces';
import {
  CANDIDATE_SOURCE_RETENTION_MS,
  FailureCode,
} from './workflow.constants';

export interface CreateRunInput {
  /** The run's `_id`, when the caller chose it before the write. */
  runId?: string;
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
    @InjectModel(RunCandidateSource.name)
    private readonly candidateSourceModel: Model<RunCandidateSource>,
  ) {}

  async createRun(input: CreateRunInput): Promise<WorkflowRun> {
    return this.workflowRunModel.create({
      ...(input.runId ? { _id: new Types.ObjectId(input.runId) } : {}),
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
   * The text of any run's ACCEPTED Candidate Source with this hash, or
   * `undefined` when none is kept (it expires). The caller verifies the hash.
   */
  private async readAcceptedCandidateText(
    candidateSha256: string,
  ): Promise<string | undefined> {
    const doc = await this.candidateSourceModel
      .findOne(
        { candidateSha256, role: RunCandidateSourceRole.ACCEPTED },
        { candidate: 1 },
      )
      .lean<{ candidate: string }>()
      .exec();
    return doc?.candidate;
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
    let llmUsage: RunLlmUsage | undefined;
    // Rides along with the run's final update rather than costing its own.
    const withLlmUsage = <T extends Partial<WorkflowRun>>(fields: T) =>
      llmUsage ? { ...fields, llmUsage } : fields;

    return {
      runId,
      saveResearchContext: (research: ResearchResult, usage: UsageRecord[]) =>
        this.patch(runId, { researchContext: research, researchUsage: usage }),
      readResearchContext: () => this.readResearchContext(runId),
      recordRenderAttempt: (usage: RenderAttemptUsage) =>
        this.appendRenderAttempt(runId, usage),
      recordDocumentCheck: (check: DocumentCheck) =>
        this.appendDocumentCheck(runId, check),
      saveAcceptedCandidate: (accepted: AcceptedCandidate) =>
        this.saveAcceptedCandidate(runId, accepted),
      readAcceptedCandidate: () => this.readAcceptedCandidate(runId),
      readDocumentDiagnostics: () => this.readDocumentDiagnostics(runId),
      saveDocumentDiagnostics: (
        diagnostics: DocumentDiagnostics,
        failedCandidateSource?: string,
      ) =>
        this.saveDocumentDiagnostics(runId, diagnostics, failedCandidateSource),
      getLatestCompletedResearch: (artifactId: string) =>
        this.getLatestCompletedResearch(artifactId),
      recordQueueWait: (queueWaitMs: number) =>
        this.patch(runId, { queueWaitMs }),
      recordModelCall: (usage: Usage) => {
        llmUsage = addModelCall(llmUsage, usage);
      },
      readAcceptedCandidateText: (candidateSha256: string) =>
        this.readAcceptedCandidateText(candidateSha256),
      complete: (creditsUsed: number) =>
        this.patch(
          runId,
          withLlmUsage({ status: RunStatus.COMPLETED, creditsUsed }),
        ),
      fail: (failureCode: FailureCode, failureReason: string) =>
        this.failIfRunning(
          runId,
          withLlmUsage({
            status: RunStatus.FAILED,
            failureCode,
            failureReason,
          }),
        ),
    };
  }

  private async failIfRunning(
    runId: string,
    fields: Partial<WorkflowRun>,
  ): Promise<RunFailOutcome> {
    const result = await this.workflowRunModel.updateOne(
      { _id: new Types.ObjectId(runId), status: RunStatus.RUNNING },
      { $set: fields },
    );
    return result.matchedCount === 0 ? 'ALREADY_ENDED' : 'FAILED';
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

  /**
   * The text first, then the run's hash of it: a checkpoint the run records
   * always has its text, until the text expires.
   */
  private async saveAcceptedCandidate(
    runId: string,
    { candidate, ...accepted }: AcceptedCandidate,
  ): Promise<void> {
    const candidateSha256 = await this.saveCandidateSource(
      runId,
      RunCandidateSourceRole.ACCEPTED,
      candidate,
    );
    const stored: StoredAcceptedCandidate = { ...accepted, candidateSha256 };
    await this.patch(runId, { acceptedCandidate: stored });
  }

  private async readResearchContext(
    runId: string,
  ): Promise<SavedResearch | undefined> {
    const run = await this.workflowRunModel
      .findById(runId)
      .select({ researchContext: 1, researchUsage: 1 })
      .lean<{
        researchContext?: ResearchResult;
        researchUsage?: UsageRecord[];
      }>()
      .exec();
    // Research saved before its usage was cannot be billed again, so it is
    // searched afresh rather than reused for free.
    if (!run?.researchContext || !run.researchUsage) return undefined;

    return { research: run.researchContext, usage: run.researchUsage };
  }

  /**
   * No checkpoint when none was saved, when its text has expired, or when it
   * predates `run_candidate_sources` and so has no hash to find its text by.
   */
  private async readAcceptedCandidate(
    runId: string,
  ): Promise<AcceptedCandidate | undefined> {
    const run = await this.workflowRunModel
      .findById(runId)
      .select({ acceptedCandidate: 1 })
      .lean<{ acceptedCandidate?: StoredAcceptedCandidate }>()
      .exec();
    if (!run?.acceptedCandidate?.candidateSha256) return undefined;
    const { candidateSha256, ...accepted } = run.acceptedCandidate;

    const text = await this.candidateSourceModel
      .findOne(
        {
          ...candidateSourceOf(runId, RunCandidateSourceRole.ACCEPTED),
          candidateSha256,
        },
        { candidate: 1 },
      )
      .lean<{ candidate: string }>()
      .exec();
    if (!text) return undefined;

    return { ...accepted, candidate: text.candidate };
  }

  private async readDocumentDiagnostics(
    runId: string,
  ): Promise<DocumentDiagnostics | undefined> {
    const run = await this.workflowRunModel
      .findById(runId)
      .select({ documentDiagnostics: 1 })
      .lean<{ documentDiagnostics?: DocumentDiagnostics }>()
      .exec();
    return run?.documentDiagnostics ?? undefined;
  }

  private async saveDocumentDiagnostics(
    runId: string,
    diagnostics: DocumentDiagnostics,
    failedCandidateSource?: string,
  ): Promise<void> {
    if (failedCandidateSource !== undefined) {
      await this.saveCandidateSource(
        runId,
        RunCandidateSourceRole.FAILED,
        failedCandidateSource,
      );
    }
    await this.patch(runId, { documentDiagnostics: diagnostics });
  }

  /** Upserts one of the run's Candidate Sources; returns its hash. */
  private async saveCandidateSource(
    runId: string,
    role: RunCandidateSourceRole,
    candidate: string,
  ): Promise<string> {
    const candidateSha256 = sha256Hex(candidate);
    await this.candidateSourceModel.updateOne(
      candidateSourceOf(runId, role),
      {
        $set: {
          candidateSha256,
          candidate,
          expiresAt: new Date(Date.now() + CANDIDATE_SOURCE_RETENTION_MS),
        },
      },
      { upsert: true },
    );
    return candidateSha256;
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

  private async appendDocumentCheck(
    runId: string,
    check: DocumentCheck,
  ): Promise<void> {
    await this.workflowRunModel.updateOne(
      { _id: new Types.ObjectId(runId) },
      { $push: { documentChecks: check } },
    );
  }
}

const addModelCall = (
  total: RunLlmUsage | undefined,
  usage: Usage,
): RunLlmUsage => {
  // Only once a call searched, so runs without model web search are unchanged.
  const webSearchRequests =
    (total?.webSearchRequests ?? 0) + (usage.webSearchRequests ?? 0);
  return {
    ...sumModelCall(total, usage),
    ...(webSearchRequests > 0 ? { webSearchRequests } : {}),
  };
};

const sumModelCall = (
  total: RunLlmUsage | undefined,
  usage: Usage,
): RunLlmUsage => ({
  calls: (total?.calls ?? 0) + 1,
  promptTokens: (total?.promptTokens ?? 0) + usage.promptTokens,
  completionTokens: (total?.completionTokens ?? 0) + usage.completionTokens,
  reasoningTokens: (total?.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0),
  cachedTokens: (total?.cachedTokens ?? 0) + (usage.cachedTokens ?? 0),
  cacheWriteTokens:
    (total?.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
  llmMs: (total?.llmMs ?? 0) + (usage.latencyMs ?? 0),
});

/** The one Candidate Source a run keeps in `role`. */
const candidateSourceOf = (runId: string, role: RunCandidateSourceRole) => ({
  run: new Types.ObjectId(runId),
  role,
});
