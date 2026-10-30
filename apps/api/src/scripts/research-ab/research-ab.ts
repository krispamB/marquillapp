import { ArtifactType } from '../../database/schemas/artifact.schema';
import type {
  AgentHooks,
  ResearchInput,
  ResearchMode,
  ResearchResult,
} from '../../agent/agent-runner.interface';

/** One fixed brief, researched in every mode so the modes compare like for like. */
export interface ResearchAbBrief {
  id: string;
  type: ArtifactType.POST | ArtifactType.DOCUMENT;
  prompt: string;
}

/**
 * Briefs that each need current facts, so research has something to find.
 * Never edit one in place: a changed brief makes old results incomparable.
 * Add a new id instead.
 */
export const RESEARCH_AB_BRIEFS: readonly ResearchAbBrief[] = [
  {
    id: 'post-ai-coding-adoption',
    type: ArtifactType.POST,
    prompt:
      'How engineering teams are actually adopting AI coding assistants this year, and what the productivity studies say',
  },
  {
    id: 'post-four-day-week',
    type: ArtifactType.POST,
    prompt:
      'What the latest four-day work week trials found about productivity and retention',
  },
  {
    id: 'post-eu-ai-act',
    type: ArtifactType.POST,
    prompt:
      'What the EU AI Act obligations that apply now mean for a small SaaS company',
  },
  {
    id: 'document-heat-pumps',
    type: ArtifactType.DOCUMENT,
    prompt:
      'A 6-page guide to the state of residential heat pumps: adoption numbers, costs, incentives and common objections',
  },
  {
    id: 'document-remote-hiring',
    type: ArtifactType.DOCUMENT,
    prompt:
      'An 8-page playbook on hiring remote engineers across time zones, with current salary and hiring-market data',
  },
  {
    id: 'document-battery-storage',
    type: ArtifactType.DOCUMENT,
    prompt:
      'A 5-page explainer on grid battery storage growth: installed capacity, prices and the biggest projects',
  },
];

/** Every mode `--modes` accepts. */
export const RESEARCH_MODES: readonly ResearchMode[] = [
  'agent',
  'snippets',
  'native',
];

/**
 * The modes compared when `--modes` is not given. `native` is opt-in: it
 * needs `ANTHROPIC_API_KEY` and spends Anthropic credit.
 */
export const DEFAULT_RESEARCH_AB_MODES: readonly ResearchMode[] = [
  'agent',
  'snippets',
];

/** Researches one brief in one mode; the real one is an `AgentRunnerService`. */
export type ResearchFn = (
  mode: ResearchMode,
  input: ResearchInput,
  hooks: AgentHooks,
) => Promise<ResearchResult>;

export interface ResearchAbRecord {
  briefId: string;
  type: ResearchAbBrief['type'];
  mode: ResearchMode;
  repeat: number;
  ms: number;
  llmCalls: number;
  costUsd: number;
  /**
   * Searches that returned, i.e. the `web_search` charges, plus the model's
   * own server-side searches in `native` mode.
   */
  searches: number;
  sources: number;
  findingsChars: number;
  findings: string;
  error?: string;
}

export interface ResearchAbOptions {
  modes: readonly ResearchMode[];
  repeat: number;
  briefs?: readonly ResearchAbBrief[];
}

/**
 * Runs every brief in every mode, `repeat` times, one research at a time so
 * one run's latency never includes another's. Modes alternate per brief, so
 * a slow minute on the provider hits both modes alike. A research that throws
 * is recorded with its error, and the run goes on.
 */
