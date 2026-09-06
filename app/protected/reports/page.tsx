"use client";

import { useEffect, useState } from "react";
import {
  getInvoicesWithPayments, getExpenses, getOrders, getProductionJobs, invoiceBalance,
  type InvoiceRow, type ExpenseRow, type OrderRow, type ProductionJobRow,
} from "@/lib/db";
import {
  computeTotals, formatCurrency, isWithin, expenseTotal, expenseGst, round2,
} from "@/lib/calculations";
import { PageHeader, ErrorBanner, EmptyState } from "@/components/business/ui";

type Period = "this-month" | "last-month" | "this-quarter" | "this-year" | "all-time";

const PERIOD_LABELS: Record<Period, string> = {
  "this-month": "This Month",
  "last-month": "Previous Month",
  "this-quarter": "This Quarter",
  "this-year": "This Year",
  "all-time": "All Time",
};

/**
 * Ranges are built from *local* calendar boundaries and compared against dates
 * parsed as local calendar dates (see lib/calculations), so a document dated
 * the 1st of the month lands in that month regardless of timezone.
 */
function periodRange(period: Period): { start: Date; end: Date } | null {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  switch (period) {
    case "this-month":
      return { start: new Date(year, month, 1), end: new Date(year, month + 1, 1) };
    case "last-month":
      return { start: new Date(year, month - 1, 1), end: new Date(year, month, 1) };
    case "this-quarter": {
      const quarterStart = Math.floor(month / 3) * 3;
      return { start: new Date(year, quarterStart, 1), end: new Date(year, quarterStart + 3, 1) };
    }
    case "this-year":
      return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) };
    default:
      return null;
  }
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "positive" | "negative" }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-xl font-bold ${tone === "positive" ? "text-green-700" : tone === "negative" ? "text-red-600" : "text-slate-900"}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">{title}</h2>
      {children}
    </div>
  );
}

