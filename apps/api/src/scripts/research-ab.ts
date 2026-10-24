/**
 * Research A/B (performance plan M7.2). Run from `apps/api`:
 *
 *   bun run eval:research [--modes agent,snippets] [--repeat 1] [--json out.json]
 *
 * Researches each fixed brief (POST and DOCUMENT, research on) in every mode,
 * one at a time, through a real `AgentRunnerService` per mode: the same
 * OpenRouter and Tavily calls a run's RESEARCH step makes, at the efforts and
 * limits in `.env`, with only `RESEARCH_MODE` overridden. It needs no MongoDB,
 * Redis or worker, and writes nothing to them; it spends real OpenRouter and
 * Tavily credit. It prints latency, LLM calls, searches, sources and findings
 * size per run and per mode; `--json` keeps every findings text so the two
 * modes can be read side by side.
 */
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { writeFile } from 'node:fs/promises';
import { AgentRunnerService } from '../agent/agent-runner.service';
import type { ResearchMode } from '../agent/agent-runner.interface';
import { LLMService } from '../llm/llm.service';
import { LLMFactoryService } from '../llm/llmFactory.service';
import { ResponseParserService } from '../llm/parsers/responseParser.service';
import { OpenRouterStrategy } from '../llm/strategies';
import {
  formatResearchAbReport,
  parseResearchAbArgs,
  runResearchAb,
} from './research-ab/research-ab';

/**
 * `.env` as the worker reads it, with `RESEARCH_MODE` set to `mode`: a
 * ConfigService's own values win over process.env.
 */
const configFor = (mode: ResearchMode): ConfigService =>
  new ConfigService({ ...process.env, RESEARCH_MODE: mode });

async function run(): Promise<void> {
  const options = parseResearchAbArgs(process.argv.slice(2));
  const llm = new LLMService(
    new LLMFactoryService(new OpenRouterStrategy(new ConfigService())),
  );
  const parser = new ResponseParserService();
  const runners = new Map(
    options.modes.map((mode) => [
      mode,
      new AgentRunnerService(llm, parser, configFor(mode)),
    ]),
  );

  const records = await runResearchAb(
    (mode, input, hooks) => runners.get(mode)!.research(input, hooks),
    options,
  );
  console.log(formatResearchAbReport(records));
  if (options.jsonPath) {
    await writeFile(options.jsonPath, JSON.stringify(records, null, 2));
    console.log(
      `\nEvery record, findings included, written to ${options.jsonPath}`,
    );
  }
}

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(
      '[eval:research]',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  });
