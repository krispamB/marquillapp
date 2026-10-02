jest.mock('../../document-source/assemble', () => ({
  assemble: jest.fn(),
}));
jest.mock('../../document-render/judge', () => ({
  judge: jest.fn(),
}));

import { judge } from '../../document-render/judge';
import { RenderSessionError } from '../../document-render/render-session.error';
import { assemble } from '../../document-source/assemble';
import { IconInliningError } from '../../document-source/icon-inlining.error';
import { WorkflowError } from '../engine/workflow.error';
import type {
  DocumentCheck,
  RunState,
  StepContext,
} from '../engine/workflow.types';
import { sha256Hex } from '../../document-source/sha256';
import { documentObjectKey, renderPdfStep } from './render-pdf.step';

const mockedAssemble = assemble as jest.MockedFunction<typeof assemble>;
const mockedJudge = judge as jest.MockedFunction<typeof judge>;

const CANDIDATE = '<!doctype html><html><body></body></html>';
const SOURCE = '<!doctype html><html><head><style></style></head></html>';
const PDF = new Uint8Array([37, 80, 68, 70]);
const PNG = new Uint8Array([137, 80, 78, 71]);

const makeStep = () => {
  const renderer = { render: jest.fn() };
  const objects = { put: jest.fn().mockResolvedValue(undefined) };
  const run = {
    recordRenderAttempt: jest.fn().mockResolvedValue(undefined),
    recordDocumentCheck: jest.fn().mockResolvedValue(undefined),
  };
  const meter = { record: jest.fn() };
  const emit = jest.fn();
  const logger = { error: jest.fn(), warn: jest.fn() };
  const ctx = {
    renderer,
    objects,
    run,
    meter,
    emit,
    logger,
  } as unknown as StepContext;

  const definition = { id: 'margin', version: 2 };
  const state = {
    input: {
      artifactId: 'artifact-1',
      version: 3,
      type: 'DOCUMENT',
      designSystem: { id: 'margin', version: 2 },
    },
    designSystem: { definition, fragment: 'FRAGMENT' },
    draft: { commentary: 'Swipe through.', candidate: CANDIDATE },
  } as unknown as RunState;

  const session = (overrides: Record<string, unknown> = {}) => ({
    facts: { measured: true },
    pdf: PDF,
    pageCount: 4,
    cover: { ok: true, png: PNG },
    refusedRequests: [],
    usage: { durationMs: 14_000, units: 1 },
    ...overrides,
  });

  return {
    ctx,
    mocks: { renderer, objects, run, meter, emit, logger },
    fixtures: { state, definition, session },
  };
};

let ctx: StepContext;
let mocks: ReturnType<typeof makeStep>['mocks'];
let fixtures: ReturnType<typeof makeStep>['fixtures'];

beforeEach(() => {
  jest.clearAllMocks();
  ({ ctx, mocks, fixtures } = makeStep());
  mockedAssemble.mockReturnValue(SOURCE);
  mockedJudge.mockReturnValue([]);
  mocks.renderer.render.mockResolvedValue(fixtures.session());
});

