import { excerpt, littleTextToPlain } from './little-text';

describe('little-text', () => {
  describe('littleTextToPlain', () => {
    it('should turn hashtag templates into hashtags', () => {
      expect(littleTextToPlain('Ship it {hashtag|\\#|launch} today')).toBe(
        'Ship it #launch today',
      );
    });

    it('should turn mentions into the mentioned name', () => {
      expect(
        littleTextToPlain('Thanks @[Ada Lovelace](urn:li:person:abc123)!'),
      ).toBe('Thanks Ada Lovelace!');
    });

    it('should drop the backslash of escaped reserved characters', () => {
      expect(littleTextToPlain('Costs \\(approx\\) 5 \\* 3 \\@ noon')).toBe(
        'Costs (approx) 5 * 3 @ noon',
      );
    });

    it('should leave plain text alone', () => {
      expect(littleTextToPlain('Hello world')).toBe('Hello world');
    });
  });

  describe('excerpt', () => {
    it('should cut to 280 characters', () => {
      expect(excerpt('a'.repeat(400))).toHaveLength(280);
    });

    it('should never split an emoji when cutting', () => {
      const text = `${'a'.repeat(279)}😀😀`;
      expect(excerpt(text)).toBe(`${'a'.repeat(279)}😀`);
    });

    it('should trim surrounding whitespace', () => {
      expect(excerpt('  hi  ')).toBe('hi');
    });
  });
});
