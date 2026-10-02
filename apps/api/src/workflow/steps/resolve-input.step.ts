import { NotFoundException } from '@nestjs/common';
import { ArtifactType, RunKind, VersionStatus } from '../../database/schemas';
import { SUPPORTED_CONTRACT } from '../../design-system/design-system.constants';
import { renderPromptFragment } from '../../design-system/prompt-fragment';
import { FailureCode } from '../workflow.constants';
import { terminal, transient } from '../engine/workflow.error';
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
 * spend. REFINE additionally seeds `refine` and the cached `research`.
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

  const research = await ctx.run.getLatestCompletedResearch(artifactId);

  return {
    ...resolved,
    refine,
    ...(research ? { research } : {}),
  };
};

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
      ctx.logger.error(
        `[ALERT design_system.unresolvable] artifact ${artifactId} v${version} is pinned to ${pin.id} v${pin.version}, which does not resolve`,
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
