import { UserIntent } from 'src/agent/agent.interface';
import { StepHandler, WorkflowState } from '../engine/workflow.types';

export const getQueriesStep: StepHandler<UserIntent, string[]> = async (
  state,
  _job,
  ctx,
) => {
  ctx.logger.log(`Getting Queries...`);
  const queries = await ctx.agentService.generateSearchKeywords(state.data);
  return {
    data: queries,
    initialInput: state.initialInput,
    metadata: {
      ...state.metadata,
      queries,
    },
  };
};
