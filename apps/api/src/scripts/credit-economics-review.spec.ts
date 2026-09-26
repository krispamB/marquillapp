import {
  analyzeCreditEconomics,
  renderCreditEconomicsReport,
  type CreditEconomicsReviewInput,
} from './credit-economics-review';

describe('CreditEconomicsReview', () => {
  const makeInput = (): CreditEconomicsReviewInput => ({
    cohort: {
      billingCycle: {
        start: '2026-06-01T00:00:00.000Z',
        end: '2026-07-01T00:00:00.000Z',
        complete: false,
      },
      users: [
        ...Array.from({ length: 50 }, (_, index) => ({
          userId: `starter-${index + 1}`,
          tier: 'Starter' as const,
          allowanceCredits: 2000,
          exhausted: index < 5,
          subscriptionRevenueUsd: 10,
        })),
        ...Array.from({ length: 30 }, (_, index) => ({
          userId: `creator-${index + 1}`,
          tier: 'Creator' as const,
          allowanceCredits: 10000,
          exhausted: index < 6,
          subscriptionRevenueUsd: 20,
        })),
        ...Array.from({ length: 20 }, (_, index) => ({
          userId: `pro-${index + 1}`,
          tier: 'Pro Writer' as const,
          allowanceCredits: 30000,
          exhausted: index < 10,
          subscriptionRevenueUsd: 30,
        })),
      ],
    },
    runs: [
      {
        runId: 'post-quick-1',
        userId: 'starter-1',
        occurredAt: '2026-06-10T00:00:00.000Z',
        artifactType: 'POST',
        withResearch: false,
        credits: 10,
        successfulTavilyLookups: 0,
        browserlessUnits: [],
        attempts: 1,
        status: 'COMPLETED',
        providerCostUsd: { openrouter: 10, tavily: 0, browserless: 0 },
      },
      {
        runId: 'post-quick-2',
        userId: 'starter-2',
        occurredAt: '2026-06-11T00:00:00.000Z',
        artifactType: 'POST',
        withResearch: false,
        credits: 20,
        successfulTavilyLookups: 0,
        browserlessUnits: [],
        attempts: 2,
        status: 'COMPLETED',
        providerCostUsd: { openrouter: 10, tavily: 0, browserless: 0 },
      },
      {
        runId: 'post-research-1',
        userId: 'starter-3',
        occurredAt: '2026-06-12T00:00:00.000Z',
        artifactType: 'POST',
        withResearch: true,
        credits: 50,
        successfulTavilyLookups: 1,
        browserlessUnits: [],
        attempts: 1,
        status: 'COMPLETED',
        providerCostUsd: { openrouter: 10, tavily: 5, browserless: 0 },
      },
      {
        runId: 'post-research-2',
        userId: 'starter-4',
        occurredAt: '2026-06-13T00:00:00.000Z',
        artifactType: 'POST',
        withResearch: true,
        credits: 90,
        successfulTavilyLookups: 5,
        browserlessUnits: [],
        attempts: 1,
        status: 'FAILED',
        providerCostUsd: { openrouter: 10, tavily: 5, browserless: 0 },
      },
      {
        runId: 'poll-quick-1',
        userId: 'creator-1',
        occurredAt: '2026-06-14T00:00:00.000Z',
        artifactType: 'POLL',
        withResearch: false,
        credits: 12,
        successfulTavilyLookups: 0,
        browserlessUnits: [],
        attempts: 1,
        status: 'COMPLETED',
        providerCostUsd: { openrouter: 10, tavily: 0, browserless: 0 },
      },
      {
        runId: 'poll-quick-2',
        userId: 'creator-2',
        occurredAt: '2026-06-15T00:00:00.000Z',
        artifactType: 'POLL',
        withResearch: false,
        credits: 24,
        successfulTavilyLookups: 0,
        browserlessUnits: [],
        attempts: 1,
        status: 'COMPLETED',
        providerCostUsd: { openrouter: 10, tavily: 0, browserless: 0 },
      },
      {
        runId: 'poll-research-1',
        userId: 'creator-3',
        occurredAt: '2026-06-16T00:00:00.000Z',
        artifactType: 'POLL',
        withResearch: true,
        credits: 60,
        successfulTavilyLookups: 2,
        browserlessUnits: [],
        attempts: 1,
        status: 'COMPLETED',
        providerCostUsd: { openrouter: 10, tavily: 5, browserless: 0 },
      },
      {
        runId: 'poll-research-2',
        userId: 'creator-4',
        occurredAt: '2026-06-17T00:00:00.000Z',
        artifactType: 'POLL',
        withResearch: true,
        credits: 100,
        successfulTavilyLookups: 4,
        browserlessUnits: [],
        attempts: 1,
        status: 'COMPLETED',
        providerCostUsd: { openrouter: 10, tavily: 5, browserless: 0 },
      },
      {
        runId: 'document-quick-1',
        userId: 'pro-1',
        occurredAt: '2026-06-18T00:00:00.000Z',
        artifactType: 'DOCUMENT',
        withResearch: false,
        credits: 20,
        successfulTavilyLookups: 0,
        browserlessUnits: [1],
        attempts: 1,
        status: 'COMPLETED',
        providerCostUsd: { openrouter: 10, tavily: 0, browserless: 5 },
      },
      {
        runId: 'document-quick-2',
        userId: 'pro-2',
        occurredAt: '2026-06-19T00:00:00.000Z',
        artifactType: 'DOCUMENT',
        withResearch: false,
        credits: 40,
        successfulTavilyLookups: 0,
        browserlessUnits: [2, 3],
        attempts: 2,
        status: 'COMPLETED',
        providerCostUsd: { openrouter: 10, tavily: 0, browserless: 5 },
      },
      {
        runId: 'document-research-1',
        userId: 'pro-3',
        occurredAt: '2026-06-20T00:00:00.000Z',
        artifactType: 'DOCUMENT',
        withResearch: true,
        credits: 80,
        successfulTavilyLookups: 3,
        browserlessUnits: [2],
        attempts: 1,
        status: 'COMPLETED',
        providerCostUsd: { openrouter: 10, tavily: 5, browserless: 5 },
      },
      {
        runId: 'document-research-2',
        userId: 'pro-4',
        occurredAt: '2026-06-21T00:00:00.000Z',
        artifactType: 'DOCUMENT',
        withResearch: true,
        credits: 120,
        successfulTavilyLookups: 5,
        browserlessUnits: [4],
        attempts: 1,
        status: 'COMPLETED',
        providerCostUsd: { openrouter: 10, tavily: 5, browserless: 5 },
      },
    ],
    providerInvoices: [
      {
        provider: 'OPENROUTER',
        amountUsd: 120,
        reference: 'inv-openrouter',
        periodStart: '2026-06-01T00:00:00.000Z',
        periodEnd: '2026-07-01T00:00:00.000Z',
      },
      {
        provider: 'TAVILY',
        amountUsd: 30,
        reference: 'inv-tavily',
        periodStart: '2026-06-01T00:00:00.000Z',
        periodEnd: '2026-07-01T00:00:00.000Z',
      },
      {
        provider: 'BROWSERLESS',
        amountUsd: 20,
        reference: 'inv-browserless',
        periodStart: '2026-06-01T00:00:00.000Z',
        periodEnd: '2026-07-01T00:00:00.000Z',
      },
    ],
    decision: {
      owner: 'Pricing Owner',
      decidedAt: '2026-07-02T00:00:00.000Z',
      items: [
        { area: 'MARKUP', action: 'RETAIN', rationale: 'Margins are healthy.' },
        {
          area: 'SEARCH_PRICING',
          action: 'RETAIN',
          rationale: 'Lookup economics match plan.',
        },
        {
          area: 'RENDER_PRICING',
          action: 'RETAIN',
          rationale: 'Render units are covered.',
        },
        {
          area: 'TIER_ALLOWANCES',
          action: 'RETAIN',
          rationale: 'Exhaustion is acceptable.',
        },
        {
          area: 'TOP_UPS',
          action: 'RETAIN',
          rationale: 'Do not introduce top-ups yet.',
        },
      ],
    },
  });

  describe('analyzeCreditEconomics', () => {
    it('should reject the review when an incomplete cycle has fewer than 100 paid users', () => {
      const input = makeInput();
      input.cohort.users = input.cohort.users.slice(0, 99);

      expect(() => analyzeCreditEconomics(input)).toThrow(
        'requires one complete paid billing cycle or a cohort of 100 to 200 paid users',
      );
    });

    it('should accept the review when a complete paid billing cycle has fewer than 100 users', () => {
      const input = makeInput();
      input.cohort.billingCycle.complete = true;
      input.cohort.users = input.cohort.users.slice(0, 99);

      expect(analyzeCreditEconomics(input).eligibilityBasis).toBe(
        'complete paid billing cycle',
      );
    });

    it('should report p50 and p95 credits when every artifact and research slice is present', () => {
      const review = analyzeCreditEconomics(makeInput());

      expect(review.artifactCredits).toHaveLength(6);
      expect(review.artifactCredits).toContainEqual({
        artifactType: 'POST',
        withResearch: false,
        sampleSize: 2,
        p50: 10,
        p95: 20,
      });
      expect(review.artifactCredits).toContainEqual({
        artifactType: 'DOCUMENT',
        withResearch: true,
        sampleSize: 2,
        p50: 80,
        p95: 120,
      });
      expect(review.artifactCredits).toContainEqual({
        artifactType: 'POST',
        withResearch: true,
        sampleSize: 1,
        p50: 50,
        p95: 50,
      });
    });

    it('should reject the review when an artifact and research slice is missing', () => {
      const input = makeInput();
      input.runs = input.runs.filter(
        (run) => !(run.artifactType === 'POLL' && run.withResearch),
      );

      expect(() => analyzeCreditEconomics(input)).toThrow(
        'missing run samples for POLL with research',
      );
    });

    it('should report provider operations, retries, failures, and invoice reconciliation when evidence is complete', () => {
      const review = analyzeCreditEconomics(makeInput());

      expect(review.operations).toEqual({
        researchRuns: 6,
        tavilyLookups: { p50: 3, p95: 5, mean: 3.33 },
        browserlessRenders: 5,
        browserlessUnits: { p50: 2, p95: 4, mean: 2.4 },
        retryRatePercent: 16.67,
        failureRatePercent: 8.33,
      });
      expect(review.invoices).toMatchObject({
        invoiceTotalUsd: 170,
        attributedProviderCostUsd: 170,
        reconciliationDeltaUsd: 0,
      });
    });

    it('should compare realized margin and exhaustion when tier economics are supplied', () => {
      const review = analyzeCreditEconomics(makeInput());

      expect(review.tiers).toContainEqual({
        tier: 'Creator',
        paidUsers: 30,
        allowanceCredits: 10000,
        exhaustionRatePercent: 20,
        subscriptionRevenueUsd: 600,
        providerCostUsd: 50,
        realizedGrossMarginPercent: 91.67,
        intendedGrossMarginFloorPercent: 75,
        marginDeltaPercent: 16.67,
      });
    });

    it('should require a separate implementation issue when a change is approved', () => {
      const input = makeInput();
      input.decision.items[0] = {
        area: 'MARKUP',
        action: 'CHANGE',
        rationale: 'Observed costs require a change.',
      };

      expect(() => analyzeCreditEconomics(input)).toThrow(
        'MARKUP changes require a separate implementation issue',
      );
    });

    it('should reject the review when current or proposed paid allowances are unlimited', () => {
      const current = makeInput();
      current.cohort.users[99].allowanceCredits = -1;
      expect(() => analyzeCreditEconomics(current)).toThrow();

      const proposed = makeInput();
      proposed.decision.items[3] = {
        area: 'TIER_ALLOWANCES',
        action: 'CHANGE',
        rationale: 'Change allowances.',
        implementationIssue:
          'https://github.com/krispamB/linkgenserver/issues/200',
        proposedTierAllowances: {
          Starter: 2000,
          Creator: 10000,
          'Pro Writer': -1,
        },
      };
      expect(() => analyzeCreditEconomics(proposed)).toThrow();
    });

    it('should reject the review when provider invoices do not reconcile to observed run cost', () => {
      const input = makeInput();
      input.providerInvoices[0].amountUsd = 100;

      expect(() => analyzeCreditEconomics(input)).toThrow(
        'OPENROUTER invoice does not reconcile',
      );
    });

    it('should reject an approved change when its URL is not a repository implementation issue', () => {
      const input = makeInput();
      input.decision.items[0] = {
        area: 'MARKUP',
        action: 'CHANGE',
        rationale: 'Observed costs require a change.',
        implementationIssue: 'https://example.com/not-an-issue',
      };

      expect(() => analyzeCreditEconomics(input)).toThrow(
        'implementationIssue must link to a linkgenserver GitHub issue',
      );
    });

    it('should reject a run when it is not linked to the billing window', () => {
      const input = makeInput();
      input.runs[0].occurredAt = '2026-07-02T00:00:00.000Z';

      expect(() => analyzeCreditEconomics(input)).toThrow(
        'falls outside the billing window',
      );
    });

    it('should reject invoice evidence when its period does not match the billing window', () => {
      const input = makeInput();
      input.providerInvoices[0].periodStart = '2026-05-01T00:00:00.000Z';

      expect(() => analyzeCreditEconomics(input)).toThrow(
        'invoice does not match the billing window',
      );
    });
  });

  describe('renderCreditEconomicsReport', () => {
    it('should render the evidence, margin comparison, and human decision when analysis succeeds', () => {
      const report = renderCreditEconomicsReport(
        analyzeCreditEconomics(makeInput()),
      );

      expect(report).toContain('# Production Credit Economics Review');
      expect(report).toContain('| POST | No | 2 | 10 | 20 |');
      expect(report).toContain('| Creator | 30 | 10,000 | 20.00% |');
      expect(report).toContain('inv-openrouter');
      expect(report).toContain('Pricing Owner');
      expect(report).toContain('| MARKUP | RETAIN | Margins are healthy. |');
    });
  });
});
