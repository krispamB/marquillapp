jest.mock(
  '../auth/clerk',
  () => ({ ClerkAuthGuard: class ClerkAuthGuard {} }),
  { virtual: true },
);

import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { User } from '../database/schemas/user.schema';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsThrottlerGuard } from './analytics-throttler.guard';
import {
  AnalyticsAccountParamsDto,
  AnalyticsRangeQueryDto,
  AnalyticsRefreshQueryDto,
} from './dto';

const makeController = () => {
  const analyticsService = {
    getOverview: jest.fn().mockResolvedValue({ access: 'ok' }),
    getPosts: jest.fn().mockResolvedValue({ access: 'ok', posts: [] }),
    getAudience: jest.fn().mockResolvedValue({ access: 'ok', facets: [] }),
  };
  const controller = new AnalyticsController(analyticsService as any);
  return { controller, mocks: { analyticsService } };
};

const errorsFor = async <T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
) => validate(plainToInstance(cls, plain));

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let mocks: ReturnType<typeof makeController>['mocks'];
  const user = { _id: 'user-1' } as unknown as User;
  const params = { connectedAccountId: '665f1c2e9b1d4a0012345678' };

  beforeEach(() => {
    ({ controller, mocks } = makeController());
  });

  it('should guard with Clerk then the analytics throttler', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AnalyticsController,
    ) as Array<{ name: string }>;
    expect(guards.map((guard) => guard.name)).toEqual([
      'ClerkAuthGuard',
      AnalyticsThrottlerGuard.name,
    ]);
  });

  describe('getOverview', () => {
    it('should wrap the overview in the app envelope', async () => {
      await expect(
        controller.getOverview(user, params, { range: '7d', refresh: true }),
      ).resolves.toEqual({
        statusCode: HttpStatus.OK,
        message: 'Analytics overview retrieved successfully',
        data: { access: 'ok' },
      });
      expect(mocks.analyticsService.getOverview).toHaveBeenCalledWith(
        user,
        params.connectedAccountId,
        '7d',
        true,
      );
    });
  });

  describe('getPosts', () => {
    it('should pass refresh false when it is absent', async () => {
      await controller.getPosts(user, params, {});
      expect(mocks.analyticsService.getPosts).toHaveBeenCalledWith(
        user,
        params.connectedAccountId,
        undefined,
        false,
      );
    });
  });

  describe('getAudience', () => {
    it('should call the audience without a range', async () => {
      const result = await controller.getAudience(user, params, {
        refresh: false,
      });
      expect(result.data).toEqual({ access: 'ok', facets: [] });
      expect(mocks.analyticsService.getAudience).toHaveBeenCalledWith(
        user,
        params.connectedAccountId,
        false,
      );
    });
  });

  describe('DTO validation', () => {
    it('should accept the known ranges and refresh spellings', async () => {
      for (const range of ['7d', '28d', '90d']) {
        expect(
          await errorsFor(AnalyticsRangeQueryDto, { range, refresh: 'true' }),
        ).toHaveLength(0);
      }
      const dto = plainToInstance(AnalyticsRefreshQueryDto, {
        refresh: 'false',
      });
      expect(dto.refresh).toBe(false);
    });

    it('should reject an unknown range', async () => {
      expect(
        await errorsFor(AnalyticsRangeQueryDto, { range: '30d' }),
      ).toHaveLength(1);
    });

    it('should reject a refresh that is not true or false', async () => {
      expect(
        await errorsFor(AnalyticsRefreshQueryDto, { refresh: 'yes' }),
      ).toHaveLength(1);
    });

    it('should reject a malformed account id', async () => {
      expect(
        await errorsFor(AnalyticsAccountParamsDto, {
          connectedAccountId: 'nope',
        }),
      ).toHaveLength(1);
      expect(await errorsFor(AnalyticsAccountParamsDto, params)).toHaveLength(
        0,
      );
    });
  });
});
