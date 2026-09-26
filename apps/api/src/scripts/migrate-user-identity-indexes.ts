import 'dotenv/config';
import mongoose from 'mongoose';
import {
  migrateUserIdentityIndexes,
  parseUserIndexCatalog,
  type UserIdentityIndexCollection,
} from './user-identity-index-migration';

async function run(): Promise<void> {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is missing. Please set it in your environment.');
  }

  const apply = process.argv.slice(2).includes('--apply');
  await mongoose.connect(mongoUri, { autoIndex: false });
  console.log('[user-indexes] Connected using MONGO_URI.');

  try {
    const collection = mongoose.connection.collection('users');
    const indexCollection: UserIdentityIndexCollection = {
      listIndexes: async () => {
        const catalog: unknown = await collection.listIndexes().toArray();
        return parseUserIndexCatalog(catalog);
      },
      createIndex: (key, options) => collection.createIndex(key, options),
      dropIndex: (name) => collection.dropIndex(name),
    };
    await migrateUserIdentityIndexes(indexCollection, {
      apply,
      log: (message) => console.log(`[user-indexes] ${message}`),
    });
    if (!apply) {
      console.log(
        '[user-indexes] No changes applied. Re-run with --apply after reviewing the plan.',
      );
    }
  } finally {
    await mongoose.disconnect();
    console.log('[user-indexes] Disconnected.');
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[user-indexes] Failed: ${message}`);
  process.exit(1);
});
