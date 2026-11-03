import { buildNativeResearch } from './research-native';

describe('researchNative', () => {
  describe('buildNativeResearch', () => {
    it('should keep the trimmed synthesis as findings and mark the mode native', () => {
      expect(buildNativeResearch('  Facts.\n', [])).toEqual({
        findings: 'Facts.',
        sources: [],
        mode: 'native',
      });
    });

    it('should dedupe cited pages by normalised URL, keeping the first as returned', () => {
      const result = buildNativeResearch('x', [
        { url: 'https://www.a.com/p/?utm_source=x', title: 'A' },
        { url: 'https://a.com/p', title: 'A again' },
        { url: ' https://b.com ', title: ' B ' },
      ]);

      expect(result.sources).toEqual([
        { title: 'A', url: 'https://www.a.com/p/?utm_source=x' },
        { title: 'B', url: 'https://b.com' },
      ]);
    });

    it('should use the URL as the title when a citation has none', () => {
      expect(
        buildNativeResearch('x', [{ url: 'https://c.com', title: '' }]).sources,
      ).toEqual([{ title: 'https://c.com', url: 'https://c.com' }]);
    });
  });
});
