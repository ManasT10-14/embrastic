"use client";

import { useEffect, useState } from "react";
import { Plus, Package } from "lucide-react";
import {
  getProductionJobs, createProductionJob, updateProductionJob, deleteProductionJob,
  recordMaterialUsage, getOrders, getDesigns, getInventoryItems,
  type ProductionJobRow, type OrderRow, type DesignRow, type InventoryItemRow,
} from "@/lib/db";
import { PageHeader, EmptyState, Modal, ErrorBanner, inputClass, labelClass, PrimaryButton, SecondaryButton } from "@/components/business/ui";

const STATUSES = ["Queued", "In Progress", "Completed", "On Hold"];
const EMPTY_FORM = { orderId: "", designId: "", machine: "", operator: "", quantityOrdered: "1", notes: "" };

export default function ProductionPage() {
  const [jobs, setJobs] = useState<ProductionJobRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [designs, setDesigns] = useState<DesignRow[]>([]);
  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [materialJob, setMaterialJob] = useState<ProductionJobRow | null>(null);
  const [materialForm, setMaterialForm] = useState({ itemId: "", quantity: "1" });
  const [materialError, setMaterialError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [j, o, d, i] = await Promise.all([getProductionJobs(), getOrders(), getDesigns(), getInventoryItems()]);
      setJobs(j);
      setOrders(o);
      setDesigns(d);
      setItems(i);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load production jobs.");
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
    const quantityOrdered = Number(form.quantityOrdered);
    if (!form.orderId) return setError("Select an order.");
    if (!Number.isFinite(quantityOrdered) || quantityOrdered <= 0) return setError("Quantity must be a positive number.");

    setSaving(true);
    try {
      const order = orders.find((o) => o.id === form.orderId);
      const design = designs.find((d) => d.id === form.designId);
      await createProductionJob({
        orderId: form.orderId, designId: form.designId, customerName: order?.customerName ?? "",
        product: order?.product ?? "", designName: design?.name ?? "", quantityOrdered,
        machine: form.machine, operator: form.operator, notes: form.notes,
      });
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save production job.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: string, updates: Parameters<typeof updateProductionJob>[1]) {
    try {
      await updateProductionJob(id, updates);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update job.");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this production job?")) return;
    try {
      await deleteProductionJob(id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete job.");
    }
  }

  function openMaterialUsage(job: ProductionJobRow) {
    setMaterialJob(job);
    setMaterialForm({ itemId: "", quantity: "1" });
    setMaterialError("");
  }

  async function handleRecordMaterial(e: React.FormEvent) {
    e.preventDefault();
    setMaterialError("");
    const quantity = Number(materialForm.quantity);
    if (!materialForm.itemId) return setMaterialError("Select a material.");
    if (!Number.isFinite(quantity) || quantity <= 0) return setMaterialError("Quantity must be a positive number.");
    if (!materialJob) return;

    try {
      await recordMaterialUsage({
        productionJobId: materialJob.id,
        productionJobLabel: materialJob.orderNumber || materialJob.id,
        itemId: materialForm.itemId, quantity,
      });
      setMaterialJob(null);
      await load();
    } catch (err) {
      setMaterialError(err instanceof Error ? err.message : "Failed to record material usage.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Production"
        description="Track embroidery jobs from queue through completion."
        action={
          <PrimaryButton onClick={openCreate}>
            <span className="flex items-center gap-2"><Plus className="h-4 w-4" /> New Production Job</span>
          </PrimaryButton>
        }
      />

      {loading ? (
        <p className="text-sm text-slate-500">Loading production jobs…</p>
      ) : jobs.length === 0 ? (
        <EmptyState
          title="No production jobs"
          description="Create a production job from an existing order and design."
          action={<PrimaryButton onClick={openCreate}>Create your first job</PrimaryButton>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Ordered</th>
                <th className="px-4 py-3">Completed</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map((j) => (
                <tr key={j.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{j.orderNumber || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{j.customerName || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{j.quantityOrdered}</td>
                  <td className="px-4 py-3">
                    <input
                      type="number" min="0" defaultValue={j.quantityCompleted}
                      onBlur={(e) => handleUpdate(j.id, { quantityCompleted: Number(e.target.value) })}
                      className="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <select value={j.status} onChange={(e) => handleUpdate(j.id, { status: e.target.value })} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-3">
                      <button onClick={() => openMaterialUsage(j)} className="flex items-center gap-1 text-xs text-slate-600 hover:underline">
                        <Package className="h-3.5 w-3.5" /> Record material
                      </button>
                      <button onClick={() => handleDelete(j.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <Modal title="New Production Job" onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={error} />
            <div>
              <label className={labelClass()}>Order *</label>
              <select className={inputClass()} value={form.orderId} onChange={(e) => setForm({ ...form, orderId: e.target.value })}>
                <option value="">Select an order</option>
                {orders.map((o) => <option key={o.id} value={o.id}>{o.orderNumber} — {o.customerName}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass()}>Design</label>
              <select className={inputClass()} value={form.designId} onChange={(e) => setForm({ ...form, designId: e.target.value })}>
                <option value="">No design selected</option>
                {designs.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>Quantity Ordered</label>
                <input type="number" min="1" className={inputClass()} value={form.quantityOrdered} onChange={(e) => setForm({ ...form, quantityOrdered: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Machine</label>
                <input className={inputClass()} value={form.machine} onChange={(e) => setForm({ ...form, machine: e.target.value })} />
              </div>
            </div>
            <div>
              <label className={labelClass()}>Operator</label>
              <input className={inputClass()} value={form.operator} onChange={(e) => setForm({ ...form, operator: e.target.value })} />
            </div>
            <div>
              <label className={labelClass()}>Notes</label>
              <textarea className={inputClass()} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setModalOpen(false)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : "Save Job"}</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}

      {materialJob && (
        <Modal title={`Record Material Usage — ${materialJob.orderNumber || "Job"}`} onClose={() => setMaterialJob(null)}>
          <form onSubmit={handleRecordMaterial} className="space-y-4">
            <ErrorBanner message={materialError} />
            {items.length === 0 ? (
              <p className="text-sm text-slate-500">No inventory items yet — add materials in Inventory first.</p>
            ) : (
              <>
                <div>
                  <label className={labelClass()}>Material *</label>
                  <select className={inputClass()} value={materialForm.itemId} onChange={(e) => setMaterialForm({ ...materialForm, itemId: e.target.value })}>
                    <option value="">Select an item</option>
                    {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.currentStock} {i.unit} in stock)</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass()}>Quantity Used *</label>
                  <input type="number" min="1" className={inputClass()} value={materialForm.quantity} onChange={(e) => setMaterialForm({ ...materialForm, quantity: e.target.value })} />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <SecondaryButton onClick={() => setMaterialJob(null)}>Cancel</SecondaryButton>
                  <PrimaryButton type="submit">Record Usage</PrimaryButton>
                </div>
              </>
            )}
          </form>
        </Modal>
      )}
    </div>
  );
}
