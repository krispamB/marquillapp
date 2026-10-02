jest.mock(
  '../auth/clerk/clerk-auth.guard',
  () => ({ ClerkAuthGuard: class ClerkAuthGuard {} }),
  { virtual: true },
);
jest.mock(
  '../common/guards/user-throttler.guard',
  () => ({ UserThrottlerGuard: class UserThrottlerGuard {} }),
  { virtual: true },
);

import { NotFoundException, StreamableFile } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { join } from 'node:path';
import { ClerkAuthGuard } from '../auth/clerk/clerk-auth.guard';
import { UserThrottlerGuard } from '../common/guards/user-throttler.guard';
import { DESIGN_SYSTEM_SEED_DIR } from './design-system.constants';
import { DesignSystemsController } from './design-systems.controller';

const marginPage1 = join(
  DESIGN_SYSTEM_SEED_DIR,
  'margin',
  'previews',
  'page-01.png',
);

const makeController = () => {
  const designSystems = {
    listActive: jest.fn().mockReturnValue([
      {
        id: 'margin',
        version: 1,
        name: 'Margin',
        summary: 'Quiet.',
        previews: ['/api/v1/design-systems/margin/1/previews/1.png'],
      },
    ]),
    previewFile: jest.fn((id: string, version: number, page: number) => {
      if (id === 'margin' && version === 1 && page === 1) return marginPage1;
      throw new NotFoundException('Preview not found');
    }),
  };
  const controller = new DesignSystemsController(designSystems as any);
  return { controller, mocks: { designSystems } };
};

let controller: DesignSystemsController;
let mocks: ReturnType<typeof makeController>['mocks'];

beforeEach(() => {
  jest.clearAllMocks();
  ({ controller, mocks } = makeController());
});

describe('DesignSystemsController', () => {
  it('should use the same guards as the artifact routes', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, DesignSystemsController),
    ).toEqual([ClerkAuthGuard, UserThrottlerGuard]);
  });

  describe('list', () => {
    it('should return the selectable systems as a bare array', () => {
      expect(controller.list()).toEqual(mocks.designSystems.listActive());
    });
  });

  describe('preview', () => {
    it('should stream the PNG when the version is ACTIVE', async () => {
      const file = await controller.preview('margin', '1', '1.png');

      expect(file).toBeInstanceOf(StreamableFile);
      expect(file.getHeaders().type).toBe('image/png');
      expect(mocks.designSystems.previewFile).toHaveBeenCalledWith(
        'margin',
        1,
        1,
      );
    });

    it('should cache the image as immutable', () => {
      expect(
        Reflect.getMetadata(
          '__headers__',
          DesignSystemsController.prototype.preview,
        ),
      ).toContainEqual({
        name: 'Cache-Control',
        value: 'public, max-age=31536000, immutable',
      });
    });

    it('should throw not found when the version is superseded', async () => {
      await expect(
        controller.preview('margin', '0', '1.png'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should throw not found when the system is unlisted', async () => {
      mocks.designSystems.previewFile.mockImplementationOnce(() => {
        throw new NotFoundException('Preview not found');
      });

      await expect(
        controller.preview('margin', '1', '1.png'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should throw not found when the page does not exist', async () => {
      await expect(
        controller.preview('margin', '1', '9.png'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      ['1', '1.jpg'],
      ['1', 'page-01.png'],
      ['1', '../1.png'],
      ['one', '1.png'],
      ['1.0', '1.png'],
    ])(
      'should throw not found without a lookup when the path is %s/%s',
      async (version, page) => {
        await expect(
          controller.preview('margin', version, page),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(mocks.designSystems.previewFile).not.toHaveBeenCalled();
      },
    );
  });
});
