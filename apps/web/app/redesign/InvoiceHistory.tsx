"use client";

import { useState } from "react";
import { Download } from "lucide-react";

export type Invoice = {
  id: string;
  date: string;
  plan: string | null;
  amount: string | null;
  currency: string;
  status: string;
  invoiceAvailable: boolean;
};

const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "CLP"]);

const STATUS_DISPLAY: Record<string, { label: string; className: string }> = {
  completed: { label: "Paid", className: "mq-status-published" },
  paid: { label: "Paid", className: "mq-status-published" },
  billed: { label: "Billed", className: "mq-status-scheduled" },
  past_due: { label: "Past due", className: "mq-status-expired" },
  canceled: { label: "Canceled", className: "mq-status-inactive" },
};

/** Paddle sends amounts as strings in the currency's lowest unit. */
export function formatInvoiceAmount(amount: string | null, currency: string): string {
  if (amount === null) return "—";
  const decimalPlaces = ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    parseFloat(amount) / 10 ** decimalPlaces,
  );
}

function formatInvoiceDate(date: string): string {
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function InvoiceHistory({
  invoices,
  loadFailed,
  onDownload,
}: {
  invoices: Invoice[];
  loadFailed: boolean;
  onDownload: (transactionId: string) => Promise<void>;
}) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadFailed, setDownloadFailed] = useState(false);

  const download = async (transactionId: string) => {
    setDownloadingId(transactionId);
    setDownloadFailed(false);
    try {
      await onDownload(transactionId);
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <section className="mq-card mq-invoice-card">
      <div className="mq-card-heading">
        <span className="mq-title">Payment history</span>
        <span className="mq-mono">Powered by Paddle</span>
      </div>
      {invoices.map((invoice) => {
        const date = formatInvoiceDate(invoice.date);
        const status = STATUS_DISPLAY[invoice.status] ?? { label: invoice.status, className: "mq-status-inactive" };
        return (
          <div className="mq-invoice-row" key={invoice.id}>
            <span>{date}</span>
            <span>{invoice.plan ?? "—"}</span>
            <strong>{formatInvoiceAmount(invoice.amount, invoice.currency)}</strong>
            <span className={`mq-status ${status.className}`}><i />{status.label}</span>
            {invoice.invoiceAvailable ? (
              <button
                type="button"
                aria-label={`Download invoice from ${date}`}
                disabled={downloadingId !== null}
                onClick={() => void download(invoice.id)}
              >
                <Download size={13} /> Invoice
              </button>
            ) : <span />}
          </div>
        );
      })}
      {loadFailed ? <p className="mq-empty" role="alert">We couldn&apos;t load your payment history. Refresh the page to try again.</p> : null}
      {!loadFailed && invoices.length === 0 ? <p className="mq-empty">No invoices found.</p> : null}
      {downloadFailed ? <p className="mq-empty" role="alert">We couldn&apos;t get that invoice. Try again in a moment.</p> : null}
    </section>
  );
}
