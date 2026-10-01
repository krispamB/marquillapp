import { NotFoundException } from '@nestjs/common';
import { RunKind, VersionStatus } from '../../database/schemas';
import { terminal } from '../engine/workflow.error';
import type { StepHandler } from '../engine/workflow.types';

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
 * REFINE additionally seeds `refine` and the cached `research`.
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

  if (state.input.kind !== RunKind.REFINE) {
    return {};
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
    refine,
    ...(research ? { research } : {}),
  };
};
