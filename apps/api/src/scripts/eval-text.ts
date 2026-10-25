/**
 * Text eval for POST and POLL generation (issue #239, plan M7.4). Run from
 * `apps/api`:
 *
 *   bun run eval:text --models openai/gpt-6-luna-pro,<candidate> [--types POST,POLL]
 *     [--briefs 5] [--concurrency 2] [--effort low] [--json out.json] [--md out.md]
 *
 * It gives every fixed brief (5 POST, 5 POLL) to every model through the real
 * `AgentRunnerService.generate`, repair turn included, and prints latency
 * (p50, p90) and tokens per model and type. `--md` writes the outputs side by
 * side for a person to read. The first model is the baseline; with no
 * `--models` (and no `TEXT_EVAL_MODELS`) it runs `GENERATION_MODEL` alone.
 *
 * It calls OpenRouter for real, so it spends money, and it needs only
 * `OPENROUTER_API_KEY` and `GENERATION_MODEL`: no MongoDB, Redis or worker.
 * It writes nothing but the files named by `--json` and `--md`. See
 * docs/text-eval-runbook.md.
 */
import 'dotenv/config';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { writeFile } from 'node:fs/promises';
import { LlmModule } from '../llm/llm.module';
import { LLMService } from '../llm/llm.service';
import { ResponseParserService } from '../llm/parsers/responseParser.service';
import {
  createTextEvalDeps,
  formatTextEvalMarkdown,
  formatTextEvalReport,
  parseTextEvalArgs,
  runTextEval,
} from './eval-text/index';

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), LlmModule] })
class TextEvalModule {}

async function run(): Promise<boolean> {
  const options = parseTextEvalArgs(process.argv.slice(2), process.env);
  const app = await NestFactory.createApplicationContext(TextEvalModule, {
    logger: ['error', 'warn'],
  });
  try {
    const config = app.get(ConfigService);
    const models = options.models.length
      ? options.models
      : [config.getOrThrow<string>('GENERATION_MODEL')];
    const result = await runTextEval(
      createTextEvalDeps(
        app.get(LLMService),
        app.get(ResponseParserService),
        config,
      ),
      { ...options, models },
    );
    console.log(formatTextEvalReport(result));
    if (options.jsonPath) {
      await writeFile(options.jsonPath, JSON.stringify(result, null, 2));
      console.log(`\nFull result written to ${options.jsonPath}`);
    }
    if (options.markdownPath) {
      await writeFile(options.markdownPath, formatTextEvalMarkdown(result));
      console.log(`Side-by-side report written to ${options.markdownPath}`);
    }
    return result.records.every((record) => record.ok);
  } finally {
    await app.close();
  }
}

run()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((error: unknown) => {
    console.error(
      '[eval:text]',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  });
