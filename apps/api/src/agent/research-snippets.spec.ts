import {
  buildSnippetResearch,
  normaliseSnippetUrl,
  type SnippetSearch,
} from './research-snippets';

const result = (url: string, title = url, content = `about ${url}`) => ({
  title,
  url,
  content,
  score: 1,
});

const LIMITS = { maxSnippets: 10, snippetChars: 600 };

describe('research snippets', () => {
  describe('normaliseSnippetUrl', () => {
    it.each([
      ['https://Example.com/a/', 'https://example.com/a'],
      ['https://example.com/a#section', 'https://example.com/a'],
      ['https://www.example.com/a', 'https://example.com/a'],
      [
        'https://example.com/a?utm_source=x&id=7&fbclid=y',
        'https://example.com/a?id=7',
      ],
      ['https://example.com/', 'https://example.com/'],
      ['http://example.com:80/a', 'http://example.com/a'],
    ])('should normalise %s to %s', (raw, expected) => {
      expect(normaliseSnippetUrl(raw)).toBe(expected);
    });

    it('should return a trimmed copy of a value that is not a URL', () => {
      expect(normaliseSnippetUrl('  not a url ')).toBe('not a url');
    });
  });

  describe('buildSnippetResearch', () => {
    it('should number each snippet as "[n] Title (url)" followed by its excerpt', () => {
      const searches: SnippetSearch[] = [
        {
          query: 'q1',
          results: [result('https://a.com/x', 'A title', 'A excerpt')],
        },
      ];

      expect(buildSnippetResearch(searches, LIMITS)).toEqual({
        findings: '[1] A title (https://a.com/x)\nA excerpt',
        sources: [{ title: 'A title', url: 'https://a.com/x' }],
        mode: 'snippets',
      });
    });

    it('should interleave results by query, taking each query’s best result first', () => {
      const searches: SnippetSearch[] = [
        {
          query: 'q1',
          results: [result('https://a.com/1'), result('https://a.com/2')],
        },
        { query: 'q2', results: [result('https://b.com/1')] },
        {
          query: 'q3',
          results: [result('https://c.com/1'), result('https://c.com/2')],
        },
      ];

      const { sources } = buildSnippetResearch(searches, LIMITS);

      expect(sources.map((s) => s.url)).toEqual([
        'https://a.com/1',
        'https://b.com/1',
        'https://c.com/1',
        'https://a.com/2',
        'https://c.com/2',
      ]);
    });

    it('should dedupe results whose normalised URLs match, keeping the first seen', () => {
      const searches: SnippetSearch[] = [
        { query: 'q1', results: [result('https://www.a.com/x/', 'First')] },
        {
          query: 'q2',
          results: [
            result('https://a.com/x?utm_medium=email#top', 'Second'),
            result('https://b.com/y', 'Other'),
          ],
        },
      ];

      const { findings, sources } = buildSnippetResearch(searches, LIMITS);

      expect(sources).toEqual([
        { title: 'First', url: 'https://a.com/x' },
        { title: 'Other', url: 'https://b.com/y' },
      ]);
      expect(findings).toContain('[2] Other (https://b.com/y)');
    });

    it('should cap the snippets at maxSnippets', () => {
      const searches: SnippetSearch[] = [
        {
          query: 'q1',
          results: Array.from({ length: 5 }, (_, i) =>
            result(`https://a.com/${i}`),
          ),
        },
        {
          query: 'q2',
          results: Array.from({ length: 5 }, (_, i) =>
            result(`https://b.com/${i}`),
          ),
        },
      ];

      const { findings, sources } = buildSnippetResearch(searches, {
        maxSnippets: 3,
        snippetChars: 600,
      });

      expect(sources).toHaveLength(3);
      expect(findings).toContain('[3] ');
      expect(findings).not.toContain('[4] ');
    });

    it('should collapse whitespace and cut each excerpt to snippetChars', () => {
      const searches: SnippetSearch[] = [
        {
          query: 'q1',
          results: [
            result('https://a.com', 'A', `one\n\n  two ${'x'.repeat(50)}`),
          ],
        },
      ];

      const { findings } = buildSnippetResearch(searches, {
        maxSnippets: 10,
        snippetChars: 20,
      });

      const excerpt = findings.split('\n')[1];
      expect(excerpt).toHaveLength(20);
      expect(excerpt.startsWith('one two x')).toBe(true);
      expect(excerpt.endsWith('…')).toBe(true);
    });

    it('should skip results with no excerpt and fall back to the URL for a missing title', () => {
      const searches: SnippetSearch[] = [
        {
          query: 'q1',
          results: [
            result('https://empty.com', 'Empty', '   '),
            result('https://untitled.com/p', '  ', 'Body'),
          ],
        },
      ];

      expect(buildSnippetResearch(searches, LIMITS)).toEqual({
        findings: '[1] https://untitled.com/p (https://untitled.com/p)\nBody',
        sources: [{ title: 'https://untitled.com/p', url: 'https://untitled.com/p' }],
        mode: 'snippets',
      });
    });

    it('should separate snippets with a blank line', () => {
      const searches: SnippetSearch[] = [
        {
          query: 'q1',
          results: [
            result('https://a.com', 'A', 'a'),
            result('https://b.com', 'B', 'b'),
          ],
        },
      ];

      expect(buildSnippetResearch(searches, LIMITS).findings).toBe(
        '[1] A (https://a.com/)\na\n\n[2] B (https://b.com/)\nb',
      );
    });

    it('should return empty findings and sources when no search found anything', () => {
      expect(buildSnippetResearch([], LIMITS)).toEqual({
        findings: '',
        sources: [],
        mode: 'snippets',
      });
    });
  });
});
