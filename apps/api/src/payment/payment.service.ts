import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { IPaymentProvider, SubscriptionInput, PaymentResult } from './payment.interface';
import { StripeProvider } from './providers/stripe.provider';
import { PayPalProvider } from './providers/paypal.provider';
import { User } from '../database/schemas/user.schema';
import { PaymentProvider } from 'src/database/schemas';

@Injectable()
export class PaymentService {
    private readonly logger = new Logger(PaymentService.name);
    private providers: Map<PaymentProvider, IPaymentProvider>;

    constructor(
        private stripeProvider: StripeProvider,
        private paypalProvider: PayPalProvider,
    ) {
        this.providers = new Map();
        this.providers.set(PaymentProvider.STRIPE, stripeProvider);
        this.providers.set(PaymentProvider.PAYPAL, paypalProvider);
    }

    private getProvider(type: PaymentProvider): IPaymentProvider {
        const provider = this.providers.get(type);
        if (!provider) {
            throw new BadRequestException(`Payment provider ${type} not supported`);
        }
        return provider;
    }

    async createCustomer(user: User, providerType: PaymentProvider): Promise<string> {
        const provider = this.getProvider(providerType);
        return provider.createCustomer(user);
    }

    async createSubscription(input: SubscriptionInput, providerType: PaymentProvider): Promise<PaymentResult> {
        const provider = this.getProvider(providerType);
        return provider.createSubscription(input);
    }

    async cancelSubscription(subscriptionId: string, providerType: PaymentProvider): Promise<void> {
        const provider = this.getProvider(providerType);
        return provider.cancelSubscription(subscriptionId);
    }
}
