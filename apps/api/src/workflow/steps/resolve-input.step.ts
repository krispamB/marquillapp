import { NotFoundException } from '@nestjs/common';
import { RunKind } from '../../database/schemas';
import { terminal } from '../engine/workflow.error';
import type { StepHandler } from '../engine/workflow.types';

/**
 * The engine already seeds `state.input` from the job payload, so this step's
 * real work is the guard: assert the target `(artifactId, version)` the whole
 * run writes to actually exists before any credits are spent on it.
 *
 * Its absence is **terminal**. Kickoff created the artifact and its `GENERATING`
 * version in the same request that enqueued this job, so a missing one is a bug,
 * and a cold replay cannot conjure it.
 *
 * REFINE additionally seeds `refine` and the cached `research`; that arrives
 * with the refine slice.
 */
export const resolveInputStep: StepHandler = async (state, ctx) => {
  const { artifactId, version } = state.input;

  let current: { version: number };
  try {
    current = await ctx.artifacts.readCurrent(artifactId);
  } catch (error: unknown) {
    // Only "it isn't there" is terminal. A database that is merely unreachable
    // is worth another attempt, so it rides the engine's default classification.
    if (error instanceof NotFoundException) {
      throw terminal(`Artifact ${artifactId} not found`, error);
    }
    throw error;
  }

  if (current.version !== version) {
    throw terminal(
      `Artifact ${artifactId} has no version ${version} to fill (current is ${current.version})`,
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
