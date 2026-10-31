import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenRouter } from '@openrouter/sdk';
import type {
  ChatFunctionTool,
  ChatMessages,
  ChatResult,
  ChatStreamChunk,
  ChatUsage,
} from '@openrouter/sdk/models';
import { z } from 'zod';
import {
  CompletionOptions,
  CompletionResult,
  LLMMessage,
  LLMStrategy,
  MessageRole,
  ToolCall,
  ToolDefinition,
  ToolTurnResult,
  Usage,
} from '../interfaces';
import { LLMError, fromStreamError } from '../errors';
import {
  readRetryPolicy,
  sendWithRetries,
  type RetryPolicy,
} from './llm-retry';

const DEFAULT_MODEL = 'openai/gpt-5-mini';

// A fresh object per call: callers accumulate usage across turns by mutation.
const emptyUsage = (): Usage => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cost: 0,
});

/**
 * The call's USD cost. A BYOK call (the provider billed on our own key)
 * reports `cost: 0`, with the provider's real price only in
 * `costDetails.upstreamInferenceCost`; that is used whenever `cost` is zero
 * or missing, so the meter never falls back to token pricing for it.
 */
const reportedCost = (usage: ChatUsage): number => {
  if (usage.cost != null && usage.cost > 0) return usage.cost;
  const upstream = usage.costDetails?.upstreamInferenceCost;
  if (upstream != null && upstream > 0) return upstream;
  return usage.cost ?? 0;
};

/**
 * OpenRouter reports cost, and the reasoning and cache token details, only
 * when the provider supplies them. An absent detail is omitted, not zeroed.
 */
const toUsage = (usage: ChatUsage | undefined, latencyMs: number): Usage => {
  if (!usage) return { ...emptyUsage(), latencyMs };

  const reasoningTokens = usage.completionTokensDetails?.reasoningTokens;
  const cachedTokens = usage.promptTokensDetails?.cachedTokens;
  const cacheWriteTokens = usage.promptTokensDetails?.cacheWriteTokens;
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    cost: reportedCost(usage),
    ...(reasoningTokens != null ? { reasoningTokens } : {}),
    ...(cachedTokens != null ? { cachedTokens } : {}),
    ...(cacheWriteTokens != null ? { cacheWriteTokens } : {}),
    latencyMs,
  };
};

const toChatMessage = (message: LLMMessage): ChatMessages => {
  switch (message.role) {
    case MessageRole.System:
      return { role: 'system', content: message.content };
    case MessageRole.User:
      return { role: 'user', content: message.content };
    case MessageRole.Tool:
      return {
        role: 'tool',
        content: message.content,
        toolCallId: message.toolCallId,
      };
    case MessageRole.Assistant:
      return {
        role: 'assistant',
        // Omit rather than send '': some providers reject an empty content block.
        ...(message.content !== undefined ? { content: message.content } : {}),
        toolCalls: message.toolCalls?.map((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: JSON.stringify(call.input ?? {}),
          },
        })),
      };
  }
};

const toChatTool = (tool: ToolDefinition): ChatFunctionTool => {
  const parameters = z.toJSONSchema(tool.parameters, {
    target: 'draft-7',
    io: 'input',
  });
  // Providers reject the dialect marker inside a function's parameter schema.
  delete parameters.$schema;

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters,
    },
  };
};

/**
 * Adapt Zod's JSON Schema to OpenAI's strict response-format subset:
 * discriminated unions use `anyOf` instead of rejected `oneOf`, and optional
 * properties become required-nullable because strict objects require every
 * property name in `required`. Literal discriminators keep union arms mutually
 * exclusive; the generation parser removes provider null placeholders before
 * applying the unchanged local Zod contract.
 */
const nullableJsonSchema = (
  schema: Record<string, unknown>,
): Record<string, unknown> => {
  const type = schema.type;
  if (typeof type === 'string') {
    return { ...schema, type: [type, 'null'] };
  }
  if (Array.isArray(type)) {
    const types = type as unknown[];
    return {
      ...schema,
      type: types.includes('null') ? types : [...types, 'null'],
    };
  }
  const anyOf = schema.anyOf;
  if (Array.isArray(anyOf)) {
    const variants = anyOf as unknown[];
    return { ...schema, anyOf: [...variants, { type: 'null' }] };
  }
  return { anyOf: [schema, { type: 'null' }] };
};

