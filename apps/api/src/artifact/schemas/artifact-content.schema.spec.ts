jest.mock(
  'src/database/schemas',
  () => ({
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
  }),
  { virtual: true },
);

import { z, ZodError } from 'zod';
import { ArtifactType } from 'src/database/schemas';
import {
  documentDraftSchemaFor,
  documentPatchRepairSchema,
  documentRepairSchema,
  generationSchemaFor,
  parseArtifactContent,
  postContentSchema,
} from './artifact-content.schema';

describe('generationSchemaFor', () => {
  const pollJsonSchema = () =>
    z.toJSONSchema(generationSchemaFor(ArtifactType.POLL, true), {
      target: 'draft-7',
      io: 'output',
    });

  it('should constrain durationDays to the LinkedIn durations in the JSON schema', () => {
    expect(pollJsonSchema()).toMatchObject({
      properties: {
        poll: {
          properties: {
            durationDays: { type: 'number', enum: [1, 3, 7, 14] },
          },
        },
      },
    });
  });

  it('should constrain the poll question and options to non-blank, LinkedIn-length strings in the JSON schema', () => {
    expect(pollJsonSchema()).toMatchObject({
      properties: {
        poll: {
          properties: {
            question: { type: 'string', pattern: '\\S', maxLength: 140 },
            options: {
              items: { type: 'string', pattern: '\\S', maxLength: 30 },
              minItems: 2,
              maxItems: 4,
            },
          },
        },
      },
    });
  });

  it('should cap the commentary in the JSON schema', () => {
    expect(pollJsonSchema()).toMatchObject({
      properties: { commentary: { maxLength: 3000 } },
    });
    expect(
      z.toJSONSchema(generationSchemaFor(ArtifactType.POST, false), {
        target: 'draft-7',
        io: 'output',
      }),
    ).toMatchObject({
      properties: { commentary: { minLength: 1, maxLength: 3000 } },
    });
  });

  it('should refuse a DOCUMENT, whose contract is the draft envelope', () => {
    expect(() => generationSchemaFor(ArtifactType.DOCUMENT, true)).toThrow(
      'No generation schema implemented',
    );
  });
});

describe('documentDraftSchemaFor', () => {
  it('should expose one provider-compatible object with commentary and html', () => {
    const jsonSchema = z.toJSONSchema(documentDraftSchemaFor(true), {
      target: 'draft-7',
      io: 'output',
    });

    expect(jsonSchema).not.toHaveProperty('allOf');
    expect(jsonSchema).toHaveProperty('properties.commentary');
    expect(jsonSchema).toHaveProperty('properties.html');
    expect(jsonSchema).toHaveProperty('properties.title');
  });

  it('should leave the title out when none is asked for', () => {
    const jsonSchema = z.toJSONSchema(documentDraftSchemaFor(false), {
      target: 'draft-7',
      io: 'output',
    });

    expect(JSON.stringify(jsonSchema)).not.toContain('"title"');
  });

  it('should reject an empty html', () => {
    expect(() =>
      documentDraftSchemaFor(false).parse({ commentary: 'Hi', html: '' }),
    ).toThrow(ZodError);
  });
});

describe('documentRepairSchema', () => {
  it('should expose only html to the provider', () => {
    const jsonSchema = z.toJSONSchema(documentRepairSchema, {
      target: 'draft-7',
      io: 'output',
    });

    expect(jsonSchema).toMatchObject({
      properties: { html: { type: 'string', minLength: 1 } },
      required: ['html'],
    });
    expect(Object.keys(jsonSchema.properties ?? {})).toEqual(['html']);
  });

  it('should reject an empty html', () => {
    expect(() => documentRepairSchema.parse({ html: '' })).toThrow(ZodError);
  });
});

