import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenRouter } from '@openrouter/sdk';
import type {
  ChatFunctionTool,
  ChatMessages,
  ChatResult,
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
import { LLMError, toLLMError } from '../errors';

const DEFAULT_MODEL = 'openai/gpt-5-mini';

// A fresh object per call: callers accumulate usage across turns by mutation.
const emptyUsage = (): Usage => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cost: 0,
});

/** OpenRouter reports cost only when the provider supplies it. */
const toUsage = (usage: ChatUsage | undefined): Usage =>
  usage
    ? {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        cost: usage.cost ?? 0,
      }
    : emptyUsage();

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

@Injectable()
export class OpenRouterStrategy implements LLMStrategy {
  private client: OpenRouter;

  constructor(private config: ConfigService) {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
    if (!apiKey)
      throw new InternalServerErrorException(
        'OPENROUTER_API_KEY was not configured',
      );
    this.client = new OpenRouter({
      apiKey,
    });
  }

  async complete(
    messages: Array<LLMMessage>,
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    const result = await this.send(messages, options);
    const text = readText(result.choices[0]?.message?.content);

    if (text === undefined) {
      throw new LLMError('OpenRouter returned no text content', {
        retryable: false,
      });
    }

    return { text, usage: toUsage(result.usage) };
  }

  async completeWithTools(
    messages: Array<LLMMessage>,
    tools: Array<ToolDefinition>,
    options?: CompletionOptions,
  ): Promise<ToolTurnResult> {
    const result = await this.send(messages, options, tools);
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
      usage: toUsage(result.usage),
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
  ): Promise<ChatResult> {
    // Built outside the try: a fault in our own conversion is not a provider fault.
    const chatRequest = {
      model: options?.model || DEFAULT_MODEL,
      maxTokens: options?.max_tokens,
      temperature: options?.temperature,
      messages: messages.map(toChatMessage),
      ...(tools?.length ? { tools: tools.map(toChatTool) } : {}),
      stream: false as const,
    };

    try {
      return await this.client.chat.send({ chatRequest });
    } catch (error) {
      throw toLLMError(error);
    }
  }
}
