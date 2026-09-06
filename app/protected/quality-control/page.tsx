"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  getQCRecords, createQCRecord, deleteQCRecord, getProductionJobs, QC_RESULTS,
  type QCRecordRow, type ProductionJobRow,
} from "@/lib/db";
import { formatDate, todayISO } from "@/lib/calculations";
import {
  PageHeader, EmptyState, Modal, ErrorBanner, SuccessBanner, StatusBadge, SearchInput,
  FilterSelect, Toolbar, RowAction, inputClass, labelClass, PrimaryButton, SecondaryButton,
} from "@/components/business/ui";

const DEFECTS = [
  "Thread break", "Puckering", "Misalignment", "Wrong colour",
  "Loose stitches", "Fabric damage", "Registration off", "Other",
];

function emptyForm() {
  return {
    productionId: "", quantityProduced: "0", quantityAccepted: "0", quantityRejected: "0",
    quantityRework: "0", inspector: "", qcDate: todayISO(), result: "Pending",
    defectTypes: [] as string[], remarks: "",
  };
}

export default function QualityControlPage() {
  const [records, setRecords] = useState<QCRecordRow[]>([]);
  const [productionJobs, setProductionJobs] = useState<ProductionJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [resultFilter, setResultFilter] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [r, p] = await Promise.all([getQCRecords(), getProductionJobs()]);
      setRecords(r);
      setProductionJobs(p);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load QC records.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Arriving from a production job ("QC" action).
  useEffect(() => {
    const jobId = new URLSearchParams(window.location.search).get("job");
    if (!jobId) return;
    window.history.replaceState(null, "", "/protected/quality-control");
    (async () => {
      const jobs = await getProductionJobs();
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return;
      setForm({ ...emptyForm(), productionId: jobId, quantityProduced: String(job.quantityCompleted) });
      setFormError("");
      setModalOpen(true);
    })();
  }, []);

  function openCreate() {
    setForm(emptyForm());
    setFormError("");
    setModalOpen(true);
  }

  /** A production job already knows how many pieces it finished. */
  function selectJob(productionId: string) {
    const job = productionJobs.find((p) => p.id === productionId);
    setForm((f) => ({
      ...f,
      productionId,
      quantityProduced: job ? String(job.quantityCompleted) : f.quantityProduced,
      quantityAccepted: job ? String(job.quantityCompleted) : f.quantityAccepted,
      quantityRejected: "0",
      quantityRework: "0",
    }));
  }

  function toggleDefect(defect: string) {
    setForm((f) => ({
      ...f,
      defectTypes: f.defectTypes.includes(defect)
        ? f.defectTypes.filter((d) => d !== defect)
        : [...f.defectTypes, defect],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.productionId) return setFormError("Select a production job.");

    const produced = Number(form.quantityProduced);
    const accepted = Number(form.quantityAccepted);
    const rejected = Number(form.quantityRejected);
    const rework = Number(form.quantityRework);

    if ([produced, accepted, rejected, rework].some((n) => !Number.isInteger(n) || n < 0)) {
      return setFormError("Enter whole numbers of zero or more.");
    }
    if (produced <= 0) return setFormError("Quantity produced must be greater than zero.");
    if (accepted + rejected + rework > produced) {
      return setFormError(`You've accounted for ${accepted + rejected + rework} pieces but only ${produced} were produced.`);
    }
    if (accepted + rejected + rework < produced) {
      return setFormError(`${produced - (accepted + rejected + rework)} piece(s) unaccounted for — every piece must be accepted, rejected or sent for rework.`);
    }
    if ((rejected > 0 || rework > 0) && form.defectTypes.length === 0) {
      return setFormError("Pick at least one defect type to explain the rejected/rework pieces.");
    }

    const job = productionJobs.find((p) => p.id === form.productionId);
    setSaving(true);
    try {
      await createQCRecord({
        productionId: form.productionId, orderId: job?.orderId ?? "", customerName: job?.customerName ?? "",
        designName: job?.designName ?? "", quantityProduced: produced, quantityAccepted: accepted,
        quantityRejected: rejected, quantityRework: rework, defectTypes: form.defectTypes,
        inspector: form.inspector, qcDate: form.qcDate, result: form.result, remarks: form.remarks,
      });
      setNotice(`Inspection recorded for ${job?.orderNumber ?? "the job"}.`);
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save QC record.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(record: QCRecordRow) {
    if (!confirm("Delete this QC record?")) return;
    setError("");
    try {
      await deleteQCRecord(record.id);
      setNotice("QC record deleted.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete record.");
    }
  }

  const filtered = records.filter((r) => {
    if (resultFilter && r.result !== resultFilter) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      r.orderNumber.toLowerCase().includes(term) ||
      r.customerName.toLowerCase().includes(term) ||
      r.designName.toLowerCase().includes(term) ||
      r.inspector.toLowerCase().includes(term)
    );
  });

  // Jobs that have finished pieces are the only ones worth inspecting.
  const inspectableJobs = productionJobs.filter((p) => p.quantityCompleted > 0);
  const selectedJob = productionJobs.find((p) => p.id === form.productionId);
  const unaccounted =
    (Number(form.quantityProduced) || 0) -
    ((Number(form.quantityAccepted) || 0) + (Number(form.quantityRejected) || 0) + (Number(form.quantityRework) || 0));

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

      <ErrorBanner message={error} onDismiss={() => setError("")} />
      <SuccessBanner message={notice} onDismiss={() => setNotice("")} />

      {records.length > 0 && (
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search order, customer, design or inspector" />
          <FilterSelect value={resultFilter} onChange={setResultFilter} options={QC_RESULTS} allLabel="All results" />
          <span className="text-xs text-slate-500">{filtered.length} of {records.length}</span>
        </Toolbar>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading QC records…</p>
      ) : records.length === 0 ? (
        <EmptyState
          title="No quality checks yet"
          description="Inspect a production job to record accepted/rejected counts and outcome."
          action={<PrimaryButton onClick={openCreate}>Record your first inspection</PrimaryButton>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching records" description="Try a different search term or result filter." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3 text-right">Produced</th>
                <th className="px-4 py-3 text-right">Accepted</th>
                <th className="px-4 py-3 text-right">Rejected</th>
                <th className="px-4 py-3 text-right">Rework</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Result</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{r.orderNumber || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">
                    <div>{r.customerName || "—"}</div>
                    {r.defectTypes.length > 0 && (
                      <div className="text-xs text-slate-400">{r.defectTypes.join(", ")}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.quantityProduced}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-green-700">{r.quantityAccepted}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-red-600">{r.quantityRejected}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-600">{r.quantityRework}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(r.qcDate)}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.result} /></td>
                  <td className="px-4 py-3 text-right">
                    <RowAction tone="danger" onClick={() => handleDelete(r)}><Trash2 className="h-3.5 w-3.5" /> Delete</RowAction>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <Modal title="New Inspection" onClose={() => setModalOpen(false)} wide>
          <form onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={formError} />
            <div>
              <label className={labelClass()}>Production Job *</label>
              <select className={inputClass()} value={form.productionId} onChange={(e) => selectJob(e.target.value)}>
                <option value="">Select a production job</option>
                {inspectableJobs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.orderNumber || "Job"} — {p.customerName} ({p.quantityCompleted} completed)
                  </option>
                ))}
              </select>
              {inspectableJobs.length === 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  No production job has completed pieces yet. Record progress on a job first — you can&apos;t inspect what hasn&apos;t been made.
                </p>
              )}
              {selectedJob && (
                <p className="mt-1 text-xs text-slate-500">
                  {selectedJob.quantityCompleted} completed of {selectedJob.quantityOrdered} in this job.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className={labelClass()}>Produced</label>
                <input type="number" min="0" step="1" className={inputClass()} value={form.quantityProduced} onChange={(e) => setForm({ ...form, quantityProduced: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Accepted</label>
                <input type="number" min="0" step="1" className={inputClass()} value={form.quantityAccepted} onChange={(e) => setForm({ ...form, quantityAccepted: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Rejected</label>
                <input type="number" min="0" step="1" className={inputClass()} value={form.quantityRejected} onChange={(e) => setForm({ ...form, quantityRejected: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Rework</label>
                <input type="number" min="0" step="1" className={inputClass()} value={form.quantityRework} onChange={(e) => setForm({ ...form, quantityRework: e.target.value })} />
              </div>
            </div>
            <p className={`text-xs ${unaccounted === 0 ? "text-slate-500" : "text-amber-700"}`}>
              {unaccounted === 0
                ? "Every produced piece is accounted for."
                : unaccounted > 0
                  ? `${unaccounted} piece(s) not yet accounted for.`
                  : `${Math.abs(unaccounted)} more than were produced.`}
            </p>

            <div>
              <label className={labelClass()}>Defects found</label>
              <div className="flex flex-wrap gap-2">
                {DEFECTS.map((defect) => {
                  const active = form.defectTypes.includes(defect);
                  return (
                    <button
                      key={defect}
                      type="button"
                      onClick={() => toggleDefect(defect)}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        active
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {defect}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className={labelClass()}>Inspector</label>
                <input className={inputClass()} value={form.inspector} onChange={(e) => setForm({ ...form, inspector: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>QC Date</label>
                <input type="date" className={inputClass()} value={form.qcDate} onChange={(e) => setForm({ ...form, qcDate: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Result</label>
                <select className={inputClass()} value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })}>
                  {QC_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
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
