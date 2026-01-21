import { CompressionResult, UserIntent } from "src/agent/agent.interface";
import { StepHandler } from "../engine/workflow.types";

export const runReasearchStep: StepHandler<string[], CompressionResult> = async (state, _job, ctx) => {
    ctx.logger.log(`Running Research...`)
    const transcripts = await ctx.agentService.getYouTubeTranscripts(state.data)
    const insight = await ctx.agentService.extractInsight(transcripts, state.metadata.intent as UserIntent)
    return {
        data: insight,
        initialInput: state.initialInput,
        metadata: {
            ...state.metadata,
            insight
        }
    }
}