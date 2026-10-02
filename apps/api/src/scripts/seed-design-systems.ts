/**
 * Seeds `design_systems` from `assets/design-systems/<id>/definition.ds.yaml`
 * (document generation spec §3.3). Run from `apps/api`:
 *
 *   bun run seed:design-systems
 *
 * Every check runs before the first write and every write shares one
 * transaction, so a failed run writes nothing. A second run is a no-op.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import {
  DesignSystem,
  DesignSystemSchema,
} from '../database/schemas/design-system.schema';
import { DESIGN_SYSTEM_SEED_DIR } from '../design-system/design-system.constants';
import { seedDesignSystems } from '../design-system/design-system-seed';

async function run() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is missing. Please set it in your environment.');
  }

  await mongoose.connect(mongoUri);
  try {
    const model = mongoose.model<DesignSystem>(
      DesignSystem.name,
      DesignSystemSchema,
    );
    await model.init();

    const plan = await seedDesignSystems({
      root: DESIGN_SYSTEM_SEED_DIR,
      model,
      connection: mongoose.connection,
    });

    for (const file of plan.insert) {
      console.log(
        `[design-systems:seed] inserted ${file.definition.id} v${file.definition.version}`,
      );
    }
    for (const { id, version } of plan.supersede) {
      console.log(`[design-systems:seed] superseded ${id} v${version}`);
    }
    for (const { id, version } of plan.retire) {
      console.log(`[design-systems:seed] retired ${id} v${version}`);
    }
    console.log(
      `[design-systems:seed] ${plan.insert.length} inserted, ${plan.unchanged.length} unchanged, ${plan.supersede.length} superseded, ${plan.retire.length} retired`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(
      '[design-systems:seed]',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  });
