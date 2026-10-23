import {
  migrateArtifactLibraryIndex,
  type ArtifactIndexCollection,
  type ArtifactIndexInfo,
} from './artifact-library-index-migration';

const LIBRARY_KEY = { user: 1, updatedAt: -1, _id: -1 };

const makeCollection = (startingIndexes: ArtifactIndexInfo[]) => {
  const indexes = structuredClone(startingIndexes);
  const createIndex = jest.fn(
    (key: Record<string, number>, options: Record<string, unknown>) => {
      indexes.push({ name: String(options.name), key });
      return Promise.resolve(String(options.name));
    },
  );
  const collection = {
    listIndexes: jest.fn(() => Promise.resolve(structuredClone(indexes))),
    createIndex,
  } satisfies ArtifactIndexCollection;
  return { collection, createIndex };
};

describe('migrateArtifactLibraryIndex', () => {
  it('should report the index to create without writing during a dry run', async () => {
    const harness = makeCollection([{ name: '_id_', key: { _id: 1 } }]);

    const result = await migrateArtifactLibraryIndex(harness.collection, {
      apply: false,
    });

    expect(result).toEqual({ applied: false, created: false });
    expect(harness.createIndex).not.toHaveBeenCalled();
  });

  it('should create the library index when applying and it is missing', async () => {
    const harness = makeCollection([{ name: '_id_', key: { _id: 1 } }]);

    const result = await migrateArtifactLibraryIndex(harness.collection, {
      apply: true,
    });

    expect(result).toEqual({ applied: true, created: true });
    expect(harness.createIndex).toHaveBeenCalledWith(LIBRARY_KEY, {
      name: 'artifact_user_updated_at_id',
    });
  });

  it('should be a no-op when the index already exists', async () => {
    const harness = makeCollection([
      { name: 'artifact_user_updated_at_id', key: LIBRARY_KEY },
    ]);

    const result = await migrateArtifactLibraryIndex(harness.collection, {
      apply: true,
    });

    expect(result).toEqual({ applied: true, created: false });
    expect(harness.createIndex).not.toHaveBeenCalled();
  });

  it('should treat the same key under another name as already built', async () => {
    const harness = makeCollection([
      { name: 'user_1_updatedAt_-1__id_-1', key: LIBRARY_KEY },
    ]);

    await migrateArtifactLibraryIndex(harness.collection, { apply: true });

    expect(harness.createIndex).not.toHaveBeenCalled();
  });

  it('should refuse when the name is taken by a different key', async () => {
    const harness = makeCollection([
      { name: 'artifact_user_updated_at_id', key: { user: 1 } },
    ]);

    await expect(
      migrateArtifactLibraryIndex(harness.collection, { apply: true }),
    ).rejects.toThrow('unexpected definition');
    expect(harness.createIndex).not.toHaveBeenCalled();
  });
});
