import { CompressionResult, UserIntent } from 'src/agent/agent.interface';
import { StepHandler } from '../engine/workflow.types';
import { InputDto } from 'src/agent/dto';
import { ContentType } from '../workflow.constants';
import { resolveStylePresetInstruction } from '../../agent/style-presets.config';

export const createLinkedinDraftStep: StepHandler<
  CompressionResult | undefined,
  string
> = async (state, _job, ctx) => {
  ctx.logger.log(`Creating Draft...`);
  const input = state.initialInput as InputDto;
  const selectedStyleInstruction = resolveStylePresetInstruction(
    input.stylePreset,
  );
  const enrichedIntent = {
    ...(state.metadata.intent as UserIntent),
    selected_style: input.stylePreset,
    selected_style_instruction: selectedStyleInstruction,
  };

  let draft: string;

  try {
    if (input.contentType === ContentType.QUICK_POST_LINKEDIN) {
      draft = await ctx.agentService.createLinkedInPost(enrichedIntent);
    } else {
      draft = await ctx.agentService.createLinkedInPost(
        enrichedIntent,
        state.data as CompressionResult,
      );
    }
  } catch (error) {
    ctx.logger.error('Draft creation failed:', error);
    throw error;
  }

  if (_job.id) {
    await ctx.agentService.updateDraft(_job.id, {
      content: draft,
    });
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
