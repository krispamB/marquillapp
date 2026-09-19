/**
 * PROTOTYPE stand-in for the pinned `lucide-static` catalog #162 settled on.
 * Inner SVG only; assembly supplies the root attributes. `spark` is drawn by
 * hand — the real catalog would have rejected the name at seed (#161).
 */
export const ICON_CATALOG: Readonly<Record<string, string>> = {
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  minus: '<path d="M5 12h14"/>',
  quote:
    '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
  'circle-dot':
    '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
  spark: '<path d="M12 3v18"/><path d="M3 12h18"/>',
};
