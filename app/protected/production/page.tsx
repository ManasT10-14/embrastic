"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Package, Trash2, ClipboardCheck, Gauge } from "lucide-react";
import {
  getProductionJobs, createProductionJob, updateProductionJob, deleteProductionJob,
  recordMaterialUsage, getOrders, getDesigns, getInventoryItems, PRODUCTION_STATUSES,
  type ProductionJobRow, type OrderRow, type DesignRow, type InventoryItemRow,
} from "@/lib/db";
import {
  PageHeader, EmptyState, Modal, ErrorBanner, SuccessBanner, SearchInput,
  FilterSelect, Toolbar, RowAction, inputClass, labelClass, PrimaryButton, SecondaryButton,
} from "@/components/business/ui";

const EMPTY_FORM = { orderId: "", designId: "", machine: "", operator: "", quantityOrdered: "1", notes: "" };

export default function ProductionPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<ProductionJobRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [designs, setDesigns] = useState<DesignRow[]>([]);
  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [progressJob, setProgressJob] = useState<ProductionJobRow | null>(null);
  const [progressForm, setProgressForm] = useState({ completed: "0", rejected: "0", rework: "0" });
  const [progressError, setProgressError] = useState("");

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
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load production jobs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Arriving from a completed digitizing job ("To production" action).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("order");
    if (!orderId) return;
    window.history.replaceState(null, "", "/protected/production");
    (async () => {
      const allOrders = await getOrders();
      const order = allOrders.find((o) => o.id === orderId);
      setForm({
        ...EMPTY_FORM,
        orderId,
        designId: params.get("design") ?? "",
        quantityOrdered: String(order?.quantity ?? 1),
      });
      setFormError("");
      setModalOpen(true);
    })();
  }, []);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError("");
    setModalOpen(true);
  }

  /** The order already says how many pieces are due — don't make the owner retype it. */
  function selectOrder(orderId: string) {
    const order = orders.find((o) => o.id === orderId);
    setForm((f) => {
      const design = designs.find((d) => d.id === f.designId);
      return {
        ...f,
        orderId,
        quantityOrdered: order ? String(order.quantity) : f.quantityOrdered,
        designId: design && design.orderId && design.orderId !== orderId ? "" : f.designId,
      };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    const quantityOrdered = Number(form.quantityOrdered);
    if (!form.orderId) return setFormError("Select an order — a production job has to say what it's making.");
    if (!Number.isInteger(quantityOrdered) || quantityOrdered <= 0) return setFormError("Quantity must be a whole number greater than zero.");

    setSaving(true);
    try {
      const order = orders.find((o) => o.id === form.orderId);
      const design = designs.find((d) => d.id === form.designId);
      await createProductionJob({
        orderId: form.orderId, designId: form.designId, customerName: order?.customerName ?? "",
        product: order?.product ?? "", designName: design?.name ?? "", quantityOrdered,
        machine: form.machine, operator: form.operator, notes: form.notes,
      });
      setNotice(`Production job queued for ${order?.orderNumber ?? "the order"}.`);
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save production job.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id: string, status: string) {
    setError("");
    try {
      await updateProductionJob(id, { status });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update job.");
    }
  }

  function openProgress(job: ProductionJobRow) {
    setProgressJob(job);
    setProgressForm({
      completed: String(job.quantityCompleted),
      rejected: String(job.quantityRejected),
      rework: String(job.quantityRework),
    });
    setProgressError("");
  }

  async function handleProgress(e: React.FormEvent) {
    e.preventDefault();
    if (!progressJob) return;
    setProgressError("");

    const completed = Number(progressForm.completed);
    const rejected = Number(progressForm.rejected);
    const rework = Number(progressForm.rework);
    if ([completed, rejected, rework].some((n) => !Number.isInteger(n) || n < 0)) {
      return setProgressError("Enter whole numbers of zero or more.");
    }
    if (completed + rejected + rework > progressJob.quantityOrdered) {
      return setProgressError(
        `That accounts for ${completed + rejected + rework} pieces, but only ${progressJob.quantityOrdered} were ordered into this job.`,
      );
    }

    try {
      await updateProductionJob(progressJob.id, {
        quantityCompleted: completed, quantityRejected: rejected, quantityRework: rework,
      });
      setNotice("Production progress updated.");
      setProgressJob(null);
      await load();
    } catch (err) {
      setProgressError(err instanceof Error ? err.message : "Failed to update progress.");
    }
  }

  async function handleDelete(job: ProductionJobRow) {
    if (!confirm(`Delete the production job for ${job.orderNumber || "this order"}?`)) return;
    setError("");
    try {
      await deleteProductionJob(job.id);
      setNotice("Production job deleted.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete job.");
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
    if (!Number.isInteger(quantity) || quantity <= 0) return setMaterialError("Quantity must be a whole number greater than zero.");
    if (!materialJob) return;

    const item = items.find((i) => i.id === materialForm.itemId);
    if (item && quantity > item.currentStock) {
      return setMaterialError(`Only ${item.currentStock} ${item.unit} of ${item.name} in stock.`);
    }

    try {
      await recordMaterialUsage({
        productionJobLabel: materialJob.orderNumber || "job",
        itemId: materialForm.itemId, quantity,
      });
      setNotice(`${quantity} ${item?.unit ?? "unit"}(s) of ${item?.name ?? "material"} consumed.`);
      setMaterialJob(null);
      await load();
    } catch (err) {
      setMaterialError(err instanceof Error ? err.message : "Failed to record material usage.");
    }
  }

  const filtered = jobs.filter((j) => {
    if (statusFilter && j.status !== statusFilter) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      j.orderNumber.toLowerCase().includes(term) ||
      j.customerName.toLowerCase().includes(term) ||
      j.product.toLowerCase().includes(term) ||
      j.designName.toLowerCase().includes(term) ||
      j.machine.toLowerCase().includes(term) ||
      j.operator.toLowerCase().includes(term)
    );
  });

  const selectableDesigns = form.orderId
    ? designs.filter((d) => !d.orderId || d.orderId === form.orderId)
    : designs;

  const progressRemaining = progressJob
    ? progressJob.quantityOrdered -
      ((Number(progressForm.completed) || 0) + (Number(progressForm.rejected) || 0) + (Number(progressForm.rework) || 0))
    : 0;

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

      <ErrorBanner message={error} onDismiss={() => setError("")} />
      <SuccessBanner message={notice} onDismiss={() => setNotice("")} />

      {jobs.length > 0 && (
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search order, customer, design, machine or operator" />
          <FilterSelect value={statusFilter} onChange={setStatusFilter} options={PRODUCTION_STATUSES} allLabel="All statuses" />
          <span className="text-xs text-slate-500">{filtered.length} of {jobs.length}</span>
        </Toolbar>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading production jobs…</p>
      ) : jobs.length === 0 ? (
        <EmptyState
          title="No production jobs"
          description="Create a production job from an existing order and design."
          action={<PrimaryButton onClick={openCreate}>Create your first job</PrimaryButton>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching jobs" description="Try a different search term or status filter." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Design</th>
                <th className="px-4 py-3">Progress</th>
                <th className="px-4 py-3">Machine / Operator</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((j) => {
                const accounted = j.quantityCompleted + j.quantityRejected + j.quantityRework;
                const percent = j.quantityOrdered > 0 ? Math.round((accounted / j.quantityOrdered) * 100) : 0;
                return (
                  <tr key={j.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{j.orderNumber || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{j.customerName || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{j.designName || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="min-w-[8rem]">
                        <div className="flex justify-between text-xs">
                          <span className="tabular-nums">{j.quantityCompleted} / {j.quantityOrdered}</span>
                          <span className="text-slate-400">{percent}%</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100">
                          <div className="h-1.5 rounded-full bg-slate-900" style={{ width: `${Math.min(100, percent)}%` }} />
                        </div>
                        {(j.quantityRejected > 0 || j.quantityRework > 0) && (
                          <div className="mt-1 text-xs text-slate-500">
                            {j.quantityRejected > 0 && <span className="text-red-600">{j.quantityRejected} rejected</span>}
                            {j.quantityRejected > 0 && j.quantityRework > 0 && " · "}
                            {j.quantityRework > 0 && <span className="text-amber-600">{j.quantityRework} rework</span>}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {j.machine || "—"}{j.operator ? ` · ${j.operator}` : ""}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={j.status}
                        onChange={(e) => handleStatusChange(j.id, e.target.value)}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                        aria-label={`Status for ${j.orderNumber}`}
                      >
                        {PRODUCTION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                        <RowAction onClick={() => openProgress(j)}><Gauge className="h-3.5 w-3.5" /> Progress</RowAction>
                        <RowAction onClick={() => openMaterialUsage(j)}><Package className="h-3.5 w-3.5" /> Material</RowAction>
                        {j.quantityCompleted > 0 && (
                          <RowAction tone="primary" onClick={() => router.push(`/protected/quality-control?job=${j.id}`)}>
                            <ClipboardCheck className="h-3.5 w-3.5" /> QC
                          </RowAction>
                        )}
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
        <Modal title="New Production Job" onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={formError} />
            <div>
              <label className={labelClass()}>Order *</label>
              <select className={inputClass()} value={form.orderId} onChange={(e) => selectOrder(e.target.value)}>
                <option value="">Select an order</option>
                {orders.map((o) => <option key={o.id} value={o.id}>{o.orderNumber} — {o.customerName} ({o.product})</option>)}
              </select>
              {orders.length === 0 && <p className="mt-1 text-xs text-amber-700">Create an order first.</p>}
            </div>
            <div>
              <label className={labelClass()}>Design</label>
              <select className={inputClass()} value={form.designId} onChange={(e) => setForm({ ...form, designId: e.target.value })}>
                <option value="">No design selected</option>
                {selectableDesigns.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>Quantity to produce *</label>
                <input type="number" min="1" step="1" className={inputClass()} value={form.quantityOrdered} onChange={(e) => setForm({ ...form, quantityOrdered: e.target.value })} />
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

      {progressJob && (
        <Modal title={`Progress — ${progressJob.orderNumber || "Job"}`} onClose={() => setProgressJob(null)}>
          <form onSubmit={handleProgress} className="space-y-4">
            <ErrorBanner message={progressError} />
            <p className="text-sm text-slate-500">
              {progressJob.quantityOrdered} piece{progressJob.quantityOrdered === 1 ? "" : "s"} in this job. Every piece is either
              completed, rejected or sent for rework.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelClass()}>Completed</label>
                <input type="number" min="0" step="1" className={inputClass()} value={progressForm.completed} onChange={(e) => setProgressForm({ ...progressForm, completed: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Rejected</label>
                <input type="number" min="0" step="1" className={inputClass()} value={progressForm.rejected} onChange={(e) => setProgressForm({ ...progressForm, rejected: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Rework</label>
                <input type="number" min="0" step="1" className={inputClass()} value={progressForm.rework} onChange={(e) => setProgressForm({ ...progressForm, rework: e.target.value })} />
              </div>
            </div>
            <p className={`text-sm ${progressRemaining < 0 ? "text-red-600" : "text-slate-500"}`}>
              {progressRemaining < 0
                ? `${Math.abs(progressRemaining)} more than the job holds.`
                : progressRemaining === 0
                  ? "All pieces accounted for — the job will be marked Completed."
                  : `${progressRemaining} still to go.`}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setProgressJob(null)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit">Save Progress</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}

      {materialJob && (
        <Modal title={`Record Material Usage — ${materialJob.orderNumber || "Job"}`} onClose={() => setMaterialJob(null)}>
          <form onSubmit={handleRecordMaterial} className="space-y-4">
            <ErrorBanner message={materialError} />
            {items.length === 0 ? (
              <>
                <p className="text-sm text-slate-500">No inventory items yet — add materials in Inventory first.</p>
                <div className="flex justify-end pt-2">
                  <SecondaryButton onClick={() => setMaterialJob(null)}>Close</SecondaryButton>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className={labelClass()}>Material *</label>
                  <select className={inputClass()} value={materialForm.itemId} onChange={(e) => setMaterialForm({ ...materialForm, itemId: e.target.value })}>
                    <option value="">Select an item</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id} disabled={i.currentStock <= 0}>
                        {i.name} ({i.currentStock} {i.unit} in stock){i.currentStock <= 0 ? " — out of stock" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass()}>Quantity Used *</label>
                  <input type="number" min="1" step="1" className={inputClass()} value={materialForm.quantity} onChange={(e) => setMaterialForm({ ...materialForm, quantity: e.target.value })} />
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
