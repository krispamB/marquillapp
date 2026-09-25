/**
 * PROTOTYPE stand-in for #161's `DESIGN_SYSTEM_FONT_ALLOWLIST`: one constant,
 * read by the seed gate and by assembly, so a family is fetched only if both a
 * definition declares it and the app allows it.
 */
export const DESIGN_SYSTEM_FONT_ALLOWLIST: ReadonlySet<string> = new Set([
  'Fraunces',
  'Inter',
]);
