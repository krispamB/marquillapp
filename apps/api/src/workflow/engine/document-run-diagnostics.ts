import { sha256Hex } from '../../document-source/sha256';
import type { Violation } from '../../document-source/violation';
import type { FailureCode, WorkflowStep } from '../workflow.constants';
import type {
  BuildInput,
  CandidateDiagnostics,
  DocumentCheck,
  DocumentDiagnostics,
  JobAttemptFailure,
  ModelTurn,
  RepairDiagnostic,
  RunDiagnostics,
  ViolationCode,
} from './workflow.types';

/**
 * The most model calls a run's diagnostics keep, the latest first to stay. A
 * job attempt makes at most a draft, `DOCUMENT_REPAIR_BUDGET` more turns and
 * a `patch`-mode fallback, so a run within its job attempts never reaches it.
 */
export const MAX_MODEL_TURNS = 24;

/** Which run and job attempt the diagnostics describe. */
export interface DiagnosticsStart {
  runId: string;
  input: BuildInput;
  /** One-based. */
  jobAttempt: number;
  /** What earlier job attempts of the run recorded, carried on. */
  prior?: DocumentDiagnostics;
}

/** How the job attempt ended, which only the worker knows. */
export type DiagnosticsEnd =
  | { outcome: 'READY'; credits: number }
  | {
      outcome: 'FAILED' | 'RETRYING';
      failureCode: FailureCode;
      /** The error's own text: kept on the run, never logged. */
      message: string;
      credits: number;
    };

export interface FinishedDiagnostics {
  diagnostics: DocumentDiagnostics;
  /** On failure, the failed Candidate Source's text, kept apart to expire. */
  failedCandidateSource?: string;
  /**
   * The one structured line a DOCUMENT run logs when it ends (spec §11.6).
   * It names its fields explicitly, so nothing the run produced (source,
   * prompt, brief, research, violation details) can reach the logs.
   */
  completionLine: string;
}

/**
 * A DOCUMENT run's diagnostics (spec §11.1), collected in memory while one job
 * attempt's steps run, carried on from earlier job attempts, and finished by
 * the worker. It keeps codes, counts and hashes; the only text it holds is
 * the latest Candidate Source, handed back apart from the block.
 */
export class DocumentRunDiagnostics implements RunDiagnostics {
  private readonly runId: string;
  private readonly input: BuildInput;
  private readonly jobAttempt: number;
  private readonly startedAt: number;
  private readonly stepStarts = new Map<WorkflowStep, number>();
  private readonly stepWallTimeMs: Partial<Record<WorkflowStep, number>>;
  private readonly priorWallTimeMs: number;
  private readonly jobAttemptFailures: JobAttemptFailure[];
  private readonly candidates: CandidateDiagnostics[];
  /** The latest Candidate Source checked or checkpointed in this job attempt. */
  private latestCandidate?: string;
  private repairRounds = 0;
  private readonly repairs: RepairDiagnostic[];
  private outputTokens: number;
  private promptTokens: number;
  private reasoningTokens: number;
  private cachedPromptTokens: number;
  private modelTurns: ModelTurn[];
  private finishReason?: string;
  private sessions: number;
  private pages?: number;
  private acceptedCandidate?: DocumentDiagnostics['acceptedCandidate'];

  /** @param now injectable for tests. */
  constructor(
    { runId, input, jobAttempt, prior }: DiagnosticsStart,
    private readonly now: () => number = Date.now,
  ) {
    this.runId = runId;
    this.input = input;
    this.jobAttempt = jobAttempt;
    this.startedAt = now();
    this.stepWallTimeMs = { ...prior?.stepWallTimeMs };
    this.priorWallTimeMs = prior?.wallTimeMs ?? 0;
    this.jobAttemptFailures = [...(prior?.jobAttemptFailures ?? [])];
    this.candidates = (prior?.candidates ?? []).map((candidate) => ({
      candidateSha256: candidate.candidateSha256,
      checks: [...candidate.checks],
    }));
    this.outputTokens = prior?.outputTokens ?? 0;
    // Absent from diagnostics recorded before they were kept.
    this.promptTokens = prior?.promptTokens ?? 0;
    this.reasoningTokens = prior?.reasoningTokens ?? 0;
    this.cachedPromptTokens = prior?.cachedPromptTokens ?? 0;
    this.modelTurns = [...(prior?.modelTurns ?? [])];
    this.repairs = [...(prior?.repairs ?? [])];
    this.finishReason = prior?.finishReason;
    this.sessions = prior?.renderAttempts.sessions ?? 0;
    this.pages = prior?.pageCount;
    this.acceptedCandidate = prior?.acceptedCandidate;
  }

  stepStarted(step: WorkflowStep): void {
    this.stepStarts.set(step, this.now());
  }

  stepCompleted(step: WorkflowStep): void {
    const startedAt = this.stepStarts.get(step);
    if (startedAt === undefined) return;
    this.stepStarts.delete(step);
    this.stepWallTimeMs[step] =
      (this.stepWallTimeMs[step] ?? 0) + this.now() - startedAt;
  }

