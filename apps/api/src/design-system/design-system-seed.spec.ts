import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesignSystemStatus } from '../database/schemas/design-system.schema';
import type { DesignSystemDefinition } from './design-system-definition';
import {
  DesignSystemSeedError,
  type SeedDeps,
  type SeedFile,
  type StoredVersion,
  checksumOf,
  planSeed,
  readSeedChecksums,
  readSeedFiles,
  seedChecks,
  seedDesignSystems,
} from './design-system-seed';
import {
  DEFINITION_FILE,
  DESIGN_SYSTEM_SEED_DIR,
  UNLISTED_DESIGN_SYSTEMS,
} from './design-system.constants';

const launchFiles = readSeedFiles(DESIGN_SYSTEM_SEED_DIR);
const launch = (id: string): SeedFile =>
  launchFiles.find((file) => file.definition.id === id)!;

const withVersion = (file: SeedFile, version: number): SeedFile => ({
  ...file,
  checksum: `sha256:v${version}`,
  definition: { ...file.definition, version },
});

const storedFrom = (
  file: SeedFile,
  status = DesignSystemStatus.ACTIVE,
): StoredVersion => ({
  id: file.definition.id,
  version: file.definition.version,
  checksum: file.checksum,
  status,
});

const allStored = () => launchFiles.map((file) => storedFrom(file));

const seedErrors = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof DesignSystemSeedError) return error.errors;
    throw error;
  }
  throw new Error('expected a DesignSystemSeedError');
};

