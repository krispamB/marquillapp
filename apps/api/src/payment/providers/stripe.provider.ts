import { Injectable, Logger } from '@nestjs/common';
import { IPaymentProvider, PaymentResult, SubscriptionInput } from '../payment.interface';
import { User } from '../../database/schemas/user.schema';

@Injectable()
export class StripeProvider implements IPaymentProvider {
    private readonly logger = new Logger(StripeProvider.name);

    async createCustomer(user: User): Promise<string> {
        this.logger.log(`Creating Stripe customer for user ${user.email}`);
        // Stub: Return a fake Stripe Customer ID
        return `cus_stripe_${Date.now()}`;
    }

    async createSubscription(input: SubscriptionInput): Promise<PaymentResult> {
        this.logger.log(`Creating Stripe subscription for user ${input.userId}`);
        // Stub: Return success
        return {
            success: true,
            subscriptionId: `sub_stripe_${Date.now()}`,
            status: 'active',
            clientSecret: 'seti_fake_secret',
        };
    }

    async cancelSubscription(subscriptionId: string): Promise<void> {
        this.logger.log(`Cancelling Stripe subscription ${subscriptionId}`);
        // Stub: successful cancellation
    }
}
