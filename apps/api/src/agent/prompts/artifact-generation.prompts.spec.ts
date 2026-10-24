// The prompt module reads `ArtifactType` through the `src/...` alias, which Jest
// does not resolve; only the constant under test is needed here.
jest.mock(
  'src/database/schemas',
  () => ({
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
  }),
  { virtual: true },
);

import type { BoundedViolations } from '../../document-source/violation';
import {
  buildDocumentPatchRepairUserPrompt,
  buildDocumentRepairFallbackUserPrompt,
  buildDocumentRepairUserPrompt,
  GENERATE_DOCUMENT_SYSTEM_PROMPT,
} from './artifact-generation.prompts';

describe('artifact-generation prompts', () => {
  describe('GENERATE_DOCUMENT_SYSTEM_PROMPT', () => {
    // The prompt is hard-wrapped; compare it as the model reads it.
    const prompt = GENERATE_DOCUMENT_SYSTEM_PROMPT.replace(/\s+/g, ' ');

    describe('page selectors', () => {
      it.each(['`*`', '`body > *`', '`html *`', '`:is()`', '`:where()`'])(
        'should name %s as a selector that matches a page when it lists the reserved selectors',
        (selector) => {
          expect(prompt).toContain(selector);
        },
      );

      it('should show `.page *` as the allowed reset when it forbids `*`', () => {
        expect(prompt).toContain('.page * { box-sizing: border-box; }');
      });

      it('should state that a page carries no class but page when it describes the body', () => {
        expect(prompt).toContain(
          '<section class="page" data-role="<role>"> and nothing else',
        );
      });
    });

    describe('frame', () => {
      it('should say the page is already padded when it describes the frame', () => {
        expect(prompt).toMatch(
          /Each page already has padding equal to the safe area/,
        );
      });

      it('should describe one unpadded wrapper when it describes the layout', () => {
        expect(prompt).toMatch(/height: 100%, no padding and no px height/);
      });

      it('should forbid overflow: hidden when the page already crops', () => {
        expect(prompt).toMatch(
          /The page already crops, so add no overflow: hidden/,
        );
      });

      it('should give the bleed recipe on an unpositioned wrapper when a page needs a full-page colour', () => {
        expect(prompt).toContain(
          "::before { content: ''; position: absolute; inset: 0; z-index: -1;",
        );
      });

      it('should ask for an explicit colour on the wrapper and each svg when text defaults to black', () => {
        expect(prompt).toMatch(/Set color on the wrapper and on every svg/);
      });

      it('should restrict characters to the declared fonts when it lists glyph rules', () => {
        expect(prompt).toMatch(/Use only characters the declared fonts cover/);
      });

      it('should put text on a solid token when it forbids mixed and translucent colour', () => {
        expect(prompt).toContain(
          'Put text on a solid palette token. Never set text on color-mix(), a translucent colour or a background with opacity.',
        );
      });

      it('should keep other text off decorative glyphs when it describes oversized type', () => {
        expect(prompt).toContain(
          'Decorative text, such as an oversized numeral or letter, is still text. Never place other text over it.',
        );
      });

      it('should keep markers inside their item when it describes bullets and numbers', () => {
        expect(prompt).toContain(
          'Markers stay inside their item. Give a bullet or number no negative offset that pushes it past the wrapper.',
        );
      });
    });
  });

  const CANDIDATE = '<!doctype html><html><body>13px</body></html>';
  const BOUNDED: BoundedViolations = {
    violations: [
      {
        code: 'typography.rules.minPx',
        detail: 'font-size 13px is below 14px',
        page: 2,
        line: 7,
      },
    ],
    omitted: [{ code: 'page.pages', count: 1 }],
  };

  describe('buildDocumentRepairUserPrompt', () => {
    it('should ask for the complete document as html when the Repair is in full mode', () => {
      expect(buildDocumentRepairUserPrompt(CANDIDATE, BOUNDED)).toBe(
        `Your document was rejected by the Design System checker.

VIOLATIONS:
- typography.rules.minPx (page 2, line 7): font-size 13px is below 14px
- Not listed: 1 more page.pages.

DOCUMENT:
${CANDIDATE}

Fix these violations and re-emit the complete document. Change nothing else.
Answer with JSON {"html": …} only.`,
      );
    });
  });

  describe('buildDocumentPatchRepairUserPrompt', () => {
    const prompt = buildDocumentPatchRepairUserPrompt(CANDIDATE, BOUNDED);

    it('should lay out the violations and the document as the full-mode prompt does', () => {
      const full = buildDocumentRepairUserPrompt(CANDIDATE, BOUNDED);
      const layout = full.slice(0, full.indexOf(CANDIDATE) + CANDIDATE.length);

      expect(prompt.startsWith(`${layout}\n\n`)).toBe(true);
    });

    it('should ask for edits whose finds are copied exactly, match once and do not overlap', () => {
      expect(prompt).toContain('Copy each "find" exactly from DOCUMENT');
      expect(prompt).toContain('match exactly once');
      expect(prompt).toContain('must not overlap');
      expect(prompt).toContain('at most 40 edits');
    });

    it('should ask for the complete document instead when a structural code is violated', () => {
      expect(prompt).toContain(
        'If any violation is envelope.body, page.pages or composition.pageRoles, re-emit the complete document instead.',
      );
    });

    it('should end by asking for edits with a null html, or a null edits with the complete document', () => {
      expect(prompt.split('\n').at(-1)).toBe(
        'Answer with JSON {"edits": [{"find": …, "replace": …}], "html": null}, or {"edits": null, "html": …} for the complete document.',
      );
    });
  });

  describe('buildDocumentRepairFallbackUserPrompt', () => {
    const prompt = buildDocumentRepairFallbackUserPrompt([
      'Edit 1: find not found: "13px".',
      'Edits 2 and 3: their find ranges overlap.',
    ]);

    it('should list each problem the edits had', () => {
      expect(prompt).toContain('- Edit 1: find not found: "13px".');
      expect(prompt).toContain('- Edits 2 and 3: their find ranges overlap.');
    });

    it('should end by asking for the complete document as html only', () => {
      expect(prompt).toContain(
        'Re-emit the complete document with the violations fixed. Change nothing else.',
      );
      expect(prompt.split('\n').at(-1)).toBe(
        'Answer with JSON {"html": …} only.',
      );
    });
  });
});
