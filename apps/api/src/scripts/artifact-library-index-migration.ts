import {
  ARTIFACT_LIBRARY_INDEX_KEY,
  ARTIFACT_LIBRARY_INDEX_NAME,
} from '../database/schemas/artifact.schema';

export type ArtifactIndexInfo = {
  name: string;
  key: Record<string, unknown>;
};

export type ArtifactIndexCollection = {
  listIndexes: () => Promise<ArtifactIndexInfo[]>;
  createIndex: (
    key: Record<string, number>,
    options: Record<string, unknown>,
  ) => Promise<string>;
};

export type ArtifactLibraryIndexResult = {
  applied: boolean;
  created: boolean;
};

const noopLogger = () => undefined;

/**
 * Builds the artifact library index. Run it against production before the
 * schema declaration deploys, so the app never builds the index at boot.
 * Safe to re-run: an index with the same key is left alone.
 */
export async function migrateArtifactLibraryIndex(
  collection: ArtifactIndexCollection,
  options: { apply: boolean; log?: (message: string) => void },
): Promise<ArtifactLibraryIndexResult> {
  const log = options.log ?? noopLogger;
  const indexes = await collection.listIndexes();

  const named = indexes.find(
    (index) => index.name === ARTIFACT_LIBRARY_INDEX_NAME,
  );
  if (named && !hasLibraryKey(named)) {
    throw new Error(
      `Index ${ARTIFACT_LIBRARY_INDEX_NAME} exists with an unexpected definition; refusing to modify it.`,
    );
  }

  if (named || indexes.some(hasLibraryKey)) {
    log('Artifact library index already exists.');
    return { applied: options.apply, created: false };
  }

  if (!options.apply) {
    log(`Dry run: create [${ARTIFACT_LIBRARY_INDEX_NAME}].`);
    return { applied: false, created: false };
  }

  await collection.createIndex(
    { ...ARTIFACT_LIBRARY_INDEX_KEY },
    { name: ARTIFACT_LIBRARY_INDEX_NAME },
  );
  log(`Created ${ARTIFACT_LIBRARY_INDEX_NAME}.`);
  return { applied: true, created: true };
}

// Key order is part of the definition, so compare entries in sequence.
function hasLibraryKey(index: ArtifactIndexInfo): boolean {
  const actual = Object.entries(index.key);
  const expected = Object.entries(ARTIFACT_LIBRARY_INDEX_KEY);
  return (
    actual.length === expected.length &&
    actual.every(
      ([field, direction], position) =>
        field === expected[position][0] && direction === expected[position][1],
    )
  );
}
