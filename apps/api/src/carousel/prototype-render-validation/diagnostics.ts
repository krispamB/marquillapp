/**
 * PROTOTYPE — the repair diagnostic the model sees. Throwaway (issue #163).
 *
 * #162's rule, applied to render findings unchanged: every violation is recorded
 * on the run, and the model gets at most 3 per code (with a count of the rest)
 * and 40 in total — of the findings it can act on. The render pass shares the static checker's vocabulary and
 * its budget, so a repair prompt is one list, not two.
 */
import type { Violation } from './types';

export const PER_CODE = 3;
export const TOTAL = 40;

/**
 * Who acts on a finding. Only `repair` goes to the model: a font outage or a
 * timeout is fixed by rendering again, and a request the session had to refuse
 * means the static checker let something through — a bug, never a prompt.
 */
export type Remedy = 'repair' | 'retry' | 'defect';

const NOT_REPAIR: Record<string, Remedy> = {
  'render.timeout': 'retry',
  'render.fonts.failed': 'retry',
  'render.egress': 'defect',
};

export const remedyOf = (code: string): Remedy => NOT_REPAIR[code] ?? 'repair';

const line = (v: Violation) =>
  `- [${v.code}]${v.page ? ` page ${v.page}` : ''}${v.line ? ` line ${v.line}` : ''}: ${v.detail}`;

export function boundForModel(violations: Violation[]): string {
  const byCode = new Map<string, Violation[]>();
  for (const v of violations.filter((x) => remedyOf(x.code) === 'repair'))
    byCode.set(v.code, [...(byCode.get(v.code) ?? []), v]);

  const lines: string[] = [];
  let shown = 0;
  let unreached = 0;
  for (const [code, group] of byCode) {
    const room = Math.min(PER_CODE, TOTAL - shown);
    if (room <= 0) {
      unreached += group.length;
      continue;
    }
    for (const v of group.slice(0, room)) lines.push(line(v));
    shown += Math.min(room, group.length);
    if (group.length > room)
      lines.push(`  (and ${group.length - room} more [${code}])`);
  }
  if (unreached)
    lines.push(`(and ${unreached} more findings under other codes)`);
  return lines.join('\n');
}
