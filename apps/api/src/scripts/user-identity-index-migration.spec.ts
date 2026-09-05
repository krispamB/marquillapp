import {
  migrateUserIdentityIndexes,
  type UserIdentityIndexCollection,
  type UserIndexInfo,
  type UserIdentityIndexMigrationResult,
} from './user-identity-index-migration';

const legacyIndexes = (): UserIndexInfo[] => [
  { name: '_id_', key: { _id: 1 } },
  { name: 'email_1', key: { email: 1 }, unique: true },
  { name: 'googleId_1', key: { googleId: 1 }, unique: true },
  {
    name: 'clerkId_1',
    key: { clerkId: 1 },
    unique: true,
    sparse: true,
  },
];

const desiredIndexes = (): UserIndexInfo[] => [
  {
    name: 'user_google_id_unique',
    key: { googleId: 1 },
    unique: true,
    partialFilterExpression: { googleId: { $type: 'string' } },
  },
  {
    name: 'user_clerk_id_unique',
    key: { clerkId: 1 },
    unique: true,
    partialFilterExpression: { clerkId: { $type: 'string' } },
  },
];

const makeCollection = (startingIndexes: UserIndexInfo[]) => {
  let indexes = structuredClone(startingIndexes);
  const createIndex = jest.fn(
    (key: Record<string, number>, options: Record<string, unknown>) => {
      indexes.push({ key, ...options } as UserIndexInfo);
      return Promise.resolve(String(options.name));
    },
  );
  const dropIndex = jest.fn((name: string) => {
    indexes = indexes.filter((index) => index.name !== name);
    return Promise.resolve({ ok: 1 });
  });
  const collection = {
    listIndexes: jest.fn(() => Promise.resolve(structuredClone(indexes))),
    createIndex,
    dropIndex,
  } satisfies UserIdentityIndexCollection;

  return { collection, createIndex, dropIndex, getIndexes: () => indexes };
};

describe('migrateUserIdentityIndexes', () => {
  it('should report changes without writing during a dry run', async () => {
    const harness = makeCollection(legacyIndexes());

    const result = await migrateUserIdentityIndexes(harness.collection, {
      apply: false,
    });

    expect(result).toEqual<UserIdentityIndexMigrationResult>({
      applied: false,
      toCreate: ['user_google_id_unique', 'user_clerk_id_unique'],
      toDrop: ['googleId_1', 'clerkId_1'],
    });
    expect(harness.createIndex).not.toHaveBeenCalled();
    expect(harness.dropIndex).not.toHaveBeenCalled();
  });

  it('should create conditional indexes before dropping known legacy indexes', async () => {
    const harness = makeCollection(legacyIndexes());
    const operations: string[] = [];
    harness.createIndex.mockImplementation((key, options) => {
      operations.push(`create:${String(options.name)}`);
      harness.getIndexes().push({ key, ...options } as UserIndexInfo);
      return Promise.resolve(String(options.name));
    });
    harness.dropIndex.mockImplementation((name) => {
      operations.push(`drop:${name}`);
      const index = harness
        .getIndexes()
        .findIndex((candidate) => candidate.name === name);
      if (index >= 0) harness.getIndexes().splice(index, 1);
      return Promise.resolve({ ok: 1 });
    });

    await migrateUserIdentityIndexes(harness.collection, { apply: true });

    expect(operations).toEqual([
      'create:user_google_id_unique',
      'create:user_clerk_id_unique',
      'drop:googleId_1',
      'drop:clerkId_1',
    ]);
  });

  it('should be a no-op when indexes are already compliant', async () => {
    const harness = makeCollection([
      ...legacyIndexes().slice(0, 2),
      ...desiredIndexes(),
    ]);

    await migrateUserIdentityIndexes(harness.collection, { apply: true });

    expect(harness.createIndex).not.toHaveBeenCalled();
    expect(harness.dropIndex).not.toHaveBeenCalled();
  });

  it('should refuse to drop an unexpectedly configured legacy index', async () => {
    const indexes = legacyIndexes();
    const google = indexes.find((index) => index.name === 'googleId_1');
    if (google) google.unique = false;
    const harness = makeCollection(indexes);

    await expect(
      migrateUserIdentityIndexes(harness.collection, { apply: true }),
    ).rejects.toThrow('unexpected definition');
    expect(harness.createIndex).not.toHaveBeenCalled();
    expect(harness.dropIndex).not.toHaveBeenCalled();
  });

  it('should tolerate a legacy index removed concurrently', async () => {
    const harness = makeCollection(legacyIndexes());
    harness.dropIndex.mockImplementation((name) => {
      const index = harness
        .getIndexes()
        .findIndex((candidate) => candidate.name === name);
      if (index >= 0) harness.getIndexes().splice(index, 1);
      if (name === 'googleId_1') {
        return Promise.reject(
          Object.assign(new Error('index not found'), { code: 27 }),
        );
      }
      return Promise.resolve({ ok: 1 });
    });

    await expect(
      migrateUserIdentityIndexes(harness.collection, { apply: true }),
    ).resolves.toMatchObject({ applied: true });
  });
});
