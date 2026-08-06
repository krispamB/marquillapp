import { RunCreditMeter } from './run-credit-meter';
import { RunEventType } from './run-event.types';

describe('RunCreditMeter', () => {
  const userId = '665f1b2c3d4e5f6a7b8c9d0e';

  const makeMeter = () => {
    const creditMeterService = {
      toCredits: jest.fn().mockReturnValue(0),
      assertBalance: jest.fn().mockResolvedValue(undefined),
      debit: jest.fn().mockResolvedValue(undefined),
    };
    const emit = jest.fn();
    const logger = { error: jest.fn(), warn: jest.fn() };

    const meter = new RunCreditMeter(
      creditMeterService as any,
      userId,
      emit,
      logger as any,
    );

    return { meter, mocks: { creditMeterService, emit, logger } };
  };

  let meter: RunCreditMeter;
  let mocks: ReturnType<typeof makeMeter>['mocks'];

  beforeEach(() => {
    jest.clearAllMocks();
    ({ meter, mocks } = makeMeter());
  });

  describe('record', () => {
    it('should accumulate the converted credits', () => {
      mocks.creditMeterService.toCredits
        .mockReturnValueOnce(24)
        .mockReturnValueOnce(32);

      meter.record({ kind: 'llm', amount: 0.0234 });
      meter.record({ kind: 'web_search', amount: 1 });

      expect(meter.creditsUsed).toBe(56);
    });

    it('should delegate the conversion to CreditMeterService', () => {
      const usage = { kind: 'llm', amount: 0.01, detail: { model: 'gpt' } };

      meter.record(usage as any);

      expect(mocks.creditMeterService.toCredits).toHaveBeenCalledWith(usage);
    });

    it('should emit usage.tick with the resolved credits', () => {
      mocks.creditMeterService.toCredits.mockReturnValue(24);

      meter.record({
        kind: 'llm',
        amount: 0.0234,
        detail: { model: 'gpt-5', totalTokens: 1200 },
      });

      // One call that both accounts and announces — which is why ctx.emit stays
      // reserved for step.progress.
      expect(mocks.emit).toHaveBeenCalledWith({
        type: RunEventType.USAGE_TICK,
        data: {
          kind: 'llm',
          credits: 24,
          totalCredits: 24,
          detail: { model: 'gpt-5', totalTokens: 1200 },
        },
      });
    });

    it('should omit detail from the tick when the usage carries none', () => {
      mocks.creditMeterService.toCredits.mockReturnValue(32);

      meter.record({ kind: 'web_search', amount: 1 });

      expect(mocks.emit).toHaveBeenCalledWith({
        type: RunEventType.USAGE_TICK,
        data: { kind: 'web_search', credits: 32, totalCredits: 32 },
      });
    });

    it('should be synchronous', () => {
      expect(meter.record({ kind: 'web_search', amount: 1 })).toBeUndefined();
    });
  });

  describe('reset', () => {
    it('should zero the accumulator so a whole-job retry cannot double-count', () => {
      mocks.creditMeterService.toCredits.mockReturnValue(30);
      meter.record({ kind: 'llm', amount: 0.03 });
      expect(meter.creditsUsed).toBe(30);

      meter.reset();

      expect(meter.creditsUsed).toBe(0);
    });

    it('should leave a later commit charging only the winning attempt', async () => {
      mocks.creditMeterService.toCredits.mockReturnValue(30);

      meter.record({ kind: 'llm', amount: 0.03 }); // failed attempt
      meter.reset(); // next attempt starts here
      meter.record({ kind: 'llm', amount: 0.03 }); // winning attempt
      await meter.commit();

      expect(mocks.creditMeterService.debit).toHaveBeenCalledWith(userId, 30);
    });
  });

  describe('assertBalance', () => {
    it('should delegate the headroom check for the bound run owner', async () => {
      await meter.assertBalance();

      expect(mocks.creditMeterService.assertBalance).toHaveBeenCalledWith(
        userId,
      );
    });

    it('should check and debit the same user', async () => {
      // One bound owner, so the guard and the settlement cannot disagree.
      mocks.creditMeterService.toCredits.mockReturnValue(12);
      meter.record({ kind: 'llm', amount: 0.012 });

      await meter.assertBalance();
      await meter.commit();

      const [checked] = mocks.creditMeterService.assertBalance.mock.calls[0];
      const [debited] = mocks.creditMeterService.debit.mock.calls[0];
      expect(checked).toBe(debited);
    });

    it('should propagate the gate rejection', async () => {
      mocks.creditMeterService.assertBalance.mockRejectedValue(
        new Error('FEATURE_LIMIT_EXCEEDED'),
      );

      await expect(meter.assertBalance()).rejects.toThrow(
        'FEATURE_LIMIT_EXCEEDED',
      );
    });
  });

  describe('commit', () => {
    it('should debit the accumulated total for the run owner', async () => {
      mocks.creditMeterService.toCredits.mockReturnValue(12);
      meter.record({ kind: 'llm', amount: 0.012 });

      await meter.commit();

      expect(mocks.creditMeterService.debit).toHaveBeenCalledWith(userId, 12);
    });

    it('should not debit when nothing was recorded', async () => {
      await meter.commit();

      expect(mocks.creditMeterService.debit).not.toHaveBeenCalled();
    });

    it('should swallow a debit failure rather than fail a completed run', async () => {
      // Settlement is best-effort: never fail a user's completed run over an
      // accounting write.
      mocks.creditMeterService.toCredits.mockReturnValue(12);
      meter.record({ kind: 'llm', amount: 0.012 });
      mocks.creditMeterService.debit.mockRejectedValue(new Error('mongo down'));

      await expect(meter.commit()).resolves.toBeUndefined();
      expect(mocks.logger.error).toHaveBeenCalled();
    });
  });
});
