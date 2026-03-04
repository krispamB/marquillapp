/**
 * TEMPORARY SCRIPT:
 * Seed/update billing tiers in MongoDB for initial Polar setup.
 *
 * Run:
 *   npx ts-node src/scripts/temp-seed-tiers.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Tier, TierSchema } from '../database/schemas/tier.schema';

type TierSeed = {
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  polarMonthlyPriceId?: string;
  polarYearlyPriceId?: string;
  isDefault: boolean;
  isActive: boolean;
  metadata: {
    features: string[];
  };
};

const tierSeeds: TierSeed[] = [
  {
    name: 'Free',
    monthlyPrice: 0,
    yearlyPrice: 0,
    polarMonthlyPriceId: undefined,
    polarYearlyPriceId: undefined,
    isDefault: true,
    isActive: true,
    metadata: {
      features: ['1 connected account', '2 AI posts per month', '30 day history'],
    },
  },
  {
    name: 'starter',
    monthlyPrice: 9.99,
    yearlyPrice: 0,
    polarMonthlyPriceId: 'b8f76a29-80a2-4e88-a706-873e5cbad88d',
    polarYearlyPriceId: undefined,
    isDefault: false,
    isActive: true,
    metadata: {
      features: ['1 connected account', '10 AI posts per month', '90 day history'],
    },
  },
  {
    name: 'Creator',
    monthlyPrice: 19.99,
    yearlyPrice: 0,
    polarMonthlyPriceId: '08b899c6-798e-45e4-9ef3-e86a54df515e',
    polarYearlyPriceId: undefined,
    isDefault: false,
    isActive: true,
    metadata: {
      features: ['1 connected account', '30 AI posts per month', '1 year post history'],
    },
  },
  {
    name: 'Pro Writer',
    monthlyPrice: 29.99,
    yearlyPrice: 0,
    polarMonthlyPriceId: '23b1cf94-c1cc-49b6-8143-f1092c2eb997',
    polarYearlyPriceId: undefined,
    isDefault: false,
    isActive: true,
    metadata: {
      features: ['10 connected accounts', '350 AI posts per month', 'unlimited post history'],
    },
  },
];

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
    const normalizedSeeds = tierSeeds.map((tier) => ({
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
