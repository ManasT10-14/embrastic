"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import {
  getQCRecords, createQCRecord, deleteQCRecord, getProductionJobs,
  type QCRecordRow, type ProductionJobRow,
} from "@/lib/db";
import { formatDate } from "@/lib/calculations";
import { PageHeader, EmptyState, Modal, ErrorBanner, StatusBadge, inputClass, labelClass, PrimaryButton, SecondaryButton } from "@/components/business/ui";

const EMPTY_FORM = { productionId: "", quantityProduced: "0", quantityAccepted: "0", quantityRejected: "0", quantityRework: "0", inspector: "", qcDate: "", result: "Pending", remarks: "" };

export default function QualityControlPage() {
  const [records, setRecords] = useState<QCRecordRow[]>([]);
  const [productionJobs, setProductionJobs] = useState<ProductionJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [r, p] = await Promise.all([getQCRecords(), getProductionJobs()]);
      setRecords(r);
      setProductionJobs(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load QC records.");
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
    if (!form.productionId) return setError("Select a production job.");

    const job = productionJobs.find((p) => p.id === form.productionId);
    setSaving(true);
    try {
      await createQCRecord({
        productionId: form.productionId, orderId: job?.orderId ?? "", customerName: job?.customerName ?? "",
        designName: job?.designName ?? "", quantityProduced: Number(form.quantityProduced),
        quantityAccepted: Number(form.quantityAccepted), quantityRejected: Number(form.quantityRejected),
        quantityRework: Number(form.quantityRework), defectTypes: [], inspector: form.inspector,
        qcDate: form.qcDate, result: form.result, remarks: form.remarks,
      });
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save QC record.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this QC record?")) return;
    try {
      await deleteQCRecord(id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete record.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quality Control"
        description="Inspect finished production before delivery."
        action={
          <PrimaryButton onClick={openCreate}>
            <span className="flex items-center gap-2"><Plus className="h-4 w-4" /> New Inspection</span>
          </PrimaryButton>
        }
      />

      {loading ? (
        <p className="text-sm text-slate-500">Loading QC records…</p>
      ) : records.length === 0 ? (
        <EmptyState
          title="No quality checks yet"
          description="Inspect a production job to record accepted/rejected counts and outcome."
          action={<PrimaryButton onClick={openCreate}>Record your first inspection</PrimaryButton>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Produced</th>
                <th className="px-4 py-3">Accepted</th>
                <th className="px-4 py-3">Rejected</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Result</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {records.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{r.orderNumber || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{r.customerName || "—"}</td>
                  <td className="px-4 py-3">{r.quantityProduced}</td>
                  <td className="px-4 py-3 text-green-700">{r.quantityAccepted}</td>
                  <td className="px-4 py-3 text-red-600">{r.quantityRejected}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(r.qcDate)}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.result} /></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDelete(r.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <Modal title="New Inspection" onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={error} />
            <div>
              <label className={labelClass()}>Production Job *</label>
              <select className={inputClass()} value={form.productionId} onChange={(e) => setForm({ ...form, productionId: e.target.value })}>
                <option value="">Select a production job</option>
                {productionJobs.map((p) => <option key={p.id} value={p.id}>{p.orderNumber} — {p.customerName}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>Quantity Produced</label>
                <input type="number" min="0" className={inputClass()} value={form.quantityProduced} onChange={(e) => setForm({ ...form, quantityProduced: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Quantity Accepted</label>
                <input type="number" min="0" className={inputClass()} value={form.quantityAccepted} onChange={(e) => setForm({ ...form, quantityAccepted: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Quantity Rejected</label>
                <input type="number" min="0" className={inputClass()} value={form.quantityRejected} onChange={(e) => setForm({ ...form, quantityRejected: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Quantity Rework</label>
                <input type="number" min="0" className={inputClass()} value={form.quantityRework} onChange={(e) => setForm({ ...form, quantityRework: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>Inspector</label>
                <input className={inputClass()} value={form.inspector} onChange={(e) => setForm({ ...form, inspector: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>QC Date</label>
                <input type="date" className={inputClass()} value={form.qcDate} onChange={(e) => setForm({ ...form, qcDate: e.target.value })} />
              </div>
            </div>
            <div>
              <label className={labelClass()}>Result</label>
              <select className={inputClass()} value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })}>
                <option value="Pending">Pending</option>
                <option value="Pass">Pass</option>
                <option value="Rework">Rework</option>
                <option value="Fail">Fail</option>
              </select>
            </div>
            <div>
              <label className={labelClass()}>Remarks</label>
              <textarea className={inputClass()} rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setModalOpen(false)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : "Save Inspection"}</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
