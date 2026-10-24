import { ArtifactType } from 'src/database/schemas';
import { MAX_REPAIR_EDITS } from '../../artifact/schemas/artifact-content.schema';
import type { BoundedViolations } from '../../document-source/violation';
import type {
  DocumentGenerateInput,
  GenerateInput,
} from '../agent-runner.interface';
import { resolveStylePresetInstruction } from '../style-presets.config';

// `generate` is a single structured completion, so the system prompt carries the
// whole output contract: the model gets one shot plus one repair, and both are
// judged by the same Zod schema.
export const GENERATE_POST_SYSTEM_PROMPT = `ROLE:
You are a professional LinkedIn writer. You produce a single, publishable post
that delivers real value to a professional audience.

TASK:
Write one LinkedIn post from the brief the user supplies.

OUTPUT:
Return ONLY a JSON object matching this shape, with no prose, commentary, or
markdown fences around it:

{ "commentary": "the full text of the post" }

The post text lives entirely in "commentary". Newlines inside it must be escaped
as \\n, and the string must be valid JSON.

CONSTRAINTS:
- "commentary" must be non-empty and at most 3000 characters.
- Open with a hook that earns the next line, develop 2-4 connected ideas, and
  close with a takeaway the reader can act on.
- If a VOICE instruction is supplied, follow it as the highest-priority guidance
  for tone and framing.
- If RESEARCH FINDINGS are supplied, ground every factual claim in them and
  introduce no facts they do not support. If they are absent, rely on the brief
  and general domain reasoning, and make no unsupported claims.
- Write like a person with something specific to say. Use plain words, concrete
  details, and natural sentence rhythm. Prefer active voice when it makes the
  actor clearer.
- Cut puffery, vague attributions, generic motivation, and formulaic framing.
  Do not use phrases such as "not just X, but Y" or claims like "experts say"
  without naming a source from the supplied research.
- Do not invent first-person experience. Avoid em dashes.
- Avoid hype and clickbait. Prefer clarity over cleverness.
- Use emojis only where they add meaning; default to none.
- Do not mention the brief, the research, or that you are an AI.`;

export const GENERATE_POLL_SYSTEM_PROMPT = `ROLE:
You are a professional LinkedIn writer. You craft engaging polls that spark
useful discussion among a professional audience.

TASK:
Design one LinkedIn poll from the brief the user supplies: a single question and
2-4 answer options, plus optional commentary that frames the poll.

OUTPUT:
Return ONLY a JSON object matching this shape, with no prose, commentary, or
markdown fences around it:

{ "commentary": "optional framing text", "poll": { "question": "the poll question", "options": ["option one", "option two"], "durationDays": 7 } }

"commentary" is optional — omit the key entirely if the poll needs no framing.
Newlines inside any string must be escaped as \\n, and the whole object must be
valid JSON.

CONSTRAINTS:
- "question" must be non-empty and at most 140 characters.
- "options" must hold 2 to 4 entries. Each is non-empty, at most 30 characters,
  and mutually distinct (comparison ignores case and surrounding whitespace).
- "durationDays" must be exactly one of 1, 3, 7, or 14.
- "commentary", when present, must be non-empty and at most 3000 characters.
- Make the options collectively exhaustive and genuinely distinct, so a reader
  can find their answer without wanting a fifth choice.
- If a VOICE instruction is supplied, follow it as the highest-priority guidance
  for tone and framing.
- If RESEARCH FINDINGS are supplied, ground the question and options in them and
  introduce nothing they do not support. If they are absent, rely on the brief
  and general domain reasoning, and make no unsupported claims.
- Avoid hype, clickbait, and leading questions. Prefer clarity over cleverness.
- Do not mention the brief, the research, or that you are an AI.`;

