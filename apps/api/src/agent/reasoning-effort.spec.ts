import { REASONING_EFFORTS } from '../llm/interfaces';
import { readReasoningEffort } from './reasoning-effort';

const KEY = 'GENERATION_REASONING_EFFORT';

describe('readReasoningEffort', () => {
  it('should return undefined when the key is unset', () => {
    expect(readReasoningEffort(undefined, KEY)).toBeUndefined();
    expect(readReasoningEffort(null, KEY)).toBeUndefined();
  });

  it('should return undefined when the key is empty or blank', () => {
    expect(readReasoningEffort('', KEY)).toBeUndefined();
    expect(readReasoningEffort('   ', KEY)).toBeUndefined();
  });

  it.each(REASONING_EFFORTS)(
    'should return the effort when the value is %p',
    (effort) => {
      expect(readReasoningEffort(effort, KEY)).toBe(effort);
    },
  );

  it('should trim surrounding whitespace when the value is otherwise valid', () => {
    expect(readReasoningEffort(' low\n', KEY)).toBe('low');
  });

  it.each(['LOW', 'Low', 'lowest', 'off', 0, 1])(
    'should throw naming the key, the value and the allowed values when the value is %p',
    (raw) => {
      expect(() => readReasoningEffort(raw, KEY)).toThrow(
        `${KEY} must be one of ${REASONING_EFFORTS.join(', ')}, or unset; got "${String(raw)}"`,
      );
    },
  );
});
