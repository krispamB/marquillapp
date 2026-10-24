import { ArtifactType } from 'src/database/schemas';
import type { ResearchInput } from '../agent-runner.interface';

// The research agent is fully autonomous: there is nowhere to deliver a
// clarifying question in the fire-and-forget run model, so the system prompt
// tells it to self-direct its own queries and, when it has enough, stop calling
// the tool and write the synthesis directly. That final tool-free turn is the
// `findings` string GENERATE consumes.
export const RESEARCH_SYSTEM_PROMPT = `ROLE:
You are a research assistant gathering current, factual material for a LinkedIn
content writer. You have one tool, "searchWeb", and full autonomy over how you
use it.

METHOD:
- Break the brief into the specific things worth verifying, then search for them.
- Run several searches with progressively refined queries. Do not settle for a
  single query; a topic usually needs a few angles.
- If a search returns an { error } or unhelpful results, adapt the query and try
  again rather than giving up.
- You cannot ask the user anything — decide what to research yourself.

WHEN YOU HAVE ENOUGH:
Stop calling the tool and reply with prose only — no tool call. Your final reply
is a tight synthesis of what you found: the concrete facts, figures, and framings
a writer can build a post on. Do not paste raw search results, do not list URLs,
and do not describe your process. Write the findings, nothing else.`;

export function researchSystemPrompt(): string {
  return RESEARCH_SYSTEM_PROMPT;
}

/**
 * A switch rather than a module-scope lookup table: the enum is read when a
 * prompt is asked for, not when this module loads, so importing it never depends
 * on the schema barrel having been fully evaluated.
 */
function audienceHint(type: ArtifactType): string {
  switch (type) {
    case ArtifactType.POLL:
      return 'a LinkedIn poll with a question and options';
    case ArtifactType.DOCUMENT:
      return 'a LinkedIn document (a multi-page PDF)';
    default:
      return 'a single LinkedIn text post';
  }
}

export function researchUserPrompt(input: ResearchInput): string {
  return `BRIEF:\n${input.prompt}\n\nThe writer will turn your findings into ${audienceHint(input.type)}. Research the topic and report what you find.`;
}

// Snippet research (RESEARCH_MODE=snippets, plan M7.2): the model only plans
// the searches. Their raw excerpts go straight to GENERATE, unread.
export const SNIPPET_QUERIES_SYSTEM_PROMPT = `ROLE:
You plan web searches for a LinkedIn content writer. You do not search or
write anything yourself.

TASK:
Read the brief and write 1 to 4 web search queries whose results would give
the writer current, concrete facts, figures and examples for it.
- Each query covers a different angle; do not repeat one in other words.
- Write queries the way a person types them into a search engine: specific
  keywords, no full sentences, no instructions.
- Use fewer queries for a narrow brief.

Answer with JSON {"queries": [...]} only.`;

export function snippetQueriesSystemPrompt(): string {
  return SNIPPET_QUERIES_SYSTEM_PROMPT;
}

export function snippetQueriesUserPrompt(input: ResearchInput): string {
  return `BRIEF:\n${input.prompt}\n\nThe writer will turn the search results into ${audienceHint(input.type)}. Write the search queries.`;
}
