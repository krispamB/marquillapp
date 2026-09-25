/**
 * PROTOTYPE — the answer to #160 in one table. Throwaway.
 *
 * Every key in the contract is classified by who consumes it. A key that is
 * neither enforceable nor worth prompt tokens does not belong in the YAML.
 */
export type Teeth = 'static' | 'render' | 'seed' | 'guidance';

export const ledger: {
  key: string;
  teeth: Teeth;
  prompt: boolean;
  note: string;
}[] = [
  {
    key: 'contract / id / version',
    teeth: 'seed',
    prompt: false,
    note: 'Identity and the immutable snapshot. Semantics belong to #161.',
  },
  {
    key: 'name / summary',
    teeth: 'seed',
    prompt: true,
    note: 'Shown to the user picking a system; one line in the prompt header.',
  },
  {
    key: 'intent',
    teeth: 'guidance',
    prompt: true,
    note: 'The only free prose at the top level. Sets the voice of the whole system.',
  },

  {
    key: 'page.width / page.height',
    teeth: 'render',
    prompt: true,
    note: 'Statically visible in the .page rule; proved by #163 from the real page box.',
  },
  {
    key: 'page.safeArea',
    teeth: 'render',
    prompt: true,
    note: 'Needs bounding rects. Cross-checked at seed against the spacing scale.',
  },
  {
    key: 'page.pages',
    teeth: 'static',
    prompt: true,
    note: 'Page-element count now, PDF page count at #163.',
  },
  {
    key: 'page.background',
    teeth: 'static',
    prompt: true,
    note: 'Must resolve to a palette token.',
  },

  {
    key: 'palette.tokens',
    teeth: 'static',
    prompt: true,
    note: 'The colour allowlist. Every literal in the source must be one of these.',
  },
  {
    key: 'palette.pairings',
    teeth: 'render',
    prompt: true,
    note: 'Contrast is computed at seed; which pair is actually used needs the render.',
  },
  {
    key: 'palette.rules.externalColors',
    teeth: 'static',
    prompt: true,
    note: 'Rejects off-palette hex and any rgb()/hsl() literal.',
  },
  {
    key: 'palette.rules.references',
    teeth: 'static',
    prompt: true,
    note: 'Settled #160: colours are var(--ds-<token>), hex only in :root, so the role survives into the output.',
  },
  {
    key: 'palette.rules.minContrastRatio',
    teeth: 'seed',
    prompt: false,
    note: 'Validates the definition itself, not the document.',
  },

  {
    key: 'typography.fonts',
    teeth: 'static',
    prompt: true,
    note: 'font-family and the Google Fonts request must both resolve here.',
  },
  {
    key: 'typography.scale',
    teeth: 'static',
    prompt: true,
    note: 'font-size is exact-set membership. The per-step `use` line is the guidance half.',
  },
  {
    key: 'typography.rules.minPx',
    teeth: 'static',
    prompt: false,
    note: 'Redundant against the scale, but catches a bad definition at seed.',
  },
  {
    key: 'typography.rules.maxLineLengthCh',
    teeth: 'guidance',
    prompt: true,
    note: 'Depends on rendered glyph widths. Prompt-only unless #163 measures it.',
  },
  {
    key: 'typography.rules.transforms',
    teeth: 'static',
    prompt: true,
    note: 'text-transform allowlist.',
  },

  {
    key: 'spacing.scale',
    teeth: 'static',
    prompt: true,
    note: 'margin/padding/gap are exact-set membership. 0 and auto are always legal.',
  },
  {
    key: 'spacing.base',
    teeth: 'seed',
    prompt: false,
    note: 'Only validates that the scale is a real scale.',
  },

  {
    key: 'icons.allowed / sizes',
    teeth: 'static',
    prompt: true,
    note: 'Resolved against the app-owned inline catalog.',
  },
  {
    key: 'icons.rules.maxPerPage',
    teeth: 'static',
    prompt: true,
    note: 'Counted per page element.',
  },
  {
    key: 'icons.rules.role',
    teeth: 'guidance',
    prompt: true,
    note: 'Cannot be checked. It is the reason the icon list is short.',
  },

  {
    key: 'composition.pageRoles',
    teeth: 'static',
    prompt: true,
    note: 'Settled #160: #162 requires data-role on every page, so the role name, the first/last pins and required are all checked. The per-role guidance prose is not.',
  },
  {
    key: 'composition.principles',
    teeth: 'guidance',
    prompt: true,
    note: 'Pure prompt text. The expressive half of the contract.',
  },
  {
    key: 'composition.antiPatterns',
    teeth: 'guidance',
    prompt: true,
    note: 'Pairs avoid/instead so the model gets a replacement, not just a ban.',
  },
];

export const teethLabel: Record<Teeth, string> = {
  static: 'ENFORCED  (text checks, no browser)',
  render: 'ENFORCED  (needs the #163 render pass)',
  seed: 'ENFORCED  (at seed time, on the definition itself)',
  guidance: 'GUIDANCE  (prompt only, unenforceable)',
};
