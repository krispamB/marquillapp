import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArtifactType } from 'src/database/schemas';
import type { ZodType } from 'zod';
import { ArtifactContent, generationSchemaFor } from '../artifact/schemas';
import { LLMProvider, MessageRole } from '../llm/interfaces';
import type {
  LLMMessage,
  ToolCall,
  ToolDefinition,
  Usage,
} from '../llm/interfaces';
import { LLMService } from '../llm/llm.service';
import { ResponseParserService } from '../llm/parsers/responseParser.service';
import { ContentValidationError } from './agent-runner.error';
import type {
  AgentHooks,
  ArtifactGenerationResult,
  AgentRunConfig,
  AgentRunResult,
  AgentRunner,
  AgentStep,
  GenerateInput,
  ResearchInput,
  ResearchResult,
  ResearchSource,
  Tool,
} from './agent-runner.interface';
import {
  buildGenerationUserPrompt,
  buildRepairUserPrompt,
  generationSystemPrompt,
  researchSystemPrompt,
  researchUserPrompt,
} from './prompts';
import {
  createSearchWebTool,
  type SearchWebOutput,
  type WebSearchResult,
} from './tools';

const DEFAULT_RESEARCH_MAX_STEPS = 5;
const DEFAULT_RESEARCH_MAX_SUCCESSFUL_SEARCHES = 5;
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const emptyUsage = (): Usage => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cost: 0,
});

// The loop accumulates one running total across every turn, including the repair
// and cap-finalization turns, so the caller sees the true cost of the whole run.
const addUsage = (into: Usage, turn: Usage): void => {
  into.promptTokens += turn.promptTokens;
  into.completionTokens += turn.completionTokens;
  into.totalTokens += turn.totalTokens;
  into.cost += turn.cost;
};

const hasResults = (
  output: unknown,
): output is { results: WebSearchResult[] } =>
  typeof output === 'object' &&
  output !== null &&
  Array.isArray((output as { results?: unknown }).results);

// A tool that failed reports `{ error }` rather than throwing (the never-throw
// contract). Such a call did no useful work, so it is not billed.
const isToolError = (output: unknown): boolean =>
  typeof output === 'object' && output !== null && 'error' in output;

const toToolDefinition = (tool: Tool): ToolDefinition => ({
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters,
});

/**
 * Layer 2 of the agent stack: provider-agnostic, and the only place that knows
 * which prompt an artifact type takes.
 *
 * It never touches the meter. Usage leaves through `hooks.onUsage`, which the
 * `GENERATE` and `RESEARCH` steps bridge to `ctx.meter.record`.
 */
@Injectable()
export class AgentRunnerService implements AgentRunner {
  private readonly logger = new Logger(AgentRunnerService.name);
  private readonly generationModel: string;
  private readonly researchModel: string;
  private readonly researchMaxSteps: number;
  private readonly researchMaxSuccessfulSearches: number;
  private readonly researchMaxOutputTokens: number;
  private readonly generationMaxOutputTokens: number;
  private readonly searchWebTool: Tool;

  constructor(
    private readonly llmService: LLMService,
    private readonly parser: ResponseParserService,
    private readonly configService: ConfigService,
  ) {
    this.generationModel =
      this.configService.getOrThrow<string>('GENERATION_MODEL');
    this.researchModel =
      this.configService.getOrThrow<string>('RESEARCH_MODEL');
    this.researchMaxSteps = this.readMaxSteps();
    this.researchMaxSuccessfulSearches = Math.min(
      this.readPositiveInteger(
        'RESEARCH_MAX_SUCCESSFUL_SEARCHES',
        DEFAULT_RESEARCH_MAX_SUCCESSFUL_SEARCHES,
      ),
      DEFAULT_RESEARCH_MAX_SUCCESSFUL_SEARCHES,
    );
    this.researchMaxOutputTokens = this.readPositiveInteger(
      'RESEARCH_MAX_OUTPUT_TOKENS',
      DEFAULT_MAX_OUTPUT_TOKENS,
    );
    this.generationMaxOutputTokens = this.readPositiveInteger(
      'GENERATION_MAX_OUTPUT_TOKENS',
      DEFAULT_MAX_OUTPUT_TOKENS,
    );
    this.searchWebTool = createSearchWebTool(
      this.configService.getOrThrow<string>('TAVILY_API_KEY'),
    );
  }

  /**
   * The agentic half. One tool (`searchWeb`), fully autonomous: the model
   * self-directs its queries across turns and, when done, answers in prose.
   *
   * `findings` is that final synthesis — not a dump of raw search bodies —
   * keeping the generation prompt tight. `sources` is deduped across every
   * search the loop made. The whole result is persisted on the run record so a
   * later refine reuses it with zero re-search.
   */
  async research(
    input: ResearchInput,
    hooks?: AgentHooks,
  ): Promise<ResearchResult> {
    const result = await this.run(
      {
        system: researchSystemPrompt(),
        messages: [
          { role: MessageRole.User, content: researchUserPrompt(input) },
        ],
        tools: [this.searchWebTool],
        maxSteps: this.researchMaxSteps,
        maxSuccessfulToolCalls: this.researchMaxSuccessfulSearches,
        model: this.researchModel,
      },
      hooks,
    );

    return {
      findings: result.text,
      sources: this.collectSources(result.steps),
    };
  }

