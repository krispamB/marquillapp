import 'dotenv/config';
import mongoose from 'mongoose';
import {
  migrateArtifactLibraryIndex,
  type ArtifactIndexCollection,
  type ArtifactIndexInfo,
} from './artifact-library-index-migration';

// Mongoose's default collection for the `Artifact` model.
const ARTIFACTS = 'artifacts';

async function run(): Promise<void> {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is missing. Please set it in your environment.');
  }

  const apply = process.argv.slice(2).includes('--apply');
  await mongoose.connect(mongoUri, { autoIndex: false });
  console.log('[artifact-index] Connected using MONGO_URI.');

  try {
    const collection = mongoose.connection.collection(ARTIFACTS);
    const indexCollection: ArtifactIndexCollection = {
      listIndexes: async () =>
        (await collection.listIndexes().toArray()) as ArtifactIndexInfo[],
      createIndex: (key, options) => collection.createIndex(key, options),
    };
    await migrateArtifactLibraryIndex(indexCollection, {
      apply,
      log: (message) => console.log(`[artifact-index] ${message}`),
    });
    if (!apply) {
      console.log(
        '[artifact-index] No changes applied. Re-run with --apply after reviewing the plan.',
      );
    }
  } finally {
    await mongoose.disconnect();
    console.log('[artifact-index] Disconnected.');
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[artifact-index] Failed: ${message}`);
  process.exit(1);
});
