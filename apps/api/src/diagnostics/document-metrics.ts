import type {
  RenderPhase,
  RenderSessionOutcome,
} from '../document-render/render-usage.types';
import type {
  CandidateDiagnostics,
  CheckOutcome,
  DocumentCheck,
  DocumentDiagnostics,
  RepairDiagnostic,
} from '../workflow/engine/workflow.types';
import { remedyOf } from '../document-render/render-remedy';
import { FailureCode } from '../workflow/workflow.constants';

/**
 * One terminal DOCUMENT run, reduced to what the metrics read (spec §11.5).
 * `DocumentMetricsService` projects it from `documentDiagnostics` and
 * `renderAttempts`; tests and other callers can build it directly.
 */
export interface DocumentRunRow {
  /** The run's id, so a caller can tell which run a figure belongs to. */
  runId?: string;
  /** The pinned Design System's id; absent only for a run that carried no pin. */
  designSystemId?: string;
  outcome: Exclude<DocumentDiagnostics['outcome'], 'RETRYING'>;
  failureCode?: FailureCode;
  /** Every job attempt's code, so a truncation that a retry absorbed counts. */
  jobAttemptFailureCodes: FailureCode[];
  candidates: CandidateDiagnostics[];
  repairRounds: number;
  /** One entry per Repair round; absent on runs recorded before patch mode. */
  repairs?: RepairDiagnostic[];
  wallTimeMs: number;
  /** What the latest job attempt metered; it is charged only when `READY`. */
  credits: number;
  pageCount?: number;
  renderAttempts: {
    outcome: RenderSessionOutcome;
    billed: boolean;
    units: number;
    /** Set on a session that hit its deadline; `phase` is where it hung. */
    timedOut?: boolean;
    /** Absent on sessions recorded before phases were traced. */
    phase?: RenderPhase;
  }[];
}

export interface Percentiles {
  p50: number | null;
  p95: number | null;
  /** The largest value, for gates on the slowest or costliest run. */
  max: number | null;
}

/** A violation code and how often it showed up. */
export interface ViolationTally {
  code: string;
  /** Checks that sent a candidate to Repair with this code. */
  checks: number;
  /** Violations with this code, summed over those checks. */
  count: number;
}

/** What `patch`-mode Repair rounds did (spec §11.1), for the go/no-go on `DOCUMENT_REPAIR_MODE`. */
export interface PatchRepairStats {
  /** Rounds that ran in `patch` mode. */
  rounds: number;
  /** Rounds the model answered with edits. */
  editRounds: number;
  /** Rounds the model answered with the whole html. */
  htmlRounds: number;
  /** Rounds whose edits did not apply. */
  fallbacks: number;
  /** `fallbacks / editRounds`; null when no round answered with edits. */
  fallbackRate: number | null;
  /** Edits per edit round; null when there is none. */
  meanEdits: number | null;
}

/** The metrics of one group of runs: all of them, or one Design System's. */
export interface DocumentMetricsBucket {
  runs: number;
  ready: number;
  /** `ready / runs`; null when there are no runs. */
  readyRate: number | null;
  /** FAILED runs per final `failureCode`. */
  failures: Partial<Record<FailureCode, number>>;
  /**
   * Runs whose first Candidate Source needed no Repair and rendered cleanly,
   * out of runs whose first Candidate Source reached a verdict: it was
   * repaired, or it passed a render. A run that stopped on a render outage
   * says nothing about its candidate and is left out.
   */
  firstCandidate: { runs: number; passed: number; passRate: number | null };
  /** Runs per Repair rounds spent (`"0"`, `"1"`, ...). */
  repairRounds: Record<string, number>;
  /** Present only when at least one Repair round ran in `patch` mode. */
  patchRepairs?: PatchRepairStats;
  /** The ten most frequent violation codes, per check phase. */
  violations: { static: ViolationTally[]; render: ViolationTally[] };
  /** Runs where any job attempt failed with `document.truncated`. */
  truncations: number;
  /** `truncations / runs`; null when there are no runs. */
  truncationRate: number | null;
  renderSessions: {
    total: number;
    /** Sessions per run; null when there are no runs. */
    perRun: number | null;
    /** Sessions that ended in a `retry` finding. */
    retries: number;
    billedUnits: number;
    /** Units of sessions that were not billed to the user. */
    absorbedUnits: number;
    /**
     * Sessions that hit the deadline, per phase they hung in; `unknown` for a
     * session recorded before phases were traced (§11.1).
     */
    timeoutsByPhase: Partial<Record<RenderPhase | 'unknown', number>>;
  };
  wallTimeMs: Percentiles;
  /** Over `READY` runs: a failed run's credits are metered, never charged. */
  credits: Percentiles;
}

