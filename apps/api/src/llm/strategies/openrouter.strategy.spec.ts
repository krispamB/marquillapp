import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { LLMError } from '../errors';
import { LLMMessage, MessageRole, ToolDefinition } from '../interfaces';

const send = jest.fn();
const OpenRouterClient = jest.fn<{ chat: { send: jest.Mock } }, [unknown]>(
  () => ({ chat: { send } }),
);

jest.mock(
  '@openrouter/sdk',
  () => ({
    OpenRouter: jest.fn((options: unknown) => OpenRouterClient(options)),
  }),
  { virtual: true },
);

import { OpenRouterStrategy } from './openrouter.strategy';

const usage = {
  promptTokens: 120,
  completionTokens: 30,
  totalTokens: 150,
  cost: 0.00042,
};

const makeStrategy = (env: Record<string, string> = {}) => {
  const values: Record<string, string> = {
    OPENROUTER_API_KEY: 'test-api-key',
    ...env,
  };
  const configService = new ConfigService(values);
  const strategy = new OpenRouterStrategy(configService);
  return { strategy, mocks: { configService, send } };
};

type ChatRequestPayload = {
  model: string;
  messages: unknown[];
  tools?: unknown[];
  maxTokens?: number;
  temperature?: number;
  responseFormat?: {
    type: string;
    jsonSchema: {
      name: string;
      strict: boolean;
      schema: Record<string, unknown>;
    };
  };
  provider?: { requireParameters?: boolean };
  reasoning?: { effort: string };
  sessionId?: string;
  stream: boolean;
};

/** The `chatRequest` payload handed to the SDK on the most recent call. */
const lastChatRequest = (): ChatRequestPayload => {
  const calls = send.mock.calls as Array<[{ chatRequest: ChatRequestPayload }]>;
  return calls[0][0].chatRequest;
};

let strategy: OpenRouterStrategy;

beforeEach(() => {
  jest.clearAllMocks();
  // A test that gives up early leaves its queued answers behind.
  send.mockReset();
  // Frozen, so a call's measured latency is 0 unless a test advances the clock.
  jest.useFakeTimers();
  ({ strategy } = makeStrategy());
});

afterEach(() => jest.useRealTimers());

