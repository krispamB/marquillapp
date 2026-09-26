import { WorkflowStep } from '../workflow.constants';
import type { StepHandlerMap } from '../engine/workflow.types';
import { generateStep } from './generate.step';
import { persistVersionStep } from './persist-version.step';
import { renderPdfStep } from './render-pdf.step';
import { researchStep } from './research.step';
import { resolveInputStep } from './resolve-input.step';

export * from './generate.step';
export * from './persist-version.step';
export * from './render-pdf.step';
export * from './research.step';
export * from './resolve-input.step';

/**
 * The builder emits `RENDER_PDF` only for DOCUMENT runs (`type === DOCUMENT`);
 * for every other type it is simply never in the step list.
 */
export const artifactStepHandlers: StepHandlerMap = {
  [WorkflowStep.RESOLVE_INPUT]: resolveInputStep,
  [WorkflowStep.RESEARCH]: researchStep,
  [WorkflowStep.GENERATE]: generateStep,
  [WorkflowStep.RENDER_PDF]: renderPdfStep,
  [WorkflowStep.PERSIST_VERSION]: persistVersionStep,
};
