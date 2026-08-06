import { Module } from '@nestjs/common';
import { WorkflowRunService } from './workflow-run.service';

/**
 * The durable run record, kept apart from `WorkflowModule`'s queue producers.
 * Only the artifact HTTP surface (#117) and the worker need it, so it stays out
 * of the widely-imported queue module's graph.
 */
@Module({
  providers: [WorkflowRunService],
  exports: [WorkflowRunService],
})
export class WorkflowRunModule {}
