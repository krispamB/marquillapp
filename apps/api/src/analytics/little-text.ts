/**
 * LinkedIn "little text" (the `commentary` of the Posts API) to plain text:
 * `{hashtag|\#|tag}` becomes `#tag`, `@[Name](urn:li:...)` becomes `Name`,
 * and backslash escapes such as `\(` lose their backslash.
 */
export function littleTextToPlain(commentary: string): string {
  return commentary
    .replace(/\{hashtag\|\\?[#＃]\|([^}]*)\}/g, '#$1')
    .replace(/@\[((?:\\.|[^\]\\])*)\]\(urn:li:[^)]+\)/g, '$1')
    .replace(/\\([\\|{}@[\]()<>#*_~])/g, '$1');
}

export const POST_EXCERPT_LENGTH = 280;

/** The first `length` characters (code points, never half an emoji), trimmed. */
export function excerpt(text: string, length = POST_EXCERPT_LENGTH): string {
  return Array.from(text.trim()).slice(0, length).join('').trim();
}
