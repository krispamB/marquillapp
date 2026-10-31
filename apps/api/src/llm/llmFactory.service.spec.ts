// The factory reaches the ESM-only SDK through the strategies barrel.
jest.mock('@openrouter/sdk', () => ({ OpenRouter: jest.fn() }), {
  virtual: true,
});

import { LLMProvider } from './interfaces';
import { LLMFactoryService } from './llmFactory.service';

const makeService = () => {
  const openrouterStrategy = { name: 'openrouter' };
  const anthropicStrategy = { name: 'anthropic' };
  const service = new LLMFactoryService(
    openrouterStrategy as any,
    anthropicStrategy as any,
  );
  return { service, mocks: { openrouterStrategy, anthropicStrategy } };
};

let service: LLMFactoryService;
let mocks: ReturnType<typeof makeService>['mocks'];

beforeEach(() => {
  ({ service, mocks } = makeService());
});

describe('LLMFactoryService', () => {
  describe('getStrategy', () => {
    it('should return the OpenRouter strategy when the provider is OPENROUTER', () => {
      expect(service.getStrategy(LLMProvider.OPENROUTER)).toBe(
        mocks.openrouterStrategy,
      );
    });

    it('should return the Anthropic strategy when the provider is ANTHROPIC', () => {
      expect(service.getStrategy(LLMProvider.ANTHROPIC)).toBe(
        mocks.anthropicStrategy,
      );
    });

    it.each([LLMProvider.OPENAI, LLMProvider.CLAUDE])(
      'should throw when the provider is %p',
      (provider) => {
        expect(() => service.getStrategy(provider)).toThrow(
          `Unsupported LLM provider: ${provider}`,
        );
      },
    );
  });
});
