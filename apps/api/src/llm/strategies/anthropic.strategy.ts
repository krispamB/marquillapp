import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { toAnthropicModelId, webSearchToolType } from '../anthropic-model';
import { anthropicCostUsd } from '../anthropic-pricing';
import { LLMError, fromStreamError } from '../errors';
import {
  CompletionOptions,
  CompletionResult,
  LLMMessage,
  LLMStrategy,
  MessageRole,
  ReasoningEffort,
  ToolCall,
  ToolDefinition,
  ToolTurnResult,
  Usage,
  WebCitation,
  WebSearchOptions,
} from '../interfaces';
import {
  readRetryPolicy,
  sendWithRetries,
  type RetryPolicy,
} from './llm-retry';

/** `fetch`, injectable so specs never touch the network. */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** Nest token for a replacement `fetch`; unset uses the global one. */
export const ANTHROPIC_FETCH = Symbol('ANTHROPIC_FETCH');

const DEFAULT_MODEL = 'claude-haiku-5-5';
/** The Messages API requires `max_tokens`; callers usually set it. */
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
/**
 * The newest API version. It rejects `temperature`, `top_p` and `top_k`, so
 * this strategy never sends them (see `docs/anthropic-provider-design.md`).
 */
const DEFAULT_API_VERSION = '2026-10-21';
/**
 * A server-tool turn (web search) the API paused is re-sent this many times
 * at most; after that the call returns what it has, `finishReason:
 * 'pause_turn'`.
 */
const MAX_PAUSE_CONTINUATIONS = 5;

/** Anthropic's effort ladder. The app's `minimal` and `none` map to `low`. */
const toAnthropicEffort = (effort: ReasoningEffort): string =>
  effort === 'minimal' || effort === 'none' ? 'low' : effort;

/** A content block, typed only as far as this strategy reads it. */
interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

interface AnthropicUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

interface AnthropicMessage {
  model?: string;
  content: ContentBlock[];
  stop_reason?: string | null;
  usage?: AnthropicUsage;
}

interface RequestMessage {
  role: 'user' | 'assistant';
  content: unknown[];
}

interface MessagesRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: RequestMessage[];
  tools?: Array<Record<string, unknown>>;
  output_config?: Record<string, unknown>;
}

/** Everything a call produced, every paused-and-resumed response joined. */
interface Turn {
  model: string;
  content: ContentBlock[];
  stopReason?: string;
  usage: Usage;
}

/** Error `type` in an error body or `error` event, as an HTTP status. */
const ERROR_TYPE_STATUS: Record<string, number> = {
  invalid_request_error: 400,
  authentication_error: 401,
  billing_error: 402,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  timeout_error: 504,
  overloaded_error: 529,
};

const FINISH_REASONS: Record<string, string> = {
  end_turn: 'stop',
  max_tokens: 'length',
};

const toFinishReason = (stopReason: string | undefined): string | undefined =>
  stopReason === undefined
    ? undefined
    : (FINISH_REASONS[stopReason] ?? stopReason);

/**
 * `LLMMessage`s as the Messages API takes them: system messages joined into
 * the top-level `system`, tool calls as `tool_use` blocks, tool results as
 * `tool_result` blocks, and consecutive turns of the same role merged into
 * one, so a turn's tool results go back in a single user message. An
 * assistant turn that kept its provider content is re-sent verbatim.
 */
export const toAnthropicMessages = (
  messages: LLMMessage[],
): { system?: string; messages: RequestMessage[] } => {
  const system: string[] = [];
  const out: RequestMessage[] = [];
  const push = (role: RequestMessage['role'], blocks: unknown[]) => {
    if (blocks.length === 0) return;
    const last = out[out.length - 1];
    if (last?.role === role) last.content.push(...blocks);
    else out.push({ role, content: [...blocks] });
  };

  for (const message of messages) {
    switch (message.role) {
      case MessageRole.System:
        system.push(message.content);
        break;
      case MessageRole.User:
        push('user', [{ type: 'text', text: message.content }]);
        break;
      case MessageRole.Tool:
        push('user', [
          {
            type: 'tool_result',
            tool_use_id: message.toolCallId,
            content: message.content,
          },
        ]);
        break;
      case MessageRole.Assistant: {
        if (message.providerContent?.length) {
          push('assistant', message.providerContent);
          break;
        }
        const blocks: unknown[] = [];
        // The API rejects an empty text block.
        if (message.content && message.content.trim() !== '') {
          blocks.push({ type: 'text', text: message.content });
        }
        for (const call of message.toolCalls ?? []) {
          blocks.push({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: call.input ?? {},
          });
        }
        push('assistant', blocks);
        break;
      }
    }
  }

  return {
    ...(system.length ? { system: system.join('\n\n') } : {}),
    messages: out,
  };
};

