import { Controller, Get, HttpStatus, UseGuards } from '@nestjs/common';
import { TierService } from './tier.service';
import { IAppResponse } from '../common/interfaces';
import { JwtAuthGuard } from '../common/guards';
import { GetUser } from '../common/decorators';
import { User } from '../database/schemas';

@Controller('tiers')
export class TierController {
  constructor(private readonly tierService: TierService) {}

  @Get('active')
  async getActiveTiers(): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Active tiers fetched successfully',
      data: await this.tierService.getActiveTiers(),
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMyTier(@GetUser() user: User): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'User tier fetched successfully',
      data: await this.tierService.getMyTier(user._id.toString()),
    };
  }
}
