import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";

GlobalRegistrator.register();

const { default: InvoiceHistory, formatInvoiceAmount } = await import("./InvoiceHistory");
type Invoice = import("./InvoiceHistory").Invoice;

afterEach(cleanup);
afterAll(async () => {
  // React flushes passive effects on a later tick, and that work needs `window`.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await GlobalRegistrator.unregister();
});

const invoice: Invoice = {
  id: "txn_1",
  date: "2026-10-15T12:00:00.000Z",
  plan: "Pro",
  amount: "2900",
  currency: "USD",
  status: "completed",
  invoiceAvailable: true,
};

describe("formatInvoiceAmount", () => {
  test("converts lowest units to the currency's major unit", () => {
    expect(formatInvoiceAmount("2900", "USD")).toContain("29.00");
  });

  test("does not divide currencies that have no minor unit", () => {
    expect(formatInvoiceAmount("1200", "JPY")).toContain("1,200");
  });

  test("shows a dash when the amount is missing", () => {
    expect(formatInvoiceAmount(null, "USD")).toBe("—");
  });
});

describe("InvoiceHistory", () => {
  test("shows a customer-facing status label", () => {
    const view = render(<InvoiceHistory invoices={[{ ...invoice, status: "past_due" }]} loadFailed={false} onDownload={mock()} />);
    expect(view.getByText("Past due")).toBeTruthy();
  });

  test("downloads the invoice for the clicked row", async () => {
    const onDownload = mock(() => Promise.resolve());
    const view = render(<InvoiceHistory invoices={[invoice]} loadFailed={false} onDownload={onDownload} />);

    fireEvent.click(view.getByRole("button", { name: /download invoice/i }));

    await waitFor(() => expect(onDownload).toHaveBeenCalledWith("txn_1"));
  });

  test("offers no download when the transaction has no invoice", () => {
    const view = render(<InvoiceHistory invoices={[{ ...invoice, invoiceAvailable: false }]} loadFailed={false} onDownload={mock()} />);
    expect(view.queryByRole("button")).toBeNull();
  });

  test("tells the user when a download fails", async () => {
    const onDownload = mock(() => Promise.reject(new Error("503")));
    const view = render(<InvoiceHistory invoices={[invoice]} loadFailed={false} onDownload={onDownload} />);

    fireEvent.click(view.getByRole("button", { name: /download invoice/i }));

    expect(await view.findByRole("alert")).toBeTruthy();
  });

  test("does not claim there are no invoices when loading failed", () => {
    const view = render(<InvoiceHistory invoices={[]} loadFailed onDownload={mock()} />);
    expect(view.queryByText("No invoices found.")).toBeNull();
    expect(view.getByRole("alert")).toBeTruthy();
  });

  test("says so when there are no invoices", () => {
    const view = render(<InvoiceHistory invoices={[]} loadFailed={false} onDownload={mock()} />);
    expect(view.getByText("No invoices found.")).toBeTruthy();
  });
});
