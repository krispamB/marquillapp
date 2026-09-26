import { Types } from 'mongoose';

jest.mock(
  '../database/schemas',
  () => ({
    BillingInterval: {
      MONTHLY: 'monthly',
      YEARLY: 'yearly',
    },
    PaymentProvider: {
      PADDLE: 'PADDLE',
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
    Artifact: class Artifact {},
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
  }),
  { virtual: true },
);

import { PaymentController } from './payment.controller';

describe('PaymentController', () => {
  describe('createCheckout', () => {
    const makeService = () => {
      const paymentService = {
        createCheckoutSession: jest.fn(),
      };
      const controller = new PaymentController(paymentService as any);

      return { controller, mocks: { paymentService } };
    };

    let controller: PaymentController;
    let mocks: ReturnType<typeof makeService>['mocks'];

    beforeEach(() => {
      ({ controller, mocks } = makeService());
    });

    it('should create a checkout transaction when given an authenticated user and price', async () => {
      const checkout = { transactionId: 'txn_123' };
      const userId = new Types.ObjectId();
      mocks.paymentService.createCheckoutSession.mockResolvedValue(checkout);

      const result = await controller.createCheckout({ _id: userId } as any, {
        priceId: 'pri_01gm81eqze2vmmvhpjg13bfeqg',
      });

      expect(mocks.paymentService.createCheckoutSession).toHaveBeenCalledWith(
        userId.toString(),
        'pri_01gm81eqze2vmmvhpjg13bfeqg',
      );
      expect(result).toEqual(checkout);
    });
  });

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
        scheduled_posts: { used: 0, limit: 3, remaining: 3 },
        credits: { used: 200, limit: 2000, remaining: 1800 },
      },
      artifactsCreated: { posts: 3, polls: 2, documents: 1 },
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
