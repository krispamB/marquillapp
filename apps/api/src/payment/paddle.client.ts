import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment, Paddle } from '@paddle/paddle-node-sdk';

@Injectable()
export class PaddleClient {
  private readonly paddle: Paddle;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.getOrThrow<string>('PADDLE_API_KEY');
    const environment =
      this.configService.get<string>('PADDLE_ENVIRONMENT') === 'production'
        ? Environment.production
        : Environment.sandbox;

    this.paddle = new Paddle(apiKey, { environment });
  }

  async createTransaction(input: {
    priceId: string;
    userId: string;
  }): Promise<{ checkoutUrl: string }> {
    const transaction = await this.paddle.transactions.create({
      items: [{ priceId: input.priceId, quantity: 1 }],
      customData: { userId: input.userId },
    });

    const url = transaction.checkout?.url;
    if (!url) {
      throw new InternalServerErrorException(
        'Paddle did not return a checkout URL',
      );
    }

    return { checkoutUrl: url };
  }

  async listTransactions(input: { customerId: string }): Promise<any[]> {
    const results: any[] = [];
    for await (const tx of this.paddle.transactions.list({
      customerId: [input.customerId],
    })) {
      results.push(tx);
    }
    return results;
  }

  async cancelSubscriptionAtPeriodEnd(subscriptionId: string): Promise<void> {
    await this.paddle.subscriptions.cancel(subscriptionId, {
      effectiveFrom: 'next_billing_period',
    });
  }

  getWebhooksHelper() {
    return this.paddle.webhooks;
  }
}
