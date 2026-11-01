# Marquill features

<!-- Generated from src/features.ts and src/changelog.ts. Do not edit; run `bun run render` in packages/product. -->

Every feature Marquill has, is building, or has discussed. `live` means deployed and enabled in production. `board` features appear on the landing page status board.

## Live

### Creation

| Id | Feature | Status | Date | What it does | Landing; plans | Links |
| --- | --- | --- | --- | --- | --- | --- |
| `text-posts` | Text posts | live | 2026-01-27 | Mark drafts a LinkedIn text post (a POST Artifact) from a prompt, in an optional style preset. | board | [artifact-workflow-prd.md](../../apps/api/docs/artifact-workflow-prd.md), [artifacts.md](../../apps/api/docs/api/artifacts.md), [linkedin-dwell-time-and-ai-content-research.md](../../apps/api/docs/linkedin-dwell-time-and-ai-content-research.md) |
| `style-presets` | Style presets | live | 2026-04-08 | Six writing styles for a draft: professional, storytelling, educational, bold, contrarian, founder.<br>_Defined in apps/api/src/agent/style-presets.config.ts._ |  |  |
| `polls` | Polls | live | 2026-08-06 | Mark drafts a POLL Artifact: a question, two to four options, and a 3, 7, or 14 day duration, published as a native LinkedIn poll. | board | #114, #121, [linkedin-poll-document-api-research.md](../../apps/api/docs/linkedin-poll-document-api-research.md), [linkedin-dwell-time-and-ai-content-research.md](../../apps/api/docs/linkedin-dwell-time-and-ai-content-research.md) |
| `artifact-studio` | Artifact Studio | live | 2026-08-06 | The /artifacts/new screen: pick a type (post, poll, document), write a prompt, toggle research, and watch the run. |  | #112 |
| `run-progress` | Live run progress | live | 2026-07-18 | Each workflow step (research, generate, render, persist) and the credit count stream to the browser over SSE while a run works. |  | #112, [sse-progress-contract-design.md](../../apps/api/docs/sse-progress-contract-design.md), [runs.md](../../apps/api/docs/api/runs.md) |
| `artifact-refine` | Refine an artifact | live | 2026-08-06 | Ask Mark for changes to an existing artifact from its conversation page. Each refine is a new Document Version; research is reused, not re-run. |  | #118 |
| `artifact-library` | Artifact library | live | 2026-08-06 | The /artifacts page lists every artifact with search; artifacts can be renamed and deleted. |  | #119, [artifact-schema-and-library-api-design.md](../../apps/api/docs/artifact-schema-and-library-api-design.md) |

### Documents

| Id | Feature | Status | Date | What it does | Landing; plans | Links |
| --- | --- | --- | --- | --- | --- | --- |
| `documents` | Documents | live | 2026-08-06 | Mark makes a DOCUMENT Artifact (a one-pager or a multi-slide carousel), rendered to PDF and published as a LinkedIn document post.<br>_Documents are now made from a Design System; the template carousels were retired in the #177 cutover._ | board | #115, #121, [document-generation-spec.md](../../apps/api/docs/document-generation-spec.md), [carousel-template-system-design.md](../../apps/api/docs/carousel-template-system-design.md), [linkedin-dwell-time-and-ai-content-research.md](../../apps/api/docs/linkedin-dwell-time-and-ai-content-research.md) |
| `design-systems` | Design Systems for documents | live | 2026-10-15 | Six app-owned Design Systems (Afterglow, Broadside, Colophon, Margin, Overprint, Schematic). Mark writes a Candidate Source against the chosen system, it is checked, rendered, and repaired.<br>_Systems that fail the eval ship in UNLISTED_DESIGN_SYSTEMS, so the live set can be smaller than six._<br>_The go-live date is the merge date; #177 has no recorded cutover date._ | board | #177, #191, #193, #198, [document-generation-spec.md](../../apps/api/docs/document-generation-spec.md), [design-systems.md](../../apps/api/docs/api/design-systems.md) |
| `document-refine-from-source` | Refine a document from its Candidate Source | live | 2026-10-14 | A document refine edits the previous Candidate Source instead of starting over, so unchanged pages stay put. |  | #171, #172, #177 |
| `design-system-picker` | Design System swatch menu | live | 2026-10-15 | A swatch menu in Artifact Studio and refine. Each system shows a three-way colour wheel of its background, text, and accent; hovering it previews the sample pages before you pick. |  | #198, #177 |