describe('renderPdfStep', () => {
  describe('on a pass', () => {
    it('should render the assembled Document Source against the pinned definition', async () => {
      await renderPdfStep(fixtures.state, ctx);

      expect(mockedAssemble).toHaveBeenCalledWith(
        fixtures.definition,
        CANDIDATE,
      );
      expect(mocks.renderer.render).toHaveBeenCalledWith(
        fixtures.definition,
        SOURCE,
      );
      expect(mockedJudge).toHaveBeenCalledWith(fixtures.definition, {
        measured: true,
      });
    });

    it('should upload the four objects under the version prefix', async () => {
      await renderPdfStep(fixtures.state, ctx);

      expect(mocks.objects.put).toHaveBeenCalledWith(
        'artifacts/artifact-1/3/candidate.html',
        Buffer.from(CANDIDATE, 'utf8'),
        'text/html; charset=utf-8',
      );
      expect(mocks.objects.put).toHaveBeenCalledWith(
        'artifacts/artifact-1/3/source.html',
        Buffer.from(SOURCE, 'utf8'),
        'text/html; charset=utf-8',
      );
      expect(mocks.objects.put).toHaveBeenCalledWith(
        'artifacts/artifact-1/3/document.pdf',
        Buffer.from(PDF),
        'application/pdf',
      );
      expect(mocks.objects.put).toHaveBeenCalledWith(
        'artifacts/artifact-1/3/cover.png',
        Buffer.from(PNG),
        'image/png',
      );
    });

    it('should put the keys, hashes, measured page count and pin in run state', async () => {
      await expect(renderPdfStep(fixtures.state, ctx)).resolves.toEqual({
        document: {
          designSystemId: 'margin',
          designSystemVersion: 2,
          sourceKey: 'artifacts/artifact-1/3/source.html',
          sourceSha256: sha256Hex(SOURCE),
          candidateKey: 'artifacts/artifact-1/3/candidate.html',
          candidateSha256: sha256Hex(CANDIDATE),
          pdfKey: 'artifacts/artifact-1/3/document.pdf',
          pageCount: 4,
          coverKey: 'artifacts/artifact-1/3/cover.png',
        },
      });
    });

    it('should emit the render phase and record the render check', async () => {
      await renderPdfStep(fixtures.state, ctx);

      expect(mocks.emit).toHaveBeenCalledWith({
        type: 'step.progress',
        data: { step: 'RENDER_PDF', phase: 'render', session: 1 },
      });
      const [check] = mocks.run.recordDocumentCheck.mock.calls[0] as [
        DocumentCheck,
      ];
      expect(check).toMatchObject({
        phase: 'render',
        candidateSha256: sha256Hex(CANDIDATE),
        violations: [],
      });
      expect(check.checkedAt).toBeInstanceOf(Date);
    });

    it('should record a billed session and one pdf_render meter record', async () => {
      await renderPdfStep(fixtures.state, ctx);

      expect(mocks.run.recordRenderAttempt).toHaveBeenCalledWith({
        durationMs: 14_000,
        units: 1,
        outcome: 'PASSED',
        billed: true,
      });
      expect(mocks.meter.record).toHaveBeenCalledTimes(1);
      expect(mocks.meter.record).toHaveBeenCalledWith({
        kind: 'pdf_render',
        amount: 1,
        detail: { browserless: { durationMs: 14_000, units: 1 } },
      });
    });
  });

  describe('cover capture', () => {
    it('should record a failed capture and still pass without a coverKey', async () => {
      mocks.renderer.render.mockResolvedValue(
        fixtures.session({ cover: { ok: false, reason: 'screenshot failed' } }),
      );

      const patch = await renderPdfStep(fixtures.state, ctx);

      expect(patch.document).toBeDefined();
      expect(patch.document?.coverKey).toBeUndefined();
      expect(mocks.run.recordRenderAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'PASSED',
          coverFailure: 'screenshot failed',
        }),
      );
    });

    it('should never block the version when the cover upload fails', async () => {
      mocks.objects.put.mockImplementation((key: string) =>
        key.endsWith('cover.png')
          ? Promise.reject(new Error('R2 503'))
          : Promise.resolve(),
      );

      const patch = await renderPdfStep(fixtures.state, ctx);

      expect(patch.document?.coverKey).toBeUndefined();
      expect(mocks.run.recordRenderAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ coverFailure: 'upload failed: R2 503' }),
      );
    });
  });

  describe('on findings', () => {
    it('should fail terminally as document.repair_exhausted on a repair finding, billing the session', async () => {
      mockedJudge.mockReturnValue([
        { code: 'page.safeArea', detail: 'page 2: crosses', page: 2 },
      ]);

      await expect(renderPdfStep(fixtures.state, ctx)).rejects.toMatchObject({
        retryable: false,
        code: 'document.repair_exhausted',
      });
      expect(mocks.run.recordRenderAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'FINDINGS', billed: true }),
      );
      expect(mocks.objects.put).not.toHaveBeenCalled();
    });

    it('should fail transiently as render.unavailable on a retry finding, absorbing the session', async () => {
      mockedJudge.mockReturnValue([
        { code: 'render.timeout', detail: 'did not finish' },
      ]);

      await expect(renderPdfStep(fixtures.state, ctx)).rejects.toMatchObject({
        retryable: true,
        code: 'render.unavailable',
      });
      expect(mocks.run.recordRenderAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'RETRY', billed: false }),
      );
    });

    it('should prefer a retry over repair findings a failed font load can cause', async () => {
      mockedJudge.mockReturnValue([
        { code: 'render.fonts.failed', detail: 'Manrope failed' },
        { code: 'render.fonts.fallback', detail: 'page 1: fallback' },
      ]);

      await expect(renderPdfStep(fixtures.state, ctx)).rejects.toMatchObject({
        retryable: true,
      });
    });

    it('should fail terminally and alert on render.egress, absorbing the session', async () => {
      mocks.renderer.render.mockResolvedValue(
        fixtures.session({ refusedRequests: ['https://evil.example/x.png'] }),
      );
      mockedJudge.mockReturnValue([
        { code: 'render.egress', detail: 'refused https://evil.example/x.png' },
      ]);

      const error = await renderPdfStep(fixtures.state, ctx).catch(
        (e: unknown) => e,
      );

      expect(error).toMatchObject({ retryable: false });
      expect((error as WorkflowError).code).toBeUndefined();
      expect(mocks.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('[ALERT render.egress]'),
      );
      expect(mocks.run.recordRenderAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'EGRESS', billed: false }),
      );
    });

    it('should never put violation details in a progress event', async () => {
      mockedJudge.mockReturnValue([
        { code: 'page.safeArea', detail: 'page 2: secret detail', page: 2 },
      ]);

      await renderPdfStep(fixtures.state, ctx).catch(() => undefined);

      expect(JSON.stringify(mocks.emit.mock.calls)).not.toContain(
        'secret detail',
      );
    });
  });

  describe('when the session fails', () => {
    it('should record the unbilled session and fail transiently as render.unavailable', async () => {
      mocks.renderer.render.mockRejectedValue(
        new RenderSessionError('socket hang up', {
          durationMs: 2_000,
          units: 1,
        }),
      );

      await expect(renderPdfStep(fixtures.state, ctx)).rejects.toMatchObject({
        retryable: true,
        code: 'render.unavailable',
      });
      expect(mocks.run.recordRenderAttempt).toHaveBeenCalledWith({
        durationMs: 2_000,
        units: 1,
        outcome: 'ERROR',
        billed: false,
      });
      expect(mocks.meter.record).not.toHaveBeenCalled();
    });

    it('should let an upload failure propagate so it stays retryable', async () => {
      const outage = new Error('R2 503');
      mocks.objects.put.mockRejectedValueOnce(outage);

      await expect(renderPdfStep(fixtures.state, ctx)).rejects.toBe(outage);
    });
  });

  it('should fail terminally when icon inlining fails', async () => {
    mockedAssemble.mockImplementation(() => {
      throw new IconInliningError('unknown icon');
    });

    await expect(renderPdfStep(fixtures.state, ctx)).rejects.toMatchObject({
      retryable: false,
    });
    expect(mocks.renderer.render).not.toHaveBeenCalled();
  });

  it('should fail terminally when GENERATE left no Candidate Source', async () => {
    const state = { ...fixtures.state, draft: undefined } as RunState;

    await expect(renderPdfStep(state, ctx)).rejects.toMatchObject({
      retryable: false,
    });
    expect(mocks.renderer.render).not.toHaveBeenCalled();
  });
});

describe('documentObjectKey', () => {
  it('should key each object under the version prefix', () => {
    expect(documentObjectKey('a1', 2, 'document.pdf')).toBe(
      'artifacts/a1/2/document.pdf',
    );
  });
});
