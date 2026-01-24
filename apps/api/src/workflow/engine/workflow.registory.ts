import {
  InsightPostLinkedinWorkflow,
  QuickPostLinkedinWorkflow,
} from '../workflows';
import { ContentType } from '../workflow.constants';

export const WorkflowRegistry = {
  [ContentType.QUICK_POST_LINKEDIN]: QuickPostLinkedinWorkflow,
  [ContentType.INSIGHT_POST_LINKEDIN]: InsightPostLinkedinWorkflow,
};
