import Link from "next/link";
import { CreditCard } from "lucide-react";
import type { PaymentUsageMetric, SubscriptionTier } from "../lib/types";
import { getCreditsRemaining, getPlanSummary } from "./planSummary";

export default function PlanBillingCard({
  tier,
  credits,
}: {
  tier?: SubscriptionTier | null;
  credits?: PaymentUsageMetric | null;
}) {
  const { tierName, isFreeTier } = getPlanSummary(tier);
  const remaining = getCreditsRemaining(credits);
  const planLabel = /\s+plan$/i.test(tierName) ? tierName : `${tierName} plan`;

  return (
    <div className="mq-card mq-settings-card">
      <div className="mq-card-heading">
        <span className="mq-title"><CreditCard size={16} /> Plan &amp; billing</span>
      </div>
      <div className="mq-session-row mq-plan-billing-row">
        <div>
          <strong>{planLabel}</strong>
          {credits && remaining !== null ? (
            <p>{remaining.toLocaleString()} of {credits.limit.toLocaleString()} credits left this month</p>
          ) : null}
        </div>
        <div className="mq-plan-billing-actions">
          {isFreeTier ? <Link href="/billing#change-plan" className="mq-upgrade-link">Upgrade</Link> : null}
          <Link href="/billing" className="mq-secondary-button">Manage billing</Link>
        </div>
      </div>
    </div>
  );
}
