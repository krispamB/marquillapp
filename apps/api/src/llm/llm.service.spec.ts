import { z } from 'zod';

// `llm.service` reaches the ESM-only SDK through LLMFactoryService -> strategies.
jest.mock('@openrouter/sdk', () => ({ OpenRouter: jest.fn() }), {
  virtual: true,
});

import { LLMService } from './llm.service';
import { LLMProvider, MessageRole, ToolDefinition } from './interfaces';

const messages = [{ role: MessageRole.User as const, content: 'hi' }];

const tools: ToolDefinition[] = [
  {
    name: 'searchWeb',
    description: 'Search the web',
    parameters: z.object({ query: z.string() }),
  },
];

const usage = {
  promptTokens: 10,
  completionTokens: 5,
  totalTokens: 15,
  cost: 0.0001,
};

const makeService = () => {
  const strategy = {
    complete: jest.fn(),
    completeWithTools: jest.fn(),
    generateCompletion: jest.fn(),
  };
  const llmFactory = { getStrategy: jest.fn().mockReturnValue(strategy) };
  const service = new LLMService(llmFactory as any);
  return { service, mocks: { strategy, llmFactory } };
};

let service: LLMService;
let mocks: ReturnType<typeof makeService>['mocks'];

beforeEach(() => {
  jest.clearAllMocks();
  ({ service, mocks } = makeService());
});

describe('LLMService', () => {
  describe('complete', () => {
    it('should return the strategy result when the provider is supported', async () => {
      const expected = { text: 'hello', usage };
      mocks.strategy.complete.mockResolvedValue(expected);

      await expect(
        service.complete(LLMProvider.OPENROUTER, messages),
      ).resolves.toEqual(expected);
    });

    it('should resolve the strategy for the requested provider', async () => {
      mocks.strategy.complete.mockResolvedValue({ text: '', usage });

      await service.complete(LLMProvider.OPENROUTER, messages, {
        model: 'openai/gpt-5-mini',
      });

      expect(mocks.llmFactory.getStrategy).toHaveBeenCalledWith(
        LLMProvider.OPENROUTER,
      );
      expect(mocks.strategy.complete).toHaveBeenCalledWith(messages, {
        model: 'openai/gpt-5-mini',
      });
    });

    it('should propagate the error when the provider is unsupported', async () => {
      mocks.llmFactory.getStrategy.mockImplementation(() => {
        throw new Error('Unsupported LLM provider: openai');
      });

      await expect(
        service.complete(LLMProvider.OPENAI, messages),
      ).rejects.toThrow('Unsupported LLM provider: openai');
    });
  });

  describe('completeWithTools', () => {
    it('should return the tool turn result when the model calls a tool', async () => {
      const expected = {
        toolCalls: [{ id: 'c1', name: 'searchWeb', input: { query: 'nest' } }],
        usage,
      };
      mocks.strategy.completeWithTools.mockResolvedValue(expected);

      await expect(
        service.completeWithTools(LLMProvider.OPENROUTER, messages, tools),
      ).resolves.toEqual(expected);
    });

    it('should forward the tools and options to the strategy', async () => {
      mocks.strategy.completeWithTools.mockResolvedValue({
        toolCalls: [],
        usage,
      });

      await service.completeWithTools(LLMProvider.OPENROUTER, messages, tools, {
        temperature: 0.1,
      });

      expect(mocks.strategy.completeWithTools).toHaveBeenCalledWith(
        messages,
        tools,
        { temperature: 0.1 },
      );
    });

    it('should propagate a retryable LLMError raised by the strategy', async () => {
      mocks.strategy.completeWithTools.mockRejectedValue(
        Object.assign(new Error('Rate limit exceeded'), { retryable: true }),
      );

      await expect(
        service.completeWithTools(LLMProvider.OPENROUTER, messages, tools),
      ).rejects.toMatchObject({ retryable: true });
    });
  });

  describe('generateCompletions', () => {
    it('should return the raw text from the strategy', async () => {
      mocks.strategy.generateCompletion.mockResolvedValue('legacy text');

      await expect(
        service.generateCompletions(LLMProvider.OPENROUTER, messages),
      ).resolves.toBe('legacy text');
      expect(mocks.strategy.generateCompletion).toHaveBeenCalledWith(
        messages,
        undefined,
      );
    });
  });
});
