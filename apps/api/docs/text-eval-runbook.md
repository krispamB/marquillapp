# Text eval — runbook

How to run `bun run eval:text` to compare models for POST and POLL generation, and how to record the choice.
Issue: [#239](https://github.com/krispamB/marquillapp/issues/239); plan item M7.4 in
[artifact-generation-performance-plan.md](artifact-generation-performance-plan.md). It is modelled on the
[document eval](document-eval-runbook.md), but it is much lighter: it calls the model directly, so it needs no
worker, MongoDB, Redis or Browserless.

The script is agent-written and the run is human work: it spends real OpenRouter budget, and a person reads the
outputs, because writing quality is the product.

## What it does

It gives every fixed brief to every model through the real `AgentRunnerService.generate` (the same prompt, schema,
Zod validation and one repair turn the worker uses), with research off:

| Briefs | What |
|---|---|
| 5 POST | a decision-record post, a story, a how-to, an announcement and a hot take, with and without a style preset |
| 5 POLL | one-line asks, some with a style preset |

The briefs are fixtures in `src/scripts/eval-text/briefs.ts`. Every model gets the same ten.

Each call records wall time (the repair turn included), the number of model calls (2 means the first draft failed
validation and was repaired), and tokens and cost summed over its calls. The console report shows, per model and type:
runs, failures, repaired runs, latency p50 and p90, mean prompt, completion, reasoning and total tokens, and mean cost.
Latency, tokens and cost are over successful runs only; read the `failed` column beside them.

## Prerequisites

`apps/api/.env` with `OPENROUTER_API_KEY` and `GENERATION_MODEL`. Nothing else is read (`TAVILY_API_KEY` and
`RESEARCH_MODEL` are not needed). `GENERATION_REASONING_EFFORT`, `GENERATION_MAX_OUTPUT_TOKENS` and the
`OPENROUTER_*` retry keys apply as they do in the worker, so the numbers match production settings.

## Running it

From `apps/api`:

```bash
bun run eval:text \
  --models "$GENERATION_MODEL_IN_PRODUCTION,<candidate-1>,<candidate-2>" \
  --json eval-text.json --md eval-text.md
```

The first model is the baseline; put today's `GENERATION_MODEL` first. With no `--models` (and no
`TEXT_EVAL_MODELS` in the environment) it runs `GENERATION_MODEL` alone, which gives a baseline.

| Flag | Meaning |
|---|---|
| `--models a,b,c` | OpenRouter slugs to compare, or the `TEXT_EVAL_MODELS` env var |
| `--types POST,POLL` | run one type only (default both) |
| `--briefs <n>` | the first n briefs of each type (default 5); `--briefs 1` is a cheap smoke run |
| `--concurrency <n>` | calls in flight at once (default 2); lower it for steadier latency numbers |
| `--effort <level>` | reasoning effort for every call, overriding `GENERATION_REASONING_EFFORT`. Which levels a model accepts differs (see `.env.example`) |
| `--json <path>` | the full result: every record with its output, usage and timing |
| `--md <path>` | the side-by-side report: the summary table, then each brief's output per model |

The exit code is non-zero when any call failed. To compare efforts, run it once per `--effort` with the same models and
different output paths.

## Choosing and recording a model

1. Read the `--md` file brief by brief. Reject a model whose POST voice or POLL options are visibly worse.
2. Among the models that read as well as the baseline, prefer the lowest p50 and p90 with a low `repaired` count: a
   repair turn doubles a call.
3. Set `POLL_GENERATION_MODEL` and `POST_GENERATION_MODEL` on the worker (unset or empty keeps `GENERATION_MODEL`) and
   restart it. DOCUMENT generation is unaffected.
4. Record the choice, the eval date and the `--md`/`--json` files on #239, and update the model table in the performance
   plan.
