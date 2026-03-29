import { Types } from 'mongoose';
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
});
