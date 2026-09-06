"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import {
  getOrders, createOrder, updateOrderStatus, deleteOrder, getNextOrderNumber, getCustomers,
  type OrderRow, type CustomerRow,
} from "@/lib/db";
import { formatCurrency, formatDate } from "@/lib/calculations";
import { PageHeader, EmptyState, Modal, ErrorBanner, inputClass, labelClass, PrimaryButton, SecondaryButton } from "@/components/business/ui";

const STATUSES = ["New", "Confirmed", "Digitizing", "In Production", "Ready", "Delivered", "Cancelled"];
const EMPTY_FORM = { customerId: "", product: "", quantity: "1", rate: "0", deliveryDate: "" };

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [o, c] = await Promise.all([getOrders(), getCustomers()]);
      setOrders(o);
      setCustomers(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load orders.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setForm(EMPTY_FORM);
    setError("");
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const quantity = Number(form.quantity);
    const rate = Number(form.rate);
    if (!form.customerId) return setError("Select a customer.");
    if (!form.product.trim()) return setError("Product is required.");
    if (!Number.isFinite(quantity) || quantity <= 0) return setError("Quantity must be a positive number.");
    if (!Number.isFinite(rate) || rate < 0) return setError("Rate must be zero or a positive number.");

    setSaving(true);
    try {
      const orderNumber = await getNextOrderNumber();
      const customer = customers.find((c) => c.id === form.customerId);
      await createOrder({
        orderNumber, customerId: form.customerId, customerName: customer?.name ?? "",
        product: form.product, quantity, rate, deliveryDate: form.deliveryDate, status: "New", notes: "",
      });
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save order.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      await updateOrderStatus(id, status);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update status.");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this order?")) return;
    try {
      await deleteOrder(id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete order.");
    }
  }

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

      {loading ? (
        <p className="text-sm text-slate-500">Loading orders…</p>
      ) : orders.length === 0 ? (
        <EmptyState
          title="No orders yet"
          description="Create an order directly, or approve a quotation and convert it to an order."
          action={<PrimaryButton onClick={openCreate}>Create your first order</PrimaryButton>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Order #</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Delivery</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{o.orderNumber}</td>
                  <td className="px-4 py-3">{o.customerName || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{o.product} × {o.quantity}</td>
                  <td className="px-4 py-3">{formatCurrency(o.amount)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(o.deliveryDate)}</td>
                  <td className="px-4 py-3">
                    <select
                      value={o.status}
                      onChange={(e) => handleStatusChange(o.id, e.target.value)}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDelete(o.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <Modal title="New Order" onClose={() => setModalOpen(false)}>
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
              <label className={labelClass()}>Product *</label>
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
            </div>
            <div>
              <label className={labelClass()}>Delivery Date</label>
              <input type="date" className={inputClass()} value={form.deliveryDate} onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setModalOpen(false)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : "Save Order"}</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
