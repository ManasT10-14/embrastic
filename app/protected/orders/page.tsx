"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Receipt } from "lucide-react";
import {
  getOrders, createOrder, updateOrder, updateOrderStatus, deleteOrder,
  getNextOrderNumber, getCustomers, getDefaultGstPercent, ORDER_STATUSES,
  type OrderRow, type CustomerRow,
} from "@/lib/db";
import { documentTotals, formatCurrency, formatDate, isOverdue } from "@/lib/calculations";
import {
  PageHeader, EmptyState, Modal, ErrorBanner, SuccessBanner, SearchInput,
  FilterSelect, Toolbar, RowAction, inputClass, labelClass, PrimaryButton, SecondaryButton,
} from "@/components/business/ui";

const EMPTY_FORM = {
  customerId: "", product: "", quantity: "1", rate: "0",
  discount: "0", gstPercent: "18", deliveryDate: "", status: "New", notes: "",
};

const CLOSED = new Set(["Delivered", "Cancelled"]);

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [o, c] = await Promise.all([getOrders(), getCustomers()]);
      setOrders(o);
      setCustomers(c);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load orders.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function openCreate() {
    const defaultGst = await getDefaultGstPercent();
    setEditingId(null);
    setForm({ ...EMPTY_FORM, gstPercent: String(defaultGst) });
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(order: OrderRow) {
    setEditingId(order.id);
    setForm({
      customerId: order.customerId, product: order.product,
      quantity: String(order.quantity), rate: String(order.rate),
      discount: String(order.discount), gstPercent: String(order.gstPercent),
      deliveryDate: order.deliveryDate, status: order.status, notes: order.notes,
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
    if (!form.product.trim()) return setFormError("Product is required.");
    if (!Number.isInteger(quantity) || quantity <= 0) return setFormError("Quantity must be a whole number greater than zero.");
    if (!Number.isFinite(rate) || rate < 0) return setFormError("Rate must be zero or a positive number.");
    if (!Number.isFinite(discount) || discount < 0) return setFormError("Discount must be zero or a positive number.");
    if (discount > quantity * rate) return setFormError("The discount is larger than the order itself.");
    if (!Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 100) return setFormError("GST % must be between 0 and 100.");

    setSaving(true);
    try {
      const customer = customers.find((c) => c.id === form.customerId);
      const payload = {
        customerId: form.customerId, customerName: customer?.name ?? "",
        product: form.product.trim(), quantity, rate, discount, gstPercent,
        deliveryDate: form.deliveryDate, status: form.status, notes: form.notes,
      };
      if (editingId) {
        await updateOrder(editingId, payload);
        setNotice("Order updated.");
      } else {
        const orderNumber = await getNextOrderNumber();
        await createOrder({ ...payload, orderNumber });
        setNotice(`Order ${orderNumber} created.`);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save order.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id: string, status: string) {
    setError("");
    try {
      await updateOrderStatus(id, status);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status.");
    }
  }

  async function handleDelete(order: OrderRow) {
    if (!confirm(`Delete order ${order.orderNumber}?`)) return;
    setError("");
    try {
      await deleteOrder(order.id);
      setNotice(`Order ${order.orderNumber} deleted.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete order.");
    }
  }

  const filtered = orders.filter((o) => {
    if (statusFilter && o.status !== statusFilter) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      o.orderNumber.toLowerCase().includes(term) ||
      o.customerName.toLowerCase().includes(term) ||
      o.product.toLowerCase().includes(term) ||
      o.quoteNumber.toLowerCase().includes(term)
    );
  });

  const preview = documentTotals(
    Number(form.quantity) || 0, Number(form.rate) || 0,
    Number(form.discount) || 0, Number(form.gstPercent) || 0,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Confirmed work the business has agreed to deliver."
        action={
          <PrimaryButton onClick={openCreate}>
            <span className="flex items-center gap-2"><Plus className="h-4 w-4" /> New Order</span>
          </PrimaryButton>
        }
      />

      <ErrorBanner message={error} onDismiss={() => setError("")} />
      <SuccessBanner message={notice} onDismiss={() => setNotice("")} />

      {orders.length > 0 && (
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search order number, customer or product" />
          <FilterSelect value={statusFilter} onChange={setStatusFilter} options={ORDER_STATUSES} allLabel="All statuses" />
          <span className="text-xs text-slate-500">{filtered.length} of {orders.length}</span>
        </Toolbar>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading orders…</p>
      ) : orders.length === 0 ? (
        <EmptyState
          title="No orders yet"
          description="Create an order directly, or approve a quotation and convert it to an order."
          action={<PrimaryButton onClick={openCreate}>Create your first order</PrimaryButton>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching orders" description="Try a different search term or status filter." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Order #</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Delivery</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((o) => {
                const late = o.deliveryDate && isOverdue(o.deliveryDate) && !CLOSED.has(o.status);
                return (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium">{o.orderNumber}</div>
                      {o.quoteNumber && <div className="text-xs text-slate-400">from {o.quoteNumber}</div>}
                    </td>
                    <td className="px-4 py-3">{o.customerName || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{o.product} × {o.quantity}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(o.amount)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(o.deliveryDate)}
                      {late && <span className="ml-1 text-xs font-medium text-red-600">late</span>}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={o.status}
                        onChange={(e) => handleStatusChange(o.id, e.target.value)}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                        aria-label={`Status for ${o.orderNumber}`}
                      >
                        {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                        <RowAction tone="primary" onClick={() => router.push(`/protected/invoices?order=${o.id}`)}>
                          <Receipt className="h-3.5 w-3.5" /> Invoice
                        </RowAction>
                        <RowAction onClick={() => openEdit(o)}><Pencil className="h-3.5 w-3.5" /> Edit</RowAction>
                        <RowAction tone="danger" onClick={() => handleDelete(o)}><Trash2 className="h-3.5 w-3.5" /> Delete</RowAction>
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
        <Modal title={editingId ? "Edit Order" : "New Order"} onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={formError} />
            <div>
              <label className={labelClass()}>Customer *</label>
              <select className={inputClass()} value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                <option value="">Select a customer</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {customers.length === 0 && (
                <p className="mt-1 text-xs text-amber-700">Add a customer first — an order always belongs to one.</p>
              )}
            </div>
            <div>
              <label className={labelClass()}>Product *</label>
              <input className={inputClass()} value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} />
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
              <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-semibold"><span>Order value</span><span className="tabular-nums">{formatCurrency(preview.total)}</span></div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>Delivery Date</label>
                <input type="date" className={inputClass()} value={form.deliveryDate} onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Status</label>
                <select className={inputClass()} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass()}>Notes</label>
              <textarea className={inputClass()} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setModalOpen(false)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Save Changes" : "Save Order"}</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
