export function parseSrtToText(srt: string): string {
  return (
    srt
      // Remove sequence numbers (lines with only digits)
      .replace(/^\d+$/gm, '')
      // Remove timestamps
      .replace(/\d{2}:\d{2}:\d{2},\d{3} --> .*$/gm, '')
      // Remove extra spacing
      .replace(/\s+/g, ' ')
      .trim()
  );
}
