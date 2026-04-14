import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentService } from './payment.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('payment/webhooks')
export class PaymentWebhookController {
  private readonly logger = new Logger(PaymentWebhookController.name);

  constructor(private readonly paymentService: PaymentService) {}

  @Post('paddle')
  @HttpCode(HttpStatus.OK)
  async handlePaddleWebhook(@Req() request: RawBodyRequest) {
    const rawBody = request.rawBody;
    if (!rawBody) {
      this.logger.error(
        'Paddle webhook missing raw body. Ensure rawBody is enabled.',
      );
      throw new BadRequestException('Webhook raw body not available');
    }

    const paddleSignature = request.headers['paddle-signature'];
    if (!paddleSignature || Array.isArray(paddleSignature)) {
      throw new BadRequestException('Missing or invalid paddle-signature header');
    }

    const result = await this.paymentService.handlePaddleWebhook(
      rawBody,
      paddleSignature,
    );
    return { ok: true, ...result };
  }
}
