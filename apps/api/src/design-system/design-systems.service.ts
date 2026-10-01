import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  DesignSystem,
  DesignSystemStatus,
} from '../database/schemas/design-system.schema';
import { readSeedChecksums } from './design-system-seed';
import {
  DEFAULT_DESIGN_SYSTEM_ID,
  DESIGN_SYSTEM_SEED_DIR,
  UNLISTED_DESIGN_SYSTEMS,
} from './design-system.constants';

/** A stored Design System Version, as services read it. */
export type DesignSystemRecord = DesignSystem;

export interface DesignSystemSummary {
  id: string;
  version: number;
  name: string;
  summary: string;
}

const cacheKey = (id: string, version: number) => `${id}@${version}`;

/**
 * Reads and selection for app-owned Design Systems (document generation spec
 * §3.4). Never writes: `seed:design-systems` is the only writer, and a seed run
 * needs a restart to reach a running process, because nothing here is ever
 * invalidated.
 */
@Injectable()
export class DesignSystemsService implements OnModuleInit {
  private readonly logger = new Logger(DesignSystemsService.name);
  /** `id` → its ACTIVE version, loaded once at boot. */
  private readonly active = new Map<string, DesignSystemRecord>();
  /** Every version read so far, keyed by `(id, version)`. */
  private readonly versions = new Map<string, DesignSystemRecord>();

  constructor(
    @InjectModel(DesignSystem.name)
    private readonly designSystemModel: Model<DesignSystem>,
  ) {}

  /**
   * Boot verifies, never writes: the API and worker refuse to start while any
   * seed file's checksum is missing from the database.
   */
  async onModuleInit(): Promise<void> {
    const seeds = readSeedChecksums(DESIGN_SYSTEM_SEED_DIR);
    const seeded = await this.designSystemModel
      .find(
        { checksum: { $in: seeds.map((seed) => seed.checksum) } },
        { _id: 0, checksum: 1 },
      )
      .lean<Pick<DesignSystem, 'checksum'>[]>()
      .exec();
    const found = new Set(seeded.map((record) => record.checksum));
    const missing = seeds.filter((seed) => !found.has(seed.checksum));
    if (missing.length > 0) {
      throw new Error(
        `Design Systems are not seeded; run \`bun run seed:design-systems\`. Missing: ${missing.map((seed) => seed.path).join(', ')}`,
      );
    }

    const active = await this.designSystemModel
      .find({ status: DesignSystemStatus.ACTIVE }, { _id: 0 })
      .lean<DesignSystemRecord[]>()
      .exec();
    for (const record of active) {
      this.active.set(record.id, record);
      this.versions.set(cacheKey(record.id, record.version), record);
    }
    this.logger.log(`Loaded ${active.length} active Design Systems`);
  }

  /** The systems a user may select: ACTIVE and listed, the default first. */
  listActive(): DesignSystemSummary[] {
    return [...this.active.values()]
      .filter((record) => !UNLISTED_DESIGN_SYSTEMS.includes(record.id))
      .sort(
        (a, b) =>
          Number(b.id === DEFAULT_DESIGN_SYSTEM_ID) -
            Number(a.id === DEFAULT_DESIGN_SYSTEM_ID) ||
          a.id.localeCompare(b.id),
      )
      .map(({ id, version, name, summary }) => ({
        id,
        version,
        name,
        summary,
      }));
  }

  /** The ACTIVE version of a selectable system; a `400` otherwise. */
  getActive(id: string): DesignSystemRecord {
    const record = this.active.get(id);
    if (!record || UNLISTED_DESIGN_SYSTEMS.includes(id)) {
      throw new BadRequestException(`Design System "${id}" is not available`);
    }
    return record;
  }

  /**
   * An exact pinned version, whatever its status and whether or not it is
   * listed, so an existing pin always resolves.
   */
  async resolve(id: string, version: number): Promise<DesignSystemRecord> {
    const key = cacheKey(id, version);
    const cached = this.versions.get(key);
    if (cached) return cached;

    const record = await this.designSystemModel
      .findOne({ id, version }, { _id: 0 })
      .lean<DesignSystemRecord>()
      .exec();
    if (!record) {
      throw new NotFoundException(`Design System ${id} v${version} not found`);
    }
    this.versions.set(key, record);
    return record;
  }
}
