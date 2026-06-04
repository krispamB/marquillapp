import { tool } from 'ai';
import z from 'zod';
import { validateHtml, validateLinkedInPost } from '../utils';
import { validateLinkedInPoll } from '../utils/poll.util';

const validateArtifactInputSchema = z.object({
  type: z
    .enum(['html', 'text', 'structured'])
    .describe('The artifact type to validate.'),
  content: z
    .union([
      z.string(),
      z.object({
        question: z.string().describe('The poll question. Max 140 characters.'),
        options: z
          .array(z.string())
          .describe('The poll options. 2–4 items, each max 30 characters.'),
      }),
    ])
    .describe(
      'The artifact content. ' +
        'String for text (post) and html (document) types. ' +
        'Object with question and options for structured (poll) type.',
    ),
  format: z
    .enum(['one-pager', 'carousel'])
    .optional()
    .describe('The requested document format. Only applicable for html type.'),
});

export const createValidateArtifactTool = () =>
  tool({
    description:
      'Validate the artifact content you generated. ' +
      'Pass the content directly — do not call any other tool first. ' +
      'Returns a list of violations if any, or confirms the artifact is valid.',
    inputSchema: validateArtifactInputSchema,
    execute: async ({ type, content }) => {
      if (type === 'html') {
        return validateHtml(content as string);
      }

      if (type === 'text') {
        return validateLinkedInPost(content as string);
      }

      if (type === 'structured') {
        return validateLinkedInPoll(content as { question: string; options: string[] });
      }
    },
  });
