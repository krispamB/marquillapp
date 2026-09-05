import {
  USER_CLERK_ID_INDEX_NAME,
  USER_GOOGLE_ID_INDEX_NAME,
} from '../database/schemas/user.schema';

type IdentityField = 'googleId' | 'clerkId';

type DesiredIndex = {
  field: IdentityField;
  name: string;
  legacyName: string;
  legacySparse: boolean;
};

export type UserIndexInfo = {
  name: string;
  key: Record<string, unknown>;
  unique?: boolean;
  sparse?: boolean;
  partialFilterExpression?: Record<string, unknown>;
};

export type UserIdentityIndexCollection = {
  listIndexes: () => Promise<UserIndexInfo[]>;
  createIndex: (
    key: Record<string, number>,
    options: Record<string, unknown>,
  ) => Promise<string>;
  dropIndex: (name: string) => Promise<unknown>;
};

export type UserIdentityIndexMigrationResult = {
  applied: boolean;
  toCreate: string[];
  toDrop: string[];
};

const DESIRED_INDEXES: DesiredIndex[] = [
  {
    field: 'googleId',
    name: USER_GOOGLE_ID_INDEX_NAME,
    legacyName: 'googleId_1',
    legacySparse: false,
  },
  {
    field: 'clerkId',
    name: USER_CLERK_ID_INDEX_NAME,
    legacyName: 'clerkId_1',
    legacySparse: true,
  },
];

const noopLogger = () => undefined;

export async function migrateUserIdentityIndexes(
  collection: UserIdentityIndexCollection,
  options: { apply: boolean; log?: (message: string) => void },
): Promise<UserIdentityIndexMigrationResult> {
  const log = options.log ?? noopLogger;
  const indexes = await collection.listIndexes();
  const toCreate: DesiredIndex[] = [];
  const toDrop: DesiredIndex[] = [];

  for (const desired of DESIRED_INDEXES) {
    const current = indexes.find((index) => index.name === desired.name);
    if (current && !isDesiredIndex(current, desired)) {
      throw new Error(
        `Index ${desired.name} exists with an unexpected definition; refusing to modify it.`,
      );
    }
    if (!current) {
      toCreate.push(desired);
    }

    const legacy = indexes.find((index) => index.name === desired.legacyName);
    if (legacy && !isKnownLegacyIndex(legacy, desired)) {
      throw new Error(
        `Legacy index ${desired.legacyName} has an unexpected definition; refusing to drop it.`,
      );
    }
    if (legacy) {
      toDrop.push(desired);
    }
  }

  const result: UserIdentityIndexMigrationResult = {
    applied: options.apply,
    toCreate: toCreate.map((index) => index.name),
    toDrop: toDrop.map((index) => index.legacyName),
  };

  if (!options.apply) {
    logMigrationPlan(result, log);
    return result;
  }

  for (const desired of toCreate) {
    await collection.createIndex(
      { [desired.field]: 1 },
      {
        name: desired.name,
        unique: true,
        partialFilterExpression: {
          [desired.field]: { $type: 'string' },
        },
      },
    );
    log(`Created ${desired.name}.`);
  }

  for (const desired of toDrop) {
    try {
      await collection.dropIndex(desired.legacyName);
      log(`Dropped ${desired.legacyName}.`);
    } catch (error) {
      if (!isIndexNotFoundError(error)) {
        throw error;
      }
      log(`${desired.legacyName} was already removed concurrently.`);
    }
  }

  await verifyMigration(collection);
  log('Verified user identity indexes.');
  return result;
}

export function parseUserIndexCatalog(value: unknown): UserIndexInfo[] {
  if (!Array.isArray(value)) {
    throw new Error('MongoDB returned an invalid index catalog.');
  }

  return value.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.name !== 'string') {
      throw new Error('MongoDB returned an index without a valid name.');
    }
    if (!isRecord(candidate.key)) {
      throw new Error(`MongoDB index ${candidate.name} has an invalid key.`);
    }

    const parsed: UserIndexInfo = {
      name: candidate.name,
      key: candidate.key,
    };
    if (candidate.unique === true) parsed.unique = true;
    if (candidate.sparse === true) parsed.sparse = true;
    if (isRecord(candidate.partialFilterExpression)) {
      parsed.partialFilterExpression = candidate.partialFilterExpression;
    }
    return parsed;
  });
}

function isDesiredIndex(index: UserIndexInfo, desired: DesiredIndex): boolean {
  const filter = index.partialFilterExpression;
  const fieldFilter = filter?.[desired.field];

  return (
    hasOnlyKey(index, desired.field) &&
    index.unique === true &&
    index.sparse !== true &&
    filter !== undefined &&
    Object.keys(filter).length === 1 &&
    isRecord(fieldFilter) &&
    fieldFilter.$type === 'string' &&
    Object.keys(fieldFilter).length === 1
  );
}

function isKnownLegacyIndex(
  index: UserIndexInfo,
  desired: DesiredIndex,
): boolean {
  return (
    hasOnlyKey(index, desired.field) &&
    index.unique === true &&
    Boolean(index.sparse) === desired.legacySparse &&
    index.partialFilterExpression === undefined
  );
}

function hasOnlyKey(index: UserIndexInfo, field: IdentityField): boolean {
  return Object.keys(index.key).length === 1 && index.key[field] === 1;
}

function isIndexNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === 27;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function verifyMigration(
  collection: UserIdentityIndexCollection,
): Promise<void> {
  const indexes = await collection.listIndexes();
  for (const desired of DESIRED_INDEXES) {
    const current = indexes.find((index) => index.name === desired.name);
    if (!current || !isDesiredIndex(current, desired)) {
      throw new Error(`Verification failed for ${desired.name}.`);
    }
    if (indexes.some((index) => index.name === desired.legacyName)) {
      throw new Error(
        `Verification failed because ${desired.legacyName} still exists.`,
      );
    }
  }
}

function logMigrationPlan(
  result: UserIdentityIndexMigrationResult,
  log: (message: string) => void,
): void {
  if (result.toCreate.length === 0 && result.toDrop.length === 0) {
    log('Dry run: user identity indexes are already compliant.');
    return;
  }
  log(
    `Dry run: create [${result.toCreate.join(', ') || 'none'}], drop [${result.toDrop.join(', ') || 'none'}].`,
  );
}
