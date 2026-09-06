"use client";

import { useEffect, useState } from "react";
import { Plus, ArrowRightCircle, Pencil, Trash2 } from "lucide-react";
import {
  getQuotations,
  createQuotation,
  updateQuotation,
  updateQuotationStatus,
  deleteQuotation,
  createOrderFromQuotation,
  allowedQuotationTransitions,
  getNextQuotationNumber,
  getCustomers,
  getDefaultGstPercent,
  type QuotationRow,
  type CustomerRow,
  type QuotationStatus,
} from "@/lib/db";
import { documentTotals, formatCurrency, formatDate, isOverdue } from "@/lib/calculations";
import {
  PageHeader, EmptyState, Modal, ErrorBanner, SuccessBanner, StatusBadge, SearchInput,
  FilterSelect, Toolbar, RowAction, inputClass, labelClass, PrimaryButton, SecondaryButton,
} from "@/components/business/ui";

const STATUSES: QuotationStatus[] = ["Draft", "Sent", "Approved", "Rejected", "Converted"];
const EMPTY_FORM = { customerId: "", product: "", quantity: "1", rate: "0", discount: "0", gstPercent: "18", validUntil: "", notes: "" };

export default function QuotationsPage() {
  const [quotations, setQuotations] = useState<QuotationRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [q, c] = await Promise.all([getQuotations(), getCustomers()]);
      setQuotations(q);
      setCustomers(c);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load quotations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Arriving from a customer row ("Quote" action) opens a prefilled form,
  // so the owner doesn't have to find the customer again in the dropdown.
  useEffect(() => {
    const customerId = new URLSearchParams(window.location.search).get("customer");
    if (!customerId) return;
    window.history.replaceState(null, "", "/protected/quotations");
    (async () => {
      const defaultGst = await getDefaultGstPercent();
      setEditingId(null);
      setForm({ ...EMPTY_FORM, customerId, gstPercent: String(defaultGst) });
      setFormError("");
      setModalOpen(true);
    })();
  }, []);

  async function openCreate() {
    const defaultGst = await getDefaultGstPercent();
    setEditingId(null);
    setForm({ ...EMPTY_FORM, gstPercent: String(defaultGst) });
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(quotation: QuotationRow) {
    setEditingId(quotation.id);
    setForm({
      customerId: quotation.customerId,
      product: quotation.product,
      quantity: String(quotation.quantity),
      rate: String(quotation.rate),
      discount: String(quotation.discount),
      gstPercent: String(quotation.gstPercent),
      validUntil: quotation.validUntil,
      notes: quotation.notes,
    });
    setFormError("");
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    const quantity = Number(form.quantity);
    const rate = Number(form.rate);
    const discount = Number(form.discount);
    const gstPercent = Number(form.gstPercent);

    if (!form.customerId) return setFormError("Select a customer.");
    if (!form.product.trim()) return setFormError("Product / job description is required.");
    if (!Number.isInteger(quantity) || quantity <= 0) return setFormError("Quantity must be a whole number greater than zero.");
    if (!Number.isFinite(rate) || rate < 0) return setFormError("Rate must be zero or a positive number.");
    if (!Number.isFinite(discount) || discount < 0) return setFormError("Discount must be zero or a positive number.");
    if (discount > quantity * rate) return setFormError("The discount is larger than the quotation itself.");
    if (!Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 100) return setFormError("GST % must be between 0 and 100.");

    setSaving(true);
    try {
      const payload = {
        customerId: form.customerId, product: form.product.trim(), quantity, rate,
        discount, gstPercent, validUntil: form.validUntil, notes: form.notes,
      };
      if (editingId) {
        await updateQuotation(editingId, payload);
        setNotice("Quotation updated.");
      } else {
        const quoteNumber = await getNextQuotationNumber();
        await createQuotation({ ...payload, quoteNumber });
        setNotice(`Quotation ${quoteNumber} created as a Draft.`);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save quotation.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id: string, status: QuotationStatus) {
    setBusyId(id);
    setError("");
    try {
      await updateQuotationStatus(id, status);
      setNotice(`Quotation marked ${status}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleConvert(quotation: QuotationRow) {
    if (!confirm(`Convert ${quotation.quoteNumber} into a new order? The approved price, quantity, discount and GST all carry across.`)) return;
    setBusyId(quotation.id);
    setError("");
    try {
      const order = await createOrderFromQuotation(quotation.id);
      setNotice(`Order ${order.orderNumber} created from ${quotation.quoteNumber}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to convert quotation.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(quotation: QuotationRow) {
    if (!confirm(`Delete quotation ${quotation.quoteNumber}?`)) return;
    setError("");
    try {
      await deleteQuotation(quotation.id);
      setNotice(`Quotation ${quotation.quoteNumber} deleted.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete quotation.");
    }
  }

  const filtered = quotations.filter((q) => {
    if (statusFilter && q.status !== statusFilter) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      q.quoteNumber.toLowerCase().includes(term) ||
      q.customerName.toLowerCase().includes(term) ||
      q.product.toLowerCase().includes(term)
    );
  });

  const preview = documentTotals(
    Number(form.quantity) || 0, Number(form.rate) || 0,
    Number(form.discount) || 0, Number(form.gstPercent) || 0,
  );

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

      <ErrorBanner message={error} onDismiss={() => setError("")} />
      <SuccessBanner message={notice} onDismiss={() => setNotice("")} />

      {quotations.length > 0 && (
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search quote number, customer or product" />
          <FilterSelect value={statusFilter} onChange={setStatusFilter} options={STATUSES} allLabel="All statuses" />
          <span className="text-xs text-slate-500">{filtered.length} of {quotations.length}</span>
        </Toolbar>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading quotations…</p>
      ) : quotations.length === 0 ? (
        <EmptyState
          title="No quotations yet"
          description="Create a quotation for a customer to start the sales workflow."
          action={<PrimaryButton onClick={openCreate}>Create your first quotation</PrimaryButton>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching quotations" description="Try a different search term or status filter." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Quote #</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Valid Until</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((q) => {
                const totals = documentTotals(q.quantity, q.rate, q.discount, q.gstPercent);
                const nextOptions = allowedQuotationTransitions(q.status);
                const expired = q.validUntil && isOverdue(q.validUntil) && q.status !== "Converted";
                return (
                  <tr key={q.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{q.quoteNumber}</td>
                    <td className="px-4 py-3">{q.customerName || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{q.product} × {q.quantity}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(totals.total)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(q.validUntil)}
                      {expired && <span className="ml-1 text-xs font-medium text-red-600">expired</span>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={q.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                        {nextOptions.map((next) => (
                          <RowAction key={next} disabled={busyId === q.id} onClick={() => handleStatusChange(q.id, next)}>
                            Mark {next}
                          </RowAction>
                        ))}
                        {q.status === "Approved" && (
                          <RowAction tone="primary" disabled={busyId === q.id} onClick={() => handleConvert(q)}>
                            <ArrowRightCircle className="h-3.5 w-3.5" /> Convert to Order
                          </RowAction>
                        )}
                        {q.status === "Draft" && (
                          <RowAction onClick={() => openEdit(q)}><Pencil className="h-3.5 w-3.5" /> Edit</RowAction>
                        )}
                        {q.status !== "Converted" && (
                          <RowAction tone="danger" onClick={() => handleDelete(q)}><Trash2 className="h-3.5 w-3.5" /> Delete</RowAction>
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
        <Modal title={editingId ? "Edit Quotation" : "New Quotation"} onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={formError} />
            <div>
              <label className={labelClass()}>Customer *</label>
              <select className={inputClass()} value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                <option value="">Select a customer</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {customers.length === 0 && (
                <p className="mt-1 text-xs text-amber-700">Add a customer first — a quotation always belongs to one.</p>
              )}
            </div>
            <div>
              <label className={labelClass()}>Product / Job *</label>
              <input className={inputClass()} value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} placeholder="e.g. Polo shirts with left-chest logo" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>Quantity *</label>
                <input type="number" min="1" step="1" className={inputClass()} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Rate (per piece) *</label>
                <input type="number" min="0" step="0.01" className={inputClass()} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Discount (amount)</label>
                <input type="number" min="0" step="0.01" className={inputClass()} value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>GST %</label>
                <input type="number" min="0" max="100" step="0.01" className={inputClass()} value={form.gstPercent} onChange={(e) => setForm({ ...form, gstPercent: e.target.value })} />
              </div>
            </div>

            <div className="rounded-md bg-slate-50 px-4 py-3 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{formatCurrency(preview.subtotal)}</span></div>
              <div className="flex justify-between"><span>Discount</span><span className="tabular-nums">-{formatCurrency(preview.discount)}</span></div>
              <div className="flex justify-between"><span>GST ({Number(form.gstPercent) || 0}%)</span><span className="tabular-nums">{formatCurrency(preview.gstAmount)}</span></div>
              <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-semibold"><span>Total</span><span className="tabular-nums">{formatCurrency(preview.total)}</span></div>
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
              <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Save Changes" : "Save Quotation"}</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
