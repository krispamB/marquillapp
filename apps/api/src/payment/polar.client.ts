import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Polar } from '@polar-sh/sdk';

@Injectable()
export class PolarClient {
  private readonly client: Polar;
  private readonly accessToken: string;

  constructor(private readonly configService: ConfigService) {
    this.accessToken =
      this.configService.getOrThrow<string>('POLAR_ACCESS_TOKEN') ?? '';

    this.client = new Polar({
      accessToken: this.accessToken || undefined,
      server: this.configService.get<'production' | 'sandbox'>('POLAR_MODE'),
    });
  }

  async createCheckoutSession(input: {
    priceId: string;
    userId: string;
    successUrl: string;
    cancelUrl: string;
  }) {
    if (!this.accessToken) {
      throw new InternalServerErrorException(
        'POLAR_ACCESS_TOKEN is not configured',
      );
    }

    return this.client.checkouts.create({
      products: [input.priceId],
      successUrl: input.successUrl,
      metadata: {
        userId: input.userId,
      },
    });
  }

  async listInvoices(input: { customerEmail?: string }) {
    if (!this.accessToken) {
      throw new InternalServerErrorException(
        'POLAR_ACCESS_TOKEN is not configured',
      );
    }

    return this.client.payments.list({
      customerEmail: input.customerEmail,
      limit: 100,
    });
  }
}
