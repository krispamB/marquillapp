# Artifact prompt token budget

How many input tokens the fixed parts of an artifact run cost: the system prompts, the Design System fragment, and the structured-output schemas and tools sent with them. The brief, research findings, and the previous version are excluded, because they vary per run.

Measured on 2026-10-31 against `claude-haiku-5-5` (production `GENERATION_MODEL` and `RESEARCH_MODEL`, `LLM_PROVIDER=anthropic`) with Anthropic's `count_tokens` endpoint. Each figure is the request's count minus a baseline request that holds only a one-word user message. Character counts are given for comparison.

Re-run after changing a prompt, a schema, or a Design System definition:

```bash
cd apps/api
bunx ts-node -r tsconfig-paths/register src/scripts/prompt-token-report.ts [model]
```

The script spends no credit, because token counting is free.

## System prompts

Source: `src/agent/prompts/artifact-generation.prompts.ts` and `research.prompts.ts`. An initial run also gets the `TITLE` block. A refinement does not, because `includeTitle` is false when `refine` is set.

| Prompt | Chars | Tokens |
| --- | ---: | ---: |
| POST, initial (with TITLE) | 1,920 | 683 |
| POST, refine | 1,639 | 589 |
| POLL, initial (with TITLE) | 1,971 | 709 |
| POLL, refine | 1,690 | 615 |
| DOCUMENT base, initial (with TITLE) | 4,256 | 1,570 |
| DOCUMENT base, refine | 3,975 | 1,476 |
| Research, `agent` mode | 1,127 | 371 |
| Research, `native` mode | 936 | 304 |
| Research, `snippets` query plan | 531 | 182 |

The `TITLE` block costs 94 tokens.

## DOCUMENT system message, per Design System

A DOCUMENT call's system message is the DOCUMENT base prompt plus the pinned Design System's fragment (`documentGenerationSystemPrompt`, `src/design-system/prompt-fragment.ts`). The fragment is rendered from the definition, so its size depends on which Design System the user picks.

| Design System | Fragment chars | Fragment tokens | Full system, initial | Full system, refine |
| --- | ---: | ---: | ---: | ---: |
| margin v1 | 3,753 | 1,410 | 2,980 | 2,886 |
| overprint v1 | 4,318 | 1,700 | 3,270 | 3,176 |
| schematic v1 | 4,533 | 1,749 | 3,319 | 3,225 |
| afterglow v1 | 4,707 | 1,817 | 3,387 | 3,293 |
| broadside v1 | 4,755 | 1,862 | 3,432 | 3,338 |
| colophon v1 | 4,912 | 1,924 | 3,494 | 3,400 |

The fragment makes up 47–55% of the DOCUMENT system message.

## Structured-output schemas and tools

Every generation call sends a JSON schema in `output_config.format`, and research sends tool definitions. Each costs input tokens on every call. Each schema figure includes the instructions the API adds whenever a structured-output format is set, so even a one-field schema costs about 180 tokens.

| Sent with | Tokens |
| --- | ---: |
| POST schema (with title / without) | 210 / 188 |
| POLL schema (with title / without) | 397 / 375 |
| DOCUMENT draft schema (with title / without) | 232 / 210 |
| DOCUMENT full Repair schema (`{ html }`) | 184 |
| DOCUMENT patch Repair schema (`{ edits, html }`) | 281 |
| Snippet query-plan schema | 213 |
| `searchWeb` tool (`agent` research) | 428 |
| `web_search` server tool (`native` research) | 2,816 |

The POLL schema is about twice the POST schema because it carries the option-count, length, and `durationDays` constraints.

## Fixed prefix per model call

System prompt plus schema or tools: the part of each request that is the same for every user.

| Call | Fixed input tokens |
| --- | ---: |
| POST generate, initial / refine | 893 / 777 |
| POLL generate, initial / refine | 1,106 / 990 |
| DOCUMENT draft, initial | 3,212 (margin) to 3,726 (colophon) |
| DOCUMENT full Repair | system + 184: about 3,070 to 3,680 |
| DOCUMENT patch Repair | system + 281: about 3,170 to 3,780 |
| Research `agent`, each tool turn | 799 |
| Research `agent`, final tools-free turn | 371 |
| Research `native`, one call | 3,120 |
| Research `snippets`, query plan | 395 |

### Repeats within one run

The fixed prefix is sent again on every call, so some runs pay it more than once:

- **POST and POLL** make one generate call. When the draft fails Zod validation, they make one repair call that re-sends the system prompt and schema along with the draft.
- **DOCUMENT** re-sends the same system message, byte for byte, on every Repair (`repairSystemMessage`). `DOCUMENT_REPAIR_BUDGET` is 2, and a patch Repair whose edits do not apply adds a fallback call, so a run that uses its whole budget sends the 3–3.7K-token prefix 3–5 times: about 9–19K tokens of fixed input. An envelope repair turn adds one more.
- **`agent` research** re-sends its system prompt and the `searchWeb` tool on each turn, up to `RESEARCH_MAX_STEPS` (5), plus a final tools-free turn if the cap is reached. The worst case is 5 × 799 + 371 = 4,366 fixed tokens, and the conversation grows with search results on top of that.
- **`native` research** has the largest single fixed block, because the `web_search` tool definition alone costs 2,816 tokens. Each `pause_turn` continuation sends it again.

## What this costs

At Haiku 5.5's $0.10 per million input tokens (`src/llm/anthropic-pricing.ts`), the fixed prefix is small in dollars. A POST generate call's prefix costs about $0.00009. A DOCUMENT draft's costs about $0.00035. A DOCUMENT run that uses its whole Repair budget spends under $0.002 on prefixes. The larger costs come from the variable parts: research findings, the Candidate Source re-sent on each Repair, and output tokens.

The fixed size still matters for latency on long DOCUMENT prompts, and it matters more if a pricier model replaces Haiku.

## Observations

1. **DOCUMENT is the heaviest artifact type.** Its system message is 4–5 times the size of POST's or POLL's. The base prompt (1,570 tokens) and the Design System fragment (1,410–1,924) are roughly equal parts.
2. **The choice of Design System changes the cost by up to 514 tokens per call.** Colophon is the largest and margin the smallest.
3. **Nothing is prompt-cached unless `ANTHROPIC_PROMPT_CACHE` is on.** It is off by default (see "Prompt caching" in `docs/anthropic-provider-design.md`). The system prompts are static (`TODAY` is in the user message), and a DOCUMENT system message is byte-identical across a draft and its Repairs and across all runs that use the same Design System. Every prefix measured here is above the 512-token minimum cacheable length that the model documentation lists for Haiku 5.5; check the current prompt-caching docs before relying on that number. Cache reads are priced at $0.01 per million tokens against $0.10 for uncached input, and caching adds a write premium, so the main benefit would be lower latency on DOCUMENT Repairs rather than lower cost.
4. **Structured outputs cost about 180 tokens per call before any field.** This is part of the price of schema-checked answers, and it applies to every call.
5. **`native` research's tool definition outweighs everything else in that call.** The `web_search` tool costs 2,816 tokens, compared with 304 for the system prompt. The `agent` mode's prefix is smaller per turn (799) but repeats on each turn.

These counts are specific to the Claude tokenizer. A run through OpenRouter on another model family will count differently. Re-run the script with that model's id to get its figures if it is a Claude model, or use that provider's own token counter if it is not.
