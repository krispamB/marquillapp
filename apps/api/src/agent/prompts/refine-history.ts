/** How many of the newest requests may be quoted in full. */
const MAX_VERBATIM_REQUESTS = 8;
/** The characters of request text the section holds, numbering aside. */
const MAX_REQUESTS_CHARS = 4000;
/** What is left of a request that is not quoted in full. */
const SHORTENED_REQUEST_CHARS = 160;

/**
 * The refinement requests already applied to a base, as a numbered section,
 * oldest first, or nothing when there are none. The newest are quoted in full
 * while they fit; the others are shortened, and the oldest are dropped when
 * even that does not fit. A request keeps its number when older ones are
 * dropped.
 */
export function formatEarlierRequests(
  requests: readonly string[],
): string | undefined {
  if (requests.length === 0) return undefined;

  const kept: string[] = [];
  let used = 0;
  // Newest first, so the budget goes to the most recent requests.
  for (const request of [...requests].reverse()) {
    const verbatim =
      kept.length < MAX_VERBATIM_REQUESTS &&
      used + request.length <= MAX_REQUESTS_CHARS;
    const text = verbatim ? request : shorten(request);
    if (used + text.length > MAX_REQUESTS_CHARS) break;
    kept.unshift(text);
    used += text.length;
  }

  const omitted = requests.length - kept.length;
  return [
    'EARLIER REVISION REQUESTS:',
    ...(omitted > 0
      ? [`(${omitted} earlier request${omitted === 1 ? '' : 's'} omitted)`]
      : []),
    ...kept.map((text, index) => `${omitted + index + 1}. ${text}`),
  ].join('\n');
}

function shorten(request: string): string {
  if (request.length <= SHORTENED_REQUEST_CHARS) return request;
  // The cut must not leave half of a surrogate pair behind.
  const head = request
    .slice(0, SHORTENED_REQUEST_CHARS)
    .replace(/[\uD800-\uDBFF]$/, '');
  return `${head}…`;
}
