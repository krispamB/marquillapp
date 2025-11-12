export interface LLMStrategy {
  generateCompletion(
    messages: Array<LLMMessage>,
    options?: CompletionOptions,
  ): Promise<string>;
  streamCompletion?(prompt: string, options?: any): AsyncIterable<string>;
}

export type CompletionOptions = {
  model: string;
  max_tokens: number;
};

export interface LLMMessage {
  role: MessageRole;
  content: string;
}

export enum MessageRole {
  User = 'user',
  Assistant = 'assistant',
  System = 'system',
}

export enum LLMProvider {
  OPENAI = 'openai',
  CLAUDE = 'claude',
  OPENROUTER = 'openrouter',
}
