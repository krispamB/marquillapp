import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DesignSystemStatus } from '../database/schemas/design-system.schema';
import { readSeedFiles } from './design-system-seed';
import {
  DESIGN_SYSTEM_SEED_DIR,
  UNLISTED_DESIGN_SYSTEMS,
} from './design-system.constants';
import { DesignSystemsService } from './design-systems.service';

const seedFiles = readSeedFiles(DESIGN_SYSTEM_SEED_DIR);

const recordOf = (
  id: string,
  overrides: Partial<{ version: number; status: DesignSystemStatus }> = {},
) => {
  const file = seedFiles.find((seed) => seed.definition.id === id)!;
  return {
    id,
    version: file.definition.version,
    contract: file.definition.contract,
    name: file.definition.name,
    summary: file.definition.summary,
    definition: file.definition,
    checksum: file.checksum,
    status: DesignSystemStatus.ACTIVE,
    seededAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
};

const allActive = () => seedFiles.map((file) => recordOf(file.definition.id));

const query = (result: unknown) => ({
  lean: jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue(result),
  }),
});

const makeService = (records = allActive()) => {
  const designSystemModel = {
    find: jest.fn(
      (filter: { checksum?: { $in: string[] }; status?: DesignSystemStatus }) =>
        query(
          records.filter((r) =>
            filter.checksum
              ? filter.checksum.$in.includes(r.checksum)
              : r.status === filter.status,
          ),
        ),
    ),
    findOne: jest.fn((filter: { id: string; version: number }) =>
      query(
        records.find(
          (r) => r.id === filter.id && r.version === filter.version,
        ) ?? null,
      ),
    ),
  };
  const service = new DesignSystemsService(designSystemModel as any);
  return { service, mocks: { designSystemModel } };
};

let service: DesignSystemsService;
let mocks: ReturnType<typeof makeService>['mocks'];

beforeEach(() => {
  jest.clearAllMocks();
  ({ service, mocks } = makeService());
});

describe('DesignSystemsService', () => {
  describe('onModuleInit', () => {
    it('should load the ACTIVE set when every seed checksum is stored', async () => {
      await service.onModuleInit();

      expect(service.listActive()).toHaveLength(6);
    });

    it('should refuse to boot when a seed checksum is missing', async () => {
      ({ service } = makeService(
        allActive().filter((record) => record.id !== 'afterglow'),
      ));

      await expect(service.onModuleInit()).rejects.toThrow(
        /not seeded.*afterglow\/definition\.ds\.yaml/,
      );
    });

    it('should never write when verifying', async () => {
      await service.onModuleInit();

      expect(Object.keys(mocks.designSystemModel)).toEqual(['find', 'findOne']);
    });
  });

  describe('listActive', () => {
    it('should put the default first when listing summaries', async () => {
      await service.onModuleInit();

      const list = service.listActive();

      expect(list[0]).toMatchObject({
        id: 'margin',
        version: 1,
        name: 'Margin',
      });
      expect(Object.keys(list[0]).sort()).toEqual([
        'id',
        'name',
        'summary',
        'version',
      ]);
      expect(list.map((item) => item.id).slice(1)).toEqual([
        'afterglow',
        'broadside',
        'colophon',
        'overprint',
        'schematic',
      ]);
    });

    it('should exclude a system when it is unlisted', async () => {
      await service.onModuleInit();
      const unlisted = UNLISTED_DESIGN_SYSTEMS as string[];
      unlisted.push('overprint');
      try {
        expect(service.listActive().map((item) => item.id)).not.toContain(
          'overprint',
        );
      } finally {
        unlisted.pop();
      }
    });
  });

  describe('getActive', () => {
    beforeEach(() => service.onModuleInit());

    it('should return the ACTIVE record when the system is listed', () => {
      expect(service.getActive('colophon')).toMatchObject({
        id: 'colophon',
        status: DesignSystemStatus.ACTIVE,
      });
    });

    it('should throw when the id has no ACTIVE version', () => {
      expect(() => service.getActive('nope')).toThrow(BadRequestException);
    });

    it('should throw when the system is unlisted', () => {
      const unlisted = UNLISTED_DESIGN_SYSTEMS as string[];
      unlisted.push('colophon');
      try {
        expect(() => service.getActive('colophon')).toThrow(
          BadRequestException,
        );
      } finally {
        unlisted.pop();
      }
    });
  });

  describe('resolve', () => {
    const retired = recordOf('schematic', {
      version: 0,
      status: DesignSystemStatus.RETIRED,
    });

    beforeEach(async () => {
      ({ service, mocks } = makeService([...allActive(), retired]));
      await service.onModuleInit();
      jest.clearAllMocks();
    });

    it('should resolve a version when it is not ACTIVE', async () => {
      await expect(service.resolve('schematic', 0)).resolves.toBe(retired);
    });

    it('should resolve a version when its system is unlisted', async () => {
      const unlisted = UNLISTED_DESIGN_SYSTEMS as string[];
      unlisted.push('margin');
      try {
        await expect(service.resolve('margin', 1)).resolves.toMatchObject({
          id: 'margin',
          version: 1,
        });
      } finally {
        unlisted.pop();
      }
    });

    it('should read the database once when the same version is resolved twice', async () => {
      await service.resolve('schematic', 0);
      await service.resolve('schematic', 0);

      expect(mocks.designSystemModel.findOne).toHaveBeenCalledTimes(1);
    });

    it('should serve ACTIVE versions from the boot cache when resolving', async () => {
      await service.resolve('margin', 1);

      expect(mocks.designSystemModel.findOne).not.toHaveBeenCalled();
    });

    it('should throw when the version does not exist', async () => {
      await expect(service.resolve('margin', 9)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
