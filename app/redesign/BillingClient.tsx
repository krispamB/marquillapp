"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, CreditCard, ExternalLink } from "lucide-react";
import RedesignShell from "./Shell";
import { API_BASE, readApi } from "./api";
import { titleCase } from "./types";
import type { ConnectedAccount, PaymentUsageResponse, Tier, UserProfile } from "../lib/types";

type Invoice = { id?: string; date?: string; plan?: string; amount?: string | number; status?: string; customer?: string };

function unwrapList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (!value || typeof value !== "object") return [];
  const record = value as { data?: unknown; items?: unknown };
  if (Array.isArray(record.items)) return record.items as T[];
  if (Array.isArray(record.data)) return record.data as T[];
  return [];
}

export default function BillingRedesignClient({
  user,
  connectedAccounts,
  primaryAccountId,
  subscription,
}: {
  user: UserProfile;
  connectedAccounts: ConnectedAccount[];
  primaryAccountId?: string;
  subscription?: { name: string; isDefault?: boolean } | null;
}) {
  const [selectedAccountId, setSelectedAccountId] = useState(primaryAccountId ?? connectedAccounts[0]?.id);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [usage, setUsage] = useState<PaymentUsageResponse["data"] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      readApi<unknown>(`${API_BASE}/tiers/active`),
      readApi<unknown>(`${API_BASE}/payment/invoices`).catch(() => null),
      readApi<PaymentUsageResponse>(`${API_BASE}/payment/usage`).catch(() => null),
    ])
      .then(([tierResponse, invoiceResponse, usageResponse]) => {
        setTiers(unwrapList<Tier>(tierResponse));
        setInvoices(unwrapList<Invoice>(invoiceResponse));
        setUsage(usageResponse?.data ?? null);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load billing data."))
      .finally(() => setIsLoading(false));
  }, []);

  const planName = subscription?.name ?? usage?.tier?.name ?? user.tier?.name ?? "Free";
  const activeTier = useMemo(() => tiers.find((tier) => tier.name.toLowerCase() === planName.toLowerCase()), [planName, tiers]);

  return (
    <RedesignShell user={user} accounts={connectedAccounts} selectedAccountId={selectedAccountId} onSelectAccount={setSelectedAccountId} active="billing" title="Billing">
      <div className="mq-page-heading mq-page-heading-compact"><div><span className="mq-eyebrow">Plan, usage &amp; payment history</span><h1>Billing</h1><p>Keep your plan and publishing capacity in view.</p></div></div>
      {error ? <div className="mq-alert mq-alert-error">{error}</div> : null}
      {isLoading ? <div className="mq-alert">Loading billing data…</div> : null}

      <section className="mq-billing-top">
        <div className="mq-plan-card"><div className="mq-plan-card-header"><span className="mq-mono">_ current plan</span><span className="mq-active-badge">Active</span></div><div className="mq-plan-name">{planName}<span>{activeTier?.monthlyPrice ? `$${activeTier.monthlyPrice} / mo` : ""}</span></div><p>{activeTier?.metadata?.description ?? "Your current Marquill plan and publishing limits."}</p><div className="mq-plan-actions"><Link href="/pricing" className="mq-light-button">Change plan</Link><button type="button" className="mq-dark-outline-button" disabled title="Payment-management endpoint is not connected"><CreditCard size={14} /> Manage payment</button></div></div>
        <div className="mq-card mq-usage-card"><div className="mq-card-heading"><span className="mq-title">Usage this month</span><span className="mq-mono">{usage?.billingCycle?.end ? `resets ${new Date(usage.billingCycle.end).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "cycle unavailable"}</span></div><div className="mq-usage-list">{usage?.usage && Object.entries(usage.usage).length ? Object.entries(usage.usage).map(([key, metric]) => { const percent = metric.limit > 0 ? Math.min(100, metric.used / metric.limit * 100) : 0; return <div key={key} className="mq-usage-item"><div><span>{titleCase(key)}</span><strong>{metric.used} / {metric.limit > 0 ? metric.limit : "∞"}</strong></div><div className="mq-progress"><span style={{ width: `${percent}%` }} /></div></div>; }) : <p className="mq-empty">No usage data found.</p>}</div></div>
      </section>

        <section><div className="mq-section-heading"><h2>Change plan</h2><span>Plans returned by the billing service</span></div><div className="mq-plan-grid">{tiers.length ? tiers.map((tier) => { const current = tier.name.toLowerCase() === planName.toLowerCase(); const features = (tier.metadata as Tier["metadata"] & { features?: string[] } | undefined)?.features ?? ["LinkedIn account", "AI drafting", "Post scheduling"]; return <div key={tier._id} className={`mq-card mq-tier-card ${current ? "is-current" : ""}`}><div className="mq-tier-heading"><h3>{tier.name}</h3>{current ? <span className="mq-current-badge">Current</span> : null}</div><div className="mq-tier-price">${tier.monthlyPrice}<small>/mo</small></div><p>{tier.metadata?.description ?? "Marquill essentials."}</p><ul>{features.slice(0, 4).map((feature) => <li key={feature}><Check size={14} />{feature}</li>)}</ul><Link href="/pricing" className={current ? "mq-disabled-button" : "mq-primary-button"} aria-disabled={current}>{current ? "Current plan" : "View plan"}</Link></div>; }) : <div className="mq-card mq-empty">No plans available right now.</div>}</div></section>

      <section className="mq-card mq-invoice-card"><div className="mq-card-heading"><span className="mq-title">Payment history</span><span className="mq-mono">Powered by billing provider</span></div>{invoices.length ? invoices.map((invoice, index) => <div className="mq-invoice-row" key={invoice.id ?? `${invoice.date}-${index}`}><span>{invoice.date ? new Date(invoice.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}</span><span>{invoice.plan ?? planName}</span><strong>{typeof invoice.amount === "number" ? `$${(invoice.amount / 100).toFixed(2)}` : invoice.amount ?? "—"}</strong><span className="mq-status mq-status-published"><i />{invoice.status ?? "Paid"}</span><button type="button" disabled title="Receipt endpoint is not connected"><ExternalLink size={13} /> Receipt</button></div>) : <p className="mq-empty">No invoices found.</p>}</section>
      <p className="mq-missing-note">Manage payment, cancel subscription, and receipt downloads are visible in the handoff but have no matching frontend endpoint in this repository.</p>
    </RedesignShell>
  );
}
