import { z } from 'zod';

const artifactTypes = ['POST', 'POLL', 'DOCUMENT'] as const;
const paidTiers = ['Starter', 'Creator', 'Pro Writer'] as const;
const decisionAreas = [
  'MARKUP',
  'SEARCH_PRICING',
  'RENDER_PRICING',
  'TIER_ALLOWANCES',
  'TOP_UPS',
] as const;

type ArtifactType = (typeof artifactTypes)[number];
type PaidTier = (typeof paidTiers)[number];

const finiteAllowanceSchema = z.number().int().positive();

const decisionItemSchema = z.object({
  area: z.enum(decisionAreas),
  action: z.enum(['RETAIN', 'CHANGE']),
  rationale: z.string().trim().min(1),
  implementationIssue: z.string().url().optional(),
  proposedTierAllowances: z
    .object({
      Starter: finiteAllowanceSchema,
      Creator: finiteAllowanceSchema,
      'Pro Writer': finiteAllowanceSchema,
    })
    .optional(),
});

export const creditEconomicsReviewInputSchema = z
  .object({
    cohort: z.object({
      billingCycle: z.object({
        start: z.string().datetime(),
        end: z.string().datetime(),
        complete: z.boolean(),
      }),
      users: z
        .array(
          z.object({
            userId: z.string().trim().min(1),
            tier: z.enum(paidTiers),
            allowanceCredits: finiteAllowanceSchema,
            exhausted: z.boolean(),
            subscriptionRevenueUsd: z.number().nonnegative(),
          }),
        )
        .min(1),
    }),
    runs: z
      .array(
        z
          .object({
            runId: z.string().trim().min(1),
            userId: z.string().trim().min(1),
            occurredAt: z.string().datetime(),
            artifactType: z.enum(artifactTypes),
            withResearch: z.boolean(),
            credits: z.number().int().nonnegative(),
            successfulTavilyLookups: z.number().int().min(0).max(5),
            browserlessUnits: z.array(z.number().int().positive()),
            attempts: z.number().int().positive(),
            status: z.enum(['COMPLETED', 'FAILED']),
            providerCostUsd: z.object({
              openrouter: z.number().nonnegative(),
              tavily: z.number().nonnegative(),
              browserless: z.number().nonnegative(),
            }),
          })
          .superRefine((run, ctx) => {
            if (!run.withResearch && run.successfulTavilyLookups !== 0) {
              ctx.addIssue({
                code: 'custom',
                path: ['successfulTavilyLookups'],
                message: 'non-research runs cannot contain Tavily lookups',
              });
            }
            if (
              run.artifactType !== 'DOCUMENT' &&
              run.browserlessUnits.length > 0
            ) {
              ctx.addIssue({
                code: 'custom',
                path: ['browserlessUnits'],
                message: 'only DOCUMENT runs can contain Browserless renders',
              });
            }
          }),
      )
      .min(1),
    providerInvoices: z
      .array(
        z.object({
          provider: z.enum(['OPENROUTER', 'TAVILY', 'BROWSERLESS']),
          amountUsd: z.number().nonnegative(),
          reference: z.string().trim().min(1),
          periodStart: z.string().datetime(),
          periodEnd: z.string().datetime(),
        }),
      )
      .min(3),
    decision: z.object({
      owner: z.string().trim().min(1),
      decidedAt: z.string().datetime(),
      items: z.array(decisionItemSchema).length(5),
    }),
  })
  .superRefine((input, ctx) => {
    if (
      new Date(input.cohort.billingCycle.end) <=
      new Date(input.cohort.billingCycle.start)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['cohort', 'billingCycle', 'end'],
        message: 'billing cycle end must be after its start',
      });
    }

    const userIds = new Set<string>();
    input.cohort.users.forEach((user, index) => {
      if (userIds.has(user.userId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['cohort', 'users', index, 'userId'],
          message: `duplicate paid user ${user.userId}`,
        });
      }
      userIds.add(user.userId);
    });

    const tierNames = new Set(input.cohort.users.map(({ tier }) => tier));
    for (const tier of paidTiers) {
      if (!tierNames.has(tier)) {
        ctx.addIssue({
          code: 'custom',
          path: ['cohort', 'users'],
          message: `missing ${tier} economics`,
        });
      }
    }

    const cycleStart = new Date(input.cohort.billingCycle.start).getTime();
    const cycleEnd = new Date(input.cohort.billingCycle.end).getTime();
    const decisionTime = new Date(input.decision.decidedAt).getTime();
    if (cycleEnd > decisionTime) {
      ctx.addIssue({
        code: 'custom',
        path: ['decision', 'decidedAt'],
        message: 'decision cannot predate the reviewed billing window',
      });
    }
    if (
      input.cohort.billingCycle.complete &&
      cycleEnd - cycleStart < 28 * 24 * 60 * 60 * 1000
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['cohort', 'billingCycle'],
        message: 'a complete paid billing cycle must span at least 28 days',
      });
    }

    const runIds = new Set<string>();
    input.runs.forEach((run, index) => {
      if (runIds.has(run.runId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['runs', index, 'runId'],
          message: `duplicate run ${run.runId}`,
        });
      }
      runIds.add(run.runId);
      if (!userIds.has(run.userId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['runs', index, 'userId'],
          message: `run ${run.runId} does not belong to a paid cohort user`,
        });
      }
      const occurredAt = new Date(run.occurredAt).getTime();
      if (occurredAt < cycleStart || occurredAt >= cycleEnd) {
        ctx.addIssue({
          code: 'custom',
          path: ['runs', index, 'occurredAt'],
          message: `run ${run.runId} falls outside the billing window`,
        });
      }
    });

    const invoiceProviders = new Set(
      input.providerInvoices.map(({ provider }) => provider),
    );
    for (const provider of ['OPENROUTER', 'TAVILY', 'BROWSERLESS'] as const) {
      if (!invoiceProviders.has(provider)) {
        ctx.addIssue({
          code: 'custom',
          path: ['providerInvoices'],
          message: `missing ${provider} invoice evidence`,
        });
      }
    }
    input.providerInvoices.forEach((invoice, index) => {
      if (
        invoice.periodStart !== input.cohort.billingCycle.start ||
        invoice.periodEnd !== input.cohort.billingCycle.end
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['providerInvoices', index],
          message: `${invoice.provider} invoice does not match the billing window`,
        });
      }
    });

    const areas = new Set(input.decision.items.map(({ area }) => area));
    for (const area of decisionAreas) {
      if (!areas.has(area)) {
        ctx.addIssue({
          code: 'custom',
          path: ['decision', 'items'],
          message: `missing human decision for ${area}`,
        });
      }
    }

    input.decision.items.forEach((item, index) => {
      if (item.action === 'CHANGE' && !item.implementationIssue) {
        ctx.addIssue({
          code: 'custom',
          path: ['decision', 'items', index, 'implementationIssue'],
          message: `${item.area} changes require a separate implementation issue`,
        });
      }
      if (
        item.action === 'CHANGE' &&
        item.implementationIssue &&
        !/^https:\/\/github\.com\/krispamB\/linkgenserver\/issues\/\d+$/.test(
          item.implementationIssue,
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['decision', 'items', index, 'implementationIssue'],
          message:
            'implementationIssue must link to a linkgenserver GitHub issue',
        });
      }
      if (
        item.area === 'TIER_ALLOWANCES' &&
        item.action === 'CHANGE' &&
        !item.proposedTierAllowances
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['decision', 'items', index, 'proposedTierAllowances'],
          message: 'tier allowance changes require finite proposed allowances',
        });
      }
    });
  });

