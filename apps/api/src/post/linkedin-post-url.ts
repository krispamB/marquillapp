/**
 * Public URL of a published LinkedIn post, built from the URN LinkedIn returns
 * in `x-restli-id` (e.g. `urn:li:share:123` or `urn:li:ugcPost:123`).
 */
export function linkedinPostUrl(channelPostId?: string | null) {
  const urn = channelPostId?.trim();
  if (!urn || !urn.startsWith('urn:li:')) return undefined;
  return `https://www.linkedin.com/feed/update/${urn}/`;
}
