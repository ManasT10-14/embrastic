"use client";

import { useEffect, useState } from "react";
import { Plus, Printer, Trash2 } from "lucide-react";
import {
  getInvoicesWithPayments, createInvoice, deleteInvoice, getNextInvoiceNumber,
  getCustomers, getOrders, getAllSettings, getDefaultGstPercent,
  type InvoiceRow, type CustomerRow, type OrderRow, type InvoiceItem,
} from "@/lib/db";
import { computeTotals, invoiceStatus, formatCurrency, formatDate } from "@/lib/calculations";
import { PageHeader, EmptyState, Modal, ErrorBanner, StatusBadge, inputClass, labelClass, PrimaryButton, SecondaryButton } from "@/components/business/ui";

type FormState = {
  mode: "manual" | "fromOrder";
  orderId: string;
  customerId: string;
  customer: string;
  invoiceDate: string;
  dueDate: string;
  items: InvoiceItem[];
  discount: string;
  gstPercent: string;
  notes: string;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(defaultGst: number): FormState {
  return {
    mode: "manual", orderId: "", customerId: "", customer: "", invoiceDate: today(), dueDate: today(),
    items: [{ description: "", quantity: 1, rate: 0 }], discount: "0", gstPercent: String(defaultGst), notes: "",
  };
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm(18));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [printInvoice, setPrintInvoice] = useState<InvoiceRow | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [inv, c, o, s] = await Promise.all([getInvoicesWithPayments(), getCustomers(), getOrders(), getAllSettings()]);
      setInvoices(inv);
      setCustomers(c);
      setOrders(o);
      setSettings(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invoices.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function openCreate() {
    const defaultGst = await getDefaultGstPercent();
    setForm(emptyForm(defaultGst));
    setError("");
    setModalOpen(true);
  }

  function applyOrder(orderId: string) {
    const order = orders.find((o) => o.id === orderId);
    if (!order) {
      setForm({ ...form, orderId: "", customerId: "", customer: "" });
      return;
    }
    setForm({
      ...form, orderId, customerId: order.customerId, customer: order.customerName,
      items: [{ description: order.product, quantity: order.quantity, rate: order.rate }],
    });
  }

  function updateItem(index: number, patch: Partial<InvoiceItem>) {
    const items = form.items.map((item, i) => (i === index ? { ...item, ...patch } : item));
    setForm({ ...form, items });
  }

  function addItem() {
    setForm({ ...form, items: [...form.items, { description: "", quantity: 1, rate: 0 }] });
  }

  function removeItem(index: number) {
    setForm({ ...form, items: form.items.filter((_, i) => i !== index) });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const customerName = form.mode === "fromOrder" ? form.customer : form.customer;
    if (!customerName.trim()) return setError("Customer is required.");
    if (!form.invoiceDate || !form.dueDate) return setError("Invoice date and due date are required.");
    if (new Date(form.dueDate) < new Date(form.invoiceDate)) return setError("Due date cannot be before the invoice date.");
    if (form.items.length === 0) return setError("Add at least one line item.");
    for (const item of form.items) {
      if (!item.description.trim()) return setError("Every line item needs a description.");
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) return setError("Every line item needs a positive quantity.");
      if (!Number.isFinite(item.rate) || item.rate < 0) return setError("Every line item needs a non-negative rate.");
    }
    const discount = Number(form.discount);
    const gstPercent = Number(form.gstPercent);
    if (!Number.isFinite(discount) || discount < 0) return setError("Discount must be zero or a positive number.");
    if (!Number.isFinite(gstPercent) || gstPercent < 0) return setError("GST % must be zero or a positive number.");

    setSaving(true);
    try {
      const invoiceNumber = await getNextInvoiceNumber();
      const order = orders.find((o) => o.id === form.orderId);
      await createInvoice({
        invoiceNumber, customerId: form.customerId, customer: customerName,
        orderId: form.orderId, orderNumber: order?.orderNumber ?? "",
        invoiceDate: form.invoiceDate, dueDate: form.dueDate, items: form.items,
        discount, gstPercent, notes: form.notes,
      });
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save invoice.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this invoice and all its recorded payments?")) return;
    try {
      await deleteInvoice(id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete invoice.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description="Bill customers for completed or in-progress work."
        action={
          <PrimaryButton onClick={openCreate}>
            <span className="flex items-center gap-2"><Plus className="h-4 w-4" /> New Invoice</span>
          </PrimaryButton>
        }
      />

      {loading ? (
        <p className="text-sm text-slate-500">Loading invoices…</p>
      ) : invoices.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          description="Create an invoice manually or from an existing order."
          action={<PrimaryButton onClick={openCreate}>Create your first invoice</PrimaryButton>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Invoice #</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Balance</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((inv) => {
                const totals = computeTotals(inv.items, inv.discount, inv.gstPercent);
                const paid = inv.payments.reduce((sum, p) => sum + p.amount, 0);
                const balance = Math.max(0, totals.total - paid);
                const status = invoiceStatus(totals.total, paid);
                return (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3">{inv.customer}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(inv.invoiceDate)}</td>
                    <td className="px-4 py-3">{formatCurrency(totals.total)}</td>
                    <td className="px-4 py-3">{formatCurrency(balance)}</td>
                    <td className="px-4 py-3"><StatusBadge status={status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-3">
                        <button onClick={() => setPrintInvoice(inv)} className="flex items-center gap-1 text-xs text-slate-600 hover:underline">
                          <Printer className="h-3.5 w-3.5" /> View
                        </button>
                        <button onClick={() => handleDelete(inv.id)} className="flex items-center gap-1 text-xs text-red-500 hover:underline">
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
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
        <Modal title="New Invoice" onClose={() => setModalOpen(false)} wide>
          <form onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={error} />

            <div className="flex gap-2 rounded-md bg-slate-100 p-1 text-sm">
              <button type="button" onClick={() => setForm({ ...form, mode: "manual" })} className={`flex-1 rounded px-3 py-1.5 ${form.mode === "manual" ? "bg-white shadow-sm" : "text-slate-500"}`}>Manual Entry</button>
              <button type="button" onClick={() => setForm({ ...form, mode: "fromOrder" })} className={`flex-1 rounded px-3 py-1.5 ${form.mode === "fromOrder" ? "bg-white shadow-sm" : "text-slate-500"}`}>Create from Order</button>
            </div>

            {form.mode === "fromOrder" ? (
              <div>
                <label className={labelClass()}>Order *</label>
                <select className={inputClass()} value={form.orderId} onChange={(e) => applyOrder(e.target.value)}>
                  <option value="">Select an order</option>
                  {orders.map((o) => <option key={o.id} value={o.id}>{o.orderNumber} — {o.customerName}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label className={labelClass()}>Customer *</label>
                <select
                  className={inputClass()}
                  value={form.customerId}
                  onChange={(e) => {
                    const customer = customers.find((c) => c.id === e.target.value);
                    setForm({ ...form, customerId: e.target.value, customer: customer?.name ?? "" });
                  }}
                >
                  <option value="">Select a customer</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>Invoice Date *</label>
                <input type="date" className={inputClass()} value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Due Date *</label>
                <input type="date" className={inputClass()} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </div>
            </div>

            <div>
              <label className={labelClass()}>Line Items *</label>
              <div className="space-y-2">
                {form.items.map((item, i) => (
                  <div key={i} className="flex gap-2">
                    <input className={`${inputClass()} flex-1`} placeholder="Description" value={item.description} onChange={(e) => updateItem(i, { description: e.target.value })} />
                    <input type="number" min="1" className={`${inputClass()} w-20`} placeholder="Qty" value={item.quantity} onChange={(e) => updateItem(i, { quantity: Number(e.target.value) })} />
                    <input type="number" min="0" step="0.01" className={`${inputClass()} w-28`} placeholder="Rate" value={item.rate} onChange={(e) => updateItem(i, { rate: Number(e.target.value) })} />
                    {form.items.length > 1 && (
                      <button type="button" onClick={() => removeItem(i)} className="rounded p-2 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={addItem} className="mt-2 text-xs font-medium text-slate-600 hover:underline">+ Add line item</button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>Discount (amount)</label>
                <input type="number" min="0" step="0.01" className={inputClass()} value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>GST %</label>
                <input type="number" min="0" step="0.01" className={inputClass()} value={form.gstPercent} onChange={(e) => setForm({ ...form, gstPercent: e.target.value })} />
              </div>
            </div>

            <div>
              <label className={labelClass()}>Notes</label>
              <textarea className={inputClass()} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>

            {(() => {
              const totals = computeTotals(form.items, Number(form.discount) || 0, Number(form.gstPercent) || 0);
              return (
                <div className="rounded-md bg-slate-50 px-4 py-3 text-sm">
                  <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(totals.subtotal)}</span></div>
                  <div className="flex justify-between"><span>Discount</span><span>-{formatCurrency(totals.discount)}</span></div>
                  <div className="flex justify-between"><span>GST</span><span>{formatCurrency(totals.gstAmount)}</span></div>
                  <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-semibold"><span>Total</span><span>{formatCurrency(totals.total)}</span></div>
                </div>
              );
            })()}

            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setModalOpen(false)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : "Save Invoice"}</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}

      {printInvoice && (
        <Modal title={`Invoice ${printInvoice.invoiceNumber}`} onClose={() => setPrintInvoice(null)} wide>
          <InvoiceDocument invoice={printInvoice} settings={settings} />
        </Modal>
      )}
    </div>
  );
}

function InvoiceDocument({ invoice, settings }: { invoice: InvoiceRow; settings: Record<string, string> }) {
  const totals = computeTotals(invoice.items, invoice.discount, invoice.gstPercent);
  const paid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
  const currency = settings.currency || "INR";

  return (
    <div>
      <div id="invoice-print" className="space-y-6 text-sm">
        <div className="flex items-start justify-between border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-lg font-bold">{settings.businessName || "Your Business Name"}</h2>
            {settings.tagline && <p className="text-xs text-slate-500">{settings.tagline}</p>}
            <p className="mt-1 text-xs text-slate-600">{settings.address}</p>
            <p className="text-xs text-slate-600">{[settings.city, settings.state, settings.pincode].filter(Boolean).join(", ")}</p>
            {settings.gstNumber && <p className="text-xs text-slate-600">GSTIN: {settings.gstNumber}</p>}
            {settings.phone && <p className="text-xs text-slate-600">{settings.phone} {settings.email ? `· ${settings.email}` : ""}</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-bold">INVOICE</p>
            <p className="text-xs text-slate-500">{invoice.invoiceNumber}</p>
            <p className="mt-2 text-xs text-slate-600">Date: {formatDate(invoice.invoiceDate)}</p>
            <p className="text-xs text-slate-600">Due: {formatDate(invoice.dueDate)}</p>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Billed To</p>
          <p className="font-medium">{invoice.customer}</p>
          {invoice.orderNumber && <p className="text-xs text-slate-500">Order: {invoice.orderNumber}</p>}
        </div>

        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
            <tr><th className="py-2">Description</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Rate</th><th className="py-2 text-right">Amount</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoice.items.map((item, i) => (
              <tr key={i}>
                <td className="py-2">{item.description}</td>
                <td className="py-2 text-right">{item.quantity}</td>
                <td className="py-2 text-right">{formatCurrency(item.rate, currency)}</td>
                <td className="py-2 text-right">{formatCurrency(item.quantity * item.rate, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end">
          <div className="w-56 space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(totals.subtotal, currency)}</span></div>
            <div className="flex justify-between"><span>Discount</span><span>-{formatCurrency(totals.discount, currency)}</span></div>
            <div className="flex justify-between"><span>GST ({invoice.gstPercent}%)</span><span>{formatCurrency(totals.gstAmount, currency)}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><span>Total</span><span>{formatCurrency(totals.total, currency)}</span></div>
            <div className="flex justify-between text-green-700"><span>Paid</span><span>{formatCurrency(paid, currency)}</span></div>
            <div className="flex justify-between font-semibold text-red-600"><span>Balance Due</span><span>{formatCurrency(Math.max(0, totals.total - paid), currency)}</span></div>
          </div>
        </div>

        {settings.paymentTerms && (
          <div><p className="text-xs font-semibold uppercase text-slate-500">Payment Terms</p><p className="text-xs text-slate-600">{settings.paymentTerms}</p></div>
        )}
        {(settings.invoiceNotes || invoice.notes) && (
          <div><p className="text-xs font-semibold uppercase text-slate-500">Notes</p><p className="text-xs text-slate-600">{invoice.notes || settings.invoiceNotes}</p></div>
        )}
      </div>
      <div className="mt-4 flex justify-end print:hidden">
        <PrimaryButton onClick={() => window.print()}>Print</PrimaryButton>
      </div>
    </div>
  );
}