export type CreditEconomicsReviewInput = z.infer<
  typeof creditEconomicsReviewInputSchema
>;

interface Percentiles {
  p50: number;
  p95: number;
}

interface Distribution extends Percentiles {
  mean: number;
}

export interface ArtifactCreditMetrics extends Percentiles {
  artifactType: ArtifactType;
  withResearch: boolean;
  sampleSize: number;
}

export interface TierEconomicsMetrics {
  tier: PaidTier;
  paidUsers: number;
  allowanceCredits: number;
  exhaustionRatePercent: number;
  subscriptionRevenueUsd: number;
  providerCostUsd: number;
  realizedGrossMarginPercent: number;
  intendedGrossMarginFloorPercent: number;
  marginDeltaPercent: number;
}

export interface CreditEconomicsReview {
  cohort: {
    paidUsers: number;
    billingCycle: CreditEconomicsReviewInput['cohort']['billingCycle'];
  };
  eligibilityBasis: 'complete paid billing cycle' | '100–200 paid-user cohort';
  artifactCredits: ArtifactCreditMetrics[];
  operations: {
    researchRuns: number;
    tavilyLookups: Distribution;
    browserlessRenders: number;
    browserlessUnits: Distribution;
    retryRatePercent: number;
    failureRatePercent: number;
  };
  invoices: {
    evidence: CreditEconomicsReviewInput['providerInvoices'];
    invoiceTotalUsd: number;
    attributedProviderCostUsd: number;
    reconciliationDeltaUsd: number;
  };
  tiers: TierEconomicsMetrics[];
  decision: CreditEconomicsReviewInput['decision'];
}

