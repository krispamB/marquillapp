export const POST_PREVIEW_CHARACTER_LIMIT = 140;

export function truncatePostPreview(content: string) {
  const characters = Array.from(content);
  return {
    content: characters.slice(0, POST_PREVIEW_CHARACTER_LIMIT).join(""),
    isTruncated: characters.length > POST_PREVIEW_CHARACTER_LIMIT,
  };
}
