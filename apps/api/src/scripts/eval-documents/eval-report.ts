import type {
  DocumentMetricsBucket,
  PatchRepairStats,
  Percentiles,
  ViolationTally,
} from '../../diagnostics/document-metrics';
import { EVAL_BRIEFS } from './briefs';
import { formatDuration, type SystemVerdict } from './eval-gates';
import type { EvalResult } from './eval-runner';

/**
 * The go/no-go for switching `DOCUMENT_REPAIR_MODE`
 * (`src/workflow/workflow.constants.ts`) to `patch`: the fallback rate must be
 * under this (spec §11.1, issue #232).
 */
const PATCH_FALLBACK_RATE_LIMIT = 0.2;

const VERDICT_TEXT: Record<SystemVerdict, string> = {
  LIST: 'list it',
  RERUN_OR_UNLIST: 're-run its 3 or ship it unlisted',
  UNLIST: 'unlist it',
};

/** The eval's result as the text a person reads and pastes into the issue. */
export function formatEvalReport(result: EvalResult): string {
  const { evaluation, metrics } = result;
  const lines: string[] = [];
  const section = (title: string) => lines.push('', `== ${title} ==`);

  lines.push(
    'Pre-rollout document eval',
    `Started ${result.startedAt}, finished ${result.finishedAt}; ${result.records.length} runs, concurrency ${result.options.concurrency}`,
  );

  section('Runs');
  const failureCodes = new Map(
    result.rows.map((row) => [row.runId, row.failureCode]),
  );
  lines.push(
    ...table(
      ['run', 'pages', 'state', 'run id', 'note'],
      result.records.map((record) => [
        record.key,
        record.requestedPages > 0 ? String(record.requestedPages) : '-',
        record.state,
        record.runId ?? '-',
        record.error ??
          failureCodes.get(record.runId) ??
          (record.sourceKey ? `refines ${record.sourceKey}` : ''),
      ]),
    ),
  );

  section('Aggregates (spec §11.5)');
  lines.push(
    ...table(
      [
        'scope',
        'runs',
        'ready',
        'ready %',
        'trunc',
        'sessions/run',
        'retries',
        'absorbed units',
        'wall p50 / p95',
        'credits p50 / p95',
      ],
      [
        bucketRow('overall', metrics.overall),
        ...Object.entries(metrics.byDesignSystem).map(([id, bucket]) =>
          bucketRow(id, bucket),
        ),
      ],
    ),
  );
  lines.push('', ...bucketDetail(metrics.overall));
  lines.push(...patchVerdict(metrics.overall.patchRepairs));
  for (const [id, bucket] of Object.entries(metrics.byDesignSystem)) {
    lines.push('', ...bucketDetail(bucket, id));
  }

  section('Gates (spec §11.3)');
  for (const gate of evaluation.gates) {
    lines.push(
      `${gate.pass ? 'PASS' : 'FAIL'}  ${gate.label}`,
      `      ${gate.detail}`,
    );
  }
  lines.push(
    '',
    `Alerts: check Railway logs for \`[ALERT\` between ${result.startedAt} and ${result.finishedAt} (alerts are log lines only, so this gate is manual)`,
  );

  section(`Per-system verdict (${EVAL_BRIEFS.length} INITIAL runs each)`);
  lines.push(
    ...table(
      ['system', 'failures', 'verdict'],
      evaluation.systems.map((system) => [
        system.designSystemId,
        `${system.failures} of ${system.runs} failed`,
        VERDICT_TEXT[system.verdict],
      ]),
    ),
  );
  const defaultSystem = evaluation.systems.find(
    ({ designSystemId }) => designSystemId === result.defaultDesignSystemId,
  );
  if (!defaultSystem || defaultSystem.verdict !== 'LIST') {
    lines.push(
      '',
      `DEFAULT DESIGN SYSTEM (${result.defaultDesignSystemId}) FAILED: ROLLOUT IS BLOCKED until it passes or the default changes to a system that passed (spec §11.4)`,
    );
  }

  section(
    'Cover review (every READY run: text over gradients, positioning outside the spacing scale)',
  );
  lines.push(
    ...table(
      ['run id', 'system', 'pages', 'cover (presigned, expires in 24 h)'],
      result.covers.map((cover) => [
        cover.runId,
        cover.designSystemId ?? '-',
        String(cover.pageCount ?? '-'),
        cover.coverUrl ?? cover.note ?? '-',
      ]),
    ),
  );

  lines.push('', `RESULT: ${evaluation.passed ? 'PASS' : 'FAIL'}`);
  return lines.join('\n');
}

