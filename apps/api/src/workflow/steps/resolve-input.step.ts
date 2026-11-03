import { NotFoundException } from '@nestjs/common';
import type { DocumentContent } from '../../artifact/schemas';
import { ArtifactType, RunKind, VersionStatus } from '../../database/schemas';
import { SUPPORTED_CONTRACT } from '../../design-system/design-system.constants';
import { renderPromptFragment } from '../../design-system/prompt-fragment';
import { sha256Hex } from '../../document-source/sha256';
import { FailureCode } from '../workflow.constants';
import { alert, alertSubject } from '../engine/alert';
import { describeError, terminal, transient } from '../engine/workflow.error';
import type {
  ResolvedDesignSystem,
  RunState,
  StepContext,
  StepHandler,
} from '../engine/workflow.types';

/**
 * The engine already seeds `state.input` from the job payload, so this step's
 * real work is the guard: assert the target Attempt the whole run writes to
 * actually exists before any credits are spent on it.
 *
 * Its absence is **terminal**. Kickoff created the artifact and its `GENERATING`
 * Attempt in the same request that enqueued this job, so a missing one is a
 * bug, and a cold replay cannot conjure it. A `FAILED` Attempt is terminal too:
 * a failed Attempt is never resumed. A `READY` one is a replay after promotion,
 * which `PERSIST_VERSION` absorbs.
 *
 * A DOCUMENT run also loads its pinned Design System (spec §7.4), before any
 * spend. REFINE additionally seeds `refine` and the cached `research`, and a
 * DOCUMENT REFINE the base's verified Candidate Source.
 */
export const resolveInputStep: StepHandler = async (state, ctx) => {
  const { artifactId, version } = state.input;

  let target: { status: VersionStatus };
  try {
    target = await ctx.artifacts.readVersion(artifactId, version);
  } catch (error: unknown) {
    // Only "it isn't there" is terminal. A database that is merely unreachable
    // is worth another attempt, so it rides the engine's default classification.
    if (error instanceof NotFoundException) {
      throw terminal(error.message, error);
    }
    throw error;
  }

  if (target.status === VersionStatus.FAILED) {
    throw terminal(
      `Artifact ${artifactId} v${version} already failed and is never resumed`,
    );
  }

  const designSystem =
    state.input.type === ArtifactType.DOCUMENT
      ? await resolveDesignSystem(state, ctx)
      : undefined;
  const resolved = designSystem ? { designSystem } : {};

  if (state.input.kind !== RunKind.REFINE) {
    return resolved;
  }

  let refine: Awaited<ReturnType<typeof ctx.artifacts.readRefineInput>>;
  try {
    refine = await ctx.artifacts.readRefineInput(artifactId, version);
  } catch (error: unknown) {
    if (error instanceof NotFoundException) {
      throw terminal(error.message, error);
    }
    throw error;
  }

  const [baseCandidate, research] = await Promise.all([
    state.input.type === ArtifactType.DOCUMENT
      ? readBaseCandidate(state, ctx, refine.priorContent as DocumentContent)
      : undefined,
    ctx.run.getLatestCompletedResearch(artifactId),
  ]);

  return {
    ...resolved,
    refine,
    ...(research ? { research } : {}),
    ...(baseCandidate !== undefined ? { baseCandidate } : {}),
  };
};

/**
 * The base's Candidate Source, which the refine prompt sees in place of the
 * assembled Document Source (spec §6.5, §7.4):
 *
 * - Mongo's kept copy (`run_candidate_sources`, by hash) is tried first and
 *   trusted only when it matches the frozen hash; a miss, mismatch or error
 *   falls back to R2;
 * - an R2 read that fails is **transient**: the object may well be there;
 * - an object that is missing, or whose bytes no longer match the hash the
 *   version froze, is **terminal** and alerts: no replay restores it.
 */
async function readBaseCandidate(
  state: RunState,
  ctx: StepContext,
  { document }: DocumentContent,
): Promise<string> {
  const { artifactId, version } = state.input;
  const { candidateKey, candidateSha256 } = document;

  const kept = await readKeptCandidate(ctx, candidateSha256);
  if (kept !== undefined) return kept;

  let body: Buffer | null;
  try {
    body = await ctx.objects.get(candidateKey);
  } catch (error: unknown) {
    throw transient(
      `Reading ${candidateKey} for artifact ${artifactId} v${version} failed`,
      error,
    );
  }

  if (body === null || sha256Hex(body) !== candidateSha256) {
    const problem =
      body === null ? 'is missing' : 'does not match its candidateSha256';
    const reason = `The base Candidate Source ${candidateKey} of artifact ${artifactId} v${version} ${problem}`;
    alert(
      ctx.logger,
      'artifact.source_missing',
      alertSubject(ctx.run.runId, state.input),
      { key: candidateKey, cause: body === null ? 'missing' : 'sha256' },
    );
    throw terminal(reason, undefined, FailureCode.ARTIFACT_SOURCE_MISSING);
  }
  return body.toString('utf8');
}

/** The kept copy when it exists and matches `candidateSha256`; else `undefined`. */
async function readKeptCandidate(
  ctx: StepContext,
  candidateSha256: string,
): Promise<string | undefined> {
  try {
    const text = await ctx.run.readAcceptedCandidateText(candidateSha256);
    if (text !== undefined && sha256Hex(text) === candidateSha256) {
      return text;
    }
  } catch (error: unknown) {
    // Best-effort: R2 is the source of truth.
    ctx.logger.warn(
      `Reading the kept Candidate Source ${candidateSha256} failed; falling back to R2: ${describeError(error)}`,
    );
  }
  return undefined;
}

/**
 * Loads the Attempt's pinned definition with the status-blind `resolve`, plus
 * its memoised prompt fragment (spec §7.4):
 *
 * - a pin that does not resolve is **terminal** and alerts: it was stamped from
 *   a seeded record, so nothing a replay does brings it back;
 * - a contract this build cannot consume is **transient**: it is deploy skew,
 *   and heals once the worker rolls;
 * - any other read failure rides the default retryable classification.
 */
async function resolveDesignSystem(
  state: RunState,
  ctx: StepContext,
): Promise<ResolvedDesignSystem> {
  const { artifactId, version, designSystem: pin } = state.input;
  if (!pin) {
    // Kickoff stamps the pin on every DOCUMENT job, so its absence is a wiring
    // bug a replay would reproduce exactly.
    throw terminal(
      `DOCUMENT run for artifact ${artifactId} v${version} has no Design System pin`,
      undefined,
      FailureCode.DESIGN_SYSTEM_UNAVAILABLE,
    );
  }

  let record: Awaited<ReturnType<typeof ctx.designSystems.resolve>>;
  try {
    record = await ctx.designSystems.resolve(pin.id, pin.version);
  } catch (error: unknown) {
    if (error instanceof NotFoundException) {
      alert(
        ctx.logger,
        'design_system.unresolvable',
        alertSubject(ctx.run.runId, state.input),
        { pin: `${pin.id}@${pin.version}` },
      );
      throw terminal(
        error.message,
        error,
        FailureCode.DESIGN_SYSTEM_UNAVAILABLE,
      );
    }
    throw error;
  }

  if (record.contract !== SUPPORTED_CONTRACT) {
    throw transient(
      `Design System ${pin.id} v${pin.version} has contract ${record.contract}; this build supports ${SUPPORTED_CONTRACT}`,
      undefined,
      FailureCode.DESIGN_SYSTEM_UNAVAILABLE,
    );
  }

  return {
    definition: record.definition,
    fragment: renderPromptFragment(record.definition),
  };
}
