import { LLMError, toLLMError } from './llm.error';

/** Stand-in for the SDK's `OpenRouterError`, which carries `statusCode`. */
const makeHttpError = (statusCode: number, message = 'boom') =>
  Object.assign(new Error(message), { statusCode });

/** Stand-in for the SDK's `HTTPClientError` subclasses, identified by `name`. */
const makeTransportError = (name: string) =>
  Object.assign(new Error(name), { name });

describe('LLMError', () => {
  describe('constructor', () => {
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