describe('OpenRouterStrategy', () => {
  describe('constructor', () => {
    it('should throw when OPENROUTER_API_KEY is not configured', () => {
      const configService = { get: jest.fn(() => undefined) };

      expect(() => new OpenRouterStrategy(configService as any)).toThrow(
        InternalServerErrorException,
      );
    });

    it("should turn the SDK's own retries off when the client is built", () => {
      expect(OpenRouterClient).toHaveBeenCalledWith(
        expect.objectContaining({ retryConfig: { strategy: 'none' } }),
      );
    });

    it.each([
      ['OPENROUTER_TIMEOUT_MS', '0'],
      ['OPENROUTER_MAX_ATTEMPTS', '0'],
      ['OPENROUTER_RETRY_BASE_MS', '-1'],
      ['OPENROUTER_RETRY_MAX_DELAY_MS', '1.5'],
      ['OPENROUTER_RETRY_BUDGET_MS', 'soon'],
    ])('should throw naming %s when it is %p', (key, value) => {
      expect(() => makeStrategy({ [key]: value })).toThrow(key);
    });
  });

  describe('complete', () => {
    it('should return the text and mapped usage when the model responds', async () => {
      send.mockResolvedValue({
        choices: [{ message: { content: 'hello world' } }],
        usage,
      });

      await expect(
        strategy.complete([{ role: MessageRole.User, content: 'hi' }]),
      ).resolves.toEqual({
        text: 'hello world',
        usage: {
          promptTokens: 120,
          completionTokens: 30,
          totalTokens: 150,
          cost: 0.00042,
          latencyMs: 0,
        },
      });
    });

    it('should surface the finish reason when the provider reports one', async () => {
      send.mockResolvedValue({
        choices: [
          { message: { content: '{"html": "<ht' }, finishReason: 'length' },
        ],
        usage,
      });

      const result = await strategy.complete([
        { role: MessageRole.User, content: 'hi' },
      ]);

      expect(result.finishReason).toBe('length');
    });

    it('should report a cut-off with no text as length rather than an error', async () => {
      send.mockResolvedValue({
        choices: [{ message: { content: null }, finishReason: 'length' }],
        usage,
      });

      await expect(
        strategy.complete([{ role: MessageRole.User, content: 'hi' }]),
      ).resolves.toEqual({
        text: '',
        usage: {
          promptTokens: 120,
          completionTokens: 30,
          totalTokens: 150,
          cost: 0.00042,
          latencyMs: 0,
        },
        finishReason: 'length',
      });
    });

    it('should report a zero cost when the provider omits it', async () => {
      send.mockResolvedValue({
        choices: [{ message: { content: 'x' } }],
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      });

      const result = await strategy.complete([
        { role: MessageRole.User, content: 'hi' },
      ]);

      expect(result.usage.cost).toBe(0);
    });

    it('should throw a terminal LLMError without calling the provider when web search is asked for', async () => {
      const error = await strategy
        .complete([{ role: MessageRole.User, content: 'hi' }], {
          webSearch: { maxUses: 3 },
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(LLMError);
      expect(error).toMatchObject({ retryable: false });
      expect((error as Error).message).toContain('LLM_PROVIDER=anthropic');
      expect(send).not.toHaveBeenCalled();
    });

    it('should report the upstream inference cost when a BYOK call reports a zero cost', async () => {
      send.mockResolvedValue({
        choices: [{ message: { content: 'x' } }],
        usage: {
          promptTokens: 1000,
          completionTokens: 200,
          totalTokens: 1200,
          cost: 0,
          costDetails: {
            upstreamInferenceCost: 0.0002,
            upstreamInferencePromptCost: 0.0001,
            upstreamInferenceCompletionsCost: 0.0001,
          },
        },
      });

      const result = await strategy.complete([
        { role: MessageRole.User, content: 'hi' },
      ]);

      expect(result.usage.cost).toBe(0.0002);
    });

    it('should report the upstream inference cost when the cost is missing', async () => {
      send.mockResolvedValue({
        choices: [{ message: { content: 'x' } }],
        usage: {
          promptTokens: 1000,
          completionTokens: 200,
          totalTokens: 1200,
          costDetails: {
            upstreamInferenceCost: 0.0003,
            upstreamInferencePromptCost: 0.0001,
            upstreamInferenceCompletionsCost: 0.0002,
          },
        },
      });

      const result = await strategy.complete([
        { role: MessageRole.User, content: 'hi' },
      ]);

      expect(result.usage.cost).toBe(0.0003);
    });

    it('should keep the reported cost when it is not zero', async () => {
      send.mockResolvedValue({
        choices: [{ message: { content: 'x' } }],
        usage: {
          ...usage,
          costDetails: {
            upstreamInferenceCost: 0.9,
            upstreamInferencePromptCost: 0.5,
            upstreamInferenceCompletionsCost: 0.4,
          },
        },
      });

      const result = await strategy.complete([
        { role: MessageRole.User, content: 'hi' },
      ]);

      expect(result.usage.cost).toBe(0.00042);
    });

    it('should report a zero cost when the cost is zero and the upstream cost is null', async () => {
      send.mockResolvedValue({
        choices: [{ message: { content: 'x' } }],
        usage: {
          ...usage,
          cost: 0,
          costDetails: {
            upstreamInferenceCost: null,
            upstreamInferencePromptCost: 0,
            upstreamInferenceCompletionsCost: 0,
          },
        },
      });

      const result = await strategy.complete([
        { role: MessageRole.User, content: 'hi' },
      ]);

      expect(result.usage.cost).toBe(0);
    });

    it('should map reasoning, cached and cache-write tokens when the provider reports them', async () => {
      send.mockResolvedValue({
        choices: [{ message: { content: 'x' } }],
        usage: {
          ...usage,
          completionTokensDetails: { reasoningTokens: 18 },
          promptTokensDetails: { cachedTokens: 100, cacheWriteTokens: 20 },
        },
      });

      const result = await strategy.complete([
        { role: MessageRole.User, content: 'hi' },
      ]);

      expect(result.usage).toMatchObject({
        reasoningTokens: 18,
        cachedTokens: 100,
        cacheWriteTokens: 20,
      });
    });

    it('should omit the token details the provider does not report', async () => {
      send.mockResolvedValue({
        choices: [{ message: { content: 'x' } }],
        usage: { ...usage, completionTokensDetails: { reasoningTokens: null } },
      });

      const result = await strategy.complete([
        { role: MessageRole.User, content: 'hi' },
      ]);

      expect(result.usage).not.toHaveProperty('reasoningTokens');
      expect(result.usage).not.toHaveProperty('cachedTokens');
      expect(result.usage).not.toHaveProperty('cacheWriteTokens');
    });

    it('should report how long the call took', async () => {
      send.mockImplementation(() => {
        jest.advanceTimersByTime(1250);
        return Promise.resolve({
          choices: [{ message: { content: 'x' } }],
          usage,
        });
      });

      const result = await strategy.complete([
        { role: MessageRole.User, content: 'hi' },
      ]);

      expect(result.usage.latencyMs).toBe(1250);
    });

    it('should report zeroed usage when the response carries none', async () => {
      send.mockResolvedValue({ choices: [{ message: { content: 'x' } }] });

      const result = await strategy.complete([
        { role: MessageRole.User, content: 'hi' },
      ]);

      expect(result.usage).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
        latencyMs: 0,
      });
    });

    it('should return a fresh usage object each time, so callers can accumulate into it', async () => {
      send.mockResolvedValue({ choices: [{ message: { content: 'x' } }] });
      const messages = [{ role: MessageRole.User as const, content: 'hi' }];

      const first = await strategy.complete(messages);
      first.usage.totalTokens += 100;
      const second = await strategy.complete(messages);

      expect(second.usage.totalTokens).toBe(0);
    });

    it('should send the requested model, temperature and token cap', async () => {
      send.mockResolvedValue({ choices: [{ message: { content: 'x' } }] });

      await strategy.complete([{ role: MessageRole.User, content: 'hi' }], {
        model: 'anthropic/claude-4.5-sonnet',
        max_tokens: 512,
        temperature: 0.2,
      });

      expect(lastChatRequest()).toMatchObject({
        model: 'anthropic/claude-4.5-sonnet',
        maxTokens: 512,
        temperature: 0.2,
        stream: false,
      });
    });

    it('should fall back to the default model when none is given', async () => {
      send.mockResolvedValue({ choices: [{ message: { content: 'x' } }] });

      await strategy.complete([{ role: MessageRole.User, content: 'hi' }]);

      expect(lastChatRequest().model).toBe('openai/gpt-5-mini');
    });

    it('should not send a tools key', async () => {
      send.mockResolvedValue({ choices: [{ message: { content: 'x' } }] });

      await strategy.complete([{ role: MessageRole.User, content: 'hi' }]);

      expect(lastChatRequest()).not.toHaveProperty('tools');
    });

    it('should constrain a completion to the supplied Zod response schema', async () => {
      send.mockResolvedValue({ choices: [{ message: { content: '{}' } }] });
      const responseSchema = z.object({
        document: z.object({
          slides: z.array(
            z.object({
              items: z.array(z.string().max(80)),
              handle: z.string().max(40),
            }),
          ),
        }),
      });

      await strategy.complete(
        [{ role: MessageRole.User, content: 'build a document' }],
        {
          responseSchema: {
            name: 'artifact_generation',
            schema: responseSchema,
          },
        },
      );

      expect(lastChatRequest()).toMatchObject({
        responseFormat: {
          type: 'json_schema',
          jsonSchema: {
            name: 'artifact_generation',
            strict: true,
            schema: {
              properties: {
                document: {
                  properties: {
                    slides: {
                      items: {
                        properties: {
                          items: { items: { maxLength: 80 } },
                          handle: { maxLength: 40 },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        provider: { requireParameters: true },
      });
      expect(
        lastChatRequest().responseFormat?.jsonSchema.schema,
      ).not.toHaveProperty('$schema');
    });

    it('should normalize discriminated unions to provider-supported anyOf schemas', async () => {
      send.mockResolvedValue({ choices: [{ message: { content: '{}' } }] });
      const responseSchema = z.object({
        slide: z.discriminatedUnion('type', [
          z.object({
            type: z.literal('list'),
            items: z.array(z.string().max(80)),
          }),
          z.object({
            type: z.literal('cta'),
            handle: z.string().max(40),
          }),
        ]),
      });

      await strategy.complete(
        [{ role: MessageRole.User, content: 'build a slide' }],
        {
          responseSchema: {
            name: 'artifact_generation',
            schema: responseSchema,
          },
        },
      );

      const serialized = JSON.stringify(
        lastChatRequest().responseFormat?.jsonSchema.schema,
      );
      expect(serialized).toContain('"anyOf"');
      expect(serialized).not.toContain('"oneOf"');
      expect(serialized).toContain('"maxLength":80');
      expect(serialized).toContain('"maxLength":40');
    });

    it('should represent optional properties as required nullable fields in strict schemas', async () => {
      send.mockResolvedValue({ choices: [{ message: { content: '{}' } }] });

      await strategy.complete(
        [{ role: MessageRole.User, content: 'build an object' }],
        {
          responseSchema: {
            name: 'optional_fields',
            schema: z.object({
              required: z.string(),
              optional: z.string().max(40).optional(),
            }),
          },
        },
      );

      expect(lastChatRequest().responseFormat?.jsonSchema.schema).toMatchObject(
        {
          required: ['required', 'optional'],
          properties: {
            required: { type: 'string' },
            optional: { type: ['string', 'null'], maxLength: 40 },
          },
        },
      );
    });

    it('should keep enum, pattern and length constraints in a strict-mode schema', async () => {
      send.mockResolvedValue({ choices: [{ message: { content: '{}' } }] });

      await strategy.complete(
        [{ role: MessageRole.User, content: 'build a poll' }],
        {
          responseSchema: {
            name: 'artifact_generation',
            // The shape of the POLL generation contract.
            schema: z.object({
              commentary: z.string().min(1).max(3000).optional(),
              poll: z.object({
                question: z.string().regex(/\S/).max(140),
                options: z.array(z.string().regex(/\S/).max(30)).min(2).max(4),
                durationDays: z.literal([1, 3, 7, 14]),
              }),
            }),
          },
        },
      );

      const schema = lastChatRequest().responseFormat?.jsonSchema.schema;
      expect(schema).toMatchObject({
        required: ['commentary', 'poll'],
        additionalProperties: false,
        properties: {
          commentary: { type: ['string', 'null'], maxLength: 3000 },
          poll: {
            required: ['question', 'options', 'durationDays'],
            additionalProperties: false,
            properties: {
              question: { type: 'string', pattern: '\\S', maxLength: 140 },
              options: {
                items: { type: 'string', pattern: '\\S', maxLength: 30 },
              },
              durationDays: { type: 'number', enum: [1, 3, 7, 14] },
            },
          },
        },
      });
      // Strict mode rejects keywords it cannot enforce; Zod's refines must
      // not leak into the schema as anything but these.
      expect(JSON.stringify(schema)).not.toMatch(/"(oneOf|allOf|not|const)"/);
    });

    it('should omit response constraints for an unconstrained completion', async () => {
      send.mockResolvedValue({ choices: [{ message: { content: 'x' } }] });

      await strategy.complete([{ role: MessageRole.User, content: 'hi' }]);

      expect(lastChatRequest()).not.toHaveProperty('responseFormat');
      expect(lastChatRequest()).not.toHaveProperty('provider');
    });

    it('should throw a terminal LLMError when the model returns no text', async () => {
      send.mockResolvedValue({
        choices: [{ message: { content: null } }],
        usage,
      });

      await expect(
        strategy.complete([{ role: MessageRole.User, content: 'hi' }]),
      ).rejects.toMatchObject({
        name: 'LLMError',
        retryable: false,
      });
    });
  });

  describe('message mapping', () => {
    beforeEach(() => {
      send.mockResolvedValue({ choices: [{ message: { content: 'x' } }] });
    });

    it('should map system and user messages verbatim', async () => {
      await strategy.complete([
        { role: MessageRole.System, content: 'be terse' },
        { role: MessageRole.User, content: 'hi' },
      ]);

      expect(lastChatRequest().messages).toEqual([
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
      ]);
    });

    it('should serialise an assistant tool call into the SDK shape', async () => {
      const messages: LLMMessage[] = [
        {
          role: MessageRole.Assistant,
          toolCalls: [
            { id: 'call_1', name: 'searchWeb', input: { query: 'nest' } },
          ],
        },
      ];

      await strategy.complete(messages);

      expect(lastChatRequest().messages[0]).toEqual({
        role: 'assistant',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'searchWeb',
              arguments: '{"query":"nest"}',
            },
          },
        ],
      });
    });

    it('should keep assistant prose when the turn has both content and tool calls', async () => {
      await strategy.complete([
        {
          role: MessageRole.Assistant,
          content: 'let me look that up',
          toolCalls: [{ id: 'call_1', name: 'searchWeb', input: {} }],
        },
      ]);

      expect(lastChatRequest().messages[0]).toMatchObject({
        role: 'assistant',
        content: 'let me look that up',
      });
    });

    it('should map a tool result message onto toolCallId', async () => {
      await strategy.complete([
        {
          role: MessageRole.Tool,
          content: '{"ok":true}',
          toolCallId: 'call_1',
        },
      ]);

      expect(lastChatRequest().messages[0]).toEqual({
        role: 'tool',
        content: '{"ok":true}',
        toolCallId: 'call_1',
      });
    });
  });

  describe('completeWithTools', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'searchWeb',
        description: 'Search the web',
        parameters: z.object({ query: z.string() }),
      },
    ];

    it('should convert Zod parameters to JSON Schema without the $schema key', async () => {
      send.mockResolvedValue({ choices: [{ message: { content: null } }] });

      await strategy.completeWithTools(
        [{ role: MessageRole.User, content: 'find me things' }],
        tools,
      );

      expect(lastChatRequest().tools).toEqual([
        {
          type: 'function',
          function: {
            name: 'searchWeb',
            description: 'Search the web',
            parameters: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
            },
          },
        },
      ]);
    });

    it('should omit the tools key when given an empty tool list', async () => {
      send.mockResolvedValue({ choices: [{ message: { content: 'x' } }] });

      await strategy.completeWithTools(
        [{ role: MessageRole.User, content: 'hi' }],
        [],
      );

      expect(lastChatRequest()).not.toHaveProperty('tools');
    });

    it('should return parsed tool calls and usage when the model calls a tool', async () => {
      send.mockResolvedValue({
        choices: [
          {
            message: {
              content: null,
              toolCalls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'searchWeb',
                    arguments: '{"query":"nestjs testing"}',
                  },
                },
              ],
            },
          },
        ],
        usage,
      });

      const result = await strategy.completeWithTools(
        [{ role: MessageRole.User, content: 'find me things' }],
        tools,
      );

      expect(result.toolCalls).toEqual([
        { id: 'call_1', name: 'searchWeb', input: { query: 'nestjs testing' } },
      ]);
      expect(result.usage.cost).toBe(0.00042);
      expect(result.usage.latencyMs).toBe(0);
      expect(result).not.toHaveProperty('text');
    });

    it('should treat empty tool arguments as an empty input object', async () => {
      send.mockResolvedValue({
        choices: [
          {
            message: {
              content: null,
              toolCalls: [
                {
                  id: 'c1',
                  type: 'function',
                  function: { name: 'now', arguments: '' },
                },
              ],
            },
          },
        ],
      });

      const result = await strategy.completeWithTools([], tools);

      expect(result.toolCalls[0].input).toEqual({});
    });

    it('should return an empty toolCalls list and the text when the model answers directly', async () => {
      send.mockResolvedValue({
        choices: [{ message: { content: 'the answer is 42' } }],
        usage,
      });

      const result = await strategy.completeWithTools(
        [{ role: MessageRole.User, content: 'answer' }],
        tools,
      );

      expect(result).toEqual({
        text: 'the answer is 42',
        toolCalls: [],
        usage: {
          promptTokens: 120,
          completionTokens: 30,
          totalTokens: 150,
          cost: 0.00042,
          latencyMs: 0,
        },
      });
    });

    it('should throw a retryable LLMError when tool arguments are malformed JSON', async () => {
      send.mockResolvedValue({
        choices: [
          {
            message: {
              content: null,
              toolCalls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'searchWeb', arguments: '{"query": ' },
                },
              ],
            },
          },
        ],
      });

      await expect(strategy.completeWithTools([], tools)).rejects.toMatchObject(
        {
          name: 'LLMError',
          retryable: true,
        },
      );
    });
  });

  describe('error classification', () => {
    it('should surface a 429 as a retryable LLMError when no try is left', async () => {
      ({ strategy } = makeStrategy({ OPENROUTER_MAX_ATTEMPTS: '1' }));
      send.mockRejectedValue(
        Object.assign(new Error('Rate limit exceeded'), { statusCode: 429 }),
      );

      const error = await strategy
        .complete([{ role: MessageRole.User, content: 'hi' }])
        .catch((e: LLMError) => e);

      expect(error).toBeInstanceOf(LLMError);
      expect(error).toMatchObject({ retryable: true, statusCode: 429 });
    });

    it('should surface a 401 as a terminal LLMError', async () => {
      send.mockRejectedValue(
        Object.assign(new Error('Unauthorized'), { statusCode: 401 }),
      );

      const error = await strategy
        .completeWithTools([{ role: MessageRole.User, content: 'hi' }], [])
        .catch((e: LLMError) => e);

      expect(error).toBeInstanceOf(LLMError);
      expect(error).toMatchObject({ retryable: false, statusCode: 401 });
    });
  });

  describe('generateCompletion', () => {
    it('should return only the text, preserving the legacy contract', async () => {
      send.mockResolvedValue({
        choices: [{ message: { content: 'legacy' } }],
        usage,
      });

      await expect(
        strategy.generateCompletion([
          { role: MessageRole.User, content: 'hi' },
        ]),
      ).resolves.toBe('legacy');
    });
  });

  describe('reasoning effort, session id and reported model', () => {
    const user: LLMMessage[] = [{ role: MessageRole.User, content: 'hi' }];
    const ok = { choices: [{ message: { content: 'hello' } }], usage };
    const tool: ToolDefinition = {
      name: 'lookup',
      description: 'Look something up',
      parameters: z.object({ q: z.string() }),
    };

    it("should send exactly today's request keys when effort and session are unset", async () => {
      send.mockResolvedValue(ok);

      await strategy.complete(user);

      const request = lastChatRequest();
      expect(Object.keys(request).sort()).toEqual([
        'maxTokens',
        'messages',
        'model',
        'stream',
        'temperature',
      ]);
      expect(request).not.toHaveProperty('reasoning');
      expect(request).not.toHaveProperty('reasoningEffort');
      expect(request).not.toHaveProperty('sessionId');
    });

    it('should send reasoning.effort and no shorthand when complete sets an effort', async () => {
      send.mockResolvedValue(ok);

      await strategy.complete(user, { reasoningEffort: 'low' });

      const request = lastChatRequest();
      expect(request.reasoning).toEqual({ effort: 'low' });
      expect(request).not.toHaveProperty('reasoningEffort');
    });

    it('should send reasoning.effort when completeWithTools sets an effort', async () => {
      send.mockResolvedValue({ choices: [{ message: {} }], usage });

      await strategy.completeWithTools(user, [tool], {
        reasoningEffort: 'low',
      });

      const request = lastChatRequest();
      expect(request.reasoning).toEqual({ effort: 'low' });
      expect(request).not.toHaveProperty('reasoningEffort');
    });

    it('should keep requireParameters when an effort and a response schema are both set', async () => {
      send.mockResolvedValue({
        choices: [{ message: { content: '{}' } }],
        usage,
      });

      await strategy.complete(user, {
        reasoningEffort: 'low',
        responseSchema: { name: 'out', schema: z.object({ a: z.string() }) },
      });

      const request = lastChatRequest();
      expect(request.reasoning).toEqual({ effort: 'low' });
      expect(request.provider).toEqual({ requireParameters: true });
      expect(request).not.toHaveProperty('reasoningEffort');
    });

    it('should send sessionId when one is set', async () => {
      send.mockResolvedValue(ok);

      await strategy.complete(user, { sessionId: 'run-1' });

      const request = lastChatRequest();
      expect(request.sessionId).toBe('run-1');
      expect(request).not.toHaveProperty('reasoning');
    });

    it('should report the model when complete gets one from the provider', async () => {
      send.mockResolvedValue({ ...ok, model: 'openai/gpt-5-mini-x' });

      const result = await strategy.complete(user);

      expect(result.model).toBe('openai/gpt-5-mini-x');
    });

    it('should report the model when complete is truncated at the token cap', async () => {
      send.mockResolvedValue({
        choices: [{ message: { content: null }, finishReason: 'length' }],
        usage,
        model: 'openai/gpt-5-mini-x',
      });

      const result = await strategy.complete(user);

      expect(result.finishReason).toBe('length');
      expect(result.model).toBe('openai/gpt-5-mini-x');
    });

    it('should report the model when completeWithTools gets one from the provider', async () => {
      send.mockResolvedValue({
        choices: [{ message: {} }],
        usage,
        model: 'openai/gpt-5-mini-x',
      });

      const result = await strategy.completeWithTools(user, [tool]);

      expect(result.model).toBe('openai/gpt-5-mini-x');
    });

    it('should omit the model key when the provider reports none', async () => {
      send.mockResolvedValue({ ...ok, model: '' });
      const completed = await strategy.complete(user);

      send.mockResolvedValue({ choices: [{ message: {} }], usage });
      const turn = await strategy.completeWithTools(user, [tool]);

      expect(completed).not.toHaveProperty('model');
      expect(turn).not.toHaveProperty('model');
    });
  });

  describe('retries', () => {
    const user: LLMMessage[] = [{ role: MessageRole.User, content: 'hi' }];
    const ok = { choices: [{ message: { content: 'hello' } }], usage };
    const httpError = (statusCode: number, headers?: Record<string, string>) =>
      Object.assign(new Error(`status ${statusCode}`), {
        statusCode,
        ...(headers ? { headers: new Headers(headers) } : {}),
      });
    /** A call that never answers, and rejects as fetch does once its signal aborts. */
    const hang = (_request: unknown, { signal }: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason as Error));
      });
    /** The settled outcome, without an unhandled rejection while timers run. */
    const settle = <T>(
      promise: Promise<T>,
    ): Promise<{ value?: T; error?: unknown }> =>
      promise.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );

    let random: jest.SpyInstance;

    beforeEach(() => {
      random = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    });

    afterEach(() => random.mockRestore());

    it('should pass an abort signal to the SDK when making each try', async () => {
      send.mockResolvedValue(ok);

      await strategy.complete(user);

      const [, requestOptions] = send.mock.calls[0] as [
        unknown,
        { signal: AbortSignal },
      ];
      expect(requestOptions.signal).toBeInstanceOf(AbortSignal);
    });

    it('should retry after full jitter and return the answer when a 502 is followed by a success', async () => {
      send.mockRejectedValueOnce(httpError(502)).mockResolvedValueOnce(ok);

      const outcome = settle(strategy.complete(user));
      // Full jitter on the first retry: 0.5 * min(15000, 1000 * 2^0) = 500.
      await jest.advanceTimersByTimeAsync(499);
      expect(send).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);

      expect((await outcome).value).toMatchObject({ text: 'hello' });
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('should double the jitter ceiling and cap it at the max delay when tries keep failing', async () => {
      ({ strategy } = makeStrategy({
        OPENROUTER_MAX_ATTEMPTS: '4',
        OPENROUTER_RETRY_MAX_DELAY_MS: '1500',
      }));
      random.mockReturnValue(1);
      send
        .mockRejectedValueOnce(httpError(503))
        .mockRejectedValueOnce(httpError(503))
        .mockRejectedValueOnce(httpError(503))
        .mockResolvedValueOnce(ok);

      const outcome = settle(strategy.complete(user));
      await jest.advanceTimersByTimeAsync(1000);
      expect(send).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(1500);
      expect(send).toHaveBeenCalledTimes(3);
      await jest.advanceTimersByTimeAsync(1500);

      await expect(outcome).resolves.toHaveProperty('value');
      expect(send).toHaveBeenCalledTimes(4);
    });

    it('should wait for Retry-After instead of the jitter when a 429 sends one', async () => {
      send
        .mockRejectedValueOnce(httpError(429, { 'retry-after': '3' }))
        .mockResolvedValueOnce(ok);

      const outcome = settle(strategy.complete(user));
      await jest.advanceTimersByTimeAsync(2_999);
      expect(send).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);

      await expect(outcome).resolves.toHaveProperty('value');
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('should retry when a provider error arrives after 200 OK', async () => {
      send
        .mockRejectedValueOnce(
          Object.assign(new Error('Response validation failed'), {
            name: 'ResponseValidationError',
            statusCode: 200,
            rawValue: { error: { code: 502, message: 'Upstream died' } },
          }),
        )
        .mockResolvedValueOnce(ok);

      const outcome = settle(strategy.complete(user));
      await jest.runAllTimersAsync();

      await expect(outcome).resolves.toHaveProperty('value');
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('should throw the last retryable error when every try fails', async () => {
      send.mockRejectedValue(httpError(503));

      const outcome = settle(strategy.complete(user));
      await jest.runAllTimersAsync();

      expect(send).toHaveBeenCalledTimes(3);
      expect((await outcome).error).toMatchObject({
        name: 'LLMError',
        retryable: true,
        statusCode: 503,
      });
    });

    it('should try exactly once and never sleep when OPENROUTER_MAX_ATTEMPTS is 1', async () => {
      ({ strategy } = makeStrategy({
        OPENROUTER_MAX_ATTEMPTS: '1',
        OPENROUTER_TIMEOUT_MS: '3600000',
      }));
      send.mockRejectedValue(httpError(503));

      const error = await strategy.complete(user).catch((e: unknown) => e);

      expect(send).toHaveBeenCalledTimes(1);
      expect(error).toMatchObject({ retryable: true, statusCode: 503 });
      expect(jest.getTimerCount()).toBe(0);
    });

    it('should not retry when the error is terminal', async () => {
      send.mockRejectedValue(httpError(401));

      const error = await strategy.complete(user).catch((e: unknown) => e);

      expect(send).toHaveBeenCalledTimes(1);
      expect(error).toMatchObject({ retryable: false, statusCode: 401 });
    });

    it('should give up without sleeping when Retry-After is longer than the retry budget', async () => {
      send
        .mockRejectedValueOnce(httpError(429, { 'retry-after': '60' }))
        .mockResolvedValueOnce(ok);

      const error = await strategy.complete(user).catch((e: unknown) => e);

      expect(send).toHaveBeenCalledTimes(1);
      expect(error).toMatchObject({ retryable: true, statusCode: 429 });
    });

    it('should give up when the sleeps so far and the next one would exceed the retry budget', async () => {
      ({ strategy } = makeStrategy({
        OPENROUTER_MAX_ATTEMPTS: '5',
        OPENROUTER_RETRY_BUDGET_MS: '2000',
      }));
      random.mockReturnValue(0.9);
      // Sleeps 900, then 1800: 2700 would pass the 2000 budget.
      send.mockRejectedValue(httpError(502));

      const outcome = settle(strategy.complete(user));
      await jest.runAllTimersAsync();

      expect(send).toHaveBeenCalledTimes(2);
      expect((await outcome).error).toMatchObject({ statusCode: 502 });
    });

    it('should give up when the sleep would end past the caller deadline', async () => {
      send
        .mockRejectedValueOnce(httpError(429, { 'retry-after': '2' }))
        .mockResolvedValueOnce(ok);

      const error = await strategy
        .complete(user, { deadlineAt: Date.now() + 1_500 })
        .catch((e: unknown) => e);

      expect(send).toHaveBeenCalledTimes(1);
      expect(error).toMatchObject({ statusCode: 429 });
    });

    it('should end the call at the per-try timeout and run the next try when a call hangs', async () => {
      send.mockImplementationOnce(hang).mockResolvedValueOnce(ok);

      const outcome = settle(strategy.complete(user));
      await jest.advanceTimersByTimeAsync(239_999);
      expect(send).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      const [, firstTry] = send.mock.calls[0] as [
        unknown,
        { signal: AbortSignal },
      ];
      expect(firstTry.signal.aborted).toBe(true);
      await jest.advanceTimersByTimeAsync(500);

      await expect(outcome).resolves.toHaveProperty('value');
      expect(send).toHaveBeenCalledTimes(2);
    });

    it("should use the call's timeout when it is shorter than OPENROUTER_TIMEOUT_MS", async () => {
      ({ strategy } = makeStrategy({ OPENROUTER_MAX_ATTEMPTS: '1' }));
      send.mockImplementationOnce(hang);

      const outcome = settle(strategy.complete(user, { timeoutMs: 45_000 }));
      await jest.advanceTimersByTimeAsync(45_000);

      expect((await outcome).error).toMatchObject({
        name: 'LLMError',
        retryable: true,
      });
    });

    it('should cut the per-try timeout to the time left when the deadline is nearer', async () => {
      ({ strategy } = makeStrategy({ OPENROUTER_MAX_ATTEMPTS: '1' }));
      send.mockImplementationOnce(hang);

      const outcome = settle(
        strategy.complete(user, { deadlineAt: Date.now() + 5_000 }),
      );
      await jest.advanceTimersByTimeAsync(5_000);

      expect((await outcome).error).toMatchObject({ retryable: true });
    });

    it('should not call the provider when the deadline has already passed', async () => {
      const error = await strategy
        .complete(user, { deadlineAt: Date.now() })
        .catch((e: unknown) => e);

      expect(send).not.toHaveBeenCalled();
      expect(error).toMatchObject({ name: 'LLMError', retryable: true });
    });

    it('should not retry when the caller aborts the call', async () => {
      const controller = new AbortController();
      send.mockImplementationOnce(hang).mockResolvedValueOnce(ok);

      const outcome = settle(
        strategy.complete(user, { signal: controller.signal }),
      );
      await jest.advanceTimersByTimeAsync(10);
      controller.abort();
      await jest.runAllTimersAsync();

      expect(send).toHaveBeenCalledTimes(1);
      expect((await outcome).error).toMatchObject({
        name: 'LLMError',
        retryable: false,
      });
    });

    it('should stop sleeping and not retry when the caller aborts between tries', async () => {
      const controller = new AbortController();
      send.mockRejectedValueOnce(httpError(502)).mockResolvedValueOnce(ok);

      const outcome = settle(
        strategy.complete(user, { signal: controller.signal }),
      );
      await jest.advanceTimersByTimeAsync(100);
      controller.abort();
      await jest.runAllTimersAsync();

      expect(send).toHaveBeenCalledTimes(1);
      expect((await outcome).error).toMatchObject({ retryable: false });
    });

    it('should retry when completeWithTools fails with a retryable error', async () => {
      send
        .mockRejectedValueOnce(httpError(502))
        .mockResolvedValueOnce({ choices: [{ message: { content: 'done' } }] });

      const outcome = settle(strategy.completeWithTools(user, []));
      await jest.runAllTimersAsync();

      expect((await outcome).value).toMatchObject({ text: 'done' });
    });
  });

  describe('streaming', () => {
    const user: LLMMessage[] = [{ role: MessageRole.User, content: 'hi' }];
    const chunk = (
      content: string | undefined,
      extra: Record<string, unknown> = {},
      finishReason: string | null = null,
    ) => ({
      id: 'gen-1',
      created: 1,
      model: 'provider/answered-model',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { content }, finishReason }],
      ...extra,
    });
    /** What `chat.send` resolves to with `stream: true`: an async iterable of chunks. */
    const streamOf = (...chunks: unknown[]) => ({
      // eslint-disable-next-line @typescript-eslint/require-await
      async *[Symbol.asyncIterator]() {
        for (const c of chunks) yield c;
      },
    });
    const settle = <T>(
      promise: Promise<T>,
    ): Promise<{ value?: T; error?: unknown }> =>
      promise.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );

    let random: jest.SpyInstance;

    beforeEach(() => {
      random = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    });

    afterEach(() => random.mockRestore());

    it('should send stream: true when the call asks for text deltas', async () => {
      send.mockResolvedValue(streamOf(chunk('ok', {}, 'stop')));

      await strategy.complete(user, { onTextDelta: jest.fn() });

      expect(lastChatRequest().stream).toBe(true);
    });

    it('should keep stream: false when the call asks for no text deltas', async () => {
      send.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });

      await strategy.complete(user);

      expect(lastChatRequest().stream).toBe(false);
    });

    it('should pass each delta and the text so far, and return the whole text with usage, finish reason and model', async () => {
      send.mockResolvedValue(
        streamOf(
          chunk('{"comm'),
          chunk(undefined),
          chunk('entary":"Hi"}', {}, 'stop'),
          chunk('', { usage, choices: [] }),
        ),
      );
      const onTextDelta = jest.fn();

      const result = await strategy.complete(user, { onTextDelta });

      expect(onTextDelta.mock.calls).toEqual([
        ['{"comm', '{"comm'],
        ['entary":"Hi"}', '{"commentary":"Hi"}'],
      ]);
      expect(result).toEqual({
        text: '{"commentary":"Hi"}',
        usage: {
          promptTokens: 120,
          completionTokens: 30,
          totalTokens: 150,
          cost: 0.00042,
          latencyMs: 0,
        },
        finishReason: 'stop',
        model: 'provider/answered-model',
      });
    });

    it('should return empty text when the stream is cut off at the token cap before any text', async () => {
      send.mockResolvedValue(streamOf(chunk(undefined, { usage }, 'length')));

      await expect(
        strategy.complete(user, { onTextDelta: jest.fn() }),
      ).resolves.toMatchObject({ text: '', finishReason: 'length' });
    });

    it('should throw a terminal error when the stream ends with no text', async () => {
      send.mockResolvedValue(streamOf(chunk(undefined, {}, 'stop')));

      await expect(
        strategy.complete(user, { onTextDelta: jest.fn() }),
      ).rejects.toMatchObject({ name: 'LLMError', retryable: false });
    });

    it('should retry from empty text when the provider sends an error mid-stream', async () => {
      send
        .mockResolvedValueOnce(
          streamOf(
            chunk('{"commentary":"Dra'),
            chunk(
              undefined,
              { error: { code: 502, message: 'Upstream died' } },
              'error',
            ),
          ),
        )
        .mockResolvedValueOnce(
          streamOf(chunk('{"commentary":"New"}', {}, 'stop')),
        );
      const onTextDelta = jest.fn();

      const outcome = settle(strategy.complete(user, { onTextDelta }));
      await jest.runAllTimersAsync();

      expect((await outcome).value).toMatchObject({
        text: '{"commentary":"New"}',
      });
      expect(send).toHaveBeenCalledTimes(2);
      expect(onTextDelta).toHaveBeenLastCalledWith(
        '{"commentary":"New"}',
        '{"commentary":"New"}',
      );
    });

    it('should not retry when the provider sends a client error mid-stream', async () => {
      send.mockResolvedValue(
        streamOf(chunk(undefined, { error: { code: 400, message: 'bad' } })),
      );

      await expect(
        strategy.complete(user, { onTextDelta: jest.fn() }),
      ).rejects.toMatchObject({ retryable: false, statusCode: 400 });
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('should end a stream that stalls at the per-try timeout and run the next try', async () => {
      send
        .mockImplementationOnce(
          (_request: unknown, { signal }: { signal: AbortSignal }) =>
            Promise.resolve({
              async *[Symbol.asyncIterator]() {
                yield chunk('{"comm');
                await new Promise((_resolve, reject) => {
                  signal.addEventListener('abort', () =>
                    reject(signal.reason as Error),
                  );
                });
              },
            }),
        )
        .mockResolvedValueOnce(
          streamOf(chunk('{"commentary":"x"}', {}, 'stop')),
        );

      const outcome = settle(
        strategy.complete(user, { onTextDelta: jest.fn() }),
      );
      // No short idle timer: a silent stream survives until the try's timeout.
      await jest.advanceTimersByTimeAsync(239_999);
      expect(send).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await jest.advanceTimersByTimeAsync(500);

      expect((await outcome).value).toMatchObject({
        text: '{"commentary":"x"}',
      });
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('should finish the call when the delta callback throws', async () => {
      send.mockResolvedValue(streamOf(chunk('ok', {}, 'stop')));

      await expect(
        strategy.complete(user, {
          onTextDelta: () => {
            throw new Error('preview broke');
          },
        }),
      ).resolves.toMatchObject({ text: 'ok' });
    });

    it('should not stream completeWithTools when it is given a delta callback', async () => {
      send.mockResolvedValue({ choices: [{ message: { content: 'done' } }] });

      await strategy.completeWithTools(user, [], { onTextDelta: jest.fn() });

      expect(lastChatRequest().stream).toBe(false);
    });
  });
});
