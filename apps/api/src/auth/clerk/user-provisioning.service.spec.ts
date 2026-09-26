import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserProvisioningService } from './user-provisioning.service';

const makeService = () => {
  const userModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const tierModel = { findOne: jest.fn() };
  const clerkClient = { users: { getUser: jest.fn() } };
  const emailQueue = {
    addWelcomeEmailJob: jest.fn().mockResolvedValue(undefined),
  };
  const service = new UserProvisioningService(
    userModel as any,
    tierModel as any,
    clerkClient as any,
    emailQueue as any,
  );
  const fixtures = {
    clerkUserId: 'user_clerk_123',
    defaultTier: { _id: new Types.ObjectId() },
    clerkUser: {
      id: 'user_clerk_123',
      primaryEmailAddressId: 'idn_1',
      emailAddresses: [{ id: 'idn_1', emailAddress: 'a@b.com' }],
      firstName: 'Ada',
      lastName: 'Lovelace',
      username: 'ada',
      imageUrl: 'https://img/ada.png',
    },
  };

  return {
    service,
    mocks: { userModel, tierModel, clerkClient, emailQueue },
    fixtures,
  };
};

describe('UserProvisioningService', () => {
  let service: UserProvisioningService;
  let mocks: ReturnType<typeof makeService>['mocks'];
  let fixtures: ReturnType<typeof makeService>['fixtures'];

  beforeEach(() => {
    jest.clearAllMocks();
    ({ service, mocks, fixtures } = makeService());
  });

  describe('findOrCreate', () => {
    it('should return the existing user without calling Clerk when clerkId is already linked', async () => {
      const existing = { _id: new Types.ObjectId(), clerkId: 'user_clerk_123' };
      mocks.userModel.findOne.mockResolvedValueOnce(existing);

      await expect(service.findOrCreate(fixtures.clerkUserId)).resolves.toBe(
        existing,
      );
      expect(mocks.clerkClient.users.getUser).not.toHaveBeenCalled();
      expect(mocks.userModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('should atomically link an unclaimed existing email without sending a welcome email', async () => {
      const owner = {
        _id: new Types.ObjectId(),
        email: 'a@b.com',
        clerkId: undefined,
        avatar: undefined,
      };
      const linked = { ...owner, clerkId: fixtures.clerkUserId };
      mocks.userModel.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(owner);
      mocks.clerkClient.users.getUser.mockResolvedValueOnce(fixtures.clerkUser);
      mocks.userModel.findOneAndUpdate.mockResolvedValueOnce(linked);

      await expect(service.findOrCreate(fixtures.clerkUserId)).resolves.toBe(
        linked,
      );
      expect(mocks.userModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: owner._id }),
        {
          $set: {
            clerkId: fixtures.clerkUserId,
            avatar: 'https://img/ada.png',
          },
        },
        { new: true },
      );
      expect(mocks.emailQueue.addWelcomeEmailJob).not.toHaveBeenCalled();
    });

    it('should reject linking an email owned by another Clerk identity', async () => {
      mocks.userModel.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          _id: new Types.ObjectId(),
          email: 'a@b.com',
          clerkId: 'user_clerk_other',
        });
      mocks.clerkClient.users.getUser.mockResolvedValueOnce(fixtures.clerkUser);

      await expect(
        service.findOrCreate(fixtures.clerkUserId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mocks.userModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('should atomically create a user and send one welcome email when the upsert inserts', async () => {
      const created = { _id: new Types.ObjectId(), clerkId: 'user_clerk_123' };
      mocks.userModel.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mocks.clerkClient.users.getUser.mockResolvedValueOnce(fixtures.clerkUser);
      mocks.tierModel.findOne.mockResolvedValueOnce(fixtures.defaultTier);
      mocks.userModel.findOneAndUpdate.mockResolvedValueOnce({
        value: created,
        lastErrorObject: { upserted: created._id },
        ok: 1,
      });

      await expect(service.findOrCreate(fixtures.clerkUserId)).resolves.toBe(
        created,
      );
      expect(mocks.userModel.findOneAndUpdate).toHaveBeenCalledWith(
        { clerkId: fixtures.clerkUserId },
        {
          $setOnInsert: {
            clerkId: fixtures.clerkUserId,
            email: 'a@b.com',
            name: 'Ada Lovelace',
            avatar: 'https://img/ada.png',
            tier: fixtures.defaultTier._id,
          },
        },
        {
          includeResultMetadata: true,
          new: true,
          setDefaultsOnInsert: true,
          upsert: true,
        },
      );
      expect(mocks.emailQueue.addWelcomeEmailJob).toHaveBeenCalledTimes(1);
    });

    it('should not send a welcome email when a concurrent upsert returns the existing user', async () => {
      const existing = { _id: new Types.ObjectId(), clerkId: 'user_clerk_123' };
      mocks.userModel.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mocks.clerkClient.users.getUser.mockResolvedValueOnce(fixtures.clerkUser);
      mocks.tierModel.findOne.mockResolvedValueOnce(fixtures.defaultTier);
      mocks.userModel.findOneAndUpdate.mockResolvedValueOnce({
        value: existing,
        lastErrorObject: { updatedExisting: true },
        ok: 1,
      });

      await expect(service.findOrCreate(fixtures.clerkUserId)).resolves.toBe(
        existing,
      );
      expect(mocks.emailQueue.addWelcomeEmailJob).not.toHaveBeenCalled();
    });

    it('should surface a conflict when a concurrent signup claims the same email for another Clerk identity', async () => {
      mocks.userModel.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          _id: new Types.ObjectId(),
          email: 'a@b.com',
          clerkId: 'user_clerk_other',
        });
      mocks.clerkClient.users.getUser.mockResolvedValueOnce(fixtures.clerkUser);
      mocks.tierModel.findOne.mockResolvedValueOnce(fixtures.defaultTier);
      mocks.userModel.findOneAndUpdate.mockRejectedValueOnce(
        Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
      );

      await expect(
        service.findOrCreate(fixtures.clerkUserId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mocks.emailQueue.addWelcomeEmailJob).not.toHaveBeenCalled();
    });

    it('should still return the inserted user when welcome email enqueue fails', async () => {
      const created = { _id: new Types.ObjectId(), clerkId: 'user_clerk_123' };
      mocks.userModel.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mocks.clerkClient.users.getUser.mockResolvedValueOnce(fixtures.clerkUser);
      mocks.tierModel.findOne.mockResolvedValueOnce(fixtures.defaultTier);
      mocks.userModel.findOneAndUpdate.mockResolvedValueOnce({
        value: created,
        lastErrorObject: { upserted: created._id },
        ok: 1,
      });
      mocks.emailQueue.addWelcomeEmailJob.mockRejectedValueOnce(
        new Error('queue down'),
      );

      await expect(service.findOrCreate(fixtures.clerkUserId)).resolves.toBe(
        created,
      );
    });
  });
});
