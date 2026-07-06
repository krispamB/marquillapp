import { validateLinkedInPoll } from './poll.util';

describe('validateLinkedInPoll', () => {
  describe('question validation', () => {
    it('should return valid when question and options are correct', () => {
      const result = validateLinkedInPoll({
        question: 'What is your favorite framework?',
        options: ['NestJS', 'Express'],
      });
      expect(result).toEqual({ valid: true, errors: [] });
    });

    it('should error when question exceeds 140 characters', () => {
      const result = validateLinkedInPoll({
        question: 'A'.repeat(141),
        options: ['Yes', 'No'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/exceeds 140 characters/);
    });

    it('should error when question is empty', () => {
      const result = validateLinkedInPoll({
        question: '',
        options: ['Yes', 'No'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/required/);
    });

    it('should error when question is whitespace only', () => {
      const result = validateLinkedInPoll({
        question: '   ',
        options: ['Yes', 'No'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/required/);
    });
  });

  describe('options count validation', () => {
    it('should error when fewer than 2 options are provided', () => {
      const result = validateLinkedInPoll({
        question: 'A question?',
        options: ['Only one'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/at least 2/);
    });

    it('should error when more than 4 options are provided', () => {
      const result = validateLinkedInPoll({
        question: 'A question?',
        options: ['A', 'B', 'C', 'D', 'E'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/more than 4/);
    });

    it('should pass with exactly 2 options', () => {
      const result = validateLinkedInPoll({
        question: 'Yes or no?',
        options: ['Yes', 'No'],
      });
      expect(result.valid).toBe(true);
    });

    it('should pass with exactly 4 options', () => {
      const result = validateLinkedInPoll({
        question: 'Best framework?',
        options: ['NestJS', 'Express', 'Fastify', 'Hapi'],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('individual option validation', () => {
    it('should error when an option is empty', () => {
      const result = validateLinkedInPoll({
        question: 'A question?',
        options: ['Valid', ''],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('empty'))).toBe(true);
    });

    it('should error when an option is whitespace only', () => {
      const result = validateLinkedInPoll({
        question: 'A question?',
        options: ['Valid', '   '],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('empty'))).toBe(true);
    });

    it('should error when an option exceeds 30 characters', () => {
      const result = validateLinkedInPoll({
        question: 'A question?',
        options: ['Valid', 'A'.repeat(31)],
      });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes('exceeds 30 characters')),
      ).toBe(true);
    });
  });

  describe('uniqueness validation', () => {
    it('should error when duplicate options exist', () => {
      const result = validateLinkedInPoll({
        question: 'A question?',
        options: ['Same', 'Same'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('unique'))).toBe(true);
    });

    it('should treat differently-cased duplicates as the same', () => {
      const result = validateLinkedInPoll({
        question: 'A question?',
        options: ['nestjs', 'NestJS'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('unique'))).toBe(true);
    });
  });
});
