import { ARTIFACT_LIBRARY_INDEX_NAME, ArtifactSchema } from './artifact.schema';

describe('ArtifactSchema', () => {
  it('should declare the library index on user, updatedAt descending, _id descending', () => {
    const index = ArtifactSchema.indexes().find(
      ([, options]) => options.name === ARTIFACT_LIBRARY_INDEX_NAME,
    );

    expect(index?.[0]).toEqual({ user: 1, updatedAt: -1, _id: -1 });
  });
});
