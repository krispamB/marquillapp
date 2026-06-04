jest.mock('src/database/schemas', () => ({ Artifact: { name: 'Artifact' } }), {
  virtual: true,
});

jest.mock('@nestjs/mongoose', () => ({ InjectModel: () => () => {} }), {
  virtual: true,
});

import { Types } from 'mongoose';
import { ArtifactService, SaveArtifactInput } from './artifact.service';

const makeService = () => {
  const artifactModel = { create: jest.fn() };
  const service = new ArtifactService(artifactModel as any);
  return { service, mocks: { artifactModel } };
};

describe('ArtifactService', () => {
  let service: ArtifactService;
  let mocks: ReturnType<typeof makeService>['mocks'];

  beforeEach(() => {
    jest.clearAllMocks();
    ({ service, mocks } = makeService());
  });

  describe('saveArtifact', () => {
    const userId = new Types.ObjectId().toString();

    it('should create a post artifact and return its recordId', async () => {
      const insertedId = new Types.ObjectId();
      mocks.artifactModel.create.mockResolvedValue({ _id: insertedId });

      const input: SaveArtifactInput = {
        type: 'text',
        title: 'My Post',
        description: 'A LinkedIn post',
        post: { content: 'Hello LinkedIn', title: 'My Post' },
      };

      const result = await service.saveArtifact(userId, input);

      expect(result).toEqual({ recordId: insertedId.toString() });
      expect(mocks.artifactModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'text',
          title: 'My Post',
          description: 'A LinkedIn post',
          post: { content: 'Hello LinkedIn', title: 'My Post' },
          user: expect.any(Types.ObjectId),
        }),
      );
    });

    it('should create a poll artifact and return its recordId', async () => {
      const insertedId = new Types.ObjectId();
      mocks.artifactModel.create.mockResolvedValue({ _id: insertedId });

      const input: SaveArtifactInput = {
        type: 'structured',
        title: 'My Poll',
        description: 'A LinkedIn poll',
        poll: {
          content: { question: 'Best format?', options: ['Post', 'Poll'] },
          title: 'My Poll',
        },
      };

      const result = await service.saveArtifact(userId, input);

      expect(result).toEqual({ recordId: insertedId.toString() });
      expect(mocks.artifactModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'structured', poll: input.poll }),
      );
    });

    it('should create a document artifact with storageUrl mapped to document field', async () => {
      const insertedId = new Types.ObjectId();
      mocks.artifactModel.create.mockResolvedValue({ _id: insertedId });

      const input: SaveArtifactInput = {
        type: 'html',
        title: 'My Doc',
        description: 'A one-pager',
        storageUrl: 'https://cdn.example.com/file.pdf',
      };

      await service.saveArtifact(userId, input);

      expect(mocks.artifactModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          document: 'https://cdn.example.com/file.pdf',
        }),
      );
    });

    it('should not include post, poll, or document fields when not provided', async () => {
      mocks.artifactModel.create.mockResolvedValue({
        _id: new Types.ObjectId(),
      });

      await service.saveArtifact(userId, {
        type: 'text',
        title: 'T',
        description: 'D',
      });

      const arg = mocks.artifactModel.create.mock.calls[0][0];
      expect(arg).not.toHaveProperty('post');
      expect(arg).not.toHaveProperty('poll');
      expect(arg).not.toHaveProperty('document');
    });

    it('should propagate errors from artifactModel.create', async () => {
      mocks.artifactModel.create.mockRejectedValue(
        new Error('DB write failed'),
      );

      await expect(
        service.saveArtifact(userId, {
          type: 'text',
          title: 'T',
          description: 'D',
        }),
      ).rejects.toThrow('DB write failed');
    });
  });
});
