# Default Design Systems

The six app-owned Design Systems chosen on krispamB/marquillapp#140. Each
directory is one system:

```
<id>/
  definition.ds.yaml   contract-v1 Design System Definition (the seed, #135)
  sample.html          a Candidate Source that conforms to the definition
  previews/page-NN.png that sample rendered one page per image, 540x675
```

| id | Name | Look |
| --- | --- | --- |
| `broadside` | Broadside | Swiss poster: condensed capitals, cobalt slab, red rules, newsprint |
| `colophon` | Colophon | Magazine feature: Didone serif, oversized oxblood numeral cropped off the edge |
| `margin` | Margin | Quiet minimalism: one family, no accent, mostly empty page |
| `afterglow` | Afterglow | Night mode: violet-to-tangerine glow on near-black, glass panels |
| `overprint` | Overprint | Risograph zine: overlapping fluoro and sunflower shapes, blue ink |
| `schematic` | Schematic | Blueprint: drafting grid, mono annotations, callouts, title block |

All six samples are written on the same topic, so the previews compare design,
not content. They exist so a user choosing a Design System sees real pages from
it, not a description.

**Keep the three files in step.** A change to a definition means a new
`version` (#135: same-version content changes are fatal at seed) and a
re-checked sample with re-rendered previews. Until the Browserless render
path renders previews, they are produced by the #140 prototype with local
Chrome:

```
bun src/carousel/prototype-design-systems/preview.ts --check    # parse + checker + contrast
bun src/carousel/prototype-design-systems/preview.ts --render   # rewrite previews/
```

Samples reference icons as `<svg data-icon data-size>` placeholders and are not
assembled; assembly (#136) inlines them.
