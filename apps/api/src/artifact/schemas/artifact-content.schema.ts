import { z } from 'zod';
import { ArtifactType } from 'src/database/schemas';
import { linkedInCharCount } from '../utils/linkedin-char-count.util';
import { CONTENT_TITLE_MAX_LENGTH } from '../../common/constants';
import { pollOptionKey } from './dedupe-poll-options';

export const LINKEDIN_MAX_POST_CHARS = 3000;
export const LINKEDIN_MAX_POLL_QUESTION_CHARS = 140;
export const LINKEDIN_MAX_POLL_OPTION_CHARS = 30;
export const POLL_DURATION_DAYS = [1, 3, 7, 14] as const;
export const artifactTitleSchema = z
  .string()
  .trim()
  .min(1, 'title must not be empty')
  .max(
    CONTENT_TITLE_MAX_LENGTH,
    `title exceeds ${CONTENT_TITLE_MAX_LENGTH} characters`,
  );

// The commentary cap is counted the way LinkedIn counts: by UTF-16 code unit,
// so an astral-plane emoji costs 2. Shared by every arm that carries commentary.
//
// Plain checks (`.max`, `.regex`, `z.literal`) reach the strict JSON schema the
// model is constrained by, so its answer cannot break them; a `.refine` runs
// only after it answers, and a miss costs a repair turn. JSON Schema's
// `maxLength` counts code points, so an emoji-heavy answer can still overshoot;
// the LinkedIn-count refine stays as the exact gate behind each cap. `abort`
// stops at the first failed check, so a repair prompt names each miss once.
const commentarySchema = z
  .string()
  .min(1, 'commentary must not be empty')
  .max(LINKEDIN_MAX_POST_CHARS, {
    message: `commentary exceeds ${LINKEDIN_MAX_POST_CHARS} LinkedIn characters`,
    abort: true,
  })
  .refine((text) => linkedInCharCount(text) <= LINKEDIN_MAX_POST_CHARS, {
    message: `commentary exceeds ${LINKEDIN_MAX_POST_CHARS} LinkedIn characters`,
  });

// POST — text is the whole artifact.
export const postContentSchema = z.object({
  commentary: commentarySchema,
});

export type PostContent = z.infer<typeof postContentSchema>;

// POLL — an inline poll object, optionally introduced by commentary. No binary
// asset ever, so this arm never touches R2 or a render step. Its constraints
// were carried forward from the now-deleted poll.util.ts — including the
// case-insensitive, trimmed option-uniqueness rule that earlier designs omitted.
export const pollContentSchema = z.object({
  commentary: commentarySchema.optional(),
  poll: z.object({
    question: z
      .string()
      .regex(/\S/, { message: 'question must not be empty', abort: true })
      .max(LINKEDIN_MAX_POLL_QUESTION_CHARS, {
        message: `question exceeds ${LINKEDIN_MAX_POLL_QUESTION_CHARS} LinkedIn characters`,
        abort: true,
      })
      .refine(
        (text) => linkedInCharCount(text) <= LINKEDIN_MAX_POLL_QUESTION_CHARS,
        {
          message: `question exceeds ${LINKEDIN_MAX_POLL_QUESTION_CHARS} LinkedIn characters`,
        },
      ),
    options: z
      .array(
        z
          .string()
          .regex(/\S/, { message: 'option must not be empty', abort: true })
          .max(LINKEDIN_MAX_POLL_OPTION_CHARS, {
            message: `option exceeds ${LINKEDIN_MAX_POLL_OPTION_CHARS} LinkedIn characters`,
            abort: true,
          })
          .refine(
            (text) => linkedInCharCount(text) <= LINKEDIN_MAX_POLL_OPTION_CHARS,
            {
              message: `option exceeds ${LINKEDIN_MAX_POLL_OPTION_CHARS} LinkedIn characters`,
            },
          ),
      )
      .min(2, 'poll must have at least 2 options')
      .max(4, 'poll cannot have more than 4 options')
      // Strict mode cannot express this (no `uniqueItems`, and the rule is
      // case- and whitespace-insensitive), so it stays a refine.
      // `dedupePollOptions` drops exact repeats before this runs.
      .refine(
        (options) =>
          new Set(options.map(pollOptionKey)).size === options.length,
        { message: 'poll options must be unique' },
      ),
    durationDays: z.literal(
      POLL_DURATION_DAYS,
      `durationDays must be one of ${POLL_DURATION_DAYS.join(', ')}`,
    ),
  }),
});

export type PollContent = z.infer<typeof pollContentSchema>;

// DOCUMENT — a stored Document Version (spec §6.3), optionally introduced by
// commentary. Everything under `document` is written by the run: the pin is
// stamped server-side, and the HTML lives in R2 under the keys, never inline.
// The object is strict, so a template-era `templateId`/`slides` version is
// rejected rather than silently stripped. This is also the READY gate: a
// version cannot be promoted without its Document Source, its Candidate Source
// and its PDF.
const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex SHA-256 digest');
const objectKeySchema = z.string().min(1);

