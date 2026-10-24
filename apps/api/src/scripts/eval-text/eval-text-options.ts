import { ArtifactType } from 'src/database/schemas';
import type { TextEvalType } from './briefs';
import { REASONING_EFFORTS, type ReasoningEffort } from '../../llm/interfaces';

export const DEFAULT_TEXT_CONCURRENCY = 2;

export interface TextEvalCliOptions {
  /** Models to compare, as OpenRouter slugs; the first is the baseline. Empty means GENERATION_MODEL. */
  models: string[];
  types: TextEvalType[];
  /** Briefs per type (the first n of each); undefined means all. */
  briefsPerType?: number;
  concurrency: number;
  /** Reasoning effort for every call, overriding GENERATION_REASONING_EFFORT. */
  effort?: ReasoningEffort;
  jsonPath?: string;
  markdownPath?: string;
}

export const TEXT_EVAL_USAGE = [
  'Usage: bun run eval:text [options]',
  '',
  '  --models <a,b,c>    OpenRouter models to compare, comma separated; the first is the',
  '                      baseline (default: $TEXT_EVAL_MODELS, else GENERATION_MODEL)',
  '  --types <POST,POLL> artifact types to run (default both)',
  '  --briefs <n>        briefs per type, the first n (default all 5)',
  '  --concurrency <n>   calls in flight at once (default 2)',
  '  --effort <level>    reasoning effort for every call (default GENERATION_REASONING_EFFORT)',
  '  --json <path>       write the full result as JSON',
  '  --md <path>         write the side-by-side report as Markdown',
].join('\n');

const FLAGS = [
  '--models',
  '--types',
  '--briefs',
  '--concurrency',
  '--effort',
  '--json',
  '--md',
];

const splitList = (value: string): string[] => [
  ...new Set(
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  ),
];

/** Parses the flags, accepting `--flag value` and `--flag=value`. `env` supplies `TEXT_EVAL_MODELS`. */
export function parseTextEvalArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
): TextEvalCliOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--') continue;
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    if (!FLAGS.includes(flag)) {
      throw new Error(`Unknown argument: ${argv[i]}\n\n${TEXT_EVAL_USAGE}`);
    }
    const value = inline ?? argv[++i];
    if (value === undefined || value === '') {
      throw new Error(`${flag} needs a value\n\n${TEXT_EVAL_USAGE}`);
    }
    values.set(flag, value);
  }

  const types = values.has('--types')
    ? splitList(values.get('--types')!).map((raw) => {
        const type = raw.toUpperCase();
        if (type === 'POST') return ArtifactType.POST;
        if (type === 'POLL') return ArtifactType.POLL;
        throw new Error(`--types takes POST and/or POLL; got "${raw}"`);
      })
    : [ArtifactType.POST, ArtifactType.POLL];

  const concurrency = Number(
    values.get('--concurrency') ?? DEFAULT_TEXT_CONCURRENCY,
  );
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('--concurrency must be a whole number of at least 1');
  }

  let briefsPerType: number | undefined;
  if (values.has('--briefs')) {
    briefsPerType = Number(values.get('--briefs'));
    if (!Number.isInteger(briefsPerType) || briefsPerType < 1) {
      throw new Error('--briefs must be a whole number of at least 1');
    }
  }

  let effort: ReasoningEffort | undefined;
  if (values.has('--effort')) {
    const raw = values.get('--effort')!;
    if (!(REASONING_EFFORTS as readonly string[]).includes(raw)) {
      throw new Error(
        `--effort must be one of ${REASONING_EFFORTS.join(', ')}; got "${raw}"`,
      );
    }
    effort = raw as ReasoningEffort;
  }

  return {
    models: splitList(values.get('--models') ?? env.TEXT_EVAL_MODELS ?? ''),
    types: [...new Set(types)] as TextEvalType[],
    briefsPerType,
    concurrency,
    effort,
    jsonPath: values.get('--json'),
    markdownPath: values.get('--md'),
  };
}
