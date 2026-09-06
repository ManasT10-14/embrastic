"use client";

import { useEffect, useState } from "react";
import { Plus, Search, Pencil, Trash2 } from "lucide-react";
import {
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  type CustomerRow,
} from "@/lib/db";
import { PageHeader, EmptyState, Modal, ErrorBanner, inputClass, labelClass, PrimaryButton, SecondaryButton } from "@/components/business/ui";

const EMPTY_FORM = { name: "", phone: "", email: "", address: "", gstNumber: "", notes: "" };

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setCustomers(await getCustomers());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load customers.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
    setModalOpen(true);
  }

  function openEdit(customer: CustomerRow) {
    setEditingId(customer.id);
    setForm({
      name: customer.name, phone: customer.phone, email: customer.email,
      address: customer.address, gstNumber: customer.gstNumber, notes: customer.notes,
    });
    setError("");
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!form.name.trim()) {
      setError("Customer name is required.");
      return;
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError("Enter a valid email address.");
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await updateCustomer(editingId, form);
      } else {
        await createCustomer(form);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save customer.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this customer? This cannot be undone.")) return;
    try {
      await deleteCustomer(id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete customer.");
    }
  }

  const filtered = customers.filter((c) => {
    const q = search.toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.email.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Your customer database — reused across quotations, orders and invoices."
        action={
          <PrimaryButton onClick={openCreate}>
            <span className="flex items-center gap-2"><Plus className="h-4 w-4" /> Add Customer</span>
          </PrimaryButton>
        }
      />

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone or email"
          className={`${inputClass()} pl-9`}
        />
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading customers…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={customers.length === 0 ? "No customers yet" : "No customers found"}
          description={customers.length === 0 ? "Add your first customer to get started." : "Try a different search term."}
          action={customers.length === 0 ? <PrimaryButton onClick={openCreate}>Add your first customer</PrimaryButton> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">GST Number</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-slate-600">{c.phone || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{c.email || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{c.gstNumber || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => openEdit(c)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => handleDelete(c.id)} className="rounded p-1.5 text-red-500 hover:bg-red-50" aria-label="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <Modal title={editingId ? "Edit Customer" : "Add Customer"} onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={error} />
            <div>
              <label className={labelClass()}>Name *</label>
              <input className={inputClass()} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>Phone</label>
                <input className={inputClass()} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Email</label>
                <input type="email" className={inputClass()} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div>
              <label className={labelClass()}>Address</label>
              <input className={inputClass()} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div>
              <label className={labelClass()}>GST Number</label>
              <input className={inputClass()} value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value })} />
            </div>
            <div>
              <label className={labelClass()}>Notes</label>
              <textarea className={inputClass()} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setModalOpen(false)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : "Save Customer"}</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
