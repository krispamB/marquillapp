import { Types } from 'mongoose';

jest.mock(
  '../database/schemas',
  () => ({
    BillingInterval: {
      MONTHLY: 'monthly',
      YEARLY: 'yearly',
    },
    PaymentProvider: {
      POLAR: 'POLAR',
    },
    SubscriptionStatus: {
      ACTIVE: 'ACTIVE',
      CANCELED: 'CANCELED',
      EXPIRED: 'EXPIRED',
      PAST_DUE: 'PAST_DUE',
    },
    User: class User {},
    Tier: class Tier {},
    Subscription: class Subscription {},
    BillingCustomer: class BillingCustomer {},
    Usage: class Usage {},
  }),
  { virtual: true },
);

import { PaymentController } from './payment.controller';

describe('PaymentController', () => {
  it('cancels subscription for current user', async () => {
    const paymentService = {
      cancelSubscription: jest.fn().mockResolvedValue({ ok: true }),
    };
    const controller = new PaymentController(paymentService as any);
    const userId = new Types.ObjectId();

    const result = await controller.cancelSubscription({ _id: userId } as any);

    expect(paymentService.cancelSubscription).toHaveBeenCalledWith(
      userId.toString(),
    );
    expect(result).toEqual({ ok: true });
  });

  it('returns usage summary for current user', async () => {
    const usageSummary = {
      tier: { id: 'tier-id', name: 'Free' },
      billingCycle: {
        start: new Date('2026-04-01T00:00:00.000Z'),
        end: new Date('2026-05-01T00:00:00.000Z'),
        source: 'default',
      },
      usage: {
        connected_accounts: { used: 1, limit: 1, remaining: 0 },
        ai_drafts: { used: 2, limit: 5, remaining: 3 },
        scheduled_posts: { used: 0, limit: 3, remaining: 3 },
      },
    };
    const paymentService = {
      getUsageSummary: jest.fn().mockResolvedValue(usageSummary),
    };
    const controller = new PaymentController(paymentService as any);
    const userId = new Types.ObjectId();

    const result = await controller.getUsage({ _id: userId } as any);

    expect(paymentService.getUsageSummary).toHaveBeenCalledWith(
      userId.toString(),
    );
    expect(result).toEqual({
      statusCode: 200,
      message: 'Usage summary fetched successfully',
      data: usageSummary,
    });
  });
});
