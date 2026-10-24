import { ConfigService } from '@nestjs/config';
import { AgentRunnerService } from '../../agent/agent-runner.service';
import type { LLMService } from '../../llm/llm.service';
import type { ResponseParserService } from '../../llm/parsers/responseParser.service';
import type { ReasoningEffort } from '../../llm/interfaces';
import type { TextEvalDeps } from './eval-text-runner';

/** Keys the eval never reads a real value for, so a missing one must not stop it. */
const UNUSED_KEYS: Record<string, string> = {
  TAVILY_API_KEY: 'unused-by-text-eval',
};

/**
 * A config that answers like `base` except that every generation model key is
 * `model` (so POST and POLL both resolve to it), and the effort is `effort`
 * when given. The runner under test is the real `AgentRunnerService`.
 */
export function evalConfig(
  base: Pick<ConfigService, 'get'>,
  model: string,
  effort?: ReasoningEffort,
): ConfigService {
  const overrides: Record<string, string | undefined> = {
    GENERATION_MODEL: model,
    POST_GENERATION_MODEL: model,
    POLL_GENERATION_MODEL: model,
    RESEARCH_MODEL: model,
    ...(effort ? { GENERATION_REASONING_EFFORT: effort } : {}),
  };
  const get = (key: string): unknown =>
    key in overrides ? overrides[key] : (base.get(key) ?? UNUSED_KEYS[key]);
  return {
    get,
    getOrThrow: (key: string) => {
      const value = get(key);
      if (value === undefined || value === '') {
        throw new Error(`Configuration key "${key}" does not exist`);
      }
      return value;
    },
  } as unknown as ConfigService;
}

/** Real `generate` calls (and real spend), one runner per (model, effort). */
export function createTextEvalDeps(
  llm: LLMService,
  parser: ResponseParserService,
  config: Pick<ConfigService, 'get'>,
): TextEvalDeps {
  const runners = new Map<string, AgentRunnerService>();
  return {
    generate: (model, input, hooks, effort) => {
      const key = `${model}\u0000${effort ?? ''}`;
      let runner = runners.get(key);
      if (!runner) {
        runner = new AgentRunnerService(
          llm,
          parser,
          evalConfig(config, model, effort),
        );
        runners.set(key, runner);
      }
      return runner.generate(input, hooks);
    },
  };
}