### Research

| Id | Feature | Status | Date | What it does | Landing; plans | Links |
| --- | --- | --- | --- | --- | --- | --- |
| `research` | Research | live | 2026-08-06 | An optional RESEARCH step before generation: the agent runs Tavily web searches and the findings feed the draft. Each search is metered.<br>_Web search only. Until 2026-10-17 the landing page also claimed YouTube and Reddit; the Apify actors in apps/api/src/actors are not called by the workflow. See research-social-sources._ | board; Starter, Creator, Pro Writer | #113, #126, #127, [agent-loop-and-research-agent-design.md](../../apps/api/docs/agent-loop-and-research-agent-design.md) |

### Publishing

| Id | Feature | Status | Date | What it does | Landing; plans | Links |
| --- | --- | --- | --- | --- | --- | --- |
| `post-composer` | Post composer | live | 2026-07-18 | Create and edit a Post: write text or attach any READY version of an artifact, preview it as LinkedIn lays it out, then publish now or schedule. |  | #120, [post-schema-and-publish-flow-design.md](../../apps/api/docs/post-schema-and-publish-flow-design.md), [posts.md](../../apps/api/docs/api/posts.md) |
| `post-media` | Images and video on posts | live | 2026-04-19 | Attach JPEG/PNG images (reorderable) or one MP4 video to a post, uploaded straight to storage with progress. |  | [presigned-media-upload-spec.md](../../apps/api/docs/presigned-media-upload-spec.md), [async-media-upload-handoff.md](../../apps/web/docs/async-media-upload-handoff.md) |
| `stock-images` | Stock images | live | 2026-02-18 | Search Unsplash and Pexels from the composer and attach a photo. |  |  |
| `publish-now` | Publish now | live | 2026-02-17 | Publish a text, media, poll, or document post to LinkedIn immediately. |  | #120, #121 |

### Scheduling

| Id | Feature | Status | Date | What it does | Landing; plans | Links |
| --- | --- | --- | --- | --- | --- | --- |
| `scheduling` | Scheduling | live | 2026-06-11 | Schedule a post by typing a time in plain language ("next Tuesday 9am"), reschedule or unschedule it, and see it on the calendar. Scheduled posts per plan are limited. | board | #122 |
| `calendar` | Calendar | live | 2026-07-11 | The /calendar page shows scheduled and published posts by date. |  |  |
| `scheduled-post-email` | Scheduled post email | live | 2026-04-07 | An email tells the user when a scheduled post goes live. |  |  |

### Accounts

| Id | Feature | Status | Date | What it does | Landing; plans | Links |
| --- | --- | --- | --- | --- | --- | --- |
| `sign-in` | Sign in | live | 2026-06-16 | Clerk auth with Google, LinkedIn, Apple, or email and password. A verified email is required. |  | [clerk-integration-analysis.md](../../apps/api/docs/clerk-integration-analysis.md) |
| `onboarding` | Onboarding | live | 2026-04-25 | A six-step flow after sign-up that branches on persona (creator or writer) and records goals.<br>_The onboarding profile is not yet read by generation._ |  |  |
| `linkedin-accounts` | LinkedIn accounts | live | 2026-02-11 | Connect, re-authenticate, and disconnect LinkedIn accounts; the sidebar warns when access is expiring. The number of accounts is limited by plan. |  | [linkedin.md](../../apps/api/docs/api/linkedin.md) |
| `company-pages` | Company pages | live | 2026-04-14 | Connect a LinkedIn organization page the user administers and publish or schedule to it. | board |  |

### Insights