function BreakdownTable({
  columns,
  rows,
  emptyMessage,
}: {
  columns: [string, string];
  rows: Array<[string, string]>;
  emptyMessage: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">{emptyMessage}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
          <tr><th className="px-4 py-3">{columns[0]}</th><th className="px-4 py-3 text-right">{columns[1]}</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td className="px-4 py-3">{label}</td>
              <td className="px-4 py-3 text-right tabular-nums">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportsPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [production, setProduction] = useState<ProductionJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<Period>("this-month");

  useEffect(() => {
    (async () => {
      try {
        const [inv, exp, ord, prod] = await Promise.all([
          getInvoicesWithPayments(), getExpenses(), getOrders(), getProductionJobs(),
        ]);
        setInvoices(inv);
        setExpenses(exp);
        setOrders(ord);
        setProduction(prod);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load reports.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const range = periodRange(period);
  const periodWord = period === "all-time" ? "all time" : PERIOD_LABELS[period].toLowerCase();

  // Total outstanding is always all-time: subtracting payments-in-period from
  // invoices-in-period would mix two different date fields and misstate what
  // is actually owed right now.
  const totalOutstanding = invoices.reduce((sum, inv) => sum + invoiceBalance(inv).balance, 0);

  let invoicedInPeriod = 0;
  let gstCollected = 0;
  let invoiceCount = 0;
  const revenueByCustomer = new Map<string, number>();
  for (const inv of invoices) {
    if (!isWithin(inv.invoiceDate, range)) continue;
    const totals = computeTotals(inv.items, inv.discount, inv.gstPercent);
    invoicedInPeriod += totals.total;
    gstCollected += totals.gstAmount;
    invoiceCount += 1;
    const key = inv.customer || "Unnamed customer";
    revenueByCustomer.set(key, (revenueByCustomer.get(key) ?? 0) + totals.total);
  }

  let collectedInPeriod = 0;
  for (const inv of invoices) {
    for (const payment of inv.payments) {
      if (isWithin(payment.date, range)) collectedInPeriod += payment.amount;
    }
  }

  const expensesInPeriod = expenses.filter((e) => isWithin(e.date, range));
  const expenseGrossTotal = expensesInPeriod.reduce((sum, e) => sum + expenseTotal(e), 0);
  const gstOnExpenses = expensesInPeriod.reduce((sum, e) => sum + expenseGst(e), 0);
  const cashProfit = collectedInPeriod - expenseGrossTotal;
  const netGst = gstCollected - gstOnExpenses;

  const ordersInPeriod = orders.filter((o) => isWithin(o.createdAt.slice(0, 10), range));
  const orderValue = ordersInPeriod.reduce((sum, o) => sum + o.amount, 0);
  const productionInPeriod = production.filter((p) => isWithin(p.createdAt.slice(0, 10), range));
  const piecesCompleted = productionInPeriod.reduce((sum, p) => sum + p.quantityCompleted, 0);
  const piecesRejected = productionInPeriod.reduce((sum, p) => sum + p.quantityRejected, 0);
  const piecesHandled = piecesCompleted + piecesRejected + productionInPeriod.reduce((sum, p) => sum + p.quantityRework, 0);
  const rejectRate = piecesHandled > 0 ? round2((piecesRejected / piecesHandled) * 100) : 0;

  const expensesByCategory = new Map<string, number>();
  for (const e of expensesInPeriod) {
    const key = e.category || "Uncategorized";
    expensesByCategory.set(key, (expensesByCategory.get(key) ?? 0) + expenseTotal(e));
  }

  const ordersByStatus = new Map<string, number>();
  for (const o of ordersInPeriod) ordersByStatus.set(o.status, (ordersByStatus.get(o.status) ?? 0) + 1);

  const hasAnyData = invoices.length > 0 || expenses.length > 0 || orders.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Financial and operational performance, aggregated from real business data." />

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <div className="flex flex-wrap gap-1 rounded-md bg-slate-100 p-1 text-sm">
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`rounded px-3 py-1.5 ${period === p ? "bg-white shadow-sm font-medium" : "text-slate-500 hover:text-slate-700"}`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading reports…</p>
      ) : !hasAnyData ? (
        <EmptyState
          title="Nothing to report yet"
          description="Once you raise invoices, record payments and log expenses, this page summarises them by period."
        />
      ) : (
        <>
          <Section title="Money">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={`Invoiced (${periodWord})`} value={formatCurrency(invoicedInPeriod)} hint={`${invoiceCount} invoice${invoiceCount === 1 ? "" : "s"} dated in period`} />
              <Stat label={`Collected (${periodWord})`} value={formatCurrency(collectedInPeriod)} hint="Payments actually received" tone="positive" />
              <Stat label={`Expenses (${periodWord})`} value={formatCurrency(expenseGrossTotal)} hint="Including GST paid" />
              <Stat
                label={`Cash profit (${periodWord})`}
                value={formatCurrency(cashProfit)}
                hint="Collected minus expenses paid"
                tone={cashProfit >= 0 ? "positive" : "negative"}
              />
              <Stat
                label="Total outstanding (all time)"
                value={formatCurrency(totalOutstanding)}
                hint="What customers still owe, right now"
                tone={totalOutstanding > 0 ? "negative" : undefined}
              />
              <Stat label={`GST collected (${periodWord})`} value={formatCurrency(gstCollected)} hint="On invoices raised" />
              <Stat label={`GST paid on expenses (${periodWord})`} value={formatCurrency(gstOnExpenses)} hint="Potential input credit" />
              <Stat
                label={`Net GST position (${periodWord})`}
                value={formatCurrency(netGst)}
                hint={netGst >= 0 ? "Payable to the department" : "Credit in your favour"}
              />
            </div>
          </Section>

          <Section title="Operations">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={`Orders taken (${periodWord})`} value={String(ordersInPeriod.length)} />
              <Stat label={`Order value (${periodWord})`} value={formatCurrency(orderValue)} hint="Agreed value of those orders" />
              <Stat label={`Pieces completed (${periodWord})`} value={String(piecesCompleted)} hint="Across production jobs started in period" />
              <Stat
                label="Reject rate"
                value={piecesHandled > 0 ? `${rejectRate}%` : "—"}
                hint={piecesHandled > 0 ? `${piecesRejected} of ${piecesHandled} pieces` : "No production recorded in period"}
                tone={rejectRate > 5 ? "negative" : undefined}
              />
            </div>
          </Section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Section title="Expenses by category">
              <BreakdownTable
                columns={["Category", "Amount (incl. GST)"]}
                rows={Array.from(expensesByCategory.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([category, amount]) => [category, formatCurrency(amount)])}
                emptyMessage="No expenses recorded in this period."
              />
            </Section>

            <Section title="Top customers by invoiced value">
              <BreakdownTable
                columns={["Customer", "Invoiced"]}
                rows={Array.from(revenueByCustomer.entries())
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 10)
                  .map(([customer, amount]) => [customer, formatCurrency(amount)])}
                emptyMessage="No invoices raised in this period."
              />
            </Section>
          </div>

          <Section title="Orders taken by status">
            <BreakdownTable
              columns={["Status", "Orders"]}
              rows={Array.from(ordersByStatus.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => [status, String(count)])}
              emptyMessage="No orders taken in this period."
            />
          </Section>
        </>
      )}
    </div>
  );
}
