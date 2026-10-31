/**
 * Measures the fixed, per-call prompt overhead of artifact generation: every
 * system prompt, the Design System fragment a DOCUMENT call carries, and the
 * structured-output schema or tool definitions sent beside them. Counts come
 * from Anthropic's `count_tokens` endpoint, so they are exact for the model
 * named, and each figure is the difference against a one-word baseline call.
 *
 *   bunx ts-node -r tsconfig-paths/register src/scripts/prompt-token-report.ts [model]
 *
 * Needs ANTHROPIC_API_KEY in .env (ANTHROPIC_BASE_URL and ANTHROPIC_VERSION
 * are honoured). Counting is free; nothing is generated.
 * Results: docs/artifact-prompt-token-budget.md.
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ArtifactType } from 'src/database/schemas';
import {
  documentDraftSchemaFor,
  documentPatchRepairSchema,
  documentRepairSchema,
  generationSchemaFor,
} from 'src/artifact/schemas/artifact-content.schema';
import {
  documentGenerationSystemPrompt,
  generationSystemPrompt,
  nativeResearchSystemPrompt,
  researchSystemPrompt,
  snippetQueriesSystemPrompt,
} from 'src/agent/prompts';
import { snippetQueriesSchema } from 'src/agent/research-snippets';
import { createSearchWebTool } from 'src/agent/tools/search-web.tool';
import { parseDesignSystemDefinition } from 'src/design-system/design-system-definition';
import { renderPromptFragment } from 'src/design-system/prompt-fragment';
import { webSearchToolType } from 'src/llm/anthropic-model';
import { toAnthropicJsonSchema } from 'src/llm/strategies/anthropic.strategy';

const model = process.argv[2] ?? 'claude-haiku-5-5';
const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
const version = process.env.ANTHROPIC_VERSION || '2026-10-21';
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

type Body = Record<string, unknown>;

async function count(body: Body): Promise<number> {
  const response = await fetch(`${baseUrl}/v1/messages/count_tokens`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey!,
      'anthropic-version': version,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'x' }],
      ...body,
    }),
  });
  const json = (await response.json()) as { input_tokens?: number };
  if (!response.ok || json.input_tokens === undefined) {
    throw new Error(`count_tokens ${response.status}: ${JSON.stringify(json)}`);
  }
  return json.input_tokens;
}

const format = (schema: z.ZodType) => ({
  output_config: {
    format: {
      type: 'json_schema',
      schema: toAnthropicJsonSchema(z.toJSONSchema(schema, { io: 'output' })),
    },
  },
});

// The key is never used: building the tool makes no request.
const searchWeb = createSearchWebTool('unused');
const searchWebTool = {
  name: searchWeb.name,
  description: searchWeb.description,
  input_schema: (() => {
    const schema = z.toJSONSchema(searchWeb.parameters, { io: 'input' });
    delete schema.$schema;
    return schema;
  })(),
};

async function main() {
  const baseline = await count({});
  const delta = async (body: Body) => (await count(body)) - baseline;
  const rows: string[] = [];
  const row = (...cells: (string | number)[]) =>
    rows.push(`| ${cells.join(' | ')} |`);

  console.log(`model ${model}, baseline ${baseline} tokens\n`);

  rows.push(
    '## System prompts',
    '',
    '| Prompt | chars | tokens |',
    '| --- | ---: | ---: |',
  );
  const prompts: [string, string][] = [
    [
      'POST (initial, with TITLE)',
      generationSystemPrompt(ArtifactType.POST, true),
    ],
    [
      'POST (refine, no TITLE)',
      generationSystemPrompt(ArtifactType.POST, false),
    ],
    [
      'POLL (initial, with TITLE)',
      generationSystemPrompt(ArtifactType.POLL, true),
    ],
    [
      'POLL (refine, no TITLE)',
      generationSystemPrompt(ArtifactType.POLL, false),
    ],
    [
      'DOCUMENT base (initial, with TITLE)',
      generationSystemPrompt(ArtifactType.DOCUMENT, true),
    ],
    [
      'DOCUMENT base (refine, no TITLE)',
      generationSystemPrompt(ArtifactType.DOCUMENT, false),
    ],
    ['Research: agent', researchSystemPrompt()],
    ['Research: native', nativeResearchSystemPrompt()],
    ['Research: snippet query plan', snippetQueriesSystemPrompt()],
  ];
  for (const [name, system] of prompts) {
    row(name, system.length, await delta({ system }));
  }

  rows.push(
    '',
    '## DOCUMENT system message per Design System',
    '',
    '| Design System | fragment chars | fragment tokens | full system, with TITLE | full system, no TITLE |',
    '| --- | ---: | ---: | ---: | ---: |',
  );
  const root = join(process.cwd(), 'assets/design-systems');
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const yaml = readFileSync(
      join(root, dir.name, 'definition.ds.yaml'),
      'utf8',
    );
    const parsed = parseDesignSystemDefinition(yaml);
    if (!parsed.success)
      throw new Error(`${dir.name}: ${parsed.errors.join('; ')}`);
    const fragment = renderPromptFragment(parsed.definition);
    row(
      `${parsed.definition.id} v${parsed.definition.version}`,
      fragment.length,
      await delta({ system: fragment }),
      await delta({ system: documentGenerationSystemPrompt(fragment, true) }),
      await delta({ system: documentGenerationSystemPrompt(fragment, false) }),
    );
  }

  rows.push(
    '',
    '## Structured-output schemas and tools',
    '',
    '| Sent with | tokens |',
    '| --- | ---: |',
  );
  const extras: [string, Body][] = [
    [
      'POST schema (with title)',
      format(generationSchemaFor(ArtifactType.POST, true)),
    ],
    [
      'POST schema (no title)',
      format(generationSchemaFor(ArtifactType.POST, false)),
    ],
    [
      'POLL schema (with title)',
      format(generationSchemaFor(ArtifactType.POLL, true)),
    ],
    [
      'POLL schema (no title)',
      format(generationSchemaFor(ArtifactType.POLL, false)),
    ],
    [
      'DOCUMENT draft schema (with title)',
      format(documentDraftSchemaFor(true)),
    ],
    ['DOCUMENT draft schema (no title)', format(documentDraftSchemaFor(false))],
    ['DOCUMENT full Repair schema', format(documentRepairSchema)],
    ['DOCUMENT patch Repair schema', format(documentPatchRepairSchema)],
    ['Snippet query-plan schema', format(snippetQueriesSchema)],
    ['searchWeb tool (agent research)', { tools: [searchWebTool] }],
    [
      'web_search server tool (native research)',
      {
        tools: [
          { type: webSearchToolType(model), name: 'web_search', max_uses: 5 },
        ],
      },
    ],
  ];
  for (const [name, body] of extras) {
    try {
      row(name, await delta(body));
    } catch (error) {
      row(name, `error: ${(error as Error).message.slice(0, 120)}`);
    }
  }

  console.log(rows.join('\n'));
}

void main();
