import { toAnthropicModelId, webSearchToolType } from './anthropic-model';

describe('anthropicModel', () => {
  describe('toAnthropicModelId', () => {
    it.each([
      ['claude-haiku-5-5', 'claude-haiku-5-5'],
      ['anthropic/claude-haiku-5.5', 'claude-haiku-5-5'],
      ['anthropic/claude-sonnet-5.5', 'claude-sonnet-5-5'],
      [' Anthropic/claude-opus-5.5 ', 'claude-opus-5-5'],
      ['anthropic/claude-sonnet-4.6:thinking', 'claude-sonnet-4-6'],
      ['claude-haiku-4-5-20251001', 'claude-haiku-4-5-20251001'],
    ])('should map %p to %p when it names a Claude model', (raw, id) => {
      expect(toAnthropicModelId(raw)).toBe(id);
    });

    it.each(['openai/gpt-5-mini', 'gpt-5', '', 'google/claude-haiku-5.5'])(
      'should throw naming the value when %p is not a Claude model',
      (raw) => {
        expect(() => toAnthropicModelId(raw)).toThrow(
          `"${raw}" is not an Anthropic model id`,
        );
      },
    );
  });

  describe('webSearchToolType', () => {
    it.each(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-sonnet-4-6'])(
      'should use the dynamic-filtering tool when the model is %p',
      (model) => {
        expect(webSearchToolType(model)).toBe('web_search_20260209');
      },
    );

    it.each(['claude-haiku-5-5', 'claude-haiku-4-5', 'claude-unknown-9'])(
      'should use the basic tool when the model is %p',
      (model) => {
        expect(webSearchToolType(model)).toBe('web_search_20250305');
      },
    );
  });
});
