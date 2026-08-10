import { InternalServerErrorException } from '@nestjs/common';
import { z } from 'zod';
import { LLMError } from '../errors';
import { LLMMessage, MessageRole, ToolDefinition } from '../interfaces';

const send = jest.fn();

jest.mock(
  '@openrouter/sdk',
  () => ({
    OpenRouter: jest.fn().mockImplementation(() => ({ chat: { send } })),
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

const makeStrategy = () => {
  const configService = { get: jest.fn(() => 'test-api-key') };
  const strategy = new OpenRouterStrategy(configService as any);
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
  ({ strategy } = makeStrategy());
});

describe('OpenRouterStrategy', () => {
  describe('constructor', () => {
    it('should throw when OPENROUTER_API_KEY is not configured', () => {
      const configService = { get: jest.fn(() => undefined) };

      expect(() => new OpenRouterStrategy(configService as any)).toThrow(
        InternalServerErrorException,
      );
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
        },
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
    it('should surface a 429 as a retryable LLMError', async () => {
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
});
