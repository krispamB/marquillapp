import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Connection, Model } from 'mongoose';
import {
  DesignSystem,
  DesignSystemStatus,
} from '../database/schemas/design-system.schema';
import {
  type DesignSystemDefinition,
  parseDesignSystemDefinition,
} from './design-system-definition';
import {
  DEFAULT_DESIGN_SYSTEM_ID,
  DEFINITION_FILE,
  DESIGN_SYSTEM_FONT_ALLOWLIST,
  ICON_CATALOG_ID,
  PREVIEWS_DIR,
  PREVIEW_FILE,
  UNLISTED_DESIGN_SYSTEMS,
} from './design-system.constants';
import { isCatalogIcon } from './icon-catalog';

/** One seed directory's definition, parsed and checked. */
export interface SeedFile {
  path: string;
  checksum: string;
  definition: DesignSystemDefinition;
}

/** What seeding needs to know about a stored Design System Version. */
export interface StoredVersion {
  id: string;
  version: number;
  checksum: string;
  status: DesignSystemStatus;
}

export interface VersionRef {
  id: string;
  version: number;
}

export interface SeedPlan {
  insert: SeedFile[];
  supersede: VersionRef[];
  retire: VersionRef[];
  unchanged: SeedFile[];
}

/** Every reason a seed run refused to write, reported together. */
export class DesignSystemSeedError extends Error {
  constructor(readonly errors: string[]) {
    super(
      `Design System seeding failed; nothing was written:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    );
    this.name = 'DesignSystemSeedError';
  }
}

export const checksumOf = (bytes: Buffer | string): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/** The definition file of every directory under the seed root. */
export function seedDefinitionPaths(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name, DEFINITION_FILE))
    .sort();
}

/** Boot verification needs checksums only, so it never parses. */
export function readSeedChecksums(
  root: string,
): { path: string; checksum: string }[] {
  return seedDefinitionPaths(root).map((path) => ({
    path,
    checksum: checksumOf(readFileSync(path)),
  }));
}

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrastRatio = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

/**
 * The checks only seeding can make (§3.1 "seed check", §3.3): they need the
 * directory, the app's allowlists or the pinned icon catalog, none of which
 * the contract can see. Spacing base, type floor and safe area are already
 * enforced by the contract's cross-references.
 */
export function seedChecks(
  dir: string,
  ds: DesignSystemDefinition,
  previews: string[],
): string[] {
  const errors: string[] = [];

  if (ds.id !== dir)
    errors.push(`id "${ds.id}" does not match its directory "${dir}"`);

  const hex = new Map(ds.palette.tokens.map((t) => [t.name, t.hex]));
  for (const pairing of ds.palette.pairings) {
    const ratio = contrastRatio(hex.get(pairing.text)!, hex.get(pairing.on)!);
    if (ratio < ds.palette.rules.minContrastRatio)
      errors.push(
        `pairing ${pairing.text} on ${pairing.on} has contrast ${ratio.toFixed(2)}, below palette.rules.minContrastRatio (${ds.palette.rules.minContrastRatio})`,
      );
  }

  for (const font of ds.typography.fonts) {
    if (
      font.source === 'google' &&
      !DESIGN_SYSTEM_FONT_ALLOWLIST.includes(font.family)
    )
      errors.push(
        `font family "${font.family}" is not in DESIGN_SYSTEM_FONT_ALLOWLIST`,
      );
  }

  if (ds.icons.catalog !== ICON_CATALOG_ID)
    errors.push(
      `icons.catalog "${ds.icons.catalog}" is not the pinned catalog "${ICON_CATALOG_ID}"`,
    );
  for (const icon of ds.icons.allowed) {
    if (!isCatalogIcon(icon))
      errors.push(`icon "${icon}" is not in the ${ICON_CATALOG_ID} catalog`);
  }

  if (previews.length === 0)
    errors.push(`no preview images in ${PREVIEWS_DIR}/`);

  return errors;
}

const previewImages = (dir: string): string[] => {
  const previews = join(dir, PREVIEWS_DIR);
  return existsSync(previews)
    ? readdirSync(previews).filter((name) => PREVIEW_FILE.test(name))
    : [];
};

/**
 * Reads, parses and checks every seed directory. Throws with every problem
 * found, across all directories, before anything touches the database.
 */
export function readSeedFiles(root: string): SeedFile[] {
  const errors: string[] = [];
  const files: SeedFile[] = [];

  for (const path of seedDefinitionPaths(root)) {
    const dirPath = dirname(path);
    const dir = basename(dirPath);
    if (!existsSync(path)) {
      errors.push(`${path}: missing`);
      continue;
    }

    const bytes = readFileSync(path);
    const parsed = parseDesignSystemDefinition(bytes.toString('utf8'));
    if (!parsed.success) {
      errors.push(...parsed.errors.map((error) => `${path}: ${error}`));
      continue;
    }

    const problems = seedChecks(dir, parsed.definition, previewImages(dirPath));
    if (problems.length > 0) {
      errors.push(...problems.map((problem) => `${path}: ${problem}`));
      continue;
    }

    files.push({
      path,
      checksum: checksumOf(bytes),
      definition: parsed.definition,
    });
  }

  if (errors.length > 0) throw new DesignSystemSeedError(errors);
  return files;
}

/**
 * Decides every write from the seed files and what is stored (§3.3), or
 * throws with every reason it cannot. Pure, so the whole table is testable
 * without a database.
 */
export function planSeed(files: SeedFile[], stored: StoredVersion[]): SeedPlan {
  const errors: string[] = [];
  const plan: SeedPlan = {
    insert: [],
    supersede: [],
    retire: [],
    unchanged: [],
  };

  const storedById = new Map<string, StoredVersion[]>();
  for (const record of stored) {
    storedById.set(record.id, [...(storedById.get(record.id) ?? []), record]);
  }
  const activeOf = (id: string) =>
    storedById.get(id)?.find((v) => v.status === DesignSystemStatus.ACTIVE);

  for (const file of files) {
    const { id, version } = file.definition;
    const versions = storedById.get(id) ?? [];
    const existing = versions.find((v) => v.version === version);

    if (existing) {
      if (existing.checksum === file.checksum) plan.unchanged.push(file);
      else
        errors.push(
          `${file.path}: ${id} v${version} is already seeded with different content (stored ${existing.checksum}, file ${file.checksum}); edit a definition by bumping its version`,
        );
      continue;
    }

    const max = Math.max(0, ...versions.map((v) => v.version));
    if (version <= max) {
      errors.push(
        `${file.path}: ${id} v${version} is not above the highest stored version (v${max})`,
      );
      continue;
    }

    plan.insert.push(file);
    const active = activeOf(id);
    if (active) plan.supersede.push({ id, version: active.version });
  }

  // Declarative retirement: deleting a directory is how a system stops being
  // offered.
  const seededIds = new Set(files.map((file) => file.definition.id));
  for (const record of stored) {
    if (
      record.status === DesignSystemStatus.ACTIVE &&
      !seededIds.has(record.id)
    )
      plan.retire.push({ id: record.id, version: record.version });
  }

  const defaultActive =
    plan.insert.some(
      (file) => file.definition.id === DEFAULT_DESIGN_SYSTEM_ID,
    ) ||
    (seededIds.has(DEFAULT_DESIGN_SYSTEM_ID) &&
      activeOf(DEFAULT_DESIGN_SYSTEM_ID) !== undefined);
  if (!defaultActive)
    errors.push(
      `DEFAULT_DESIGN_SYSTEM_ID "${DEFAULT_DESIGN_SYSTEM_ID}" would not have an ACTIVE version`,
    );
  if (UNLISTED_DESIGN_SYSTEMS.includes(DEFAULT_DESIGN_SYSTEM_ID))
    errors.push(
      `DEFAULT_DESIGN_SYSTEM_ID "${DEFAULT_DESIGN_SYSTEM_ID}" is in UNLISTED_DESIGN_SYSTEMS`,
    );

  if (errors.length > 0) throw new DesignSystemSeedError(errors);
  return plan;
}

export interface SeedDeps {
  root: string;
  model: Model<DesignSystem>;
  connection: Pick<Connection, 'startSession'>;
  now?: () => Date;
}

/**
 * `seed:design-systems`, the only writer of `design_systems`. Every check runs
 * before the first write, and every write shares one transaction, so a run
 * either applies its whole plan or writes nothing.
 */
export async function seedDesignSystems({
  root,
  model,
  connection,
  now = () => new Date(),
}: SeedDeps): Promise<SeedPlan> {
  const files = readSeedFiles(root);
  const stored = await model
    .find({}, { _id: 0, id: 1, version: 1, checksum: 1, status: 1 })
    .lean<StoredVersion[]>()
    .exec();
  const plan = planSeed(files, stored);

  if (
    plan.insert.length === 0 &&
    plan.supersede.length === 0 &&
    plan.retire.length === 0
  ) {
    return plan;
  }

  const seededAt = now();
  const session = await connection.startSession();
  try {
    await session.withTransaction(async () => {
      // Clear the old ACTIVE rows first: the partial unique index allows one
      // ACTIVE version per id at every point inside the transaction.
      for (const { id, version } of plan.supersede) {
        await model.updateOne(
          { id, version, status: DesignSystemStatus.ACTIVE },
          { $set: { status: DesignSystemStatus.SUPERSEDED } },
          { session },
        );
      }
      for (const { id, version } of plan.retire) {
        await model.updateOne(
          { id, version, status: DesignSystemStatus.ACTIVE },
          { $set: { status: DesignSystemStatus.RETIRED } },
          { session },
        );
      }
      if (plan.insert.length > 0) {
        await model.insertMany(
          plan.insert.map(({ definition, checksum }) => ({
            id: definition.id,
            version: definition.version,
            contract: definition.contract,
            name: definition.name,
            summary: definition.summary,
            definition,
            checksum,
            status: DesignSystemStatus.ACTIVE,
            seededAt,
          })),
          { session },
        );
      }
    });
  } finally {
    await session.endSession();
  }

  return plan;
}