  /**
   * The from-scratch, provider-agnostic tool loop.
   *
   * Append the seed → `completeWithTools` → if no tool calls, return the text;
   * else run the called tools **in parallel** (`Promise.all`), append their
   * outputs as `role: 'tool'` messages, and repeat.
   *
   * **Cap — graceful finalization.** At `maxSteps` with the model still wanting
   * tools, make one final completion with the tools removed ("budget spent,
   * answer now"). This guarantees usable text instead of a dangling tool call
   * and bounds worst-case spend at `maxSteps + 1` LLM calls; a hard throw would
   * turn a thorough run into a failure the engine only retries into the same cap.
   */
  async run(
    config: AgentRunConfig,
    hooks?: AgentHooks,
  ): Promise<AgentRunResult> {
    const { system, messages, tools, maxSteps, maxSuccessfulToolCalls, model } =
      config;
    // A label for the usage tag; the request itself passes `model` through as-is,
    // letting the strategy fall back to its default when it is undefined.
    const usageModel = model ?? 'default';
    const toolDefinitions = tools.map(toToolDefinition);

    const conversation: LLMMessage[] = [
      { role: MessageRole.System, content: system },
      ...messages,
    ];
    const steps: AgentStep[] = [];
    const usage = emptyUsage();
    let successfulToolCalls = 0;

    for (let step = 0; step < maxSteps; step++) {
      const turn = await this.llmService.completeWithTools(
        LLMProvider.OPENROUTER,
        conversation,
        toolDefinitions,
        { model, max_tokens: this.researchMaxOutputTokens },
      );
      addUsage(usage, turn.usage);
      hooks?.onUsage?.({ ...turn.usage, model: usageModel });

      if (turn.toolCalls.length === 0) {
        return { text: turn.text ?? '', steps, usage };
      }

      conversation.push({
        role: MessageRole.Assistant,
        content: turn.text,
        toolCalls: turn.toolCalls,
      });

      const toolResults: unknown[] = [];
      if (maxSuccessfulToolCalls === undefined) {
        toolResults.push(
          ...(await Promise.all(
            turn.toolCalls.map((call) => this.executeTool(tools, call, hooks)),
          )),
        );
      } else {
        // Execute bounded parallel waves. A wave can contain at most the
        // remaining success budget, so it cannot race beyond the cap. Failures
        // leave vacancies that the next wave fills from later calls.
        const pending = [...turn.toolCalls];
        while (
          pending.length > 0 &&
          successfulToolCalls < maxSuccessfulToolCalls
        ) {
          const available = maxSuccessfulToolCalls - successfulToolCalls;
          const batch = pending.splice(0, available);
          const batchResults = await Promise.all(
            batch.map((call) => this.executeTool(tools, call, hooks)),
          );
          toolResults.push(...batchResults);
          successfulToolCalls += batchResults.filter(
            (output) => !isToolError(output),
          ).length;
        }
        toolResults.push(
          ...pending.map(() => ({
            error: `Successful tool-call limit of ${maxSuccessfulToolCalls} reached`,
          })),
        );
      }

      turn.toolCalls.forEach((call, i) => {
        conversation.push({
          role: MessageRole.Tool,
          content: JSON.stringify(toolResults[i]),
          toolCallId: call.id,
        });
      });

      steps.push({ toolCalls: turn.toolCalls, toolResults, usage: turn.usage });
    }

    // Budget spent, model still reaching for tools: one tools-free completion so
    // the run yields usable text rather than a stranded tool call.
    const final = await this.llmService.complete(
      LLMProvider.OPENROUTER,
      conversation,
      { model, max_tokens: this.researchMaxOutputTokens },
    );
    addUsage(usage, final.usage);
    hooks?.onUsage?.({ ...final.usage, model: usageModel });

    return { text: final.text, steps, usage };
  }

