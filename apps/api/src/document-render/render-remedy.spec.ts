import { RENDER_REMEDIES, remedyOf } from './render-remedy';

describe('remedyOf', () => {
  it('should cover every code in the §5.2 table', () => {
    expect(Object.keys(RENDER_REMEDIES).sort()).toEqual(
      [
        'render.pages.geometry',
        'render.pdf.pageCount',
        'render.pages.blank',
        'page.safeArea',
        'render.overflow.clipped',
        'render.overlap',
        'render.fonts.fallback',
        'palette.pairings',
        'icons.colors',
        'render.fonts.failed',
        'render.timeout',
        'render.egress',
      ].sort(),
    );
  });

  it('should retry a font failure or a timeout', () => {
    expect(remedyOf('render.fonts.failed')).toBe('retry');
    expect(remedyOf('render.timeout')).toBe('retry');
  });

  it('should treat a refused request as a defect', () => {
    expect(remedyOf('render.egress')).toBe('defect');
  });

  it('should repair every other render code', () => {
    for (const [code, remedy] of Object.entries(RENDER_REMEDIES)) {
      if (
        !['render.fonts.failed', 'render.timeout', 'render.egress'].includes(
          code,
        )
      )
        expect(remedy).toBe('repair');
    }
  });

  it('should repair a static checker code when it is not a render code', () => {
    expect(remedyOf('typography.scale')).toBe('repair');
    expect(remedyOf('envelope.truncated')).toBe('repair');
  });
});