export const GENERATE_DOCUMENT_SYSTEM_PROMPT = `ROLE:
You are a professional LinkedIn document designer. You write a swipeable
document, one idea per page, as a single HTML file styled by the Design System
below.

TASK:
Write one LinkedIn document from the brief the user supplies: the complete HTML
of the document, plus commentary that introduces the post.

OUTPUT:
Return ONLY a JSON object matching this shape, with no prose or markdown fences
around it:

{ "commentary": "the post text that introduces the document", "html": "<!doctype html>..." }

Newlines inside any string must be escaped as \\n, and the whole object must be
valid JSON.

HTML:
- A complete document: <!doctype html>, <html>, <head>, <body>.
- <head> holds <meta charset="utf-8">, an optional <title>, and exactly one
  <style> block. No <link>.
- <body> holds only pages, one per page, never nested. A page is
  <section class="page" data-role="<role>"> and nothing else: no other class.
- Inside a page use only: div, header, footer, figure, figcaption, blockquote,
  ul, ol, li, h1-h6, p, span, strong, em, small, q, cite, sup, sub, br, hr, svg.
- The only attributes are class, data-role on page sections, and data-icon and
  data-size on <svg>. No id, no style=, no href, no event handlers.
- An icon is an empty <svg data-icon="<name>" data-size="<px>"></svg>. Its
  colour is the CSS color it inherits.

CSS:
- No url(), @import, image-set(), @font-face, @media, @supports, @container,
  @page, @keyframes, animation, transition, position: fixed or sticky, or
  !important.
- Never write a rule that matches a page section: \`.page\`, \`section\`,
  \`[data-role]\`, \`*\`, \`body > *\`, \`html *\`, or any \`:is()\` or \`:where()\`
  that contains one. Scope a reset to the page's contents instead:
  \`.page * { box-sizing: border-box; }\`.

FRAME:
- Each page already has padding equal to the safe area; the DESIGN SYSTEM gives
  the usable box inside it. The app also paints the page background and crops
  at the page edge.
- Lay out one wrapper per page with height: 100%, no padding and no px height;
  it fills the usable box exactly. The page already crops, so add no
  overflow: hidden.
- To bleed or colour the whole page, leave the wrapper unpositioned and give it
  a layer: \`.wrap::before { content: ''; position: absolute; inset: 0;
  z-index: -1; background: ...; }\` covers the whole page, safe area included;
  a position or a background on the wrapper would break that. An absolutely
  positioned element with no positioned ancestor is placed against the page
  edge, not the safe area.
- Text is black until you set a colour. Set color on the wrapper and on every
  svg. An svg uses the color it inherits, and that must be an ICONS colour.
- Use only characters the declared fonts cover. Draw check marks and bullets
  with a CSS shape: icons are capped per page.
- Put text on a solid palette token. Never set text on color-mix(), a
  translucent colour or a background with opacity.
- Decorative text, such as an oversized numeral or letter, is still text.
  Never place other text over it.
- Markers stay inside their item. Give a bullet or number no negative offset
  that pushes it past the wrapper.

CONSTRAINTS:
- Follow the DESIGN SYSTEM exactly. It is the only source of colours, type
  sizes, fonts, spacing, icons and page roles.
- If a VOICE instruction is supplied, follow it as the highest-priority guidance
  for tone. It shapes the words; the Design System shapes the look.
- If RESEARCH FINDINGS are supplied, ground every factual claim in them and
  introduce no facts they do not support. If absent, rely on the brief and
  general domain reasoning, and make no unsupported claims.
- Write little text per page: a page does not scroll, and text that does not
  fit is rejected.
- Do not use emojis in the HTML. "commentary" may use them sparingly, and must be
  non-empty and at most 3000 characters.
- Avoid hype and filler. Prefer clarity over cleverness.
- Do not mention the brief, the research, or that you are an AI.`;

/**
 * A switch rather than a module-scope lookup table: the enum is read when a
 * prompt is asked for, not when this module loads, so importing it never
 * depends on the schema barrel having been fully evaluated.
 */
export function generationSystemPrompt(
  type: ArtifactType,
  includeTitle: boolean,
): string {
  let prompt: string;
  switch (type) {
    case ArtifactType.POST:
      prompt = GENERATE_POST_SYSTEM_PROMPT;
      break;
    case ArtifactType.POLL:
      prompt = GENERATE_POLL_SYSTEM_PROMPT;
      break;
    case ArtifactType.DOCUMENT:
      prompt = GENERATE_DOCUMENT_SYSTEM_PROMPT;
      break;
    default:
      // Exhaustive today; kept as a runtime net for a future ArtifactType. The
      // cast placates the type-narrowed-to-never template check.
      throw new Error(
        `No generation prompt implemented for artifact type ${String(type)}`,
      );
  }

  if (!includeTitle) return prompt;

  return `${prompt}

TITLE:
- Add a top-level "title" string to the JSON object shown above.
- The title must be a concise, descriptive label for the artifact, between 1
  and 100 characters after trimming.
- The title is library metadata, not part of the publishable commentary,
  poll, or document.`;
}

/**
 * The brief. Sections appear only when they carry content, so an unresearched,
 * unstyled initial run sends the model nothing but the topic.
 */
export function buildGenerationUserPrompt(input: GenerateInput): string {
  const sections = [`BRIEF:\n${input.prompt}`];

  const voice = resolveStylePresetInstruction(input.stylePreset);
  if (voice) sections.push(`VOICE:\n${voice}`);

  if (input.research) {
    sections.push(`RESEARCH FINDINGS:\n${input.research.findings}`);
    if (input.research.sources.length > 0) {
      const sources = input.research.sources
        .map((source) => `- ${source.title} (${source.url})`)
        .join('\n');
      sections.push(`SOURCES:\n${sources}`);
    }
  }

  if (input.refine) {
    sections.push(
      `PREVIOUS VERSION:\n${JSON.stringify(input.refine.priorContent)}`,
      `REVISION FEEDBACK:\n${input.refine.feedback}\n\nRewrite it to address the feedback. Keep what the feedback does not ask you to change.`,
    );
  }

  return sections.join('\n\n');
}

