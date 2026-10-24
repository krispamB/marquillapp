import { ArtifactType } from 'src/database/schemas';
import type { TextEvalType } from './briefs';
import type { TextEvalRecord, TextEvalResult } from './eval-text-runner';

export interface TextEvalSummary {
  model: string;
  type: TextEvalType;
  runs: number;
  failed: number;
  /** Runs that needed a second model call (a repair turn). */
  repaired: number;
  /** Over successful runs; null when there are none. */
  latencyMs: { p50: number | null; p90: number | null };
  /** Mean per successful run. */
  tokens: {
    prompt: number | null;
    completion: number | null;
    reasoning: number | null;
    total: number | null;
  };
  meanCostUsd: number | null;
}

/** Nearest-rank percentile of an unsorted list. */
export function percentile(values: readonly number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

const mean = (values: readonly number[]): number | null =>
  values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;

/** Pure: one row per (model, type), models in the order given, POST before POLL. */
export function summarizeTextEval(
  records: readonly TextEvalRecord[],
  models: readonly string[],
): TextEvalSummary[] {
  const summaries: TextEvalSummary[] = [];
  for (const model of models) {
    for (const type of [ArtifactType.POST, ArtifactType.POLL] as const) {
      const rows = records.filter((r) => r.model === model && r.type === type);
      if (rows.length === 0) continue;
      const ok = rows.filter((r) => r.ok);
      summaries.push({
        model,
        type,
        runs: rows.length,
        failed: rows.length - ok.length,
        repaired: rows.filter((r) => r.calls > 1).length,
        latencyMs: {
          p50: percentile(
            ok.map((r) => r.latencyMs),
            0.5,
          ),
          p90: percentile(
            ok.map((r) => r.latencyMs),
            0.9,
          ),
        },
        tokens: {
          prompt: mean(ok.map((r) => r.promptTokens)),
          completion: mean(ok.map((r) => r.completionTokens)),
          reasoning: mean(ok.map((r) => r.reasoningTokens)),
          total: mean(ok.map((r) => r.totalTokens)),
        },
        meanCostUsd: mean(ok.map((r) => r.costUsd)),
      });
    }
  }
  return summaries;
}

const seconds = (ms: number | null) =>
  ms === null ? '-' : (ms / 1000).toFixed(1);
const whole = (value: number | null) =>
  value === null ? '-' : String(Math.round(value));
const usd = (value: number | null) => (value === null ? '-' : value.toFixed(4));

const SUMMARY_HEADER = [
  'model',
  'type',
  'runs',
  'failed',
  'repaired',
  'p50 s',
  'p90 s',
  'prompt tok',
  'completion tok',
  'reasoning tok',
  'total tok',
  'cost USD',
];

const summaryRow = (s: TextEvalSummary): string[] => [
  s.model,
  s.type,
  String(s.runs),
  String(s.failed),
  String(s.repaired),
  seconds(s.latencyMs.p50),
  seconds(s.latencyMs.p90),
  whole(s.tokens.prompt),
  whole(s.tokens.completion),
  whole(s.tokens.reasoning),
  whole(s.tokens.total),
  usd(s.meanCostUsd),
];

function textTable(header: string[], rows: string[][]): string[] {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i].length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i]))
      .join('  ')
      .trimEnd();
  return [
    line(header),
    line(widths.map((w) => '-'.repeat(w))),
    ...rows.map(line),
  ];
}

/** Token and latency means are over successful runs; the header says so. */
export function formatTextEvalReport(result: TextEvalResult): string {
  const summaries = summarizeTextEval(result.records, result.models);
  return [
    'Text eval (POST and POLL generation)',
    `Started ${result.startedAt}, finished ${result.finishedAt}; ${result.records.length} calls, models: ${result.models.join(', ')}`,
    '',
    'Latency percentiles, token means and mean cost are over successful runs. "repaired" counts runs that needed a second model call.',
    '',
    ...textTable(SUMMARY_HEADER, summaries.map(summaryRow)),
    ...result.records
      .filter((r) => !r.ok)
      .map((r) => `FAILED ${r.model} ${r.briefId}: ${r.error}`),
  ].join('\n');
}

const cell = (text: string) =>
  text.replace(/\|/g, '\\|').replace(/\n/g, '<br>');

function outputOf(record: TextEvalRecord | undefined): string {
  if (!record) return '(not run)';
  if (!record.ok) return `FAILED: ${record.error ?? 'unknown error'}`;
  return JSON.stringify(
    { ...(record.title ? { title: record.title } : {}), ...record.content },
    null,
    2,
  );
}

/** The side-by-side Markdown a person reads: the summary table, then each brief's outputs per model. */
export function formatTextEvalMarkdown(result: TextEvalResult): string {
  const summaries = summarizeTextEval(result.records, result.models);
  const lines = [
    '# Text eval',
    '',
    `Started ${result.startedAt}, finished ${result.finishedAt}. Baseline: \`${result.models[0]}\`.`,
    '',
    '## Latency and tokens',
    '',
    '| ' + SUMMARY_HEADER.join(' | ') + ' |',
    '| ' + SUMMARY_HEADER.map(() => '---').join(' | ') + ' |',
    ...summaries.map((s) => '| ' + summaryRow(s).map(cell).join(' | ') + ' |'),
    '',
    '## Outputs',
  ];
  for (const brief of result.briefs) {
    lines.push('', `### ${brief.id} (${brief.type})`, '', `> ${brief.prompt}`);
    for (const model of result.models) {
      const record = result.records.find(
        (r) => r.model === model && r.briefId === brief.id,
      );
      const timing = record
        ? ` (${seconds(record.latencyMs)} s, ${record.totalTokens} tok${record.calls > 1 ? ', repaired' : ''})`
        : '';
      lines.push(
        '',
        `**${model}**${timing}`,
        '',
        '```json',
        outputOf(record),
        '```',
      );
    }
  }
  return lines.join('\n') + '\n';
}
