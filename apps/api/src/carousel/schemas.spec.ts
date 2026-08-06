import { slideFieldSchemas, slideSchema, slidesSchema } from './schemas';

describe('carousel schemas', () => {
  describe('slideFieldSchemas.cover', () => {
    it('should accept a title-only cover with the optional fields absent', () => {
      expect(slideFieldSchemas.cover.safeParse({ title: 'Hook' }).success).toBe(
        true,
      );
    });

    it('should reject a cover with no title', () => {
      expect(slideFieldSchemas.cover.safeParse({}).success).toBe(false);
    });

    it('should reject a title over the 70-character cap', () => {
      expect(
        slideFieldSchemas.cover.safeParse({ title: 'a'.repeat(71) }).success,
      ).toBe(false);
    });

    it('should accept a title at exactly the 70-character cap', () => {
      expect(
        slideFieldSchemas.cover.safeParse({ title: 'a'.repeat(70) }).success,
      ).toBe(true);
    });

    it('should reject a whitespace-only title (trim then min 1)', () => {
      expect(slideFieldSchemas.cover.safeParse({ title: '   ' }).success).toBe(
        false,
      );
    });
  });

  describe('slideFieldSchemas.content', () => {
    it('should reject a body over the 280-character cap', () => {
      expect(
        slideFieldSchemas.content.safeParse({
          heading: 'Heading',
          body: 'a'.repeat(281),
        }).success,
      ).toBe(false);
    });
  });

  describe('slideFieldSchemas.list', () => {
    it('should reject fewer than 2 items', () => {
      expect(
        slideFieldSchemas.list.safeParse({ heading: 'H', items: ['one'] })
          .success,
      ).toBe(false);
    });

    it('should reject more than 6 items', () => {
      expect(
        slideFieldSchemas.list.safeParse({
          heading: 'H',
          items: ['1', '2', '3', '4', '5', '6', '7'],
        }).success,
      ).toBe(false);
    });

    it('should reject an item over the 80-character cap', () => {
      expect(
        slideFieldSchemas.list.safeParse({
          heading: 'H',
          items: ['ok', 'a'.repeat(81)],
        }).success,
      ).toBe(false);
    });

    it('should accept 2-6 items each within the cap', () => {
      expect(
        slideFieldSchemas.list.safeParse({
          heading: 'H',
          items: ['one', 'two', 'three'],
        }).success,
      ).toBe(true);
    });
  });

  describe('slideFieldSchemas.quote', () => {
    it('should reject a quote over the 200-character cap', () => {
      expect(
        slideFieldSchemas.quote.safeParse({ quote: 'a'.repeat(201) }).success,
      ).toBe(false);
    });

    it('should accept a quote with no attribution', () => {
      expect(
        slideFieldSchemas.quote.safeParse({ quote: 'Words' }).success,
      ).toBe(true);
    });
  });

  describe('slideFieldSchemas.cta', () => {
    it('should require headline and action', () => {
      expect(
        slideFieldSchemas.cta.safeParse({ headline: 'Follow' }).success,
      ).toBe(false);
    });
  });

  describe('slideSchema', () => {
    it('should narrow fields to the arm named by type', () => {
      const parsed = slideSchema.parse({
        type: 'quote',
        fields: { quote: 'A pull quote' },
      });
      expect(parsed.type).toBe('quote');
    });

    it('should reject an unknown slide type', () => {
      expect(slideSchema.safeParse({ type: 'image', fields: {} }).success).toBe(
        false,
      );
    });

    it("should reject a cover carrying another arm's fields", () => {
      expect(
        slideSchema.safeParse({ type: 'cover', fields: { quote: 'x' } })
          .success,
      ).toBe(false);
    });
  });

  describe('slidesSchema', () => {
    const slide = { type: 'content', fields: { heading: 'H', body: 'B' } };

    it('should reject a single-slide deck', () => {
      expect(slidesSchema.safeParse([slide]).success).toBe(false);
    });

    it('should reject a deck over 15 slides', () => {
      expect(
        slidesSchema.safeParse(Array.from({ length: 16 }, () => slide)).success,
      ).toBe(false);
    });

    it('should accept a deck of 2-15 slides', () => {
      expect(
        slidesSchema.safeParse(Array.from({ length: 15 }, () => slide)).success,
      ).toBe(true);
    });
  });
});
