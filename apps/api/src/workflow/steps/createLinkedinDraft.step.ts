import { CompressionResult, UserIntent } from 'src/agent/agent.interface';
import { StepHandler } from '../engine/workflow.types';
import { InputDto } from 'src/agent/dto';
import { ContentType } from '../workflow.constants';

export const createLinkedinDraftStep: StepHandler<
  CompressionResult | undefined,
  string
> = async (state, _job, ctx) => {
  ctx.logger.log(`Creating Draft...`);
  const input = state.initialInput as InputDto;

  let draft: string;

  if (input.contentType === ContentType.QUICK_POST_LINKEDIN) {
    draft = await ctx.agentService.createLinkedInPost(
      state.metadata.intent as UserIntent,
    );
  } else {
    draft = await ctx.agentService.createLinkedInPost(
      state.metadata.intent as UserIntent,
      state.data as CompressionResult,
    );
  }

  return {
    data: draft,
    initialInput: state.initialInput,
    metadata: {
      ...state.metadata,
      draft,
    },
  };
};
