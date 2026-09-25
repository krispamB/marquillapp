// The real strategy drags the ESM-only OpenRouter SDK into the transform.
jest.mock('../llm/llm.service', () => ({
  LLMService: class LLMService {},
}));

jest.mock(
  'src/database/schemas',
  () => ({
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
    CarouselTheme: {
      BOLD: 'bold',
      MINIMAL: 'minimal',
      EDITORIAL: 'editorial',
      GRADIENT: 'gradient',
    },
  }),
  { virtual: true },
);

// The research tests drive the real searchWeb tool; only Tavily's client is faked
// so no network call is made and each test controls the results it returns.
const tavilySearch = jest.fn();
jest.mock(
  '@tavily/core',
  () => ({ tavily: () => ({ search: tavilySearch }) }),
  { virtual: true },
);

import { ArtifactType, CarouselTheme } from 'src/database/schemas';
import { z } from 'zod';
import { LLMError } from '../llm/errors';
import { LLMProvider, MessageRole } from '../llm/interfaces';
import type {
  CompletionOptions,
  CompletionResult,
  LLMMessage,
  ToolTurnResult,
  Usage,
} from '../llm/interfaces';
import { ResponseParserService } from '../llm/parsers/responseParser.service';
import { ContentValidationError } from './agent-runner.error';
import { AgentRunnerService } from './agent-runner.service';
import type {
  AgentRunConfig,
  GenerateInput,
  Tool,
} from './agent-runner.interface';
import { StylePreset } from './style-presets.config';

const GENERATION_MODEL = 'test/generation-model';
const RESEARCH_MODEL = 'test/research-model';
const TAVILY_API_KEY = 'test/tavily-key';
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

const CONFIG: Record<string, string> = {
  GENERATION_MODEL,
  RESEARCH_MODEL,
  TAVILY_API_KEY,
};

const usage = (cost = 0.02): Usage => ({
  promptTokens: 100,
  completionTokens: 50,
  totalTokens: 150,
  cost,
});

const completion = (text: string, cost = 0.02): CompletionResult => ({
  text,
  usage: usage(cost),
});

const generatedJson = (
  content: Record<string, unknown>,
  title = 'Artifact title',
): string => JSON.stringify({ title, ...content });

const toolTurn = (
  toolCalls: ToolTurnResult['toolCalls'],
  cost = 0.02,
  text?: string,
): ToolTurnResult => ({
  ...(text ? { text } : {}),
  toolCalls,
  usage: usage(cost),
});

interface ServiceConfig {
  maxSteps?: number;
  maxSuccessfulSearches?: number;
  researchMaxOutputTokens?: string | number;
  generationMaxOutputTokens?: string | number;
}

const makeService = ({
  maxSteps,
  maxSuccessfulSearches,
  researchMaxOutputTokens,
  generationMaxOutputTokens,
}: ServiceConfig = {}) => {
  const llmService = { complete: jest.fn(), completeWithTools: jest.fn() };
  const configService = {
    getOrThrow: jest.fn((key: string) => CONFIG[key]),
    get: jest.fn((key: string) => {
      if (key === 'RESEARCH_MAX_STEPS') return maxSteps;
      if (key === 'RESEARCH_MAX_SUCCESSFUL_SEARCHES') {
        return maxSuccessfulSearches;
      }
      if (key === 'RESEARCH_MAX_OUTPUT_TOKENS') {
        return researchMaxOutputTokens;
      }
      if (key === 'GENERATION_MAX_OUTPUT_TOKENS') {
        return generationMaxOutputTokens;
      }
      return undefined;
    }),
  };

  // The real parser: this suite's whole subject is what happens when the model's
  // text does or does not satisfy the schema, so stubbing it out would test nothing.
  const service = new AgentRunnerService(
    llmService as any,
    new ResponseParserService(),
    configService as any,
  );

  const input: GenerateInput = {
    type: ArtifactType.POST,
    prompt: 'Why staff engineers should write more',
  };

  return { service, mocks: { llmService, configService }, fixtures: { input } };
};

let service: AgentRunnerService;
let mocks: ReturnType<typeof makeService>['mocks'];
let fixtures: ReturnType<typeof makeService>['fixtures'];

type CompleteCall = [LLMProvider, LLMMessage[], CompletionOptions | undefined];
type CompleteWithToolsCall = [
  LLMProvider,
  LLMMessage[],
  unknown[],
  CompletionOptions | undefined,
];

const completeCalls = (): CompleteCall[] =>
  mocks.llmService.complete.mock.calls as unknown as CompleteCall[];

