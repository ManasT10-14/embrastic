"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  getExpenses, createExpense, updateExpense, deleteExpense, getNextExpenseNumber,
  type ExpenseRow,
} from "@/lib/db";
import {
  formatCurrency, formatDate, todayISO, expenseTotal, expenseGst, parseDateOnly,
} from "@/lib/calculations";
import {
  PageHeader, EmptyState, Modal, ErrorBanner, SuccessBanner, SearchInput,
  FilterSelect, Toolbar, RowAction, inputClass, labelClass, PrimaryButton, SecondaryButton,
} from "@/components/business/ui";

const CATEGORIES = ["Materials", "Maintenance", "Operations", "Transport", "Rent", "Salaries", "Utilities", "Other"];
const METHODS = ["Cash", "UPI", "Bank Transfer", "Card", "Cheque", "Other"];

function emptyForm() {
  return {
    date: todayISO(), category: "Materials", vendor: "", description: "",
    amount: "", gstPercent: "0", paymentMethod: "Cash", reference: "", notes: "",
  };
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  async function load() {
    setLoading(true);
    try {
      setExpenses(await getExpenses());
      setError("");
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
    setEditingId(null);
    setForm(emptyForm());
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(expense: ExpenseRow) {
    setEditingId(expense.id);
    setForm({
      date: expense.date, category: expense.category || "Other", vendor: expense.vendor,
      description: expense.description, amount: String(expense.amount),
      gstPercent: String(expense.gstPercent), paymentMethod: expense.paymentMethod,
      reference: expense.reference, notes: expense.notes,
    });
    setFormError("");
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    const amount = Number(form.amount);
    const gstPercent = Number(form.gstPercent) || 0;
    if (!form.description.trim()) return setFormError("Description is required.");
    if (!form.date) return setFormError("Date is required.");
    if (!Number.isFinite(amount) || amount <= 0) return setFormError("Amount must be a positive number.");
    if (!Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 100) return setFormError("GST % must be between 0 and 100.");

    setSaving(true);
    try {
      const payload = {
        date: form.date, category: form.category, vendor: form.vendor,
        description: form.description, amount, gstPercent,
        paymentMethod: form.paymentMethod, reference: form.reference, notes: form.notes,
      };
      if (editingId) {
        await updateExpense(editingId, payload);
        setNotice("Expense updated.");
      } else {
        const expenseNumber = await getNextExpenseNumber();
        await createExpense({ ...payload, expenseNumber });
        setNotice(`Expense ${expenseNumber} recorded (${formatCurrency(expenseTotal(payload))} including GST).`);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save expense.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(expense: ExpenseRow) {
    if (!confirm(`Delete expense ${expense.expenseNumber}?`)) return;
    setError("");
    try {
      await deleteExpense(expense.id);
      setNotice(`Expense ${expense.expenseNumber} deleted.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete expense.");
    }
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const thisMonth = expenses.filter((e) => {
    const date = parseDateOnly(e.date);
    return !!date && date >= monthStart && date < monthEnd;
  });

  const filtered = expenses.filter((e) => {
    if (categoryFilter && e.category !== categoryFilter) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      e.expenseNumber.toLowerCase().includes(term) ||
      e.description.toLowerCase().includes(term) ||
      e.vendor.toLowerCase().includes(term) ||
      e.category.toLowerCase().includes(term) ||
      e.reference.toLowerCase().includes(term)
    );
  });

  const previewAmount = Number(form.amount) || 0;
  const previewGstPercent = Number(form.gstPercent) || 0;
  const preview = { amount: previewAmount, gstPercent: previewGstPercent };

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

      <ErrorBanner message={error} onDismiss={() => setError("")} />
      <SuccessBanner message={notice} onDismiss={() => setNotice("")} />

      {expenses.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Total spent (all time, incl. GST)</p>
            <p className="text-xl font-bold">{formatCurrency(expenses.reduce((s, e) => s + expenseTotal(e), 0))}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">This month (incl. GST)</p>
            <p className="text-xl font-bold">{formatCurrency(thisMonth.reduce((s, e) => s + expenseTotal(e), 0))}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">GST paid this month (input credit)</p>
            <p className="text-xl font-bold">{formatCurrency(thisMonth.reduce((s, e) => s + expenseGst(e), 0))}</p>
          </div>
        </div>
      )}

      {expenses.length > 0 && (
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search description, vendor, category or reference" />
          <FilterSelect value={categoryFilter} onChange={setCategoryFilter} options={CATEGORIES} allLabel="All categories" />
          <span className="text-xs text-slate-500">{filtered.length} of {expenses.length}</span>
        </Toolbar>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading expenses…</p>
      ) : expenses.length === 0 ? (
        <EmptyState
          title="No expenses recorded"
          description="Record a business expense to keep your financials accurate."
          action={<PrimaryButton onClick={openCreate}>Record your first expense</PrimaryButton>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching expenses" description="Try a different search term or category filter." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">GST</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{e.expenseNumber}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(e.date)}</td>
                  <td className="px-4 py-3 text-slate-600">{e.category || "—"}</td>
                  <td className="px-4 py-3">
                    <div>{e.description}</div>
                    {e.vendor && <div className="text-xs text-slate-400">{e.vendor}</div>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(e.amount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                    {e.gstPercent > 0 ? formatCurrency(expenseGst(e)) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{formatCurrency(expenseTotal(e))}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-3">
                      <RowAction onClick={() => openEdit(e)}><Pencil className="h-3.5 w-3.5" /> Edit</RowAction>
                      <RowAction tone="danger" onClick={() => handleDelete(e)}><Trash2 className="h-3.5 w-3.5" /> Delete</RowAction>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <Modal title={editingId ? "Edit Expense" : "New Expense"} onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={formError} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>Date *</label>
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
                <label className={labelClass()}>Amount before GST *</label>
                <input type="number" min="0.01" step="0.01" className={inputClass()} value={form.amount} placeholder="0.00" onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>GST %</label>
                <input type="number" min="0" max="100" step="0.01" className={inputClass()} value={form.gstPercent} onChange={(e) => setForm({ ...form, gstPercent: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Payment Method</label>
                <select className={inputClass()} value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
                  {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            {previewAmount > 0 && (
              <div className="rounded-md bg-slate-50 px-4 py-3 text-sm">
                <div className="flex justify-between"><span>Amount</span><span className="tabular-nums">{formatCurrency(previewAmount)}</span></div>
                <div className="flex justify-between"><span>GST ({previewGstPercent}%)</span><span className="tabular-nums">{formatCurrency(expenseGst(preview))}</span></div>
                <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-semibold">
                  <span>Total paid</span><span className="tabular-nums">{formatCurrency(expenseTotal(preview))}</span>
                </div>
              </div>
            )}

            <div>
              <label className={labelClass()}>Reference</label>
              <input className={inputClass()} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Bill number, transaction ID, etc." />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setModalOpen(false)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Save Changes" : "Save Expense"}</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
