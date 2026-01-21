import { CompressionResult, UserIntent } from 'src/agent/agent.interface';
import { StepHandler } from '../engine/workflow.types';

export const createDraftStep: StepHandler<CompressionResult, string> = async (
  state,
  _job,
  ctx,
) => {
  ctx.logger.log(`Creating Draft...`);
  const draft = await ctx.agentService.createDraft(
    state.data,
    state.metadata.intent as UserIntent,
  );
  return {
    data: draft,
    initialInput: state.initialInput,
    metadata: {
      ...state.metadata,
      draft,
    },
  };
};