const toProviderJsonSchema = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(toProviderJsonSchema);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key === 'oneOf' ? 'anyOf' : key,
      toProviderJsonSchema(nested),
    ]),
  );

  const properties = normalized.properties;
  if (
    normalized.type === 'object' &&
    typeof properties === 'object' &&
    properties !== null &&
    !Array.isArray(properties)
  ) {
    const required = new Set(
      Array.isArray(normalized.required)
        ? normalized.required.filter(
            (name): name is string => typeof name === 'string',
          )
        : [],
    );
    const strictProperties = Object.fromEntries(
      Object.entries(properties).map(([name, schema]) => [
        name,
        required.has(name)
          ? schema
          : nullableJsonSchema(schema as Record<string, unknown>),
      ]),
    );
    return {
      ...normalized,
      properties: strictProperties,
      required: Object.keys(strictProperties),
    };
  }

  return normalized;
};

/** Tool arguments arrive as a JSON string the model wrote, so they can be malformed. */
const parseToolArguments = (args: string, toolName: string): unknown => {
  if (args.trim() === '') return {};

  try {
    return JSON.parse(args) as unknown;
  } catch (error) {
    // A resample of the same request may well produce valid JSON.
    throw new LLMError(
      `Model returned malformed arguments for tool "${toolName}"`,
      { retryable: true, cause: error },
    );
  }
};

const readText = (
  content: ChatResult['choices'][number]['message']['content'],
) => (typeof content === 'string' ? content : undefined);

/** The model that answered, when the provider says; absent is omitted. */
const reportedModel = (result: ChatResult): { model?: string } =>
  result.model ? { model: result.model } : {};

@Injectable()
export class OpenRouterStrategy implements LLMStrategy {
  private readonly logger = new Logger(OpenRouterStrategy.name);
  private client: OpenRouter;
  private readonly retry: RetryPolicy;

  constructor(private config: ConfigService) {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
    if (!apiKey)
      throw new InternalServerErrorException(
        'OPENROUTER_API_KEY was not configured',
      );
    // A bad OPENROUTER_* retry key throws here, which fails boot.
    this.retry = readRetryPolicy(this.config);
    // The SDK's retry loop shares one timeout across every try and skips 429s;
    // `send` retries instead.
    this.client = new OpenRouter({
      apiKey,
      retryConfig: { strategy: 'none' },
    });
  }

  async complete(
    messages: Array<LLMMessage>,
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    const { result, latencyMs } = await this.send(messages, options);
    const choice = result.choices[0];
    const text = readText(choice?.message?.content);

    // A call cut off at the token cap before any text (reasoning can spend the
    // whole budget) is still a cut-off, and its turn was still spent. The
    // caller reads `finishReason` before it looks at the text.
    if (text === undefined && choice?.finishReason === 'length') {
      return {
        text: '',
        usage: toUsage(result.usage, latencyMs),
        finishReason: choice.finishReason,
        ...reportedModel(result),
      };
    }

    if (text === undefined) {
      throw new LLMError('OpenRouter returned no text content', {
        retryable: false,
      });
    }

    return {
      text,
      usage: toUsage(result.usage, latencyMs),
      ...(choice?.finishReason ? { finishReason: choice.finishReason } : {}),
      ...reportedModel(result),
    };
  }

