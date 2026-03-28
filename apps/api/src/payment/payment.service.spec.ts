import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { PaymentService } from './payment.service';
import { SubscriptionStatus } from '../database/schemas/subscription.schema';

describe('PaymentService.cancelSubscription', () => {
  const makeService = () => {
    const userModel = {};
    const tierModel = {};
    const subscriptionModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    const billingCustomerModel = {};
    const polarClient = {
      cancelSubscriptionAtPeriodEnd: jest.fn(),
    };
    const configService = {};
    const redisService = {
      getClient: jest.fn(),
    };

    const service = new PaymentService(
      userModel as any,
      tierModel as any,
      subscriptionModel as any,
      billingCustomerModel as any,
      polarClient as any,
      configService as any,
      redisService as any,
    );

    return {
      service,
      mocks: {
        subscriptionModel,
        polarClient,
      },
    };
  };

  it('cancels active subscription at period end', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const subscription = {
      status: SubscriptionStatus.ACTIVE,
      cancelAtPeriodEnd: false,
      polarSubscriptionId: 'sub_123',
    };

    mocks.subscriptionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(subscription),
    });

    const billingSummary = { ok: true };
    jest
      .spyOn(service, 'getBillingSummary')
      .mockResolvedValue(billingSummary as any);

    const result = await service.cancelSubscription(userId);

    expect(
      mocks.polarClient.cancelSubscriptionAtPeriodEnd,
    ).toHaveBeenCalledWith('sub_123');
    expect(mocks.subscriptionModel.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: expect.any(Types.ObjectId) },
      { cancelAtPeriodEnd: true },
      { new: true },
    );
    expect(result).toBe(billingSummary);
  });

  it('is idempotent when already set to cancel at period end', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const subscription = {
      status: SubscriptionStatus.ACTIVE,
      cancelAtPeriodEnd: true,
      polarSubscriptionId: 'sub_123',
    };

    mocks.subscriptionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(subscription),
    });

    const billingSummary = { ok: true };
    jest
      .spyOn(service, 'getBillingSummary')
      .mockResolvedValue(billingSummary as any);

    const result = await service.cancelSubscription(userId);

    expect(
      mocks.polarClient.cancelSubscriptionAtPeriodEnd,
    ).not.toHaveBeenCalled();
    expect(mocks.subscriptionModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(result).toBe(billingSummary);
  });

  it('throws when subscription is missing', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();

    mocks.subscriptionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    await expect(service.cancelSubscription(userId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws when subscription is missing Polar reference', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const subscription = {
      status: SubscriptionStatus.ACTIVE,
      cancelAtPeriodEnd: false,
      polarSubscriptionId: undefined,
    };

    mocks.subscriptionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(subscription),
    });

    await expect(service.cancelSubscription(userId)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});
