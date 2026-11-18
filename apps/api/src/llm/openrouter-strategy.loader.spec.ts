import { ConfigService } from '@nestjs/config';

jest.mock('./strategies/openrouter.strategy', () => ({
  OpenRouterStrategy: jest
    .fn()
    .mockImplementation(() => ({ tag: 'openrouter' })),
}));

import { OpenRouterStrategy } from './strategies/openrouter.strategy';
import { loadOpenRouterStrategy } from './openrouter-strategy.loader';

const configWith = (provider: string | undefined) =>
  ({
    get: (key: string) => (key === 'LLM_PROVIDER' ? provider : undefined),
  }) as ConfigService;

const strategyCtor = OpenRouterStrategy as unknown as jest.Mock;

describe('loadOpenRouterStrategy', () => {
  beforeEach(() => {
    strategyCtor.mockClear();
  });

  it('does not import @openrouter/sdk by being loaded', () => {
    const before = new Set(Object.keys(require.cache));
    jest.isolateModules(() => {
      require('./openrouter-strategy.loader');
    });
    const added = Object.keys(require.cache).filter(
      (id) => !before.has(id) && id.includes('@openrouter/sdk'),
    );
    expect(added).toEqual([]);
  });

  it.each([undefined, 'openrouter'])(
    'should construct the strategy when LLM_PROVIDER is %p',
    (provider) => {
      const config = configWith(provider);
      const strategy = loadOpenRouterStrategy(config);

      expect(strategyCtor).toHaveBeenCalledWith(config);
      expect(strategy).toEqual({ tag: 'openrouter' });
    },
  );

  it('should skip the strategy module when LLM_PROVIDER is anthropic', () => {
    expect(loadOpenRouterStrategy(configWith('anthropic'))).toBeNull();
    expect(strategyCtor).not.toHaveBeenCalled();
  });

  it('should throw when LLM_PROVIDER is neither provider', () => {
    expect(() => loadOpenRouterStrategy(configWith('openai'))).toThrow(
      'LLM_PROVIDER must be openrouter or anthropic, or unset; got "openai"',
    );
    expect(strategyCtor).not.toHaveBeenCalled();
  });
});
