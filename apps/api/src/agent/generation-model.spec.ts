import { resolveTextGenerationModels } from './generation-model';

const read = (env: Record<string, string | undefined>) => (key: string) =>
  env[key];

describe('resolveTextGenerationModels', () => {
  it('falls back to GENERATION_MODEL for both types when the keys are unset', () => {
    expect(resolveTextGenerationModels('base/model', read({}))).toEqual({
      POST: 'base/model',
      POLL: 'base/model',
    });
  });

  it('treats blank keys as unset', () => {
    expect(
      resolveTextGenerationModels(
        'base/model',
        read({
          POST_GENERATION_MODEL: '',
          POLL_GENERATION_MODEL: '   ',
        }),
      ),
    ).toEqual({ POST: 'base/model', POLL: 'base/model' });
  });

  it('overrides each type on its own key', () => {
    const env = {};
    expect(
      resolveTextGenerationModels(
        'base/model',
        read({ ...env, POLL_GENERATION_MODEL: ' fast/poll ' }),
      ),
    ).toEqual({ POST: 'base/model', POLL: 'fast/poll' });
    expect(
      resolveTextGenerationModels(
        'base/model',
        read({ ...env, POST_GENERATION_MODEL: 'fast/post' }),
      ),
    ).toEqual({ POST: 'fast/post', POLL: 'base/model' });
  });
});
