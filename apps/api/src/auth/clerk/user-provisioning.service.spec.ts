import { Types } from 'mongoose';
import { UserProvisioningService } from './user-provisioning.service';

const makeService = () => {
  const userModel = {
    findOne: jest.fn(),
    create: jest.fn(),
  };
  const tierModel = {
    findOne: jest.fn(),
  };
  const clerkClient = {
    users: {
      getUser: jest.fn(),
    },
  };
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
      emailAddresses: [
        { id: 'idn_1', emailAddress: 'a@b.com' },
        { id: 'idn_2', emailAddress: 'old@b.com' },
      ],
      firstName: 'Ada',
      lastName: 'Lovelace',
      username: 'ada',
      imageUrl: 'https://img/ada.png',
    },
  };

  return { service, mocks: { userModel, tierModel, clerkClient, emailQueue }, fixtures };
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
      const existing = { _id: new Types.ObjectId(), clerkId: fixtures.clerkUserId };
      mocks.userModel.findOne.mockResolvedValueOnce(existing);

      const result = await service.findOrCreate(fixtures.clerkUserId);

      expect(result).toBe(existing);
      expect(mocks.clerkClient.users.getUser).not.toHaveBeenCalled();
      expect(mocks.userModel.create).not.toHaveBeenCalled();
    });

    it('should link an existing user by email when clerkId is not yet set', async () => {
      const linked = {
        _id: new Types.ObjectId(),
        email: 'a@b.com',
        avatar: undefined,
        clerkId: undefined as string | undefined,
        save: jest.fn().mockResolvedValue(undefined),
      };
      mocks.userModel.findOne
        .mockResolvedValueOnce(null) // by clerkId
        .mockResolvedValueOnce(linked); // by email
      mocks.clerkClient.users.getUser.mockResolvedValueOnce(fixtures.clerkUser);

      const result = await service.findOrCreate(fixtures.clerkUserId);

      expect(result).toBe(linked);
      expect(linked.clerkId).toBe(fixtures.clerkUserId);
      expect(linked.avatar).toBe('https://img/ada.png');
      expect(linked.save).toHaveBeenCalledTimes(1);
      expect(mocks.userModel.create).not.toHaveBeenCalled();
      expect(mocks.emailQueue.addWelcomeEmailJob).not.toHaveBeenCalled();
    });

    it('should create a new user with the default tier and enqueue a welcome email when no match exists', async () => {
      const created = { _id: new Types.ObjectId(), clerkId: fixtures.clerkUserId };
      mocks.userModel.findOne
        .mockResolvedValueOnce(null) // by clerkId
        .mockResolvedValueOnce(null); // by email
      mocks.clerkClient.users.getUser.mockResolvedValueOnce(fixtures.clerkUser);
      mocks.tierModel.findOne.mockResolvedValueOnce(fixtures.defaultTier);
      mocks.userModel.create.mockResolvedValueOnce(created);

      const result = await service.findOrCreate(fixtures.clerkUserId);

      expect(result).toBe(created);
      expect(mocks.userModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          clerkId: fixtures.clerkUserId,
          email: 'a@b.com',
          name: 'Ada Lovelace',
          avatar: 'https://img/ada.png',
          tier: fixtures.defaultTier._id,
        }),
      );
      expect(mocks.emailQueue.addWelcomeEmailJob).toHaveBeenCalledWith(
        'a@b.com',
        'Ada Lovelace',
      );
    });

    it('should still create the user when the welcome email enqueue fails', async () => {
      const created = { _id: new Types.ObjectId() };
      mocks.userModel.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mocks.clerkClient.users.getUser.mockResolvedValueOnce(fixtures.clerkUser);
      mocks.tierModel.findOne.mockResolvedValueOnce(fixtures.defaultTier);
      mocks.userModel.create.mockResolvedValueOnce(created);
      mocks.emailQueue.addWelcomeEmailJob.mockRejectedValueOnce(new Error('queue down'));

      await expect(service.findOrCreate(fixtures.clerkUserId)).resolves.toBe(created);
    });
  });
});
