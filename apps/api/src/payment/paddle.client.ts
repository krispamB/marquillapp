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
    userData: {
      userId: string;
      name: string;
    };
  }): Promise<{ transactionId: string }> {
    const transaction = await this.paddle.transactions.create({
      items: [{ priceId: input.priceId, quantity: 1 }],
      customData: {
        userId: input.userData.userId,
        userName: input.userData.name,
      },
    });

    if (!transaction.id) {
      throw new InternalServerErrorException(
        'Paddle did not return a transaction ID',
      );
    }

    return { transactionId: transaction.id };
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
