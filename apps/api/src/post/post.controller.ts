import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PostService } from './post.service';
import { InputDto } from '../agent/dto';
import { UpdatePostDto } from './dto';
import { JwtAuthGuard } from '../common/guards';
import { IAppResponse } from 'src/common/interfaces';
import { GetUser } from 'src/common/decorators';
import { User } from 'src/database/schemas';

@UseGuards(JwtAuthGuard)
@Controller('posts')
export class PostController {
  constructor(private readonly postService: PostService) { }

  @HttpCode(HttpStatus.CREATED)
  @Post(':id/draft')
  async createDraft(
    @GetUser() user: User,
    @Param('id') accountId: string,
    @Body() dto: InputDto,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.CREATED,
      message: 'Draft created successfully',
      data: await this.postService.createDraft(user, accountId, dto),
    };
  }

  @Get(':id/status')
  async getStatus(@Param('id') id: string): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Draft status retrieved successfully',
      data: await this.postService.getStatus(id),
    };
  }

  @Get()
  async getPosts(
    @GetUser() user: User,
    @Query('accountConnected') accountConnected?: string,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Posts retrieved successfully',
      data: await this.postService.getPosts(user, accountConnected),
    };
  }

  @Patch(':id')
  async updateContent(
    @GetUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Post content updated successfully',
      data: await this.postService.updateContent(user, id, dto),
    };
  }
}

