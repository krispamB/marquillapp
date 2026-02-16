import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { PostService } from './post.service';
import { InputDto } from '../agent/dto';
import { UpdatePostDto, SchedulePostDto } from './dto';
import { JwtAuthGuard } from '../common/guards';
import { IAppResponse } from 'src/common/interfaces';
import { GetUser } from 'src/common/decorators';
import { User } from 'src/database/schemas';
import { FileInterceptor } from '@nestjs/platform-express';

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

  @Put(':id/image')
  @UseInterceptors(FileInterceptor('file'))
  async getUploadUrl(
    @GetUser() user: User,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<IAppResponse> {
    await this.postService.addLinkedinMedia(user, id, file);
    return {
      statusCode: HttpStatus.OK,
      message: 'Image Upload Successful',
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/publish')
  async publishOnLinkedIn(
    @GetUser() user: User,
    @Param('id') id: string,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Post published successfully',
      data: await this.postService.publishOnLinkedIn(user, id),
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/schedule')
  async schedulePost(
    @GetUser() user: User,
    @Param('id') id: string,
    @Body() dto: SchedulePostDto,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Post scheduled successfully',
      data: await this.postService.schedulePost(user, id, dto),
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
    @Query('status') status?: string,
    @Query('month') month?: string,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Posts retrieved successfully',
      data: await this.postService.getPosts(user, accountConnected, status, month),
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

  @Delete(':id')
  async deletePost(
    @GetUser() user: User,
    @Param('id') id: string,
  ): Promise<IAppResponse> {
    await this.postService.deletePost(user, id);
    return {
      statusCode: HttpStatus.OK,
      message: 'Post deleted successfully',
    };
  }


  @Get('metrics/:connectedAccountId')
  async getPostMetrics(
    @GetUser() user: User,
    @Param('connectedAccountId') connectedAccountId: string,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Post metrics retrieved successfully',
      data: await this.postService.getPostMetrics(user, connectedAccountId),
    };
  }

  @Get(':id')
  async getPostById(
    @GetUser() user: User,
    @Param('id') id: string,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Post retrieved successfully',
      data: await this.postService.getPost(user, id),
    };
  }
}
