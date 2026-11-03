import { applyEdits } from './candidate-patch';

describe('applyEdits', () => {
  it('should apply a single edit when its find matches once', () => {
    expect(
      applyEdits('<p>a</p><p>b</p>', [{ find: '<p>b', replace: '<p>c' }]),
    ).toEqual({
      ok: true,
      candidate: '<p>a</p><p>c</p>',
    });
  });

  it('should fail naming the edit when its find is not found', () => {
    const result = applyEdits('abc', [{ find: 'zzz', replace: 'x' }]);
    expect(result).toEqual({
      ok: false,
      problems: [expect.stringMatching(/edit 1.*not found/i)],
    });
  });

  it('should fail with the count when a find matches more than once', () => {
    const result = applyEdits('ab ab ab', [{ find: 'ab', replace: 'x' }]);
    expect(result).toEqual({
      ok: false,
      problems: [expect.stringMatching(/edit 1.*matches 3 times/i)],
    });
  });

  it('should count overlapping self-matches when a find overlaps itself', () => {
    const result = applyEdits('aaa', [{ find: 'aa', replace: 'x' }]);
    expect(result).toEqual({
      ok: false,
      problems: [expect.stringMatching(/matches 2 times/)],
    });
  });

  it('should fail naming both edits when their ranges overlap', () => {
    const result = applyEdits('abcdef', [
      { find: 'abc', replace: 'x' },
      { find: 'cde', replace: 'y' },
    ]);
    expect(result).toEqual({
      ok: false,
      problems: [expect.stringMatching(/edits 1 and 2.*overlap/i)],
    });
  });

  it('should report every overlapping pair when one range covers several', () => {
    const result = applyEdits('abcdefghij', [
      { find: 'abcdefgh', replace: 'x' },
      { find: 'bc', replace: 'y' },
      { find: 'ef', replace: 'z' },
    ]);
    expect(result).toEqual({
      ok: false,
      problems: [
        'Edits 1 and 2: their find ranges overlap.',
        'Edits 1 and 3: their find ranges overlap.',
      ],
    });
  });

  it('should apply both edits when their ranges are adjacent', () => {
    expect(
      applyEdits('abcdef', [
        { find: 'abc', replace: 'X' },
        { find: 'def', replace: 'Y' },
      ]),
    ).toEqual({ ok: true, candidate: 'XY' });
  });

  it('should fail when edits is empty', () => {
    expect(applyEdits('abc', [])).toEqual({
      ok: false,
      problems: [expect.stringMatching(/no edits/i)],
    });
  });

  it('should fail naming the edit when a find is empty', () => {
    expect(applyEdits('abc', [{ find: '', replace: 'x' }])).toEqual({
      ok: false,
      problems: [expect.stringMatching(/edit 1.*empty/i)],
    });
  });

  it('should change nothing and report every problem when one edit among good ones is bad', () => {
    const result = applyEdits('one two three', [
      { find: 'one', replace: '1' },
      { find: 'missing', replace: 'x' },
      { find: '', replace: 'y' },
      { find: 'three', replace: '3' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toHaveLength(2);
      expect(result.problems[0]).toMatch(/Edit 2/);
      expect(result.problems[1]).toMatch(/Edit 3/);
    }
    expect(result).not.toHaveProperty('candidate');
  });

  it('should use original offsets when an earlier edit changes the length', () => {
    expect(
      applyEdits('aaa bbb ccc', [
        { find: 'aaa', replace: 'a-much-longer-text' },
        { find: 'ccc', replace: 'c' },
        { find: 'bbb', replace: '' },
      ]),
    ).toEqual({ ok: true, candidate: 'a-much-longer-text  c' });
  });

  it('should normalise CRLF to LF when candidate, find and replace carry CRLF', () => {
    expect(
      applyEdits('line1\r\nline2\r\nline3', [
        { find: 'line1\r\nline2', replace: 'a\r\nb' },
      ]),
    ).toEqual({ ok: true, candidate: 'a\nb\nline3' });
  });

  it('should truncate a long find to 60 characters when reporting a problem', () => {
    const find = 'x'.repeat(200);
    const result = applyEdits('abc', [{ find, replace: '' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems[0]).toContain('x'.repeat(60) + '…');
      expect(result.problems[0]).not.toContain('x'.repeat(61));
    }
  });
});
