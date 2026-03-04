import {
  BadRequestException,
  ForbiddenException,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { WebhookVerificationError } from '@polar-sh/sdk/webhooks';
import { PaymentService } from './payment.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('payment/webhooks')
export class PaymentWebhookController {
  private readonly logger = new Logger(PaymentWebhookController.name);

  constructor(private readonly paymentService: PaymentService) {}

  @Post('polar')
  @HttpCode(HttpStatus.OK)
  async handlePolarWebhook(@Req() request: RawBodyRequest) {
    const rawBody = request.rawBody;
    if (!rawBody) {
      this.logger.error(
        'Polar webhook missing raw body. Ensure rawBody is enabled.',
      );
      throw new BadRequestException('Webhook raw body not available');
    }

    try {
      const result = await this.paymentService.handlePolarWebhook(
        rawBody,
        request.headers,
      );
      return { ok: true, ...result };
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        throw new ForbiddenException('Invalid webhook signature');
      }
      throw error;
    }
  }
}
