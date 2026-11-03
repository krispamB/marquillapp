import { FailureCode } from '../workflow/workflow.constants';
import { computeDocumentMetrics, DocumentRunRow } from './document-metrics';

const run = (overrides: Partial<DocumentRunRow> = {}): DocumentRunRow => ({
  designSystemId: 'aurora',
  outcome: 'READY',
  jobAttemptFailureCodes: [],
  candidates: [],
  repairRounds: 0,
  wallTimeMs: 60_000,
  credits: 10,
  renderAttempts: [],
  ...overrides,
});

const cand = (
  checks: { phase: 'static' | 'render'; codes?: string[] }[],
): DocumentRunRow['candidates'][number] => ({
  candidateSha256: 'h',
  checks: checks.map(({ phase, codes = [] }) => ({
    phase,
    passed: codes.length === 0,
    // One entry per code with its count, like the diagnostics record them.
    violations: [...new Set(codes)].map((code) => ({
      code,
      count: codes.filter((other) => other === code).length,
    })),
  })),
});

describe('computeDocumentMetrics', () => {
  describe('runs', () => {
    it('should report zero runs and null rates when there are no runs', () => {
      const metrics = computeDocumentMetrics([]);

      expect(metrics.byDesignSystem).toEqual({});
      expect(metrics.overall).toMatchObject({
        runs: 0,
        ready: 0,
        readyRate: null,
        failures: {},
        firstCandidate: { runs: 0, passed: 0, passRate: null },
        repairRounds: {},
        violations: { static: [], render: [] },
        truncations: 0,
        truncationRate: null,
        renderSessions: {
          total: 0,
          perRun: null,
          retries: 0,
          billedUnits: 0,
          absorbedUnits: 0,
          timeoutsByPhase: {},
        },
        wallTimeMs: { p50: null, p95: null, max: null },
        credits: { p50: null, p95: null, max: null },
      });
    });

    it('should count runs, READY runs and the failureCode breakdown when runs ended differently', () => {
      const metrics = computeDocumentMetrics([
        run(),
        run(),
        run({
          outcome: 'FAILED',
          failureCode: FailureCode.DOCUMENT_REPAIR_EXHAUSTED,
        }),
        run({
          outcome: 'FAILED',
          failureCode: FailureCode.DOCUMENT_REPAIR_EXHAUSTED,
        }),
        run({ outcome: 'FAILED', failureCode: FailureCode.RENDER_UNAVAILABLE }),
      ]);

      expect(metrics.overall).toMatchObject({
        runs: 5,
        ready: 2,
        readyRate: 0.4,
        failures: {
          'document.repair_exhausted': 2,
          'render.unavailable': 1,
        },
      });
    });

    it('should split every metric per Design System id when runs use different systems', () => {
      const metrics = computeDocumentMetrics([
        run({ designSystemId: 'slate' }),
        run({ designSystemId: 'aurora' }),
        run({
          designSystemId: 'aurora',
          outcome: 'FAILED',
          failureCode: FailureCode.INTERNAL,
        }),
        run({ designSystemId: undefined }),
      ]);

      expect(Object.keys(metrics.byDesignSystem)).toEqual([
        'aurora',
        'slate',
        'unpinned',
      ]);
      expect(metrics.byDesignSystem.aurora).toMatchObject({
        runs: 2,
        readyRate: 0.5,
        failures: { internal: 1 },
      });
      expect(metrics.byDesignSystem.slate).toMatchObject({
        runs: 1,
        readyRate: 1,
      });
      expect(metrics.overall.runs).toBe(4);
    });
  });

  describe('first candidate', () => {
    it('should pass a run when its first candidate passed the static and render checks', () => {
      const metrics = computeDocumentMetrics([
        run({ candidates: [cand([{ phase: 'static' }, { phase: 'render' }])] }),
      ]);

      expect(metrics.overall.firstCandidate).toEqual({
        runs: 1,
        passed: 1,
        passRate: 1,
      });
    });

    it('should not pass a run when its first candidate needed a Repair, even if the second passed', () => {
      const metrics = computeDocumentMetrics([
        run({
          repairRounds: 1,
          candidates: [
            cand([{ phase: 'static', codes: ['page.overflow'] }]),
            cand([{ phase: 'static' }, { phase: 'render' }]),
          ],
        }),
        run({
          candidates: [
            cand([{ phase: 'static' }, { phase: 'render', codes: ['x'] }]),
          ],
        }),
      ]);

      expect(metrics.overall.firstCandidate).toEqual({
        runs: 2,
        passed: 0,
        passRate: 0,
      });
    });

    it('should leave out a run that stopped on a render outage before its first candidate reached a verdict', () => {
      const metrics = computeDocumentMetrics([
        run({
          outcome: 'FAILED',
          failureCode: FailureCode.RENDER_UNAVAILABLE,
          candidates: [
            cand([
              { phase: 'static' },
              { phase: 'render', codes: ['render.timeout'] },
              { phase: 'render', codes: ['render.timeout'] },
            ]),
          ],
        }),
      ]);

      expect(metrics.overall.firstCandidate).toEqual({
        runs: 0,
        passed: 0,
        passRate: null,
      });
    });

    it('should pass a run whose first candidate only needed a render retry, spending no Repair', () => {
      const metrics = computeDocumentMetrics([
        run({
          candidates: [
            cand([
              { phase: 'static' },
              { phase: 'render', codes: ['render.fonts.failed'] },
              { phase: 'render' },
            ]),
          ],
        }),
      ]);

      expect(metrics.overall.firstCandidate).toEqual({
        runs: 1,
        passed: 1,
        passRate: 1,
      });
    });

    it('should not pass a run whose first candidate was repaired after a static failure', () => {
      const metrics = computeDocumentMetrics([
        run({
          candidates: [cand([{ phase: 'static', codes: ['page.safeArea'] }])],
        }),
      ]);

      expect(metrics.overall.firstCandidate).toEqual({
        runs: 1,
        passed: 0,
        passRate: 0,
      });
    });

    it('should leave runs without a candidate out of the pass rate', () => {
      const metrics = computeDocumentMetrics([
        run({
          outcome: 'FAILED',
          failureCode: FailureCode.DOCUMENT_TRUNCATED,
          candidates: [],
        }),
        run({ candidates: [cand([{ phase: 'static' }, { phase: 'render' }])] }),
      ]);

      expect(metrics.overall.firstCandidate).toEqual({
        runs: 1,
        passed: 1,
        passRate: 1,
      });
    });
  });

  describe('repair rounds', () => {
    it('should count runs per repair rounds spent', () => {
      const metrics = computeDocumentMetrics([
        run({ repairRounds: 0 }),
        run({ repairRounds: 0 }),
        run({ repairRounds: 1 }),
        run({ repairRounds: 2 }),
      ]);

      expect(metrics.overall.repairRounds).toEqual({ '0': 2, '1': 1, '2': 1 });
    });
  });

  describe('patch repairs', () => {
    const round = (
      edits: number,
      fallback = false,
      mode: 'full' | 'patch' = 'patch',
    ) => ({ kind: 'static' as const, mode, edits, fallback });

    it('should leave patchRepairs out when no round ran in patch mode', () => {
      const metrics = computeDocumentMetrics([
        run({ repairs: [round(0, false, 'full')] }),
        run(),
      ]);

      expect(metrics.overall.patchRepairs).toBeUndefined();
    });

    it('should count edit rounds, html rounds and fallbacks, and rate fallbacks per edit round', () => {
      const metrics = computeDocumentMetrics([
        run({ repairs: [round(3), round(1, true)] }),
        run({ repairs: [round(0), round(2), round(4)] }),
      ]);

      expect(metrics.overall.patchRepairs).toEqual({
        rounds: 5,
        editRounds: 4,
        htmlRounds: 1,
        fallbacks: 1,
        fallbackRate: 0.25,
        meanEdits: 2.5,
      });
    });

    it('should give a null rate and mean when every round answered with html', () => {
      const metrics = computeDocumentMetrics([run({ repairs: [round(0)] })]);

      expect(metrics.overall.patchRepairs).toMatchObject({
        rounds: 1,
        editRounds: 0,
        fallbackRate: null,
        meanEdits: null,
      });
    });

    it('should bucket per Design System', () => {
      const metrics = computeDocumentMetrics([
        run({ designSystemId: 'a', repairs: [round(2, true)] }),
        run({ designSystemId: 'b' }),
      ]);

      expect(metrics.byDesignSystem.a.patchRepairs?.fallbackRate).toBe(1);
      expect(metrics.byDesignSystem.b.patchRepairs).toBeUndefined();
    });
  });

  describe('truncations', () => {
    it('should count runs where any job attempt was truncated, including one a retry absorbed', () => {
      const metrics = computeDocumentMetrics([
        run({
          outcome: 'FAILED',
          failureCode: FailureCode.DOCUMENT_TRUNCATED,
          jobAttemptFailureCodes: [FailureCode.DOCUMENT_TRUNCATED],
        }),
        run({
          jobAttemptFailureCodes: [FailureCode.DOCUMENT_TRUNCATED],
        }),
        run({
          jobAttemptFailureCodes: [FailureCode.RENDER_UNAVAILABLE],
        }),
        run(),
      ]);

      expect(metrics.overall.truncations).toBe(2);
      expect(metrics.overall.truncationRate).toBe(0.5);
    });
  });

  describe('violations', () => {
    it('should rank the top 10 codes per phase by failed checks, then violations, then code', () => {
      const staticCodes = Array.from({ length: 12 }, (_, i) => `static.c${i}`);
      const metrics = computeDocumentMetrics([
        // c0..c11 once each, c3 and c4 more often
        ...staticCodes.map((code) =>
          run({ candidates: [cand([{ phase: 'static', codes: [code] }])] }),
        ),
        run({
          candidates: [
            cand([
              {
                phase: 'static',
                codes: ['static.c3', 'static.c3', 'static.c3'],
              },
            ]),
            cand([{ phase: 'static', codes: ['static.c3', 'static.c4'] }]),
          ],
        }),
        run({
          candidates: [
            cand([
              { phase: 'static', codes: ['static.c4'] },
              { phase: 'render', codes: ['render.overflow'] },
            ]),
          ],
        }),
      ]);

      const { static: top, render } = metrics.overall.violations;
      expect(top).toHaveLength(10);
      expect(top.slice(0, 3)).toEqual([
        { code: 'static.c3', checks: 3, count: 5 },
        { code: 'static.c4', checks: 3, count: 3 },
        { code: 'static.c0', checks: 1, count: 1 },
      ]);
      expect(top[9]).toEqual({ code: 'static.c7', checks: 1, count: 1 });
      expect(render).toEqual([
        { code: 'render.overflow', checks: 1, count: 1 },
      ]);
    });
  });

  describe('violations that spend no Repair', () => {
    it('should leave retry and defect findings out of the top violation codes', () => {
      const metrics = computeDocumentMetrics([
        run({
          candidates: [
            cand([
              { phase: 'render', codes: ['render.timeout'] },
              { phase: 'render', codes: ['render.fonts.failed'] },
              { phase: 'render', codes: ['render.egress'] },
              { phase: 'render', codes: ['render.overlap'] },
            ]),
          ],
        }),
      ]);

      expect(metrics.overall.violations.render).toEqual([
        { code: 'render.overlap', checks: 1, count: 1 },
      ]);
    });
  });

  describe('render sessions', () => {
    it('should total sessions, retries, billed units and absorbed units across runs', () => {
      const metrics = computeDocumentMetrics([
        run({
          renderAttempts: [
            { outcome: 'RETRY', billed: false, units: 2 },
            { outcome: 'FINDINGS', billed: true, units: 1 },
            { outcome: 'PASSED', billed: true, units: 3 },
          ],
        }),
        run({
          renderAttempts: [
            { outcome: 'ERROR', billed: false, units: 1 },
            { outcome: 'PASSED', billed: true, units: 1 },
          ],
        }),
        run(),
      ]);

      expect(metrics.overall.renderSessions).toEqual({
        total: 5,
        perRun: 5 / 3,
        retries: 1,
        billedUnits: 5,
        absorbedUnits: 3,
        timeoutsByPhase: {},
      });
    });

    it('should count the timed-out sessions by the phase they hung in', () => {
      const metrics = computeDocumentMetrics([
        run({
          renderAttempts: [
            {
              outcome: 'RETRY',
              billed: false,
              units: 2,
              timedOut: true,
              phase: 'load',
            },
            {
              outcome: 'RETRY',
              billed: false,
              units: 2,
              timedOut: true,
              phase: 'load',
            },
            { outcome: 'RETRY', billed: false, units: 1, phase: 'probe' },
            { outcome: 'PASSED', billed: true, units: 1, phase: 'pdf' },
          ],
        }),
        run({
          renderAttempts: [
            {
              outcome: 'RETRY',
              billed: false,
              units: 2,
              timedOut: true,
              phase: 'connect',
            },
            { outcome: 'RETRY', billed: false, units: 2, timedOut: true },
          ],
        }),
      ]);

      expect(metrics.overall.renderSessions.timeoutsByPhase).toEqual({
        load: 2,
        connect: 1,
        unknown: 1,
      });
    });
  });

  describe('percentiles', () => {
    it('should give the nearest-rank p50 and p95 of wall time and credits', () => {
      const metrics = computeDocumentMetrics(
        Array.from({ length: 20 }, (_, i) =>
          run({ wallTimeMs: (20 - i) * 1000, credits: (i + 1) * 5 }),
        ),
      );

      expect(metrics.overall.wallTimeMs).toEqual({
        p50: 10_000,
        p95: 19_000,
        max: 20_000,
      });
      expect(metrics.overall.credits).toEqual({ p50: 50, p95: 95, max: 100 });
    });

    it('should give the only value as both percentiles when there is one run', () => {
      const metrics = computeDocumentMetrics([
        run({ wallTimeMs: 4200, credits: 7 }),
      ]);

      expect(metrics.overall.wallTimeMs).toEqual({
        p50: 4200,
        p95: 4200,
        max: 4200,
      });
      expect(metrics.overall.credits).toEqual({ p50: 7, p95: 7, max: 7 });
    });

    it('should take credits from READY runs only, since a failed run is never charged', () => {
      const metrics = computeDocumentMetrics([
        run({ credits: 10 }),
        run({ credits: 30 }),
        run({ outcome: 'FAILED', credits: 500 }),
      ]);

      expect(metrics.overall.credits).toEqual({ p50: 10, p95: 30, max: 30 });
      expect(metrics.overall.wallTimeMs.max).toBe(60_000);
    });
  });
});