  /**
   * Generation is not a loop: every input is already in hand, so this is one
   * `complete` call with no tools, plus at most one repair.
   *
   * The repair re-prompts with the exact validation error. A failure that
   * survives it is a `ContentValidationError` — terminal, per R2.
   */
  async generate(
    input: GenerateInput,
    hooks?: AgentHooks,
  ): Promise<ArtifactGenerationResult> {
    const includeTitle = input.refine === undefined;
    const schema = generationSchemaFor(input.type, includeTitle);
    const messages: LLMMessage[] = [
      {
        role: MessageRole.System,
        content: generationSystemPrompt(input.type, includeTitle),
      },
      { role: MessageRole.User, content: buildGenerationUserPrompt(input) },
    ];

    const draft = await this.complete(messages, hooks, schema);

    let validationError: unknown;
    try {
      return this.toGenerationResult(
        this.parser.parseWithSchema(draft, schema, {
          stripNullObjectValues: true,
        }),
        input,
        includeTitle,
      );
    } catch (error: unknown) {
      validationError = error;
    }

    this.logger.warn(
      `Generated ${input.type} first draft failed validation; attempting one repair: ${describeError(validationError)}`,
    );

    const repaired = await this.complete(
      [
        ...messages,
        { role: MessageRole.Assistant, content: draft },
        {
          role: MessageRole.User,
          content: buildRepairUserPrompt(describeError(validationError)),
        },
      ],
      hooks,
      schema,
    );

    try {
      return this.toGenerationResult(
        this.parser.parseWithSchema(repaired, schema, {
          stripNullObjectValues: true,
        }),
        input,
        includeTitle,
      );
    } catch (error: unknown) {
      throw new ContentValidationError(
        `Generated ${input.type} content failed validation after one repair retry: ${describeError(error)}`,
        { cause: error },
      );
    }
  }

  private toGenerationResult(
    parsed: ArtifactContent & { title?: string },
    input: GenerateInput,
    includeTitle: boolean,
  ): ArtifactGenerationResult {
    const { title, ...content } = parsed;
    return {
      ...(includeTitle && title !== undefined ? { title } : {}),
      content: this.stampTheme(content as ArtifactContent, input),
    };
  }

  /**
   * A user-supplied `theme` is authoritative: it overrides whatever templateId
   * the model chose, so a document keeps the user's chosen look across the
   * initial run and every later refine (R4). Applied after validation, so it is
   * a stamp over already-valid content — not a chance to sneak a bad theme past
   * Zod. With no theme, the model's own validated pick stands.
   */
  private stampTheme(
    content: ArtifactContent,
    input: GenerateInput,
  ): ArtifactContent {
    if (
      input.type !== ArtifactType.DOCUMENT ||
      !input.theme ||
      !('document' in content)
    ) {
      return content;
    }
    return {
      ...content,
      document: { ...content.document, templateId: input.theme },
    };
  }

  /**
   * Runs one called tool. Errors are **absorbed**, not thrown: a Tavily outage or
   * malformed model arguments come back as `{ error }` so the loop keeps going and
   * the model adapts, rather than failing the whole run on a transient fault.
   *
   * `onToolCall` fires **only for a call that actually produced a result** — the
   * step bridges it to the `web_search` surcharge, so an absorbed outage or an
   * unknown tool (both `{ error }`) must not bill the user for a search that
   * returned nothing.
   */
  private async executeTool(
    tools: Tool[],
    call: ToolCall,
    hooks?: AgentHooks,
  ): Promise<unknown> {
    const tool = tools.find((t) => t.name === call.name);
    if (!tool) {
      return { error: `Unknown tool "${call.name}"` };
    }

    try {
      const input = tool.parameters.parse(call.input);
      const output = await tool.execute(input);
      if (!isToolError(output)) hooks?.onToolCall?.({ name: call.name });
      return output;
    } catch (error: unknown) {
      return { error: describeError(error) };
    }
  }

  /**
   * `findings` deliberately drops the raw search bodies, so `sources` is the only
   * place the searched URLs survive. Deduped by URL across every turn, keeping the
   * first title seen for each.
   */
  private collectSources(steps: AgentStep[]): ResearchSource[] {
    const byUrl = new Map<string, ResearchSource>();

    for (const step of steps) {
      for (const output of step.toolResults as SearchWebOutput[]) {
        if (!hasResults(output)) continue;
        for (const result of output.results) {
          if (!byUrl.has(result.url)) {
            byUrl.set(result.url, { title: result.title, url: result.url });
          }
        }
      }
    }

    return [...byUrl.values()];
  }

  /**
   * A repair turn is real spend, so it is announced like any other. Transport
   * errors are left alone: `src/llm` already classified them as retryable or
   * not, and this layer would only be guessing.
   */
  private async complete(
    messages: LLMMessage[],
    hooks?: AgentHooks,
    responseSchema?: ZodType,
  ): Promise<string> {
    const { text, usage } = await this.llmService.complete(
      LLMProvider.OPENROUTER,
      messages,
      {
        model: this.generationModel,
        max_tokens: this.generationMaxOutputTokens,
        ...(responseSchema
          ? {
              responseSchema: {
                name: 'artifact_generation',
                schema: responseSchema,
              },
            }
          : {}),
      },
    );

    hooks?.onUsage?.({ ...usage, model: this.generationModel });

    return text;
  }

  private readMaxSteps(): number {
    return this.readPositiveInteger(
      'RESEARCH_MAX_STEPS',
      DEFAULT_RESEARCH_MAX_STEPS,
    );
  }

  private readPositiveInteger(key: string, fallback: number): number {
    const raw = this.configService.get<string | number>(key);
    if (raw === undefined || raw === null || raw === '') {
      return fallback;
    }
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
