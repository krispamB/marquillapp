import { validateLinkedInPost } from './post.util';

const repeat = (char: string, n: number) => char.repeat(n);

describe('validateLinkedInPost', () => {
  describe('character count / hard limit', () => {
    it('should return valid for a normal post under 3000 chars', () => {
      // End with '.' so hookComplete=true and avoid short-post warning
      const text = repeat('a', 209) + '.' + repeat('a', 191);
      const result = validateLinkedInPost(text);
      expect(result.valid).toBe(true);
      expect(result.charCount).toBe(401);
    });

    it('should error when post exceeds 3000 characters', () => {
      const text = repeat('a', 3001);
      const result = validateLinkedInPost(text);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('3,000 characters'))).toBe(
        true,
      );
    });

    it('should count emoji surrogate pairs as 2 units each', () => {
      // 🎉 is U+1F389, above 0xFFFF, so LinkedIn counts it as 2 char units
      const result = validateLinkedInPost('🎉');
      expect(result.charCount).toBe(2);
    });
  });

  describe('preview generation', () => {
    it('should truncate desktop preview to 210 LinkedIn char units', () => {
      const text = repeat('a', 300) + '.';
      const result = validateLinkedInPost(text);
      expect(result.preview.desktop).toHaveLength(210);
    });

    it('should truncate mobile preview to 140 LinkedIn char units', () => {
      const text = repeat('a', 300) + '.';
      const result = validateLinkedInPost(text);
      expect(result.preview.mobile).toHaveLength(140);
    });

    it('should set hookComplete=false when desktop preview ends mid-sentence', () => {
      // 300 'a's with no terminal punctuation before the 210-char cutoff
      const text = repeat('a', 300);
      const result = validateLinkedInPost(text);
      expect(result.preview.hookComplete).toBe(false);
    });

    it('should set hookComplete=true when desktop preview ends on punctuation', () => {
      // Period lands exactly at char 210, so the 210-char preview ends with '.'
      const text = repeat('a', 209) + '.' + repeat('a', 100);
      const result = validateLinkedInPost(text);
      expect(result.preview.hookComplete).toBe(true);
    });
  });

  describe('mention validation', () => {
    it('should count @mentions correctly in stats', () => {
      // MENTION_REGEX is /@[\w\s]+/g — a second '@' terminates the previous match,
      // so two @-separated by ' and ' yields 2 matches.
      const text = '@Alice and @Bob — interesting perspectives.';
      const result = validateLinkedInPost(text);
      expect(result.stats.mentionCount).toBe(2);
    });

    it('should error when more than 40 mentions are present', () => {
      // Commas between handles break the greedy \s match, producing one match per handle
      const handles = Array.from({ length: 41 }, (_, i) => `@User${i}`).join(
        ',',
      );
      const result = validateLinkedInPost(handles);
      expect(result.errors.some((e) => e.includes('Too many mentions'))).toBe(
        true,
      );
    });
  });

  describe('hashtag validation', () => {
    it('should count hashtags correctly in stats', () => {
      const text = repeat('a', 209) + '. #nestjs #typescript';
      const result = validateLinkedInPost(text);
      expect(result.stats.hashtagCount).toBe(2);
    });

    it('should warn when hashtag count exceeds 30', () => {
      // MAX_HASHTAGS is 30; warning fires when count > 30
      const tags = Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(' ');
      const text = tags + ' ' + repeat('a', 400) + '.';
      const result = validateLinkedInPost(text);
      expect(result.warnings.some((w) => w.includes('hashtags detected'))).toBe(
        true,
      );
    });
  });

  describe('warnings', () => {
    it('should warn when post is shorter than 400 characters', () => {
      const result = validateLinkedInPost('Short post.');
      expect(result.warnings.some((w) => w.includes('very short'))).toBe(true);
    });

    it('should warn when emoji overhead exceeds 100 extra characters', () => {
      // Each emoji above BMP costs 1 extra unit; 101 emojis triggers the warning
      const text = '🎉'.repeat(101) + repeat('a', 209) + '.';
      const result = validateLinkedInPost(text);
      expect(result.stats.emojiCharCost).toBe(101);
      expect(result.warnings.some((w) => w.includes('extra characters'))).toBe(
        true,
      );
    });
  });
});
