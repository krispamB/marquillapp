import { ArtifactType } from '../../database/schemas/artifact.schema';
import {
  formatResearchAbReport,
  parseResearchAbArgs,
  RESEARCH_AB_BRIEFS,
  type ResearchAbBrief,
  type ResearchFn,
  runResearchAb,
  summariseResearchAb,
} from './research-ab';

const BRIEFS: ResearchAbBrief[] = [
  { id: 'b1', type: ArtifactType.POST, prompt: 'brief one' },
  { id: 'b2', type: ArtifactType.DOCUMENT, prompt: 'brief two' },
];

// Each call to `now` advances the clock by 100 ms.
const clock = () => {
  let t = 0;
  return () => (t += 100);
};

describe('research A/B', () => {
  describe('RESEARCH_AB_BRIEFS', () => {
    it('should cover POST and DOCUMENT with unique ids', () => {
      const types = new Set(RESEARCH_AB_BRIEFS.map((b) => b.type));
      expect(types).toEqual(
        new Set([ArtifactType.POST, ArtifactType.DOCUMENT]),
      );
      const ids = RESEARCH_AB_BRIEFS.map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('runResearchAb', () => {
    it('should research every brief in every mode, alternating modes per brief', async () => {
      const research: ResearchFn = jest.fn((mode, input) =>
        Promise.resolve({ findings: `${mode}:${input.prompt}`, sources: [] }),
      );

      const records = await runResearchAb(
        research,
        { modes: ['agent', 'snippets'], repeat: 1, briefs: BRIEFS },
        clock(),
      );

      expect(records.map((r) => [r.briefId, r.mode])).toEqual([
        ['b1', 'agent'],
        ['b1', 'snippets'],
        ['b2', 'agent'],
        ['b2', 'snippets'],
      ]);
      expect(research).toHaveBeenCalledWith(
        'snippets',
        {
          prompt: 'brief two',
          type: ArtifactType.DOCUMENT,
          today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
        },
        expect.any(Object),
      );
    });

    it('should record latency, LLM calls, cost, searches, sources and findings', async () => {
      const research: ResearchFn = (_mode, _input, hooks) => {
        hooks.onUsage?.({
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          cost: 0.01,
          model: 'm',
        });
        hooks.onToolCall?.({ name: 'searchWeb' });
        hooks.onToolCall?.({ name: 'searchWeb' });
        return Promise.resolve({
          findings: 'abc',
          sources: [{ title: 't', url: 'u' }],
          mode: 'snippets',
        });
      };

      const [record] = await runResearchAb(
        research,
        { modes: ['snippets'], repeat: 1, briefs: [BRIEFS[0]] },
        clock(),
      );

      expect(record).toEqual({
        briefId: 'b1',
        type: ArtifactType.POST,
        mode: 'snippets',
        repeat: 1,
        ms: 100,
        llmCalls: 1,
        costUsd: 0.01,
        searches: 2,
        sources: 1,
        findingsChars: 3,
        findings: 'abc',
      });
    });

    it('should record a failed research and carry on', async () => {
      const research: ResearchFn = jest
        .fn()
        .mockRejectedValueOnce(new Error('upstream down'))
        .mockResolvedValue({ findings: 'ok', sources: [] });

      const records = await runResearchAb(
        research,
        { modes: ['agent'], repeat: 2, briefs: [BRIEFS[0]] },
        clock(),
      );

      expect(records).toHaveLength(2);
      expect(records[0].error).toBe('upstream down');
      expect(records[1]).not.toHaveProperty('error');
      expect(records[1].repeat).toBe(2);
    });
  });

  describe('summariseResearchAb', () => {
    it('should aggregate successful runs per mode and count failures', () => {
      const base = {
        briefId: 'b',
        type: ArtifactType.POST as const,
        repeat: 1,
        llmCalls: 1,
        costUsd: 0.5,
        searches: 2,
        sources: 4,
        findingsChars: 100,
        findings: '',
      };
      const summary = summariseResearchAb([
        { ...base, mode: 'agent', ms: 30_000 },
        { ...base, mode: 'agent', ms: 10_000 },
        { ...base, mode: 'agent', ms: 20_000 },
        { ...base, mode: 'snippets', ms: 4_000 },
        { ...base, mode: 'snippets', ms: 99_000, error: 'boom' },
      ]);

      expect(summary).toEqual([
        expect.objectContaining({
          mode: 'agent',
          runs: 3,
          failed: 0,
          medianMs: 20_000,
          maxMs: 30_000,
          totalCostUsd: 1.5,
        }),
        expect.objectContaining({
          mode: 'snippets',
          runs: 2,
          failed: 1,
          medianMs: 4_000,
          maxMs: 4_000,
          meanSources: 4,
          totalCostUsd: 1,
        }),
      ]);
    });
  });

  describe('formatResearchAbReport', () => {
    it('should list each run and a line per mode', () => {
      const report = formatResearchAbReport([
        {
          briefId: 'b1',
          type: ArtifactType.POST,
          mode: 'snippets',
          repeat: 1,
          ms: 3_400,
          llmCalls: 1,
          costUsd: 0.001,
          searches: 3,
          sources: 9,
          findingsChars: 5000,
          findings: '',
        },
      ]);

      expect(report).toContain('b1');
      expect(report).toContain('3.4s');
      expect(report).toContain('By mode:');
      expect(report).toContain('median 3.4s');
    });
  });

  describe('parseResearchAbArgs', () => {
    it('should default to both modes, one round and no JSON', () => {
      expect(parseResearchAbArgs([])).toEqual({
        modes: ['agent', 'snippets'],
        repeat: 1,
      });
    });

    it('should read --modes, --repeat and --json in either form', () => {
      expect(
        parseResearchAbArgs([
          '--modes=snippets',
          '--repeat',
          '3',
          '--json',
          'out.json',
        ]),
      ).toEqual({ modes: ['snippets'], repeat: 3, jsonPath: 'out.json' });
    });

    it.each([
      [['--modes', 'fast']],
      [['--repeat', '0']],
      [['--json']],
      [['--nope']],
    ])('should reject %p', (argv) => {
      expect(() => parseResearchAbArgs(argv)).toThrow();
    });
  });
});
