import { CompressionResult, UserIntent } from 'src/agent/agent.interface';
import { StepHandler } from '../engine/workflow.types';

export const runReasearchStep: StepHandler<
  string,
  CompressionResult
> = async (state, _job, ctx) => {
  ctx.logger.log(`Running Research...`);
  const videos = await ctx.agentService.searchWithFallbacks(state.data);

  if (_job.id) {
    await ctx.agentService.updateDraft(_job.id, {
      youtubeResearch: videos,
    });
  }
  const transcripts = await ctx.agentService.getYouTubeTranscripts(videos);
  const insight = await ctx.agentService.extractInsight(
    transcripts,
    state.metadata.intent as UserIntent,
  );
  
  if (_job.id) {
    await ctx.agentService.updateDraft(_job.id, {
      compressionResult: insight,
    });
  }
  return {
    data: insight,
    initialInput: state.initialInput,
    metadata: {
      ...state.metadata,
      insight,
    },
  };
};