  recordModelTurn(usage: ModelTurn): void {
    this.outputTokens += usage.completionTokens;
    this.promptTokens += usage.promptTokens;
    this.reasoningTokens += usage.reasoningTokens ?? 0;
    this.cachedPromptTokens += usage.cachedTokens ?? 0;
    this.finishReason = usage.finishReason;
    this.modelTurns = [...this.modelTurns, toModelTurn(usage)].slice(
      -MAX_MODEL_TURNS,
    );
  }

  recordCheck(
    phase: DocumentCheck['phase'],
    candidate: string,
    violations: Violation[],
  ): void {
    const candidateSha256 = sha256Hex(candidate);
    let entry = this.candidates.find(
      (known) => known.candidateSha256 === candidateSha256,
    );
    if (!entry) {
      entry = { candidateSha256, checks: [] };
      this.candidates.push(entry);
    }
    entry.checks.push({
      phase,
      passed: violations.length === 0,
      violations: countByCode(violations),
    });
    this.latestCandidate = candidate;
  }

  recordRepairsSpent(repairsSpent: number): void {
    this.repairRounds = repairsSpent;
  }

  recordRepair({ kind, mode, edits, fallback }: RepairDiagnostic): void {
    this.repairs.push({ kind, mode, edits, fallback });
  }

  recordAccepted(candidate: string, repairsSpent: number): void {
    this.acceptedCandidate = {
      candidateSha256: sha256Hex(candidate),
      repairsSpent,
    };
    this.latestCandidate = candidate;
  }

  recordRenderSession(): void {
    this.sessions += 1;
  }

  recordPageCount(pageCount: number): void {
    this.pages = pageCount;
  }

  /** Closes any step still running: it ran until the job attempt ended. */
  finish(end: DiagnosticsEnd): FinishedDiagnostics {
    for (const step of [...this.stepStarts.keys()]) this.stepCompleted(step);

    const failures =
      end.outcome === 'READY'
        ? this.jobAttemptFailures
        : [
            ...this.jobAttemptFailures,
            {
              jobAttempt: this.jobAttempt,
              failureCode: end.failureCode,
              message: end.message,
            },
          ];
    const failed = end.outcome === 'FAILED' ? this.latestCandidate : undefined;
    const pin = this.input.designSystem;
    const diagnostics: DocumentDiagnostics = {
      jobAttempt: this.jobAttempt,
      ...(pin ? { pin: { id: pin.id, version: pin.version } } : {}),
      outcome: end.outcome,
      ...(end.outcome === 'FAILED' ? { failureCode: end.failureCode } : {}),
      jobAttemptFailures: failures,
      candidates: this.candidates,
      repairRounds: this.repairRounds,
      ...(this.repairs.length > 0 ? { repairs: [...this.repairs] } : {}),
      ...(this.finishReason !== undefined
        ? { finishReason: this.finishReason }
        : {}),
      outputTokens: this.outputTokens,
      promptTokens: this.promptTokens,
      reasoningTokens: this.reasoningTokens,
      cachedPromptTokens: this.cachedPromptTokens,
      modelTurns: this.modelTurns,
      ...(this.pages !== undefined ? { pageCount: this.pages } : {}),
      stepWallTimeMs: this.stepWallTimeMs,
      wallTimeMs: this.priorWallTimeMs + this.now() - this.startedAt,
      renderAttempts: { sessions: this.sessions },
      ...(this.acceptedCandidate
        ? { acceptedCandidate: this.acceptedCandidate }
        : {}),
      ...(failed !== undefined
        ? { failedCandidate: { candidateSha256: sha256Hex(failed) } }
        : {}),
      credits: end.credits,
      recordedAt: new Date(this.now()),
    };
    return {
      diagnostics,
      ...(failed !== undefined ? { failedCandidateSource: failed } : {}),
      completionLine: this.completionLine(diagnostics),
    };
  }

  private completionLine(diagnostics: DocumentDiagnostics): string {
    const { pin } = diagnostics;
    const fields = {
      runId: this.runId,
      artifactId: this.input.artifactId,
      version: this.input.version,
      pin: pin ? `${pin.id}@${pin.version}` : null,
      outcome: diagnostics.outcome,
      failureCode: diagnostics.failureCode ?? null,
      repairRounds: diagnostics.repairRounds,
      renderSessions: diagnostics.renderAttempts.sessions,
      wallTimeMs: diagnostics.wallTimeMs,
      credits: diagnostics.credits,
    };
    return `[DOCUMENT_RUN] ${JSON.stringify(fields)}`;
  }
}

/**
 * Names its fields, so a turn's usage keeps only what the diagnostics describe
 * (no cost: credits are the run's own record).
 */
function toModelTurn({
  call,
  model,
  promptTokens,
  completionTokens,
  reasoningTokens,
  cachedTokens,
  latencyMs,
  finishReason,
}: ModelTurn): ModelTurn {
  return {
    ...(call !== undefined ? { call } : {}),
    model,
    promptTokens,
    completionTokens,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(latencyMs !== undefined ? { latencyMs } : {}),
    ...(finishReason !== undefined ? { finishReason } : {}),
  };
}

function countByCode(
  violations: Violation[],
): { code: ViolationCode; count: number }[] {
  const counts = new Map<ViolationCode, number>();
  for (const { code } of violations) {
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts].map(([code, count]) => ({ code, count }));
}
