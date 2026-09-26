import { terminal } from '../engine/workflow.error';
import type { StepHandler } from '../engine/workflow.types';

/**
 * The run's only durable content write: it flips the target version
 * `GENERATING → READY`.
 *
 * A write failure is retryable and simply propagates — the write targets the
 * fixed `(artifactId, version)`, so a whole-job retry overwrites rather than
 * appends.
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

  await ctx.artifacts.setVersionContent(artifactId, version, state.content, {
    ...(state.render !== undefined ? { render: state.render } : {}),
    ...(state.generatedTitle !== undefined
      ? { title: state.generatedTitle }
      : {}),
  });

  return {};
};