export interface DocumentMetrics {
  /** Start of the window, or null when it was not bounded. */
  since: Date | null;
  overall: DocumentMetricsBucket;
  /** By Design System id, ids in alphabetical order. */
  byDesignSystem: Record<string, DocumentMetricsBucket>;
}

const UNPINNED = 'unpinned';
const TOP_VIOLATIONS = 10;

/** Pure: the same rows always give the same metrics. */
export function computeDocumentMetrics(
  rows: DocumentRunRow[],
  since: Date | null = null,
): DocumentMetrics {
  const groups = new Map<string, DocumentRunRow[]>();
  for (const row of rows) {
    const key = row.designSystemId ?? UNPINNED;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const byDesignSystem: Record<string, DocumentMetricsBucket> = {};
  for (const key of [...groups.keys()].sort()) {
    byDesignSystem[key] = bucketOf(groups.get(key) ?? []);
  }
  return { since, overall: bucketOf(rows), byDesignSystem };
}

function bucketOf(rows: DocumentRunRow[]): DocumentMetricsBucket {
  const ready = rows.filter((row) => row.outcome === 'READY').length;
  const truncations = rows.filter((row) =>
    row.jobAttemptFailureCodes.includes(FailureCode.DOCUMENT_TRUNCATED),
  ).length;
  const failures: Partial<Record<FailureCode, number>> = {};
  for (const row of rows) {
    if (row.outcome === 'READY' || !row.failureCode) continue;
    failures[row.failureCode] = (failures[row.failureCode] ?? 0) + 1;
  }
  return {
    runs: rows.length,
    ready,
    readyRate: rate(ready, rows.length),
    failures,
    firstCandidate: firstCandidateOf(rows),
    repairRounds: repairRoundsOf(rows),
    ...patchRepairsOf(rows),
    violations: {
      static: topViolations(rows, 'static'),
      render: topViolations(rows, 'render'),
    },
    truncations,
    truncationRate: rate(truncations, rows.length),
    renderSessions: renderSessionsOf(rows),
    wallTimeMs: percentiles(rows.map((row) => row.wallTimeMs)),
    credits: percentiles(
      rows.filter((row) => row.outcome === 'READY').map((row) => row.credits),
    ),
  };
}

function firstCandidateOf(
  rows: DocumentRunRow[],
): DocumentMetricsBucket['firstCandidate'] {
  const verdicts = rows
    .flatMap((row) => row.candidates.slice(0, 1))
    .map(({ checks }) => ({
      repaired: checks.some(neededRepair),
      rendered: checks.some(
        ({ phase, passed }) => phase === 'render' && passed,
      ),
    }))
    .filter(({ repaired, rendered }) => repaired || rendered);
  const passed = verdicts.filter(({ repaired }) => !repaired).length;
  return {
    runs: verdicts.length,
    passed,
    passRate: rate(passed, verdicts.length),
  };
}

/**
 * Whether a check sent its candidate to Repair. A `retry` finding renders
 * again and a `defect` ends the run: neither spends a Repair (spec §7.3), so
 * neither counts against the candidate (the same strongest-remedy rule as
 * the render step's session outcome).
 */
function neededRepair({ passed, violations }: CheckOutcome): boolean {
  if (passed) return false;
  const remedies = violations.map(({ code }) => remedyOf(code));
  return (
    !remedies.includes('defect') &&
    !remedies.includes('retry') &&
    remedies.includes('repair')
  );
}

function repairRoundsOf(rows: DocumentRunRow[]): Record<string, number> {
  const histogram: Record<string, number> = {};
  for (const { repairRounds } of [...rows].sort(
    (a, b) => a.repairRounds - b.repairRounds,
  )) {
    histogram[repairRounds] = (histogram[repairRounds] ?? 0) + 1;
  }
  return histogram;
}

function patchRepairsOf(
  rows: DocumentRunRow[],
): { patchRepairs: PatchRepairStats } | Record<string, never> {
  const patch = rows
    .flatMap((row) => row.repairs ?? [])
    .filter(({ mode }) => mode === 'patch');
  if (patch.length === 0) return {};
  const edited = patch.filter(({ edits }) => edits > 0);
  const fallbacks = patch.filter(({ fallback }) => fallback).length;
  const totalEdits = edited.reduce((sum, { edits }) => sum + edits, 0);
  return {
    patchRepairs: {
      rounds: patch.length,
      editRounds: edited.length,
      htmlRounds: patch.length - edited.length,
      fallbacks,
      fallbackRate: rate(fallbacks, edited.length),
      meanEdits: edited.length === 0 ? null : totalEdits / edited.length,
    },
  };
}

function topViolations(
  rows: DocumentRunRow[],
  phase: DocumentCheck['phase'],
): ViolationTally[] {
  const tallies = new Map<string, ViolationTally>();
  for (const { candidates } of rows) {
    for (const { checks } of candidates) {
      for (const check of checks) {
        if (check.phase !== phase || !neededRepair(check)) continue;
        for (const { code, count } of check.violations) {
          const tally = tallies.get(code) ?? { code, checks: 0, count: 0 };
          tally.checks += 1;
          tally.count += count;
          tallies.set(code, tally);
        }
      }
    }
  }
  return [...tallies.values()]
    .sort(
      (a, b) =>
        b.checks - a.checks ||
        b.count - a.count ||
        a.code.localeCompare(b.code),
    )
    .slice(0, TOP_VIOLATIONS);
}

function renderSessionsOf(
  rows: DocumentRunRow[],
): DocumentMetricsBucket['renderSessions'] {
  const sessions = rows.flatMap((row) => row.renderAttempts);
  const units = (billed: boolean) =>
    sessions
      .filter((session) => session.billed === billed)
      .reduce((sum, session) => sum + session.units, 0);
  return {
    total: sessions.length,
    perRun: rows.length === 0 ? null : sessions.length / rows.length,
    retries: sessions.filter((session) => session.outcome === 'RETRY').length,
    billedUnits: units(true),
    absorbedUnits: units(false),
    timeoutsByPhase: timeoutsByPhase(sessions),
  };
}

function timeoutsByPhase(
  sessions: DocumentRunRow['renderAttempts'],
): DocumentMetricsBucket['renderSessions']['timeoutsByPhase'] {
  const counts: DocumentMetricsBucket['renderSessions']['timeoutsByPhase'] = {};
  for (const session of sessions) {
    if (!session.timedOut) continue;
    const phase = session.phase ?? 'unknown';
    counts[phase] = (counts[phase] ?? 0) + 1;
  }
  return counts;
}

/**
 * Nearest-rank percentiles, computed here rather than with Mongo's
 * `$percentile`: it needs MongoDB 7+, and the rest of the metrics are derived
 * per run, so one projected read keeps every number in one pure, testable
 * function. The read is one small row per run, and a week holds hundreds.
 */
function percentiles(values: number[]): Percentiles {
  if (values.length === 0) return { p50: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.ceil(p * sorted.length) - 1];
  return { p50: at(0.5), p95: at(0.95), max: at(1) };
}

function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}
