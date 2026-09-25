import { z } from 'zod';

/**
 * A carousel slide's *role* on the deck. Distinct from the deck-level
 * `CarouselTheme` (its look, in `src/database/schemas`): a real carousel is a
 * cover (the hook), body slides, and a call to action — visually different
 * roles — all rendered in one consistent theme.
 */
export const slideTypes = ['cover', 'content', 'list', 'quote', 'cta'] as const;

export type SlideType = (typeof slideTypes)[number];

/**
 * A trimmed, non-empty string capped at `n` characters. The cap is a *fit*
 * contract: a 1080x1350 slide has no scroll, so `n` is sized to the tightest
 * theme. It is only a proxy for rendered width, hence enforced three ways
 * (prompt, this Zod cap, and the template frame's `overflow: hidden`).
 */
const cap = (n: number) => z.string().trim().min(1).max(n);

/**
 * Field schemas attach to the slide *type*, not the theme: every theme renders
 * the same five typed shapes and differs only in look. This is the single Zod
 * contract that serves the artifact content union, the agent's generation
 * contract, and all four themes at once — so it must stay uniform.
 */
export const slideFieldSchemas = {
  cover: z.object({
    eyebrow: cap(24).optional(),
    title: cap(70),
    subtitle: cap(120).optional(),
  }),
  content: z.object({
    heading: cap(60),
    body: cap(280),
  }),
  list: z.object({
    heading: cap(60),
    items: z.array(cap(80)).min(2).max(6),
  }),
  quote: z.object({
    quote: cap(200),
    attribution: cap(48).optional(),
  }),
  cta: z.object({
    headline: cap(70),
    action: cap(40),
    handle: cap(40).optional(),
  }),
} as const;

/**
 * Discriminated on `type` so a future `image` arm touches no existing one, and
 * so a slide's fields are narrowed to exactly its role's shape.
 */
export const slideSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('cover'), fields: slideFieldSchemas.cover }),
  z.object({ type: z.literal('content'), fields: slideFieldSchemas.content }),
  z.object({ type: z.literal('list'), fields: slideFieldSchemas.list }),
  z.object({ type: z.literal('quote'), fields: slideFieldSchemas.quote }),
  z.object({ type: z.literal('cta'), fields: slideFieldSchemas.cta }),
]);

export type Slide = z.infer<typeof slideSchema>;

/** A deck is 2-15 slides; one HTML document, one page per slide. */
export const slidesSchema = z.array(slideSchema).min(2).max(15);

export type Slides = z.infer<typeof slidesSchema>;