export const documentVersionSchema = z.strictObject({
  designSystemId: z.string().min(1),
  designSystemVersion: z.number().int().positive(),
  sourceKey: objectKeySchema,
  sourceSha256: sha256Schema,
  candidateKey: objectKeySchema,
  candidateSha256: sha256Schema,
  pdfKey: objectKeySchema,
  pageCount: z.number().int().positive(),
  coverKey: objectKeySchema.optional(),
});

export type DocumentVersion = z.infer<typeof documentVersionSchema>;

export const documentContentSchema = z.object({
  commentary: commentarySchema.optional(),
  document: documentVersionSchema,
});

/**
 * What the model writes for a DOCUMENT (§7.5): the Candidate Source as `html`,
 * and the commentary that introduces it. `title` is added on INITIAL runs.
 */
const candidateHtmlSchema = z.string().min(1, 'html must not be empty');

export const documentDraftSchema = z.object({
  commentary: commentarySchema,
  html: candidateHtmlSchema,
});

/**
 * What the model writes for a `full`-mode Repair, and for a `patch`-mode
 * Repair's fallback (§7.2): the Candidate Source alone. A Repair's title and
 * commentary would be thrown away, so it is not asked for them.
 */
export const documentRepairSchema = z.object({
  html: candidateHtmlSchema,
});

/** The most edits one patch-mode Repair may answer with (§7.2). */
export const MAX_REPAIR_EDITS = 40;

const candidateEditSchema = z.object({
  find: z.string().min(1, 'find must not be empty'),
  replace: z.string(),
});

/**
 * What the model writes for a `patch`-mode Repair (§7.2): edits to the
 * Candidate Source, or the whole of it, never both. Both fields are optional
 * here, which the provider schema turns into required-nullable and the parser
 * strips back to absent; "exactly one" cannot be said in the strict provider
 * schema, so it is checked here and a violation is an envelope validation
 * failure like any other.
 */
export const documentPatchRepairSchema = z
  .object({
    edits: z.array(candidateEditSchema).min(1).max(MAX_REPAIR_EDITS).optional(),
    html: candidateHtmlSchema.optional(),
  })
  .refine(
    ({ edits, html }) => (edits === undefined) !== (html === undefined),
    'answer with exactly one of edits and html; the other must be null',
  );

export type DocumentPatchRepair = z.infer<typeof documentPatchRepairSchema>;

export type DocumentDraft = z.infer<typeof documentDraftSchema> & {
  title?: string;
};

/** The DOCUMENT generation contract, with `title` on INITIAL runs only. */
export function documentDraftSchemaFor(
  includeTitle: boolean,
): z.ZodType<DocumentDraft> {
  return includeTitle
    ? documentDraftSchema.extend({ title: artifactTitleSchema })
    : documentDraftSchema;
}

export type DocumentContent = z.infer<typeof documentContentSchema>;

// Discriminated on the artifact's family-level `type`. POST/POLL carry text
// only; DOCUMENT adds the stored Document Version.
export type ArtifactContent = PostContent | PollContent | DocumentContent;

const contentSchemaByType: Partial<
  Record<ArtifactType, z.ZodType<ArtifactContent>>
> = {
  [ArtifactType.POST]: postContentSchema,
  [ArtifactType.POLL]: pollContentSchema,
  [ArtifactType.DOCUMENT]: documentContentSchema,
};

/**
 * The schema itself, for callers that validate raw text rather than a parsed
 * object — `AgentRunner.generate` hands it to `parseWithSchema`, which needs to
 * own the JSON.parse step so a malformed body and a schema violation reach the
 * repair retry through the same path.
 */
export function contentSchemaFor(
  type: ArtifactType,
): z.ZodType<ArtifactContent> {
  const schema = contentSchemaByType[type];
  if (!schema) {
    throw new Error(`No content schema implemented for artifact type ${type}`);
  }
  return schema;
}

/**
 * The provider-facing generation contract for POST and POLL; DOCUMENT uses
 * `documentDraftSchemaFor`. Initial generation adds a title by
 * extending the concrete content object instead of intersecting two schemas:
 * JSON-Schema structured-output providers handle a single object reliably,
 * while an `allOf` intersection is not uniformly supported.
 */
export function generationSchemaFor(
  type: ArtifactType,
  includeTitle: boolean,
): z.ZodType<ArtifactContent & { title?: string }> {
  let schema: z.ZodObject;
  switch (type) {
    case ArtifactType.POST:
      schema = postContentSchema;
      break;
    case ArtifactType.POLL:
      schema = pollContentSchema;
      break;
    default:
      throw new Error(
        `No generation schema implemented for artifact type ${String(type)}`,
      );
  }

  return (includeTitle
    ? schema.extend({ title: artifactTitleSchema })
    : schema) as unknown as z.ZodType<ArtifactContent & { title?: string }>;
}

export function parseArtifactContent(
  type: ArtifactType,
  raw: unknown,
): ArtifactContent {
  return contentSchemaFor(type).parse(raw);
}
