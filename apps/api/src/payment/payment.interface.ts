import { User } from '../database/schemas/user.schema';
import { BillingCycle } from '../database/schemas/subscription.schema';

export interface SubscriptionInput {
    userId: string;
    tierId: string;
    billingCycle: BillingCycle;
    paymentMethodId?: string; // Token from frontend
    metadata?: Record<string, any>;
}

export interface PaymentResult {
    success: boolean;
    subscriptionId?: string; // Provider's subscription ID
    clientSecret?: string; // For frontend confirmation if needed
    status: string;
    metadata?: Record<string, any>;
}

export interface IPaymentProvider {
    createCustomer(user: User): Promise<string>; // Returns provider customer ID
    createSubscription(input: SubscriptionInput): Promise<PaymentResult>;
    cancelSubscription(subscriptionId: string): Promise<void>;
}