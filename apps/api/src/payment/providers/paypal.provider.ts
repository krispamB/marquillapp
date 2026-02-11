import { Injectable, Logger } from '@nestjs/common';
import { IPaymentProvider, PaymentResult, SubscriptionInput } from '../payment.interface';
import { User } from '../../database/schemas/user.schema';

@Injectable()
export class PayPalProvider implements IPaymentProvider {
    private readonly logger = new Logger(PayPalProvider.name);

    async createCustomer(user: User): Promise<string> {
        this.logger.log(`Creating PayPal customer for user ${user.email}`);
        // Stub: Return a fake PayPal Customer ID (or Payer ID context)
        return `payer_paypal_${Date.now()}`;
    }

    async createSubscription(input: SubscriptionInput): Promise<PaymentResult> {
        this.logger.log(`Creating PayPal subscription for user ${input.userId}`);
        // Stub: Return success
        return {
            success: true,
            subscriptionId: `I-PAYPAL_${Date.now()}`,
            status: 'ACTIVE',
        };
    }

    async cancelSubscription(subscriptionId: string): Promise<void> {
        this.logger.log(`Cancelling PayPal subscription ${subscriptionId}`);
        // Stub: successful cancellation
    }
}
