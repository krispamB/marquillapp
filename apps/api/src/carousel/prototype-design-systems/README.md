# PROTOTYPE — six candidate default Design Systems (issue #140)

Throwaway. Not loaded by the app. Answers: *what should the default Design
Systems look like as contract-v1 definitions, and are they distinct enough?*

```
bun src/carousel/prototype-design-systems/preview.ts           # http://localhost:4140/?variant=overview
bun src/carousel/prototype-design-systems/preview.ts --check   # parse + checker + contrast, no server
bun src/carousel/prototype-design-systems/preview.ts --render  # rewrite assets/design-systems/*/previews
```

`←`/`→` or the bottom bar cycles `overview` and the six systems. Each system is
a definition plus a hand-written sample Document Source on the same topic,
parsed by the #134 contract and checked by its static `enforce()`. Icons are
inlined from the #137 stand-in catalog.

**Outcome:** all six were kept. The definitions, samples and rendered previews
moved to `assets/design-systems/<id>/` as the default seeds and the UI's
preview references; this folder now only holds the viewer and renderer
(`--render` rewrites `previews/`).

| id | Name | Replaces | Signature |
| --- | --- | --- | --- |
| `broadside` | Broadside | `bold` | Anton condensed caps, cobalt slab, signal-red rules, newsprint |
| `colophon` | Colophon | `editorial` | Bodoni Moda + Oswald, oxblood numeral cropped off the edge, bone paper |
| `margin` | Margin | `minimal` | One family (Inter Tight), no accent, shared baseline, mostly empty |
| `afterglow` | Afterglow | `gradient` | Near-black with violet/rose/tangerine glow pools, glass panels |
| `overprint` | Overprint | — | Riso zine: multiplying fluoro/sunflower shapes, off-register blue ink |
| `schematic` | Schematic | — | Blueprint grid, mono annotations, callout boxes, title block |

## Findings

- All six parse and pass their own checker with zero violations; every declared
  pairing clears 4.5:1. Standing prompt cost is ~850–1,140 tokens each.
- The checker caught one real authoring slip: a layout offset written as
  `margin-left: 480px`, off the spacing scale. Scale-only spacing pushes
  positioning into `width`, `align-self` and `position`, which the checker does
  not see. Expect the model to hit the same wall.
- Unquoted YAML scalars that start with a quote (`fallback: 'Helvetica Neue',
  Arial`) fail to parse. Seeds must quote font fallbacks.
- Gradients, glow, glass and blend modes are expressible under
  `token-var-only` (`linear-gradient(var(--ds-a), …)`, `color-mix(…)`,
  `mix-blend-mode`), so Afterglow and Overprint need no contract change. Whether
  #136's CSS allowlist grammar admits `color-mix`, `backdrop-filter`,
  `filter: blur` and `mix-blend-mode` is still open.
- Contrast is only checked on declared pairings. Afterglow's first closing draft
  put moon text on the rose part of the gradient (3.3:1) and nothing flagged it;
  text over a gradient needs the render pass (#137) or a rule against it.
- `icons.allowed` stays `min(1)`: even Margin wants one arrow.
- Fonts to add to `DESIGN_SYSTEM_FONT_ALLOWLIST`: Anton, Archivo, Bodoni Moda,
  Oswald, Inter, Inter Tight, Sora, Manrope, Bricolage Grotesque, Space Mono,
  Space Grotesk, JetBrains Mono.
