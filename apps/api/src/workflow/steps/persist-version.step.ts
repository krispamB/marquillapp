import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ArtifactContent } from '../../artifact/schemas';
import { ArtifactType } from '../../database/schemas';
import { terminal } from '../engine/workflow.error';
import type { RunState, StepHandler } from '../engine/workflow.types';

/**
 * The run's only durable content write: it promotes the target Attempt
 * `GENERATING → READY` and makes it the Current Version, in one conditional
 * update.
 *
 * Idempotent: a whole-job retry whose earlier attempt already promoted the
 * version finds it `READY` and succeeds without writing (a DOCUMENT only with
 * the same `sourceSha256`). A write failure is
 * retryable and simply propagates. An Attempt that can no longer be promoted
 * is terminal, and so is an artifact deleted mid-run, which the engine fails
 * silently.
 */
export const persistVersionStep: StepHandler = async (state, ctx) => {
  const { artifactId, version } = state.input;

  const content = contentOf(state);
  if (!content) {
    // GENERATE (and, for a DOCUMENT, RENDER_PDF) run before this in every step
    // list the builder can emit, so an empty slot is a wiring bug a replay
    // would reproduce exactly.
    throw terminal(
      `PERSIST_VERSION reached with no generated content for artifact ${artifactId} v${version}`,
    );
  }

  try {
    await ctx.artifacts.promoteVersion(artifactId, version, content, {
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

/**
 * The version content to promote. A DOCUMENT's is the §6.3 Document Version
 * `RENDER_PDF` uploaded, introduced by the draft's commentary.
 */
function contentOf(state: RunState): ArtifactContent | undefined {
  if (state.input.type !== ArtifactType.DOCUMENT) {
    return state.content;
  }
  if (!state.draft || !state.document) {
    return undefined;
  }
  return { commentary: state.draft.commentary, document: state.document };
}
