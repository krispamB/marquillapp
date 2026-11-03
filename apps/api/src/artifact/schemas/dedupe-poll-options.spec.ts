import { dedupePollOptions } from './dedupe-poll-options';

const pollDraft = (options: unknown[]) => ({
  title: 'A title',
  commentary: 'Weigh in.',
  poll: { question: 'Which one?', options, durationDays: 7 },
});

describe('dedupePollOptions', () => {
  it('should drop an option that repeats an earlier one in different case, keeping the first', () => {
    expect(
      dedupePollOptions(pollDraft(['NestJS', 'Express', 'nestjs'])),
    ).toEqual({
      value: pollDraft(['NestJS', 'Express']),
      removed: 1,
    });
  });

  it('should drop an option that differs only in surrounding whitespace', () => {
    expect(
      dedupePollOptions(pollDraft(['Express', ' NestJS', 'NestJS ', 'Hapi'])),
    ).toEqual({
      value: pollDraft(['Express', ' NestJS', 'Hapi']),
      removed: 1,
    });
  });

  it('should count every repeat it drops', () => {
    expect(dedupePollOptions(pollDraft(['A', 'B', 'a', 'b']))).toEqual({
      value: pollDraft(['A', 'B']),
      removed: 2,
    });
  });

  it('should not mutate the value it is given', () => {
    const draft = pollDraft(['A', 'B', 'a']);

    dedupePollOptions(draft);

    expect(draft.poll.options).toEqual(['A', 'B', 'a']);
  });

  it('should leave the value unchanged when fewer than two options would remain', () => {
    const draft = pollDraft(['Same', 'same', ' SAME ']);

    expect(dedupePollOptions(draft)).toEqual({ value: draft, removed: 0 });
  });

  it('should leave a poll with distinct options unchanged', () => {
    const draft = pollDraft(['A', 'B', 'C']);

    expect(dedupePollOptions(draft)).toEqual({ value: draft, removed: 0 });
  });

  it('should leave options that are not all strings to the schema', () => {
    const draft = pollDraft(['A', 'a', 3]);

    expect(dedupePollOptions(draft)).toEqual({ value: draft, removed: 0 });
  });

  it.each([
    ['a POST draft', { title: 'T', commentary: 'Text only.' }],
    ['a DOCUMENT draft', { commentary: 'Hi', html: '<p>a</p><p>a</p>' }],
    ['a poll with no options array', { poll: { question: 'Q?' } }],
    ['an array', ['A', 'a']],
    ['a string', 'not an object'],
    ['null', null],
  ])('should leave %s untouched', (_label, value) => {
    expect(dedupePollOptions(value)).toEqual({ value, removed: 0 });
  });
});
