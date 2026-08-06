jest.mock(
  'src/database/schemas',
  () => ({
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
    CarouselTheme: {
      BOLD: 'bold',
      MINIMAL: 'minimal',
      EDITORIAL: 'editorial',
      GRADIENT: 'gradient',
    },
  }),
  { virtual: true },
);

import { ZodError } from 'zod';
import { ArtifactType } from 'src/database/schemas';
import { parseArtifactContent } from './artifact-content.schema';

describe('parseArtifactContent', () => {
  describe('POST arm', () => {
    it('should accept the commentary when it is exactly 3000 characters', () => {
      const commentary = 'a'.repeat(3000);
      expect(parseArtifactContent(ArtifactType.POST, { commentary })).toEqual({
        commentary,
      });
    });

    it('should accept the commentary when an emoji lands exactly on the 3000 boundary', () => {
      // 🎉 costs 2 LinkedIn characters, so 2998 + 🎉 = exactly 3000
      const commentary = 'a'.repeat(2998) + '🎉';
      expect(parseArtifactContent(ArtifactType.POST, { commentary })).toEqual({
        commentary,
      });
    });

    it('should reject the commentary when it reaches 3001 characters', () => {
      const commentary = 'a'.repeat(3001);
      expect(() =>
        parseArtifactContent(ArtifactType.POST, { commentary }),
      ).toThrow(ZodError);
    });

    it('should reject when an emoji pushes the count to 3001', () => {
      // 2999 BMP chars + a 2-unit emoji = 3001 LinkedIn characters
      const commentary = 'a'.repeat(2999) + '🎉';
      expect(() =>
        parseArtifactContent(ArtifactType.POST, { commentary }),
      ).toThrow(ZodError);
    });

    it('should count by UTF-16 code units, not code points, when the commentary is emoji-only', () => {
      // 1500 astral emoji = 1500 code points but 3000 LinkedIn characters
      expect(() =>
        parseArtifactContent(ArtifactType.POST, {
          commentary: '🎉'.repeat(1500),
        }),
      ).not.toThrow();
      // one more emoji tips it to 3002
      expect(() =>
        parseArtifactContent(ArtifactType.POST, {
          commentary: '🎉'.repeat(1501),
        }),
      ).toThrow(ZodError);
    });

    it('should reject the commentary when it is empty', () => {
      expect(() =>
        parseArtifactContent(ArtifactType.POST, { commentary: '' }),
      ).toThrow(ZodError);
    });

    it('should reject the content when commentary is missing or not a string', () => {
      expect(() => parseArtifactContent(ArtifactType.POST, {})).toThrow(
        ZodError,
      );
      expect(() =>
        parseArtifactContent(ArtifactType.POST, { commentary: 42 }),
      ).toThrow(ZodError);
    });
  });

  describe('POLL arm', () => {
    const validPoll = () => ({
      poll: {
        question: 'What is your favorite framework?',
        options: ['NestJS', 'Express'],
        durationDays: 7,
      },
    });

    it('should accept a poll with the minimum two options and no commentary', () => {
      const content = validPoll();
      expect(parseArtifactContent(ArtifactType.POLL, content)).toEqual(content);
    });

    it('should accept a poll with four options', () => {
      const content = {
        poll: {
          question: 'Best framework?',
          options: ['NestJS', 'Express', 'Fastify', 'Hapi'],
          durationDays: 1,
        },
      };
      expect(parseArtifactContent(ArtifactType.POLL, content)).toEqual(content);
    });

    it('should accept an optional commentary alongside the poll', () => {
      const content = {
        commentary: 'Weighing in on the framework debate.',
        poll: {
          question: 'Which do you reach for?',
          options: ['NestJS', 'Express'],
          durationDays: 3,
        },
      };
      expect(parseArtifactContent(ArtifactType.POLL, content)).toEqual(content);
    });

    it.each([1, 3, 7, 14])(
      'should accept a durationDays of %i',
      (durationDays) => {
        const content = {
          poll: { question: 'Q?', options: ['A', 'B'], durationDays },
        };
        expect(parseArtifactContent(ArtifactType.POLL, content)).toEqual(
          content,
        );
      },
    );

    it('should reject the commentary when it exceeds 3000 LinkedIn characters', () => {
      expect(() =>
        parseArtifactContent(ArtifactType.POLL, {
          commentary: 'a'.repeat(3001),
          poll: { question: 'Q?', options: ['A', 'B'], durationDays: 7 },
        }),
      ).toThrow(ZodError);
    });

    describe('question validation', () => {
      it('should reject a question of 141 characters', () => {
        expect(() =>
          parseArtifactContent(ArtifactType.POLL, {
            poll: {
              question: 'A'.repeat(141),
              options: ['Yes', 'No'],
              durationDays: 7,
            },
          }),
        ).toThrow(ZodError);
      });

      it('should accept a question of exactly 140 characters', () => {
        const content = {
          poll: {
            question: 'A'.repeat(140),
            options: ['Yes', 'No'],
            durationDays: 7,
          },
        };
        expect(parseArtifactContent(ArtifactType.POLL, content)).toEqual(
          content,
        );
      });

      it('should reject an empty question', () => {
        expect(() =>
          parseArtifactContent(ArtifactType.POLL, {
            poll: { question: '', options: ['Yes', 'No'], durationDays: 7 },
          }),
        ).toThrow(ZodError);
      });

      it('should reject a whitespace-only question', () => {
        expect(() =>
          parseArtifactContent(ArtifactType.POLL, {
            poll: { question: '   ', options: ['Yes', 'No'], durationDays: 7 },
          }),
        ).toThrow(ZodError);
      });
    });

    describe('options count validation', () => {
      it('should reject fewer than two options', () => {
        expect(() =>
          parseArtifactContent(ArtifactType.POLL, {
            poll: { question: 'Q?', options: ['Only one'], durationDays: 7 },
          }),
        ).toThrow(ZodError);
      });

      it('should reject more than four options', () => {
        expect(() =>
          parseArtifactContent(ArtifactType.POLL, {
            poll: {
              question: 'Q?',
              options: ['A', 'B', 'C', 'D', 'E'],
              durationDays: 7,
            },
          }),
        ).toThrow(ZodError);
      });
    });

    describe('individual option validation', () => {
      it('should reject an empty option', () => {
        expect(() =>
          parseArtifactContent(ArtifactType.POLL, {
            poll: { question: 'Q?', options: ['Valid', ''], durationDays: 7 },
          }),
        ).toThrow(ZodError);
      });

      it('should reject a whitespace-only option', () => {
        expect(() =>
          parseArtifactContent(ArtifactType.POLL, {
            poll: {
              question: 'Q?',
              options: ['Valid', '   '],
              durationDays: 7,
            },
          }),
        ).toThrow(ZodError);
      });

      it('should reject an option of 31 characters', () => {
        expect(() =>
          parseArtifactContent(ArtifactType.POLL, {
            poll: {
              question: 'Q?',
              options: ['Valid', 'A'.repeat(31)],
              durationDays: 7,
            },
          }),
        ).toThrow(ZodError);
      });

      it('should accept an option of exactly 30 characters', () => {
        const content = {
          poll: {
            question: 'Q?',
            options: ['Valid', 'A'.repeat(30)],
            durationDays: 7,
          },
        };
        expect(parseArtifactContent(ArtifactType.POLL, content)).toEqual(
          content,
        );
      });
    });

    describe('uniqueness validation', () => {
      it('should reject two identical options', () => {
        expect(() =>
          parseArtifactContent(ArtifactType.POLL, {
            poll: {
              question: 'Q?',
              options: ['Same', 'Same'],
              durationDays: 7,
            },
          }),
        ).toThrow(ZodError);
      });

      it('should treat differently-cased options as duplicates', () => {
        expect(() =>
          parseArtifactContent(ArtifactType.POLL, {
            poll: {
              question: 'Q?',
              options: ['nestjs', 'NestJS'],
              durationDays: 7,
            },
          }),
        ).toThrow(ZodError);
      });

      it('should treat options differing only in surrounding whitespace as duplicates', () => {
        expect(() =>
          parseArtifactContent(ArtifactType.POLL, {
            poll: {
              question: 'Q?',
              options: ['NestJS', ' NestJS '],
              durationDays: 7,
            },
          }),
        ).toThrow(ZodError);
      });
    });

    describe('durationDays validation', () => {
      it('should reject a durationDays of 2', () => {
        expect(() =>
          parseArtifactContent(ArtifactType.POLL, {
            poll: { question: 'Q?', options: ['A', 'B'], durationDays: 2 },
          }),
        ).toThrow(ZodError);
      });

      it('should reject a missing durationDays', () => {
        expect(() =>
          parseArtifactContent(ArtifactType.POLL, {
            poll: { question: 'Q?', options: ['A', 'B'] },
          }),
        ).toThrow(ZodError);
      });
    });

    it('should reject content with no poll object', () => {
      expect(() =>
        parseArtifactContent(ArtifactType.POLL, {
          commentary: 'just text',
        }),
      ).toThrow(ZodError);
    });
  });

  describe('DOCUMENT arm', () => {
    // The slides-only shape GENERATE emits: templateId + a valid deck, with no
    // pdfKey/pageCount yet (those are RENDER_PDF's derived output).
    const slidesOnlyDocument = () => ({
      document: {
        templateId: 'minimal',
        slides: [
          { type: 'cover', fields: { title: 'A carousel' } },
          { type: 'content', fields: { heading: 'One', body: 'A point' } },
        ],
      },
    });

    it('should accept the slides-only document GENERATE emits', () => {
      const content = slidesOnlyDocument();
      expect(parseArtifactContent(ArtifactType.DOCUMENT, content)).toEqual(
        content,
      );
    });

    it('should accept optional framing commentary alongside the deck', () => {
      const content = { commentary: 'A thread 🧵', ...slidesOnlyDocument() };
      expect(parseArtifactContent(ArtifactType.DOCUMENT, content)).toEqual(
        content,
      );
    });

    it('should accept the folded form carrying pdfKey and pageCount', () => {
      const base = slidesOnlyDocument();
      const folded = {
        document: {
          ...base.document,
          pdfKey: 'artifacts/abc/1/document.pdf',
          pageCount: 2,
        },
      };
      expect(parseArtifactContent(ArtifactType.DOCUMENT, folded)).toEqual(
        folded,
      );
    });

    it('should reject a templateId that is not a real CarouselTheme', () => {
      const content = slidesOnlyDocument();
      content.document.templateId = 'neon';
      expect(() =>
        parseArtifactContent(ArtifactType.DOCUMENT, content),
      ).toThrow(ZodError);
    });

    it('should reject a deck with fewer than two slides', () => {
      const content = slidesOnlyDocument();
      content.document.slides = [content.document.slides[0]];
      expect(() =>
        parseArtifactContent(ArtifactType.DOCUMENT, content),
      ).toThrow(ZodError);
    });

    it('should reject a slide whose type is not a known slide role', () => {
      const content = {
        document: {
          templateId: 'minimal',
          slides: [
            { type: 'cover', fields: { title: 'A carousel' } },
            { type: 'banner', fields: { heading: 'One', body: 'A point' } },
          ],
        },
      };
      expect(() =>
        parseArtifactContent(ArtifactType.DOCUMENT, content),
      ).toThrow(ZodError);
    });

    it('should reject content that has no document object', () => {
      expect(() =>
        parseArtifactContent(ArtifactType.DOCUMENT, {
          commentary: 'just text',
        }),
      ).toThrow(ZodError);
    });
  });
});