const toAnthropicTool = (tool: ToolDefinition): Record<string, unknown> => {
  const inputSchema = z.toJSONSchema(tool.parameters, { io: 'input' });
  delete inputSchema.$schema;
  return {
    name: tool.name,
    description: tool.description,
    input_schema: inputSchema,
  };
};

/** Keywords structured outputs rejects; the local Zod parse still checks them. */
const UNSUPPORTED_KEYWORDS = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
]);
const SUPPORTED_FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);
/** Keywords whose value is a map of name to schema. */
const SCHEMA_MAPS = new Set([
  'properties',
  '$defs',
  'definitions',
  'patternProperties',
]);
/** Keywords whose value is a schema, or a list of them. */
const SCHEMA_VALUES = new Set([
  'items',
  'additionalProperties',
  'not',
  'anyOf',
  'allOf',
  'oneOf',
  'prefixItems',
]);

/**
 * Zod's JSON Schema in the subset structured outputs accepts: `oneOf`
 * becomes `anyOf`, every object is closed (`additionalProperties: false`),
 * and the numeric, length and complex array constraints and unknown formats
 * are dropped (`minItems` 0 or 1 stays). `ResponseParserService` still
 * validates the answer with the unchanged Zod schema.
 */
export const toAnthropicJsonSchema = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(toAnthropicJsonSchema);
  if (typeof node !== 'object' || node === null) return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    if (key === 'minItems' && !(value === 0 || value === 1)) continue;
    if (key === 'format' && !SUPPORTED_FORMATS.has(String(value))) continue;
    if (SCHEMA_MAPS.has(key) && typeof value === 'object' && value !== null) {
      out[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(
          ([name, schema]) => [name, toAnthropicJsonSchema(schema)],
        ),
      );
      continue;
    }
    if (SCHEMA_VALUES.has(key)) {
      out[key === 'oneOf' ? 'anyOf' : key] = toAnthropicJsonSchema(value);
      continue;
    }
    out[key] = value;
  }
  if (out.type === 'object' || out.properties !== undefined) {
    out.additionalProperties = false;
  }
  return out;
};

const toWebSearchTool = (
  model: string,
  search: WebSearchOptions,
): Record<string, unknown> => {
  if (search.allowedDomains?.length && search.blockedDomains?.length) {
    throw new LLMError(
      'webSearch takes allowedDomains or blockedDomains, not both',
      { retryable: false },
    );
  }
  return {
    type: webSearchToolType(model),
    name: 'web_search',
    max_uses: search.maxUses,
    ...(search.allowedDomains?.length
      ? { allowed_domains: search.allowedDomains }
      : {}),
    ...(search.blockedDomains?.length
      ? { blocked_domains: search.blockedDomains }
      : {}),
  };
};

const textOf = (content: ContentBlock[]): string | undefined => {
  const texts = content.filter((block) => block.type === 'text');
  return texts.length === 0
    ? undefined
    : texts.map((block) => str(block.text)).join('');
};

/** Pages the text blocks cite, deduped by URL, first title kept. */
const citationsOf = (content: ContentBlock[]): WebCitation[] => {
  const byUrl = new Map<string, WebCitation>();
  for (const block of content) {
    if (block.type !== 'text' || !Array.isArray(block.citations)) continue;
    for (const citation of block.citations as Array<Record<string, unknown>>) {
      if (citation.type !== 'web_search_result_location') continue;
      const url = typeof citation.url === 'string' ? citation.url : '';
      if (url === '' || byUrl.has(url)) continue;
      const title =
        typeof citation.title === 'string' && citation.title !== ''
          ? citation.title
          : url;
      byUrl.set(url, { url, title });
    }
  }
  return [...byUrl.values()];
};

