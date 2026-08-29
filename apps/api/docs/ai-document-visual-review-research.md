# AI Document Visual Review: Feasibility, Cost, and Value

> Status: research report for wayfinder ticket [#158](https://github.com/krispamB/linkgenserver/issues/158), part of map [#157](https://github.com/krispamB/linkgenserver/issues/157).
> Scope: what visual review is buildable on the OpenRouter and Browserless stack this repository already uses, and what incremental cost, latency, and defect-detection value the backend specification should expect from always-on, conditional, sampled, and omitted visual review of 2–15-page documents. No application code is changed by this document, and no policy is decided here — ticket #159 makes the call.
> Provider access date: **2026-08-29**. Every price below is a spot reading on that date and will go stale.
> Codebase facts were read against `main` at commit `569b4bc`. This research branch is based on an earlier commit, so a few line numbers in `src/llm/` differ from the checkout you are reading; the citations follow `main`.

## Short summary

- **Nothing in the stack passes an image to a model today.** `LLMMessage` content is a bare `string` on every arm (`src/llm/interfaces/llm.interfaces.ts:16-38`) and `toChatMessage` forwards it unchanged (`src/llm/strategies/openrouter.strategy.ts:45-72`). Visual review requires widening the LLM interface to OpenAI-style content parts. That is the only hard blocker; everything else is configuration.
- **Both configured models are already vision-capable.** `GENERATION_MODEL=openai/gpt-5.4` and `RESEARCH_MODEL=openai/gpt-5-mini` (`.env.example:36-37`) both advertise `input_modalities: ["text","image","file"]` ([OpenRouter models API](https://openrouter.ai/api/v1/models), read 2026-08-29). No model change is needed to *try* visual review.
- **The cheapest raster path costs zero extra Browserless units,** because the pipeline already renders a PDF and OpenRouter accepts a PDF as a `file` content part with `engine: "native"`, "passed directly to the model" and "charged as input tokens" ([Images & PDFs](https://openrouter.ai/docs/features/multimodal/pdfs)). A second Browserless session is only needed if the specification wants true per-page PNGs.
- **Per-document incremental model cost** for a page-image review, at the assumptions in §3: roughly **$0.0011 / $0.0025 / $0.0056** (2 / 6 / 15 pages) on `google/gemini-3.1-flash-lite`, **$0.0043 / $0.0107 / $0.0250** on `openai/gpt-5.4-mini`, and **$0.0144 / $0.0356 / $0.0834** on `openai/gpt-5.4`. In app credits at the launch formula that is **3 / 5 / 12**, **9 / 22 / 51**, and **29 / 72 / 167** credits.
- **Against today's whole DOCUMENT run (about 32 credits: 24 generation + 8 render, [credit-allocation-proposal.md:46-49](./credit-allocation-proposal.md)), a 6-page review on the generation model adds 72 credits — roughly 225%, more than tripling the run.** On a flash-lite model it adds 5 credits, about 16%. Measured against the generation call alone the same figures are +297% and +21% (§3.5).
- **Added wall-clock** for the model call alone: about **1.8–5.7 s** (flash-lite), **4.7–16.5 s** (gpt-5.4-mini), **5.8–19.4 s** (gpt-5.4) across 2→15 pages, before any image-prefill allowance, which no provider publishes.
- **The defect classes the ticket names are the ones vision models measurably fail at.** UI-Lens (CVPR 2026), 4,759 expert-annotated pages across 10 mainstream models, reports task-average F1 of **20.36% on Text Overflow** and **31.21% on Container Overlap**, describing performance on fine-grained element-boundary tasks as "near random" ([UI-Lens](https://cvpr.thecvf.com/virtual/2026/poster/38861)).
- **The same defects are deterministically detectable for free in the render browser** via `scrollWidth > clientWidth` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollWidth)), bounding-box comparison, `document.fonts.check()` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/check)), and the WCAG relative-luminance formula ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)) — all inside the browser session the pipeline already pays for.

---

## 1. What the current stack actually does

### 1.1 The rendering path

`RENDER_PDF` runs only for `ArtifactType.DOCUMENT` (`src/workflow/engine/workflow.builder.ts:18-30`). It calls `CarouselRendererService.render`, which assembles one HTML document for the whole deck and makes exactly one Browserless call — "the whole deck is one HTML document rendered in one Browserless call, never a per-slide round-trip" (`src/carousel/carousel-renderer.service.ts:32-42`).

The call itself is a plain `fetch` POST to `${BROWSERLESS_URL}/pdf?token=…` (`src/carousel/utils/html-to-pdf.util.ts:42-62`) with:

| Setting | Value | Source |
| --- | --- | --- |
| Page box | `1080px × 1350px`, zero margins, `printBackground: true` | `src/carousel/utils/html-to-pdf.util.ts:14-20` |
| Viewport | matched to the page box so "CSS layout is pixel-accurate" | `src/carousel/utils/html-to-pdf.util.ts:38-40,53` |
| Navigation | `gotoOptions: { waitUntil: 'networkidle0' }` | `src/carousel/utils/html-to-pdf.util.ts:52` |
| Request timeout | **none set** — no `AbortSignal`, no `gotoOptions.timeout` | `src/carousel/utils/html-to-pdf.util.ts:44-62` |
| Page count | `slides.length`, true by construction because the page box equals the slide box | `src/carousel/carousel-renderer.service.ts:74-79` |

Document length is bounded at the schema: `slidesSchema = z.array(slideSchema).min(2).max(15)` (`src/carousel/schemas.ts:67`). That is exactly the 2–15 range the ticket asks about.

Browserless usage is measured, not assumed: `browserlessUnitsForDuration = max(1, ceil(durationMs / 30_000))` (`src/carousel/carousel-renderer.service.ts:19-22`), and every attempt — success or failure — is appended to the run record (`src/workflow/steps/render-pdf.step.ts:57-77`).

### 1.2 The LLM path

`OpenRouterStrategy` wraps `@openrouter/sdk` (`^0.13.39`, `package.json`) and issues one non-streaming `client.chat.send` per turn (`src/llm/strategies/openrouter.strategy.ts:264-296`). Three facts matter for this question:

1. **Message content is a string, everywhere.** `SystemMessage`, `UserMessage`, and `ToolResultMessage` all declare `content: string` (`src/llm/interfaces/llm.interfaces.ts:16-38`), and `toChatMessage` passes it through verbatim (`src/llm/strategies/openrouter.strategy.ts:45-72`). There is no content-part array, no `image_url`, no `file`. **This is the one structural change visual review forces.**
2. **Structured output already works.** `CompletionOptions.responseSchema` (`src/llm/interfaces/llm.interfaces.ts:77-85`) is converted to a strict JSON Schema and sent as `responseFormat: { type: 'json_schema', jsonSchema: { strict: true, … } }` together with `provider: { requireParameters: true }` (`src/llm/strategies/openrouter.strategy.ts:264-289`). A defect report can therefore come back schema-validated with no new machinery.
3. **No request timeout or retry lives in the strategy.** Errors are normalised by `toLLMError` and the retry budget is the whole-job one (§1.3).

Generation is "one `complete` call with no tools, plus at most one repair" (`src/agent/agent-runner.service.ts:274-278`), and the completion budget is capped at `GENERATION_MAX_OUTPUT_TOKENS`, default `8192` (`src/agent/agent-runner.service.ts:44,445`; `.env.example:41`).

### 1.3 Credit metering and the retry budget

The meter recognises three usage kinds — `llm`, `web_search`, `pdf_render` (`src/feature-gating/credit-meter.constants.ts:3-9`). LLM usage is priced from the provider-reported USD cost: `credits = ceil(cost_usd × CREDITS_PER_USD × CREDIT_MARKUP)` with defaults `1000` and `2.0` (`src/feature-gating/credit-meter.service.ts:83-102`; `.env.example:55-56`). Browserless is priced per measured 30-second unit at `CREDIT_SURCHARGE_PDF_RENDER = 4` with a per-render floor `CREDIT_MINIMUM_PDF_RENDER = 8` (`src/feature-gating/credit-meter.service.ts:63-69`; `.env.example:62-63`).

**Consequence for visual review:** a review call is an `llm` record and needs *no new usage kind* — `ctx.meter.record({ kind: 'llm', amount: usage.cost, detail: { model, totalTokens } })` is exactly the shape `GENERATE` already emits (`src/workflow/steps/generate.step.ts:33-38`). A *separate* Browserless raster session, by contrast, would emit a second `pdf_render` record, and the 8-credit floor is written per render attempt, so a two-session document would pay the floor twice. That is a specification decision, not an accident to inherit.

The job carries `attempts: 3` with exponential backoff and there are no per-step checkpoints — "a retry re-runs the whole job from step 1" (`src/workflow/workflow.queue.ts:33-39`; `src/workflow/engine/workflow.engine.ts:34`). Meter accounting is attempt-scoped and restarts from zero on a retry (`src/workflow/engine/workflow.engine.ts:46`).

The worker is constructed with no `concurrency` option (`src/workflow/workers/workflow.worker.ts:67-77`), so it takes BullMQ's default of `concurrency: 1` with `lockDuration: 30000` (`node_modules/bullmq/dist/cjs/classes/worker.js:35`). **Every second added to a DOCUMENT run is a second the whole `workflow` queue is blocked**, not just that user's run. This makes latency a throughput question, not only a UX one.

### 1.4 What is already available and unused

- `puppeteer-core@^24.43.0` is a production dependency but **nothing under `src/` imports it** (verified by grep). A Browserless BaaS WebSocket session is therefore reachable without adding a dependency.
- There is **no image-processing library** (`sharp`, `jimp`) and **no PDF rasteriser** in `package.json`. Any approach that requires splitting a tall PNG or converting PDF pages to images locally needs a new dependency and, for a rasteriser, a native binary in the worker image.

---

## 2. Provider facts

### 2.1 OpenRouter: image input

Images are sent on `/api/v1/chat/completions` as content parts inside the `messages` array, `{ type: 'image_url', image_url: { url } }`, where `url` is either an HTTP(S) URL or a `data:` URL ([Image understanding](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding)). The `@openrouter/sdk` form uses the camel-cased `imageUrl` key ([same page, SDK example](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding)).

Documented constraints:

| Fact | Wording | Source |
| --- | --- | --- |
| Formats | `image/png`, `image/jpeg`, `image/webp`, `image/gif` | [Image understanding](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding) |
| Count limit | "The number of images you can send in a single request varies per provider and per model." | same |
| Ordering | "Due to how the content is parsed, we recommend sending the text prompt first, then the images." | same |
| URL vs base64 | URLs are "more efficient for publicly accessible images"; base64 is "required for local files or private images" | same |

The R2 bucket holding rendered documents is private (`src/carousel/carousel-renderer.service.ts:32-42`), so page rasters would have to be either base64 data URLs or presigned URLs. The repo already has `@aws-sdk/s3-request-presigner`, so both are open.

Downstream, the hard limits are the model's, not OpenRouter's:

- **OpenAI:** "Up to 1,500 images per request", "Up to 512 MB total payload per request" ([OpenAI vision guide](https://developers.openai.com/api/docs/guides/images-vision)).
- **Gemini:** "a maximum of 3,600 image files per request"; inline base64 is capped by a **20 MB** total request size, above which the Files API is required ([Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)).

A 15-page document at `deviceScaleFactor: 1` is comfortably inside both. At `deviceScaleFactor: 2` (2160 × 2700 per page) base64 payloads plausibly approach Gemini's 20 MB inline ceiling; that is a reason for the specification to pin the scale factor rather than leave it to a caller.

### 2.2 OpenRouter: PDF input — the zero-render path

OpenRouter accepts PDFs "as direct URLs or base64-encoded data URLs in the messages array, via the file content type", with three parsing engines ([Images & PDFs](https://openrouter.ai/docs/features/multimodal/pdfs)):

| Engine | Behaviour | Cost |
| --- | --- | --- |
| `mistral-ocr` (default) | "Best for scanned documents or PDFs with images" | "$2 per 1,000 pages" |
| `cloudflare-ai` | "Converts PDFs to markdown using Cloudflare Workers AI" | Free |
| `native` | "Only available for models that support file input natively" — the PDF "is passed directly to the model" | "charged as input tokens" |

`openai/gpt-5.4` and `openai/gpt-5.4-mini` both list `file` in `input_modalities` and their model pages say they accept "files such as PDFs, images and text as input" ([gpt-5.4](https://openrouter.ai/openai/gpt-5.4), [gpt-5.4-mini](https://openrouter.ai/openai/gpt-5.4-mini)). So the artifact the pipeline *already produces and uploads* can be handed to the reviewing model with **no second Browserless session and no rasterisation step at all**.

Two caveats, both real:

1. `pdf-text`/`cloudflare-ai` extract text and would see **none** of the layout. Only `native` (or `mistral-ocr`, which is per-page priced and caps at "at most 8 images per PDF") preserves visual information. A specification that says "send the PDF" must pin `engine: "native"`.
2. **OpenRouter does not publish how a PDF page converts to input tokens under `native`.** OpenAI's own vision guide documents image tokenisation but not PDF-page tokenisation. Treat the §3 image-token figures as a *floor* for the PDF path, not an equivalent. This is the largest unresolved cost question in this report.

`CompletionOptions` has no field for the `plugins` array that selects the parser (`src/llm/interfaces/llm.interfaces.ts:77-85`), so this path needs an interface widening too — a smaller one than content parts.

### 2.3 How image tokens are counted and billed

OpenRouter bills images as ordinary prompt tokens: its usage documentation states prompt tokens include "images, input audio, and tools if any", and that "Token counts are calculated using the model's native tokenizer" ([API reference overview](https://openrouter.ai/docs/api-reference/overview)). The `pricing` object in the models API carries a distinct `image` rate for only **29 of the 229 vision-capable models**, all Google, and in every case that rate is **identical to the `prompt` rate** (computed over [openrouter.ai/api/v1/models](https://openrouter.ai/api/v1/models), read 2026-08-29). There is no per-image flat fee on any candidate model; the number that matters is **how many tokens a page raster becomes**.

**OpenAI, patch-based** — used by `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5-mini`, `gpt-5.5`, `gpt-5.2`, `gpt-5.6-*` ([OpenAI vision guide](https://developers.openai.com/api/docs/guides/images-vision)):

```text
patch_count = ceil(width/32) × ceil(height/32)
if patch_count > patch_budget:  shrink proportionally, then recount
image_tokens = ceil(patch_count × model_multiplier)
```

Multiplier is **1.2×** for the gpt-5.4 family and gpt-5-mini; the patch budget for `gpt-5.4` at high detail is **2,500 patches**. Detail levels are `low`, `high`, `original`, `auto` (default `auto`).

**Google, tile-based** ([Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)):

```text
258 tokens if both dimensions <= 384px
otherwise: crop_unit = floor(min(width, height) / 1.5)
           tiles = ceil(width/crop_unit) × ceil(height/crop_unit)
           image_tokens = tiles × 258
```

Google's own worked example: "an image of dimensions 960x540 would have a crop unit size of 360. Divide each dimension by 360 and the number of tile is 3 * 2 = 6." A `media_resolution` parameter can cap "the maximum number of tokens allocated per input image".

**Applied to this repository's 1080 × 1350 page box:**

| Family | Arithmetic | Tokens per page |
| --- | --- | ---: |
| OpenAI patch (1.2×) | `ceil(1080/32)=34`, `ceil(1350/32)=43`, `34×43 = 1462` patches (under the 2,500 budget, no shrink), `ceil(1462 × 1.2)` | **1,755** |
| Gemini tile | `crop_unit = floor(1080/1.5) = 720`; `ceil(1080/720)=2`, `ceil(1350/720)=2`; `4 × 258` | **1,032** |

A useful corollary: because 1462 < 2500, a **single full-page 1080-wide capture of the whole deck would be shrunk**. For 15 pages stacked (1080 × 20250) the raw patch count is `34 × 634 = 21,556`, roughly 8.6× the budget, forcing a shrink factor near 0.34 — page text at roughly a third of its rendered size. **One tall screenshot is not a viable substitute for N page images on OpenAI models.** Gemini has no equivalent fixed budget, and the same tall image tiles to `2 × 29 = 58` tiles = 14,964 tokens, close to the 15,480 for fifteen separate pages — so the trick is cheap on Gemini and destructive on OpenAI.

### 2.4 Structured output alongside image input

OpenRouter's structured-outputs documentation states "The model will respond with a JSON object that strictly follows your schema" and **records no restriction relating to image or multimodal inputs** ([Structured outputs](https://openrouter.ai/docs/features/structured-outputs)). It recommends `require_parameters: true` in provider preferences "to ensure your request routes only to endpoints supporting structured outputs" — which `OpenRouterStrategy` already sets whenever a `responseSchema` is present (`src/llm/strategies/openrouter.strategy.ts:286`).

Endpoint listings for all three candidate models advertise both `response_format` and `structured_outputs` in `supported_parameters` ([models endpoints API](https://openrouter.ai/api/v1/models/openai/gpt-5.4-mini/endpoints), read 2026-08-29). *Absence of a documented restriction is not a positive guarantee* — no primary source explicitly certifies schema-constrained output with image input — but the parameter surface supports it and the risk is low.

### 2.5 Candidate models and prices

Spot prices from [openrouter.ai/api/v1/models](https://openrouter.ai/api/v1/models), read **2026-08-29**. These are the default list rates; the per-endpoint listing shows cheaper and pricier provider variants for the same slug, so realised cost can differ by up to ~2× either way.

| Model | Input $/M | Output $/M | Image billing | Context | Median latency | Throughput |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| `google/gemini-3.1-flash-lite` | 0.25 | 1.50 | `image` = 0.25 $/M (same as prompt) | 1,048,576 | 0.43 s | 198 tok/s |
| `openai/gpt-5.4-mini` | 0.75 | 4.50 | folded into prompt tokens | 400,000 | 0.61 s | 66 tok/s |
| `openai/gpt-5.4` (current `GENERATION_MODEL`) | 2.50 | 15.00 | folded into prompt tokens | 1,050,000 | 1.02 s | 57 tok/s |
| `openai/gpt-5-mini` (current `RESEARCH_MODEL`) | 0.25 | 2.00 | folded into prompt tokens | 400,000 | — | — |

Latency and throughput are the published p50 figures on the respective model pages ([gemini-3.1-flash-lite](https://openrouter.ai/google/gemini-3.1-flash-lite), [gpt-5.4-mini](https://openrouter.ai/openai/gpt-5.4-mini), [gpt-5.4](https://openrouter.ai/openai/gpt-5.4)), read 2026-08-29.

**Reasoning tokens are the biggest cost hazard.** All three models list `reasoning` and `reasoning_effort` in `supported_parameters`, and Gemini's endpoint pricing carries a separate `internal_reasoning` rate of $1.50/M — the same as its completion rate. Reasoning tokens bill as output. The §3 completion estimates assume reasoning is off or minimal; with reasoning enabled the output side can be several times larger, and on `gpt-5.4` at $15/M that dominates everything else. **A visual-review specification should pin `reasoning_effort` explicitly rather than inherit a default.**

### 2.6 Browserless: producing page rasters

The `/screenshot` REST endpoint accepts either `url` or inline `html` and a Puppeteer-shaped `options` object: `type` (`png`/`jpeg`/`webp`), `quality`, `fullPage`, `clip` (`x`,`y`,`width`,`height`), `omitBackground`, `encoding` (`base64`/`binary`), `captureBeyondViewport`, plus a `viewport` with `width`, `height`, `deviceScaleFactor`, and the same `gotoOptions`/`waitFor*` family the PDF call already uses ([Screenshot API](https://docs.browserless.io/rest-apis/screenshot-api), [OpenAPI schema](https://docs.browserless.io/open-api/screenshot)).

There is **no endpoint that returns N page images from one request**. Browserless states that the REST APIs each "launch a browser, perform one task, and close the session" ([REST APIs overview](https://docs.browserless.io/rest-apis/intro)), and repeats it for `/function`: "The `/function` API, like all REST APIs, automatically closes the browser session after execution completes" ([Function API](https://docs.browserless.io/rest-apis/function)). Four shapes are therefore available:

| # | Approach | Browserless sessions | Viable? |
| --- | --- | ---: | --- |
| **A** | One `/screenshot` per page, `clip` at `y = 1350 × i` | **N** | Works, but N cold starts and ≥N units. Worst option. |
| **B** | One `/function` call that loops the pages in one session and returns N base64 PNGs in a JSON body | **1** | Best raster option. `/function` runs "custom Puppeteer code", returns `{ data, type }` where data is "Buffer, JSON, or plain text", and the docs explicitly demonstrate `page.screenshot({ encoding: "base64" })`. |
| **C** | One `/screenshot` with `fullPage: true`, then slice | **1** | Slicing needs an image library not in `package.json`; sending it unsliced hits the patch-budget shrink of §2.3. |
| **D** | **No new session** — send the already-rendered PDF as a `file` part with `engine: "native"` (§2.2) | **0** | Cheapest and simplest; per-page token cost undocumented. |

A fifth option, a `puppeteer-core` BaaS WebSocket connection, is technically open (the dependency is installed) and would also be one session, but it introduces a persistent-connection failure mode the current one-shot `fetch` does not have.

### 2.7 Browserless: units, plans, and concurrency

Billing is by browser time, not by page: "Browser time is billed in 30-second increments. Every 30 seconds a browser session is open consumes 1 unit", "Partial increments are rounded up, so a session open for 31 seconds consumes 2 units", and a 45-second session "consumes 2 units, regardless of whether the browser is actively navigating or sitting idle" ([Unit consumption](https://docs.browserless.io/overview/unit-consumption)). Proxy traffic (6 units/MB residential, 2 units/MB datacenter) and CAPTCHA solves (10 units) are not on this path.

Plans as published **2026-08-29** ([Browserless pricing](https://www.browserless.io/pricing)); prices shown are annual billing:

| Plan | Price | Units/month | Overage | Concurrency | Max session |
| --- | ---: | ---: | ---: | ---: | ---: |
| Free | — | 1,000 | — | 2 | 2 min |
| Prototyping | $25/mo | 20,000 | $0.0020/unit | 15 | 15 min |
| Starter | $140/mo | 180,000 | $0.0017/unit | 40 | 30 min |
| Scale | $350/mo | 500,000 | $0.0015/unit | 100 | 60 min |

> **Drift note.** [credit-allocation-pricing-research.md](./credit-allocation-pricing-research.md) recorded the same page on 2026-07-13 with Prototyping concurrency 5 (monthly) / 10 (yearly), Starter 30/40, Scale 80/100, and a 1-minute Free session cap. The 2026-08-29 reading shows single concurrency figures of 15/40/100 and a 2-minute Free cap. Unit allowances and overage rates are unchanged. Whichever policy #159 picks, the Browserless plan figures should be re-read before they enter a costing.

Because the worker runs one job at a time (§1.3), plan concurrency is not the binding constraint at current scale — worker concurrency is.

---

## 3. Cost and latency model

### 3.1 Assumptions (change these and the arithmetic re-derives)

| Assumption | Value | Basis |
| --- | --- | --- |
| Page raster size | 1080 × 1350 px, `deviceScaleFactor: 1` | matches the page box, `src/carousel/utils/html-to-pdf.util.ts:14-20` |
| Pages per document | 2 (min), 6 (typical), 15 (max) | `src/carousel/schemas.ts:67` |
| Review instruction prompt | 600 tokens | assumption — a defect rubric plus the design-system constraints |
| Per-page text label | 10 tokens (`"Page 3 of 6"` and a separator) | assumption |
| Prompt text total | `600 + 10N` | derived |
| Completion (schema-constrained defect report) | `150 + 60N` tokens | assumption — an envelope plus a short per-page verdict |
| Reasoning tokens | **zero** | assumption; see the §2.5 hazard |
| Credit conversion | `credits = ceil(usd × 1000 × 2)` | `src/feature-gating/credit-meter.service.ts:83-102`, `.env.example:55-56` |

Image tokens per page: **1,755** (OpenAI patch, 1.2×) and **1,032** (Gemini tile) — derived in §2.3.

### 3.2 Per-document totals

`prompt_tokens = N × image_tokens_per_page + 600 + 10N`; `completion_tokens = 150 + 60N`.

| Pages | Model | Prompt tok | Completion tok | Input $ | Output $ | **Total $** | **Credits** |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | `gemini-3.1-flash-lite` | 2,684 | 270 | 0.000671 | 0.000405 | **0.00108** | **3** |
| 6 | `gemini-3.1-flash-lite` | 6,852 | 510 | 0.001713 | 0.000765 | **0.00248** | **5** |
| 15 | `gemini-3.1-flash-lite` | 16,230 | 1,050 | 0.004058 | 0.001575 | **0.00563** | **12** |
| 2 | `gpt-5.4-mini` | 4,130 | 270 | 0.003098 | 0.001215 | **0.00431** | **9** |
| 6 | `gpt-5.4-mini` | 11,190 | 510 | 0.008393 | 0.002295 | **0.01069** | **22** |
| 15 | `gpt-5.4-mini` | 27,075 | 1,050 | 0.020306 | 0.004725 | **0.02503** | **51** |
| 2 | `gpt-5.4` | 4,130 | 270 | 0.010325 | 0.004050 | **0.01438** | **29** |
| 6 | `gpt-5.4` | 11,190 | 510 | 0.027975 | 0.007650 | **0.03563** | **72** |
| 15 | `gpt-5.4` | 27,075 | 1,050 | 0.067688 | 0.015750 | **0.08344** | **167** |

Worked example, 6 pages on `gpt-5.4-mini`:

```text
image tokens  = 6 × 1755                   = 10,530
prompt tokens = 10,530 + 600 + (10 × 6)    = 11,190
input cost    = 11,190 × $0.75 / 1e6       = $0.008393
completion    = 150 + (60 × 6)             = 510
output cost   = 510 × $4.50 / 1e6          = $0.002295
total                                      = $0.010688
credits       = ceil(0.010688 × 1000 × 2)  = 22
```

### 3.3 Raster acquisition cost

Using the highest published overage rate, $0.0020/unit (Prototyping), and the repository's own charge of 4 credits/unit with an 8-credit per-render floor:

| Approach | Units for N=2 | N=6 | N=15 | Provider $ (N=15) | App credits (N=15) |
| --- | ---: | ---: | ---: | ---: | ---: |
| **A** — one `/screenshot` per page | ≥2 | ≥6 | ≥15 | ≥$0.030 | ≥60 |
| **B** — one `/function` multi-capture session | 1–2 | 1–2 | 1–2 | $0.002–$0.004 | 8 (floor) |
| **C** — one `fullPage` capture | 1–2 | 1–2 | 1–2 | $0.002–$0.004 | 8 (floor), but unusable on OpenAI (§2.3) |
| **D** — reuse the existing PDF | 0 | 0 | 0 | **$0** | **0** |

Approach A alone can cost more than the entire model review on a flash-lite model. Approach D is free. **The raster-acquisition decision matters more to the economics than the model choice does at the cheap end.**

### 3.4 Latency

| Pages | Model | TTFT (published p50) | Completion time | **Model call** |
| ---: | --- | ---: | ---: | ---: |
| 2 | `gemini-3.1-flash-lite` | 0.43 s | 270 / 198 = 1.4 s | **≈ 1.8 s** |
| 6 | `gemini-3.1-flash-lite` | 0.43 s | 510 / 198 = 2.6 s | **≈ 3.0 s** |
| 15 | `gemini-3.1-flash-lite` | 0.43 s | 1,050 / 198 = 5.3 s | **≈ 5.7 s** |
| 2 | `gpt-5.4-mini` | 0.61 s | 270 / 66 = 4.1 s | **≈ 4.7 s** |
| 6 | `gpt-5.4-mini` | 0.61 s | 510 / 66 = 7.7 s | **≈ 8.3 s** |
| 15 | `gpt-5.4-mini` | 0.61 s | 1,050 / 66 = 15.9 s | **≈ 16.5 s** |
| 2 | `gpt-5.4` | 1.02 s | 270 / 57 = 4.7 s | **≈ 5.8 s** |
| 6 | `gpt-5.4` | 1.02 s | 510 / 57 = 9.0 s | **≈ 10.0 s** |
| 15 | `gpt-5.4` | 1.02 s | 1,050 / 57 = 18.4 s | **≈ 19.4 s** |

Three honest qualifications:

1. **The published p50 latency is time-to-first-token measured on OpenRouter's mixed traffic, which is overwhelmingly short text prompts.** Prefilling 16,230 image tokens is not free, and **no primary source publishes image-prefill latency for any of these models.** Treat the table as a lower bound.
2. Raster acquisition adds on top: **0 s** for approach D, **one extra Browserless session** for B (no published per-request latency; the repository's own costing assumes a normal render "completes within 30 seconds" and uses 2 units as the safety envelope, [credit-allocation-proposal.md:136-145](./credit-allocation-proposal.md)), and **N cold starts, serialised** for A.
3. If review triggers a repair, the tail is `regenerate + re-render + re-review`, which roughly doubles the DOCUMENT portion of the run and can exceed the 3-attempt job budget's implicit patience.

### 3.5 The incremental burden, as a ratio

Two anchors for the generation call, because the feature under design changes it:

- **Today's DOCUMENT generation** costs roughly **24 credits ≈ $0.012** of provider cost, plus 8 credits for the render ([credit-allocation-proposal.md:46-49](./credit-allocation-proposal.md)).
- **Tomorrow's Document Source generation** emits complete HTML and CSS ([CONTEXT.md](../CONTEXT.md), "Document Source"), so the completion side grows toward the `GENERATION_MAX_OUTPUT_TOKENS` ceiling of 8,192 (`.env.example:41`). At `gpt-5.4` rates that ceiling alone is `8192 × $15/1e6 = $0.123`, plus roughly $0.008 of prompt — call it **$0.13 at the cap**.

| Review model, 6 pages | vs today's $0.012 generation | vs an HTML-source $0.13 generation |
| --- | ---: | ---: |
| `gemini-3.1-flash-lite` ($0.0025) | **+21%** | **+2%** |
| `gpt-5.4-mini` ($0.0107) | **+89%** | **+8%** |
| `gpt-5.4` ($0.0356) | **+297%** | **+27%** |

The spread is the whole decision. If Document Source generation lands near its output cap, a flash-lite review is rounding error and even a same-model review is a quarter of the run. If it stays near today's cost, always-on review on the generation model **triples** the bill.

---

## 4. Failure-detection value

### 4.1 What the published evaluations actually say

**The strongest and most directly relevant primary result is negative.** UI-Lens (CVPR 2026) built a UI display-defect benchmark of "4,759 pages meticulously annotated by design experts, covering six core display defect categories" and evaluated "10 mainstream models (8 closed-source, 2 open-source)". Its finding: "for tasks requiring fine-grained element boundary understanding, performance is near random, with task-average F1 scores of 20.36% and 31.21% on Text Overflow and Container Overlap, respectively; for sequential interface semantic consistency (e.g., Text Inconsistency), the task-average F1 score is only 10.61%" ([CVPR 2026 poster page](https://cvpr.thecvf.com/virtual/2026/poster/38861); [open-access entry](https://openaccess.thecvf.com/content/CVPR2026/html/Xiang_UI-Lens_Assessing_General_MLLMs_Potential_to_Automate_UI_Display_Quality_CVPR_2026_paper.html)).

Text overflow and container overlap are two of the seven defect classes the ticket names. On the best available benchmark, general MLLMs are near chance on both.

The mechanism is corroborated. "Vision language models are blind" (ACCV 2024) found that four state-of-the-art VLMs averaged 58.07% on seven tasks trivial for humans, that "VLMs including slow-thinking models consistently struggle with those tasks that require precise spatial information when geometric primitives overlap or are close", and — importantly for prompt design — that "VLMs perform at near-100% accuracy when much more space is added to separate shapes and letters" ([arXiv:2407.06581](https://arxiv.org/abs/2407.06581)). Linear probing showed the vision encoder holds the information and the language model fails to decode it, so this is not a resolution problem that a higher `deviceScaleFactor` fixes.

Evidence pointing the other way is thinner and less direct:

- 1D-Bench, on iterative UI code generation with visual feedback, reports that "iterative editing generally improves final performance by increasing rendering success and often improving visual similarity" ([arXiv:2602.18548](https://arxiv.org/abs/2602.18548)). This supports a *repair* loop that uses a rendered screenshot, not a *detection* gate — and "rendering success" is a coarser signal than "this page has a 3px clip".
- "MLLM as a UI Judge" benchmarked GPT-4o, Claude, and Llama across 30 interfaces and found they "approximate human preferences on some dimensions but diverge on others" ([arXiv:2510.08783](https://arxiv.org/abs/2510.08783)). Aesthetic preference prediction is a different task from defect detection, and 30 interfaces is a small base.
- "Can LLMs Detect Display Issues? Uncovering the Impact of Prompting Techniques" (UIST '25, [10.1145/3746058.3758415](https://dl.acm.org/doi/pdf/10.1145/3746058.3758415)) is directly on topic, but the ACM full text returned HTTP 403 to this research and **its numbers were not verified here.** Anyone acting on this report should read it before finalising #159.

**No primary evidence was found** for: vision-model detection rates on *print-style document pages* (as opposed to mobile/web UI), on **blank or near-blank page** detection, on **broken font fallback**, or on **misaligned grids**. All published evaluations located are UI-screenshot benchmarks.

### 4.2 What the free checks already catch

Every one of these runs inside the browser session the pipeline already pays for — a `page.evaluate` in a `/function` call, or a `<script>` in the assembled HTML whose result is read back. Marginal cost: **zero units, zero tokens.**

| Defect class | Deterministic check | Source |
| --- | --- | --- |
| Text overflow | `el.scrollWidth > el.clientWidth \|\| el.scrollHeight > el.clientHeight` — "If the element's content can fit without a need for horizontal scrollbar, its `scrollWidth` is equal to `clientWidth`" | [MDN `scrollWidth`](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollWidth) |
| Clipping past the page box | `getBoundingClientRect()` vs the fixed 1080 × 1350 page rect | `src/carousel/utils/html-to-pdf.util.ts:14-20` |
| Element overlap | pairwise rect intersection over laid-out block elements | as above |
| Blank / near-blank page | visible text length and painted-element area per page section | — |
| Broken font fallback | `document.fonts.check('16px "Inter"')` returns true only when "all matching fonts have a status of `loaded`"; `document.fonts.ready` gates the measurement | [MDN `FontFaceSet.check()`](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/check) |
| Contrast failure (solid backgrounds) | `getComputedStyle` colours through `L = 0.2126R + 0.7152G + 0.0722B` and `(L1 + 0.05) / (L2 + 0.05)`, against 4.5:1 normal / 3:1 large | [W3C WCAG 2.2 §1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) |

That is **six of the seven defect classes the ticket names**, at zero marginal provider cost, with deterministic precision and recall, in the session that already exists. Two of the six are the ones the vision model scores near-random on.

### 4.3 What only a vision model could plausibly catch

Honestly enumerated, and honestly unevidenced:

- **Paint-order occlusion** where bounding rects do not intersect but the rendered result does — stacking contexts, `transform`, negative margins, absolutely positioned decoration over text.
- **Contrast against non-solid backgrounds** — gradients, background images, blend modes. The WCAG formula needs two resolved colours; `getComputedStyle` returns `background-image: linear-gradient(...)`, not a luminance.
- **Glyph-level rendering failure** — tofu boxes for missing glyphs in a font that nonetheless loaded, which `document.fonts.check()` reports as fine.
- **Holistic design judgement** — "this page looks unbalanced", "the hierarchy reads wrong", "this does not look like the design system".

**No primary evidence was found that current vision models reliably detect any of these on document-style pages.** Given the UI-Lens result on the easier, better-specified classes, the prior should be low for the harder ones. The last bullet — holistic judgement — is the only one where the "MLLM as a UI judge" line of work offers even weak support, and it measured preference agreement, not defect detection.

---

## 5. The four policies

Envelopes below assume the §3 model, approach **D** for rasters (zero Browserless cost) with approach **B** as the fallback if per-page PNGs are required, and `gpt-5.4-mini` as a mid-price reference. "Blocked queue seconds" matters because worker concurrency is 1 (§1.3).

| Policy | Added $ per document (2/6/15) | Added credits (6 pages) | Added wall-clock (6 pages) | Catches | Misses |
| --- | --- | ---: | ---: | --- | --- |
| **Always-on** | 0.0043 / 0.0107 / 0.0250 | 22 | ≈ 8 s (+ prefill) | occlusion, gradient contrast, holistic defects — at benchmarked-low rates | overflow/overlap it is near-random on; adds false positives on every run |
| **Conditional** | 0 on clean runs; the always-on figure on triggered runs | 0 or 22 | 0 or ≈ 8 s | the same, but only where a cheap check already flagged trouble or a repair was attempted | anything a run with no trigger contained |
| **Sampled** | flat ≈ 0.0043 (4 fixed pages) per reviewed run × sample fraction | ≈ 9 × fraction | ≈ 5 s × fraction | population-level defect rate; page-1 defects if page 1 is always sampled | per-document guarantees — by construction |
| **Omitted** | 0 | 0 | 0 | nothing beyond the §4.2 deterministic checks | occlusion, gradient contrast, holistic defects |

### 5.1 Always-on

Every DOCUMENT run gains a review step. Cost scales with page count, so the worst case (15 pages, generation model) is 167 credits — **more than five times today's whole 32-credit DOCUMENT run**.

*Workflow implications.* `buildWorkflow` emits an honest step list whose `total` feeds the SSE progress bar, and "only steps that actually run appear" (`src/workflow/engine/workflow.builder.ts:6-11`). An unconditional step is the *only* one of the four policies that keeps `total` a pure function of `(type, withResearch, kind)`; the others make it data-dependent, which the progress contract must then accommodate.

*Metering implications.* One extra `llm` record. No new usage kind. If approach B is chosen instead of D, one extra `pdf_render` record — and the 8-credit `CREDIT_MINIMUM_PDF_RENDER` floor is written per render attempt (`src/feature-gating/credit-meter.service.ts:63-69`), so it would be charged twice per document unless the specification says otherwise.

*The case against.* On the ticket's own defect list, the model is near-random on two classes and unevidenced on the rest, while the deterministic checks cover six of seven for free. Paying 22–167 credits on every run for a signal benchmarked at F1 ≈ 0.20–0.31 on its headline task is hard to justify from the evidence in §4.

### 5.2 Conditional

Trigger the review only on a signal. Three candidates, in descending order of evidential support:

1. **A failed cheap check.** The DOM pass (§4.2) flags a suspect region; the vision call is asked to confirm and localise. This inverts the failure mode: precision matters, not recall, and the model is given a much narrower question than "find every defect on this page".
2. **A repair attempt.** Generation already does "one `complete` call with no tools, plus at most one repair" (`src/agent/agent-runner.service.ts:274-278`). 1D-Bench's finding that "iterative editing generally improves final performance" ([arXiv:2602.18548](https://arxiv.org/abs/2602.18548)) is evidence for visual feedback in exactly this position — a repair loop — and not for a detection gate.
3. **High page count.** The weakest trigger: nothing in §4 suggests defect probability scales with page count, and cost scales with it, so this trigger maximises spend where value is least evidenced.

*Cost envelope.* Expected added cost is `P(trigger) × always-on cost`. If the cheap checks fire on, say, 10% of runs, a 6-page conditional review on `gpt-5.4-mini` averages 2.2 credits — an order of magnitude under always-on — while retaining the full envelope on the runs that need it. **`P(trigger)` is unknown and unmeasurable before the feature ships.**

*Workflow implications.* A data-dependent step breaks the "`total` is exact" property of the progress contract. Either the emitted step list becomes a function of runtime state, or review is folded inside `RENDER_PDF`/`GENERATE` as an internal branch that emits no step of its own — the way `RENDER_PDF` already justifies emitting no `step.progress` (`src/workflow/steps/render-pdf.step.ts:27-29`).

*Metering implications.* Credits become non-deterministic per run for the same input. That is already true (research search counts vary), but the specification should say so, and the user-facing estimate must be a range.

### 5.3 Sampled

Two orthogonal axes, and they behave differently.

**Sampling pages within a run** — e.g. always page 1, always the last page, plus two random middles — makes cost **flat in `N`**: 4 pages on `gpt-5.4-mini` is `4 × 1755 + 640 = 7,660` prompt and `390` completion = $0.0075, about 9 credits for a 2-page or a 15-page document alike. It bounds the worst case, which is the 15-page tail. But it converts a per-document guarantee into a per-document *lottery*, and a defect on an unsampled page ships. Given §4.1, the guarantee being surrendered was weak to begin with.

**Sampling a fraction of runs** buys no per-document assurance at all. Its honest purpose is *measurement*: reviewing 5% of runs produces the defect-rate estimate that §4 cannot supply from the literature, at 5% of always-on cost. That is a strong argument for sampling as a **launch instrument**, feeding the same evidence loop as [production-credit-economics-review.md](./production-credit-economics-review.md), and a weak argument for it as a quality control.

*Workflow implications.* Same data-dependence problem as conditional. *Metering implications.* Two users creating identical documents get different bills — arguably worse than conditional, where the trigger is at least attributable to the content.

### 5.4 Omitted

No review step. The deterministic checks of §4.2 stand alone, and the pipeline's quality gate stays the Zod contract plus DOM measurement.

*What ships broken:* paint-order occlusion, contrast over gradients and images, glyph-level rendering failure, holistic design mismatch. §4.3 could find no primary evidence that a vision model reliably catches any of them anyway — so the honest description of what omission costs is **"an unmeasured amount of an unevidenced benefit"**, not "these defects reach users where visual review would have stopped them".

*Workflow implications.* None — the step list, the progress contract, the metering path, and the LLM interface all stay as they are. This is the only policy that requires no change to `LLMMessage` (§1.2).

---

## 6. Recommendation

**The evidence supports omitting always-on visual review at launch, building the deterministic DOM checks instead, and adding a conditional review whose trigger is a failed cheap check or a repair attempt — behind a config flag, defaulted off, with a fraction-of-runs sample used to measure whether it earns its cost.**

The reasoning, in order of weight:

1. The best available benchmark says general MLLMs are **near random** on the two defect classes the ticket names most concretely — F1 20.36% on Text Overflow, 31.21% on Container Overlap across 10 models and 4,759 expert-annotated pages ([UI-Lens](https://cvpr.thecvf.com/virtual/2026/poster/38861)) — and the mechanism behind that failure is a documented, resolution-independent VLM weakness ([arXiv:2407.06581](https://arxiv.org/abs/2407.06581)).
2. Six of the seven named defect classes are deterministically detectable **for free**, in the browser session already paid for (§4.2).
3. Always-on review on the current `GENERATION_MODEL` would add **297%** to today's DOCUMENT generation cost for a 6-page document (§3.5).
4. The one policy the literature does support — visual feedback inside a repair loop ([arXiv:2602.18548](https://arxiv.org/abs/2602.18548)) — is the conditional shape, not the always-on shape.

**Two facts would flip this:**

- **A measured defect rate showing the deterministic checks miss materially.** If a sampled review (or manual audit) of real Document Source output shows that a meaningful share of documents ship with defects the DOM pass does not see — occlusion, contrast over gradients, glyph failure — then conditional-on-cheap-check never fires for the defects that matter, and always-on becomes the only policy that covers them. This is the single most decision-relevant unknown, and only production data answers it.
- **Document Source generation landing near its output-token cap.** If HTML/CSS generation costs ~$0.13 rather than today's ~$0.012, a `gemini-3.1-flash-lite` review of a 6-page document is **+2%** of the run (§3.5). At that ratio the cost objection to always-on essentially disappears, and the decision reduces to whether a low-F1 signal is worth 3 seconds of a single-concurrency worker.

A third, smaller lever: if the PDF `native` file path (§2.2) turns out to tokenise pages *cheaper* than the per-page raster estimates — plausible, since it skips a rasterisation round-trip — every figure in §3.2 is an overestimate. OpenRouter does not publish that conversion, so it must be measured.

This is input to ticket #159, not the decision.

---

## 7. Evidence gaps this report could not close

1. **PDF-page-to-token conversion under OpenRouter's `native` engine.** Undocumented by OpenRouter and by OpenAI. Blocks a firm costing of the cheapest raster path (§2.2). *Closeable by one metered API call.*
2. **Image-prefill latency.** No provider publishes time-to-first-token as a function of image-token count; the §3.4 table uses text-workload p50s and is a lower bound. *Closeable by measurement.*
3. **Raster byte size for a real rendered page.** Not measured here (it would need live Browserless credentials). Matters only for payload limits and upload time, not billing, but it decides whether `deviceScaleFactor: 2` is viable against Gemini's 20 MB inline cap (§2.1).
4. **UIST '25 "Can LLMs Detect Display Issues?"** — directly on topic, ACM full text returned HTTP 403. Its numbers should be read before #159 is decided.
5. **Vision-model performance on print-style document pages.** Every located benchmark is mobile or web UI. Whether a 1080 × 1350 designed document page behaves like a UI screenshot for these models is unknown.
6. **`P(cheap check fires)` in production.** Determines whether the conditional policy's expected cost is 10% or 90% of always-on. Unknowable before launch.
7. **Reasoning-token behaviour on a visual-review prompt.** All three candidate models support `reasoning_effort`; nothing here measures how many reasoning tokens a defect-detection prompt actually draws, and on `gpt-5.4` at $15/M output that term could dominate the whole model (§2.5).

---

## Sources

Provider and vendor documentation, all accessed **2026-08-29**:

- [OpenRouter — Image understanding](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding)
- [OpenRouter — Images & PDFs](https://openrouter.ai/docs/features/multimodal/pdfs)
- [OpenRouter — Structured outputs](https://openrouter.ai/docs/features/structured-outputs)
- [OpenRouter — API reference overview](https://openrouter.ai/docs/api-reference/overview)
- [OpenRouter — models API](https://openrouter.ai/api/v1/models) and [per-model endpoints API](https://openrouter.ai/api/v1/models/openai/gpt-5.4-mini/endpoints)
- [OpenRouter — gpt-5.4](https://openrouter.ai/openai/gpt-5.4), [gpt-5.4-mini](https://openrouter.ai/openai/gpt-5.4-mini), [gemini-3.1-flash-lite](https://openrouter.ai/google/gemini-3.1-flash-lite)
- [OpenAI — Images and vision guide](https://developers.openai.com/api/docs/guides/images-vision)
- [Google — Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)
- [Browserless — Screenshot API](https://docs.browserless.io/rest-apis/screenshot-api) and [OpenAPI schema](https://docs.browserless.io/open-api/screenshot)
- [Browserless — Function API](https://docs.browserless.io/rest-apis/function)
- [Browserless — REST APIs overview](https://docs.browserless.io/rest-apis/intro)
- [Browserless — Unit consumption](https://docs.browserless.io/overview/unit-consumption)
- [Browserless — Pricing](https://www.browserless.io/pricing)

Standards and platform references:

- [W3C — Understanding WCAG 2.2 SC 1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [MDN — `Element.scrollWidth`](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollWidth)
- [MDN — `FontFaceSet.check()`](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/check)

Published evaluations:

- Xiang et al., *UI-Lens: Assessing General MLLMs' Potential to Automate UI Display Quality Assurance*, CVPR 2026 — [poster page](https://cvpr.thecvf.com/virtual/2026/poster/38861), [open access](https://openaccess.thecvf.com/content/CVPR2026/html/Xiang_UI-Lens_Assessing_General_MLLMs_Potential_to_Automate_UI_Display_Quality_CVPR_2026_paper.html)
- Rahmanzadehgervi et al., *Vision language models are blind*, ACCV 2024 — [arXiv:2407.06581](https://arxiv.org/abs/2407.06581)
- *1D-Bench: A Benchmark for Iterative UI Code Generation with Visual Feedback in Real-World* — [arXiv:2602.18548](https://arxiv.org/abs/2602.18548)
- *MLLM as a UI Judge: Benchmarking Multimodal LLMs for Predicting Human Perception of User Interfaces* — [arXiv:2510.08783](https://arxiv.org/abs/2510.08783)
- *Can LLMs Detect Display Issues? Uncovering the Impact of Prompting Techniques*, UIST '25 — [10.1145/3746058.3758415](https://dl.acm.org/doi/pdf/10.1145/3746058.3758415) — **not verified; full text returned HTTP 403**

Repository documents referenced: [credit-allocation-pricing-research.md](./credit-allocation-pricing-research.md), [credit-allocation-proposal.md](./credit-allocation-proposal.md), [production-credit-economics-review.md](./production-credit-economics-review.md), [artifact-workflow-prd.md](./artifact-workflow-prd.md), [carousel-template-system-design.md](./carousel-template-system-design.md), [artifact-schema-and-library-api-design.md](./artifact-schema-and-library-api-design.md), [CONTEXT.md](../CONTEXT.md).
