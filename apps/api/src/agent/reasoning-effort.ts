import { REASONING_EFFORTS } from '../llm/interfaces';
import type { ReasoningEffort } from '../llm/interfaces';

const isReasoningEffort = (value: string): value is ReasoningEffort =>
  (REASONING_EFFORTS as readonly string[]).includes(value);

/**
 * Reads one `*_REASONING_EFFORT` setting. Unset, empty or blank means no
 * effort is sent, which is the provider's default. Otherwise the value, after
 * trimming, must be one of `REASONING_EFFORTS` exactly (lowercase); anything
 * else throws, so a typo fails boot instead of silently sending nothing.
 *
 * Whether the configured model accepts the effort is not checked here: that
 * differs per model, and only the provider knows.
 */
export const readReasoningEffort = (
  raw: string | number | null | undefined,
  key: string,
): ReasoningEffort | undefined => {
  if (raw === undefined || raw === null) return undefined;
  const value = String(raw).trim();
  if (value === '') return undefined;
  if (isReasoningEffort(value)) return value;
  throw new Error(
    `${key} must be one of ${REASONING_EFFORTS.join(', ')}, or unset; got "${String(raw)}"`,
  );
};
