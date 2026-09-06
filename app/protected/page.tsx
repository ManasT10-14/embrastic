"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getDashboardData, type DashboardData } from "@/lib/db";
import { formatCurrency } from "@/lib/calculations";
import { PageHeader, EmptyState, StatusBadge, ErrorBanner } from "@/components/business/ui";

function StatCard({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = (
    <div className="rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Orders" value={String(data.totalOrders)} href="/protected/orders" />
            <StatCard label="Orders Needing Attention" value={String(data.ordersNeedingAttention)} href="/protected/orders" />
            <StatCard label="Pending Production" value={String(data.pendingProduction)} href="/protected/production" />
            <StatCard label="Outstanding Amount" value={formatCurrency(data.outstandingAmount)} href="/protected/invoices" />
            <StatCard label="Sales This Month" value={formatCurrency(data.monthlySales)} href="/protected/reports" />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent Orders</h2>
              {data.recentOrders.length === 0 ? (
                <EmptyState
                  title="No orders yet"
                  description="Create your first order to see it here."
                />
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
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

            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Order Pipeline</h2>
              {Object.keys(data.pipelineByStatus).length === 0 ? (
                <EmptyState title="No orders in the pipeline" description="Orders will appear here grouped by status." />
              ) : (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
                  {Object.entries(data.pipelineByStatus).map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between text-sm">
                      <StatusBadge status={status} />
                      <span className="font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
