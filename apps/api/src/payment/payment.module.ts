import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { StripeProvider } from './providers/stripe.provider';
import { PayPalProvider } from './providers/paypal.provider';

@Module({
    providers: [PaymentService, StripeProvider, PayPalProvider],
    exports: [PaymentService],
})
export class PaymentModule { }
