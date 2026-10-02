import { ConflictException, NotFoundException } from '@nestjs/common';
import { terminal } from '../engine/workflow.error';
import type { StepHandler } from '../engine/workflow.types';

/**
 * The run's only durable content write: it promotes the target Attempt
 * `GENERATING → READY` and makes it the Current Version, in one conditional
 * update.
 *
 * Idempotent: a whole-job retry whose earlier attempt already promoted the
 * version finds it `READY` and succeeds without writing. A write failure is
 * retryable and simply propagates. An Attempt that can no longer be promoted
 * is terminal, and so is an artifact deleted mid-run, which the engine fails
 * silently.
 */
export const persistVersionStep: StepHandler = async (state, ctx) => {
  const { artifactId, version } = state.input;

  if (!state.content) {
    // GENERATE runs before this in every step list the builder can emit, so an
    // empty slot is a wiring bug a replay would reproduce exactly.
    throw terminal(
      `PERSIST_VERSION reached with no generated content for artifact ${artifactId} v${version}`,
    );
  }

  try {
    await ctx.artifacts.promoteVersion(artifactId, version, state.content, {
      ...(state.render !== undefined ? { render: state.render } : {}),
      ...(state.generatedTitle !== undefined
        ? { title: state.generatedTitle }
        : {}),
    });
  } catch (error: unknown) {
    if (
      error instanceof ConflictException ||
      error instanceof NotFoundException
    ) {
      throw terminal(error.message, error);
    }
    throw error;
  }

  return {};
};
