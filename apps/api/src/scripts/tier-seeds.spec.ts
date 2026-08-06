import { TIER_SEEDS } from '.';

describe('TIER_SEEDS', () => {
  it('should seed the credit allowance ladder for every tier', () => {
    expect(
      Object.fromEntries(
        TIER_SEEDS.map(({ name, limits }) => [name, limits.credits]),
      ),
    ).toEqual({
      Free: 120,
      Starter: 2000,
      Creator: 10000,
      'Pro Writer': 30000,
    });
  });

  it('should keep connected-account and scheduling limits unchanged', () => {
    expect(
      Object.fromEntries(
        TIER_SEEDS.map(({ name, limits }) => [
          name,
          {
            connectedAccounts: limits.connected_accounts,
            scheduledPosts: limits.scheduled_posts,
          },
        ]),
      ),
    ).toEqual({
      Free: { connectedAccounts: 1, scheduledPosts: 1 },
      Starter: { connectedAccounts: 1, scheduledPosts: 5 },
      Creator: { connectedAccounts: 1, scheduledPosts: 15 },
      'Pro Writer': { connectedAccounts: 5, scheduledPosts: -1 },
    });
  });

  it('should advertise finite credit allowances and paid-only research', () => {
    const tiers = Object.fromEntries(TIER_SEEDS.map((tier) => [tier.name, tier]));

    expect(tiers.Free.metadata.features).toContain('120 shared AI credits/month');
    expect(tiers.Free.metadata.features).not.toContain('AI research');
    expect(tiers.Starter.metadata.features).toEqual(
      expect.arrayContaining(['2,000 AI credits/month', 'AI research']),
    );
    expect(tiers.Creator.metadata.features).toEqual(
      expect.arrayContaining(['10,000 AI credits/month', 'AI research']),
    );
    expect(tiers['Pro Writer'].metadata.features).toEqual(
      expect.arrayContaining(['30,000 AI credits/month', 'AI research']),
    );
  });
});
