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
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { PostService } from './post.service';
import {
  ComparePostsQueryDto,
  CompleteMediaUploadDto,
  InitiateMediaUploadDto,
  SchedulePostDto,
  CreatePostDto,
  GetPostsQueryDto,
  UpdatePostDto,
  UpdateMediaDto,
} from './dto';
import { SubscriptionAccessGuard } from '../common/guards';
import { ClerkAuthGuard } from '../auth/clerk';
import { IAppResponse } from 'src/common/interfaces';
import { GetUser } from 'src/common/decorators';
import { User } from 'src/database/schemas';
import type { GetPostsResult } from './post.service';

@UseGuards(ClerkAuthGuard)
@Controller('posts')
export class PostController {
  constructor(private readonly postService: PostService) {}

  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SubscriptionAccessGuard)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @Post()
  async createPost(
    @GetUser() user: User,
    @Body() dto: CreatePostDto,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.CREATED,
      message: 'Post created successfully',
      data: await this.postService.createPost(user, dto),
    };
  }

  @Patch(':id')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async updatePost(
    @GetUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Post updated successfully',
      data: await this.postService.updatePost(user, id, dto),
    };
  }

  @HttpCode(HttpStatus.CREATED)
  @Post(':id/media/uploads')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async initiateMediaUpload(
    @GetUser() user: User,
    @Param('id') id: string,
    @Body() dto: InitiateMediaUploadDto,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.CREATED,
      message: 'Upload slots created',
      data: await this.postService.initiateMediaUpload(user, id, dto),
    };
  }

  @HttpCode(HttpStatus.ACCEPTED)
  @Post(':id/media/uploads/complete')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async completeMediaUpload(
    @GetUser() user: User,
    @Param('id') id: string,
    @Body() dto: CompleteMediaUploadDto,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.ACCEPTED,
      message: 'Media upload started',
      data: await this.postService.completeMediaUpload(user, id, dto),
    };
  }

  @Patch(':postId/media/:mediaId')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async updateMedia(
    @GetUser() user: User,
    @Param('postId') postId: string,
    @Param('mediaId') mediaId: string,
    @Body() dto: UpdateMediaDto,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Post media updated successfully',
      data: await this.postService.updateMedia(user, postId, mediaId, dto),
    };
  }

  @Delete(':postId/media/:mediaId')
  async removeMedia(
    @GetUser() user: User,
    @Param('postId') postId: string,
    @Param('mediaId') mediaId: string,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Post media removed successfully',
      data: await this.postService.removeMedia(user, postId, mediaId),
    };
  }

  @Get(':postId/media/:mediaId/preview')
  async getMediaPreview(
    @GetUser() user: User,
    @Param('postId') postId: string,
    @Param('mediaId') mediaId: string,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Post media preview retrieved successfully',
      data: await this.postService.getMediaPreview(user, postId, mediaId),
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/publish')
  async publishPost(
    @GetUser() user: User,
    @Param('id') id: string,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Post published successfully',
      data: await this.postService.publishPostNow(user, id),
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

  @HttpCode(HttpStatus.OK)
  @Post(':id/unschedule')
  async unschedulePost(
    @GetUser() user: User,
    @Param('id') id: string,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Post returned to draft successfully',
      data: await this.postService.unschedulePost(user, id),
    };
  }

  @Get()
  async getPosts(
    @GetUser() user: User,
    @Query() query: GetPostsQueryDto,
  ): Promise<IAppResponse> {
    const result: GetPostsResult = await this.postService.getPosts(
      user,
      query.connectedAccount,
      query.status,
      query.month,
      query.page,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Posts retrieved successfully',
      data: result.data,
      filters: result.filters,
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

  @Get('linkedin/image/:urn')
  async getLinkedinImage(
    @GetUser() user: User,
    @Param('urn') urn: string,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Image details retrieved successfully',
      data: await this.postService.getLinkedinImage(user, urn),
    };
  }

  @Get('comparison')
  async comparePosts(
    @GetUser() user: User,
    @Query() query: ComparePostsQueryDto,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Post comparison retrieved successfully',
      data: await this.postService.comparePostsByMonth(
        user,
        query.currentMonth,
        query.previousMonth,
      ),
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
