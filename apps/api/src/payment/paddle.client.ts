import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Environment,
  Paddle,
  type Transaction,
  type TransactionStatus,
} from '@paddle/paddle-node-sdk';

// `draft` and `ready` are unfinished checkouts, not charges.
const INVOICE_HISTORY_STATUSES: TransactionStatus[] = [
  'billed',
  'paid',
  'completed',
  'past_due',
  'canceled',
];
const INVOICE_HISTORY_PAGE_SIZE = 30;

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

  /** The customer's most recent page of transactions, newest first. */
  async listRecentTransactions(input: {
    customerId: string;
  }): Promise<Transaction[]> {
    return this.paddle.transactions
      .list({
        customerId: [input.customerId],
        status: INVOICE_HISTORY_STATUSES,
        orderBy: 'created_at[DESC]',
        perPage: INVOICE_HISTORY_PAGE_SIZE,
      })
      .next();
  }

  async getTransaction(transactionId: string): Promise<Transaction> {
    return this.paddle.transactions.get(transactionId);
  }

  /** A link to the invoice PDF. Paddle expires it after an hour. */
  async getInvoicePdfUrl(transactionId: string): Promise<string> {
    const { url } = await this.paddle.transactions.getInvoicePDF(
      transactionId,
      { disposition: 'attachment' },
    );
    return url;
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