const completeWithToolsCalls = (): CompleteWithToolsCall[] =>
  mocks.llmService.completeWithTools.mock
    .calls as unknown as CompleteWithToolsCall[];

/** The messages passed to `llmService.complete` on its nth (1-based) call. */
const messagesOfCall = (n: number): LLMMessage[] => completeCalls()[n - 1][1];

const expectGenerationOptions = (
  options: CompletionOptions | undefined,
  maxTokens = DEFAULT_MAX_OUTPUT_TOKENS,
): void => {
  expect(options?.model).toBe(GENERATION_MODEL);
  expect(options?.max_tokens).toBe(maxTokens);
  expect(options?.responseSchema?.name).toBe('artifact_generation');
  expect(options?.responseSchema?.schema).toBeInstanceOf(z.ZodType);
};

beforeEach(() => {
  jest.clearAllMocks();
  ({ service, mocks, fixtures } = makeService());
});

describe('AgentRunnerService', () => {
  describe('generate', () => {
    it('should return parsed content when the first completion is valid', async () => {
      mocks.llmService.complete.mockResolvedValue(
        completion(
          '{"title":"Why Staff Engineers Should Write","commentary":"Write more."}',
        ),
      );

      await expect(service.generate(fixtures.input)).resolves.toEqual({
        title: 'Why Staff Engineers Should Write',
        content: { commentary: 'Write more.' },
      });
      expect(mocks.llmService.complete).toHaveBeenCalledTimes(1);
    });

    it('should trim the generated title when it has surrounding whitespace', async () => {
      mocks.llmService.complete.mockResolvedValue(
        completion(generatedJson({ commentary: 'Write more.' }, '  A title  ')),
      );

      await expect(service.generate(fixtures.input)).resolves.toMatchObject({
        title: 'A title',
      });
    });

    it.each(['   ', 'x'.repeat(101)])(
      'should repair and fail when the generated title remains invalid',
      async (title) => {
        mocks.llmService.complete.mockResolvedValue(
          completion(generatedJson({ commentary: 'Write more.' }, title)),
        );

        await expect(service.generate(fixtures.input)).rejects.toBeInstanceOf(
          ContentValidationError,
        );
        expect(mocks.llmService.complete).toHaveBeenCalledTimes(2);
      },
    );

    it('should call the configured GENERATION_MODEL through the OpenRouter provider', async () => {
      mocks.llmService.complete.mockResolvedValue(
        completion(generatedJson({ commentary: 'Write more.' })),
      );

      await service.generate(fixtures.input);

      const [provider, , options] = completeCalls()[0];
      expect(provider).toBe(LLMProvider.OPENROUTER);
      expectGenerationOptions(options);
    });

    it('should cap generation with GENERATION_MAX_OUTPUT_TOKENS', async () => {
      ({ service, mocks, fixtures } = makeService({
        generationMaxOutputTokens: 4096,
      }));
      mocks.llmService.complete.mockResolvedValue(
        completion(generatedJson({ commentary: 'Write more.' })),
      );

      await service.generate(fixtures.input);

      expectGenerationOptions(completeCalls()[0][2], 4096);
    });

    it('should strip markdown fences before validating', async () => {
      mocks.llmService.complete.mockResolvedValue(
        completion(
          `\`\`\`json\n${generatedJson({ commentary: 'Fenced.' })}\n\`\`\``,
        ),
      );

      await expect(service.generate(fixtures.input)).resolves.toEqual({
        title: 'Artifact title',
        content: { commentary: 'Fenced.' },
      });
    });

    it('should inject the style preset instruction as voice when one is supplied', async () => {
      mocks.llmService.complete.mockResolvedValue(
        completion(generatedJson({ commentary: 'Bold take.' })),
      );

      await service.generate({
        ...fixtures.input,
        stylePreset: StylePreset.CONTRARIAN,
      });

      const [, user] = messagesOfCall(1);
      expect(user.content).toContain('VOICE:');
      expect(user.content).toContain('Challenge a common assumption');
    });

    it('should omit the voice section when no style preset is supplied', async () => {
      mocks.llmService.complete.mockResolvedValue(
        completion(generatedJson({ commentary: 'Plain.' })),
      );

      await service.generate(fixtures.input);

      const [system, user] = messagesOfCall(1);
      expect(system.role).toBe(MessageRole.System);
      expect(user.content).not.toContain('VOICE:');
    });

    it('should pass research findings and sources into the brief when present', async () => {
      mocks.llmService.complete.mockResolvedValue(
        completion(generatedJson({ commentary: 'Researched.' })),
      );

      await service.generate({
        ...fixtures.input,
        research: {
          findings: 'Staff engineers who write get promoted.',
          sources: [{ title: 'StaffEng', url: 'https://staffeng.com' }],
        },
      });

      const [, user] = messagesOfCall(1);
      expect(user.content).toContain('Staff engineers who write get promoted.');
      expect(user.content).toContain('https://staffeng.com');
    });

    it('should pass the prior content and feedback into the brief on a refine', async () => {
      mocks.llmService.complete.mockResolvedValue(
        completion('{"commentary":"Revised."}'),
      );

      const generated = await service.generate({
        ...fixtures.input,
        refine: {
          priorContent: { commentary: 'The old post.' },
          feedback: 'Make the hook sharper.',
        },
      });

      const [, user] = messagesOfCall(1);
      expect(user.content).toContain('The old post.');
      expect(user.content).toContain('Make the hook sharper.');
      expect(messagesOfCall(1)[0].content).not.toContain('TITLE:');
      expect(generated).toEqual({ content: { commentary: 'Revised.' } });
      expectGenerationOptions(completeCalls()[0][2]);
    });

    it('should report usage per LLM turn, tagged with the model', async () => {
      mocks.llmService.complete.mockResolvedValue(
        completion(generatedJson({ commentary: 'Write more.' }), 0.031),
      );
      const onUsage = jest.fn();

      await service.generate(fixtures.input, { onUsage });

      expect(onUsage).toHaveBeenCalledTimes(1);
      expect(onUsage).toHaveBeenCalledWith({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cost: 0.031,
        model: GENERATION_MODEL,
      });
    });

    it('should return a title and typed content when initially generating a poll', async () => {
      mocks.llmService.complete.mockResolvedValue(
        completion(
          generatedJson(
            {
              poll: {
                question: 'Which approach works best?',
                options: ['A', 'B'],
                durationDays: 7,
              },
            },
            'Choosing an approach',
          ),
        ),
      );

      await expect(
        service.generate({ ...fixtures.input, type: ArtifactType.POLL }),
      ).resolves.toMatchObject({
        title: 'Choosing an approach',
        content: { poll: { durationDays: 7 } },
      });
    });

    describe('the inline repair retry', () => {
      it('should re-prompt with the validation error and return the repaired content', async () => {
        mocks.llmService.complete
          .mockResolvedValueOnce(completion(generatedJson({ commentary: '' })))
          .mockResolvedValueOnce(
            completion(generatedJson({ commentary: 'Repaired.' })),
          );

        await expect(service.generate(fixtures.input)).resolves.toEqual({
          title: 'Artifact title',
          content: { commentary: 'Repaired.' },
        });
        expect(mocks.llmService.complete).toHaveBeenCalledTimes(2);
        expect(completeCalls()[1][0]).toBe(LLMProvider.OPENROUTER);
        expectGenerationOptions(completeCalls()[1][2]);

        const repair = messagesOfCall(2);
        expect(repair).toHaveLength(4);
        expect(repair[2]).toEqual({
          role: MessageRole.Assistant,
          content: generatedJson({ commentary: '' }),
        });
        expect(repair[3].role).toBe(MessageRole.User);
        expect(repair[3].content).toContain('commentary must not be empty');
      });

      it('should repair a response that is not JSON at all', async () => {
        mocks.llmService.complete
          .mockResolvedValueOnce(completion('I cannot do that.'))
          .mockResolvedValueOnce(
            completion(generatedJson({ commentary: 'Fine, here.' })),
          );

        await expect(service.generate(fixtures.input)).resolves.toEqual({
          title: 'Artifact title',
          content: { commentary: 'Fine, here.' },
        });
      });

      it('should charge usage for the repair turn too', async () => {
        mocks.llmService.complete
          .mockResolvedValueOnce(
            completion(generatedJson({ commentary: '' }), 0.01),
          )
          .mockResolvedValueOnce(
            completion(generatedJson({ commentary: 'Repaired.' }), 0.02),
          );
        const onUsage = jest.fn();

        await service.generate(fixtures.input, { onUsage });

        expect(onUsage).toHaveBeenCalledTimes(2);
        expect(onUsage).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({ cost: 0.02 }),
        );
      });

      it('should throw ContentValidationError when the repair is also invalid', async () => {
        mocks.llmService.complete.mockResolvedValue(
          completion(generatedJson({ commentary: '' })),
        );

        await expect(service.generate(fixtures.input)).rejects.toBeInstanceOf(
          ContentValidationError,
        );
        expect(mocks.llmService.complete).toHaveBeenCalledTimes(2);
      });

      it('should not attempt a second repair', async () => {
        mocks.llmService.complete.mockResolvedValue(completion('not json'));

        await expect(service.generate(fixtures.input)).rejects.toBeInstanceOf(
          ContentValidationError,
        );
        expect(mocks.llmService.complete).toHaveBeenCalledTimes(2);
      });
    });

    it('should let an LLM transport error through unchanged, so the engine can classify it', async () => {
      const transportError = new LLMError('rate limited', {
        retryable: true,
        statusCode: 429,
      });
      mocks.llmService.complete.mockRejectedValue(transportError);

      await expect(service.generate(fixtures.input)).rejects.toBe(
        transportError,
      );
      expect(mocks.llmService.complete).toHaveBeenCalledTimes(1);
    });

    it('should let an LLM transport error during the repair turn through unchanged', async () => {
      const transportError = new LLMError('gateway down', { retryable: true });
      mocks.llmService.complete
        .mockResolvedValueOnce(completion('{"commentary":""}'))
        .mockRejectedValueOnce(transportError);

      await expect(service.generate(fixtures.input)).rejects.toBe(
        transportError,
      );
    });

    describe('DOCUMENT generation', () => {
      // A valid slides-only deck the model returns; templateId varies per test.
      const deckJson = (templateId: string) =>
        generatedJson({
          document: {
            templateId,
            slides: [
              { type: 'cover', fields: { title: 'A carousel' } },
              { type: 'content', fields: { heading: 'One', body: 'A point' } },
            ],
          },
        });

      const documentInput: GenerateInput = {
        type: ArtifactType.DOCUMENT,
        prompt: 'A carousel on staff engineering',
      };

      it('should parse and return the document deck the model produces', async () => {
        mocks.llmService.complete.mockResolvedValue(
          completion(deckJson('editorial')),
        );

        const generated = await service.generate(documentInput);

        expect(generated).toMatchObject({
          title: 'Artifact title',
          content: { document: { templateId: 'editorial' } },
        });
        expect(mocks.llmService.complete).toHaveBeenCalledTimes(1);
      });

      it('should constrain both attempts when repairing over-limit slide copy', async () => {
        const overLimitDeck = generatedJson({
          document: {
            templateId: 'minimal',
            slides: [
              { type: 'cover', fields: { title: 'A carousel' } },
              {
                type: 'list',
                fields: {
                  heading: 'Three ideas',
                  items: [
                    'Valid item',
                    'a'.repeat(81),
                    'b'.repeat(81),
                    'c'.repeat(81),
                  ],
                },
              },
              {
                type: 'cta',
                fields: {
                  headline: 'Keep learning',
                  action: 'Follow',
                  handle: 'h'.repeat(41),
                },
              },
            ],
          },
        });
        mocks.llmService.complete
          .mockResolvedValueOnce(completion(overLimitDeck))
          .mockResolvedValueOnce(completion(deckJson('minimal')));

        await expect(service.generate(documentInput)).resolves.toMatchObject({
          content: { document: { templateId: 'minimal' } },
        });

        expect(mocks.llmService.complete).toHaveBeenCalledTimes(2);
        for (const [, , options] of completeCalls()) {
          expectGenerationOptions(options);
        }
        const repairPrompt = messagesOfCall(2).at(-1)?.content ?? '';
        expect(repairPrompt).toContain('maximum');
        expect(repairPrompt).toContain('80');
        expect(repairPrompt).toContain('40');
      });

      it('should keep the model-chosen theme when the user supplied none', async () => {
        mocks.llmService.complete.mockResolvedValue(
          completion(deckJson('gradient')),
        );

        const generated = await service.generate(documentInput);

        expect(generated.content).toMatchObject({
          document: { templateId: 'gradient' },
        });
      });

      it('should remove provider null placeholders from optional document fields', async () => {
        mocks.llmService.complete.mockResolvedValue(
          completion(
            generatedJson({
              commentary: null,
              document: {
                templateId: 'minimal',
                slides: [
                  {
                    type: 'cover',
                    fields: {
                      eyebrow: null,
                      title: 'A carousel',
                      subtitle: null,
                    },
                  },
                  {
                    type: 'cta',
                    fields: {
                      headline: 'Keep learning',
                      action: 'Follow',
                      handle: null,
                    },
                  },
                ],
              },
            }),
          ),
        );

        await expect(service.generate(documentInput)).resolves.toEqual({
          title: 'Artifact title',
          content: {
            document: {
              templateId: 'minimal',
              slides: [
                { type: 'cover', fields: { title: 'A carousel' } },
                {
                  type: 'cta',
                  fields: {
                    headline: 'Keep learning',
                    action: 'Follow',
                  },
                },
              ],
            },
          },
        });
      });

      it('should stamp the user-supplied theme over a different one the model picked', async () => {
        // The model tries to pick "bold"; the user asked for "minimal".
        mocks.llmService.complete.mockResolvedValue(
          completion(deckJson('bold')),
        );

        const generated = await service.generate({
          ...documentInput,
          theme: CarouselTheme.MINIMAL,
        });

        expect(generated.content).toMatchObject({
          document: { templateId: 'minimal' },
        });
      });

      it('should instruct the model to use the stamped theme in the user prompt', async () => {
        mocks.llmService.complete.mockResolvedValue(
          completion(deckJson('minimal')),
        );

        await service.generate({
          ...documentInput,
          theme: CarouselTheme.MINIMAL,
        });

        const [, user] = messagesOfCall(1);
        expect(user.content).toContain('THEME:');
        expect(user.content).toContain('minimal');
      });
    });
  });

  describe('the tool loop (run)', () => {
    // A minimal echo tool the model can "call"; each spec controls its output.
    const makeTool = (
      execute: (input: { q: string }) => Promise<unknown>,
      name = 'echo',
    ): Tool<{ q: string }> => ({
      name,
      description: 'echo',
      parameters: z.object({ q: z.string() }),
      execute,
    });

    const configWith = (tool: Tool, maxSteps = 3): AgentRunConfig => ({
      system: 'You are a test agent.',
      messages: [{ role: MessageRole.User, content: 'go' }],
      tools: [tool],
      maxSteps,
      model: RESEARCH_MODEL,
    });

    it('should return the text of the first tool-free turn without running tools', async () => {
      const execute = jest.fn();
      mocks.llmService.completeWithTools.mockResolvedValueOnce(
        toolTurn([], 0.01, 'Nothing to look up.'),
      );

      const result = await service.run(configWith(makeTool(execute)));

      expect(result.text).toBe('Nothing to look up.');
      expect(result.steps).toHaveLength(0);
      expect(execute).not.toHaveBeenCalled();
      expect(mocks.llmService.completeWithTools).toHaveBeenCalledTimes(1);
    });

    it('should execute a tool, feed its result back, and finish on the next turn', async () => {
      const execute = jest.fn().mockResolvedValue({ answer: 42 });
      mocks.llmService.completeWithTools
        .mockResolvedValueOnce(
          toolTurn([{ id: 'c1', name: 'echo', input: { q: 'life' } }]),
        )
        .mockResolvedValueOnce(toolTurn([], 0.01, 'The answer is 42.'));

      const result = await service.run(configWith(makeTool(execute)));

      expect(execute).toHaveBeenCalledWith({ q: 'life' });
      expect(result.text).toBe('The answer is 42.');
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].toolResults).toEqual([{ answer: 42 }]);

      // The tool output is fed back as a role:'tool' message on the 2nd turn.
      const secondTurnMessages = completeWithToolsCalls()[1][1];
      const toolMessage = secondTurnMessages.find(
        (m) => m.role === MessageRole.Tool,
      );
      expect(toolMessage).toMatchObject({
        role: MessageRole.Tool,
        content: JSON.stringify({ answer: 42 }),
        toolCallId: 'c1',
      });
    });

    it('should run all tool calls of a single turn in parallel', async () => {
      let running = 0;
      let maxConcurrent = 0;
      const execute = jest.fn(async () => {
        running += 1;
        maxConcurrent = Math.max(maxConcurrent, running);
        await new Promise((r) => setImmediate(r));
        running -= 1;
        return { ok: true };
      });

      mocks.llmService.completeWithTools
        .mockResolvedValueOnce(
          toolTurn([
            { id: 'a', name: 'echo', input: { q: '1' } },
            { id: 'b', name: 'echo', input: { q: '2' } },
            { id: 'c', name: 'echo', input: { q: '3' } },
          ]),
        )
        .mockResolvedValueOnce(toolTurn([], 0.01, 'done'));

      await service.run(configWith(makeTool(execute)));

      expect(execute).toHaveBeenCalledTimes(3);
      expect(maxConcurrent).toBe(3);
    });

    it('should absorb a throwing tool as an { error } result and let the model adapt', async () => {
      const execute = jest.fn().mockRejectedValue(new Error('Tavily is down'));
      mocks.llmService.completeWithTools
        .mockResolvedValueOnce(
          toolTurn([{ id: 'c1', name: 'echo', input: { q: 'x' } }]),
        )
        .mockResolvedValueOnce(toolTurn([], 0.01, 'Adapted.'));

      const result = await service.run(configWith(makeTool(execute)));

      expect(result.text).toBe('Adapted.');
      expect(result.steps[0].toolResults).toEqual([
        { error: 'Tavily is down' },
      ]);
    });

    it('should absorb an unknown tool name rather than throwing', async () => {
      mocks.llmService.completeWithTools
        .mockResolvedValueOnce(
          toolTurn([{ id: 'c1', name: 'nope', input: {} }]),
        )
        .mockResolvedValueOnce(toolTurn([], 0.01, 'ok'));

      const result = await service.run(configWith(makeTool(jest.fn())));

      expect(result.steps[0].toolResults).toEqual([
        { error: 'Unknown tool "nope"' },
      ]);
    });

    it('should make one tools-free finalization when maxSteps is hit with the model still calling tools', async () => {
      const execute = jest.fn().mockResolvedValue({ ok: true });
      // Every tool turn keeps asking for a tool: the loop never breaks on its own.
      mocks.llmService.completeWithTools.mockResolvedValue(
        toolTurn([{ id: 'c', name: 'echo', input: { q: 'again' } }]),
      );
      mocks.llmService.complete.mockResolvedValue(
        completion('Budget spent; here is what I have.'),
      );

      const result = await service.run(configWith(makeTool(execute), 2));

      // maxSteps tool turns + exactly one tools-free completion.
      expect(mocks.llmService.completeWithTools).toHaveBeenCalledTimes(2);
      expect(mocks.llmService.complete).toHaveBeenCalledTimes(1);
      expect(result.text).toBe('Budget spent; here is what I have.');
      expect(result.steps).toHaveLength(2);

      // The finalization turn is passed no tools.
      const [, , finalOptions] = completeCalls()[0];
      expect(finalOptions).toEqual({
        model: RESEARCH_MODEL,
        max_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
      });
    });

    it('should accumulate usage across every turn including finalization', async () => {
      const execute = jest.fn().mockResolvedValue({ ok: true });
      mocks.llmService.completeWithTools.mockResolvedValue(
        toolTurn([{ id: 'c', name: 'echo', input: { q: 'x' } }], 0.03),
      );
      mocks.llmService.complete.mockResolvedValue(completion('final', 0.04));

      const result = await service.run(configWith(makeTool(execute), 2));

      // 0.03 + 0.03 (two tool turns) + 0.04 (finalization).
      expect(result.usage.cost).toBeCloseTo(0.1);
    });

    it('should invoke onUsage per LLM turn and onToolCall per tool', async () => {
      const execute = jest.fn().mockResolvedValue({ ok: true });
      mocks.llmService.completeWithTools
        .mockResolvedValueOnce(
          toolTurn([{ id: 'c1', name: 'echo', input: { q: 'x' } }]),
        )
        .mockResolvedValueOnce(toolTurn([], 0.01, 'done'));
      const onUsage = jest.fn();
      const onToolCall = jest.fn();

      await service.run(configWith(makeTool(execute)), {
        onUsage,
        onToolCall,
      });

      expect(onUsage).toHaveBeenCalledTimes(2);
      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({ model: RESEARCH_MODEL }),
      );
      expect(onToolCall).toHaveBeenCalledTimes(1);
      expect(onToolCall).toHaveBeenCalledWith({ name: 'echo' });
    });

    it('should not invoke onToolCall for a call that comes back as an error', async () => {
      // The step bridges onToolCall to the web_search surcharge, so an absorbed
      // outage must not bill the user for a search that returned nothing.
      const execute = jest.fn().mockRejectedValue(new Error('down'));
      mocks.llmService.completeWithTools
        .mockResolvedValueOnce(
          toolTurn([{ id: 'c1', name: 'echo', input: { q: 'x' } }]),
        )
        .mockResolvedValueOnce(toolTurn([], 0.01, 'adapted'));
      const onToolCall = jest.fn();

      await service.run(configWith(makeTool(execute)), { onToolCall });

      expect(onToolCall).not.toHaveBeenCalled();
    });

    it('should not invoke onToolCall for an unknown tool', async () => {
      mocks.llmService.completeWithTools
        .mockResolvedValueOnce(
          toolTurn([{ id: 'c1', name: 'nope', input: {} }]),
        )
        .mockResolvedValueOnce(toolTurn([], 0.01, 'ok'));
      const onToolCall = jest.fn();

      await service.run(configWith(makeTool(jest.fn())), { onToolCall });

      expect(onToolCall).not.toHaveBeenCalled();
    });
  });

  describe('research', () => {
    // Shapes a Tavily response the mocked client returns for one search.
    const tavilyResults = (sources: Array<{ title: string; url: string }>) => ({
      results: sources.map((s) => ({ ...s, content: 'snippet', score: 1 })),
    });

    it('should reduce the run to findings (the final synthesis) and deduped sources', async () => {
      tavilySearch.mockResolvedValue(
        tavilyResults([
          { title: 'A', url: 'https://a.com' },
          { title: 'B', url: 'https://b.com' },
        ]),
      );
      mocks.llmService.completeWithTools
        .mockResolvedValueOnce(
          toolTurn([{ id: 'c1', name: 'searchWeb', input: { query: 'x' } }]),
        )
        .mockResolvedValueOnce(toolTurn([], 0.01, 'Synthesized findings.'));

      const result = await service.research({
        prompt: 'topic',
        type: ArtifactType.POST,
      });

      expect(result.findings).toBe('Synthesized findings.');
      expect(result.sources).toEqual([
        { title: 'A', url: 'https://a.com' },
        { title: 'B', url: 'https://b.com' },
      ]);
    });

    it('should dedupe sources by url across multiple searches, keeping the first title', async () => {
      tavilySearch
        .mockResolvedValueOnce(
          tavilyResults([{ title: 'First', url: 'https://dup.com' }]),
        )
        .mockResolvedValueOnce(
          tavilyResults([
            { title: 'Second', url: 'https://dup.com' },
            { title: 'New', url: 'https://new.com' },
          ]),
        );
      mocks.llmService.completeWithTools
        .mockResolvedValueOnce(
          toolTurn([{ id: 'c1', name: 'searchWeb', input: { query: 'q1' } }]),
        )
        .mockResolvedValueOnce(
          toolTurn([{ id: 'c2', name: 'searchWeb', input: { query: 'q2' } }]),
        )
        .mockResolvedValueOnce(toolTurn([], 0.01, 'findings'));

      const result = await service.research({
        prompt: 'topic',
        type: ArtifactType.POST,
      });

      expect(result.sources).toEqual([
        { title: 'First', url: 'https://dup.com' },
        { title: 'New', url: 'https://new.com' },
      ]);
    });

    it('should absorb a Tavily outage in-loop rather than failing the run', async () => {
      tavilySearch.mockRejectedValue(new Error('Tavily unavailable'));
      mocks.llmService.completeWithTools
        .mockResolvedValueOnce(
          toolTurn([{ id: 'c1', name: 'searchWeb', input: { query: 'x' } }]),
        )
        .mockResolvedValueOnce(toolTurn([], 0.01, 'Answered without sources.'));

      const result = await service.research({
        prompt: 'topic',
        type: ArtifactType.POST,
      });

      // The failed search yields no usable results, so no sources survive, but the
      // run still completes on the model's adapted final answer.
      expect(result.findings).toBe('Answered without sources.');
      expect(result.sources).toEqual([]);
    });

    it('should execute at most five successful Tavily lookups across multi-call turns', async () => {
      tavilySearch.mockResolvedValue(tavilyResults([]));
      const calls = Array.from({ length: 7 }, (_, index) => ({
        id: `c${index + 1}`,
        name: 'searchWeb',
        input: { query: `q${index + 1}` },
      }));
      mocks.llmService.completeWithTools
        .mockResolvedValueOnce(toolTurn(calls))
        .mockResolvedValueOnce(toolTurn([], 0.01, 'findings'));
      const onToolCall = jest.fn();

      await service.research(
        { prompt: 'topic', type: ArtifactType.POST },
        { onToolCall },
      );

      expect(tavilySearch).toHaveBeenCalledTimes(5);
      expect(onToolCall).toHaveBeenCalledTimes(5);
    });

    it('should clamp configured successful Tavily lookups to the five-search safety ceiling', async () => {
      ({ service, mocks, fixtures } = makeService({
        maxSuccessfulSearches: 6,
      }));
      tavilySearch.mockResolvedValue(tavilyResults([]));
      const calls = Array.from({ length: 6 }, (_, index) => ({
        id: `c${index + 1}`,
        name: 'searchWeb',
        input: { query: `q${index + 1}` },
      }));
      mocks.llmService.completeWithTools
        .mockResolvedValueOnce(toolTurn(calls))
        .mockResolvedValueOnce(toolTurn([], 0.01, 'findings'));

      await service.research({ prompt: 'topic', type: ArtifactType.POST });

      expect(tavilySearch).toHaveBeenCalledTimes(5);
    });

    it('should not consume the five-lookup cap when Tavily fails', async () => {
      tavilySearch
        .mockRejectedValueOnce(new Error('Tavily unavailable'))
        .mockResolvedValue(tavilyResults([]));
      const calls = Array.from({ length: 6 }, (_, index) => ({
        id: `c${index + 1}`,
        name: 'searchWeb',
        input: { query: `q${index + 1}` },
      }));
      mocks.llmService.completeWithTools
        .mockResolvedValueOnce(toolTurn(calls))
        .mockResolvedValueOnce(toolTurn([], 0.01, 'findings'));
      const onToolCall = jest.fn();

      await service.research(
        { prompt: 'topic', type: ArtifactType.POST },
        { onToolCall },
      );

      expect(tavilySearch).toHaveBeenCalledTimes(6);
      expect(onToolCall).toHaveBeenCalledTimes(5);
    });

    it('should keep the five-lookup cap across research turns', async () => {
      tavilySearch.mockResolvedValue(tavilyResults([]));
      const calls = (prefix: string) =>
        Array.from({ length: 3 }, (_, index) => ({
          id: `${prefix}${index + 1}`,
          name: 'searchWeb',
          input: { query: `${prefix}${index + 1}` },
        }));
      mocks.llmService.completeWithTools
        .mockResolvedValueOnce(toolTurn(calls('a')))
        .mockResolvedValueOnce(toolTurn(calls('b')))
        .mockResolvedValueOnce(toolTurn([], 0.01, 'findings'));

      await service.research({ prompt: 'topic', type: ArtifactType.POST });

      expect(tavilySearch).toHaveBeenCalledTimes(5);
    });

    it('should drive the loop with RESEARCH_MODEL and the searchWeb tool', async () => {
      mocks.llmService.completeWithTools.mockResolvedValueOnce(
        toolTurn([], 0.01, 'no search needed'),
      );

      await service.research({ prompt: 'topic', type: ArtifactType.POST });

      const [, , tools, options] = completeWithToolsCalls()[0];
      expect(options).toEqual({
        model: RESEARCH_MODEL,
        max_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
      });
      expect(tools).toEqual([expect.objectContaining({ name: 'searchWeb' })]);
    });

    it('should cap every research turn with RESEARCH_MAX_OUTPUT_TOKENS', async () => {
      ({ service, mocks, fixtures } = makeService({
        maxSteps: 2,
        researchMaxOutputTokens: 4096,
      }));
      tavilySearch.mockResolvedValue(tavilyResults([]));
      mocks.llmService.completeWithTools.mockResolvedValue(
        toolTurn([{ id: 'c', name: 'searchWeb', input: { query: 'x' } }]),
      );
      mocks.llmService.complete.mockResolvedValue(
        completion('forced synthesis'),
      );

      await service.research({
        prompt: 'topic',
        type: ArtifactType.POST,
      });

      for (const call of completeWithToolsCalls()) {
        expect(call[3]).toEqual({
          model: RESEARCH_MODEL,
          max_tokens: 4096,
        });
      }
      expect(completeCalls()[0][2]).toEqual({
        model: RESEARCH_MODEL,
        max_tokens: 4096,
      });
    });

    it('should stop at RESEARCH_MAX_STEPS and finalize when the model keeps searching', async () => {
      ({ service, mocks, fixtures } = makeService({ maxSteps: 2 }));
      tavilySearch.mockResolvedValue(tavilyResults([]));
      mocks.llmService.completeWithTools.mockResolvedValue(
        toolTurn([{ id: 'c', name: 'searchWeb', input: { query: 'x' } }]),
      );
      mocks.llmService.complete.mockResolvedValue(
        completion('forced synthesis'),
      );

      const result = await service.research({
        prompt: 'topic',
        type: ArtifactType.POST,
      });

      expect(mocks.llmService.completeWithTools).toHaveBeenCalledTimes(2);
      expect(result.findings).toBe('forced synthesis');
    });
  });

  describe('output-token configuration', () => {
    it.each([undefined, '', 0, -1, 1.5, 'not-a-number'])(
      'should fall back to 8192 when output-token settings are invalid (%p)',
      async (configuredValue) => {
        ({ service, mocks, fixtures } = makeService({
          researchMaxOutputTokens: configuredValue,
          generationMaxOutputTokens: configuredValue,
        }));
        mocks.llmService.complete.mockResolvedValue(
          completion(generatedJson({ commentary: 'Generated.' })),
        );
        mocks.llmService.completeWithTools.mockResolvedValue(
          toolTurn([], 0.01, 'Researched.'),
        );

        await service.generate(fixtures.input);
        await service.research({
          prompt: 'topic',
          type: ArtifactType.POST,
        });

        expectGenerationOptions(completeCalls()[0][2]);
        expect(completeWithToolsCalls()[0][3]).toEqual({
          model: RESEARCH_MODEL,
          max_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
        });
      },
    );
  });
});
