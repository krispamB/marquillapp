import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { LLMError } from '../errors';
import { LLMMessage, MessageRole, ToolDefinition } from '../interfaces';
import { AnthropicStrategy, type FetchFn } from './anthropic.strategy';

const fetchFn = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>();

const makeStrategy = (env: Record<string, string> = {}) => {
  const configService = new ConfigService({
    ANTHROPIC_API_KEY: 'test-key',
    ...env,
  });
  const strategy = new AnthropicStrategy(configService, fetchFn);
  return { strategy, mocks: { configService, fetchFn } };
};

type AnthropicBody = {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: string; content: unknown[] }>;
  tools?: Array<Record<string, unknown>>;
  output_config?: {
    effort?: string;
    format?: { type: string; schema: Record<string, unknown> };
  };
  stream?: boolean;
  temperature?: number;
};

const message = (overrides: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-5-5',
  content: [{ type: 'text', text: 'hello' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 10_000, output_tokens: 2_000 },
  ...overrides,
});

const jsonResponse = (
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });

const apiError = (
  status: number,
  type: string,
  headers?: Record<string, string>,
) =>
  jsonResponse(
    { type: 'error', error: { type, message: `${type} happened` } },
    { status, headers },
  );

const sseResponse = (events: Array<Record<string, unknown>>) =>
  new Response(
    events
      .map(
        (event) =>
          `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(''),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

const requestAt = (i: number) => {
  const [url, init] = fetchFn.mock.calls[i];
  return {
    url,
    init,
    body: JSON.parse(init.body as string) as AnthropicBody,
    headers: init.headers as Record<string, string>,
  };
};
const lastRequest = () => requestAt(fetchFn.mock.calls.length - 1);

const user: LLMMessage[] = [{ role: MessageRole.User, content: 'hi' }];

let strategy: AnthropicStrategy;

beforeEach(() => {
  jest.clearAllMocks();
  fetchFn.mockReset();
  ({ strategy } = makeStrategy());
});

describe('AnthropicStrategy', () => {
  describe('constructor', () => {
    it('should not throw when ANTHROPIC_API_KEY is absent, so boot never needs it', () => {
      expect(
        () => new AnthropicStrategy(new ConfigService({}), fetchFn),
      ).not.toThrow();
    });

    it.each([
      ['ANTHROPIC_TIMEOUT_MS', '0'],
      ['ANTHROPIC_MAX_ATTEMPTS', '0'],
      ['ANTHROPIC_RETRY_BASE_MS', '-1'],
      ['ANTHROPIC_RETRY_MAX_DELAY_MS', '1.5'],
      ['ANTHROPIC_RETRY_BUDGET_MS', 'soon'],
    ])('should throw naming %s when it is %p', (key, value) => {
      expect(() => makeStrategy({ [key]: value })).toThrow(key);
    });
  });

  describe('complete', () => {
    it('should return the text, priced usage, finish reason and model when the model answers', async () => {
      fetchFn.mockResolvedValue(jsonResponse(message()));

      await expect(strategy.complete(user)).resolves.toEqual({
        text: 'hello',
        usage: {
          promptTokens: 10_000,
          completionTokens: 2_000,
          totalTokens: 12_000,
          cost: expect.closeTo(0.002, 10) as number,
          latencyMs: expect.any(Number) as number,
        },
        finishReason: 'stop',
        model: 'claude-haiku-5-5',
      });
    });

    it('should post to the Messages API with the key and version headers', async () => {
      fetchFn.mockResolvedValue(jsonResponse(message()));

      await strategy.complete(user);

      const { url, init, headers } = lastRequest();
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(init.method).toBe('POST');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(headers).toEqual({
        'content-type': 'application/json',
        'x-api-key': 'test-key',
        'anthropic-version': '2026-10-21',
      });
    });

    it('should use ANTHROPIC_BASE_URL and ANTHROPIC_VERSION when they are set', async () => {
      ({ strategy } = makeStrategy({
        ANTHROPIC_BASE_URL: 'https://proxy.example.com/',
        ANTHROPIC_VERSION: '2023-06-01',
      }));
      fetchFn.mockResolvedValue(jsonResponse(message()));

      await strategy.complete(user);

      expect(lastRequest().url).toBe('https://proxy.example.com/v1/messages');
      expect(lastRequest().headers['anthropic-version']).toBe('2023-06-01');
    });

    it('should throw a terminal LLMError without calling the API when the key is absent', async () => {
      strategy = new AnthropicStrategy(new ConfigService({}), fetchFn);

      const error = await strategy.complete(user).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(LLMError);
      expect(error).toMatchObject({ retryable: false });
      expect((error as Error).message).toContain('ANTHROPIC_API_KEY');
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('should normalise an OpenRouter model id and send the token cap', async () => {
      fetchFn.mockResolvedValue(jsonResponse(message()));

      await strategy.complete(user, {
        model: 'anthropic/claude-sonnet-5.5',
        max_tokens: 512,
      });

      expect(lastRequest().body).toMatchObject({
        model: 'claude-sonnet-5-5',
        max_tokens: 512,
      });
    });

    it('should fall back to Haiku 5.5 and a default token cap when neither is given', async () => {
      fetchFn.mockResolvedValue(jsonResponse(message()));

      await strategy.complete(user);

      expect(lastRequest().body.model).toBe('claude-haiku-5-5');
      expect(lastRequest().body.max_tokens).toBe(8192);
    });

    it('should throw a terminal LLMError when the model is not a Claude model', async () => {
      const error = await strategy
        .complete(user, { model: 'openai/gpt-5-mini' })
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ name: 'LLMError', retryable: false });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('should never send temperature when the caller sets one', async () => {
      fetchFn.mockResolvedValue(jsonResponse(message()));

      await strategy.complete(user, { temperature: 0.2 });

      expect(lastRequest().body).not.toHaveProperty('temperature');
    });

    it('should send exactly model, max_tokens and messages when no option is set', async () => {
      fetchFn.mockResolvedValue(jsonResponse(message()));

      await strategy.complete(user);

      expect(Object.keys(lastRequest().body).sort()).toEqual([
        'max_tokens',
        'messages',
        'model',
      ]);
    });

    it.each([
      ['high', 'high'],
      ['max', 'max'],
      ['low', 'low'],
      ['minimal', 'low'],
      ['none', 'low'],
    ] as const)(
      'should send output_config.effort %p as %p',
      async (effort, sent) => {
        fetchFn.mockResolvedValue(jsonResponse(message()));

        await strategy.complete(user, { reasoningEffort: effort });

        expect(lastRequest().body.output_config).toEqual({ effort: sent });
      },
    );

    it('should constrain the answer to the Zod schema through output_config.format', async () => {
      fetchFn.mockResolvedValue(jsonResponse(message()));
      const schema = z.object({
        title: z.string().min(3).max(80),
        count: z.number().int().min(1).max(4),
        tags: z.array(z.string()).min(2).max(5),
        kind: z.discriminatedUnion('type', [
          z.object({ type: z.literal('a'), minimum: z.string() }),
          z.object({ type: z.literal('b') }),
        ]),
        note: z.string().optional(),
      });

      await strategy.complete(user, {
        reasoningEffort: 'low',
        responseSchema: { name: 'artifact', schema },
      });

      const outputConfig = lastRequest().body.output_config!;
      expect(outputConfig.effort).toBe('low');
      expect(outputConfig.format!.type).toBe('json_schema');
      const sent = outputConfig.format!.schema;
      expect(sent).not.toHaveProperty('$schema');
      expect(sent.additionalProperties).toBe(false);
      expect(sent.required).toEqual(['title', 'count', 'tags', 'kind']);
      const properties = sent.properties as Record<
        string,
        Record<string, unknown>
      >;
      expect(properties.title).toEqual({ type: 'string' });
      expect(properties.count).not.toHaveProperty('minimum');
      expect(properties.count).not.toHaveProperty('maximum');
      expect(properties.tags).toEqual({
        type: 'array',
        items: { type: 'string' },
      });
      const arms = properties.kind.anyOf as Array<Record<string, unknown>>;
      expect(properties.kind).not.toHaveProperty('oneOf');
      expect(arms).toHaveLength(2);
      for (const arm of arms) expect(arm.additionalProperties).toBe(false);
      // A property named like a keyword is a property, not a constraint.
      expect(arms[0].properties).toHaveProperty('minimum');
    });

    it('should hoist system messages into the top-level system prompt', async () => {
      fetchFn.mockResolvedValue(jsonResponse(message()));

      await strategy.complete([
        { role: MessageRole.System, content: 'be terse' },
        { role: MessageRole.User, content: 'hi' },
      ]);

      expect(lastRequest().body.system).toBe('be terse');
      expect(lastRequest().body.messages).toEqual([
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ]);
    });

    it('should join the text blocks and skip thinking blocks when reading the answer', async () => {
      fetchFn.mockResolvedValue(
        jsonResponse(
          message({
            content: [
              { type: 'thinking', thinking: '', signature: 'sig' },
              { type: 'text', text: 'one ' },
              { type: 'text', text: 'two' },
            ],
          }),
        ),
      );

      const result = await strategy.complete(user);

      expect(result.text).toBe('one two');
    });

    it('should report a cut-off with no text as length rather than an error', async () => {
      fetchFn.mockResolvedValue(
        jsonResponse(
          message({
            content: [{ type: 'thinking', thinking: '', signature: 's' }],
            stop_reason: 'max_tokens',
          }),
        ),
      );

      await expect(strategy.complete(user)).resolves.toMatchObject({
        text: '',
        finishReason: 'length',
        model: 'claude-haiku-5-5',
      });
    });

    it('should report a cut-off with text as length', async () => {
      fetchFn.mockResolvedValue(
        jsonResponse(message({ stop_reason: 'max_tokens' })),
      );

      await expect(strategy.complete(user)).resolves.toMatchObject({
        text: 'hello',
        finishReason: 'length',
      });
    });

    it('should keep a stop reason it does not map', async () => {
      fetchFn.mockResolvedValue(
        jsonResponse(message({ stop_reason: 'stop_sequence' })),
      );

      await expect(strategy.complete(user)).resolves.toMatchObject({
        finishReason: 'stop_sequence',
      });
    });

    it('should throw a terminal LLMError when the model returns no text', async () => {
      fetchFn.mockResolvedValue(jsonResponse(message({ content: [] })));

      await expect(strategy.complete(user)).rejects.toMatchObject({
        name: 'LLMError',
        retryable: false,
      });
    });

    it('should throw a terminal LLMError when the model refuses', async () => {
      fetchFn.mockResolvedValue(
        jsonResponse(message({ stop_reason: 'refusal' })),
      );

      const error = await strategy.complete(user).catch((e: unknown) => e);

      expect(error).toMatchObject({ name: 'LLMError', retryable: false });
      expect((error as Error).message).toContain('refused');
    });

    it('should map cache tokens into usage and price them', async () => {
      fetchFn.mockResolvedValue(
        jsonResponse(
          message({
            usage: {
              input_tokens: 1_000,
              output_tokens: 0,
              cache_read_input_tokens: 10_000,
              cache_creation_input_tokens: 4_000,
            },
          }),
        ),
      );

      const { usage } = await strategy.complete(user);

      expect(usage).toMatchObject({
        promptTokens: 15_000,
        completionTokens: 0,
        totalTokens: 15_000,
        cachedTokens: 10_000,
        cacheWriteTokens: 4_000,
      });
      expect(usage.cost).toBeCloseTo(0.0007, 10);
    });

    it('should omit cache and search counts the response does not report', async () => {
      fetchFn.mockResolvedValue(jsonResponse(message()));

      const { usage } = await strategy.complete(user);

      expect(usage).not.toHaveProperty('cachedTokens');
      expect(usage).not.toHaveProperty('cacheWriteTokens');
      expect(usage).not.toHaveProperty('webSearchRequests');
      expect(usage).not.toHaveProperty('reasoningTokens');
    });

    it('should report a zero cost and warn once when the model has no price', async () => {
      const warn = jest
        .spyOn(strategy['logger'], 'warn')
        .mockImplementation(() => undefined);
      fetchFn.mockImplementation(() =>
        Promise.resolve(jsonResponse(message({ model: 'claude-haiku-4-5' }))),
      );

      const first = await strategy.complete(user, {
        model: 'claude-haiku-4-5',
      });
      await strategy.complete(user, { model: 'claude-haiku-4-5' });

      expect(first.usage.cost).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('claude-haiku-4-5');
    });

    it('should return a fresh usage object each time, so callers can accumulate into it', async () => {
      fetchFn.mockImplementation(() =>
        Promise.resolve(jsonResponse(message())),
      );

      const a = await strategy.complete(user);
      const b = await strategy.complete(user);

      expect(a.usage).not.toBe(b.usage);
    });
  });

  describe('message mapping', () => {
    it('should send assistant tool calls as tool_use blocks and merge consecutive tool results into one user turn', async () => {
      fetchFn.mockResolvedValue(jsonResponse(message()));

      await strategy.complete([
        { role: MessageRole.User, content: 'research' },
        {
          role: MessageRole.Assistant,
          content: 'searching',
          toolCalls: [
            { id: 'toolu_1', name: 'searchWeb', input: { query: 'a' } },
            { id: 'toolu_2', name: 'searchWeb', input: { query: 'b' } },
          ],
        },
        { role: MessageRole.Tool, toolCallId: 'toolu_1', content: '{"r":1}' },
        { role: MessageRole.Tool, toolCallId: 'toolu_2', content: '{"r":2}' },
      ]);

      expect(lastRequest().body.messages).toEqual([
        { role: 'user', content: [{ type: 'text', text: 'research' }] },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'searching' },
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'searchWeb',
              input: { query: 'a' },
            },
            {
              type: 'tool_use',
              id: 'toolu_2',
              name: 'searchWeb',
              input: { query: 'b' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"r":1}' },
            { type: 'tool_result', tool_use_id: 'toolu_2', content: '{"r":2}' },
          ],
        },
      ]);
    });

    it('should leave out empty assistant prose when the turn only calls tools', async () => {
      fetchFn.mockResolvedValue(jsonResponse(message()));

      await strategy.complete([
        { role: MessageRole.User, content: 'go' },
        {
          role: MessageRole.Assistant,
          toolCalls: [{ id: 't1', name: 'searchWeb', input: {} }],
        },
        { role: MessageRole.Tool, toolCallId: 't1', content: 'ok' },
      ]);

      expect(lastRequest().body.messages[1].content).toEqual([
        { type: 'tool_use', id: 't1', name: 'searchWeb', input: {} },
      ]);
    });

    it("should re-send an assistant turn's provider content verbatim when it has some", async () => {
      fetchFn.mockResolvedValue(jsonResponse(message()));
      const blocks = [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'tool_use', id: 't1', name: 'searchWeb', input: { q: 1 } },
      ];

      await strategy.complete([
        { role: MessageRole.User, content: 'go' },
        {
          role: MessageRole.Assistant,
          toolCalls: [{ id: 't1', name: 'searchWeb', input: { q: 1 } }],
          providerContent: blocks,
        },
        { role: MessageRole.Tool, toolCallId: 't1', content: 'ok' },
      ]);

      expect(lastRequest().body.messages[1]).toEqual({
        role: 'assistant',
        content: blocks,
      });
    });
  });

  describe('completeWithTools', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'searchWeb',
        description: 'Search the web',
        parameters: z.object({ query: z.string().min(1) }),
      },
    ];

    it('should send each tool as name, description and input_schema without $schema', async () => {
      fetchFn.mockResolvedValue(jsonResponse(message()));

      await strategy.completeWithTools(user, tools);

      expect(lastRequest().body.tools).toEqual([
        {
          name: 'searchWeb',
          description: 'Search the web',
          input_schema: {
            type: 'object',
            properties: { query: { type: 'string', minLength: 1 } },
            required: ['query'],
          },
        },
      ]);
      expect(lastRequest().body).not.toHaveProperty('tool_choice');
    });

    it('should omit the tools key when given an empty tool list', async () => {
      fetchFn.mockResolvedValue(jsonResponse(message()));

      await strategy.completeWithTools(user, []);

      expect(lastRequest().body).not.toHaveProperty('tools');
    });

    it('should return the tool calls, usage, model and raw content when the model calls a tool', async () => {
      const content = [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: 'Let me look.' },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'searchWeb',
          input: { query: 'nest' },
        },
      ];
      fetchFn.mockResolvedValue(
        jsonResponse(message({ content, stop_reason: 'tool_use' })),
      );

      const result = await strategy.completeWithTools(user, tools);

      expect(result).toMatchObject({
        text: 'Let me look.',
        toolCalls: [
          { id: 'toolu_1', name: 'searchWeb', input: { query: 'nest' } },
        ],
        model: 'claude-haiku-5-5',
        providerContent: content,
      });
      expect(result.usage.promptTokens).toBe(10_000);
    });

    it('should return no tool calls and the text when the model answers directly', async () => {
      fetchFn.mockResolvedValue(jsonResponse(message()));

      const result = await strategy.completeWithTools(user, tools);

      expect(result.toolCalls).toEqual([]);
      expect(result.text).toBe('hello');
    });

    it('should omit text when the turn has no prose', async () => {
      fetchFn.mockResolvedValue(
        jsonResponse(
          message({
            content: [
              { type: 'tool_use', id: 't', name: 'searchWeb', input: {} },
            ],
            stop_reason: 'tool_use',
          }),
        ),
      );

      const result = await strategy.completeWithTools(user, tools);

      expect(result).not.toHaveProperty('text');
    });

    it('should throw a retryable LLMError when a tool call is cut off at the token cap', async () => {
      fetchFn.mockResolvedValue(
        jsonResponse(
          message({
            content: [
              { type: 'tool_use', id: 't', name: 'searchWeb', input: {} },
            ],
            stop_reason: 'max_tokens',
          }),
        ),
      );

      await expect(
        strategy.completeWithTools(user, tools),
      ).rejects.toMatchObject({ name: 'LLMError', retryable: true });
    });

    it('should throw a terminal LLMError when the model refuses', async () => {
      fetchFn.mockResolvedValue(
        jsonResponse(message({ stop_reason: 'refusal' })),
      );

      await expect(
        strategy.completeWithTools(user, tools),
      ).rejects.toMatchObject({ retryable: false });
    });
  });

  describe('web search', () => {
    const searched = (overrides: Record<string, unknown> = {}) =>
      message({
        content: [
          {
            type: 'server_tool_use',
            id: 'srvtoolu_1',
            name: 'web_search',
            input: { query: 'heat pumps 2026' },
          },
          {
            type: 'web_search_tool_result',
            tool_use_id: 'srvtoolu_1',
            content: [
              {
                type: 'web_search_result',
                url: 'https://a.example/1',
                title: 'A one',
                encrypted_content: 'x',
              },
            ],
          },
          {
            type: 'text',
            text: 'Sales rose.',
            citations: [
              {
                type: 'web_search_result_location',
                url: 'https://a.example/1',
                title: 'A one',
                cited_text: 'rose',
                encrypted_index: 'e',
              },
            ],
          },
          {
            type: 'text',
            text: ' Again.',
            citations: [
              {
                type: 'web_search_result_location',
                url: 'https://a.example/1',
                title: 'A one',
                cited_text: 'again',
                encrypted_index: 'e',
              },
              {
                type: 'web_search_result_location',
                url: 'https://b.example/2',
                title: 'B two',
                cited_text: 'b',
                encrypted_index: 'e',
              },
            ],
          },
        ],
        usage: {
          input_tokens: 20_000,
          output_tokens: 1_000,
          server_tool_use: { web_search_requests: 2 },
        },
        ...overrides,
      });

    it('should add the basic web search tool with its limits when the model is Haiku', async () => {
      fetchFn.mockResolvedValue(jsonResponse(searched()));

      await strategy.complete(user, {
        webSearch: { maxUses: 3, allowedDomains: ['a.example'] },
      });

      expect(lastRequest().body.tools).toEqual([
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 3,
          allowed_domains: ['a.example'],
        },
      ]);
    });

    it('should add the dynamic-filtering web search tool after the custom tools when the model supports it', async () => {
      fetchFn.mockResolvedValue(jsonResponse(searched()));

      await strategy.completeWithTools(
        user,
        [
          {
            name: 'noop',
            description: 'nothing',
            parameters: z.object({}),
          },
        ],
        {
          model: 'claude-opus-5-5',
          webSearch: { maxUses: 2, blockedDomains: ['spam.example'] },
        },
      );

      const sentTools = lastRequest().body.tools!;
      expect(sentTools[0]).toMatchObject({ name: 'noop' });
      expect(sentTools[1]).toEqual({
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: 2,
        blocked_domains: ['spam.example'],
      });
    });

    it('should throw a terminal LLMError when both allowed and blocked domains are set', async () => {
      const error = await strategy
        .complete(user, {
          webSearch: {
            maxUses: 1,
            allowedDomains: ['a.example'],
            blockedDomains: ['b.example'],
          },
        })
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ name: 'LLMError', retryable: false });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('should return the cited pages deduped, the search count, and a cost that includes the searches', async () => {
      fetchFn.mockResolvedValue(jsonResponse(searched()));

      const result = await strategy.complete(user, {
        webSearch: { maxUses: 3 },
      });

      expect(result.text).toBe('Sales rose. Again.');
      expect(result.citations).toEqual([
        { url: 'https://a.example/1', title: 'A one' },
        { url: 'https://b.example/2', title: 'B two' },
      ]);
      expect(result.usage.webSearchRequests).toBe(2);
      // 20k * 0.10 + 1k * 0.50 per MTok, plus 2 * $0.01
      expect(result.usage.cost).toBeCloseTo(0.002 + 0.0005 + 0.02, 10);
    });

    it('should omit citations when the model cited nothing', async () => {
      fetchFn.mockResolvedValue(jsonResponse(message()));

      const result = await strategy.complete(user);

      expect(result).not.toHaveProperty('citations');
    });

    it('should re-send the paused turn and join both parts when the model pauses', async () => {
      const paused = message({
        content: [
          {
            type: 'server_tool_use',
            id: 'srvtoolu_1',
            name: 'web_search',
            input: { query: 'q' },
          },
        ],
        stop_reason: 'pause_turn',
        usage: {
          input_tokens: 1_000,
          output_tokens: 100,
          server_tool_use: { web_search_requests: 1 },
        },
      });
      fetchFn
        .mockResolvedValueOnce(jsonResponse(paused))
        .mockResolvedValueOnce(jsonResponse(searched()));

      const result = await strategy.complete(user, {
        webSearch: { maxUses: 3 },
      });

      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(requestAt(1).body.messages).toEqual([
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: paused.content },
      ]);
      expect(result.text).toBe('Sales rose. Again.');
      expect(result.usage.webSearchRequests).toBe(3);
      expect(result.usage.promptTokens).toBe(21_000);
      expect(result.finishReason).toBe('stop');
    });

    const pausedAfter = (searches: number) =>
      message({
        content: [{ type: 'text', text: 'partial' }],
        stop_reason: 'pause_turn',
        usage: {
          input_tokens: 1_000,
          output_tokens: 100,
          server_tool_use: { web_search_requests: searches },
        },
      });

    it('should send only the unspent searches when it re-sends a paused turn', async () => {
      fetchFn
        .mockResolvedValueOnce(jsonResponse(pausedAfter(2)))
        .mockResolvedValueOnce(jsonResponse(searched()));

      await strategy.complete(user, { webSearch: { maxUses: 5 } });

      expect(requestAt(0).body.tools![0]).toMatchObject({ max_uses: 5 });
      expect(requestAt(1).body.tools![0]).toMatchObject({ max_uses: 3 });
    });

    it('should return the paused turn instead of re-sending when the paused turn spent every search', async () => {
      fetchFn.mockResolvedValue(jsonResponse(pausedAfter(3)));

      const result = await strategy.complete(user, {
        webSearch: { maxUses: 3 },
      });

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result.finishReason).toBe('pause_turn');
    });

    it('should stop re-sending after five continuations when the model keeps pausing', async () => {
      fetchFn.mockImplementation(() =>
        Promise.resolve(
          jsonResponse(
            message({
              content: [{ type: 'text', text: 'partial' }],
              stop_reason: 'pause_turn',
            }),
          ),
        ),
      );

      const result = await strategy.complete(user, {
        webSearch: { maxUses: 3 },
      });

      expect(fetchFn).toHaveBeenCalledTimes(6);
      expect(result.finishReason).toBe('pause_turn');
    });
  });

  describe('error classification', () => {
    it.each([
      [429, 'rate_limit_error'],
      [500, 'api_error'],
      [529, 'overloaded_error'],
    ])(
      'should surface a %i as a retryable LLMError when no try is left',
      async (status, type) => {
        ({ strategy } = makeStrategy({ ANTHROPIC_MAX_ATTEMPTS: '1' }));
        fetchFn.mockResolvedValue(apiError(status, type));

        const error = await strategy.complete(user).catch((e: unknown) => e);

        expect(error).toMatchObject({
          name: 'LLMError',
          retryable: true,
          statusCode: status,
          message: `${type} happened`,
        });
      },
    );

    it.each([
      [400, 'invalid_request_error'],
      [401, 'authentication_error'],
      [413, 'request_too_large'],
    ])('should surface a %i as a terminal LLMError', async (status, type) => {
      fetchFn.mockResolvedValue(apiError(status, type));

      const error = await strategy.complete(user).catch((e: unknown) => e);

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(error).toMatchObject({ retryable: false, statusCode: status });
    });

    it('should classify a network failure as retryable', async () => {
      ({ strategy } = makeStrategy({ ANTHROPIC_MAX_ATTEMPTS: '1' }));
      fetchFn.mockRejectedValue(new TypeError('fetch failed'));

      await expect(strategy.complete(user)).rejects.toMatchObject({
        name: 'LLMError',
        retryable: true,
      });
    });

    it('should classify a body that is not JSON as retryable', async () => {
      ({ strategy } = makeStrategy({ ANTHROPIC_MAX_ATTEMPTS: '1' }));
      fetchFn.mockResolvedValue(new Response('<html>', { status: 200 }));

      await expect(strategy.complete(user)).rejects.toMatchObject({
        retryable: true,
      });
    });
  });

  describe('retries', () => {
    let random: jest.SpyInstance;

    beforeEach(() => {
      jest.useFakeTimers({
        doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
      });
      random = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    });

    afterEach(() => {
      random.mockRestore();
      jest.useRealTimers();
    });

    const settle = <T>(
      promise: Promise<T>,
    ): Promise<{ value?: T; error?: unknown }> =>
      promise.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );

    it('should retry after full jitter and return the answer when a 529 is followed by a success', async () => {
      fetchFn
        .mockResolvedValueOnce(apiError(529, 'overloaded_error'))
        .mockResolvedValueOnce(jsonResponse(message()));

      const outcome = settle(strategy.complete(user));
      await jest.advanceTimersByTimeAsync(499);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);

      expect((await outcome).value).toMatchObject({ text: 'hello' });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('should wait for retry-after instead of the jitter when a 429 sends one', async () => {
      fetchFn
        .mockResolvedValueOnce(
          apiError(429, 'rate_limit_error', { 'retry-after': '3' }),
        )
        .mockResolvedValueOnce(jsonResponse(message()));

      const outcome = settle(strategy.complete(user));
      await jest.advanceTimersByTimeAsync(2_999);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);

      await expect(outcome).resolves.toHaveProperty('value');
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('should end a hung try at the per-try timeout and run the next one', async () => {
      ({ strategy } = makeStrategy({ ANTHROPIC_TIMEOUT_MS: '1000' }));
      fetchFn
        .mockImplementationOnce(
          (_url, init) =>
            new Promise((_resolve, reject) => {
              init.signal!.addEventListener('abort', () =>
                reject(init.signal!.reason as Error),
              );
            }),
        )
        .mockResolvedValueOnce(jsonResponse(message()));

      const outcome = settle(strategy.complete(user));
      await jest.advanceTimersByTimeAsync(1_000);
      await jest.advanceTimersByTimeAsync(500);

      await expect(outcome).resolves.toHaveProperty('value');
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('should not retry when the caller aborts the call', async () => {
      const controller = new AbortController();
      fetchFn.mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () =>
              reject(init.signal!.reason as Error),
            );
          }),
      );

      const outcome = settle(
        strategy.complete(user, { signal: controller.signal }),
      );
      await jest.advanceTimersByTimeAsync(10);
      controller.abort();
      await jest.runAllTimersAsync();

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect((await outcome).error).toMatchObject({
        name: 'LLMError',
        retryable: false,
      });
    });
  });

  describe('streaming', () => {
    const streamed = (text: string[], stopReason = 'end_turn') => [
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-5-5',
          content: [],
          stop_reason: null,
          usage: { input_tokens: 10_000, output_tokens: 1 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'sig' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'text', text: '' },
      },
      { type: 'ping' },
      ...text.map((piece) => ({
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: piece },
      })),
      { type: 'content_block_stop', index: 1 },
      {
        type: 'message_delta',
        delta: { stop_reason: stopReason },
        usage: { output_tokens: 2_000 },
      },
      { type: 'message_stop' },
    ];

    it('should send stream: true when the call asks for text deltas', async () => {
      fetchFn.mockResolvedValue(sseResponse(streamed(['hi'])));

      await strategy.complete(user, { onTextDelta: jest.fn() });

      expect(lastRequest().body.stream).toBe(true);
    });

    it('should pass each delta and the text so far, and return the whole text with usage, finish reason and model', async () => {
      fetchFn.mockResolvedValue(sseResponse(streamed(['{"a"', ': 1}'])));
      const onTextDelta = jest.fn();

      const result = await strategy.complete(user, { onTextDelta });

      expect(onTextDelta.mock.calls).toEqual([
        ['{"a"', '{"a"'],
        [': 1}', '{"a": 1}'],
      ]);
      expect(result).toMatchObject({
        text: '{"a": 1}',
        finishReason: 'stop',
        model: 'claude-haiku-5-5',
        usage: { promptTokens: 10_000, completionTokens: 2_000 },
      });
      expect(result.usage.cost).toBeCloseTo(0.002, 10);
    });

    it('should return empty text when the stream is cut off at the token cap before any text', async () => {
      const events = streamed([], 'max_tokens').filter((e) => e.index !== 1);
      fetchFn.mockResolvedValue(sseResponse(events));

      await expect(
        strategy.complete(user, { onTextDelta: jest.fn() }),
      ).resolves.toMatchObject({ text: '', finishReason: 'length' });
    });

    it('should retry from empty text when the provider sends an overloaded error mid-stream', async () => {
      ({ strategy } = makeStrategy({ ANTHROPIC_RETRY_BASE_MS: '1' }));
      fetchFn
        .mockResolvedValueOnce(
          sseResponse([
            ...streamed(['lost']).slice(0, 7),
            {
              type: 'error',
              error: { type: 'overloaded_error', message: 'Overloaded' },
            },
          ]),
        )
        .mockResolvedValueOnce(sseResponse(streamed(['kept'])));
      const onTextDelta = jest.fn();

      const result = await strategy.complete(user, { onTextDelta });

      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result.text).toBe('kept');
      expect(onTextDelta).toHaveBeenLastCalledWith('kept', 'kept');
    });

    it('should not retry when the provider sends a client error mid-stream', async () => {
      fetchFn.mockResolvedValue(
        sseResponse([
          streamed([])[0],
          {
            type: 'error',
            error: { type: 'invalid_request_error', message: 'bad' },
          },
        ]),
      );

      await expect(
        strategy.complete(user, { onTextDelta: jest.fn() }),
      ).rejects.toMatchObject({ retryable: false, statusCode: 400 });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('should rebuild streamed tool input and citations into the content blocks', async () => {
      fetchFn.mockResolvedValue(
        sseResponse([
          streamed([])[0],
          {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'server_tool_use',
              id: 'srv_1',
              name: 'web_search',
              input: {},
            },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"query":' },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '"q"}' },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'text', text: '', citations: [] },
          },
          {
            type: 'content_block_delta',
            index: 1,
            delta: {
              type: 'citations_delta',
              citation: {
                type: 'web_search_result_location',
                url: 'https://a.example',
                title: 'A',
              },
            },
          },
          {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'text_delta', text: 'Cited.' },
          },
          { type: 'content_block_stop', index: 1 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: {
              output_tokens: 10,
              server_tool_use: { web_search_requests: 1 },
            },
          },
          { type: 'message_stop' },
        ]),
      );

      const result = await strategy.complete(user, {
        onTextDelta: jest.fn(),
        webSearch: { maxUses: 1 },
      });

      expect(result.text).toBe('Cited.');
      expect(result.citations).toEqual([
        { url: 'https://a.example', title: 'A' },
      ]);
      expect(result.usage.webSearchRequests).toBe(1);
    });

    it('should finish the call when the delta callback throws', async () => {
      jest
        .spyOn(strategy['logger'], 'warn')
        .mockImplementation(() => undefined);
      fetchFn.mockResolvedValue(sseResponse(streamed(['ok'])));

      await expect(
        strategy.complete(user, {
          onTextDelta: () => {
            throw new Error('boom');
          },
        }),
      ).resolves.toMatchObject({ text: 'ok' });
    });

    it('should not stream completeWithTools when it is given a delta callback', async () => {
      fetchFn.mockResolvedValue(jsonResponse(message()));

      await strategy.completeWithTools(user, [], { onTextDelta: jest.fn() });

      expect(lastRequest().body).not.toHaveProperty('stream');
    });
  });

  describe('generateCompletion', () => {
    it('should return only the text, preserving the legacy contract', async () => {
      fetchFn.mockResolvedValue(jsonResponse(message()));

      await expect(strategy.generateCompletion(user)).resolves.toBe('hello');
    });
  });
});
