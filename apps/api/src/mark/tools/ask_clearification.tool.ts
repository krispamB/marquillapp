import { tool } from "ai";
import z from "zod";

export const createAskSpecificationTool = () => tool({
    description:
        'Ask the user clarifying questions before generating an artifact. ' +
        'Call this if the user request is ambiguous, underspecified, or could produce ' +
        'meaningfully different outputs depending on intent. ' +
        'Do NOT call generate_artifact until clarification is received.',
    inputSchema: z.object({
        questions: z.array(
            z.object({
                question: z.string().describe('The clarifying question'),
                options: z.array(z.string()).min(2).max(4).describe('2–4 answer options for the user to choose from'),
            })
        ).describe('List of clarifying questions with selectable options'),
        summary: z.string().describe('Brief summary of what you understood so far'),
    }),
    // No execute — makes it a UI-only tool, agent loop pauses here
});
