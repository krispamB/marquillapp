import type { ZodType } from 'zod';

export enum LLMProvider {
  OPENAI = 'openai',
  /** Unused placeholder, kept as it was. Anthropic is `ANTHROPIC`. */
  CLAUDE = 'claude',
  OPENROUTER = 'openrouter',
  /** The Anthropic Messages API, called directly (`AnthropicStrategy`). */
  ANTHROPIC = 'anthropic',
}

export enum MessageRole {
  User = 'user',
  Assistant = 'assistant',
  System = 'system',
  Tool = 'tool',
}

export interface SystemMessage {
  role: MessageRole.System;
  content: string;
}

export interface UserMessage {
  role: MessageRole.User;
  content: string;
}

/** An assistant turn. Carries `toolCalls` when the model asked for tools. */
export interface AssistantMessage {
  role: MessageRole.Assistant;
  content?: string;
  toolCalls?: ToolCall[];
  /**
   * The provider's own content blocks for this turn, exactly as it returned
   * them (`ToolTurnResult.providerContent`). A strategy that understands
   * them re-sends them unchanged instead of rebuilding the turn from
   * `content` and `toolCalls`, which keeps reasoning blocks valid across a
   * tool loop. Other strategies ignore it.
   */
  providerContent?: unknown[];
}

/** The result of executing one tool call, fed back into the next turn. */
export interface ToolResultMessage {
  role: MessageRole.Tool;
  content: string;
  toolCallId: string;
}

export type LLMMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolResultMessage;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ZodType;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Real per-call USD cost from the provider. `0` when the provider omits it. */
  cost: number;
  /** Completion tokens spent reasoning, when the provider reports them. */
  reasoningTokens?: number;
  /** Prompt tokens read from the provider's prompt cache. */
  cachedTokens?: number;
  /** Prompt tokens written to the provider's prompt cache. */
  cacheWriteTokens?: number;
  /** Wall time of the call, request to response. Summed across a run's calls. */
  latencyMs?: number;
  /**
   * Server-side web searches the model ran during the call
   * (`CompletionOptions.webSearch`). Their price is already in `cost`.
   */
  webSearchRequests?: number;
}

/** A web page the model cited in its answer. */
export interface WebCitation {
  url: string;
  title: string;
}

export interface CompletionResult {
  text: string;
  usage: Usage;
  /** The model the provider says answered, when it says. */
  model?: string;
  /**
   * Why the provider stopped, when it says (`stop`, `length`, ...). `length`
   * means the output hit `max_tokens` and is truncated.
   */
  finishReason?: string;
  /** Pages the model cited, deduped by URL, when it searched the web. */
  citations?: WebCitation[];
}

export interface ToolTurnResult {
  text?: string;
  toolCalls: ToolCall[];
  usage: Usage;
  /** The model the provider says answered, when it says. */
  model?: string;
  /** Pages the model cited, deduped by URL, when it searched the web. */
  citations?: WebCitation[];
  /**
   * The turn's raw provider content blocks, when the strategy needs them
   * back verbatim on the next turn. Copy it onto the `AssistantMessage`
   * that records this turn.
   */
  providerContent?: unknown[];
}

/**
 * Lets the model search the web itself, server-side, within one call. Only
 * `AnthropicStrategy` supports it; any other strategy throws a terminal
 * `LLMError`. Give either `allowedDomains` or `blockedDomains`, not both.
 */
export interface WebSearchOptions {
  /** Most searches the model may run in the call. */
  maxUses: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
}

/**
 * Reasoning effort a call may ask for. Which values a model accepts differs
 * per model, so callers send one only when it was configured.
 */
export const REASONING_EFFORTS = [
  'max',
  'xhigh',
  'high',
  'medium',
  'low',
  'minimal',
  'none',
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type CompletionOptions = {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  /** Sent as `reasoning: { effort }`. Unset sends nothing. */
  reasoningEffort?: ReasoningEffort;
  /** Groups a run's calls for provider cache affinity. Unset sends nothing. */
  sessionId?: string;
  /**
   * Caps each try's timeout below the provider's configured one. Never
   * raises it.
   */
  timeoutMs?: number;
  /**
   * Epoch milliseconds the call must not outlive: each try's timeout is cut
   * to the time left, and no retry starts after it.
   */
  deadlineAt?: number;
  /** Aborts the call. An abort is final: it is never retried. */
  signal?: AbortSignal;
  /**
   * Streams a `complete` call: called with each piece of text as it arrives,
   * and the try's text so far. A retried try starts its text again from
   * empty. The result is unchanged: the same text, usage and finish reason
   * once the stream ends. Ignored by `completeWithTools`.
   */
  onTextDelta?: (delta: string, text: string) => void;
  responseSchema?: {
    name: string;
    schema: ZodType;
  };
  /** Unset sends no search tool. See `WebSearchOptions`. */
  webSearch?: WebSearchOptions;
};

export interface LLMStrategy {
  complete(
    messages: Array<LLMMessage>,
    options?: CompletionOptions,
  ): Promise<CompletionResult>;

  /** Exactly one turn. Executing the returned tool calls is the caller's job. */
  completeWithTools(
    messages: Array<LLMMessage>,
    tools: Array<ToolDefinition>,
    options?: CompletionOptions,
  ): Promise<ToolTurnResult>;

  stream?(
    messages: Array<LLMMessage>,
    options?: CompletionOptions,
  ): AsyncIterable<string>;

  /** @deprecated Use `complete`, which also reports usage. */
  generateCompletion(
    messages: Array<LLMMessage>,
    options?: CompletionOptions,
  ): Promise<string>;
}