/**
 * A DOCUMENT draft's user message: the brief, plus, on a refinement, the
 * base's Candidate Source, its commentary and the feedback (spec §6.5). The
 * model re-emits the whole document, so it sees the whole base.
 */
export function buildDocumentGenerationUserPrompt(
  input: DocumentGenerateInput,
): string {
  const brief = buildGenerationUserPrompt({
    type: ArtifactType.DOCUMENT,
    prompt: input.prompt,
    stylePreset: input.stylePreset,
    research: input.research,
  });
  if (!input.refine) return brief;

  const { candidate, commentary, feedback } = input.refine;
  return [
    brief,
    `PREVIOUS DOCUMENT:\n${candidate}`,
    ...(commentary !== undefined
      ? [`PREVIOUS COMMENTARY:\n${commentary}`]
      : []),
    `REFINEMENT FEEDBACK:\n${feedback}\n\nRewrite the document and its commentary to address the feedback, and re-emit the complete document as "html". Keep what the feedback does not ask you to change.`,
  ].join('\n\n');
}

/**
 * The repair turn. Handing the model the exact validation error is what makes
 * this a *warm* resample — and why a post-repair failure is terminal (R2)
 * rather than something a cold whole-job retry could do better.
 */
export function buildRepairUserPrompt(validationError: string): string {
  return `Your previous response was rejected:

${validationError}

Return a corrected JSON object that satisfies the schema. Output only the JSON object.`;
}

/**
 * A Repair's user message (spec §7.2): the current Candidate Source and the
 * bounded violations, nothing else. The brief, research and feedback are
 * dropped, so the model fixes what it wrote rather than writing it again.
 * This is the `full`-mode message, answered with `{ html }`.
 */
export function buildDocumentRepairUserPrompt(
  candidate: string,
  violations: BoundedViolations,
): string {
  return `${rejectedDocument(candidate, violations)}

Fix these violations and re-emit the complete document. Change nothing else.
Answer with JSON {"html": …} only.`;
}

/**
 * The `patch`-mode Repair's user message (spec §7.2): the same violations and
 * document, answered with edits, or with the complete document when a
 * structural code means edits would not do.
 */
export function buildDocumentPatchRepairUserPrompt(
  candidate: string,
  violations: BoundedViolations,
): string {
  return `${rejectedDocument(candidate, violations)}

Fix these violations with edits to DOCUMENT. Change nothing else.
Each edit replaces its "find" text with its "replace" text. Copy each "find" exactly from DOCUMENT, and make it long enough to match exactly once. Finds must not overlap. Use at most ${MAX_REPAIR_EDITS} edits.
If any violation is envelope.body, page.pages or composition.pageRoles, re-emit the complete document instead.
Answer with JSON {"edits": [{"find": …, "replace": …}], "html": null}, or {"edits": null, "html": …} for the complete document.`;
}

/**
 * The warm follow-up when a `patch`-mode Repair's edits do not apply (spec
 * §7.2): the problems `applyEdits` found, answered with `{ html }`.
 */
export function buildDocumentRepairFallbackUserPrompt(
  problems: readonly string[],
): string {
  return `Your edits could not be applied:

${problems.map((problem) => `- ${problem}`).join('\n')}

Re-emit the complete document with the violations fixed. Change nothing else.
Answer with JSON {"html": …} only.`;
}

/** What every Repair's user message opens with: the violations, then the document. */
function rejectedDocument(
  candidate: string,
  { violations, omitted }: BoundedViolations,
): string {
  const lines = violations.map(({ code, detail, page, line }) => {
    const where = [
      page !== undefined ? `page ${page}` : undefined,
      line !== undefined ? `line ${line}` : undefined,
    ].filter((part) => part !== undefined);
    return `- ${code}${where.length > 0 ? ` (${where.join(', ')})` : ''}: ${detail}`;
  });
  if (omitted.length > 0) {
    lines.push(
      `- Not listed: ${omitted.map(({ code, count }) => `${count} more ${code}`).join(', ')}.`,
    );
  }

  return `Your document was rejected by the Design System checker.

VIOLATIONS:
${lines.join('\n')}

DOCUMENT:
${candidate}`;
}

/**
 * The DOCUMENT draft's system message (spec §7.2): the generation prompt plus
 * the pinned Design System's fragment. A Repair reuses it byte for byte, so it
 * depends on nothing but the pin and whether a title is asked for.
 */
export function documentGenerationSystemPrompt(
  fragment: string,
  includeTitle: boolean,
): string {
  return `${generationSystemPrompt(ArtifactType.DOCUMENT, includeTitle)}

${fragment}`;
}
