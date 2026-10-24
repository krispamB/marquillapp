/** One exact-text replacement a patch-mode Repair answers with. */
export interface CandidateEdit {
  find: string;
  replace: string;
}

export type CandidatePatchResult =
  | { ok: true; candidate: string }
  | { ok: false; problems: string[] };

const QUOTED_FIND_MAX = 60;

const normalise = (text: string): string => text.replace(/\r\n/g, '\n');

function quote(find: string): string {
  const shown =
    find.length > QUOTED_FIND_MAX ? `${find.slice(0, QUOTED_FIND_MAX)}…` : find;
  return JSON.stringify(shown);
}

/** Every index `find` starts at, so overlapping self-matches count. */
function matchStarts(text: string, find: string): number[] {
  const starts: number[] = [];
  for (
    let at = text.indexOf(find);
    at !== -1;
    at = text.indexOf(find, at + 1)
  ) {
    starts.push(at);
  }
  return starts;
}

/**
 * Applies a patch-mode Repair's edits to a Candidate Source. Exact bytes apart
 * from CRLF → LF. Each `find` must match exactly once, no two matched ranges
 * may overlap, and the result is all-or-nothing: any problem returns every
 * problem found and no candidate.
 */
export function applyEdits(
  candidate: string,
  edits: readonly CandidateEdit[],
): CandidatePatchResult {
  if (edits.length === 0) {
    return { ok: false, problems: ['No edits were given.'] };
  }

  const source = normalise(candidate);
  const problems: string[] = [];
  const located: {
    index: number;
    start: number;
    end: number;
    replace: string;
  }[] = [];

  edits.forEach((edit, i) => {
    const index = i + 1;
    const find = normalise(edit.find);
    if (find === '') {
      problems.push(`Edit ${index}: find is empty.`);
      return;
    }
    const starts = matchStarts(source, find);
    if (starts.length === 0) {
      problems.push(`Edit ${index}: find not found: ${quote(find)}.`);
    } else if (starts.length > 1) {
      problems.push(
        `Edit ${index}: find matches ${starts.length} times, it must match once: ${quote(find)}.`,
      );
    } else {
      located.push({
        index,
        start: starts[0],
        end: starts[0] + find.length,
        replace: normalise(edit.replace),
      });
    }
  });

  // Every pair, not just neighbours by start: one long range can cover several.
  for (let i = 0; i < located.length; i++) {
    for (let j = i + 1; j < located.length; j++) {
      const [a, b] = [located[i], located[j]];
      if (a.start < b.end && b.start < a.end) {
        problems.push(
          `Edits ${a.index} and ${b.index}: their find ranges overlap.`,
        );
      }
    }
  }

  const byStart = [...located].sort((a, b) => a.start - b.start);

  if (problems.length > 0) return { ok: false, problems };

  let result = source;
  for (const edit of [...byStart].reverse()) {
    result =
      result.slice(0, edit.start) + edit.replace + result.slice(edit.end);
  }
  return { ok: true, candidate: result };
}
