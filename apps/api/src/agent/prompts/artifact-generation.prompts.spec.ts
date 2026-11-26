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
  buildDocumentGenerationUserPrompt,
  buildDocumentPatchRepairUserPrompt,
  buildDocumentRepairFallbackUserPrompt,
  buildDocumentRepairUserPrompt,
  buildGenerationUserPrompt,
  GENERATE_DOCUMENT_SYSTEM_PROMPT,
  GENERATE_POLL_SYSTEM_PROMPT,
  GENERATE_POST_SYSTEM_PROMPT,
} from './artifact-generation.prompts';
import { ArtifactType } from 'src/database/schemas';
import { todaySection } from './today.prompt';
import {
  resolveStylePresetInstruction,
  StylePreset,
} from '../style-presets.config';

describe('artifact-generation prompts', () => {
  describe('FEED RULES', () => {
    it.each([
      ['POST', GENERATE_POST_SYSTEM_PROMPT],
      ['POLL', GENERATE_POLL_SYSTEM_PROMPT],
      ['DOCUMENT', GENERATE_DOCUMENT_SYSTEM_PROMPT],
    ])(
      'should carry the anti-slop and save-worthiness rules when the type is %s',
      (_type, raw) => {
        const prompt = raw.replace(/\s+/g, ' ');
        expect(prompt).toContain('FEED RULES:');
        expect(prompt).toContain('Make it worth saving.');
        expect(prompt).toContain('Never use engagement bait');
        expect(prompt).toContain('Avoid these AI tells: em dashes;');
        expect(prompt).toContain('Never invent experience');
      },
    );
  });

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

  const TODAY_LINE =
    'TODAY: 2026-10-25 (Sunday). Treat this date as the present: "this year" means 2026. Prefer the most recent figures, and do not present an earlier year as current.';

  describe('buildGenerationUserPrompt', () => {
    it('should open with the date it is given when it writes a POST brief', () => {
      const prompt = buildGenerationUserPrompt({
        type: 'POST' as never,
        prompt: 'Hiring trends',
        today: '2026-10-25',
      });

      expect(prompt.split('\n\n')[0]).toBe(TODAY_LINE);
      expect(prompt).toContain('BRIEF:\nHiring trends');
    });

    it('should state the date when it writes a POLL brief', () => {
      const prompt = buildGenerationUserPrompt({
        type: 'POLL' as never,
        prompt: 'Remote work',
        today: '2026-10-25',
      });

      expect(prompt).toContain(TODAY_LINE);
    });

    it('should state the date when it writes a refine brief', () => {
      const prompt = buildGenerationUserPrompt({
        type: 'POST' as never,
        prompt: 'Hiring trends',
        today: '2026-10-25',
        refine: {
          priorContent: { commentary: 'Old post' } as never,
          feedback: 'Shorter',
          earlierFeedback: [],
          handEdited: false,
        },
      });

      expect(prompt).toContain(TODAY_LINE);
      expect(prompt).toContain('NEW REVISION REQUEST:\nShorter');
    });

    it('should name the weekday when given a run date', () => {
      const prompt = buildGenerationUserPrompt({
        type: 'POST' as never,
        prompt: 'Hiring trends',
        today: '2027-01-01',
      });

      expect(prompt).toContain('TODAY: 2027-01-01 (Friday).');
      expect(prompt).toContain('"this year" means 2027');
    });
  });

  describe('buildDocumentGenerationUserPrompt', () => {
    const base = {
      prompt: 'Five lessons from shipping',
      today: '2026-10-25',
      fragment: 'FRAGMENT',
      includeTitle: true,
      maxEnvelopeRepairs: 1,
    };

    it('should open with the date it is given when it writes a draft brief', () => {
      const prompt = buildDocumentGenerationUserPrompt(base);

      expect(prompt.split('\n\n')[0]).toBe(TODAY_LINE);
    });

    it('should state the date when it writes a refine brief', () => {
      const prompt = buildDocumentGenerationUserPrompt({
        ...base,
        includeTitle: false,
        refine: {
          candidate: '<html></html>',
          feedback: 'Fewer pages',
          earlierFeedback: [],
          handEdited: false,
          designSystemChanged: false,
        },
      });

      expect(prompt.split('\n\n')[0]).toBe(TODAY_LINE);
      expect(prompt).toContain('CURRENT DOCUMENT:\n<html></html>');
    });
  });

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

  describe('buildGenerationUserPrompt', () => {
    const brief = {
      type: ArtifactType.POST,
      prompt: 'The brief',
      today: '2026-10-25',
    };
    const sources = [{ title: 'A', url: 'https://a.com/' }];

    it('should label agent research as RESEARCH FINDINGS with its sources', () => {
      const prompt = buildGenerationUserPrompt({
        ...brief,
        research: { findings: 'A synthesis.', sources },
      });

      expect(prompt).toBe(
        `${todaySection(brief.today)}\n\nBRIEF:\nThe brief\n\nRESEARCH FINDINGS:\nA synthesis.\n\nSOURCES:\n- A (https://a.com/)`,
      );
    });

    it('should label snippet research as raw web excerpts when mode is snippets', () => {
      const findings = '[1] A (https://a.com/)\nAn excerpt.';
      const prompt = buildGenerationUserPrompt({
        ...brief,
        research: { findings, sources, mode: 'snippets' },
      });

      expect(prompt).toContain(
        `RESEARCH SNIPPETS (raw web excerpts; use only facts they state):\n${findings}`,
      );
      expect(prompt).not.toContain('RESEARCH FINDINGS');
    });

    it('should skip the research section when snippet research found nothing', () => {
      const prompt = buildGenerationUserPrompt({
        ...brief,
        research: { findings: '', sources: [], mode: 'snippets' },
      });

      expect(prompt).toBe(`${todaySection(brief.today)}\n\nBRIEF:\nThe brief`);
    });
  });
});