describe('documentPatchRepairSchema', () => {
  const HTML = '<!doctype html><html><body></body></html>';
  const edit = { find: '13px', replace: '14px' };

  it('should accept edits alone', () => {
    expect(documentPatchRepairSchema.parse({ edits: [edit] })).toEqual({
      edits: [edit],
    });
  });

  it('should accept html alone', () => {
    expect(documentPatchRepairSchema.parse({ html: HTML })).toEqual({
      html: HTML,
    });
  });

  it('should reject an answer with both edits and html', () => {
    expect(() =>
      documentPatchRepairSchema.parse({ edits: [edit], html: HTML }),
    ).toThrow(ZodError);
  });

  it('should reject an answer with neither edits nor html', () => {
    expect(() => documentPatchRepairSchema.parse({})).toThrow(ZodError);
  });

  it('should reject an empty edits list', () => {
    expect(() => documentPatchRepairSchema.parse({ edits: [] })).toThrow(
      ZodError,
    );
  });

  it('should accept 40 edits and reject 41', () => {
    const edits = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ find: `f${i}`, replace: '' }));

    expect(() =>
      documentPatchRepairSchema.parse({ edits: edits(40) }),
    ).not.toThrow();
    expect(() => documentPatchRepairSchema.parse({ edits: edits(41) })).toThrow(
      ZodError,
    );
  });

  it('should reject an edit with an empty find, and accept an empty replace', () => {
    expect(() =>
      documentPatchRepairSchema.parse({ edits: [{ find: '', replace: 'x' }] }),
    ).toThrow(ZodError);
    expect(() =>
      documentPatchRepairSchema.parse({ edits: [{ find: 'x', replace: '' }] }),
    ).not.toThrow();
  });

  it('should reject an empty html', () => {
    expect(() => documentPatchRepairSchema.parse({ html: '' })).toThrow(
      ZodError,
    );
  });

  it('should expose edits and html to the provider as two optional fields', () => {
    const jsonSchema = z.toJSONSchema(documentPatchRepairSchema, {
      target: 'draft-7',
      io: 'output',
    });

    expect(Object.keys(jsonSchema.properties ?? {})).toEqual(['edits', 'html']);
    expect(jsonSchema.required ?? []).toEqual([]);
    expect(jsonSchema.properties?.edits).toMatchObject({
      type: 'array',
      minItems: 1,
      maxItems: 40,
      items: {
        properties: {
          find: { type: 'string', minLength: 1 },
          replace: { type: 'string' },
        },
        required: ['find', 'replace'],
      },
    });
  });
});

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

    it('should report an over-long commentary once, not once per check', () => {
      const result = postContentSchema.safeParse({
        commentary: 'a'.repeat(3001),
      });

      expect(result.error?.issues).toHaveLength(1);
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
    // A complete stored Document Version (spec §6.3).
    const documentVersion = () => ({
      designSystemId: 'margin',
      designSystemVersion: 2,
      sourceKey: 'artifacts/abc/1/source.html',
      sourceSha256: 'a'.repeat(64),
      candidateKey: 'artifacts/abc/1/candidate.html',
      candidateSha256: 'b'.repeat(64),
      pdfKey: 'artifacts/abc/1/document.pdf',
      pageCount: 4,
    });

    it('should accept a complete Document Version', () => {
      const content = { document: documentVersion() };
      expect(parseArtifactContent(ArtifactType.DOCUMENT, content)).toEqual(
        content,
      );
    });

    it('should accept commentary and an optional coverKey', () => {
      const content = {
        commentary: 'A thread 🧵',
        document: {
          ...documentVersion(),
          coverKey: 'artifacts/abc/1/cover.png',
        },
      };
      expect(parseArtifactContent(ArtifactType.DOCUMENT, content)).toEqual(
        content,
      );
    });

    it.each(['sourceKey', 'candidateKey', 'pdfKey'] as const)(
      'should reject a version without %s, the READY gate',
      (key) => {
        const document: Record<string, unknown> = documentVersion();
        delete document[key];
        expect(() =>
          parseArtifactContent(ArtifactType.DOCUMENT, { document }),
        ).toThrow(ZodError);
      },
    );

    it('should reject a template-era version carrying templateId and slides', () => {
      const content = {
        document: {
          templateId: 'minimal',
          slides: [{ type: 'cover', fields: { title: 'A carousel' } }],
        },
      };
      expect(() =>
        parseArtifactContent(ArtifactType.DOCUMENT, content),
      ).toThrow(ZodError);
    });

    it('should reject a Document Version that also carries slides', () => {
      const content = {
        document: { ...documentVersion(), slides: [] },
      };
      expect(() =>
        parseArtifactContent(ArtifactType.DOCUMENT, content),
      ).toThrow(ZodError);
    });

    it('should reject a hash that is not a lowercase hex SHA-256', () => {
      const content = {
        document: { ...documentVersion(), sourceSha256: 'not-a-hash' },
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
