import { LLMError, fromStreamError, toLLMError } from './llm.error';

/** Stand-in for the SDK's `OpenRouterError`, which carries `statusCode`. */
const makeHttpError = (statusCode: number, message = 'boom') =>
  Object.assign(new Error(message), { statusCode });

/** Stand-in for the SDK's `HTTPClientError` subclasses, identified by `name`. */
const makeTransportError = (name: string) =>
  Object.assign(new Error(name), { name });

/** An `OpenRouterError` carrying the response headers, as the SDK sets them. */
const makeHttpErrorWithHeaders = (
  statusCode: number,
  headers: Record<string, string>,
) =>
  Object.assign(new Error('boom'), {
    statusCode,
    headers: new Headers(headers),
  });

/**
 * The SDK's `ResponseValidationError` for a 200 whose body is not a
 * completion: `body` is the raw text, `rawValue` the parsed JSON.
 */
const makeValidationError = (body: string) => {
  let rawValue: unknown;
  try {
    rawValue = JSON.parse(body);
  } catch {
    rawValue = undefined;
  }
  return Object.assign(new Error('Response validation failed'), {
    name: 'ResponseValidationError',
    statusCode: 200,
    body,
    rawValue,
  });
};

describe('LLMError', () => {
  describe('constructor', () => {
    it('should leave retryAfterMs unset when none is given', () => {
      expect(
        new LLMError('failed', { retryable: true }).retryAfterMs,
      ).toBeUndefined();
    });

    it('should retain the retryable flag, status code and cause', () => {
      const cause = new Error('underlying');
      const error = new LLMError('failed', {
        retryable: true,
        statusCode: 429,
        cause,
      });

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('LLMError');
      expect(error.message).toBe('failed');
      expect(error.retryable).toBe(true);
      expect(error.statusCode).toBe(429);
      expect(error.cause).toBe(cause);
    });
  });
});

