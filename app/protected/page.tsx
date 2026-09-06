"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, PackageX, Clock } from "lucide-react";
import { getDashboardData, type DashboardData } from "@/lib/db";
import { formatCurrency, formatDate, daysUntil } from "@/lib/calculations";
import { PageHeader, EmptyState, StatusBadge, ErrorBanner } from "@/components/business/ui";

function StatCard({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  tone?: "positive" | "negative";
}) {
  const valueColor = tone === "positive" ? "text-green-700" : tone === "negative" ? "text-red-600" : "text-slate-900";
  const content = (
    <div className="h-full rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueColor}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{content}</Link> : content;
}

function Alert({ icon, tone, children }: { icon: React.ReactNode; tone: "red" | "amber"; children: React.ReactNode }) {
  const tones = {
    red: "border-red-200 bg-red-50 text-red-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
  };
  return (
    <div className={`flex items-start gap-2 rounded-md border px-4 py-3 text-sm ${tones[tone]}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>{children}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getDashboardData()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load dashboard."));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="What's happening in your business right now." />
      <ErrorBanner message={error} />

      {!data ? (
        <p className="text-sm text-slate-500">Loading dashboard…</p>
      ) : (
        <>
          {(data.overdueInvoiceCount > 0 || data.ordersOverdue > 0 || data.lowStockItems.length > 0) && (
            <div className="space-y-2">
              {data.overdueInvoiceCount > 0 && (
                <Alert icon={<AlertTriangle className="h-4 w-4" />} tone="red">
                  <Link href="/protected/invoices" className="font-medium underline-offset-2 hover:underline">
                    {data.overdueInvoiceCount} invoice{data.overdueInvoiceCount > 1 ? "s are" : " is"} past its due date
                  </Link>{" "}
                  — {formatCurrency(data.overdueInvoiceAmount)} needs chasing.
                </Alert>
              )}
              {data.ordersOverdue > 0 && (
                <Alert icon={<Clock className="h-4 w-4" />} tone="amber">
                  <Link href="/protected/orders" className="font-medium underline-offset-2 hover:underline">
                    {data.ordersOverdue} order{data.ordersOverdue > 1 ? "s have" : " has"} passed the promised delivery date
                  </Link>{" "}
                  and isn&apos;t marked Delivered yet.
                </Alert>
              )}
              {data.lowStockItems.length > 0 && (
                <Alert icon={<PackageX className="h-4 w-4" />} tone="amber">
                  <Link href="/protected/inventory" className="font-medium underline-offset-2 hover:underline">
                    {data.lowStockItems.length} material{data.lowStockItems.length > 1 ? "s are" : " is"} out of or low on stock
                  </Link>
                  : {data.lowStockItems.slice(0, 4).map((i) => i.name).join(", ")}
                  {data.lowStockItems.length > 4 ? ` and ${data.lowStockItems.length - 4} more` : ""}.
                </Alert>
              )}
            </div>
          )}

          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Money</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Invoiced this month"
                value={formatCurrency(data.invoicedThisMonth)}
                hint="Total of invoices dated this month"
                href="/protected/reports"
              />
              <StatCard
                label="Collected this month"
                value={formatCurrency(data.collectedThisMonth)}
                hint="Payments actually received"
                tone="positive"
                href="/protected/payments"
              />
              <StatCard
                label="Expenses this month"
                value={formatCurrency(data.expensesThisMonth)}
                hint="Including GST paid"
                href="/protected/expenses"
              />
              <StatCard
                label="Outstanding"
                value={formatCurrency(data.outstandingAmount)}
                hint={`Across ${data.outstandingInvoiceCount} unpaid invoice${data.outstandingInvoiceCount === 1 ? "" : "s"}`}
                tone={data.outstandingAmount > 0 ? "negative" : undefined}
                href="/protected/invoices"
              />
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Work in hand</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Open orders" value={String(data.ordersInProgress)} hint="Not delivered or cancelled" href="/protected/orders" />
              <StatCard label="Orders past due" value={String(data.ordersOverdue)} tone={data.ordersOverdue > 0 ? "negative" : undefined} href="/protected/orders" />
              <StatCard label="Production pending" value={String(data.pendingProduction)} hint="Jobs not yet completed" href="/protected/production" />
              <StatCard label="Awaiting QC" value={String(data.pendingQC)} hint="Finished jobs not yet inspected" href="/protected/quality-control" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Next deliveries</h2>
              {data.upcomingDeliveries.length === 0 ? (
                <EmptyState title="Nothing scheduled" description="Orders with a delivery date will appear here, soonest first." />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                      <tr><th className="px-4 py-2">Order</th><th className="px-4 py-2">Customer</th><th className="px-4 py-2">Due</th><th className="px-4 py-2">Status</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.upcomingDeliveries.map((o) => {
                        const days = daysUntil(o.deliveryDate);
                        return (
                          <tr key={o.id}>
                            <td className="px-4 py-2 font-medium">{o.orderNumber}</td>
                            <td className="px-4 py-2 text-slate-600">{o.customerName || "—"}</td>
                            <td className="px-4 py-2 text-slate-600">
                              {formatDate(o.deliveryDate)}
                              {days !== null && (
                                <span className={days < 0 ? "ml-1 text-xs font-medium text-red-600" : "ml-1 text-xs text-slate-400"}>
                                  {days < 0 ? `${Math.abs(days)}d late` : days === 0 ? "today" : `in ${days}d`}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2"><StatusBadge status={o.status} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Order pipeline</h2>
              {Object.keys(data.pipelineByStatus).length === 0 ? (
                <EmptyState title="No orders in the pipeline" description="Orders will appear here grouped by status." />
              ) : (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
                  {Object.entries(data.pipelineByStatus)
                    .sort((a, b) => b[1] - a[1])
                    .map(([status, count]) => (
                      <div key={status} className="flex items-center justify-between text-sm">
                        <StatusBadge status={status} />
                        <span className="font-medium">{count}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent orders</h2>
            {data.recentOrders.length === 0 ? (
              <EmptyState title="No orders yet" description="Create your first order to see it here." />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                    <tr><th className="px-4 py-2">Order</th><th className="px-4 py-2">Customer</th><th className="px-4 py-2">Amount</th><th className="px-4 py-2">Status</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.recentOrders.map((o) => (
                      <tr key={o.id}>
                        <td className="px-4 py-2 font-medium">{o.orderNumber}</td>
                        <td className="px-4 py-2 text-slate-600">{o.customerName || "—"}</td>
                        <td className="px-4 py-2">{formatCurrency(o.amount)}</td>
                        <td className="px-4 py-2"><StatusBadge status={o.status} /></td>
                      </tr>
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
