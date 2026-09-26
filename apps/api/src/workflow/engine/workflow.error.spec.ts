import { LLMError } from '../../llm/errors';
import {
  WorkflowError,
  terminal,
  toWorkflowError,
  transient,
} from './workflow.error';

describe('WorkflowError', () => {
  describe('constructor', () => {
    it('should expose the reason as both reason and message', () => {
      const error = new WorkflowError('artifact not found', {
        retryable: false,
      });

      expect(error.reason).toBe('artifact not found');
      expect(error.message).toBe('artifact not found');
      expect(error.name).toBe('WorkflowError');
    });

    it('should preserve the underlying cause', () => {
      const cause = new Error('ECONNRESET');

      expect(
        new WorkflowError('db write failed', { retryable: true, cause }).cause,
      ).toBe(cause);
    });
  });

  describe('terminal', () => {
    it('should build a non-retryable error', () => {
      expect(terminal('zod failed after repair').retryable).toBe(false);
    });
  });

  describe('transient', () => {
    it('should build a retryable error', () => {
      expect(transient('browserless timeout').retryable).toBe(true);
    });
  });
});

describe('toWorkflowError', () => {
  it('should pass a WorkflowError through untouched', () => {
    const original = terminal('insufficient credits');

    expect(toWorkflowError(original)).toBe(original);
  });

  it('should preserve a terminal classification rather than widen it', () => {
    expect(toWorkflowError(terminal('unknown templateId')).retryable).toBe(
      false,
    );
  });

  it('should inherit retryable from a retryable LLMError', () => {
    // The LLM layer is the only layer that knows what a 429 means.
    const llmError = new LLMError('rate limited', {
      retryable: true,
      statusCode: 429,
    });

    const converted = toWorkflowError(llmError);

    expect(converted).toBeInstanceOf(WorkflowError);
    expect(converted.retryable).toBe(true);
    expect(converted.reason).toBe('rate limited');
    expect(converted.cause).toBe(llmError);
  });

  it('should inherit retryable from a terminal LLMError', () => {
    const llmError = new LLMError('invalid api key', {
      retryable: false,
      statusCode: 401,
    });

    expect(toWorkflowError(llmError).retryable).toBe(false);
  });

  it('should default an unclassified error to retryable', () => {
    // Terminal is a deliberate opt-in, never inferred from silence. A retried
    // attempt debits no credits, so guessing wrong here costs only latency.
    const converted = toWorkflowError(new Error('mongo write concern failed'));

    expect(converted.retryable).toBe(true);
    expect(converted.reason).toBe('mongo write concern failed');
  });

  it('should fall back to a generic reason when the error has no message', () => {
    expect(toWorkflowError(new Error('')).reason).toBe('Workflow step failed');
  });

  it('should handle a non-Error throw', () => {
    const converted = toWorkflowError('something odd');

    expect(converted).toBeInstanceOf(WorkflowError);
    expect(converted.reason).toBe('Workflow step failed');
    expect(converted.retryable).toBe(true);
    expect(converted.cause).toBe('something odd');
  });
});
