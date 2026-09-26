// LinkedIn counts emojis by their Unicode code unit length,
// not grapheme clusters. We replicate that here.
export function linkedInCharCount(text: string): number {
  let count = 0;
  for (const char of text) {
    // Each code point that falls outside BMP (surrogate pairs) = 2 units
    const cp = char.codePointAt(0) ?? 0;
    count += cp > 0xffff ? 2 : 1;
  }
  return count;
}