| Id | Feature | Status | Date | What it does | Landing; plans | Links |
| --- | --- | --- | --- | --- | --- | --- |
| `dashboard-counts` | Dashboard counts | live | 2026-02-16 | The dashboard shows posts published this month against last month, and monthly counts per account. |  |  |

### Billing

| Id | Feature | Status | Date | What it does | Landing; plans | Links |
| --- | --- | --- | --- | --- | --- | --- |
| `plans-and-checkout` | Plans and checkout | live | 2026-04-14 | Four plans (Free, Starter, Creator, Pro Writer). Paddle checkout from the landing page or billing; upgrades and downgrades prorate.<br>_The plan cards list "30 day / 90 day / 1 year / unlimited history", but nothing in the api enforces a history window._ |  | [payment.md](../../apps/api/docs/api/payment.md) |
| `credits` | AI credits | live | 2026-08-06 | Every run is metered in credits (LLM tokens, web searches, renders) against the plan's monthly allowance; the run shows its credit count live. |  | #109, #128, #129, #130, [credit-usage-system-design.md](../../apps/api/docs/credit-usage-system-design.md), [credit-allocation-proposal.md](../../apps/api/docs/credit-allocation-proposal.md) |
| `billing-page` | Billing page | live | 2026-03-07 | The /billing page shows the current plan, usage against limits, and invoices, and cancels a subscription. |  |  |

### Workspace

| Id | Feature | Status | Date | What it does | Landing; plans | Links |
| --- | --- | --- | --- | --- | --- | --- |
| `in-app-feedback` | In-app feedback | live | 2026-04-08 | The sidebar help button opens a form that files a GitHub issue with device details. |  |  |
| `theme` | Light and dark theme | live | 2026-07-12 | A theme toggle in the app shell. |  |  |
| `welcome-email` | Welcome email | live | 2026-04-07 | A branded welcome email on sign-up. |  |  |

## Planned and building

### Creation

| Id | Feature | Status | Date | What it does | Landing; plans | Links |
| --- | --- | --- | --- | --- | --- | --- |
| `run-in-flight-cap` | Per-user cap on runs in flight | building |  | A user can have at most MAX_INFLIGHT_RUNS_PER_USER artifact runs going at once, so one batch cannot fill the queue for everyone. A launch over the cap gets a 429 run.too_many_in_flight whose message the app shows; nothing is created or charged.<br>_Built but shipped off: MAX_INFLIGHT_RUNS_PER_USER defaults to 0 (no cap). The plan is to turn it on at 3 if queueWaitMs shows users waiting behind another user's batch. Set live (with since and a changelog entry) only once it is switched on in production._ |  | #230, [artifact-generation-performance-plan.md](../../apps/api/docs/artifact-generation-performance-plan.md) |
| `streamed-commentary` | Streamed post and poll text | building |  | While Mark writes a POST or POLL Artifact, its commentary appears in the conversation as it is written, in a preview that the finished artifact replaces. A Zod repair or a retry clears the preview and it starts again.<br>_Built but shipped off: STREAM_POST_COMMENTARY defaults to false on the worker. Before switching it on, verify the POST and POLL models stream with json_schema and requireParameters on OpenRouter. Set live (with since and a changelog entry) only once it is on in production._ |  | #238, [artifact-generation-performance-plan.md](../../apps/api/docs/artifact-generation-performance-plan.md), [runs.md](../../apps/api/docs/api/runs.md) |

### Documents

| Id | Feature | Status | Date | What it does | Landing; plans | Links |
| --- | --- | --- | --- | --- | --- | --- |
| `custom-design-systems` | Create a Design System | planned |  | Users create a Design System of their own and use it for one-pagers and carousels, alongside the six app-owned ones. | board | #204, [document-generation-spec.md](../../apps/api/docs/document-generation-spec.md) |

### Insights

| Id | Feature | Status | Date | What it does | Landing; plans | Links |
| --- | --- | --- | --- | --- | --- | --- |
| `post-analytics` | Post analytics | planned |  | Impressions and engagement for published posts, pulled from LinkedIn, inside Marquill.<br>_No issue yet. Open one when work starts._ | board | [LINKEDIN_ORGANIZATION_ANALYTICS_RESEARCH.md](../../apps/api/docs/LINKEDIN_ORGANIZATION_ANALYTICS_RESEARCH.md) |

