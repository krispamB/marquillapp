import { Module } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module';
import { WorkflowRunModule } from '../workflow/workflow-run.module';
import { FeatureGatingModule } from '../feature-gating';
import { ArtifactService } from './artifact.service';
import { ArtifactGenerationService } from './artifact-generation.service';
import { RunEventStreamService } from './run-event-stream.service';
import { ArtifactController } from './artifact.controller';
import { RunEventsController } from './run-events.controller';

// The Artifact model is registered globally by DatabaseModule, and RedisService
// is @Global, so only the queue producer, run record, and credit meter modules
// need importing here.
@Module({
  imports: [WorkflowModule, WorkflowRunModule, FeatureGatingModule],
  controllers: [ArtifactController, RunEventsController],
  providers: [
    ArtifactService,
    ArtifactGenerationService,
    RunEventStreamService,
  ],
  exports: [ArtifactService],
})
export class ArtifactModule {}
