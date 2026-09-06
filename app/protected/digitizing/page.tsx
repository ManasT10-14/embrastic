"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import {
  getDigitizingJobs, createDigitizingJob, updateDigitizingStatus, deleteDigitizingJob,
  getDesigns, getOrders, getCustomers,
  type DigitizingJobRow, type DesignRow, type OrderRow, type CustomerRow,
} from "@/lib/db";
import { formatDate } from "@/lib/calculations";
import { PageHeader, EmptyState, Modal, ErrorBanner, inputClass, labelClass, PrimaryButton, SecondaryButton } from "@/components/business/ui";

const STATUSES = ["Queued", "In Progress", "Ready", "Completed", "Revision Required"];
const EMPTY_FORM = { jobNumber: "", designId: "", orderId: "", customerId: "", dueDate: "", notes: "" };

export default function DigitizingPage() {
  const [jobs, setJobs] = useState<DigitizingJobRow[]>([]);
  const [designs, setDesigns] = useState<DesignRow[]>([]);
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
      const [j, d, o, c] = await Promise.all([getDigitizingJobs(), getDesigns(), getOrders(), getCustomers()]);
      setJobs(j);
      setDesigns(d);
      setOrders(o);
      setCustomers(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load digitizing jobs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setForm({ ...EMPTY_FORM, jobNumber: `DGT-${Date.now().toString().slice(-6)}` });
    setError("");
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.designId && !form.orderId) return setError("Link this job to a design or an order.");

    setSaving(true);
    try {
      const design = designs.find((d) => d.id === form.designId);
      await createDigitizingJob({
        jobNumber: form.jobNumber, designId: form.designId, orderId: form.orderId || design?.orderId || "",
        customerId: form.customerId || design?.customerId || "", dueDate: form.dueDate, notes: form.notes,
      });
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save digitizing job.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      await updateDigitizingStatus(id, status);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update status.");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this digitizing job?")) return;
    try {
      await deleteDigitizingJob(id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete job.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Digitizing"
        description="Convert artwork into embroidery-ready designs."
        action={
          <PrimaryButton onClick={openCreate}>
            <span className="flex items-center gap-2"><Plus className="h-4 w-4" /> New Job</span>
          </PrimaryButton>
        }
      />

      {loading ? (
        <p className="text-sm text-slate-500">Loading digitizing jobs…</p>
      ) : jobs.length === 0 ? (
        <EmptyState
          title="No digitizing jobs yet"
          description="Create a digitizing job from an existing design or order."
          action={<PrimaryButton onClick={openCreate}>Create your first job</PrimaryButton>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Job #</th>
                <th className="px-4 py-3">Design</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map((j) => (
                <tr key={j.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{j.jobNumber}</td>
                  <td className="px-4 py-3 text-slate-600">{j.designName || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{j.orderNumber || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{j.customerName || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(j.dueDate)}</td>
                  <td className="px-4 py-3">
                    <select value={j.status} onChange={(e) => handleStatusChange(j.id, e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDelete(j.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <Modal title="New Digitizing Job" onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={error} />
            <div>
              <label className={labelClass()}>Job Number</label>
              <input className={inputClass()} value={form.jobNumber} onChange={(e) => setForm({ ...form, jobNumber: e.target.value })} />
            </div>
            <div>
              <label className={labelClass()}>Design</label>
              <select className={inputClass()} value={form.designId} onChange={(e) => setForm({ ...form, designId: e.target.value })}>
                <option value="">No design selected</option>
                {designs.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass()}>Order</label>
              <select className={inputClass()} value={form.orderId} onChange={(e) => setForm({ ...form, orderId: e.target.value })}>
                <option value="">No order selected</option>
                {orders.map((o) => <option key={o.id} value={o.id}>{o.orderNumber} — {o.customerName}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass()}>Customer</label>
              <select className={inputClass()} value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                <option value="">Inferred from design/order</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass()}>Due Date</label>
              <input type="date" className={inputClass()} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
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
    </div>
  );
}
