"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import {
  getDesigns, createDesign, updateDesignStatus, deleteDesign, getCustomers, getOrders,
  type DesignRow, type CustomerRow, type OrderRow,
} from "@/lib/db";
import { PageHeader, EmptyState, Modal, ErrorBanner, inputClass, labelClass, PrimaryButton, SecondaryButton } from "@/components/business/ui";

const STATUSES = ["Artwork Received", "Digitizing", "Test Stitch", "Customer Approval", "Approved", "Production Ready", "Revision Required"];
const EMPTY_FORM = { code: "", name: "", customerId: "", orderId: "", placement: "Left Chest", width: "0", height: "0", stitchCount: "0", threadColors: "", digitizer: "", fileFormat: "DST", notes: "" };

export default function DesignsPage() {
  const [designs, setDesigns] = useState<DesignRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [d, c, o] = await Promise.all([getDesigns(), getCustomers(), getOrders()]);
      setDesigns(d);
      setCustomers(c);
      setOrders(o);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load designs.");
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
    if (!form.code.trim() || !form.name.trim()) return setError("Design code and name are required.");
    if (!form.customerId) return setError("Select a customer.");

    setSaving(true);
    try {
      await createDesign({
        code: form.code, name: form.name, customerId: form.customerId, orderId: form.orderId,
        placement: form.placement, width: Number(form.width), height: Number(form.height),
        stitchCount: Number(form.stitchCount), threadColors: form.threadColors,
        digitizer: form.digitizer, fileFormat: form.fileFormat, notes: form.notes,
      });
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save design.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      await updateDesignStatus(id, status);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update status.");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this design?")) return;
    try {
      await deleteDesign(id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete design.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Artwork & Designs"
        description="Track designs through artwork, digitizing and customer approval."
        action={
          <PrimaryButton onClick={openCreate}>
            <span className="flex items-center gap-2"><Plus className="h-4 w-4" /> New Design</span>
          </PrimaryButton>
        }
      />

      {loading ? (
        <p className="text-sm text-slate-500">Loading designs…</p>
      ) : designs.length === 0 ? (
        <EmptyState
          title="No designs yet"
          description="Add a design and link it to a customer and order to start tracking its workflow."
          action={<PrimaryButton onClick={openCreate}>Add your first design</PrimaryButton>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {designs.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{d.code}</td>
                  <td className="px-4 py-3">{d.name}</td>
                  <td className="px-4 py-3 text-slate-600">{d.customerName || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{d.orderNumber || "—"}</td>
                  <td className="px-4 py-3">
                    <select value={d.status} onChange={(e) => handleStatusChange(d.id, e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDelete(d.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <Modal title="New Design" onClose={() => setModalOpen(false)} wide>
          <form onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={error} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>Design Code *</label>
                <input className={inputClass()} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Design Name *</label>
                <input className={inputClass()} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Customer *</label>
                <select className={inputClass()} value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                  <option value="">Select a customer</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass()}>Order</label>
                <select className={inputClass()} value={form.orderId} onChange={(e) => setForm({ ...form, orderId: e.target.value })}>
                  <option value="">Not linked to an order</option>
                  {orders.map((o) => <option key={o.id} value={o.id}>{o.orderNumber} — {o.customerName}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass()}>Placement</label>
                <input className={inputClass()} value={form.placement} onChange={(e) => setForm({ ...form, placement: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>File Format</label>
                <input className={inputClass()} value={form.fileFormat} onChange={(e) => setForm({ ...form, fileFormat: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Width (cm)</label>
                <input type="number" step="0.1" className={inputClass()} value={form.width} onChange={(e) => setForm({ ...form, width: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Height (cm)</label>
                <input type="number" step="0.1" className={inputClass()} value={form.height} onChange={(e) => setForm({ ...form, height: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Stitch Count</label>
                <input type="number" className={inputClass()} value={form.stitchCount} onChange={(e) => setForm({ ...form, stitchCount: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Thread Colors</label>
                <input className={inputClass()} value={form.threadColors} onChange={(e) => setForm({ ...form, threadColors: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Digitizer</label>
                <input className={inputClass()} value={form.digitizer} onChange={(e) => setForm({ ...form, digitizer: e.target.value })} />
              </div>
            </div>
            <div>
              <label className={labelClass()}>Notes</label>
              <textarea className={inputClass()} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setModalOpen(false)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : "Save Design"}</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
