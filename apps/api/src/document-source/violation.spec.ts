import { boundViolations, Violation } from './violation';

const many = (code: string, count: number): Violation[] =>
  Array.from({ length: count }, (_, i) => ({ code, detail: `${code} #${i}` }));

describe('boundViolations', () => {
  it('should pass every violation through when within both bounds', () => {
    const all = [...many('typography.scale', 3), ...many('icons.sizes', 2)];

    expect(boundViolations(all)).toEqual({ violations: all, omitted: [] });
  });

  it('should keep 3 per code and count the rest when a code repeats', () => {
    const all = [...many('typography.scale', 5), ...many('icons.sizes', 1)];

    const bounded = boundViolations(all);

    expect(bounded.violations.map((v) => v.detail)).toEqual([
      'typography.scale #0',
      'typography.scale #1',
      'typography.scale #2',
      'icons.sizes #0',
    ]);
    expect(bounded.omitted).toEqual([{ code: 'typography.scale', count: 2 }]);
  });

  it('should send at most 40 in total and count the cut when there are many codes', () => {
    const all = Array.from({ length: 20 }, (_, i) =>
      many(`envelope.c${i}`, 3),
    ).flat();

    const bounded = boundViolations(all);

    expect(bounded.violations).toHaveLength(40);
    expect(bounded.violations.at(-1)?.detail).toBe('envelope.c13 #0');
    expect(bounded.omitted[0]).toEqual({ code: 'envelope.c13', count: 2 });
    expect(bounded.omitted.reduce((sum, o) => sum + o.count, 0)).toBe(20);
  });
});
