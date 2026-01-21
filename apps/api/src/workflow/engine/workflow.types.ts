import { Job } from 'bullmq';
import { WorkflowStep } from '../workflow.constants';
import { AgentService } from 'src/agent/agent.service';
import { Logger } from '@nestjs/common';

export interface WorkflowState<T = unknown> {
  data: T; // pipeline data (changes every step)
  initialInput: unknown; // original user input
  metadata: Record<string, any>; // step-produced info
}

export interface WorkflowContext {
  agentService: AgentService;
  logger: Logger;
}

export interface WorkflowDefinition {
  name: string;
  steps: WorkflowStep[];
}

export type StepHandler<TIn = any, TOut = any> = (
  state: WorkflowState<TIn>,
  job: Job,
  ctx: WorkflowContext,
) => Promise<WorkflowState<TOut>>;
