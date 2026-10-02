import { countPdfPages } from './pdf-page-count';

const pdf = (pages: number, count = pages) =>
  new TextEncoder().encode(
    `%PDF-1.4\n1 0 obj << /Type /Pages /Count ${count} /Kids [] >> endobj\n` +
      Array.from(
        { length: pages },
        (_, i) => `${i + 2} 0 obj << /Type /Page /Parent 1 0 R >> endobj\n`,
      ).join(''),
  );

describe('countPdfPages', () => {
  it('should read the root page count when the page tree is uncompressed', () => {
    expect(countPdfPages(pdf(4))).toBe(4);
  });

  it('should take the root count when intermediate nodes count a subset', () => {
    const bytes = new TextEncoder().encode(
      '1 0 obj << /Type /Pages /Count 3 >> endobj\n' +
        '2 0 obj << /Type /Pages /Count 2 /Parent 1 0 R >> endobj\n' +
        '3 0 obj << /Type /Page >> endobj\n'.repeat(3),
    );
    expect(countPdfPages(bytes)).toBe(3);
  });

  it('should throw when the page tree cannot be read', () => {
    expect(() => countPdfPages(pdf(0))).toThrow('unreadable');
    expect(() => countPdfPages(pdf(3, 4))).toThrow('unreadable');
  });
});
