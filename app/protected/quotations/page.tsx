"use client";

import { useEffect, useState } from "react";
import { Plus, ArrowRightCircle } from "lucide-react";
import {
  getQuotations,
  createQuotation,
  updateQuotationStatus,
  deleteQuotation,
  createOrderFromQuotation,
  getNextQuotationNumber,
  getCustomers,
  getDefaultGstPercent,
  type QuotationRow,
  type CustomerRow,
  type QuotationStatus,
} from "@/lib/db";
import { computeTotals, formatCurrency, formatDate } from "@/lib/calculations";
import { PageHeader, EmptyState, Modal, ErrorBanner, StatusBadge, inputClass, labelClass, PrimaryButton, SecondaryButton } from "@/components/business/ui";

const EMPTY_FORM = { customerId: "", product: "", quantity: "1", rate: "0", discount: "0", gstPercent: "18", validUntil: "", notes: "" };

const NEXT_STATUS: Partial<Record<QuotationStatus, QuotationStatus[]>> = {
  Draft: ["Sent"],
  Sent: ["Approved", "Rejected"],
};

export default function QuotationsPage() {
  const [quotations, setQuotations] = useState<QuotationRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [q, c] = await Promise.all([getQuotations(), getCustomers()]);
      setQuotations(q);
      setCustomers(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load quotations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function openCreate() {
    const defaultGst = await getDefaultGstPercent();
    setForm({ ...EMPTY_FORM, gstPercent: String(defaultGst) });
    setError("");
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const quantity = Number(form.quantity);
    const rate = Number(form.rate);
    const discount = Number(form.discount);
    const gstPercent = Number(form.gstPercent);

    if (!form.customerId) return setError("Select a customer.");
    if (!form.product.trim()) return setError("Product / job description is required.");
    if (!Number.isFinite(quantity) || quantity <= 0) return setError("Quantity must be a positive number.");
    if (!Number.isFinite(rate) || rate < 0) return setError("Rate must be zero or a positive number.");
    if (!Number.isFinite(discount) || discount < 0) return setError("Discount must be zero or a positive number.");
    if (!Number.isFinite(gstPercent) || gstPercent < 0) return setError("GST % must be zero or a positive number.");

    setSaving(true);
    try {
      const quoteNumber = await getNextQuotationNumber();
      await createQuotation({
        quoteNumber, customerId: form.customerId, product: form.product, quantity, rate,
        discount, gstPercent, validUntil: form.validUntil, notes: form.notes,
      });
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save quotation.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id: string, status: QuotationStatus) {
    setBusyId(id);
    try {
      await updateQuotationStatus(id, status);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update status.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleConvert(id: string) {
    if (!confirm("Convert this quotation into a new order?")) return;
    setBusyId(id);
    try {
      await createOrderFromQuotation(id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to convert quotation.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this quotation?")) return;
    try {
      await deleteQuotation(id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete quotation.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotations"
        description="Pricing proposals sent to customers, on their way to becoming orders."
        action={
          <PrimaryButton onClick={openCreate}>
            <span className="flex items-center gap-2"><Plus className="h-4 w-4" /> New Quotation</span>
          </PrimaryButton>
        }
      />

      {loading ? (
        <p className="text-sm text-slate-500">Loading quotations…</p>
      ) : quotations.length === 0 ? (
        <EmptyState
          title="No quotations yet"
          description="Create a quotation for a customer to start the sales workflow."
          action={<PrimaryButton onClick={openCreate}>Create your first quotation</PrimaryButton>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Quote #</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Valid Until</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {quotations.map((q) => {
                const totals = computeTotals([{ description: q.product, quantity: q.quantity, rate: q.rate }], q.discount, q.gstPercent);
                const nextOptions = NEXT_STATUS[q.status] ?? [];
                return (
                  <tr key={q.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{q.quoteNumber}</td>
                    <td className="px-4 py-3">{q.customerName || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{q.product}</td>
                    <td className="px-4 py-3">{formatCurrency(totals.total)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(q.validUntil)}</td>
                    <td className="px-4 py-3"><StatusBadge status={q.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {nextOptions.map((next) => (
                          <button
                            key={next}
                            disabled={busyId === q.id}
                            onClick={() => handleStatusChange(q.id, next)}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            Mark {next}
                          </button>
                        ))}
                        {q.status === "Approved" && (
                          <button
                            disabled={busyId === q.id}
                            onClick={() => handleConvert(q.id)}
                            className="flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                          >
                            <ArrowRightCircle className="h-3.5 w-3.5" /> Convert to Order
                          </button>
                        )}
                        {q.status === "Draft" && (
                          <button onClick={() => handleDelete(q.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <Modal title="New Quotation" onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={error} />
            <div>
              <label className={labelClass()}>Customer *</label>
              <select className={inputClass()} value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                <option value="">Select a customer</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass()}>Product / Job *</label>
              <input className={inputClass()} value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>Quantity</label>
                <input type="number" min="1" className={inputClass()} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Rate</label>
                <input type="number" min="0" step="0.01" className={inputClass()} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Discount</label>
                <input type="number" min="0" step="0.01" className={inputClass()} value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>GST %</label>
                <input type="number" min="0" step="0.01" className={inputClass()} value={form.gstPercent} onChange={(e) => setForm({ ...form, gstPercent: e.target.value })} />
              </div>
            </div>
            <div>
              <label className={labelClass()}>Valid Until</label>
              <input type="date" className={inputClass()} value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
            </div>
            <div>
              <label className={labelClass()}>Notes</label>
              <textarea className={inputClass()} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setModalOpen(false)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : "Save Quotation"}</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