describe('refinement user prompts', () => {
  const TODAY = '2026-10-25';
  const PRECEDENCE_LEAD =
    'Apply only the new revision request; make no other change. The current version is the accepted text and overrides the original brief where they differ (this overrides writing from the brief).';
  const PRECEDENCE_EARLIER =
    ' The earlier revision requests are already applied and explain why the current version differs from the brief; do not re-apply them, and where the current version conflicts with one, the current version wins.';
  const PRECEDENCE_TAIL =
    ' Use the brief and research only to fill gaps and ground facts.';
  const precedence = (hasEarlier: boolean) =>
    PRECEDENCE_LEAD + (hasEarlier ? PRECEDENCE_EARLIER : '') + PRECEDENCE_TAIL;
  const HAND_EDIT =
    'The author edited the current version by hand; keep those edits.';
  const DESIGN_SYSTEM_CHANGED =
    'One exception: the Design System has changed since the current document was made. Rebuild the current document in the Design System the system prompt describes, using its layout, components and styles, and keep its content, the earlier revisions and any hand edits.';
  const research = {
    findings: 'A synthesis.',
    sources: [{ title: 'A', url: 'https://a.com/' }],
  };
  const RESEARCH =
    'RESEARCH FINDINGS:\nA synthesis.\n\nSOURCES:\n- A (https://a.com/)';
  const stylePreset = Object.values(StylePreset)[0];
  const VOICE = `VOICE:\n${resolveStylePresetInstruction(stylePreset)}`;

  describe('buildGenerationUserPrompt', () => {
    const initial = {
      type: ArtifactType.POST,
      prompt: 'The brief',
      today: TODAY,
      stylePreset,
      research,
    };
    const refine = {
      priorContent: { commentary: 'Current post' } as never,
      feedback: 'Add a list',
      earlierFeedback: [] as string[],
      handEdited: false,
    };
    const CURRENT = 'CURRENT VERSION:\n{"commentary":"Current post"}';
    const newRequest = (hasEarlier = false) =>
      `NEW REVISION REQUEST:\nAdd a list\n\n${precedence(hasEarlier)}`;
    const NEW = newRequest();

    it('should leave the initial prompt as it was when there is no refinement', () => {
      expect(buildGenerationUserPrompt(initial)).toBe(
        [todaySection(TODAY), 'BRIEF:\nThe brief', VOICE, RESEARCH].join(
          '\n\n',
        ),
      );
    });

    it('should give the precedence instruction with no earlier requests on a first refinement', () => {
      const prompt = buildGenerationUserPrompt({ ...initial, refine });

      expect(prompt).toBe(
        [
          todaySection(TODAY),
          'ORIGINAL BRIEF:\nThe brief',
          VOICE,
          RESEARCH,
          CURRENT,
          NEW,
        ].join('\n\n'),
      );
      expect(prompt).not.toContain('EARLIER REVISION REQUESTS');
      expect(prompt).not.toContain('earlier revision requests');
    });

    it('should list the earlier requests after the brief and research on a later refinement', () => {
      const prompt = buildGenerationUserPrompt({
        ...initial,
        refine: { ...refine, earlierFeedback: ['Shorter', 'Drop the hook'] },
      });

      expect(prompt).toBe(
        [
          todaySection(TODAY),
          'ORIGINAL BRIEF:\nThe brief',
          VOICE,
          RESEARCH,
          'EARLIER REVISION REQUESTS:\n1. Shorter\n2. Drop the hook',
          CURRENT,
          newRequest(true),
        ].join('\n\n'),
      );
    });

    it('should ask to keep hand edits when the base was edited by hand', () => {
      const prompt = buildGenerationUserPrompt({
        ...initial,
        refine: { ...refine, handEdited: true },
      });

      expect(prompt).toContain(`${CURRENT}\n\n${HAND_EDIT}\n\n${NEW}`);
    });

    it('should not mention hand edits when the base was not edited by hand', () => {
      const prompt = buildGenerationUserPrompt({ ...initial, refine });

      expect(prompt).not.toContain(HAND_EDIT);
    });
  });

  describe('buildDocumentGenerationUserPrompt', () => {
    const initial = {
      prompt: 'The brief',
      today: TODAY,
      stylePreset,
      research,
      fragment: 'FRAGMENT',
      includeTitle: false,
      maxEnvelopeRepairs: 1,
    };
    const refine = {
      candidate: '<html></html>',
      commentary: 'Swipe through.',
      feedback: 'Fewer pages',
      earlierFeedback: [] as string[],
      handEdited: false,
      designSystemChanged: false,
    };
    const CURRENT =
      'CURRENT DOCUMENT:\n<html></html>\n\nCURRENT COMMENTARY:\nSwipe through.';
    const newRequest = (hasEarlier = false) =>
      `NEW REVISION REQUEST:\nFewer pages\n\n${precedence(hasEarlier)}\n\nRe-emit the complete document as "html", with its commentary.`;
    const NEW = newRequest();

    it('should leave the initial prompt as it was when there is no refinement', () => {
      expect(buildDocumentGenerationUserPrompt(initial)).toBe(
        [todaySection(TODAY), 'BRIEF:\nThe brief', VOICE, RESEARCH].join(
          '\n\n',
        ),
      );
    });

    it('should ask for the complete document with no earlier requests on a first refinement', () => {
      const prompt = buildDocumentGenerationUserPrompt({ ...initial, refine });

      expect(prompt).toBe(
        [
          todaySection(TODAY),
          'ORIGINAL BRIEF:\nThe brief',
          VOICE,
          RESEARCH,
          CURRENT,
          NEW,
        ].join('\n\n'),
      );
    });

    it('should give the same earlier requests block and hand-edit line as a POST', () => {
      const prompt = buildDocumentGenerationUserPrompt({
        ...initial,
        refine: {
          ...refine,
          earlierFeedback: ['Shorter', 'Drop the hook'],
          handEdited: true,
        },
      });

      expect(prompt).toBe(
        [
          todaySection(TODAY),
          'ORIGINAL BRIEF:\nThe brief',
          VOICE,
          RESEARCH,
          'EARLIER REVISION REQUESTS:\n1. Shorter\n2. Drop the hook',
          CURRENT,
          HAND_EDIT,
          newRequest(true),
        ].join('\n\n'),
      );
    });

    it('should ask to rebuild in the new Design System when the pin changed', () => {
      const prompt = buildDocumentGenerationUserPrompt({
        ...initial,
        refine: { ...refine, designSystemChanged: true },
      });

      expect(prompt).toBe(
        [
          todaySection(TODAY),
          'ORIGINAL BRIEF:\nThe brief',
          VOICE,
          RESEARCH,
          CURRENT,
          `NEW REVISION REQUEST:\nFewer pages\n\n${precedence(false)}`,
          DESIGN_SYSTEM_CHANGED,
          'Re-emit the complete document as "html", with its commentary.',
        ].join('\n\n'),
      );
    });

    it('should not mention a Design System change when the pin is unchanged', () => {
      const prompt = buildDocumentGenerationUserPrompt({ ...initial, refine });

      expect(prompt).not.toContain(DESIGN_SYSTEM_CHANGED);
    });

    it('should leave out the commentary section when the base has none', () => {
      const prompt = buildDocumentGenerationUserPrompt({
        ...initial,
        refine: { ...refine, commentary: undefined },
      });

      expect(prompt).not.toContain('CURRENT COMMENTARY');
    });
  });
});
