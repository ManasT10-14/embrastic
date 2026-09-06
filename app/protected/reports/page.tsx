"use client";

import { useEffect, useState } from "react";
import { getInvoicesWithPayments, getExpenses, type InvoiceRow, type ExpenseRow } from "@/lib/db";
import { computeTotals, formatCurrency } from "@/lib/calculations";
import { PageHeader, ErrorBanner } from "@/components/business/ui";

type Period = "this-month" | "last-month" | "all-time";

function periodRange(period: Period): { start: Date; end: Date } | null {
  const now = new Date();
  if (period === "this-month") return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
  if (period === "last-month") return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 1) };
  return null;
}

function inRange(dateStr: string, range: { start: Date; end: Date } | null): boolean {
  if (!range) return true;
  const date = new Date(dateStr);
  return date >= range.start && date < range.end;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-xl font-bold ${tone === "positive" ? "text-green-700" : tone === "negative" ? "text-red-600" : ""}`}>{value}</p>
    </div>
  );
}

export default function ReportsPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<Period>("this-month");

  useEffect(() => {
    (async () => {
      try {
        const [inv, exp] = await Promise.all([getInvoicesWithPayments(), getExpenses()]);
        setInvoices(inv);
        setExpenses(exp);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load reports.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const range = periodRange(period);

  // Total outstanding is always all-time — a period-scoped subtraction of
  // invoiced-in-period minus paid-in-period would mix two different date
  // fields and misstate what's actually owed right now.
  const totalOutstanding = invoices.reduce((sum, inv) => {
    const totals = computeTotals(inv.items, inv.discount, inv.gstPercent);
    const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
    return sum + Math.max(0, totals.total - paid);
  }, 0);

  let invoicedThisPeriod = 0;
  let gstCollected = 0;
  for (const inv of invoices) {
    if (!inRange(inv.invoiceDate, range)) continue;
    const totals = computeTotals(inv.items, inv.discount, inv.gstPercent);
    invoicedThisPeriod += totals.total;
    gstCollected += totals.gstAmount;
  }

  let collectedThisPeriod = 0;
  for (const inv of invoices) {
    for (const payment of inv.payments) {
      if (inRange(payment.date, range)) collectedThisPeriod += payment.amount;
    }
  }

  const expensesThisPeriod = expenses.filter((e) => inRange(e.date, range));
  const expenseTotal = expensesThisPeriod.reduce((sum, e) => sum + e.amount, 0);
  const gstOnExpenses = expensesThisPeriod.reduce((sum, e) => sum + (e.amount * e.gstPercent) / 100, 0);
  const estimatedProfit = collectedThisPeriod - expenseTotal;

  const byCategory = new Map<string, number>();
  for (const e of expensesThisPeriod) byCategory.set(e.category || "Uncategorized", (byCategory.get(e.category || "Uncategorized") ?? 0) + e.amount);

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Financial and operational performance, aggregated from real business data." />

      <ErrorBanner message={error} />

      <div className="flex gap-2 rounded-md bg-slate-100 p-1 text-sm w-fit">
        {(["this-month", "last-month", "all-time"] as Period[]).map((p) => (
          <button key={p} onClick={() => setPeriod(p)} className={`rounded px-3 py-1.5 ${period === p ? "bg-white shadow-sm" : "text-slate-500"}`}>
            {p === "this-month" ? "This Month" : p === "last-month" ? "Previous Month" : "All Time"}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading reports…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={`Invoiced (${period === "all-time" ? "all time" : "period"})`} value={formatCurrency(invoicedThisPeriod)} />
            <Stat label="Collected (period)" value={formatCurrency(collectedThisPeriod)} tone="positive" />
            <Stat label="Total Outstanding (all-time)" value={formatCurrency(totalOutstanding)} tone="negative" />
            <Stat label="Expenses (period)" value={formatCurrency(expenseTotal)} />
            <Stat label="GST Collected (period)" value={formatCurrency(gstCollected)} />
            <Stat label="GST Paid on Expenses (period)" value={formatCurrency(gstOnExpenses)} />
            <Stat label="Estimated Profit (period, cash basis)" value={formatCurrency(estimatedProfit)} tone={estimatedProfit >= 0 ? "positive" : "negative"} />
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Expenses by Category</h2>
            {byCategory.size === 0 ? (
              <p className="text-sm text-slate-500">No expenses recorded in this period.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                    <tr><th className="px-4 py-3">Category</th><th className="px-4 py-3">Amount</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]).map(([category, amount]) => (
                      <tr key={category}><td className="px-4 py-3">{category}</td><td className="px-4 py-3">{formatCurrency(amount)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
