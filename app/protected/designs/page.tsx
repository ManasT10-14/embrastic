"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, PenTool } from "lucide-react";
import {
  getDesigns, createDesign, updateDesign, updateDesignStatus, deleteDesign,
  getCustomers, getOrders, getNextDesignCode, DESIGN_STATUSES,
  type DesignRow, type CustomerRow, type OrderRow,
} from "@/lib/db";
import {
  PageHeader, EmptyState, Modal, ErrorBanner, SuccessBanner, SearchInput,
  FilterSelect, Toolbar, RowAction, inputClass, labelClass, PrimaryButton, SecondaryButton,
} from "@/components/business/ui";

const PLACEMENTS = ["Left Chest", "Right Chest", "Full Front", "Back", "Sleeve", "Cap Front", "Collar", "Other"];
const FORMATS = ["DST", "EMB", "PES", "JEF", "EXP", "VP3"];

const EMPTY_FORM = {
  code: "", name: "", customerId: "", orderId: "", placement: "Left Chest",
  width: "0", height: "0", stitchCount: "0", threadColors: "", digitizer: "",
  fileFormat: "DST", notes: "",
};

export default function DesignsPage() {
  const router = useRouter();
  const [designs, setDesigns] = useState<DesignRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
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
      const [d, c, o] = await Promise.all([getDesigns(), getCustomers(), getOrders()]);
      setDesigns(d);
      setCustomers(c);
      setOrders(o);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load designs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function openCreate() {
    setEditingId(null);
    setFormError("");
    setForm({ ...EMPTY_FORM, code: await getNextDesignCode() });
    setModalOpen(true);
  }

  function openEdit(design: DesignRow) {
    setEditingId(design.id);
    setForm({
      code: design.code, name: design.name, customerId: design.customerId, orderId: design.orderId,
      placement: design.placement || "Left Chest", width: String(design.width), height: String(design.height),
      stitchCount: String(design.stitchCount), threadColors: design.threadColors,
      digitizer: design.digitizer, fileFormat: design.fileFormat || "DST", notes: design.notes,
    });
    setFormError("");
    setModalOpen(true);
  }

  /** Picking an order settles which customer this design is for. */
  function selectOrder(orderId: string) {
    const order = orders.find((o) => o.id === orderId);
    setForm((f) => ({
      ...f,
      orderId,
      customerId: order?.customerId || f.customerId,
      name: f.name || order?.product || "",
    }));
  }

  /** Changing the customer drops an order that belongs to somebody else. */
  function selectCustomer(customerId: string) {
    setForm((f) => {
      const order = orders.find((o) => o.id === f.orderId);
      return { ...f, customerId, orderId: order && order.customerId !== customerId ? "" : f.orderId };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.code.trim()) return setFormError("Design code is required.");
    if (!form.name.trim()) return setFormError("Design name is required.");
    if (!form.customerId) return setFormError("Select a customer.");

    const width = Number(form.width);
    const height = Number(form.height);
    const stitchCount = Number(form.stitchCount);
    if ([width, height].some((n) => !Number.isFinite(n) || n < 0)) return setFormError("Width and height must be zero or more.");
    if (!Number.isFinite(stitchCount) || stitchCount < 0) return setFormError("Stitch count must be zero or more.");

    const duplicate = designs.find((d) => d.id !== editingId && d.code.trim().toLowerCase() === form.code.trim().toLowerCase());
    if (duplicate) return setFormError(`Design code ${duplicate.code} is already in use.`);

    setSaving(true);
    try {
      const payload = {
        code: form.code, name: form.name, customerId: form.customerId, orderId: form.orderId,
        placement: form.placement, width, height, stitchCount, threadColors: form.threadColors,
        digitizer: form.digitizer, fileFormat: form.fileFormat, notes: form.notes,
      };
      if (editingId) {
        await updateDesign(editingId, payload);
        setNotice("Design updated.");
      } else {
        await createDesign(payload);
        setNotice(`Design ${form.code} added.`);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save design.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id: string, status: string) {
    setError("");
    try {
      await updateDesignStatus(id, status);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status.");
    }
  }

  async function handleDelete(design: DesignRow) {
    if (!confirm(`Delete design ${design.code}?`)) return;
    setError("");
    try {
      await deleteDesign(design.id);
      setNotice(`Design ${design.code} deleted.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete design.");
    }
  }

  const filtered = designs.filter((d) => {
    if (statusFilter && d.status !== statusFilter) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      d.code.toLowerCase().includes(term) ||
      d.name.toLowerCase().includes(term) ||
      d.customerName.toLowerCase().includes(term) ||
      d.orderNumber.toLowerCase().includes(term)
    );
  });

  const selectableOrders = form.customerId
    ? orders.filter((o) => o.customerId === form.customerId)
    : orders;

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

      <ErrorBanner message={error} onDismiss={() => setError("")} />
      <SuccessBanner message={notice} onDismiss={() => setNotice("")} />

      {designs.length > 0 && (
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search code, name, customer or order" />
          <FilterSelect value={statusFilter} onChange={setStatusFilter} options={DESIGN_STATUSES} allLabel="All statuses" />
          <span className="text-xs text-slate-500">{filtered.length} of {designs.length}</span>
        </Toolbar>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading designs…</p>
      ) : designs.length === 0 ? (
        <EmptyState
          title="No designs yet"
          description="Add a design and link it to a customer and order to start tracking its workflow."
          action={<PrimaryButton onClick={openCreate}>Add your first design</PrimaryButton>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching designs" description="Try a different search term or status filter." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Stitches</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{d.code}</td>
                  <td className="px-4 py-3">
                    <div>{d.name}</div>
                    <div className="text-xs text-slate-400">{d.placement}{d.width > 0 || d.height > 0 ? ` · ${d.width}×${d.height} cm` : ""}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{d.customerName || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{d.orderNumber || "—"}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{d.stitchCount ? d.stitchCount.toLocaleString("en-IN") : "—"}</td>
                  <td className="px-4 py-3">
                    <select
                      value={d.status}
                      onChange={(e) => handleStatusChange(d.id, e.target.value)}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                      aria-label={`Status for ${d.code}`}
                    >
                      {DESIGN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                      <RowAction tone="primary" onClick={() => router.push(`/protected/digitizing?design=${d.id}`)}>
                        <PenTool className="h-3.5 w-3.5" /> Digitize
                      </RowAction>
                      <RowAction onClick={() => openEdit(d)}><Pencil className="h-3.5 w-3.5" /> Edit</RowAction>
                      <RowAction tone="danger" onClick={() => handleDelete(d)}><Trash2 className="h-3.5 w-3.5" /> Delete</RowAction>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <Modal title={editingId ? `Edit Design ${form.code}` : "New Design"} onClose={() => setModalOpen(false)} wide>
          <form onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={formError} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                <select className={inputClass()} value={form.customerId} onChange={(e) => selectCustomer(e.target.value)}>
                  <option value="">Select a customer</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass()}>Order</label>
                <select className={inputClass()} value={form.orderId} onChange={(e) => selectOrder(e.target.value)}>
                  <option value="">Not linked to an order</option>
                  {selectableOrders.map((o) => <option key={o.id} value={o.id}>{o.orderNumber} — {o.product}</option>)}
                </select>
                {form.customerId && selectableOrders.length === 0 && (
                  <p className="mt-1 text-xs text-slate-500">This customer has no orders yet.</p>
                )}
              </div>
              <div>
                <label className={labelClass()}>Placement</label>
                <select className={inputClass()} value={form.placement} onChange={(e) => setForm({ ...form, placement: e.target.value })}>
                  {PLACEMENTS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass()}>File Format</label>
                <select className={inputClass()} value={form.fileFormat} onChange={(e) => setForm({ ...form, fileFormat: e.target.value })}>
                  {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass()}>Width (cm)</label>
                <input type="number" min="0" step="0.1" className={inputClass()} value={form.width} onChange={(e) => setForm({ ...form, width: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Height (cm)</label>
                <input type="number" min="0" step="0.1" className={inputClass()} value={form.height} onChange={(e) => setForm({ ...form, height: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Stitch Count</label>
                <input type="number" min="0" step="1" className={inputClass()} value={form.stitchCount} onChange={(e) => setForm({ ...form, stitchCount: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Thread Colors</label>
                <input className={inputClass()} value={form.threadColors} onChange={(e) => setForm({ ...form, threadColors: e.target.value })} placeholder="e.g. Navy, Gold, White" />
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
              <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Save Changes" : "Save Design"}</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
