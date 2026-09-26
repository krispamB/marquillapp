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
      return 'a LinkedIn carousel (multi-slide document)';
    default:
      return 'a single LinkedIn text post';
  }
}

export function researchUserPrompt(input: ResearchInput): string {
  return `BRIEF:\n${input.prompt}\n\nThe writer will turn your findings into ${audienceHint(input.type)}. Research the topic and report what you find.`;
}
