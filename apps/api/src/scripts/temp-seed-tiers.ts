/**
 * TEMPORARY SCRIPT:
 * Seed/update billing tiers in MongoDB for Paddle setup.
 *
 * Fill in the paddleMonthlyPriceId / paddleYearlyPriceId values from your
 * Paddle dashboard (format: pri_xxxx) before running.
 *
 * Run:
 *   npx ts-node src/scripts/temp-seed-tiers.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Tier, TierSchema } from '../database/schemas/tier.schema';
import { TIER_SEEDS } from '.';

async function run() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is missing. Please set it in your environment.');
  }

  await mongoose.connect(mongoUri);
  const TierModel = mongoose.model<Tier>('Tier', TierSchema);

  console.log('[tiers:temp-seed] Connected to MongoDB');

  try {
    // Ensure only the Free tier can be default by definition.
    const normalizedSeeds = TIER_SEEDS.map((tier) => ({
      ...tier,
      isDefault: tier.name === 'Free',
    }));

    const results: { name: string; id: string }[] = [];

    for (const tier of normalizedSeeds) {
      const result = await TierModel.findOneAndUpdate(
        { name: tier.name },
        tier,
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        },
      ).exec();

      results.push({ name: result.name, id: result._id.toString() });
    }

    await TierModel.updateMany(
      { name: { $ne: 'Free' } },
      { $set: { isDefault: false } },
    ).exec();

    console.log('[tiers:temp-seed] Upserted tiers:');
    for (const row of results) {
      console.log(` - ${row.name} (${row.id})`);
    }
    console.log('[tiers:temp-seed] Done');
  } finally {
    await mongoose.disconnect();
    console.log('[tiers:temp-seed] Disconnected');
  }
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[tiers:temp-seed] Failed:', error);
    process.exit(1);
  });