const intendedGrossMarginFloorPercent: Record<PaidTier, number> = {
  Starter: 90,
  Creator: 75,
  'Pro Writer': 50,
};

const round = (value: number, places = 2): number => {
  const multiplier = 10 ** places;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
};

const percentile = (values: number[], ratio: number): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(ratio * sorted.length) - 1);
  return sorted[index];
};

const distribution = (values: number[]): Distribution => ({
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  mean: round(
    values.reduce((total, value) => total + value, 0) / values.length,
  ),
});

const percentageRate = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : round((numerator / denominator) * 100);

export const analyzeCreditEconomics = (
  candidate: unknown,
): CreditEconomicsReview => {
  const input = creditEconomicsReviewInputSchema.parse(candidate);
  const paidUsers = input.cohort.users.length;
  const cycleEligible = input.cohort.billingCycle.complete;
  const cohortEligible = paidUsers >= 100 && paidUsers <= 200;

  if (!cycleEligible && !cohortEligible) {
    throw new Error(
      'Credit economics review requires one complete paid billing cycle or a cohort of 100 to 200 paid users',
    );
  }

  const artifactCredits: ArtifactCreditMetrics[] = [];
  for (const artifactType of artifactTypes) {
    for (const withResearch of [false, true]) {
      const credits = input.runs
        .filter(
          (run) =>
            run.artifactType === artifactType &&
            run.withResearch === withResearch &&
            run.status === 'COMPLETED',
        )
        .map(({ credits }) => credits);
      if (credits.length === 0) {
        throw new Error(
          `Credit economics review is missing run samples for ${artifactType} ${withResearch ? 'with' : 'without'} research`,
        );
      }
      artifactCredits.push({
        artifactType,
        withResearch,
        sampleSize: credits.length,
        p50: percentile(credits, 0.5),
        p95: percentile(credits, 0.95),
      });
    }
  }

  const researchRuns = input.runs.filter(({ withResearch }) => withResearch);
  const browserlessUnits = input.runs.flatMap(
    ({ browserlessUnits }) => browserlessUnits,
  );
  if (browserlessUnits.length === 0) {
    throw new Error(
      'Credit economics review requires Browserless render samples',
    );
  }

  const invoiceTotalUsd = round(
    input.providerInvoices.reduce(
      (total, invoice) => total + invoice.amountUsd,
      0,
    ),
  );
  const attributedProviderCostUsd = round(
    input.runs.reduce(
      (total, run) =>
        total +
        run.providerCostUsd.openrouter +
        run.providerCostUsd.tavily +
        run.providerCostUsd.browserless,
      0,
    ),
  );

  const providerCosts = {
    OPENROUTER: round(
      input.runs.reduce(
        (total, run) => total + run.providerCostUsd.openrouter,
        0,
      ),
    ),
    TAVILY: round(
      input.runs.reduce((total, run) => total + run.providerCostUsd.tavily, 0),
    ),
    BROWSERLESS: round(
      input.runs.reduce(
        (total, run) => total + run.providerCostUsd.browserless,
        0,
      ),
    ),
  };
  for (const provider of ['OPENROUTER', 'TAVILY', 'BROWSERLESS'] as const) {
    const invoiced = round(
      input.providerInvoices
        .filter((invoice) => invoice.provider === provider)
        .reduce((total, invoice) => total + invoice.amountUsd, 0),
    );
    const tolerance = Math.max(1, invoiced * 0.01);
    if (Math.abs(invoiced - providerCosts[provider]) > tolerance) {
      throw new Error(
        `${provider} invoice does not reconcile to observed run cost: invoiced ${formatUsd(invoiced)}, observed ${formatUsd(providerCosts[provider])}`,
      );
    }
  }

  const tiers = paidTiers.map((tierName): TierEconomicsMetrics => {
    const users = input.cohort.users.filter(({ tier }) => tier === tierName);
    const allowances = new Set(
      users.map(({ allowanceCredits }) => allowanceCredits),
    );
    if (allowances.size !== 1) {
      throw new Error(`${tierName} users must share one finite allowance`);
    }
    const subscriptionRevenueUsd = round(
      users.reduce((total, user) => total + user.subscriptionRevenueUsd, 0),
    );
    const providerCostUsd = round(
      input.runs
        .filter((run) => users.some(({ userId }) => userId === run.userId))
        .reduce(
          (total, run) =>
            total +
            run.providerCostUsd.openrouter +
            run.providerCostUsd.tavily +
            run.providerCostUsd.browserless,
          0,
        ),
    );
    const realizedGrossMarginPercent =
      subscriptionRevenueUsd === 0
        ? 0
        : round(
            ((subscriptionRevenueUsd - providerCostUsd) /
              subscriptionRevenueUsd) *
              100,
          );
    const intended = intendedGrossMarginFloorPercent[tierName];

    return {
      tier: tierName,
      paidUsers: users.length,
      allowanceCredits: users[0].allowanceCredits,
      exhaustionRatePercent: percentageRate(
        users.filter(({ exhausted }) => exhausted).length,
        users.length,
      ),
      subscriptionRevenueUsd,
      providerCostUsd,
      realizedGrossMarginPercent,
      intendedGrossMarginFloorPercent: intended,
      marginDeltaPercent: round(realizedGrossMarginPercent - intended),
    };
  });

  return {
    cohort: {
      paidUsers,
      billingCycle: input.cohort.billingCycle,
    },
    eligibilityBasis: cycleEligible
      ? 'complete paid billing cycle'
      : '100–200 paid-user cohort',
    artifactCredits,
    operations: {
      researchRuns: researchRuns.length,
      tavilyLookups: distribution(
        researchRuns.map(
          ({ successfulTavilyLookups }) => successfulTavilyLookups,
        ),
      ),
      browserlessRenders: browserlessUnits.length,
      browserlessUnits: distribution(browserlessUnits),
      retryRatePercent: percentageRate(
        input.runs.filter(({ attempts }) => attempts > 1).length,
        input.runs.length,
      ),
      failureRatePercent: percentageRate(
        input.runs.filter(({ status }) => status === 'FAILED').length,
        input.runs.length,
      ),
    },
    invoices: {
      evidence: input.providerInvoices,
      invoiceTotalUsd,
      attributedProviderCostUsd,
      reconciliationDeltaUsd: round(
        invoiceTotalUsd - attributedProviderCostUsd,
      ),
    },
    tiers,
    decision: input.decision,
  };
};