/** §11.5's per-group detail: failure codes, Repair rounds, violations, first-candidate rate. */
function bucketDetail(
  bucket: DocumentMetricsBucket,
  designSystemId?: string,
): string[] {
  const prefix = designSystemId ? `[${designSystemId}] ` : '';
  const failures = Object.entries(bucket.failures);
  const first = bucket.firstCandidate;
  return [
    `${prefix}Failure codes: ${failures.length === 0 ? 'none' : failures.map(([code, count]) => `${code}: ${count}`).join(', ')}`,
    `${prefix}Repair rounds (runs per rounds spent): ${JSON.stringify(bucket.repairRounds)}`,
    ...patchLines(bucket.patchRepairs, prefix),
    `${prefix}Render timeouts by phase: ${timeouts(bucket.renderSessions.timeoutsByPhase)}`,
    `${prefix}Top static violations: ${violations(bucket.violations.static)}`,
    `${prefix}Top render violations: ${violations(bucket.violations.render)}`,
    `${prefix}First-candidate pass rate: ${percent(first.passRate)} (${first.passed} of ${first.runs}) — recorded, not gated`,
  ];
}

function patchLines(
  patch: PatchRepairStats | undefined,
  prefix: string,
): string[] {
  if (!patch) return [];
  const mean = patch.meanEdits === null ? 'n/a' : patch.meanEdits.toFixed(1);
  return [
    `${prefix}Patch Repairs: ${patch.rounds} rounds; ${patch.editRounds} answered with edits, ${patch.htmlRounds} with html; ${patch.fallbacks} fell back; mean ${mean} edits per edit round`,
  ];
}

/** The overall fallback rate and whether it clears the limit; nothing without patch rounds. */
function patchVerdict(patch: PatchRepairStats | undefined): string[] {
  if (!patch) return [];
  const limit = `${PATCH_FALLBACK_RATE_LIMIT * 100}%`;
  const lines = [
    '',
    `Patch fallback rate: ${percent(patch.fallbackRate)} (${patch.fallbacks} of ${patch.editRounds} edit rounds)`,
  ];
  if (patch.fallbackRate !== null) {
    lines.push(
      patch.fallbackRate < PATCH_FALLBACK_RATE_LIMIT
        ? `PATCH GO: fallback rate is under ${limit} (DOCUMENT_REPAIR_MODE may switch to patch if no other gate is worse)`
        : `PATCH NO-GO: fallback rate is not under ${limit} (keep DOCUMENT_REPAIR_MODE at full)`,
    );
  }
  return lines;
}

function timeouts(
  byPhase: DocumentMetricsBucket['renderSessions']['timeoutsByPhase'],
): string {
  const entries = Object.entries(byPhase);
  return entries.length === 0
    ? 'none'
    : entries.map(([phase, count]) => `${phase}: ${count}`).join(', ');
}

function bucketRow(scope: string, bucket: DocumentMetricsBucket): string[] {
  return [
    scope,
    String(bucket.runs),
    String(bucket.ready),
    percent(bucket.readyRate),
    String(bucket.truncations),
    bucket.renderSessions.perRun?.toFixed(1) ?? 'n/a',
    String(bucket.renderSessions.retries),
    String(bucket.renderSessions.absorbedUnits),
    spread(bucket.wallTimeMs, formatDuration),
    spread(bucket.credits, String),
  ];
}

function spread(
  { p50, p95 }: Percentiles,
  format: (value: number) => string,
): string {
  return p50 === null || p95 === null
    ? 'n/a'
    : `${format(p50)} / ${format(p95)}`;
}

function violations(tallies: ViolationTally[]): string {
  return tallies.length === 0
    ? 'none'
    : tallies.map(({ code, checks }) => `${code} (${checks})`).join(', ');
}

function percent(rate: number | null): string {
  return rate === null ? 'n/a' : `${(rate * 100).toFixed(1)}%`;
}

/** Left-aligned columns, two spaces apart, indented under their heading. */
function table(header: string[], rows: string[][]): string[] {
  const all = [header, ...rows];
  const widths = header.map((_, column) =>
    Math.max(...all.map((row) => row[column].length)),
  );
  return all.map((row) =>
    row
      .map((cell, column) => cell.padEnd(widths[column]))
      .join('  ')
      .trimEnd(),
  );
}
