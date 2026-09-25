/**
 * PROTOTYPE — the Design System Definition contract, v1. Throwaway (issue #160).
 *
 * This is the parse boundary: YAML text in, a typed, cross-referenced Design
 * System out. Everything a Document Source is later checked against comes from
 * here, so a definition that parses is a definition the backend can enforce.
 */
import { z } from 'zod';

const HEX = /^#[0-9a-fA-F]{6}$/;
const SLUG = /^[a-z][a-z0-9-]*$/;
const TOKEN = /^[a-zA-Z][a-zA-Z0-9]*$/;

const px = z.number().int().positive();

export const colorRoles = ['background', 'text', 'accent', 'border'] as const;

const paletteToken = z.strictObject({
  name: z.string().regex(TOKEN),
  hex: z.string().regex(HEX, 'must be a 6-digit hex colour'),
  role: z.enum(colorRoles),
});

const font = z.strictObject({
  name: z.string().regex(TOKEN),
  family: z.string().min(1),
  // `system` families are never fetched; `google` families must clear the
  // app-owned Google Fonts allowlist before a definition may be seeded.
  source: z.enum(['google', 'system']),
  weights: z.array(z.number().int().min(100).max(900)).min(1),
  styles: z.array(z.enum(['normal', 'italic'])).min(1),
  fallback: z.string().min(1),
});

const typeStep = z.strictObject({
  name: z.string().regex(TOKEN),
  px,
  lineHeight: z.number().positive(),
  tracking: z.string(),
  font: z.string().regex(TOKEN),
  weight: z.number().int().min(100).max(900),
  use: z.string().min(1), // guidance: the only prose in the enforced half
});

const pageRole = z.strictObject({
  name: z.string().regex(SLUG),
  position: z.enum(['first', 'last', 'any']).default('any'),
  required: z.boolean().default(false),
  guidance: z.string().min(1),
});

export const designSystemSchema = z
  .strictObject({
    contract: z.literal(1),
    id: z.string().regex(SLUG),
    version: z.number().int().positive(),
    name: z.string().min(1),
    summary: z.string().min(1),
    intent: z.string().min(1),

    page: z.strictObject({
      width: px,
      height: px,
      safeArea: z.strictObject({
        top: z.number().int().nonnegative(),
        right: z.number().int().nonnegative(),
        bottom: z.number().int().nonnegative(),
        left: z.number().int().nonnegative(),
      }),
      pages: z
        .strictObject({
          min: z.number().int().min(1),
          max: z.number().int().min(1),
        })
        .refine((p) => p.max >= p.min, 'pages.max must be >= pages.min'),
      background: z.string().regex(TOKEN),
    }),

    palette: z.strictObject({
      tokens: z.array(paletteToken).min(2),
      pairings: z
        .array(
          z.strictObject({
            text: z.string().regex(TOKEN),
            on: z.string().regex(TOKEN),
          }),
        )
        .min(1),
      rules: z.strictObject({
        externalColors: z.enum(['forbid']),
        // Settled on #160: the token *name* must survive into the generated
        // CSS, so colours are referenced as var(--ds-<token>) and hex literals
        // live only in the :root block.
        references: z.enum(['token-var-only']),
        minContrastRatio: z.number().min(1).max(21),
      }),
    }),

    typography: z.strictObject({
      fonts: z.array(font).min(1),
      scale: z.array(typeStep).min(2),
      rules: z.strictObject({
        sizes: z.enum(['scale-only']),
        minPx: px,
        maxLineLengthCh: z.number().int().positive(),
        transforms: z
          .array(z.enum(['none', 'uppercase', 'lowercase', 'capitalize']))
          .min(1),
      }),
    }),

    spacing: z.strictObject({
      base: px,
      scale: z.array(z.number().int().nonnegative()).min(3),
      rules: z.strictObject({
        values: z.enum(['scale-only']),
        appliesTo: z.array(z.enum(['margin', 'padding', 'gap'])).min(1),
      }),
    }),

    icons: z.strictObject({
      catalog: z.string().regex(SLUG),
      allowed: z.array(z.string().regex(SLUG)).min(1),
      sizes: z.array(px).min(1),
      colors: z.array(z.string().regex(TOKEN)).min(1),
      rules: z.strictObject({
        maxPerPage: z.number().int().nonnegative(),
        role: z.enum(['decorative']),
      }),
    }),

    composition: z.strictObject({
      pageRoles: z.array(pageRole).min(1),
      principles: z.array(z.string().min(1)).min(1),
      antiPatterns: z
        .array(
          z.strictObject({
            avoid: z.string().min(1),
            instead: z.string().min(1),
          }),
        )
        .min(1),
    }),
  })
  // Cross-references are the point of parsing: a token name that resolves
  // nowhere is a definition the enforcement layer cannot check, so it is
  // rejected at seed time rather than at generation time.
  .superRefine((ds, ctx) => {
    const colors = new Set(ds.palette.tokens.map((t) => t.name));
    const fonts = new Set(ds.typography.fonts.map((f) => f.name));
    const bad = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });

    if (!colors.has(ds.page.background))
      bad(
        ['page', 'background'],
        `unknown colour token "${ds.page.background}"`,
      );

    ds.palette.pairings.forEach((p, i) => {
      if (!colors.has(p.text))
        bad(
          ['palette', 'pairings', i, 'text'],
          `unknown colour token "${p.text}"`,
        );
      if (!colors.has(p.on))
        bad(['palette', 'pairings', i, 'on'], `unknown colour token "${p.on}"`);
    });

    ds.typography.scale.forEach((s, i) => {
      if (!fonts.has(s.font))
        bad(
          ['typography', 'scale', i, 'font'],
          `unknown font token "${s.font}"`,
        );
      if (s.px < ds.typography.rules.minPx)
        bad(
          ['typography', 'scale', i, 'px'],
          `${s.px}px is below typography.rules.minPx (${ds.typography.rules.minPx})`,
        );
      const f = ds.typography.fonts.find((x) => x.name === s.font);
      if (f && !f.weights.includes(s.weight))
        bad(
          ['typography', 'scale', i, 'weight'],
          `font "${s.font}" does not ship weight ${s.weight}`,
        );
    });

    ds.icons.colors.forEach((c, i) => {
      if (!colors.has(c))
        bad(['icons', 'colors', i], `unknown colour token "${c}"`);
    });

    ds.spacing.scale.forEach((v, i) => {
      if (v % ds.spacing.base !== 0)
        bad(
          ['spacing', 'scale', i],
          `${v} is not a multiple of spacing.base (${ds.spacing.base})`,
        );
    });

    // The safe area is applied as page padding, so it must be a value the
    // spacing scale can express -- otherwise every page violates the spacing
    // rule just by respecting the safe area. (Found by the prototype.)
    const space = new Set(ds.spacing.scale);
    (['top', 'right', 'bottom', 'left'] as const).forEach((side) => {
      const val = ds.page.safeArea[side];
      if (!space.has(val))
        bad(
          ['page', 'safeArea', side],
          `${val} is not a step in the spacing scale`,
        );
    });

    (['first', 'last'] as const).forEach((pos) => {
      const at = ds.composition.pageRoles.filter((r) => r.position === pos);
      if (at.length > 1)
        bad(
          ['composition', 'pageRoles'],
          `more than one page role is pinned to position "${pos}"`,
        );
    });
  });

export type DesignSystem = z.infer<typeof designSystemSchema>;

export function parseDesignSystem(yamlText: string) {
  const raw: unknown = Bun.YAML.parse(yamlText);
  return designSystemSchema.safeParse(raw);
}
