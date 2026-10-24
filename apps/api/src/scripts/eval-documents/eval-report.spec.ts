import {
  computeDocumentMetrics,
  type DocumentRunRow,
} from '../../diagnostics/document-metrics';
import { FailureCode } from '../../workflow/workflow.constants';
import { evaluateEval } from './eval-gates';
import type { EvalRunRecord } from './eval-record';
import { formatEvalReport } from './eval-report';
import type { EvalResult } from './eval-runner';

const SYSTEMS = ['margin', 'afterglow'];

const makeRow = (overrides: Partial<DocumentRunRow>): DocumentRunRow => ({
  runId: 'run',
  designSystemId: 'margin',
  outcome: 'READY',
  jobAttemptFailureCodes: [],
  candidates: [],
  repairRounds: 0,
  wallTimeMs: 90_000,
  credits: 120,
  pageCount: 4,
  renderAttempts: [],
  ...overrides,
});

const makeResult = (
  config: { failMargin?: boolean; repairs?: DocumentRunRow['repairs'] } = {},
): EvalResult => {
  const records: EvalRunRecord[] = [];
  const rows: DocumentRunRow[] = [];
  for (const designSystemId of SYSTEMS) {
    for (const pages of [4, 8]) {
      const runId = `${designSystemId}-${pages}`;
      const failed =
        config.failMargin && designSystemId === 'margin' && pages === 4;
      records.push({
        key: `${designSystemId}/${pages}p`,
        kind: 'INITIAL',
        requestedDesignSystemId: designSystemId,
        requestedPages: pages,
        artifactId: `artifact-${runId}`,
        runId,
        version: 1,
        state: failed ? 'FAILED' : 'COMPLETED',
      });
      rows.push(
        makeRow({
          runId,
          designSystemId,
          pageCount: pages,
          ...(config.repairs && designSystemId === 'margin' && pages === 4
            ? { repairs: config.repairs }
            : {}),
          ...(failed
            ? {
                outcome: 'FAILED',
                failureCode: FailureCode.DOCUMENT_REPAIR_EXHAUSTED,
              }
            : {}),
        }),
      );
    }
  }
  records.push({
    key: 'refine/switch-system',
    kind: 'REFINE',
    requestedDesignSystemId: 'afterglow',
    requestedPages: 8,
    sourceKey: 'margin/8p',
    state: 'NOT_RUN',
    error: 'no READY run left to refine',
  });
  const designSystemIds = SYSTEMS;
  return {
    startedAt: '2026-10-14T10:00:00.000Z',
    finishedAt: '2026-10-14T10:41:00.000Z',
    options: { concurrency: 2, timeoutMs: 7_200_000, pollMs: 10_000 },
    designSystemIds,
    defaultDesignSystemId: 'margin',
    records,
    rows,
    metrics: computeDocumentMetrics(rows),
    evaluation: evaluateEval({
      records,
      rows,
      designSystemIds,
      defaultDesignSystemId: 'margin',
    }),
    covers: rows
      .filter((row) => row.outcome === 'READY')
      .map((row) => ({
        runId: row.runId!,
        key: `${row.designSystemId}/${row.pageCount}p`,
        designSystemId: row.designSystemId,
        pageCount: row.pageCount,
        coverUrl: `https://r2.example/${row.runId}.png`,
      })),
  };
};

