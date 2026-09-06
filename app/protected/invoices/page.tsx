"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Printer, Trash2, Pencil, Wallet } from "lucide-react";
import {
  getInvoicesWithPayments, createInvoice, updateInvoice, deleteInvoice, getNextInvoiceNumber,
  getCustomers, getOrders, getAllSettings, getDefaultGstPercent, invoiceBalance,
  type InvoiceRow, type CustomerRow, type OrderRow, type InvoiceItem,
} from "@/lib/db";
import {
  computeTotals, invoiceStatus, formatCurrency, formatDate, todayISO, toISODate,
  parseDateOnly, isOverdue,
} from "@/lib/calculations";
import {
  PageHeader, EmptyState, Modal, ErrorBanner, SuccessBanner, StatusBadge, SearchInput,
  FilterSelect, Toolbar, RowAction, inputClass, labelClass, PrimaryButton, SecondaryButton,
} from "@/components/business/ui";

const STATUSES = ["Unpaid", "Partial", "Paid"];

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

function addDays(iso: string, days: number): string {
  const date = parseDateOnly(iso);
  if (!date) return iso;
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

function emptyForm(defaultGst: number, dueDays: number): FormState {
  const today = todayISO();
  return {
    mode: "manual", orderId: "", customerId: "", customer: "",
    invoiceDate: today, dueDate: addDays(today, dueDays),
    items: [{ description: "", quantity: 1, rate: 0 }],
    discount: "0", gstPercent: String(defaultGst), notes: "",
  };
}

export default function InvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(18, 15));
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [printInvoice, setPrintInvoice] = useState<InvoiceRow | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [inv, c, o, s] = await Promise.all([getInvoicesWithPayments(), getCustomers(), getOrders(), getAllSettings()]);
      setInvoices(inv);
      setCustomers(c);
      setOrders(o);
      setSettings(s);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invoices.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Arriving from an order row ("Invoice" action).
  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get("order");
    if (!orderId) return;
    window.history.replaceState(null, "", "/protected/invoices");
    (async () => {
      const [defaultGst, s, allOrders] = await Promise.all([getDefaultGstPercent(), getAllSettings(), getOrders()]);
      const order = allOrders.find((o) => o.id === orderId);
      const base = emptyForm(defaultGst, Number(s.dueDays) || 15);
      setEditingId(null);
      setFormError("");
      setForm(order ? { ...base, mode: "fromOrder", ...orderPatch(order) } : { ...base, mode: "fromOrder" });
      setModalOpen(true);
    })();
  }, []);

  /** The invoice inherits the order's agreed price, discount and GST verbatim. */
  function orderPatch(order: OrderRow) {
    return {
      orderId: order.id,
      customerId: order.customerId,
      customer: order.customerName,
      items: [{ description: order.product, quantity: order.quantity, rate: order.rate }],
      discount: String(order.discount),
      gstPercent: String(order.gstPercent),
    };
  }

  async function openCreate() {
    const [defaultGst, s] = await Promise.all([getDefaultGstPercent(), getAllSettings()]);
    setEditingId(null);
    setForm(emptyForm(defaultGst, Number(s.dueDays) || 15));
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(invoice: InvoiceRow) {
    setEditingId(invoice.id);
    setForm({
      mode: invoice.orderId ? "fromOrder" : "manual",
      orderId: invoice.orderId, customerId: invoice.customerId, customer: invoice.customer,
      invoiceDate: invoice.invoiceDate, dueDate: invoice.dueDate,
      items: invoice.items.length > 0 ? invoice.items : [{ description: "", quantity: 1, rate: 0 }],
      discount: String(invoice.discount), gstPercent: String(invoice.gstPercent), notes: invoice.notes,
    });
    setFormError("");
    setModalOpen(true);
  }

  /**
   * Switching modes clears the other mode's linkage. Without this, picking an
   * order and then switching to Manual left the invoice attached to that order
   * while showing a different customer.
   */
  function setMode(mode: "manual" | "fromOrder") {
    setForm((f) => ({ ...f, mode, orderId: "", customerId: "", customer: "" }));
  }

  function applyOrder(orderId: string) {
    const order = orders.find((o) => o.id === orderId);
    if (!order) {
      setForm((f) => ({ ...f, orderId: "", customerId: "", customer: "" }));
      return;
    }
    setForm((f) => ({ ...f, ...orderPatch(order) }));
  }

  function updateItem(index: number, patch: Partial<InvoiceItem>) {
    setForm((f) => ({ ...f, items: f.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) }));
  }

  function addItem() {
    setForm((f) => ({ ...f, items: [...f.items, { description: "", quantity: 1, rate: 0 }] }));
  }

  function removeItem(index: number) {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== index) }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    if (!form.customer.trim()) {
      return setFormError(form.mode === "fromOrder" ? "Select an order." : "Select a customer.");
    }
    if (!form.invoiceDate || !form.dueDate) return setFormError("Invoice date and due date are required.");
    const invoiceDate = parseDateOnly(form.invoiceDate);
    const dueDate = parseDateOnly(form.dueDate);
    if (!invoiceDate || !dueDate) return setFormError("Enter valid dates.");
    if (dueDate < invoiceDate) return setFormError("Due date cannot be before the invoice date.");
    if (form.items.length === 0) return setFormError("Add at least one line item.");

    for (const item of form.items) {
      if (!item.description.trim()) return setFormError("Every line item needs a description.");
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) return setFormError("Every line item needs a positive quantity.");
      if (!Number.isFinite(item.rate) || item.rate < 0) return setFormError("Every line item needs a non-negative rate.");
    }

    const discount = Number(form.discount);
    const gstPercent = Number(form.gstPercent);
    if (!Number.isFinite(discount) || discount < 0) return setFormError("Discount must be zero or a positive number.");
    if (!Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 100) return setFormError("GST % must be between 0 and 100.");
    const subtotal = form.items.reduce((sum, i) => sum + i.quantity * i.rate, 0);
    if (discount > subtotal) return setFormError("The discount is larger than the invoice itself.");

    setSaving(true);
    try {
      const order = orders.find((o) => o.id === form.orderId);
      const payload = {
        customerId: form.customerId, customer: form.customer.trim(),
        orderId: form.orderId, orderNumber: order?.orderNumber ?? "",
        invoiceDate: form.invoiceDate, dueDate: form.dueDate, items: form.items,
        discount, gstPercent, notes: form.notes,
      };
      if (editingId) {
        await updateInvoice(editingId, payload);
        setNotice("Invoice updated.");
      } else {
        const invoiceNumber = await getNextInvoiceNumber();
        await createInvoice({ ...payload, invoiceNumber });
        setNotice(`Invoice ${invoiceNumber} created.`);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save invoice.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(invoice: InvoiceRow) {
    if (!confirm(`Delete invoice ${invoice.invoiceNumber}?`)) return;
    setError("");
    try {
      await deleteInvoice(invoice.id);
      setNotice(`Invoice ${invoice.invoiceNumber} deleted.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete invoice.");
    }
  }

  const invoicedOrderIds = new Set(invoices.filter((i) => i.orderId).map((i) => i.orderId));

  const rows = invoices.map((inv) => {
    const { total, paid, balance } = invoiceBalance(inv);
    const status = invoiceStatus(total, paid);
    return { inv, total, paid, balance, status, overdue: balance > 0.01 && isOverdue(inv.dueDate) };
  });

  const filtered = rows.filter(({ inv, status }) => {
    if (statusFilter && status !== statusFilter) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      inv.invoiceNumber.toLowerCase().includes(term) ||
      inv.customer.toLowerCase().includes(term) ||
      inv.orderNumber.toLowerCase().includes(term)
    );
  });

  const preview = computeTotals(form.items, Number(form.discount) || 0, Number(form.gstPercent) || 0);
  const selectedOrderAlreadyInvoiced =
    form.orderId && !editingId && invoicedOrderIds.has(form.orderId);

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

      <ErrorBanner message={error} onDismiss={() => setError("")} />
      <SuccessBanner message={notice} onDismiss={() => setNotice("")} />

      {invoices.length > 0 && (
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search invoice number, customer or order" />
          <FilterSelect value={statusFilter} onChange={setStatusFilter} options={STATUSES} allLabel="All statuses" />
          <span className="text-xs text-slate-500">{filtered.length} of {invoices.length}</span>
        </Toolbar>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading invoices…</p>
      ) : invoices.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          description="Create an invoice manually or from an existing order."
          action={<PrimaryButton onClick={openCreate}>Create your first invoice</PrimaryButton>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching invoices" description="Try a different search term or status filter." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Invoice #</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(({ inv, total, balance, status, overdue }) => (
                <tr key={inv.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{inv.invoiceNumber}</div>
                    {inv.orderNumber && <div className="text-xs text-slate-400">for {inv.orderNumber}</div>}
                  </td>
                  <td className="px-4 py-3">{inv.customer}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(inv.invoiceDate)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatDate(inv.dueDate)}
                    {overdue && <span className="ml-1 text-xs font-medium text-red-600">overdue</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(total)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(balance)}</td>
                  <td className="px-4 py-3"><StatusBadge status={status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                      {balance > 0.01 && (
                        <RowAction tone="primary" onClick={() => router.push(`/protected/payments?invoice=${inv.id}`)}>
                          <Wallet className="h-3.5 w-3.5" /> Payment
                        </RowAction>
                      )}
                      <RowAction onClick={() => setPrintInvoice(inv)}>
                        <Printer className="h-3.5 w-3.5" /> View
                      </RowAction>
                      {inv.payments.length === 0 && (
                        <RowAction onClick={() => openEdit(inv)}><Pencil className="h-3.5 w-3.5" /> Edit</RowAction>
                      )}
                      <RowAction tone="danger" onClick={() => handleDelete(inv)}>
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </RowAction>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <Modal title={editingId ? "Edit Invoice" : "New Invoice"} onClose={() => setModalOpen(false)} wide>
          <form onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={formError} />

            {!editingId && (
              <div className="flex gap-2 rounded-md bg-slate-100 p-1 text-sm">
                <button type="button" onClick={() => setMode("manual")} className={`flex-1 rounded px-3 py-1.5 ${form.mode === "manual" ? "bg-white shadow-sm" : "text-slate-500"}`}>Manual Entry</button>
                <button type="button" onClick={() => setMode("fromOrder")} className={`flex-1 rounded px-3 py-1.5 ${form.mode === "fromOrder" ? "bg-white shadow-sm" : "text-slate-500"}`}>Create from Order</button>
              </div>
            )}

            {form.mode === "fromOrder" ? (
              <div>
                <label className={labelClass()}>Order *</label>
                <select className={inputClass()} value={form.orderId} onChange={(e) => applyOrder(e.target.value)} disabled={!!editingId}>
                  <option value="">Select an order</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.orderNumber} — {o.customerName} ({formatCurrency(o.amount)}){invoicedOrderIds.has(o.id) ? " · already invoiced" : ""}
                    </option>
                  ))}
                </select>
                {selectedOrderAlreadyInvoiced && (
                  <p className="mt-1 text-xs text-amber-700">
                    This order already has an invoice. Only continue if you&apos;re deliberately raising a second one.
                  </p>
                )}
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
                <input type="date" min={form.invoiceDate} className={inputClass()} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </div>
            </div>

            <div>
              <label className={labelClass()}>Line Items *</label>
              <div className="space-y-2">
                {form.items.map((item, i) => (
                  <div key={i} className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
                    <input className={`${inputClass()} min-w-[10rem] flex-1`} placeholder="Description" value={item.description} onChange={(e) => updateItem(i, { description: e.target.value })} />
                    <input type="number" min="1" step="1" className={`${inputClass()} w-20`} placeholder="Qty" value={item.quantity} onChange={(e) => updateItem(i, { quantity: Number(e.target.value) })} />
                    <input type="number" min="0" step="0.01" className={`${inputClass()} w-28`} placeholder="Rate" value={item.rate} onChange={(e) => updateItem(i, { rate: Number(e.target.value) })} />
                    <div className="flex w-24 items-center justify-end px-1 py-2 text-sm tabular-nums text-slate-600">
                      {formatCurrency(item.quantity * item.rate)}
                    </div>
                    {form.items.length > 1 && (
                      <button type="button" onClick={() => removeItem(i)} className="rounded p-2 text-red-500 hover:bg-red-50" aria-label="Remove line item">
                        <Trash2 className="h-4 w-4" />
                      </button>
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
                <input type="number" min="0" max="100" step="0.01" className={inputClass()} value={form.gstPercent} onChange={(e) => setForm({ ...form, gstPercent: e.target.value })} />
              </div>
            </div>

            <div>
              <label className={labelClass()}>Notes</label>
              <textarea className={inputClass()} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={settings.invoiceNotes || ""} />
            </div>

            <div className="rounded-md bg-slate-50 px-4 py-3 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{formatCurrency(preview.subtotal)}</span></div>
              <div className="flex justify-between"><span>Discount</span><span className="tabular-nums">-{formatCurrency(preview.discount)}</span></div>
              <div className="flex justify-between"><span>GST ({Number(form.gstPercent) || 0}%)</span><span className="tabular-nums">{formatCurrency(preview.gstAmount)}</span></div>
              <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-semibold"><span>Total</span><span className="tabular-nums">{formatCurrency(preview.total)}</span></div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setModalOpen(false)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Save Changes" : "Save Invoice"}</PrimaryButton>
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
  const balance = Math.max(0, totals.total - paid);

  return (
    <div>
      <div id="invoice-print" className="space-y-6 text-sm text-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-lg font-bold">{settings.businessName || "Your Business Name"}</h2>
            {settings.tagline && <p className="text-xs text-slate-500">{settings.tagline}</p>}
            {settings.address && <p className="mt-1 text-xs text-slate-600">{settings.address}</p>}
            <p className="text-xs text-slate-600">{[settings.city, settings.state, settings.pincode].filter(Boolean).join(", ")}</p>
            {settings.gstNumber && <p className="text-xs text-slate-600">GSTIN: {settings.gstNumber}</p>}
            {settings.phone && <p className="text-xs text-slate-600">{settings.phone}{settings.email ? ` · ${settings.email}` : ""}</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-bold">TAX INVOICE</p>
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

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr><th className="py-2">Description</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Rate</th><th className="py-2 text-right">Amount</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoice.items.map((item, i) => (
                <tr key={i}>
                  <td className="py-2">{item.description}</td>
                  <td className="py-2 text-right tabular-nums">{item.quantity}</td>
                  <td className="py-2 text-right tabular-nums">{formatCurrency(item.rate, currency)}</td>
                  <td className="py-2 text-right tabular-nums">{formatCurrency(item.quantity * item.rate, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <div className="w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{formatCurrency(totals.subtotal, currency)}</span></div>
            <div className="flex justify-between"><span>Discount</span><span className="tabular-nums">-{formatCurrency(totals.discount, currency)}</span></div>
            <div className="flex justify-between"><span>GST ({invoice.gstPercent}%)</span><span className="tabular-nums">{formatCurrency(totals.gstAmount, currency)}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><span>Total</span><span className="tabular-nums">{formatCurrency(totals.total, currency)}</span></div>
            <div className="flex justify-between text-green-700"><span>Paid</span><span className="tabular-nums">{formatCurrency(paid, currency)}</span></div>
            <div className={`flex justify-between font-semibold ${balance > 0 ? "text-red-600" : "text-green-700"}`}>
              <span>Balance Due</span><span className="tabular-nums">{formatCurrency(balance, currency)}</span>
            </div>
          </div>
        </div>

        {invoice.payments.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Payments Received</p>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {invoice.payments.map((p) => (
                <li key={p.id}>
                  {formatDate(p.date)} — {formatCurrency(p.amount, currency)} via {p.method}
                  {p.reference ? ` (${p.reference})` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        {settings.paymentTerms && (
          <div><p className="text-xs font-semibold uppercase text-slate-500">Payment Terms</p><p className="text-xs text-slate-600">{settings.paymentTerms}</p></div>
        )}
        {(invoice.notes || settings.invoiceNotes) && (
          <div><p className="text-xs font-semibold uppercase text-slate-500">Notes</p><p className="text-xs text-slate-600">{invoice.notes || settings.invoiceNotes}</p></div>
        )}
      </div>

      <div className="mt-4 flex justify-end print:hidden">
        <PrimaryButton onClick={() => window.print()}>Print</PrimaryButton>
      </div>
    </div>
  );
}
