import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../common/guards';
import { GetUser } from '../common/decorators';
import { User } from '../database/schemas';
import { CreateCheckoutDto } from './payment.dto';
import { IAppResponse } from '../common/interfaces';

@UseGuards(JwtAuthGuard)
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  async createCheckout(@GetUser() user: User, @Body() dto: CreateCheckoutDto) {
    return this.paymentService.createCheckoutSession(
      user._id.toString(),
      dto.tierId,
      dto.billingInterval,
    );
  }

  @Get('subscription')
  async getSubscription(@GetUser() user: User) {
    return this.paymentService.getBillingSummary(user._id.toString());
  }

  @Get('invoices')
  async getInvoices(@GetUser() user: User) {
    return this.paymentService.getInvoiceHistory(user._id.toString());
  }

  @Get('usage')
  async getUsage(@GetUser() user: User): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Usage summary fetched successfully',
      data: await this.paymentService.getUsageSummary(user._id.toString()),
    };
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  async cancelSubscription(@GetUser() user: User) {
    return this.paymentService.cancelSubscription(user._id.toString());
  }
}