const withCitations = (
  content: ContentBlock[],
): { citations?: WebCitation[] } => {
  const citations = citationsOf(content);
  return citations.length ? { citations } : {};
};

const toolCallsOf = (content: ContentBlock[]): ToolCall[] =>
  content
    .filter((block) => block.type === 'tool_use')
    .map((block) => ({
      id: String(block.id),
      name: String(block.name),
      input: block.input ?? {},
    }));

/** A string field of a loosely typed block; anything else reads as ''. */
const str = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const count = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const addUsage = (into: Usage, add: Usage): void => {
  into.promptTokens += add.promptTokens;
  into.completionTokens += add.completionTokens;
  into.totalTokens += add.totalTokens;
  into.cost += add.cost;
  for (const key of [
    'cachedTokens',
    'cacheWriteTokens',
    'latencyMs',
    'webSearchRequests',
  ] as const) {
    if (add[key] !== undefined) into[key] = (into[key] ?? 0) + add[key];
  }
};

/** A failure where the request never got a verdict; `toLLMError` retries it. */
const transportError = (cause: unknown): Error =>
  Object.assign(
    new Error(
      `Anthropic request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    ),
    { name: 'ConnectionError' },
  );

/** A non-2xx response, shaped for `toLLMError` (status and headers). */
const httpError = async (response: Response): Promise<Error> => {
  const body = await response.text().catch(() => '');
  let message = '';
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === 'string') {
      message = parsed.error.message;
    }
  } catch {
    // Not JSON (a proxy's page): the status alone classifies it.
  }
  return Object.assign(
    new Error(
      message || `Anthropic request failed with status ${response.status}`,
    ),
    { statusCode: response.status, headers: response.headers },
  );
};

/**
 * Calls the Anthropic Messages API directly over `fetch` (no SDK), with the
 * same app-owned retry loop as OpenRouter (`ANTHROPIC_*` keys). The API
 * reports tokens but no dollar cost, so each response is priced from
 * `anthropic-pricing.ts`. Supports the model's own server-side web search
 * (`CompletionOptions.webSearch`), re-sending a paused server-tool turn.
 *
 * `ANTHROPIC_API_KEY` is read at boot but checked only when a call is made,
 * so a deployment that never selects this provider needs no key.
 */
@Injectable()
export class AnthropicStrategy implements LLMStrategy {
  private readonly logger = new Logger(AnthropicStrategy.name);
  private readonly apiKey?: string;
  private readonly url: string;
  private readonly apiVersion: string;
  private readonly retry: RetryPolicy;
  private readonly fetchFn: FetchFn;
  private readonly unpricedModels = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(ANTHROPIC_FETCH) fetchFn?: FetchFn,
  ) {
    this.apiKey = this.config.get<string>('ANTHROPIC_API_KEY') || undefined;
    const baseUrl =
      this.config.get<string>('ANTHROPIC_BASE_URL')?.trim() || DEFAULT_BASE_URL;
    this.url = `${baseUrl.replace(/\/+$/, '')}/v1/messages`;
    this.apiVersion =
      this.config.get<string>('ANTHROPIC_VERSION')?.trim() ||
      DEFAULT_API_VERSION;
    // A bad ANTHROPIC_* retry key throws here, which fails boot.
    this.retry = readRetryPolicy(this.config, 'ANTHROPIC');
    this.fetchFn = fetchFn ?? ((url, init) => fetch(url, init));
  }

  async complete(
    messages: Array<LLMMessage>,
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    const turn = await this.run(messages, options);
    const text = textOf(turn.content);
    const finishReason = toFinishReason(turn.stopReason);

    // A call cut off at the token cap before any text (thinking can spend
    // the whole budget) is still a cut-off; the caller reads `finishReason`.
    if (text === undefined && finishReason === 'length') {
      return { text: '', usage: turn.usage, finishReason, model: turn.model };
    }
    if (text === undefined) {
      throw new LLMError('Anthropic returned no text content', {
        retryable: false,
      });
    }

    return {
      text,
      usage: turn.usage,
      ...(finishReason ? { finishReason } : {}),
      model: turn.model,
      ...withCitations(turn.content),
    };
  }

  async completeWithTools(
    messages: Array<LLMMessage>,
    tools: Array<ToolDefinition>,
    options?: CompletionOptions,
  ): Promise<ToolTurnResult> {
    // Tool turns never stream.
    const turn = await this.run(
      messages,
      { ...options, onTextDelta: undefined },
      tools,
    );
    const toolCalls = toolCallsOf(turn.content);

    // A truncated tool input can still parse; never hand it out to run.
    if (toolCalls.length > 0 && turn.stopReason === 'max_tokens') {
      throw new LLMError(
        'Anthropic cut a tool call off at max_tokens; its input is incomplete',
        { retryable: true },
      );
    }

    const text = textOf(turn.content);
    return {
      // A tool-calling turn usually has no prose; omit the key rather than pass ''.
      ...(text ? { text } : {}),
      toolCalls,
      usage: turn.usage,
      model: turn.model,
      ...withCitations(turn.content),
      providerContent: turn.content,
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

  /**
   * One call: the request, then a re-send for each paused server-tool turn
   * (bounded), each through the retry loop. Content and usage are joined
   * across the responses; a refusal throws.
   */
  private async run(
    messages: LLMMessage[],
    options: CompletionOptions | undefined,
    tools?: ToolDefinition[],
  ): Promise<Turn> {
    if (!this.apiKey) {
      throw new LLMError(
        'ANTHROPIC_API_KEY was not configured; it is required when LLM_PROVIDER=anthropic',
        { retryable: false },
      );
    }
    // Built outside the retry loop: a fault in our own conversion is not a provider fault.
    const request = this.buildRequest(messages, options, tools);
    const onTextDelta = options?.onTextDelta;
    const retry = {
      label: 'Anthropic',
      policy: this.retry,
      logger: this.logger,
    };

    const content: ContentBlock[] = [];
    const usage: Usage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cost: 0,
      latencyMs: 0,
    };
    let model = request.model;
    let stopReason: string | undefined;

    for (let continuation = 0; ; continuation++) {
      const textBefore = textOf(content) ?? '';
      const { result, latencyMs } = await sendWithRetries(
        retry,
        (signal) =>
          onTextDelta
            ? this.streamOnce(request, signal, (delta, text) =>
                onTextDelta(delta, textBefore + text),
              )
            : this.postOnce(request, signal),
        options,
      );

      model = result.model || model;
      stopReason = result.stop_reason ?? undefined;
      content.push(...result.content);
      addUsage(usage, this.toUsage(result, request.model, latencyMs));

      if (stopReason !== 'pause_turn') break;
      if (continuation >= MAX_PAUSE_CONTINUATIONS) {
        this.logger.warn(
          `Anthropic paused a server-tool turn ${continuation + 1} times; returning what it has`,
        );
        break;
      }
      // The API resumes from the trailing server-tool block; no "continue" message.
      request.messages = [
        ...request.messages,
        { role: 'assistant', content: result.content },
      ];
    }

    if (stopReason === 'refusal') {
      throw new LLMError(
        'Anthropic refused the request (stop_reason: refusal)',
        {
          retryable: false,
        },
      );
    }
    this.warnOnSearchErrors(content);

    return { model, content, stopReason, usage };
  }

  private buildRequest(
    messages: LLMMessage[],
    options: CompletionOptions | undefined,
    tools: ToolDefinition[] | undefined,
  ): MessagesRequest {
    let model: string;
    try {
      model = toAnthropicModelId(options?.model || DEFAULT_MODEL);
    } catch (error: unknown) {
      throw new LLMError((error as Error).message, {
        retryable: false,
        cause: error,
      });
    }

    const allTools = [
      ...(tools ?? []).map(toAnthropicTool),
      ...(options?.webSearch
        ? [toWebSearchTool(model, options.webSearch)]
        : []),
    ];

    const outputConfig: Record<string, unknown> = {};
    if (options?.reasoningEffort) {
      outputConfig.effort = toAnthropicEffort(options.reasoningEffort);
    }
    if (options?.responseSchema) {
      outputConfig.format = {
        type: 'json_schema',
        schema: toAnthropicJsonSchema(
          z.toJSONSchema(options.responseSchema.schema, { io: 'output' }),
        ),
      };
    }

    // No `temperature`: API version 2026-10-21 rejects every sampling parameter.
    return {
      model,
      max_tokens: options?.max_tokens ?? DEFAULT_MAX_TOKENS,
      ...toAnthropicMessages(messages),
      ...(allTools.length ? { tools: allTools } : {}),
      ...(Object.keys(outputConfig).length
        ? { output_config: outputConfig }
        : {}),
    };
  }

  private post(
    request: MessagesRequest & { stream?: true },
    signal: AbortSignal,
  ): Promise<Response> {
    return this.fetchFn(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey!,
        'anthropic-version': this.apiVersion,
      },
      body: JSON.stringify(request),
      signal,
    });
  }

  /** One unstreamed try. A body that is not JSON is retried like a 5xx. */
  private async postOnce(
    request: MessagesRequest,
    signal: AbortSignal,
  ): Promise<AnthropicMessage> {
    let response: Response;
    try {
      response = await this.post(request, signal);
    } catch (error: unknown) {
      throw signal.aborted ? error : transportError(error);
    }
    if (!response.ok) throw await httpError(response);

    try {
      const message = (await response.json()) as AnthropicMessage;
      if (!Array.isArray(message?.content)) throw new Error('no content');
      return message;
    } catch (error: unknown) {
      if (signal.aborted) throw error;
      throw new LLMError('Anthropic returned a body that is not a message', {
        retryable: true,
        statusCode: 200,
        cause: error,
      });
    }
  }

  /**
   * One streamed try, rebuilt into the message an unstreamed try returns:
   * text, thinking, tool input and citations accumulate per block, and usage
   * is `message_start`'s overlaid with `message_delta`'s. An `error` event is
   * classified as its HTTP status would be. A delta callback that throws
   * loses its preview, never the call.
   */
  private async streamOnce(
    request: MessagesRequest,
    signal: AbortSignal,
    onTextDelta: (delta: string, text: string) => void,
  ): Promise<AnthropicMessage> {
    let response: Response;
    try {
      response = await this.post({ ...request, stream: true }, signal);
    } catch (error: unknown) {
      throw signal.aborted ? error : transportError(error);
    }
    if (!response.ok) throw await httpError(response);
    if (!response.body) {
      throw new LLMError('Anthropic returned an empty stream', {
        retryable: true,
        statusCode: 200,
      });
    }

    let message: AnthropicMessage | undefined;
    const blocks: ContentBlock[] = [];
    const partialJson = new Map<number, string>();
    let usage: AnthropicUsage = {};
    let stopReason: string | null = null;
    let text = '';

    const onEvent = (event: Record<string, unknown>) => {
      const index = typeof event.index === 'number' ? event.index : -1;
      switch (event.type) {
        case 'message_start': {
          message = event.message as AnthropicMessage;
          usage = { ...(message.usage ?? {}) };
          break;
        }
        case 'content_block_start': {
          const block = { ...(event.content_block as ContentBlock) };
          blocks[index] = block;
          if (block.type === 'tool_use' || block.type === 'server_tool_use') {
            partialJson.set(index, '');
          }
          break;
        }
        case 'content_block_delta': {
          const block = blocks[index];
          const delta = event.delta as Record<string, unknown>;
          if (!block) break;
          if (delta.type === 'text_delta') {
            const piece = str(delta.text);
            block.text = str(block.text) + piece;
            text += piece;
            try {
              onTextDelta(piece, text);
            } catch (error: unknown) {
              this.logger.warn(
                `A text delta callback failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          } else if (delta.type === 'input_json_delta') {
            partialJson.set(
              index,
              (partialJson.get(index) ?? '') + str(delta.partial_json),
            );
          } else if (delta.type === 'thinking_delta') {
            block.thinking = str(block.thinking) + str(delta.thinking);
          } else if (delta.type === 'signature_delta') {
            block.signature = delta.signature;
          } else if (delta.type === 'citations_delta') {
            block.citations = [
              ...((block.citations as unknown[]) ?? []),
              delta.citation,
            ];
          }
          break;
        }
        case 'content_block_stop': {
          const json = partialJson.get(index);
          if (json !== undefined && blocks[index]) {
            try {
              blocks[index].input = json.trim() === '' ? {} : JSON.parse(json);
            } catch (error: unknown) {
              // A resample of the same request may well produce valid JSON.
              throw new LLMError(
                `Anthropic streamed malformed input for tool "${String(blocks[index].name)}"`,
                { retryable: true, cause: error },
              );
            }
            partialJson.delete(index);
          }
          break;
        }
        case 'message_delta': {
          const delta = event.delta as { stop_reason?: string | null };
          stopReason = delta?.stop_reason ?? stopReason;
          const more = (event.usage ?? {}) as Record<string, unknown>;
          for (const [key, value] of Object.entries(more)) {
            if (value !== null && value !== undefined) {
              (usage as Record<string, unknown>)[key] = value;
            }
          }
          break;
        }
        case 'error': {
          const error = (event.error ?? {}) as {
            type?: string;
            message?: string;
          };
          throw fromStreamError({
            code: ERROR_TYPE_STATUS[error.type ?? ''] ?? 500,
            message: error.message || 'Anthropic failed mid-stream',
          });
        }
        default:
          break; // ping, message_stop, and anything newer
      }
    };

    try {
      await readServerSentEvents(response.body, onEvent);
    } catch (error: unknown) {
      if (error instanceof LLMError || signal.aborted) throw error;
      throw transportError(error);
    }

    if (!message || stopReason === null) {
      throw new LLMError('Anthropic stream ended before the message did', {
        retryable: true,
        statusCode: 200,
      });
    }
    return {
      model: message.model,
      content: blocks.filter(Boolean),
      stop_reason: stopReason,
      usage,
    };
  }

  /** One response's usage, priced. Absent cache and search counts are omitted. */
  private toUsage(
    message: AnthropicMessage,
    requestedModel: string,
    latencyMs: number,
  ): Usage {
    const raw = message.usage ?? {};
    const inputTokens = count(raw.input_tokens);
    const outputTokens = count(raw.output_tokens);
    const cachedTokens = count(raw.cache_read_input_tokens);
    const cacheWriteTokens = count(raw.cache_creation_input_tokens);
    const webSearchRequests = count(raw.server_tool_use?.web_search_requests);
    const counts = {
      inputTokens,
      outputTokens,
      cacheReadInputTokens: cachedTokens,
      cacheCreationInputTokens: cacheWriteTokens,
      cacheCreation1hInputTokens: count(
        raw.cache_creation?.ephemeral_1h_input_tokens,
      ),
      webSearchRequests,
    };
    const answeredBy = message.model || requestedModel;
    const cost =
      anthropicCostUsd(answeredBy, counts) ??
      anthropicCostUsd(requestedModel, counts);
    if (cost === undefined) this.warnUnpriced(answeredBy);

    const promptTokens = inputTokens + cachedTokens + cacheWriteTokens;
    return {
      promptTokens,
      completionTokens: outputTokens,
      totalTokens: promptTokens + outputTokens,
      cost: cost ?? 0,
      ...(cachedTokens > 0 ? { cachedTokens } : {}),
      ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
      ...(webSearchRequests > 0 ? { webSearchRequests } : {}),
      latencyMs,
    };
  }

  private warnUnpriced(model: string): void {
    if (this.unpricedModels.has(model)) return;
    this.unpricedModels.add(model);
    this.logger.warn(
      `No Anthropic price for model ${model}; its calls report cost 0, so the credit meter falls back to token pricing. Add it to src/llm/anthropic-pricing.ts.`,
    );
  }

  /** A failed search comes back as HTTP 200 with an error result; the model carries on. */
  private warnOnSearchErrors(content: ContentBlock[]): void {
    for (const block of content) {
      if (block.type !== 'web_search_tool_result') continue;
      const result = block.content as { type?: string; error_code?: string };
      if (
        result &&
        !Array.isArray(result) &&
        result.type === 'web_search_tool_result_error'
      ) {
        this.logger.warn(
          `Anthropic web search failed (${result.error_code ?? 'unknown error'})`,
        );
      }
    }
  }
}

/** Reads a `text/event-stream` body, calling `onEvent` with each event's JSON data. */
export async function readServerSentEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const flush = (chunk: string) => {
    const data = chunk
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data === '') return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data) as Record<string, unknown>;
    } catch (error: unknown) {
      throw new LLMError('Anthropic streamed an event that is not JSON', {
        retryable: true,
        statusCode: 200,
        cause: error,
      });
    }
    onEvent(event);
  };

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const chunks = buffer.split(/\r?\n\r?\n/);
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) flush(chunk);
    if (done) break;
  }
  if (buffer.trim() !== '') flush(buffer);
}
