/**
 * Who acts on a finding (§5.2). Only `repair` findings reach the model (§7.2).
 * `retry` is fixed by rendering again (§7.3). `defect` is a bug: terminal,
 * alerted, never prompted.
 */
export type Remedy = 'repair' | 'retry' | 'defect';

/** Every code the judge can return, with its remedy (§5.2). */
export const RENDER_REMEDIES = {
  'render.pages.geometry': 'repair',
  'render.pdf.pageCount': 'repair',
  'render.pages.blank': 'repair',
  'page.safeArea': 'repair',
  'render.overflow.clipped': 'repair',
  'render.overlap': 'repair',
  'render.fonts.fallback': 'repair',
  'palette.pairings': 'repair',
  'icons.colors': 'repair',
  'render.fonts.failed': 'retry',
  'render.timeout': 'retry',
  'render.egress': 'defect',
} as const satisfies Record<string, Remedy>;

export type RenderViolationCode = keyof typeof RENDER_REMEDIES;

/**
 * The remedy for any violation code. Static checker findings (§4.4) are all
 * `repair`, so anything that is not a non-repair render code is `repair`.
 */
export function remedyOf(code: string): Remedy {
  return (RENDER_REMEDIES as Record<string, Remedy>)[code] ?? 'repair';
}
