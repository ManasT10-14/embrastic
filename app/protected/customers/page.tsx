"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, FileText } from "lucide-react";
import {
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  type CustomerRow,
} from "@/lib/db";
import {
  PageHeader, EmptyState, Modal, ErrorBanner, SuccessBanner, SearchInput, Toolbar,
  RowAction, inputClass, labelClass, PrimaryButton, SecondaryButton,
} from "@/components/business/ui";

const EMPTY_FORM = { name: "", phone: "", email: "", address: "", gstNumber: "", notes: "" };

// 15 characters: 2 state digits, 10-char PAN, entity digit, 'Z', checksum.
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setCustomers(await getCustomers());
      setError("");
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
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(customer: CustomerRow) {
    setEditingId(customer.id);
    setForm({
      name: customer.name, phone: customer.phone, email: customer.email,
      address: customer.address, gstNumber: customer.gstNumber, notes: customer.notes,
    });
    setFormError("");
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    const name = form.name.trim();
    if (!name) return setFormError("Customer name is required.");
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      return setFormError("Enter a valid email address.");
    }
    const phoneDigits = form.phone.replace(/\D/g, "");
    if (form.phone && (phoneDigits.length < 7 || phoneDigits.length > 15)) {
      return setFormError("Enter a valid phone number (7–15 digits).");
    }
    const gst = form.gstNumber.trim().toUpperCase();
    if (gst && !GSTIN.test(gst)) {
      return setFormError("That doesn't look like a valid 15-character GSTIN. Leave it blank if the customer isn't registered.");
    }
    const duplicate = customers.find(
      (c) => c.id !== editingId && c.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      return setFormError(`A customer called "${duplicate.name}" already exists. Use a distinguishing name so orders don't get mixed up.`);
    }

    setSaving(true);
    try {
      const payload = { ...form, name, gstNumber: gst };
      if (editingId) {
        await updateCustomer(editingId, payload);
        setNotice(`Saved changes to ${name}.`);
      } else {
        await createCustomer(payload);
        setNotice(`${name} added.`);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save customer.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(customer: CustomerRow) {
    if (!confirm(`Delete ${customer.name}? This cannot be undone.`)) return;
    setNotice("");
    try {
      await deleteCustomer(customer.id);
      setNotice(`${customer.name} deleted.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete customer.");
    }
  }

  const filtered = customers.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.gstNumber.toLowerCase().includes(q) ||
      c.address.toLowerCase().includes(q)
    );
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

      <ErrorBanner message={error} onDismiss={() => setError("")} />
      <SuccessBanner message={notice} onDismiss={() => setNotice("")} />

      {customers.length > 0 && (
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, phone, email or GSTIN" />
          <span className="text-xs text-slate-500">
            {filtered.length} of {customers.length} customer{customers.length === 1 ? "" : "s"}
          </span>
        </Toolbar>
      )}

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
                    <div className="flex justify-end gap-3">
                      <RowAction tone="primary" onClick={() => router.push(`/protected/quotations?customer=${c.id}`)}>
                        <FileText className="h-3.5 w-3.5" /> Quote
                      </RowAction>
                      <RowAction onClick={() => openEdit(c)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </RowAction>
                      <RowAction tone="danger" onClick={() => handleDelete(c)}>
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </RowAction>
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
            <ErrorBanner message={formError} />
            <div>
              <label className={labelClass()}>Name *</label>
              <input className={inputClass()} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass()}>Phone</label>
                <input inputMode="tel" className={inputClass()} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
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
              <input
                className={`${inputClass()} uppercase`}
                value={form.gstNumber}
                onChange={(e) => setForm({ ...form, gstNumber: e.target.value.toUpperCase() })}
                placeholder="27AAAAA0000A1Z5"
              />
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
