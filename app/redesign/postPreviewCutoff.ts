export const POST_PREVIEW_CHARACTER_LIMIT = 140;

export function truncatePostPreview(
  content: string,
  limit = POST_PREVIEW_CHARACTER_LIMIT,
) {
  const characters = Array.from(content);
  return {
    content: characters.slice(0, limit).join(""),
    isTruncated: characters.length > limit,
  };
}