describe('design-system seed', () => {
  describe('readSeedFiles', () => {
    it('should read every launch system when the seed directory is checked', () => {
      expect(launchFiles.map((file) => file.definition.id).sort()).toEqual([
        'afterglow',
        'broadside',
        'colophon',
        'margin',
        'overprint',
        'schematic',
      ]);
      expect(launchFiles[0].checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    describe('with a temporary seed directory', () => {
      let root: string;

      beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'design-systems-'));
        cpSync(join(DESIGN_SYSTEM_SEED_DIR, 'margin'), join(root, 'margin'), {
          recursive: true,
        });
      });

      afterEach(() => rmSync(root, { recursive: true, force: true }));

      it('should throw with the file path when a definition does not parse', () => {
        writeFileSync(join(root, 'margin', DEFINITION_FILE), 'contract: 1\n');

        const errors = seedErrors(() => readSeedFiles(root));

        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain(join(root, 'margin', DEFINITION_FILE));
      });

      it('should throw when a directory has no preview images', () => {
        rmSync(join(root, 'margin', 'previews'), { recursive: true });

        expect(seedErrors(() => readSeedFiles(root))).toEqual([
          expect.stringContaining('no preview images'),
        ]);
      });

      it('should throw when a directory has no definition', () => {
        rmSync(join(root, 'margin', DEFINITION_FILE));

        expect(seedErrors(() => readSeedFiles(root))).toEqual([
          expect.stringContaining('missing'),
        ]);
      });
    });
  });

  describe('readSeedChecksums', () => {
    it('should hash the definition bytes when reading the seed directory', () => {
      const checksums = readSeedChecksums(DESIGN_SYSTEM_SEED_DIR);

      expect(checksums).toHaveLength(6);
      expect(checksums.find((c) => c.path.includes('/margin/'))?.checksum).toBe(
        launch('margin').checksum,
      );
    });
  });

  describe('seedChecks', () => {
    const margin = (): DesignSystemDefinition =>
      structuredClone(launch('margin').definition);
    const previews = ['page-01.png'];

    it('should pass when the definition is a launch system', () => {
      expect(seedChecks('margin', margin(), previews)).toEqual([]);
    });

    it('should fail when the id does not match its directory', () => {
      expect(seedChecks('quiet', margin(), previews)).toEqual([
        'id "margin" does not match its directory "quiet"',
      ]);
    });

    it('should fail when a pairing is below the contrast floor', () => {
      const ds = margin();
      ds.palette.tokens.find((t) => t.name === 'grey')!.hex = '#cccccc';

      expect(seedChecks('margin', ds, previews)).toEqual([
        expect.stringMatching(
          /^pairing grey on white has contrast 1\.\d\d, below palette\.rules\.minContrastRatio \(4\.5\)$/,
        ),
      ]);
    });

    it('should fail when a google family is outside the allowlist', () => {
      const ds = margin();
      ds.typography.fonts[0].family = 'Comic Neue';

      expect(seedChecks('margin', ds, previews)).toEqual([
        'font family "Comic Neue" is not in DESIGN_SYSTEM_FONT_ALLOWLIST',
      ]);
    });

    it('should pass when a family outside the allowlist is a system font', () => {
      const ds = margin();
      ds.typography.fonts[0] = {
        ...ds.typography.fonts[0],
        family: 'Georgia',
        source: 'system',
      };

      expect(seedChecks('margin', ds, previews)).toEqual([]);
    });

    it('should fail when an allowed icon is not in the pinned catalog', () => {
      const ds = margin();
      ds.icons.allowed.push('spark');

      expect(seedChecks('margin', ds, previews)).toEqual([
        'icon "spark" is not in the app-inline-v1 catalog',
      ]);
    });

    it('should fail when the definition names another icon catalog', () => {
      const ds = margin();
      ds.icons.catalog = 'app-inline-v2';

      expect(seedChecks('margin', ds, previews)).toEqual([
        'icons.catalog "app-inline-v2" is not the pinned catalog "app-inline-v1"',
      ]);
    });

    it('should fail when the system has no preview images', () => {
      expect(seedChecks('margin', margin(), [])).toEqual([
        'no preview images in previews/',
      ]);
    });
  });

  describe('planSeed', () => {
    it('should insert every system when nothing is stored', () => {
      const plan = planSeed(launchFiles, []);

      expect(plan.insert).toHaveLength(6);
      expect(plan.supersede).toEqual([]);
      expect(plan.retire).toEqual([]);
    });

    it('should change nothing when every checksum matches', () => {
      const plan = planSeed(launchFiles, allStored());

      expect(plan.unchanged).toHaveLength(6);
      expect(plan.insert).toEqual([]);
      expect(plan.supersede).toEqual([]);
      expect(plan.retire).toEqual([]);
    });

    it('should insert and supersede the prior ACTIVE when a higher version appears', () => {
      const next = withVersion(launch('broadside'), 2);
      const files = launchFiles.map((file) =>
        file.definition.id === 'broadside' ? next : file,
      );

      const plan = planSeed(files, allStored());

      expect(plan.insert).toEqual([next]);
      expect(plan.supersede).toEqual([{ id: 'broadside', version: 1 }]);
    });

    it('should fail with the path and both checksums when a stored version changed', () => {
      const edited = { ...launch('colophon'), checksum: 'sha256:edited' };
      const files = launchFiles.map((file) =>
        file.definition.id === 'colophon' ? edited : file,
      );

      const errors = seedErrors(() => planSeed(files, allStored()));

      expect(errors).toEqual([expect.stringContaining(edited.path)]);
      expect(errors[0]).toContain(launch('colophon').checksum);
      expect(errors[0]).toContain('sha256:edited');
    });

    it('should fail when an unseen version is not above the stored maximum', () => {
      const stored = [
        ...allStored().filter((record) => record.id !== 'afterglow'),
        storedFrom(withVersion(launch('afterglow'), 3)),
      ];
      const files = launchFiles.map((file) =>
        file.definition.id === 'afterglow'
          ? withVersion(launch('afterglow'), 2)
          : file,
      );

      expect(seedErrors(() => planSeed(files, stored))).toEqual([
        expect.stringContaining(
          'afterglow v2 is not above the highest stored version (v3)',
        ),
      ]);
    });

    it('should retire an ACTIVE id when its directory is gone', () => {
      const files = launchFiles.filter(
        (file) => file.definition.id !== 'schematic',
      );

      const plan = planSeed(files, allStored());

      expect(plan.retire).toEqual([{ id: 'schematic', version: 1 }]);
    });

    it('should not retire an id whose versions are all inactive', () => {
      const stored = [
        ...allStored().filter((record) => record.id !== 'schematic'),
        storedFrom(launch('schematic'), DesignSystemStatus.RETIRED),
      ];
      const files = launchFiles.filter(
        (file) => file.definition.id !== 'schematic',
      );

      expect(planSeed(files, stored).retire).toEqual([]);
    });

    it('should fail when the default system has no directory', () => {
      const files = launchFiles.filter(
        (file) => file.definition.id !== 'margin',
      );

      expect(seedErrors(() => planSeed(files, allStored()))).toEqual([
        'DEFAULT_DESIGN_SYSTEM_ID "margin" would not have an ACTIVE version',
      ]);
    });

    it('should fail when the default system is unlisted', () => {
      const unlisted = UNLISTED_DESIGN_SYSTEMS as string[];
      unlisted.push('margin');
      try {
        expect(seedErrors(() => planSeed(launchFiles, []))).toEqual([
          'DEFAULT_DESIGN_SYSTEM_ID "margin" is in UNLISTED_DESIGN_SYSTEMS',
        ]);
      } finally {
        unlisted.pop();
      }
    });

    it('should report every failure together when several files are bad', () => {
      const files = launchFiles.map((file) => ({
        ...file,
        checksum: 'sha256:edited',
      }));

      expect(seedErrors(() => planSeed(files, allStored()))).toHaveLength(6);
    });
  });

  describe('seedDesignSystems', () => {
    const makeDeps = (stored: StoredVersion[]) => {
      const calls: string[] = [];
      const session = {
        withTransaction: jest.fn(async (fn: () => Promise<void>) => {
          calls.push('begin');
          await fn();
          calls.push('commit');
        }),
        endSession: jest.fn().mockResolvedValue(undefined),
      };
      const exec = jest.fn().mockResolvedValue(stored);
      const model = {
        find: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({ exec }),
        }),
        updateOne: jest.fn((filter: { id: string }, update: unknown) => {
          calls.push(`update ${filter.id} ${JSON.stringify(update)}`);
          return Promise.resolve();
        }),
        insertMany: jest.fn((...args: [{ id: string }[], unknown]) => {
          calls.push(`insert ${args[0].map((doc) => doc.id).join(',')}`);
          return Promise.resolve();
        }),
      };
      const connection = {
        startSession: jest.fn().mockResolvedValue(session),
      };
      return { model, connection, session, calls };
    };

    const run = (deps: ReturnType<typeof makeDeps>) =>
      seedDesignSystems({
        root: DESIGN_SYSTEM_SEED_DIR,
        model: deps.model as unknown as SeedDeps['model'],
        connection: deps.connection as unknown as SeedDeps['connection'],
        now: () => new Date('2026-10-01T00:00:00Z'),
      });

    it('should insert every system as ACTIVE in one transaction when nothing is stored', async () => {
      const deps = makeDeps([]);

      const plan = await run(deps);

      expect(plan.insert).toHaveLength(6);
      expect(deps.session.withTransaction).toHaveBeenCalledTimes(1);
      const [docs, options] = deps.model.insertMany.mock.calls[0];
      expect(options).toEqual({ session: deps.session });
      expect(docs.find((doc) => doc.id === 'margin')).toMatchObject({
        id: 'margin',
        version: 1,
        contract: 1,
        name: 'Margin',
        checksum: launch('margin').checksum,
        status: DesignSystemStatus.ACTIVE,
        seededAt: new Date('2026-10-01T00:00:00Z'),
        definition: launch('margin').definition,
      });
      expect(deps.session.endSession).toHaveBeenCalled();
    });

    it('should write nothing when the second run finds every checksum stored', async () => {
      const deps = makeDeps(allStored());

      const plan = await run(deps);

      expect(plan.unchanged).toHaveLength(6);
      expect(deps.connection.startSession).not.toHaveBeenCalled();
    });

    it('should write nothing when any file fails', async () => {
      const stored = allStored().map((record) =>
        record.id === 'overprint'
          ? { ...record, checksum: 'sha256:old' }
          : record,
      );
      const deps = makeDeps(stored.filter((record) => record.id !== 'margin'));

      await expect(run(deps)).rejects.toBeInstanceOf(DesignSystemSeedError);
      expect(deps.connection.startSession).not.toHaveBeenCalled();
    });

    it('should supersede and retire before inserting when versions move', async () => {
      const stored = [
        ...allStored().filter((record) => record.id !== 'margin'),
        { ...storedFrom(launch('margin')), version: 0, checksum: 'sha256:v0' },
        {
          id: 'gone',
          version: 4,
          checksum: 'sha256:gone',
          status: DesignSystemStatus.ACTIVE,
        },
      ];
      const deps = makeDeps(stored);

      await run(deps);

      expect(deps.calls).toEqual([
        'begin',
        `update margin {"$set":{"status":"SUPERSEDED"}}`,
        `update gone {"$set":{"status":"RETIRED"}}`,
        'insert margin',
        'commit',
      ]);
      expect(deps.model.updateOne).toHaveBeenCalledWith(
        { id: 'margin', version: 0, status: DesignSystemStatus.ACTIVE },
        { $set: { status: DesignSystemStatus.SUPERSEDED } },
        { session: deps.session },
      );
    });
  });

  describe('checksumOf', () => {
    it('should prefix the sha256 hex digest when hashing bytes', () => {
      expect(checksumOf('a')).toBe(
        'sha256:ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
      );
    });
  });
});
