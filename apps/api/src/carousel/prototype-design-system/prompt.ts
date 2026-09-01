/**
 * PROTOTYPE — the other half of the contract: what the model reads.
 * Throwaway (issue #160).
 *
 * The same parsed object that feeds `enforce()` feeds this. That is the claim
 * the ticket is testing: one YAML, two consumers, no second source of truth.
 */
import type { DesignSystem } from './contract';

const bullets = (xs: string[]) =>
  xs.map((x) => `- ${x.trim().replace(/\s+/g, ' ')}`).join('\n');

export function renderPromptFragment(ds: DesignSystem): string {
  const p = ds.page;
  const t = ds.typography;

  return `DESIGN SYSTEM: ${ds.name} (${ds.id} v${ds.version})
${ds.summary}

${ds.intent.trim().replace(/\s+/g, ' ')}

PAGE
- Every page is exactly ${p.width}x${p.height}px. Content stays inside a safe area of ${p.safeArea.top}px top, ${p.safeArea.right}px right, ${p.safeArea.bottom}px bottom, ${p.safeArea.left}px left.
- The document has ${p.pages.min} to ${p.pages.max} pages. Default page ground is ${p.background}.

COLOUR — declare these tokens once in :root, then reference them only as var(--ds-<token>)
${ds.palette.tokens.map((c) => `- ${c.name} ${c.hex} (${c.role}) -> var(--ds-${c.name})`).join('\n')}
A raw colour value anywhere outside the :root block is rejected, even if it matches a token.
Text/background combinations that are approved:
${ds.palette.pairings.map((x) => `- ${x.text} on ${x.on}`).join('\n')}

TYPE — every font-size must be one of these steps
${t.scale
  .map(
    (s) =>
      `- ${s.name}: ${s.px}px / line-height ${s.lineHeight} / ${s.tracking} / ${s.font} ${s.weight} — ${s.use}`,
  )
  .join('\n')}
Fonts: ${t.fonts.map((f) => `${f.name} = "${f.family}" (${f.source}, weights ${f.weights.join('/')}), fallback ${f.fallback}`).join('; ')}.
Keep lines under about ${t.rules.maxLineLengthCh} characters. Allowed text-transform values: ${t.rules.transforms.join(', ')}.

SPACING — every margin, padding and gap is one of these px values
${ds.spacing.scale.join(', ')}

ICONS
- Available: ${ds.icons.allowed.join(', ')}. Sizes: ${ds.icons.sizes.join(', ')}px. Colours: ${ds.icons.colors.join(', ')}.
- At most ${ds.icons.rules.maxPerPage} per page, and ${ds.icons.rules.role} only — an icon never carries meaning the reader needs.

PAGE ROLES — every page element carries data-role="<role>"
${ds.composition.pageRoles
  .map(
    (r) =>
      `- ${r.name}${r.position !== 'any' ? ` (${r.position} page${r.required ? ', required' : ''})` : ''}: ${r.guidance.trim().replace(/\s+/g, ' ')}`,
  )
  .join('\n')}

COMPOSITION
${bullets(ds.composition.principles)}

DO NOT
${ds.composition.antiPatterns.map((a) => `- ${a.avoid} Instead: ${a.instead}`).join('\n')}

These are limits, not suggestions. A page that uses a colour, size, spacing value
or icon outside the lists above is rejected and regenerated, not corrected.`;
}
