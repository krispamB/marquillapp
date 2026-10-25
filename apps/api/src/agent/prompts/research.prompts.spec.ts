// The prompt module reads `ArtifactType` through the `src/...` alias, which Jest
// does not resolve; only the enum is needed here.
jest.mock(
  'src/database/schemas',
  () => ({
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
  }),
  { virtual: true },
);

import { researchSystemPrompt, researchUserPrompt } from './research.prompts';

describe('research prompts', () => {
  describe('researchUserPrompt', () => {
    it('should open with the date and ask for current information when given the run date', () => {
      const prompt = researchUserPrompt({
        prompt: 'AI hiring trends',
        type: 'POST' as never,
        today: '2026-10-25',
      });

      expect(prompt.split('\n\n')[0]).toBe(
        'TODAY: 2026-10-25 (Sunday). Treat this date as the present: "this year" means 2026. Prefer the most recent figures, and do not present an earlier year as current.',
      );
      expect(prompt).toContain(
        'Search for the most recent information as of 2026-10-25',
      );
      expect(prompt).toContain('BRIEF:\nAI hiring trends');
    });
  });

  describe('researchSystemPrompt', () => {
    it('should tell the agent to search from the brief date when its training year differs', () => {
      expect(researchSystemPrompt()).toContain("The brief states TODAY's date");
    });
  });
});
