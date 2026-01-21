import { UserIntent } from 'src/agent/agent.interface';
import { StepHandler, WorkflowContext } from '../engine/workflow.types';

export const extractIntentStep: StepHandler<string, UserIntent> = async (
  state,
  _job,
  ctx,
) => {
  try {
    ctx.logger.log(`Extracting Intent...`);
    const intent = await ctx.agentService.generateUserIntent(state.data);
    return {
      data: intent,
      initialInput: state.initialInput,
      metadata: {
        ...state.metadata,
        intent,
      },
    };
  } catch (error) {
    ctx.logger.error(`Failed to extract intent: ${error}`);
    throw error;
  }
};
