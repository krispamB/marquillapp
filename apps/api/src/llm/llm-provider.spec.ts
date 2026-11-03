import { LLMProvider } from './interfaces';
import { readLlmProvider } from './llm-provider';

describe('llmProvider', () => {
  describe('readLlmProvider', () => {
    it.each([undefined, null, '', '   '])(
      'should default to OpenRouter when LLM_PROVIDER is %p',
      (raw) => {
        expect(readLlmProvider(raw)).toBe(LLMProvider.OPENROUTER);
      },
    );

    it.each([
      ['openrouter', LLMProvider.OPENROUTER],
      ['anthropic', LLMProvider.ANTHROPIC],
      [' Anthropic ', LLMProvider.ANTHROPIC],
    ])('should read %p as %p', (raw, provider) => {
      expect(readLlmProvider(raw)).toBe(provider);
    });

    it.each(['claude', 'openai', 'anthropik'])(
      'should throw naming the value when LLM_PROVIDER is %p',
      (raw) => {
        expect(() => readLlmProvider(raw)).toThrow(
          `LLM_PROVIDER must be openrouter or anthropic, or unset; got "${raw}"`,
        );
      },
    );
  });
});