describe('formatEvalReport', () => {
  it('should print every gate with PASS or FAIL', () => {
    const report = formatEvalReport(makeResult());

    expect(report).toMatch(/PASS\s+Runs failing ≤ 1/);
    expect(report).toMatch(/PASS\s+document\.truncated = 0/);
    expect(report).toMatch(/PASS\s+render\.egress = 0/);
    expect(report).toMatch(/PASS\s+Slowest run ≤ 4m00s/);
    expect(report).toMatch(/PASS\s+Costliest successful run ≤ 3×/);
  });

  it('should mark a failing gate FAIL and the eval failed', () => {
    const failing = makeResult({ failMargin: true });

    const report = formatEvalReport(failing);

    expect(report).toMatch(/FAIL\s+Runs failing ≤ 1/);
    expect(report).toMatch(/FAIL\s+Default design system \(margin\)/);
    expect(report).toContain('RESULT: FAIL');
  });

  it('should report RESULT: PASS when every gate passes', () => {
    const report = formatEvalReport(makeResult());

    expect(report).toContain('RESULT: PASS');
  });

  it('should tell a person to check Railway logs for alerts over the eval window', () => {
    const report = formatEvalReport(makeResult());

    expect(report).toContain(
      'Alerts: check Railway logs for `[ALERT` between 2026-10-14T10:00:00.000Z and 2026-10-14T10:41:00.000Z',
    );
  });

  it("should print each system's verdict in plain words", () => {
    const report = formatEvalReport(makeResult({ failMargin: true }));

    expect(report).toMatch(
      /margin\s+1 of 2 failed\s+re-run its 3 or ship it unlisted/,
    );
    expect(report).toMatch(/afterglow\s+0 of 2 failed\s+list it/);
  });

  it('should say unlist it after two failures', () => {
    const result = makeResult();
    result.evaluation.systems[1] = {
      designSystemId: 'afterglow',
      runs: 3,
      failures: 2,
      verdict: 'UNLIST',
    };

    expect(formatEvalReport(result)).toMatch(
      /afterglow\s+2 of 3 failed\s+unlist it/,
    );
  });

  it('should flag that a failing default blocks the rollout', () => {
    const report = formatEvalReport(makeResult({ failMargin: true }));

    expect(report).toContain(
      'DEFAULT DESIGN SYSTEM (margin) FAILED: ROLLOUT IS BLOCKED',
    );
  });

  it('should not flag the default when it passed', () => {
    expect(formatEvalReport(makeResult())).not.toContain('ROLLOUT IS BLOCKED');
  });

  it('should print the first-candidate pass rate as recorded, not gated', () => {
    const result = makeResult();
    result.metrics.overall.firstCandidate = {
      runs: 4,
      passed: 3,
      passRate: 0.75,
    };

    expect(formatEvalReport(result)).toContain(
      'First-candidate pass rate: 75.0% (3 of 4) — recorded, not gated',
    );
  });

  it('should print a dash when no first candidate reached a verdict', () => {
    expect(formatEvalReport(makeResult())).toContain(
      'First-candidate pass rate: n/a (0 of 0)',
    );
  });

  it('should print the aggregates overall and per system', () => {
    const report = formatEvalReport(makeResult());

    expect(report).toContain('Aggregates (spec §11.5)');
    expect(report).toMatch(/overall\s+4\s+4/);
    expect(report).toMatch(/margin\s+2\s+2/);
    expect(report).toMatch(/afterglow\s+2\s+2/);
  });

  it('should print the failure code breakdown', () => {
    const report = formatEvalReport(makeResult({ failMargin: true }));

    expect(report).toContain('document.repair_exhausted: 1');
  });

  it("should print each system's failure codes, repair rounds, violations and first-candidate rate", () => {
    const report = formatEvalReport(makeResult({ failMargin: true }));

    expect(report).toContain(
      '[margin] Failure codes: document.repair_exhausted: 1',
    );
    expect(report).toContain('[afterglow] Failure codes: none');
    expect(report).toContain('[margin] Render timeouts by phase: none');
    expect(report).toContain('[margin] Repair rounds');
    expect(report).toContain('[margin] Top static violations: none');
    expect(report).toContain('[margin] Top render violations: none');
    expect(report).toContain(
      '[margin] First-candidate pass rate: n/a (0 of 0)',
    );
  });

  it('should list every READY run in the cover review table with its URL', () => {
    const report = formatEvalReport(makeResult({ failMargin: true }));

    expect(report).toContain('Cover review');
    expect(report).toContain('afterglow-4');
    expect(report).toContain('https://r2.example/afterglow-4.png');
    expect(report).not.toContain('https://r2.example/margin-4.png');
    expect(report).toMatch(/afterglow\s+4\s+https:/);
  });

  it('should show a note where a cover has no URL', () => {
    const result = makeResult();
    result.covers[0] = {
      ...result.covers[0],
      coverUrl: undefined,
      note: 'no cover was captured',
    };

    expect(formatEvalReport(result)).toContain('no cover was captured');
  });

  it('should list runs that did not run with the reason', () => {
    const report = formatEvalReport(makeResult());

    expect(report).toContain('refine/switch-system');
    expect(report).toContain('NOT_RUN');
    expect(report).toContain('no READY run left to refine');
  });

  it('should print the requested page count in the runs table', () => {
    const report = formatEvalReport(makeResult());

    expect(report).toMatch(/run\s+pages\s+state\s+run id\s+note/);
    expect(report).toMatch(/margin\/4p\s+4\s+COMPLETED/);
    expect(report).toMatch(/margin\/8p\s+8\s+COMPLETED/);
  });

  describe('patch-mode Repairs', () => {
    const patch = (edits: number, fallback = false) => ({
      kind: 'static' as const,
      mode: 'patch' as const,
      edits,
      fallback,
    });

    it('should print nothing about patch mode when no round ran in it', () => {
      const report = formatEvalReport(
        makeResult({
          repairs: [
            { kind: 'static', mode: 'full', edits: 0, fallback: false },
          ],
        }),
      );

      expect(report).not.toContain('Patch Repairs');
      expect(report).not.toContain('fallback rate');
    });

    it('should print the counts, fallback rate and mean edits, overall and per system', () => {
      const report = formatEvalReport(
        makeResult({
          repairs: [patch(3), patch(1, true), patch(0), patch(4), patch(2)],
        }),
      );

      expect(report).toContain(
        'Patch Repairs: 5 rounds; 4 answered with edits, 1 with html; 1 fell back; mean 2.5 edits per edit round',
      );
      expect(report).toContain(
        '[margin] Patch Repairs: 5 rounds; 4 answered with edits, 1 with html; 1 fell back; mean 2.5 edits per edit round',
      );
      expect(report).not.toContain('[afterglow] Patch Repairs');
      expect(report).toContain(
        'Patch fallback rate: 25.0% (1 of 4 edit rounds)',
      );
    });

    it('should say the rate is under the 20% go/no-go threshold when it is', () => {
      const edits = Array.from({ length: 9 }, () => patch(2));
      const report = formatEvalReport(
        makeResult({ repairs: [...edits, patch(2, true)] }),
      );

      expect(report).toContain(
        'Patch fallback rate: 10.0% (1 of 10 edit rounds)',
      );
      expect(report).toContain(
        'PATCH GO: fallback rate is under 20% (DOCUMENT_REPAIR_MODE may switch to patch if no other gate is worse)',
      );
    });

    it('should say NO-GO at or above the threshold', () => {
      const report = formatEvalReport(
        makeResult({
          repairs: [patch(2, true), patch(2), patch(2), patch(2), patch(2)],
        }),
      );

      expect(report).toContain(
        'Patch fallback rate: 20.0% (1 of 5 edit rounds)',
      );
      expect(report).toContain(
        'PATCH NO-GO: fallback rate is not under 20% (keep DOCUMENT_REPAIR_MODE at full)',
      );
    });

    it('should print n/a and no verdict when no round answered with edits', () => {
      const report = formatEvalReport(makeResult({ repairs: [patch(0)] }));

      expect(report).toContain('Patch fallback rate: n/a (0 of 0 edit rounds)');
      expect(report).not.toContain('PATCH GO');
      expect(report).not.toContain('PATCH NO-GO');
    });
  });
});
