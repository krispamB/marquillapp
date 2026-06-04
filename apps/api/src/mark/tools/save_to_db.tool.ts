import { tool } from 'ai';
import z from 'zod';
import type { SaveArtifactInput } from '../artifact.service';

export const createSaveToDbTool = (
  saveFn: (params: SaveArtifactInput) => Promise<{ recordId: string }>,
) =>
  tool({
    description:
      'Persist the generated artifact metadata and storage URL to the database. ' +
      'Always call this as the final step after artifact generation (and html_to_pdf if applicable). ' +
      'This is a terminal tool — call it once and return the record ID to the user.',
    inputSchema: z.object({
      type: z
        .enum(['html', 'text', 'structured'])
        .describe('The type of artifact generated'),
      title: z.string().describe('The artifact title'),
      description: z
        .string()
        .describe('A short description of the artifact generated'),
      storageUrl: z
        .string()
        .optional()
        .describe(
          'The URL of the artifact in storage. Never pass raw binary. Only applicable to document generation requests',
        ),
      poll: z
        .object({
          content: z
            .object({
              question: z
                .string()
                .describe('The question for the poll. Max 140 characters'),
              options: z
                .array(z.string())
                .describe(
                  'The options for the poll. 2 - 4 items each max 30 characters',
                ),
            })
            .describe('The structured content for polls'),
          title: z
            .string()
            .describe('A short descriptive title for the artifact'),
        })
        .optional()
        .describe(
          "The artifact with type 'structured' created in validate_artifact tool",
        ),
      post: z
        .object({
          content: z
            .string()
            .describe('The fully generated artifact content for posts'),
          title: z
            .string()
            .describe('A short descriptive title for the artifact'),
        })
        .optional()
        .describe(
          "The artifact with type 'text' created in validate_artifact tool",
        ),
    }),
    execute: async (params) => saveFn(params),
  });
