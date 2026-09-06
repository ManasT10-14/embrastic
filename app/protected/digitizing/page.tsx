"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Package } from "lucide-react";
import {
  getDigitizingJobs, createDigitizingJob, updateDigitizingJob, updateDigitizingStatus,
  deleteDigitizingJob, getDesigns, getOrders, getCustomers, getNextDigitizingNumber,
  DIGITIZING_STATUSES,
  type DigitizingJobRow, type DesignRow, type OrderRow, type CustomerRow,
} from "@/lib/db";
import { formatDate, isOverdue } from "@/lib/calculations";
import {
  PageHeader, EmptyState, Modal, ErrorBanner, SuccessBanner, SearchInput,
  FilterSelect, Toolbar, RowAction, inputClass, labelClass, PrimaryButton, SecondaryButton,
} from "@/components/business/ui";

const EMPTY_FORM = { designId: "", orderId: "", customerId: "", dueDate: "", notes: "" };
const DONE = new Set<string>(["Completed"]);

export default function DigitizingPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<DigitizingJobRow[]>([]);
  const [designs, setDesigns] = useState<DesignRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [jobNumber, setJobNumber] = useState("");
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
      const [j, d, o, c] = await Promise.all([getDigitizingJobs(), getDesigns(), getOrders(), getCustomers()]);
      setJobs(j);
      setDesigns(d);
      setOrders(o);
      setCustomers(c);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load digitizing jobs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Arriving from a design row ("Digitize" action).
  useEffect(() => {
    const designId = new URLSearchParams(window.location.search).get("design");
    if (!designId) return;
    window.history.replaceState(null, "", "/protected/digitizing");
    (async () => {
      const [nextNumber, allDesigns] = await Promise.all([getNextDigitizingNumber(), getDesigns()]);
      const design = allDesigns.find((d) => d.id === designId);
      setEditingId(null);
      setJobNumber(nextNumber);
      setForm({
        ...EMPTY_FORM,
        designId,
        orderId: design?.orderId ?? "",
        customerId: design?.customerId ?? "",
      });
      setFormError("");
      setModalOpen(true);
    })();
  }, []);

  async function openCreate() {
    setEditingId(null);
    setJobNumber(await getNextDigitizingNumber());
    setForm(EMPTY_FORM);
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(job: DigitizingJobRow) {
    setEditingId(job.id);
    setJobNumber(job.jobNumber);
    setForm({
      designId: job.designId, orderId: job.orderId, customerId: job.customerId,
      dueDate: job.dueDate, notes: job.notes,
    });
    setFormError("");
    setModalOpen(true);
  }

  /** A design already knows its order and customer — carry both across. */
  function selectDesign(designId: string) {
    const design = designs.find((d) => d.id === designId);
    setForm((f) => ({
      ...f,
      designId,
      orderId: design?.orderId || f.orderId,
      customerId: design?.customerId || f.customerId,
    }));
  }

  function selectOrder(orderId: string) {
    const order = orders.find((o) => o.id === orderId);
    setForm((f) => {
      const design = designs.find((d) => d.id === f.designId);
      return {
        ...f,
        orderId,
        customerId: order?.customerId || f.customerId,
        designId: design && orderId && design.orderId && design.orderId !== orderId ? "" : f.designId,
      };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.designId && !form.orderId) {
      return setFormError("Link this job to a design or an order, otherwise nobody can tell what's being digitized.");
    }

    setSaving(true);
    try {
      const design = designs.find((d) => d.id === form.designId);
      const payload = {
        designId: form.designId,
        orderId: form.orderId || design?.orderId || "",
        customerId: form.customerId || design?.customerId || "",
        dueDate: form.dueDate,
        notes: form.notes,
      };
      if (editingId) {
        await updateDigitizingJob(editingId, payload);
        setNotice("Digitizing job updated.");
      } else {
        await createDigitizingJob({ ...payload, jobNumber });
        setNotice(`Digitizing job ${jobNumber} queued.`);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save digitizing job.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id: string, status: string) {
    setError("");
    try {
      await updateDigitizingStatus(id, status);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status.");
    }
  }

  async function handleDelete(job: DigitizingJobRow) {
    if (!confirm(`Delete digitizing job ${job.jobNumber}?`)) return;
    setError("");
    try {
      await deleteDigitizingJob(job.id);
      setNotice(`Job ${job.jobNumber} deleted.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete job.");
    }
  }

  const filtered = jobs.filter((j) => {
    if (statusFilter && j.status !== statusFilter) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      j.jobNumber.toLowerCase().includes(term) ||
      j.designName.toLowerCase().includes(term) ||
      j.orderNumber.toLowerCase().includes(term) ||
      j.customerName.toLowerCase().includes(term)
    );
  });

  const selectableDesigns = form.orderId
    ? designs.filter((d) => !d.orderId || d.orderId === form.orderId)
    : designs;
  const selectableOrders = form.customerId
    ? orders.filter((o) => o.customerId === form.customerId)
    : orders;

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

      <ErrorBanner message={error} onDismiss={() => setError("")} />
      <SuccessBanner message={notice} onDismiss={() => setNotice("")} />

      {jobs.length > 0 && (
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search job, design, order or customer" />
          <FilterSelect value={statusFilter} onChange={setStatusFilter} options={DIGITIZING_STATUSES} allLabel="All statuses" />
          <span className="text-xs text-slate-500">{filtered.length} of {jobs.length}</span>
        </Toolbar>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading digitizing jobs…</p>
      ) : jobs.length === 0 ? (
        <EmptyState
          title="No digitizing jobs yet"
          description="Create a digitizing job from an existing design or order."
          action={<PrimaryButton onClick={openCreate}>Create your first job</PrimaryButton>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching jobs" description="Try a different search term or status filter." />
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
              {filtered.map((j) => {
                const late = j.dueDate && isOverdue(j.dueDate) && !DONE.has(j.status);
                return (
                  <tr key={j.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{j.jobNumber}</td>
                    <td className="px-4 py-3 text-slate-600">{j.designName || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{j.orderNumber || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{j.customerName || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(j.dueDate)}
                      {late && <span className="ml-1 text-xs font-medium text-red-600">late</span>}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={j.status}
                        onChange={(e) => handleStatusChange(j.id, e.target.value)}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                        aria-label={`Status for ${j.jobNumber}`}
                      >
                        {DIGITIZING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                        {j.status === "Completed" && j.orderId && (
                          <RowAction tone="primary" onClick={() => router.push(`/protected/production?order=${j.orderId}&design=${j.designId}`)}>
                            <Package className="h-3.5 w-3.5" /> To production
                          </RowAction>
                        )}
                        <RowAction onClick={() => openEdit(j)}><Pencil className="h-3.5 w-3.5" /> Edit</RowAction>
                        <RowAction tone="danger" onClick={() => handleDelete(j)}><Trash2 className="h-3.5 w-3.5" /> Delete</RowAction>
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
        <Modal title={editingId ? `Edit ${jobNumber}` : `New Digitizing Job ${jobNumber}`} onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={formError} />
            <div>
              <label className={labelClass()}>Design</label>
              <select className={inputClass()} value={form.designId} onChange={(e) => selectDesign(e.target.value)}>
                <option value="">No design selected</option>
                {selectableDesigns.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass()}>Order</label>
              <select className={inputClass()} value={form.orderId} onChange={(e) => selectOrder(e.target.value)}>
                <option value="">No order selected</option>
                {selectableOrders.map((o) => <option key={o.id} value={o.id}>{o.orderNumber} — {o.customerName}</option>)}
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
              <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Save Changes" : "Save Job"}</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
