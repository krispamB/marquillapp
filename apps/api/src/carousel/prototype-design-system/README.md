# PROTOTYPE — Design System Definition contract

Throwaway. Answers issue #160: *what should the versioned YAML contract for an
app-owned Design System contain so that it is expressive for the AI while
remaining parseable and enforceable by the backend?*

Not wired into the app. Excluded from `tsconfig.build.json` because it is
Bun-only (`Bun.YAML`, top-level await, `for await (… of console)`).

```
bun src/carousel/prototype-design-system/prototype.ts
```

| file | what it is |
|---|---|
| `editorial-serif.ds.yaml` | a full candidate definition |
| `contract.ts` | the Zod parse boundary, including the cross-reference checks |
| `prompt.ts` | parsed definition → the text the model reads |
| `enforce.ts` | parsed definition → violations in a Document Source |
| `ledger.ts` | every key, classified by who consumes it |
| `samples/conforming.html`, `samples/drifted.html` | Document Source to check against |
| `samples/broken.ds.yaml` | a definition that must not seed |

## What it showed

**One YAML, two consumers, no second source of truth.** The same parsed object
feeds `renderPromptFragment()` and `enforce()`. Nothing had to be restated in a
prompt constant, which is the property that makes a Design System a *contract*
rather than a prompt fragment with extra steps.

**The contract splits four ways, and the split is the answer.** 13 keys are
enforceable with text checks alone, 3 need the #163 render pass, 4 only ever
validate the definition itself at seed time, and 5 are pure prompt guidance.
Menu item 5 prints it. A key that lands in none of those columns does not belong
in the file.

**Exact-set membership is the strong lever.** `font-size` and every
margin/padding/gap being an enumerated step turns "this looks off-brand" into a
string comparison. Ranges would not: `font-size: 41px` is inside any sane range
and still wrong. The drifted sample trips 25 violations, all of them from set
membership or an allowlist.

**Cross-references are why parsing beats reading.** `samples/broken.ds.yaml`
raises 13 errors — unknown colour tokens, a font weight the family does not
ship, a scale step below the system's own floor, two page roles pinned to
`first` — all before a token is spent on generation.

**A cross-check the prototype found:** the safe area is applied as page padding,
so `page.safeArea` must be a value the spacing scale can express. The first
draft used 88px against a scale without it, which made every *conforming* page
violate the spacing rule. Now checked at seed (`contract.ts`).

**Expressiveness has a standing price:** this system renders to ~3.7k chars,
~940 tokens, paid on every generation *and* every repair attempt.

**The enforceability dial is real, and it was turned up.** Menu item 6 still
toggles it so the alternative stays visible, but `palette.rules.references:
token-var-only` is now part of the contract: hex literals live only in `:root`
and every use is `var(--ds-<token>)`. The looser rule caught off-palette colour
just as well; what strict buys is that the *role* a colour was playing survives
into the generated CSS, which is what a later recolour or contrast audit needs.
It costs the model discipline, so expect it in the repair statistics.

## Settled while reacting to this prototype

- **Strict palette references.** `palette.rules.references: token-var-only`, as
  above. Bare hex outside `:root` is a violation even when it matches a token.
- **Page roles are labelled and therefore enforced.** #162's envelope must
  require `data-role="<role>"` on every page element. That moved
  `composition.pageRoles` out of the guidance column: the role name, the
  `first`/`last` pins and `required` are all static checks now, and a repair
  diagnostic can name the page it means. Only the per-role `guidance` prose stays
  advisory.
- **Every guidance key stays.** `intent`, `principles`, `antiPatterns`,
  `icons.rules.role`, `maxLineLengthCh` and the per-step `use` lines are most of
  the ~940-token standing cost and are kept in full. The unenforceable half is
  what will make four systems feel different rather than four palettes; a repair
  round trip costs more than the prose does.

## Open questions this hands on

1. **Are icons mandatory?** (→ #166). `icons.allowed` is `min(1)`, so a system
   that wants no icons at all cannot express it. Needs a real fourth-system
   answer before the schema hardens.
2. **Where the Google Fonts allowlist lives** (→ #161). The definition declares
   `source: google`; something must check the family against the app-wide
   allowlist at seed time. Assumed to be seeding's job, not the contract's.
3. **Two version numbers.** `contract: 1` is the shape; `version: N` is the
   immutable snapshot (#161 owns its semantics). Recommend the app support
   exactly one contract version at a time and migrate seeds, rather than
   branching the parser.
4. **Do `typography.rules.minPx` and `spacing.base` earn their place?** They
   only ever validate the definition, never a document. Cheap, but they are the
   two keys nearest the cut line.
5. **Production needs a YAML dependency.** The repo has none; the prototype uses
   `Bun.YAML`. Seeding would need the `yaml` package.

## Boundaries respected

The Document Source envelope, CSS capabilities, size limits and sanitisation are
#162's — with one constraint handed to it: page elements carry `data-role`.
Persistence, identity, activation and seeding are #161's. The four launch
systems are #166's. Render-time geometry proof is #163's. This prototype only
asks what the definition holds and who can act on each part of it.