  async completeWithTools(
    messages: Array<LLMMessage>,
    tools: Array<ToolDefinition>,
    options?: CompletionOptions,
  ): Promise<ToolTurnResult> {
    const { result, latencyMs } = await this.send(messages, options, tools);
    const message = result.choices[0]?.message;

    const toolCalls: ToolCall[] = (message?.toolCalls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      input: parseToolArguments(call.function.arguments, call.function.name),
    }));

    const text = readText(message?.content);

    return {
      // A tool-calling turn usually has no prose; omit the key rather than pass ''.
      ...(text ? { text } : {}),
      toolCalls,
      usage: toUsage(result.usage, latencyMs),
      ...reportedModel(result),
    };
  }

  /** @deprecated Use `complete`, which also reports usage. */
  async generateCompletion(
    messages: Array<LLMMessage>,
    options?: CompletionOptions,
  ): Promise<string> {
    const { text } = await this.complete(messages, options);
    return text;
  }

  private async send(
    messages: Array<LLMMessage>,
    options?: CompletionOptions,
    tools?: Array<ToolDefinition>,
  ): Promise<{ result: ChatResult; latencyMs: number }> {
    if (options?.webSearch) {
      throw new LLMError(
        'OpenRouter does not run model web search; set LLM_PROVIDER=anthropic to use CompletionOptions.webSearch',
        { retryable: false },
      );
    }

    const responseJsonSchema = options?.responseSchema
      ? (toProviderJsonSchema(
          z.toJSONSchema(options.responseSchema.schema, {
            target: 'draft-7',
            io: 'output',
          }),
        ) as Record<string, unknown>)
      : undefined;
    if (responseJsonSchema) {
      delete responseJsonSchema.$schema;
    }

    // Built outside the try: a fault in our own conversion is not a provider fault.
    const chatRequest = {
      model: options?.model || DEFAULT_MODEL,
      maxTokens: options?.max_tokens,
      temperature: options?.temperature,
      messages: messages.map(toChatMessage),
      ...(tools?.length ? { tools: tools.map(toChatTool) } : {}),
      ...(options?.responseSchema && responseJsonSchema
        ? {
            responseFormat: {
              type: 'json_schema' as const,
              jsonSchema: {
                name: options.responseSchema.name,
                strict: true,
                schema: responseJsonSchema,
              },
            },
            provider: { requireParameters: true },
          }
        : {}),
      ...(options?.reasoningEffort
        ? { reasoning: { effort: options.reasoningEffort } }
        : {}),
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
      stream: false as const,
    };

    const retry = {
      label: 'OpenRouter',
      policy: this.retry,
      logger: this.logger,
    };
    const onTextDelta = tools ? undefined : options?.onTextDelta;
    if (onTextDelta) {
      return sendWithRetries(
        retry,
        (signal) =>
          this.streamOnce(
            { ...chatRequest, stream: true },
            signal,
            onTextDelta,
          ),
        options,
      );
    }

    return sendWithRetries(
      retry,
      (signal) => this.client.chat.send({ chatRequest }, { signal }),
      options,
    );
  }

  /**
   * One streamed try, gathered back into the `ChatResult` a non-streamed try
   * returns. The per-try timeout covers the whole stream, and there is no
   * shorter idle timer: a reasoning model sends nothing while it thinks. A
   * provider error mid-stream is classified as an HTTP status would be. A
   * delta callback that throws loses its preview, never the call.
   */
  private async streamOnce(
    chatRequest: Parameters<OpenRouter['chat']['send']>[0]['chatRequest'] & {
      stream: true;
    },
    signal: AbortSignal,
    onTextDelta: (delta: string, text: string) => void,
  ): Promise<ChatResult> {
    const stream = await this.client.chat.send({ chatRequest }, { signal });
    let text = '';
    let finishReason: ChatResult['choices'][number]['finishReason'] = null;
    let usage: ChatUsage | undefined;
    let last: ChatStreamChunk | undefined;

    for await (const chunk of stream) {
      if (chunk.error) throw fromStreamError(chunk.error);
      last = chunk;
      usage = chunk.usage ?? usage;
      const choice = chunk.choices[0];
      finishReason = choice?.finishReason ?? finishReason;
      const delta = choice?.delta?.content;
      if (!delta) continue;
      text += delta;
      try {
        onTextDelta(delta, text);
      } catch (error: unknown) {
        this.logger.warn(
          `A text delta callback failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      id: last?.id ?? '',
      created: last?.created ?? 0,
      model: last?.model ?? '',
      object: 'chat.completion',
      systemFingerprint: null,
      choices: [
        {
          index: 0,
          finishReason,
          // No text reads as no content, as it does unstreamed.
          message: { role: 'assistant', content: text === '' ? null : text },
        },
      ],
      ...(usage ? { usage } : {}),
    };
  }
}