export async function runResearchAb(
  research: ResearchFn,
  { modes, repeat, briefs = RESEARCH_AB_BRIEFS }: ResearchAbOptions,
  now: () => number = () => performance.now(),
): Promise<ResearchAbRecord[]> {
  const records: ResearchAbRecord[] = [];
  // One date for the whole run, so every mode and repeat sees the same prompt.
  const today = new Date().toISOString().slice(0, 10);
  for (let round = 1; round <= repeat; round++) {
    for (const brief of briefs) {
      for (const mode of modes) {
        let llmCalls = 0;
        let costUsd = 0;
        let searches = 0;
        const hooks: AgentHooks = {
          onUsage: (usage) => {
            llmCalls += 1;
            costUsd += usage.cost;
            searches += usage.webSearchRequests ?? 0;
          },
          onToolCall: () => {
            searches += 1;
          },
        };
        const started = now();
        let result: ResearchResult | undefined;
        let error: string | undefined;
        try {
          result = await research(
            mode,
            { prompt: brief.prompt, type: brief.type, today },
            hooks,
          );
        } catch (caught: unknown) {
          error = caught instanceof Error ? caught.message : String(caught);
        }
        records.push({
          briefId: brief.id,
          type: brief.type,
          mode,
          repeat: round,
          ms: Math.round(now() - started),
          llmCalls,
          costUsd,
          searches,
          sources: result?.sources.length ?? 0,
          findingsChars: result?.findings.length ?? 0,
          findings: result?.findings ?? '',
          ...(error !== undefined ? { error } : {}),
        });
      }
    }
  }
  return records;
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

const max = (values: number[]): number =>
  values.length === 0 ? 0 : Math.max(...values);

const mean = (values: number[]): number =>
  values.length === 0
    ? 0
    : Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

export interface ResearchAbSummary {
  mode: ResearchMode;
  runs: number;
  failed: number;
  medianMs: number;
  maxMs: number;
  meanFindingsChars: number;
  meanSources: number;
  meanSearches: number;
  meanLlmCalls: number;
  totalCostUsd: number;
}

/** Per-mode aggregates over the runs that succeeded (failures are counted). */
export function summariseResearchAb(
  records: readonly ResearchAbRecord[],
): ResearchAbSummary[] {
  const modes = [...new Set(records.map((r) => r.mode))];
  return modes.map((mode) => {
    const all = records.filter((r) => r.mode === mode);
    const ok = all.filter((r) => r.error === undefined);
    return {
      mode,
      runs: all.length,
      failed: all.length - ok.length,
      medianMs: median(ok.map((r) => r.ms)),
      maxMs: max(ok.map((r) => r.ms)),
      meanFindingsChars: mean(ok.map((r) => r.findingsChars)),
      meanSources: mean(ok.map((r) => r.sources)),
      meanSearches: mean(ok.map((r) => r.searches)),
      meanLlmCalls: mean(ok.map((r) => r.llmCalls)),
      totalCostUsd: all.reduce((sum, r) => sum + r.costUsd, 0),
    };
  });
}

/** The console report: one row per research, then one per mode. */
export function formatResearchAbReport(
  records: readonly ResearchAbRecord[],
): string {
  const rows = records.map((r) =>
    [
      r.briefId.padEnd(26),
      r.mode.padEnd(8),
      seconds(r.ms).padStart(7),
      String(r.llmCalls).padStart(4),
      String(r.searches).padStart(8),
      String(r.sources).padStart(7),
      String(r.findingsChars).padStart(8),
      r.error ? `FAILED: ${r.error}` : '',
    ]
      .join('  ')
      .trimEnd(),
  );
  const summaries = summariseResearchAb(records).map((s) =>
    [
      s.mode.padEnd(8),
      `runs ${s.runs} (failed ${s.failed})`,
      `median ${seconds(s.medianMs)}`,
      `max ${seconds(s.maxMs)}`,
      `findings ~${s.meanFindingsChars} chars`,
      `sources ~${s.meanSources}`,
      `searches ~${s.meanSearches}`,
      `LLM calls ~${s.meanLlmCalls}`,
      `cost $${s.totalCostUsd.toFixed(4)}`,
    ].join('  '),
  );
  return [
    [
      'brief'.padEnd(26),
      'mode'.padEnd(8),
      'time'.padStart(7),
      'llm'.padStart(4),
      'searches'.padStart(8),
      'sources'.padStart(7),
      'findings'.padStart(8),
    ].join('  '),
    ...rows,
    '',
    'By mode:',
    ...summaries,
  ].join('\n');
}

export interface ResearchAbCliOptions extends ResearchAbOptions {
  jsonPath?: string;
}

export const RESEARCH_AB_USAGE = [
  'Usage: bun run eval:research [options]',
  '',
  '  --modes <list>   comma-separated research modes: agent, snippets, native',
  '                   (default agent,snippets; native needs ANTHROPIC_API_KEY)',
  '  --repeat <n>     rounds over every brief (default 1)',
  '  --json <path>    also write every record, findings included, as JSON',
].join('\n');

/** Parses the script's flags, accepting both `--flag value` and `--flag=value`. */
export function parseResearchAbArgs(
  argv: readonly string[],
): ResearchAbCliOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--') continue;
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    if (!['--modes', '--repeat', '--json'].includes(flag)) {
      throw new Error(`Unknown argument: ${argv[i]}\n\n${RESEARCH_AB_USAGE}`);
    }
    const value = inline ?? argv[++i];
    if (value === undefined || value === '') {
      throw new Error(`${flag} needs a value\n\n${RESEARCH_AB_USAGE}`);
    }
    values.set(flag, value);
  }

  const modes = (values.get('--modes') ?? DEFAULT_RESEARCH_AB_MODES.join(','))
    .split(',')
    .map((mode) => mode.trim());
  for (const mode of modes) {
    if (!(RESEARCH_MODES as readonly string[]).includes(mode)) {
      throw new Error(
        `--modes takes ${RESEARCH_MODES.join(', ')}; got "${mode}"`,
      );
    }
  }
  const repeat = Number(values.get('--repeat') ?? 1);
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error('--repeat must be a whole number of at least 1');
  }
  const jsonPath = values.get('--json');
  return {
    modes: [...new Set(modes)] as ResearchMode[],
    repeat,
    ...(jsonPath ? { jsonPath } : {}),
  };
}
