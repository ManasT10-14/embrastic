"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { getInvoicesWithPayments, createPayment, deletePayment, type InvoiceRow } from "@/lib/db";
import { computeTotals, formatCurrency, formatDate } from "@/lib/calculations";
import { PageHeader, EmptyState, Modal, ErrorBanner, inputClass, labelClass, PrimaryButton, SecondaryButton } from "@/components/business/ui";

const METHODS = ["Cash", "UPI", "Bank Transfer", "Card", "Other"];

type PaymentEntry = InvoiceRow["payments"][number] & { invoiceCustomer: string };

export default function PaymentsPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ invoiceId: "", date: new Date().toISOString().slice(0, 10), amount: "0", method: "Cash", reference: "", notes: "" });

  async function load() {
    setLoading(true);
    try {
      setInvoices(await getInvoicesWithPayments());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payments.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const outstandingInvoices = invoices
    .map((inv) => {
      const totals = computeTotals(inv.items, inv.discount, inv.gstPercent);
      const paid = inv.payments.reduce((sum, p) => sum + p.amount, 0);
      return { invoice: inv, balance: Math.max(0, totals.total - paid) };
    })
    .filter((x) => x.balance > 0.01);

  const allPayments: PaymentEntry[] = invoices
    .flatMap((inv) => inv.payments.map((p) => ({ ...p, invoiceCustomer: inv.customer })))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const selectedInvoice = invoices.find((inv) => inv.id === form.invoiceId);
  const selectedBalance = selectedInvoice
    ? Math.max(0, computeTotals(selectedInvoice.items, selectedInvoice.discount, selectedInvoice.gstPercent).total - selectedInvoice.payments.reduce((s, p) => s + p.amount, 0))
    : 0;

  function openCreate() {
    setForm({ invoiceId: "", date: new Date().toISOString().slice(0, 10), amount: "0", method: "Cash", reference: "", notes: "" });
    setError("");
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const amount = Number(form.amount);
    if (!form.invoiceId) return setError("Select an invoice.");
    if (!Number.isFinite(amount) || amount <= 0) return setError("Amount must be a positive number.");
    if (amount > selectedBalance + 0.01) return setError(`Amount cannot exceed the outstanding balance of ${formatCurrency(selectedBalance)}.`);

    setSaving(true);
    try {
      await createPayment({
        invoiceId: form.invoiceId, invoiceNumber: selectedInvoice?.invoiceNumber ?? "",
        date: form.date, amount, method: form.method, reference: form.reference, notes: form.notes,
      });
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this payment? The invoice balance will increase again.")) return;
    try {
      await deletePayment(id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete payment.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Money received from customers against invoices."
        action={
          <PrimaryButton onClick={openCreate}>
            <span className="flex items-center gap-2"><Plus className="h-4 w-4" /> Record Payment</span>
          </PrimaryButton>
        }
      />

      {loading ? (
        <p className="text-sm text-slate-500">Loading payments…</p>
      ) : allPayments.length === 0 ? (
        <EmptyState
          title="No payments yet"
          description="Record a payment against an outstanding invoice."
          action={<PrimaryButton onClick={openCreate}>Record your first payment</PrimaryButton>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {allPayments.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{p.invoiceNumber}</td>
                  <td className="px-4 py-3 text-slate-600">{p.invoiceCustomer}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(p.date)}</td>
                  <td className="px-4 py-3">{formatCurrency(p.amount)}</td>
                  <td className="px-4 py-3 text-slate-600">{p.method}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDelete(p.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <Modal title="Record Payment" onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={error} />
            <div>
              <label className={labelClass()}>Invoice *</label>
              <select className={inputClass()} value={form.invoiceId} onChange={(e) => setForm({ ...form, invoiceId: e.target.value })}>
                <option value="">Select an invoice with an outstanding balance</option>
                {outstandingInvoices.map(({ invoice, balance }) => (
                  <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} — {invoice.customer} (Balance {formatCurrency(balance)})</option>
                ))}
              </select>
              {outstandingInvoices.length === 0 && <p className="mt-1 text-xs text-slate-500">No invoices currently have an outstanding balance.</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>Date</label>
                <input type="date" className={inputClass()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Amount *</label>
                <input type="number" min="0" step="0.01" max={selectedBalance || undefined} className={inputClass()} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
            </div>
            <div>
              <label className={labelClass()}>Method</label>
              <select className={inputClass()} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass()}>Reference</label>
              <input className={inputClass()} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Transaction ID, cheque number, etc." />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setModalOpen(false)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : "Record Payment"}</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
