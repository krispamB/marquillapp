# LinkedIn dwell time, saves, and AI-content detection

What LinkedIn penalizes in AI-generated content, what it rewards, and how both changed the artifact generation prompts in `src/agent/prompts/artifact-generation.prompts.ts`.

Researched on 2026-10-31. Each finding has a label:

- **Official**: a LinkedIn statement, from LinkedIn's site or a LinkedIn executive quoted in the press.
- **Third-party**: data or observation from an analytics vendor or publication.
- **Speculative**: commentary with no data, or an inference.

LinkedIn does not publish its ranking weights. Anything more precise than "LinkedIn reduces generic content and engagement bait" is third-party or speculative, and the prompts treat it as a reasonable proxy rather than a rule.

## Findings

### 1. LinkedIn reduces generic, AI-sounding content

- **Official.** On 12 Mar 2026 LinkedIn rebuilt the feed on LLM-based generative recommenders. It said it would reduce "repetitive, low-substance posts and engagement bait", recycled and click-driven posts, engagement pods and comment automation, and favor "genuine insight, actionable ideas, and thoughtful perspectives". ([LinkedIn News](https://news.linkedin.com/2026/ImprovingTheFeed))
- **Official, via press.** In May 2026 Laura Lorenzetti (VP, Executive Editor) said: "It's ok to use AI to help you write, but your posts and comments need to represent your voice and your perspectives." Generic AI content that lacks a distinct human perspective gets less reach, often staying inside first-degree connections. Posts aren't deleted. The classifier is trained on human-labeled "generic vs original" posts. ([Entrepreneur](https://www.entrepreneur.com/business-news/linkedin-is-fighting-back-against-ai-slop-and-ai-comments))
- **Official, via press.** On 30 Jul 2026 LinkedIn added a "Seems like AI slop" menu option that works like "not interested". LinkedIn reported more than 1M clicks in two weeks and a 40% drop in views of content it classifies as slop. It also replaced the "enhance your post" AI rewrite with a proofreader. Authors see a Post Analytics notice when a post is flagged. ([Superpower Daily](https://superpowerdaily.com/posts/linkedin-details-ai-slop-crackdown-after-a-million-users-flag-posts), [Depost](https://depost.ai/blog/linkedin-ai-slop))
- **Third-party.** Originality.ai estimated that 54% of long LinkedIn posts were likely AI-written, and that likely-AI posts got about 45% less engagement. It is a vendor study using the vendor's own detector. ([Originality.ai](https://originality.ai/blog/ai-content-published-linkedin))
- **Speculative.** LinkedIn names no stylistic tells. Its stated target is the lack of a point of view and of lived experience. The usual lists of tells (em dashes, "It's not X, it's Y", forced triads, tidy closing morals, emoji-bullet walls, hashtag stuffing) come from commentators. They are still good proxies for "generic", and readers who click the slop button react to them.

### 2. Engagement bait

- **Official.** "Comment to agree" prompts, engagement pods, comment automation and fake-conversation tools are reduced (March 2026 announcement above).
- **Third-party / speculative.** "Comment X to get the PDF" gates and first-comment links are widely said to cost reach. No official figure exists. "Agree?", "Thoughts?" and "Like if..." fall under "comment to agree", and they are also the generic-ending tell.

### 3. Polls

- **Third-party.** AuthoredUp (March 2025 to February 2026): polls have the highest reach multiplier (1.78x the profile median) and the lowest engagement. Specific, niche questions outperformed generic and yes/no ones. Four options, context text above the poll and a 3-day duration worked best. ([AuthoredUp](https://authoredup.com/blog/linkedin-polls))
- **Official, older / speculative.** LinkedIn said in 2023 that it would show fewer polls used as engagement bait. A poll that only farms votes ("Which is better?") fits the 2026 engagement-bait category.

### 4. Carousels (document posts)

- **Third-party.** Document reach fell about 43% between mid-2024 and mid-2025, but carousels still reach 1.39x the baseline, compared with 1.07x for text. ([AuthoredUp](https://authoredup.com/blog/linkedin-360brew))
- **Third-party, weak.** Completion rate and save rate are what practitioners track. Recommended slide counts range from 5 to 15, with no rigorous study behind them. ([Socialinsider](https://www.socialinsider.io/blog/linkedin-carousel/))
- **Speculative.** Likely low-effort signals: generic template text, one idea stretched across many slides, no concrete data or example, and a "comment for the PDF" gate.

### 5. Dwell time and saves

- **Official.** Ranking uses each member's long interaction history and professional signals. LinkedIn has described skip and dwell-time models since 2020 and now shows saves in post analytics. It publishes no weights. ([VentureBeat](https://venturebeat.com/orchestration/how-linkedin-replaced-five-feed-retrieval-systems-with-one-llm-model-at-1-3))
- **Third-party.** A save is said to drive about 5x the reach of a like and 2x a comment. Long, substantive comments outrank quick reactions. Hashtags matter little. (AuthoredUp, above)
- **Speculative.** That the first two lines above "see more" decide dwell, and specific dwell-time thresholds such as 61 seconds, have no primary source. The "see more" fold is real, though, and a reader who doesn't expand the post adds no dwell time.

### 6. Expertise

- **Official.** LinkedIn uses LLMs to understand post topics and matches them against profile details and engagement history. It favors "knowledge and advice" content.

## How the prompts changed

The three prompts now share a `FEED RULES` block (`LINKEDIN_FEED_RULES`), and each prompt has its own format rules for dwell time and saves.

### Shared `FEED RULES` (post, poll, document)

| Rule | Why |
| --- | --- |
| Give the reader something to save: a checklist, numbered steps, a named framework, a specific tool and what it's for, or a sourced number | Saves are reported as the strongest signal (finding 5). Matches LinkedIn's stated preference for "actionable ideas" (finding 1). |
| Be specific, one idea per post, take a defensible position | LinkedIn's classifier targets generic content with no point of view (finding 1). |
| Lead with the author's experience when the brief gives it, and never invent any | "Represent your voice and your perspectives" (finding 1). Inventing experience is still forbidden, as it was before. |
| No engagement bait: "Agree?", "Thoughts?", "Like if...", comment-for-link gates, tagging | Officially reduced (finding 2). |
| Avoid the listed AI tells, including em dashes, "It's not X, it's Y", reflexive triads, rhetorical openers, emoji bullets, tidy morals and more than 3 hashtags | Proxies for "generic" that readers react to with the slop button (finding 1, speculative). The old post prompt banned only em dashes and "not just X, but Y"; polls and documents now get the same list. |

### Post

- **Hook above the fold.** The first two lines must state a specific claim, number, result or situation. No throat-clearing and no rhetorical question. (Finding 5.)
- **Scannable layout.** Paragraphs of one to three sentences with blank lines between them. A single-sentence line can land a key point, but not every line: post-wide one-line-per-sentence "broetry" is itself a known tell. This is how the prompt reconciles scannability with finding 1.
- **A list carries the value.** Numbered steps, a checklist or a 3-7 item framework, with plain markers instead of emojis. This is what makes a post worth saving.
- **Length 150-300 words.** Long enough to hold attention, with no padding. Speculative target.
- **Closing.** One takeaway, or a specific question the author would really want answered. The old "close with a takeaway" rule invited the tidy moral, so the question is now optional and the generic one is banned.
- **No links** unless the brief asks for one (finding 2, speculative).

### Poll

- **Commentary is always written.** Previously it was optional. It now gives context and stakes, the author's take or the options explained, and what happens with the results, so the post has value for someone who doesn't vote. This is where dwell time for a poll comes from.
- **Niche, specific question.** No generic yes/no and no "Which is better?" (finding 3).
- **Four options preferred**, with "Something else" as the last option when the set can't be exhaustive. This replaces the old "collectively exhaustive" rule, which pushed toward bland options.
- **Default duration of 3 days**, previously 7 in the example (finding 3).

### Document (carousel)

- **Built to be saved.** A framework, checklist, template, before-and-after or tool list, with one idea and one concrete detail per page (findings 4 and 5).
- **Specific cover.** The cover states what the reader will be able to do, not a topic label.
- **Numbered steps and no filler pages**, so each page earns the swipe. This aims at completion rate (finding 4). The page count is still set by the Design System.
- **Recap page at the end**, for screenshots and saves. No "comment for the PDF" page and no "follow for more" page (finding 2).
- **Short commentary.** Two to four short paragraphs with a specific opener and no bait.

## Not changed

- Output contracts, schema limits and the HTML/CSS rules are unchanged.
- The VOICE and RESEARCH grounding rules are unchanged. VOICE still has top priority for tone, so a style preset can override the default rhythm.
- The token figures in [artifact-prompt-token-budget.md](artifact-prompt-token-budget.md) are now stale: each prompt grew by the `FEED RULES` block and its own new rules. Re-run `src/scripts/prompt-token-report.ts` to refresh them.

## Checking the effect

Use the [text eval runbook](text-eval-runbook.md) and the [document eval runbook](document-eval-runbook.md) to compare drafts before and after. Production signals to watch, from LinkedIn post analytics: saves, "see more" expansions where available, and any "flagged by community feedback" notices.
