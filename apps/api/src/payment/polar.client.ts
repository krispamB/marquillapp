import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Polar } from '@polar-sh/sdk';

@Injectable()
export class PolarClient {
  private readonly client: Polar;
  private readonly accessToken: string;

  constructor(private readonly configService: ConfigService) {
    this.accessToken = this.configService.get<string>('POLAR_ACCESS_TOKEN') ?? '';
    const serverURL = this.configService.get<string>('POLAR_API_BASE_URL');

    this.client = new Polar({
      accessToken: this.accessToken || undefined,
      serverURL: serverURL || undefined,
    });
  }

  async createCheckoutSession(input: {
    priceId: string;
    userId: string;
    successUrl: string;
    cancelUrl: string;
  }) {
    if (!this.accessToken) {
      throw new InternalServerErrorException('POLAR_ACCESS_TOKEN is not configured');
    }

    return this.client.checkoutLinks.create({
      productPriceId: input.priceId,
      paymentProcessor: 'stripe',
      successUrl: input.successUrl,
      returnUrl: input.cancelUrl,
      metadata: {
        userId: input.userId,
      },
    });
  }

  async listInvoices(input: { customerEmail?: string }) {
    if (!this.accessToken) {
      throw new InternalServerErrorException('POLAR_ACCESS_TOKEN is not configured');
    }

    return this.client.payments.list({
      customerEmail: input.customerEmail,
      limit: 100,
    });
  }
}
