import { Module } from '@nestjs/common';
import { PostController } from './post.controller';
import { PostService } from './post.service';
import { WorkflowModule } from '../workflow/workflow.module';
import { SubscriptionAccessGuard } from '../common/guards';

@Module({
  imports: [WorkflowModule],
  controllers: [PostController],
  providers: [PostService, SubscriptionAccessGuard],
})
export class PostModule {}
