import { Module } from '@nestjs/common';
import { PostController } from './post.controller';
import { PostService } from './post.service';
import { LinkedinMediaService } from './linkedin-media.service';
import { WorkflowModule } from '../workflow/workflow.module';
import { FeatureGatingModule } from '../feature-gating';

@Module({
  imports: [WorkflowModule, FeatureGatingModule],
  controllers: [PostController],
  providers: [PostService, LinkedinMediaService],
  exports: [LinkedinMediaService],
})
export class PostModule {}