describe('toLLMError', () => {
  it('should return the same instance when given an LLMError', () => {
    const original = new LLMError('already typed', { retryable: false });

    expect(toLLMError(original)).toBe(original);
  });

  describe('retryable classification', () => {
    it('should mark a 429 rate limit as retryable', () => {
      const error = toLLMError(makeHttpError(429, 'Rate limit exceeded'));

      expect(error.retryable).toBe(true);
      expect(error.statusCode).toBe(429);
      expect(error.message).toBe('Rate limit exceeded');
    });

    it('should mark a 401 auth failure as terminal', () => {
      const error = toLLMError(makeHttpError(401, 'Unauthorized'));

      expect(error.retryable).toBe(false);
      expect(error.statusCode).toBe(401);
    });

    it.each([500, 502, 503, 504])(
      'should mark a %i server error as retryable',
      (statusCode) => {
        expect(toLLMError(makeHttpError(statusCode)).retryable).toBe(true);
      },
    );

    it('should mark a 408 request timeout as retryable', () => {
      expect(toLLMError(makeHttpError(408)).retryable).toBe(true);
    });

    it.each([400, 402, 403, 404, 422])(
      'should mark a %i client error as terminal',
      (statusCode) => {
        expect(toLLMError(makeHttpError(statusCode)).retryable).toBe(false);
      },
    );

    it.each(['ConnectionError', 'RequestTimeoutError'])(
      'should mark transport failure %s as retryable',
      (name) => {
        const error = toLLMError(makeTransportError(name));

        expect(error.retryable).toBe(true);
        expect(error.statusCode).toBeUndefined();
      },
    );

    it('should mark an aborted request as terminal, since the caller cancelled it', () => {
      expect(
        toLLMError(makeTransportError('RequestAbortedError')).retryable,
      ).toBe(false);
    });

    it('should mark a raw TimeoutError as retryable when a timeout fires while the body is read', () => {
      const error = toLLMError(
        new DOMException('The operation timed out.', 'TimeoutError'),
      );

      expect(error.retryable).toBe(true);
      expect(error.statusCode).toBeUndefined();
    });

    it('should mark a raw AbortError as terminal when the caller aborts while the body is read', () => {
      expect(
        toLLMError(new DOMException('This operation was aborted', 'AbortError'))
          .retryable,
      ).toBe(false);
    });
  });

  describe('a provider error after 200 OK', () => {
    it.each([429, 502, 503])(
      'should mark it retryable when the body carries error code %i',
      (code) => {
        const error = toLLMError(
          makeValidationError(
            JSON.stringify({ error: { code, message: 'Provider fell over' } }),
          ),
        );

        expect(error.retryable).toBe(true);
        expect(error.statusCode).toBe(code);
        expect(error.message).toBe('Provider fell over');
      },
    );

    it('should mark it terminal when the body carries a client error code', () => {
      const error = toLLMError(
        makeValidationError(
          JSON.stringify({ error: { code: 400, message: 'Context too long' } }),
        ),
      );

      expect(error.retryable).toBe(false);
      expect(error.statusCode).toBe(400);
    });

    it('should read a numeric string code when the body sends one', () => {
      const error = toLLMError(
        makeValidationError(JSON.stringify({ error: { code: '403' } })),
      );

      expect(error).toMatchObject({ retryable: false, statusCode: 403 });
    });

    it('should mark it retryable when the body has no readable error code', () => {
      const error = toLLMError(
        makeValidationError(
          JSON.stringify({ error: { code: 'server_error' } }),
        ),
      );

      expect(error.retryable).toBe(true);
      expect(error.statusCode).toBe(200);
    });

    it('should mark it retryable when the body is not JSON', () => {
      expect(toLLMError(makeValidationError('<html>oops')).retryable).toBe(
        true,
      );
    });

    it('should read the code from the raw body when the parsed value is absent', () => {
      const error = toLLMError(
        Object.assign(makeValidationError(''), {
          body: JSON.stringify({ error: { code: 401 } }),
        }),
      );

      expect(error).toMatchObject({ retryable: false, statusCode: 401 });
    });
  });

  describe('Retry-After', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: new Date('2026-10-22T12:00:00Z') });
    });

    afterEach(() => jest.useRealTimers());

    it('should read Retry-After in seconds when a 429 sends one', () => {
      const error = toLLMError(
        makeHttpErrorWithHeaders(429, { 'retry-after': '7' }),
      );

      expect(error.retryAfterMs).toBe(7_000);
    });

    it('should read Retry-After as an HTTP date when a 503 sends one', () => {
      const error = toLLMError(
        makeHttpErrorWithHeaders(503, {
          'retry-after': 'Thu, 22 Oct 2026 12:00:03 GMT',
        }),
      );

      expect(error.retryAfterMs).toBe(3_000);
    });

    it('should leave retryAfterMs unset when the header is absent, malformed or in the past', () => {
      expect(toLLMError(makeHttpError(429)).retryAfterMs).toBeUndefined();
      expect(
        toLLMError(makeHttpErrorWithHeaders(429, { 'retry-after': 'soon' }))
          .retryAfterMs,
      ).toBeUndefined();
      expect(
        toLLMError(
          makeHttpErrorWithHeaders(429, {
            'retry-after': 'Thu, 22 Oct 2026 11:59:00 GMT',
          }),
        ).retryAfterMs,
      ).toBeUndefined();
    });

    it('should mark an unrecognised error as terminal', () => {
      const error = toLLMError(new Error('who knows'));

      expect(error.retryable).toBe(false);
      expect(error.message).toBe('who knows');
    });
  });

  describe('degenerate inputs', () => {
    it('should fall back to a default message when the status error has none', () => {
      const error = toLLMError({ statusCode: 503 });

      expect(error.message).toBe('Provider request failed with status 503');
      expect(error.retryable).toBe(true);
    });

    it('should not throw when given a non-error value', () => {
      const error = toLLMError('a bare string');

      expect(error).toBeInstanceOf(LLMError);
      expect(error.retryable).toBe(false);
      expect(error.cause).toBe('a bare string');
    });
  });
});

describe('fromStreamError', () => {
  it.each([429, 502, 503])(
    'should mark it retryable when the chunk carries code %i',
    (code) => {
      const error = fromStreamError({ code, message: 'Upstream died' });
      expect(error).toMatchObject({
        retryable: true,
        statusCode: code,
        message: 'Upstream died',
      });
    },
  );

  it('should mark it terminal when the chunk carries a client error code', () => {
    expect(fromStreamError({ code: 400, message: 'bad' }).retryable).toBe(
      false,
    );
  });

  it('should mark it retryable when the code is not an error status', () => {
    expect(fromStreamError({ code: 0, message: '' })).toMatchObject({
      retryable: true,
      message: 'Provider failed mid-stream',
    });
  });
});
