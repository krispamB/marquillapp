import { parseDocument } from 'yaml';
import { z } from 'zod';
import { SUPPORTED_CONTRACT } from './design-system.constants';

/**
 * The Design System Definition contract (document generation spec §3.1),
 * promoted from the #134 prototype. YAML text in, a typed, cross-referenced
 * definition out: anything that parses is something the checkers can enforce.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;
const SLUG = /^[a-z][a-z0-9-]*$/;
const TOKEN = /^[a-zA-Z][a-zA-Z0-9]*$/;

const px = z.number().int().positive();
const token = z.string().regex(TOKEN);

export const colorRoles = ['background', 'text', 'accent', 'border'] as const;

const paletteToken = z.strictObject({
  name: token,
  hex: z.string().regex(HEX, 'must be a 6-digit hex colour'),
  role: z.enum(colorRoles),
});

const font = z.strictObject({
  name: token,
  family: z.string().min(1),
  // `system` families are never fetched; `google` families must clear
  // DESIGN_SYSTEM_FONT_ALLOWLIST before the definition may be seeded.
  source: z.enum(['google', 'system']),
  weights: z.array(z.number().int().min(100).max(900)).min(1),
  styles: z.array(z.enum(['normal', 'italic'])).min(1),
  fallback: z.string().min(1),
});

const typeStep = z.strictObject({
  name: token,
  px,
  lineHeight: z.number().positive(),
  tracking: z.string(),
  font: token,
  weight: z.number().int().min(100).max(900),
  use: z.string().min(1),
});

const pageRole = z.strictObject({
  name: z.string().regex(SLUG),
  position: z.enum(['first', 'last', 'any']).default('any'),
  required: z.boolean().default(false),
  guidance: z.string().min(1),
});

const definitionShape = z.strictObject({
  contract: z.literal(SUPPORTED_CONTRACT),
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
    pages: z.strictObject({
      min: z.number().int().min(1),
      max: z.number().int().min(1),
    }),
    background: token,
  }),

  palette: z.strictObject({
    tokens: z.array(paletteToken).min(2),
    pairings: z.array(z.strictObject({ text: token, on: token })).min(1),
    rules: z.strictObject({
      externalColors: z.enum(['forbid']),
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
    colors: z.array(token).min(1),
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
});

type DefinitionShape = z.infer<typeof definitionShape>;
type Path = (string | number)[];

/**
 * The 13 parse-time cross-reference errors (§3.1 rule 5). A name that resolves
 * nowhere is a definition the checkers cannot enforce, so it fails here, before
 * a single token is spent on generation.
 */
function crossReferenceErrors(ds: DefinitionShape): [Path, string][] {
  const errors: [Path, string][] = [];
  const bad = (path: Path, message: string) => errors.push([path, message]);
  const colors = new Set(ds.palette.tokens.map((t) => t.name));
  const fonts = new Map(ds.typography.fonts.map((f) => [f.name, f]));
  const unknownColor = (name: string) => `unknown colour token "${name}"`;

  // 1. Every lookup below is by name, so names must be unique per list.
  const lists: [Path, { name: string }[]][] = [
    [['palette', 'tokens'], ds.palette.tokens],
    [['typography', 'fonts'], ds.typography.fonts],
    [['typography', 'scale'], ds.typography.scale],
    [['composition', 'pageRoles'], ds.composition.pageRoles],
  ];
  for (const [path, items] of lists) {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      if (seen.has(item.name))
        bad([...path, i, 'name'], `duplicate name "${item.name}"`);
      seen.add(item.name);
    });
  }

  // 2. A page range that admits no page count.
  if (ds.page.pages.max < ds.page.pages.min)
    bad(['page', 'pages', 'max'], 'pages.max must be >= pages.min');

  // 3. The default page ground.
  if (!colors.has(ds.page.background))
    bad(['page', 'background'], unknownColor(ds.page.background));

  // 4, 5. Both sides of every approved pairing.
  ds.palette.pairings.forEach((p, i) => {
    if (!colors.has(p.text))
      bad(['palette', 'pairings', i, 'text'], unknownColor(p.text));
    if (!colors.has(p.on))
      bad(['palette', 'pairings', i, 'on'], unknownColor(p.on));
  });

  ds.typography.scale.forEach((s, i) => {
    const f = fonts.get(s.font);
    // 6. A step set in a font the system does not declare.
    if (!f)
      bad(['typography', 'scale', i, 'font'], `unknown font token "${s.font}"`);
    // 7. A weight the declared family does not ship.
    else if (!f.weights.includes(s.weight))
      bad(
        ['typography', 'scale', i, 'weight'],
        `font "${s.font}" does not ship weight ${s.weight}`,
      );
    // 8. A step below the system's own floor.
    if (s.px < ds.typography.rules.minPx)
      bad(
        ['typography', 'scale', i, 'px'],
        `${s.px}px is below typography.rules.minPx (${ds.typography.rules.minPx})`,
      );
  });

  // 9. Icon colours are palette tokens.
  ds.icons.colors.forEach((c, i) => {
    if (!colors.has(c)) bad(['icons', 'colors', i], unknownColor(c));
  });

  // 10. The spacing scale is built on its base.
  ds.spacing.scale.forEach((v, i) => {
    if (v % ds.spacing.base !== 0)
      bad(
        ['spacing', 'scale', i],
        `${v} is not a multiple of spacing.base (${ds.spacing.base})`,
      );
  });

  // 11. The safe area becomes page padding, so the spacing scale must express
  // it, or every conforming page would violate the spacing rule.
  const space = new Set(ds.spacing.scale);
  (['top', 'right', 'bottom', 'left'] as const).forEach((side) => {
    const value = ds.page.safeArea[side];
    if (!space.has(value))
      bad(
        ['page', 'safeArea', side],
        `${value} is not a step in the spacing scale`,
      );
  });

  // 12, 13. At most one role pinned to each end.
  (['first', 'last'] as const).forEach((position) => {
    const pinned = ds.composition.pageRoles.filter(
      (r) => r.position === position,
    );
    if (pinned.length > 1)
      bad(
        ['composition', 'pageRoles'],
        `more than one page role is pinned to position "${position}"`,
      );
  });

  return errors;
}

export const designSystemDefinitionSchema = definitionShape.superRefine(
  (ds, ctx) => {
    for (const [path, message] of crossReferenceErrors(ds))
      ctx.addIssue({ code: 'custom', path, message });
  },
);

export type DesignSystemDefinition = z.infer<
  typeof designSystemDefinitionSchema
>;

export type DefinitionParseResult =
  | { success: true; definition: DesignSystemDefinition }
  | { success: false; errors: string[] };

const formatPath = (path: PropertyKey[]): string =>
  path.length ? path.map(String).join('.') : '(root)';

/** Parses one definition's YAML text. Reports every error, never the first. */
export function parseDesignSystemDefinition(
  yamlText: string,
): DefinitionParseResult {
  const document = parseDocument(yamlText);
  if (document.errors.length > 0) {
    return {
      success: false,
      errors: document.errors.map((error) => `yaml: ${error.message}`),
    };
  }

  const parsed = designSystemDefinitionSchema.safeParse(document.toJS());
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map(
        (issue) => `${formatPath(issue.path)}: ${issue.message}`,
      ),
    };
  }
  return { success: true, definition: parsed.data };
}
