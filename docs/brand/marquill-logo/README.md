# Marquill logo

Mark, the writer inside Marquill: a dot with one eye open and the other the underscore from `marquill_`.

## Which file do I need?

| I need | Use |
| --- | --- |
| The logo as a PNG | `png/marquill-mark-on-light-1024.png` (dark backgrounds: `on-dark`) |
| Logo with the name | `png/marquill-lockup-on-light.png` or `on-dark` |
| A profile picture or app icon | `png/marquill-app-icon-light-1024.png` or `dark` |
| Print, stamps, or one colour on a coloured background | `svg/marquill-mark-mono-black.svg` or `mono-white` |
| Anything that scales | the matching file in `svg/` |
| A website favicon | everything in `favicon/` |

`on-light` means "for use on a light background" and draws the black dot. `on-dark` draws the off-white dot.

## What's here

- `preview.png`: every version together, at a glance.
- `svg/`: mark, small-size mark, one-colour mark, and lockup. The wordmark is outlined, so no font is needed.
- `png/`: transparent marks from 16 to 1024px, one-colour marks, lockups at 1600px wide, and solid-background app icons from 180 to 1024px.
- `favicon/`: `favicon.svg` (follows the browser's light or dark mode), `favicon.ico`, sized PNGs, and `apple-touch-icon.png`.

## Colors

| Part | On light | On dark |
| --- | --- | --- |
| Dot | `#0a0a0a` | `#f4f4f1` |
| Eye | `#ffffff` | `#0a0a0a` |
| Caret | `#5A90F2` | `#2A6FDB` |

## Using it

- Use the `small` SVGs at 24px and below. Their eye and caret are heavier so the face survives; the PNGs at 16 and 24px already use this cut.
- Keep clear space of at least a quarter of the mark's width around it.
- The eye is on the left and the caret is on the right. Don't flip, rotate, or recolor it, and don't place the ink dot on a dark background.
- The caret may pulse only while Mark is working. It always stays visible, and the logo itself never blinks.

In the web app, use `MarquillMark` and `MarquillLockup` from `apps/web/components/brand/` instead of these files. They handle light and dark mode, the small cut, and the `working` state.
