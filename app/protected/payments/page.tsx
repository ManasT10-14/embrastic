"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { getInvoicesWithPayments, createPayment, deletePayment, invoiceBalance, type InvoiceRow } from "@/lib/db";
import { formatCurrency, formatDate, todayISO } from "@/lib/calculations";
import {
  PageHeader, EmptyState, Modal, ErrorBanner, SuccessBanner, SearchInput,
  FilterSelect, Toolbar, RowAction, inputClass, labelClass, PrimaryButton, SecondaryButton,
} from "@/components/business/ui";

const METHODS = ["Cash", "UPI", "Bank Transfer", "Card", "Cheque", "Other"];

type PaymentEntry = InvoiceRow["payments"][number] & { invoiceCustomer: string };

function emptyForm() {
  return { invoiceId: "", date: todayISO(), amount: "", method: "Cash", reference: "", notes: "" };
}

export default function PaymentsPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState("");

  async function load() {
    setLoading(true);
    try {
      setInvoices(await getInvoicesWithPayments());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payments.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Arriving from an invoice row ("Payment" action).
  useEffect(() => {
    const invoiceId = new URLSearchParams(window.location.search).get("invoice");
    if (!invoiceId) return;
    window.history.replaceState(null, "", "/protected/payments");
    setForm({ ...emptyForm(), invoiceId });
    setFormError("");
    setModalOpen(true);
  }, []);

  const outstanding = invoices
    .map((invoice) => ({ invoice, ...invoiceBalance(invoice) }))
    .filter((x) => x.balance > 0.01);

  const allPayments: PaymentEntry[] = invoices
    .flatMap((inv) => inv.payments.map((p) => ({ ...p, invoiceCustomer: inv.customer })))
    .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));

  const selectedInvoice = invoices.find((inv) => inv.id === form.invoiceId);
  const selectedBalance = selectedInvoice ? invoiceBalance(selectedInvoice).balance : 0;

  function openCreate() {
    setForm(emptyForm());
    setFormError("");
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    const amount = Number(form.amount);
    if (!form.invoiceId) return setFormError("Select an invoice.");
    if (!form.date) return setFormError("Enter the date the money was received.");
    if (!Number.isFinite(amount) || amount <= 0) return setFormError("Amount must be a positive number.");
    if (amount > selectedBalance + 0.01) {
      return setFormError(`That's more than the ${formatCurrency(selectedBalance)} still outstanding on this invoice.`);
    }

    setSaving(true);
    try {
      await createPayment({
        invoiceId: form.invoiceId, invoiceNumber: selectedInvoice?.invoiceNumber ?? "",
        date: form.date, amount, method: form.method, reference: form.reference, notes: form.notes,
      });
      const remaining = selectedBalance - amount;
      setNotice(
        remaining <= 0.01
          ? `${formatCurrency(amount)} recorded — ${selectedInvoice?.invoiceNumber} is now fully paid.`
          : `${formatCurrency(amount)} recorded — ${formatCurrency(remaining)} still outstanding on ${selectedInvoice?.invoiceNumber}.`,
      );
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to record payment.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(payment: PaymentEntry) {
    if (!confirm(`Delete this ${formatCurrency(payment.amount)} payment? ${payment.invoiceNumber}'s balance will go back up.`)) return;
    setError("");
    try {
      await deletePayment(payment.id);
      setNotice(`Payment of ${formatCurrency(payment.amount)} removed from ${payment.invoiceNumber}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete payment.");
    }
  }

  const filtered = allPayments.filter((p) => {
    if (methodFilter && p.method !== methodFilter) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      p.invoiceNumber.toLowerCase().includes(term) ||
      p.invoiceCustomer.toLowerCase().includes(term) ||
      p.reference.toLowerCase().includes(term)
    );
  });

  const totalReceived = allPayments.reduce((sum, p) => sum + p.amount, 0);
  const totalOutstanding = outstanding.reduce((sum, x) => sum + x.balance, 0);

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

      <ErrorBanner message={error} onDismiss={() => setError("")} />
      <SuccessBanner message={notice} onDismiss={() => setNotice("")} />

      {!loading && invoices.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Total received (all time)</p>
            <p className="text-xl font-bold text-green-700">{formatCurrency(totalReceived)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Still outstanding</p>
            <p className={`text-xl font-bold ${totalOutstanding > 0 ? "text-red-600" : ""}`}>{formatCurrency(totalOutstanding)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Invoices awaiting payment</p>
            <p className="text-xl font-bold">{outstanding.length}</p>
          </div>
        </div>
      )}

      {allPayments.length > 0 && (
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search invoice, customer or reference" />
          <FilterSelect value={methodFilter} onChange={setMethodFilter} options={METHODS} allLabel="All methods" />
          <span className="text-xs text-slate-500">{filtered.length} of {allPayments.length}</span>
        </Toolbar>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading payments…</p>
      ) : allPayments.length === 0 ? (
        <EmptyState
          title="No payments yet"
          description={
            outstanding.length > 0
              ? `${outstanding.length} invoice${outstanding.length > 1 ? "s are" : " is"} waiting to be paid.`
              : "Raise an invoice first, then record payments against it here."
          }
          action={outstanding.length > 0 ? <PrimaryButton onClick={openCreate}>Record your first payment</PrimaryButton> : undefined}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching payments" description="Try a different search term or method filter." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{p.invoiceNumber || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{p.invoiceCustomer}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(p.date)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(p.amount)}</td>
                  <td className="px-4 py-3 text-slate-600">{p.method}</td>
                  <td className="px-4 py-3 text-slate-600">{p.reference || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <RowAction tone="danger" onClick={() => handleDelete(p)}><Trash2 className="h-3.5 w-3.5" /> Delete</RowAction>
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
            <ErrorBanner message={formError} />
            <div>
              <label className={labelClass()}>Invoice *</label>
              <select className={inputClass()} value={form.invoiceId} onChange={(e) => setForm({ ...form, invoiceId: e.target.value })}>
                <option value="">Select an invoice with an outstanding balance</option>
                {outstanding.map(({ invoice, balance }) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoice.invoiceNumber} — {invoice.customer} (balance {formatCurrency(balance)})
                  </option>
                ))}
              </select>
              {outstanding.length === 0 && <p className="mt-1 text-xs text-slate-500">No invoices currently have an outstanding balance.</p>}
            </div>

            {selectedInvoice && (
              <div className="rounded-md bg-slate-50 px-4 py-3 text-sm">
                <div className="flex justify-between"><span>Invoice total</span><span className="tabular-nums">{formatCurrency(invoiceBalance(selectedInvoice).total)}</span></div>
                <div className="flex justify-between"><span>Already paid</span><span className="tabular-nums">{formatCurrency(invoiceBalance(selectedInvoice).paid)}</span></div>
                <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-semibold">
                  <span>Outstanding</span><span className="tabular-nums">{formatCurrency(selectedBalance)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, amount: String(selectedBalance.toFixed(2)) })}
                  className="mt-2 text-xs font-medium text-blue-600 hover:underline"
                >
                  Pay the full balance
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>Date *</label>
                <input
                  type="date"
                  className={inputClass()}
                  value={form.date}
                  min={selectedInvoice?.invoiceDate || undefined}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass()}>Amount *</label>
                <input
                  type="number" min="0.01" step="0.01" max={selectedBalance || undefined}
                  className={inputClass()} value={form.amount} placeholder="0.00"
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
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
              <PrimaryButton type="submit" disabled={saving || outstanding.length === 0}>{saving ? "Saving…" : "Record Payment"}</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
