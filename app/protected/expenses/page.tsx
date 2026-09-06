"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { getExpenses, createExpense, deleteExpense, getNextExpenseNumber, type ExpenseRow } from "@/lib/db";
import { formatCurrency, formatDate } from "@/lib/calculations";
import { PageHeader, EmptyState, Modal, ErrorBanner, inputClass, labelClass, PrimaryButton, SecondaryButton } from "@/components/business/ui";

const CATEGORIES = ["Materials", "Maintenance", "Operations", "Transport", "Rent", "Salaries", "Utilities", "Other"];
const METHODS = ["Cash", "UPI", "Bank Transfer", "Card", "Other"];
const EMPTY_FORM = { date: new Date().toISOString().slice(0, 10), category: "Materials", vendor: "", description: "", amount: "0", gstPercent: "0", paymentMethod: "Cash", reference: "", notes: "" };

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setExpenses(await getExpenses());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load expenses.");
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
    const amount = Number(form.amount);
    if (!form.description.trim()) return setError("Description is required.");
    if (!Number.isFinite(amount) || amount <= 0) return setError("Amount must be a positive number.");

    setSaving(true);
    try {
      const expenseNumber = await getNextExpenseNumber();
      await createExpense({
        expenseNumber, date: form.date, category: form.category, vendor: form.vendor,
        description: form.description, amount, gstPercent: Number(form.gstPercent) || 0,
        paymentMethod: form.paymentMethod, reference: form.reference, notes: form.notes,
      });
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save expense.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this expense?")) return;
    try {
      await deleteExpense(id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete expense.");
    }
  }

  const totalThisMonth = expenses
    .filter((e) => new Date(e.date).getMonth() === new Date().getMonth() && new Date(e.date).getFullYear() === new Date().getFullYear())
    .reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Track business costs — materials, operations, transport and more."
        action={
          <PrimaryButton onClick={openCreate}>
            <span className="flex items-center gap-2"><Plus className="h-4 w-4" /> New Expense</span>
          </PrimaryButton>
        }
      />

      {expenses.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Total Expenses</p><p className="text-xl font-bold">{formatCurrency(expenses.reduce((s, e) => s + e.amount, 0))}</p></div>
          <div className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">This Month</p><p className="text-xl font-bold">{formatCurrency(totalThisMonth)}</p></div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading expenses…</p>
      ) : expenses.length === 0 ? (
        <EmptyState
          title="No expenses recorded"
          description="Record a business expense to keep your financials accurate."
          action={<PrimaryButton onClick={openCreate}>Record your first expense</PrimaryButton>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {expenses.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{e.expenseNumber}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(e.date)}</td>
                  <td className="px-4 py-3 text-slate-600">{e.category}</td>
                  <td className="px-4 py-3">{e.description}</td>
                  <td className="px-4 py-3">{formatCurrency(e.amount)}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDelete(e.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <Modal title="New Expense" onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={error} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>Date</label>
                <input type="date" className={inputClass()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Category</label>
                <select className={inputClass()} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass()}>Description *</label>
              <input className={inputClass()} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>Vendor</label>
                <input className={inputClass()} value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Amount *</label>
                <input type="number" min="0" step="0.01" className={inputClass()} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>GST %</label>
                <input type="number" min="0" step="0.01" className={inputClass()} value={form.gstPercent} onChange={(e) => setForm({ ...form, gstPercent: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Payment Method</label>
                <select className={inputClass()} value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
                  {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass()}>Reference</label>
              <input className={inputClass()} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setModalOpen(false)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : "Save Expense"}</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
