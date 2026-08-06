jest.mock(
  '../../database/schemas',
  () => ({
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
    RunKind: { INITIAL: 'INITIAL', REFINE: 'REFINE' },
  }),
  { virtual: true },
);

import { ArtifactType, RunKind } from '../../database/schemas';
import { WorkflowStep } from '../workflow.constants';
import { buildWorkflow } from './workflow.builder';

const { RESOLVE_INPUT, RESEARCH, GENERATE, RENDER_PDF, PERSIST_VERSION } =
  WorkflowStep;

describe('buildWorkflow', () => {
  // The four distinct shapes the nine valid (type × kind × withResearch)
  // combinations collapse to.
  const SHAPE_A = [RESOLVE_INPUT, GENERATE, PERSIST_VERSION];
  const SHAPE_B = [RESOLVE_INPUT, RESEARCH, GENERATE, PERSIST_VERSION];
  const SHAPE_C = [RESOLVE_INPUT, GENERATE, RENDER_PDF, PERSIST_VERSION];
  const SHAPE_D = [
    RESOLVE_INPUT,
    RESEARCH,
    GENERATE,
    RENDER_PDF,
    PERSIST_VERSION,
  ];

  describe('shape A — no research, no render', () => {
    it.each([ArtifactType.POST, ArtifactType.POLL])(
      'should emit resolve → generate → persist for an initial research-off %s',
      (type) => {
        const workflow = buildWorkflow({
          type,
          withResearch: false,
          kind: RunKind.INITIAL,
        });

        expect(workflow.steps).toEqual(SHAPE_A);
      },
    );

    it.each([ArtifactType.POST, ArtifactType.POLL])(
      'should emit resolve → generate → persist for a refine of a %s',
      (type) => {
        const workflow = buildWorkflow({
          type,
          withResearch: true,
          kind: RunKind.REFINE,
        });

        expect(workflow.steps).toEqual(SHAPE_A);
      },
    );
  });

  describe('shape B — research, no render', () => {
    it.each([ArtifactType.POST, ArtifactType.POLL])(
      'should insert RESEARCH for an initial research-on %s',
      (type) => {
        const workflow = buildWorkflow({
          type,
          withResearch: true,
          kind: RunKind.INITIAL,
        });

        expect(workflow.steps).toEqual(SHAPE_B);
      },
    );
  });

  describe('shape C — render, no research', () => {
    it('should append RENDER_PDF for an initial research-off DOCUMENT', () => {
      const workflow = buildWorkflow({
        type: ArtifactType.DOCUMENT,
        withResearch: false,
        kind: RunKind.INITIAL,
      });

      expect(workflow.steps).toEqual(SHAPE_C);
    });

    it('should append RENDER_PDF for a refine of a DOCUMENT', () => {
      const workflow = buildWorkflow({
        type: ArtifactType.DOCUMENT,
        withResearch: true,
        kind: RunKind.REFINE,
      });

      expect(workflow.steps).toEqual(SHAPE_C);
    });
  });

  describe('shape D — research and render', () => {
    it('should emit all five steps for an initial research-on DOCUMENT', () => {
      const workflow = buildWorkflow({
        type: ArtifactType.DOCUMENT,
        withResearch: true,
        kind: RunKind.INITIAL,
      });

      expect(workflow.steps).toEqual(SHAPE_D);
    });
  });

  describe('research invocation rule', () => {
    it.each([ArtifactType.POST, ArtifactType.POLL, ArtifactType.DOCUMENT])(
      'should omit RESEARCH on a REFINE of a %s even when withResearch is true',
      (type) => {
        // Refine reads cached research off the run record, so it re-charges no
        // web-search surcharge and adds no latency.
        const workflow = buildWorkflow({
          type,
          withResearch: true,
          kind: RunKind.REFINE,
        });

        expect(workflow.steps).not.toContain(RESEARCH);
      },
    );

    it.each([ArtifactType.POST, ArtifactType.POLL, ArtifactType.DOCUMENT])(
      'should omit RESEARCH on an initial %s when withResearch is false',
      (type) => {
        const workflow = buildWorkflow({
          type,
          withResearch: false,
          kind: RunKind.INITIAL,
        });

        expect(workflow.steps).not.toContain(RESEARCH);
      },
    );

    it('should honour withResearch identically across all three types', () => {
      const stepsFor = (type: ArtifactType) =>
        buildWorkflow({ type, withResearch: true, kind: RunKind.INITIAL })
          .steps;

      // POST and POLL share an identical pipeline; DOCUMENT is that + RENDER_PDF.
      expect(stepsFor(ArtifactType.POST)).toEqual(stepsFor(ArtifactType.POLL));
      expect(stepsFor(ArtifactType.DOCUMENT)).toEqual([
        ...stepsFor(ArtifactType.POST).slice(0, -1),
        RENDER_PDF,
        PERSIST_VERSION,
      ]);
    });
  });

  describe('honesty of the emitted sequence', () => {
    it('should only ever contain steps that actually run', () => {
      // The sequence feeds the SSE progress bar's `total`, so a skipped step
      // must not appear.
      const workflow = buildWorkflow({
        type: ArtifactType.POST,
        withResearch: false,
        kind: RunKind.INITIAL,
      });

      expect(workflow.steps).not.toContain(RESEARCH);
      expect(workflow.steps).not.toContain(RENDER_PDF);
      expect(workflow.steps).toHaveLength(3);
    });

    it('should name the workflow after the artifact type', () => {
      const workflow = buildWorkflow({
        type: ArtifactType.DOCUMENT,
        withResearch: false,
        kind: RunKind.INITIAL,
      });

      expect(workflow.name).toBe('artifact:DOCUMENT');
    });

    it('should always start at RESOLVE_INPUT and end at PERSIST_VERSION', () => {
      const combos = [
        ArtifactType.POST,
        ArtifactType.POLL,
        ArtifactType.DOCUMENT,
      ]
        .flatMap((type) =>
          [RunKind.INITIAL, RunKind.REFINE].map((kind) => ({ type, kind })),
        )
        .flatMap(({ type, kind }) =>
          [true, false].map((withResearch) => ({ type, kind, withResearch })),
        );

      for (const spec of combos) {
        const { steps } = buildWorkflow(spec);
        expect(steps[0]).toBe(RESOLVE_INPUT);
        expect(steps[steps.length - 1]).toBe(PERSIST_VERSION);
      }
    });

    it('should collapse every valid combination to one of four shapes', () => {
      const shapes = new Set<string>();

      for (const type of [
        ArtifactType.POST,
        ArtifactType.POLL,
        ArtifactType.DOCUMENT,
      ]) {
        for (const kind of [RunKind.INITIAL, RunKind.REFINE]) {
          for (const withResearch of [true, false]) {
            // REFINE-with-research-on is not a distinct combination: the builder
            // ignores withResearch on refine. That is what leaves nine valid
            // combinations rather than twelve.
            shapes.add(
              buildWorkflow({ type, withResearch, kind }).steps.join('>'),
            );
          }
        }
      }

      expect(shapes.size).toBe(4);
    });
  });
});
