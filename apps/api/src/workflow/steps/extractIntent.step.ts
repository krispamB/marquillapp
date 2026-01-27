import { UserIntent } from 'src/agent/agent.interface';
import { StepHandler, WorkflowContext } from '../engine/workflow.types';
import { InputDto } from 'src/agent/dto';

export const extractIntentStep: StepHandler<InputDto, UserIntent> = async (
  state,
  _job,
  ctx,
) => {
  try {
    ctx.logger.log(`Extracting Intent...`);
    const intent = await ctx.agentService.generateUserIntent(state.data.input);
    if (_job.id) {
      await ctx.agentService.updateDraft(_job.id, {
        userIntent: intent,
      });
    }
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
