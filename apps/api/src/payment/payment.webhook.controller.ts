import {
  BadRequestException,
  Controller,
  Headers,
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

  @Post('polar')
  @HttpCode(HttpStatus.OK)
  async handlePolarWebhook(
    @Req() request: RawBodyRequest,
    @Headers('x-polar-signature') signatureHeader?: string,
    @Headers('polar-signature') fallbackSignatureHeader?: string,
  ) {
    const rawBody = request.rawBody;
    if (!rawBody) {
      this.logger.error('Polar webhook missing raw body. Ensure rawBody is enabled.');
      throw new BadRequestException('Webhook raw body not available');
    }

    const result = await this.paymentService.handlePolarWebhook(
      rawBody,
      signatureHeader ?? fallbackSignatureHeader,
    );

    return { ok: true, ...result };
  }
}
