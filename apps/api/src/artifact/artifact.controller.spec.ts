jest.mock(
  '../auth/clerk/clerk-auth.guard',
  () => ({
    ClerkAuthGuard: class ClerkAuthGuard {},
  }),
  { virtual: true },
);
jest.mock('../common/decorators', () => ({ GetUser: () => () => undefined }), {
  virtual: true,
});
jest.mock('../database/schemas', () => ({ User: class User {} }), {
  virtual: true,
});
jest.mock(
  './artifact-generation.service',
  () => ({
    ArtifactGenerationService: class ArtifactGenerationService {},
  }),
  { virtual: true },
);
jest.mock(
  './artifact.service',
  () => ({ ArtifactService: class ArtifactService {} }),
  { virtual: true },
);
jest.mock(
  './dto',
  () => ({
    CreateArtifactDto: class CreateArtifactDto {},
    GetArtifactQueryDto: class GetArtifactQueryDto {},
    ListArtifactsQueryDto: class ListArtifactsQueryDto {},
    RefineArtifactDto: class RefineArtifactDto {},
    UpdateArtifactDto: class UpdateArtifactDto {},
  }),
  { virtual: true },
);

import { ArtifactController } from './artifact.controller';

describe('ArtifactController', () => {
  describe('refine', () => {
    it('should delegate the owner, artifact, and feedback when refining', async () => {
      const generation = {
        launchRefineRun: jest.fn().mockResolvedValue({
          artifactId: 'artifact-1',
          version: 2,
          runId: 'run-2',
        }),
      };
      const controller = new ArtifactController(generation as any, {} as any);
      const user = { _id: { toString: () => 'user-1' } };

      await expect(
        controller.refine(user as any, 'artifact-1', {
          feedback: 'Make the hook sharper',
        }),
      ).resolves.toEqual({
        artifactId: 'artifact-1',
        version: 2,
        runId: 'run-2',
      });

      expect(generation.launchRefineRun).toHaveBeenCalledWith(
        'user-1',
        'artifact-1',
        'Make the hook sharper',
      );
    });
  });

  describe('library routes', () => {
    it('returns list data and filter/page metadata', async () => {
      const library = {
        listArtifacts: jest.fn().mockResolvedValue({
          data: [{ id: 'artifact-1' }],
          filters: { availableMonths: ['2026-07'], types: ['POST'] },
          page: 1,
          pages: 1,
        }),
      };
      const controller = new ArtifactController(
        { launchInitialRun: jest.fn() } as any,
        library as any,
      );

      await expect(
        controller.list(
          { _id: { toString: () => 'user-1' } } as any,
          { month: '2026-07', search: 'deployment', page: 1 } as any,
        ),
      ).resolves.toMatchObject({
        statusCode: 200,
        data: [{ id: 'artifact-1' }],
        filters: { availableMonths: ['2026-07'], types: ['POST'] },
        page: 1,
        pages: 1,
      });
      expect(library.listArtifacts).toHaveBeenCalledWith('user-1', {
        month: '2026-07',
        search: 'deployment',
        page: 1,
      });
    });
  });
});
