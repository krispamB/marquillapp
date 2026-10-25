// The real strategy drags the ESM-only OpenRouter SDK into the transform.
jest.mock('../../llm/llm.service', () => ({
  LLMService: class LLMService {},
}));

jest.mock(
  'src/database/schemas',
  () => ({
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
  }),
  { virtual: true },
);

jest.mock('@tavily/core', () => ({ tavily: () => ({ search: jest.fn() }) }), {
  virtual: true,
});

import { ArtifactType } from 'src/database/schemas';
import { ResponseParserService } from '../../llm/parsers/responseParser.service';
import {
  TEXT_EVAL_BRIEFS,
  createTextEvalDeps,
  formatTextEvalMarkdown,
  formatTextEvalReport,
  parseTextEvalArgs,
  percentile,
  runTextEval,
  selectBriefs,
  summarizeTextEval,
  type TextEvalDeps,
  type TextEvalRecord,
} from './index';

const record = (over: Partial<TextEvalRecord>): TextEvalRecord => ({
  model: 'a/base',
  type: ArtifactType.POST,
  briefId: 'post-1',
  prompt: 'p',
  ok: true,
  latencyMs: 1000,
  calls: 1,
  promptTokens: 100,
  completionTokens: 50,
  reasoningTokens: 10,
  totalTokens: 150,
  costUsd: 0.01,
  ...over,
});

describe('briefs', () => {
  it('should hold five unique briefs when grouped by type', () => {
    for (const type of [ArtifactType.POST, ArtifactType.POLL]) {
      expect(TEXT_EVAL_BRIEFS.filter((b) => b.type === type)).toHaveLength(5);
    }
    expect(new Set(TEXT_EVAL_BRIEFS.map((b) => b.id)).size).toBe(10);
  });

  it('should select the first n of each type when a count and types are given', () => {
    expect(
      selectBriefs([ArtifactType.POLL], 2).map((brief) => brief.id),
    ).toEqual(['poll-1', 'poll-2']);
  });
});

describe('parseTextEvalArgs', () => {
  it('should default to both types, all briefs and no models when no flags are given', () => {
    expect(parseTextEvalArgs([])).toMatchObject({
      models: [],
      types: ['POST', 'POLL'],
      concurrency: 2,
      briefsPerType: undefined,
    });
  });

  it('should read deduped models from --models when given and fall back to TEXT_EVAL_MODELS when not', () => {
    expect(parseTextEvalArgs(['--models', 'a/x, b/y,a/x']).models).toEqual([
      'a/x',
      'b/y',
    ]);
    expect(parseTextEvalArgs([], { TEXT_EVAL_MODELS: 'c/z' }).models).toEqual([
      'c/z',
    ]);
    expect(
      parseTextEvalArgs(['--models=a/x'], { TEXT_EVAL_MODELS: 'c/z' }).models,
    ).toEqual(['a/x']);
  });

  it('should parse the other flags when valid and reject them when not', () => {
    expect(
      parseTextEvalArgs(['--types=poll', '--briefs', '3', '--effort', 'low']),
    ).toMatchObject({ types: ['POLL'], briefsPerType: 3, effort: 'low' });
    expect(() => parseTextEvalArgs(['--types', 'DOCUMENT'])).toThrow('POST');
    expect(() => parseTextEvalArgs(['--effort', 'loud'])).toThrow('--effort');
    expect(() => parseTextEvalArgs(['--briefs', '0'])).toThrow('--briefs');
    expect(() => parseTextEvalArgs(['--nope'])).toThrow('Unknown argument');
  });
});

