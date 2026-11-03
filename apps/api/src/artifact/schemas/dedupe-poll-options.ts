/**
 * The identity two POLL options share when they count as the same option: the
 * rule the content schema's uniqueness refine applies.
 */
export const pollOptionKey = (option: string): string =>
  option.trim().toLowerCase();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Drops POLL options that repeat an earlier one under `pollOptionKey`, keeping
 * the first, so a repeated option does not cost a whole repair turn. Runs on
 * the parsed model output before the schema check, never as a Zod transform,
 * which would break the strict JSON schema.
 *
 * Anything it cannot safely fix is returned as given, for the schema to
 * reject: a value without a `poll.options` string array, or one that would
 * keep fewer than 2 options.
 */
export function dedupePollOptions(value: unknown): {
  value: unknown;
  removed: number;
} {
  const unchanged = { value, removed: 0 };
  if (!isRecord(value) || !isRecord(value.poll)) return unchanged;

  const { options } = value.poll;
  if (
    !Array.isArray(options) ||
    !options.every((option): option is string => typeof option === 'string')
  ) {
    return unchanged;
  }

  const seen = new Set<string>();
  const kept = options.filter((option) => {
    const key = pollOptionKey(option);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const removed = options.length - kept.length;
  if (removed === 0 || kept.length < 2) return unchanged;

  return {
    value: { ...value, poll: { ...value.poll, options: kept } },
    removed,
  };
}
