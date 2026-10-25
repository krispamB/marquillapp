/** The artifact types whose generation model can be set on its own. */
export type TextArtifactType = 'POST' | 'POLL';

export type TextGenerationModels = Record<TextArtifactType, string>;

type ReadKey = (key: string) => string | number | null | undefined;

const text = (raw: string | number | null | undefined): string =>
  raw === undefined || raw === null ? '' : String(raw).trim();

/**
 * The model for POST and POLL generation (and their Zod repair turn):
 * `POST_GENERATION_MODEL` / `POLL_GENERATION_MODEL`, each falling back to
 * `GENERATION_MODEL` (passed in, already required) when unset or blank.
 */
export const resolveTextGenerationModels = (
  generationModel: string,
  read: ReadKey,
): TextGenerationModels => {
  const base = generationModel;
  return {
    POST: text(read('POST_GENERATION_MODEL')) || base,
    POLL: text(read('POLL_GENERATION_MODEL')) || base,
  };
};
