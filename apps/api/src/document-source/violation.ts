import {
  MODEL_VIOLATIONS_PER_CODE,
  MODEL_VIOLATIONS_TOTAL,
} from './document-source.constants';

/**
 * One reason a Candidate Source is rejected (§4.4). `code` is a Design System
 * Definition key path (`typography.scale`) or an `envelope.*` code. There is no
 * severity: every violation is a hard reject.
 */
export type Violation = {
  code: string;
  detail: string;
  /** One-based page element the violation is on. */
  page?: number;
  /** One-based line in the Candidate Source. */
  line?: number;
};

/** What a Repair prompt receives instead of every violation. */
export interface BoundedViolations {
  violations: Violation[];
  /** Violations left out, counted per `code`, in first-seen order. */
  omitted: { code: string; count: number }[];
}

/**
 * Bounds the violations sent to the model (§4.4): at most 3 per `code`, at most
 * 40 in total, and a count of the rest per `code`. The full list is still
 * recorded on the run.
 */
export function boundViolations(all: Violation[]): BoundedViolations {
  const shownPerCode = new Map<string, number>();
  const omitted = new Map<string, number>();
  const violations: Violation[] = [];

  for (const violation of all) {
    const shown = shownPerCode.get(violation.code) ?? 0;
    if (
      shown < MODEL_VIOLATIONS_PER_CODE &&
      violations.length < MODEL_VIOLATIONS_TOTAL
    ) {
      violations.push(violation);
      shownPerCode.set(violation.code, shown + 1);
    } else {
      omitted.set(violation.code, (omitted.get(violation.code) ?? 0) + 1);
    }
  }

  return {
    violations,
    omitted: [...omitted].map(([code, count]) => ({ code, count })),
  };
}