describe('summarizeTextEval', () => {
  it('should use nearest-rank percentiles when computing p50 and p90', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(percentile([], 0.5)).toBeNull();
  });

  it('should aggregate per model and type over successful runs when some fail', () => {
    const records = [
      record({ latencyMs: 1000, totalTokens: 100 }),
      record({ latencyMs: 3000, totalTokens: 300, calls: 2 }),
      record({ ok: false, latencyMs: 99000, totalTokens: 0 }),
      record({ model: 'b/fast', latencyMs: 500 }),
      record({ type: ArtifactType.POLL, briefId: 'poll-1' }),
    ];
    const [baseline, baselinePoll, fast] = (() => {
      const rows = summarizeTextEval(records, ['a/base', 'b/fast']);
      return [rows[0], rows[1], rows[2]];
    })();

    expect(baseline).toMatchObject({
      model: 'a/base',
      type: 'POST',
      runs: 3,
      failed: 1,
      repaired: 1,
      latencyMs: { p50: 1000, p90: 3000 },
      tokens: { total: 200 },
    });
    expect(baselinePoll).toMatchObject({ type: 'POLL', runs: 1 });
    expect(fast).toMatchObject({ model: 'b/fast', latencyMs: { p50: 500 } });
  });

  it('should report nulls when every run failed', () => {
    const [row] = summarizeTextEval([record({ ok: false })], ['a/base']);
    expect(row.latencyMs).toEqual({ p50: null, p90: null });
    expect(row.tokens.total).toBeNull();
  });
});

describe('runTextEval', () => {
  const fakeDeps = (): TextEvalDeps & { calls: string[] } => {
    const calls: string[] = [];
    let clock = 0;
    return {
      calls,
      now: () => (clock += 250),
      generate: (model, input, hooks) => {
        calls.push(`${model}:${input.type}`);
        if (model === 'bad/model') return Promise.reject(new Error('boom'));
        hooks.onUsage?.({
          model,
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          cost: 0.001,
          reasoningTokens: 2,
        });
        return Promise.resolve({
          title: 't',
          content: { commentary: 'c' },
        });
      },
    };
  };

  it('should run every brief on every model and record usage when some calls fail', async () => {
    const deps = fakeDeps();
    const result = await runTextEval(deps, {
      models: ['a/base', 'bad/model'],
      types: [ArtifactType.POST, ArtifactType.POLL],
      briefsPerType: 2,
      concurrency: 3,
    });

    expect(result.records).toHaveLength(8);
    expect(result.records.map((r) => r.model)).toEqual([
      ...Array<string>(4).fill('a/base'),
      ...Array<string>(4).fill('bad/model'),
    ]);
    expect(result.records[0]).toMatchObject({
      ok: true,
      calls: 1,
      totalTokens: 15,
      reasoningTokens: 2,
    });
    expect(result.records[4]).toMatchObject({
      ok: false,
      error: 'boom',
      calls: 0,
    });
  });

  it('should render the console report and side-by-side markdown when outputs are requested', async () => {
    const result = await runTextEval(fakeDeps(), {
      models: ['a/base', 'bad/model'],
      types: [ArtifactType.POST],
      briefsPerType: 1,
      concurrency: 1,
    });
    const report = formatTextEvalReport(result);
    expect(report).toContain('a/base');
    expect(report).toContain('FAILED bad/model post-1: boom');
    const markdown = formatTextEvalMarkdown(result);
    expect(markdown).toContain('### post-1 (POST)');
    expect(markdown).toContain('**a/base**');
    expect(markdown).toContain('FAILED: boom');
    expect(markdown).toContain('"commentary": "c"');
  });
});

describe('createTextEvalDeps', () => {
  it('should send the compared model to the completion call when generating POST and POLL', async () => {
    const complete = jest.fn().mockResolvedValue({
      text: JSON.stringify({ title: 'T', commentary: 'C' }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cost: 0 },
    });
    const base = {
      get: (key: string) =>
        ({ GENERATION_MODEL: 'prod/base', POST_GENERATION_MODEL: 'prod/post' })[
          key
        ],
    };
    const deps = createTextEvalDeps(
      { complete } as never,
      new ResponseParserService(),
      base as never,
    );

    await deps.generate(
      'cand/model',
      { type: ArtifactType.POST, prompt: 'x' },
      {},
      'low',
    );

    const calls = complete.mock.calls as unknown as Array<
      [unknown, unknown, Record<string, unknown>]
    >;
    const options = calls[0][2];
    expect(options.model).toBe('cand/model');
    expect(options.reasoningEffort).toBe('low');
  });
});
