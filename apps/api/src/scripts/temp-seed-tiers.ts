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

type TierSeed = {
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  paddleMonthlyPriceId?: string;
  paddleYearlyPriceId?: string;
  isDefault: boolean;
  isActive: boolean;
  limits: {
    ai_drafts: number;
    connected_accounts: number;
    scheduled_posts: number;
  };
  metadata: {
    features: string[];
  };
};

const tierSeeds: TierSeed[] = [
  {
    name: 'Free',
    monthlyPrice: 0,
    yearlyPrice: 0,
    paddleMonthlyPriceId: undefined,
    paddleYearlyPriceId: undefined,
    isDefault: true,
    isActive: true,
    limits: {
      ai_drafts: 2,
      connected_accounts: 1,
      scheduled_posts: 1,
    },
    metadata: {
      features: [
        '1 connected account',
        '2 AI posts per month',
        '1 scheduled post',
        '30 day history',
      ],
    },
  },
  {
    name: 'Starter',
    monthlyPrice: 9.99,
    yearlyPrice: 0,
    paddleMonthlyPriceId: 'pri_01kp1mjq33h66h0sgwjy1sshzb',
    paddleYearlyPriceId: undefined,
    isDefault: false,
    isActive: true,
    limits: {
      ai_drafts: 10,
      connected_accounts: 1,
      scheduled_posts: 5,
    },
    metadata: {
      features: [
        '1 connected account',
        '10 AI posts per month',
        '5 scheduled posts',
        '90 day history',
      ],
    },
  },
  {
    name: 'Creator',
    monthlyPrice: 19.99,
    yearlyPrice: 0,
    paddleMonthlyPriceId: 'pri_01kp1mgt8gmsnzb4cb9jndz34k',
    paddleYearlyPriceId: undefined,
    isDefault: false,
    isActive: true,
    limits: {
      ai_drafts: 30,
      connected_accounts: 1,
      scheduled_posts: 15,
    },
    metadata: {
      features: [
        '1 connected account',
        '30 AI posts per month',
        '15 scheduled posts',
        '1 year post history',
      ],
    },
  },
  {
    name: 'Pro Writer',
    monthlyPrice: 29.99,
    yearlyPrice: 0,
    paddleMonthlyPriceId: 'pri_01kp1mmw9b31vxjvhs69y1q4g3',
    paddleYearlyPriceId: undefined,
    isDefault: false,
    isActive: true,
    limits: {
      ai_drafts: 300,
      connected_accounts: 5,
      scheduled_posts: -1,
    },
    metadata: {
      features: [
        '10 connected accounts',
        '350 AI posts per month',
        'unlimited scheduled posts',
        'unlimited post history',
      ],
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
