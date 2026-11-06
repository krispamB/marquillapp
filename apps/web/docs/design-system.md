# Marquill design system (web app)

The product UI is quiet and compact. People compared it with ChatGPT, Claude, and Railway and said everything felt too large, so the rule of thumb is: smaller chrome, fewer surfaces, one obvious action. Colors and components are the brand; this document governs size, spacing, and emphasis.

The tokens live in `:root` at the top of `app/globals.css`. Component styles are `.mq-*` classes in that file; onboarding uses `.ob-*` in `app/onboarding/onboarding.css`.

## Type

| Token | Size | Use |
| --- | --- | --- |
| `--fs-2xs` | 11px | Tags, meta, tab bar labels. Nothing real is smaller. |
| `--fs-xs` | 12px | Secondary text, descriptions under a title |
| `--fs-sm` | 13px | Buttons, inputs, rows, default desktop body |
| `--fs-md` | 14px | Card titles, reading text, default mobile body |
| `--fs-lg` | 16px | Modal and sheet titles |
| `--fs-xl` | 20px | Page headings, stat values |
| `--fs-2xl` | 24px | One hero per screen at most (Studio, empty states, onboarding) |

- Weights are 400, 500, and 600. Nothing is heavier than 600.
- Tracking is `-.02em` at 20px and up, `-.01em` at 14 to 16px, and 0 below. Uppercase labels use `.04em`.
- Text under 11px is allowed only inside decorative miniatures that imitate a document, and in brand marks.
- The mono font is a brand accent for short captions, at `--fs-2xs` in `--ink-500`. Sentences use the sans font.
- Helper text people need to read uses `--ink-500`. `--ink-400` is for placeholders and disabled states; in dark mode it is too dim for anything else.
- iOS zooms on any field under 16px, so the `@media (pointer: coarse)` block forces fields to 16px. Keep it. Design fields to look right at 16px on touch.

## Controls

| Token | Desktop | Mobile | Use |
| --- | --- | --- | --- |
| `--ctl-sm` | 28px | 32px | Row actions, tags that act, dense toolbars |
| `--ctl-md` | 32px | 36px | Default: buttons, inputs, selects, segmented controls |
| `--ctl-lg` | 36px | 40px | The main action of a form or a dialog |
| `--icon-btn` | 32px | 36px | Icon-only buttons |

Size with the tokens rather than a raw `min-height`, so desktop and touch stay in step. The mobile tab bar is the exception; it keeps its own height.

**One filled primary per region.** A filled ink button means "this is the action here". Actions that repeat on every card or row use the secondary or ghost variant. Do not make a button full-width on mobile unless it ends a form or a sheet. An action can change variant between contexts for this reason: 'Attach to post' is secondary on a library card, where it repeats, and filled on an artifact's own page, where it is the one main action.

## Layout

- `--topbar-h` 48px, `--sidebar-w` 216px.
- `--gutter` is the page edge (24px, 16px on mobile). `--card-pad` is the inside of a card (16px, 14px on mobile). `--gap-section` separates cards and sections (16px, 12px on mobile).
- Other spacing stays on a 4px grid: 4, 8, 12, 16, 20, 24. Icon-to-label gaps may use 6px.
- One title per screen, at every width. If the top bar already names the page, the eyebrow hides and the `h1` takes `.mq-h1-dup`, which hides it visually while keeping it for screen readers. A greeting that says something new, like the Dashboard's, stays.

## Surfaces

- Radii: `--r-sm` 6px for small inner parts, `--r-md` 8px for controls, `--r-lg` 12px for cards, `--r-xl` 16px for modals, sheets, and the prompt composer. `--r-full` is for pills and avatars.
- Cards rest on a hairline border with no shadow. Only floating layers (menus, modals, sheets, the composer) cast a shadow: `--sh-md` or `--sh-lg`.
- Do not nest a bordered card inside a bordered card when spacing or a divider would do.

## Color

Use the existing ink, line, surface, and status tokens, and do not add colors. `--neg` and `--neg-bg` are for destructive and error states only; their values come from the reds the stylesheet already used. `--ink-600` sits between `--ink-700` and `--ink-500`.

## For agents changing the UI

1. Use a token. If no token fits, the design probably needs rethinking; ask before adding one.
2. Change the shared class rather than overriding it per screen. Do not add inline `style` sizes.
3. Check the screen at 1440x900 and 390x844, in light and dark, on a real page with real data. An empty account hides most layout problems. The dev server can keep serving old CSS after a branch switch or a stash, so touch `app/globals.css` and confirm the change is live before you trust a screenshot.
4. Mobile must have no sideways scroll and no clipped top bar at 360px. `scrollWidth` alone won't catch a grid cut off inside its own scroller, so look at the screenshot.
5. Don't leave internal text in the UI: handoff notes, placeholder explanations, or remarks about endpoints. An empty card with no action should render nothing.
6. The on-screen keyboard rules in `globals.css` and `KeyboardInsetSync.tsx` pin the studio form to the visible bottom on iOS. Test any change to the prompt card or the tab bar with those rules in mind.

`apps/api/assets/design-systems/` is a different thing: the Design Systems Mark uses to render documents. This file does not govern them.
