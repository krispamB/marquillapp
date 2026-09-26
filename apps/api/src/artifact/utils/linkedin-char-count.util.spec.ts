import { linkedInCharCount } from './linkedin-char-count.util';

describe('linkedInCharCount', () => {
  it('should return 0 when text is empty', () => {
    expect(linkedInCharCount('')).toBe(0);
  });

  it('should count each character as 1 unit when text is BMP-only', () => {
    expect(linkedInCharCount('a'.repeat(3000))).toBe(3000);
  });

  it('should count an emoji as 2 units when it lies outside the BMP', () => {
    // 🎉 is U+1F389, above 0xFFFF, so LinkedIn counts it as 2 char units
    expect(linkedInCharCount('🎉')).toBe(2);
  });

  it('should count by UTF-16 code units when text mixes BMP and astral characters', () => {
    expect(linkedInCharCount('hi 🎉')).toBe(5);
  });
});
