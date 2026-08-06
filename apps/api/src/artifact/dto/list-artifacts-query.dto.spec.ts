import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

jest.mock(
  'src/database/schemas',
  () => ({
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
    VersionStatus: {
      GENERATING: 'GENERATING',
      READY: 'READY',
      FAILED: 'FAILED',
    },
  }),
  { virtual: true },
);

import { ListArtifactsQueryDto } from './list-artifacts-query.dto';

describe('ListArtifactsQueryDto', () => {
  describe('search', () => {
    it('should trim a valid search query when whitespace surrounds it', async () => {
      const dto = plainToInstance(ListArtifactsQueryDto, {
        search: '  deployment safety  ',
      });

      await expect(validate(dto)).resolves.toHaveLength(0);
      expect(dto.search).toBe('deployment safety');
    });

    it('should treat a whitespace-only search query as absent', async () => {
      const dto = plainToInstance(ListArtifactsQueryDto, {
        search: '   ',
      });

      await expect(validate(dto)).resolves.toHaveLength(0);
      expect(dto.search).toBeUndefined();
    });
  });
});
