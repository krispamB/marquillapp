import type { ZodType } from 'zod';

export enum LLMProvider {
  OPENAI = 'openai',
  CLAUDE = 'claude',
  OPENROUTER = 'openrouter',
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
}

export interface CompletionResult {
  text: string;
  usage: Usage;
}

export interface ToolTurnResult {
  text?: string;
  toolCalls: ToolCall[];
  usage: Usage;
}

export type CompletionOptions = {
  model?: string;
  max_tokens?: number;
  temperature?: number;
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
