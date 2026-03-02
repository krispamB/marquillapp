import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Polar } from '@polar-sh/sdk';
import { createHmac, timingSafeEqual } from 'crypto';

@Injectable()
export class PolarClient {
  private readonly client: Polar;
  private readonly accessToken: string;
  private readonly webhookSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.accessToken = this.configService.get<string>('POLAR_ACCESS_TOKEN') ?? '';
    this.webhookSecret = this.configService.get<string>('POLAR_WEBHOOK_SECRET') ?? '';
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

  verifyWebhookSignature(rawBody: Buffer, incomingSignature?: string): void {
    if (!this.webhookSecret) {
      throw new InternalServerErrorException('POLAR_WEBHOOK_SECRET is not configured');
    }

    if (!incomingSignature) {
      throw new BadRequestException('Missing Polar webhook signature');
    }

    const signature = incomingSignature.trim().replace(/^sha256=/, '');
    const expectedHex = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
    const expectedBase64 = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('base64');

    const isHexMatch = this.safeCompare(expectedHex, signature);
    const isBase64Match = this.safeCompare(expectedBase64, signature);

    if (!isHexMatch && !isBase64Match) {
      throw new BadRequestException('Invalid Polar webhook signature');
    }
  }

  private safeCompare(a: string, b: string): boolean {
    const aBuffer = Buffer.from(a);
    const bBuffer = Buffer.from(b);
    if (aBuffer.length !== bBuffer.length) return false;
    return timingSafeEqual(aBuffer, bBuffer);
  }
}
