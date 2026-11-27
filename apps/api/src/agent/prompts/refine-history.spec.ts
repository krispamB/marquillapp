import { formatEarlierRequests } from './refine-history';

/** A request of exactly `length` characters that names itself. */
const request = (name: string, length: number) =>
  `${name} `.padEnd(length, 'x');

const shortened = (text: string) => `${text.slice(0, 160)}…`;

describe('formatEarlierRequests', () => {
  it('should return nothing when there are no earlier requests', () => {
    expect(formatEarlierRequests([])).toBeUndefined();
  });

  it('should number the requests oldest first when they fit', () => {
    expect(formatEarlierRequests(['Shorter', 'Add a list'])).toBe(
      'EARLIER REVISION REQUESTS:\n1. Shorter\n2. Add a list',
    );
  });

  it('should keep only the newest 8 verbatim when there are more', () => {
    const requests = Array.from({ length: 10 }, (_, i) =>
      request(`r${i + 1}`, 200),
    );

    expect(formatEarlierRequests(requests)).toBe(
      [
        'EARLIER REVISION REQUESTS:',
        ...requests.map(
          (text, i) => `${i + 1}. ${i < 2 ? shortened(text) : text}`,
        ),
      ].join('\n'),
    );
  });

  it('should leave an older request whole when it is no longer than 160 characters', () => {
    const requests = Array.from({ length: 9 }, (_, i) =>
      request(`r${i + 1}`, 160),
    );

    const section = formatEarlierRequests(requests);

    expect(section).toContain(`\n1. ${requests[0]}\n2. `);
    expect(section).not.toContain('…');
  });

  it('should keep every request verbatim when they total exactly 4000 characters', () => {
    const requests = [request('old', 2000), request('new', 2000)];

    expect(formatEarlierRequests(requests)).toBe(
      `EARLIER REVISION REQUESTS:\n1. ${requests[0]}\n2. ${requests[1]}`,
    );
  });

  it('should shorten the older request when keeping it would pass 4000 characters', () => {
    const requests = [request('old', 2001), request('new', 2000)];

    expect(formatEarlierRequests(requests)).toBe(
      `EARLIER REVISION REQUESTS:\n1. ${shortened(requests[0])}\n2. ${requests[1]}`,
    );
  });

  it('should shorten the newest request when it alone passes 4000 characters', () => {
    const requests = ['Shorter', request('new', 4001)];

    expect(formatEarlierRequests(requests)).toBe(
      `EARLIER REVISION REQUESTS:\n1. Shorter\n2. ${shortened(requests[1])}`,
    );
  });

  it('should drop the oldest requests and count them when shortening is not enough', () => {
    // 30 requests: 8 newest at 480 (3840) leave room for no 161-character one.
    const requests = Array.from({ length: 30 }, (_, i) =>
      request(`r${i + 1}`, 480),
    );

    expect(formatEarlierRequests(requests)).toBe(
      [
        'EARLIER REVISION REQUESTS:',
        '(22 earlier requests omitted)',
        ...requests.slice(22).map((text, i) => `${i + 23}. ${text}`),
      ].join('\n'),
    );
  });

  it('should use the singular when one request is omitted', () => {
    // 8 × 479 = 3832, then one shortened (161) fits and the next does not.
    const requests = Array.from({ length: 10 }, (_, i) =>
      request(`r${i + 1}`, 479),
    );

    expect(formatEarlierRequests(requests)?.split('\n').slice(0, 3)).toEqual([
      'EARLIER REVISION REQUESTS:',
      '(1 earlier request omitted)',
      `2. ${shortened(requests[1])}`,
    ]);
  });

  it('should not split a surrogate pair when it shortens a request', () => {
    const emoji = `${'x'.repeat(159)}😀${'y'.repeat(4000)}`;

    expect(formatEarlierRequests([emoji])).toBe(
      `EARLIER REVISION REQUESTS:\n1. ${'x'.repeat(159)}…`,
    );
  });
});