## Ideas

### Creation

| Id | Feature | Status | Date | What it does | Landing; plans | Links |
| --- | --- | --- | --- | --- | --- | --- |
| `comment-generator` | Comment generator | idea | 2026-04-09 | Paste a LinkedIn post and Mark drafts a comment for it, posted from the app.<br>_Discussed: Filed through in-app feedback._ |  | #146 |

### Research

| Id | Feature | Status | Date | What it does | Landing; plans | Links |
| --- | --- | --- | --- | --- | --- | --- |
| `trending-topics` | Trending topics | idea | 2026-01-16 | Find topics trending on Reddit, X, Google and elsewhere that match the user's interests.<br>_Discussed: Opened as an issue._ |  | #78 |
| `research-social-sources` | YouTube and Reddit research | idea | 2026-10-17 | Add YouTube videos and Reddit threads as research sources alongside web search. The legacy Mark engine had this; the artifact workflow does not.<br>_Discussed: Found while building the ledger: the landing page claimed it but the workflow only searches the web._ |  |  |

### Insights

| Id | Feature | Status | Date | What it does | Landing; plans | Links |
| --- | --- | --- | --- | --- | --- | --- |
| `linkedin-groups` | Relevant LinkedIn groups | idea | 2026-04-09 | Suggest LinkedIn groups related to the user's topics, since group members drive early engagement.<br>_Discussed: Filed through in-app feedback._ |  | #147 |

### Billing

| Id | Feature | Status | Date | What it does | Landing; plans | Links |
| --- | --- | --- | --- | --- | --- | --- |
| `paypal` | PayPal subscriptions | idea | 2026-02-06 | Pay for a plan with PayPal, behind a payment provider abstraction.<br>_Discussed: Opened as issues._ |  | #90, #91 |

### Workspace

| Id | Feature | Status | Date | What it does | Landing; plans | Links |
| --- | --- | --- | --- | --- | --- | --- |
| `notification-preferences` | Notification and timezone preferences | idea | 2026-07-17 | A reminder before a scheduled post publishes, and an explicit timezone setting. Settings shows both as unavailable today.<br>_Discussed: Placeholders added to the Settings redesign; the api has no endpoints for them._ |  |  |
| `whats-new` | What's new in the app | idea | 2026-10-17 | Show recent changelog entries inside the web app, read from this ledger.<br>_Discussed: Proposed with the product ledger._ |  |  |
| `public-changelog-page` | Changelog page and feed | idea | 2026-10-17 | A full /changelog page and an RSS feed on the landing site, generated from this ledger.<br>_Discussed: Proposed with the product ledger._ |  |  |

## Changelog

| Date | Feature | Entry | Published |
| --- | --- | --- | --- |
| 2026-10-15 | `design-system-picker` | **Swatch menu with hover preview**: Hover over a Design System to preview it before you pick. | yes |
| 2026-10-15 | `design-systems` | **Design Systems for documents**: Six designed systems for one-pagers and carousels, chosen per document. | yes |
| 2026-10-14 | `document-refine-from-source` | **Refine a document from its source**: Mark edits the document he already made, so the parts you liked stay put. | yes |
| 2026-08-06 | `polls` | **Polls**: Ask Mark for a poll and publish it as a native LinkedIn poll. | yes |
| 2026-08-06 | `documents` | **Documents**: One-pagers and carousels, rendered to PDF and published as a LinkedIn document. | yes |
| 2026-07-18 | `run-progress` | **Live progress**: Watch each step as Mark researches, writes, and renders. | yes |
| 2026-06-11 | `scheduling` | **Schedule in plain words**: Type “next Tuesday 9am” and Mark schedules the post. | yes |
| 2026-04-19 | `post-media` | **Images and video**: Attach several images or one video to a post. | yes |
| 2026-04-14 | `company-pages` | **Company pages**: Connect a LinkedIn company page and publish to it on a schedule. | yes |