const formatNumber = (value: number): string => value.toLocaleString('en-US');
const formatUsd = (value: number): string => `$${value.toFixed(2)}`;
const escapeCell = (value: string): string =>
  value.replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ');

export const renderCreditEconomicsReport = (
  review: CreditEconomicsReview,
): string => {
  const artifactRows = review.artifactCredits
    .map(
      (metric) =>
        `| ${metric.artifactType} | ${metric.withResearch ? 'Yes' : 'No'} | ${metric.sampleSize} | ${formatNumber(metric.p50)} | ${formatNumber(metric.p95)} |`,
    )
    .join('\n');
  const invoiceRows = review.invoices.evidence
    .map(
      (invoice) =>
        `| ${invoice.provider} | ${formatUsd(invoice.amountUsd)} | ${escapeCell(invoice.reference)} |`,
    )
    .join('\n');
  const tierRows = review.tiers
    .map(
      (tier) =>
        `| ${tier.tier} | ${tier.paidUsers} | ${formatNumber(tier.allowanceCredits)} | ${tier.exhaustionRatePercent.toFixed(2)}% | ${formatUsd(tier.subscriptionRevenueUsd)} | ${formatUsd(tier.providerCostUsd)} | ${tier.realizedGrossMarginPercent.toFixed(2)}% | ${tier.intendedGrossMarginFloorPercent.toFixed(2)}% | ${tier.marginDeltaPercent.toFixed(2)} pp |`,
    )
    .join('\n');
  const decisionRows = review.decision.items
    .map(
      (item) =>
        `| ${item.area} | ${item.action} | ${escapeCell(item.rationale)} | ${escapeCell(item.implementationIssue ?? '—')} |`,
    )
    .join('\n');

  return `# Production Credit Economics Review

## Cohort

- Eligibility: ${review.eligibilityBasis}
- Paid users: ${review.cohort.paidUsers}
- Billing cycle: ${review.cohort.billingCycle.start} to ${review.cohort.billingCycle.end}

## Artifact credits

| Artifact | Research | Runs | p50 credits | p95 credits |
|---|---:|---:|---:|---:|
${artifactRows}

## Provider operations

- Research runs: ${review.operations.researchRuns}
- Successful Tavily lookups per research run: mean ${review.operations.tavilyLookups.mean}, p50 ${review.operations.tavilyLookups.p50}, p95 ${review.operations.tavilyLookups.p95}
- Browserless renders: ${review.operations.browserlessRenders}
- Browserless units per render: mean ${review.operations.browserlessUnits.mean}, p50 ${review.operations.browserlessUnits.p50}, p95 ${review.operations.browserlessUnits.p95}
- Workflow retry rate: ${review.operations.retryRatePercent.toFixed(2)}%
- Workflow failure rate: ${review.operations.failureRatePercent.toFixed(2)}%

## Provider invoices

| Provider | Amount | Evidence reference |
|---|---:|---|
${invoiceRows}

- Invoice total: ${formatUsd(review.invoices.invoiceTotalUsd)}
- Provider cost attributed to paid tiers: ${formatUsd(review.invoices.attributedProviderCostUsd)}
- Reconciliation delta: ${formatUsd(review.invoices.reconciliationDeltaUsd)}

## Tier economics

| Tier | Paid users | Allowance | Exhaustion | Revenue | Provider cost | Realized margin | Intended floor | Delta |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${tierRows}

## Human decision

- Owner: ${review.decision.owner}
- Decided at: ${review.decision.decidedAt}

| Area | Decision | Rationale | Implementation issue |
|---|---|---|---|
${decisionRows}
`;
};
