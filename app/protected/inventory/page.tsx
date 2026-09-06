"use client";

import { useEffect, useState } from "react";
import { Plus, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import {
  getInventoryItems, createInventoryItem, deleteInventoryItem, getStockTransactions, recordStockMovement,
  type InventoryItemRow, type StockTransactionRow,
} from "@/lib/db";
import { formatCurrency, formatDate } from "@/lib/calculations";
import { PageHeader, EmptyState, Modal, ErrorBanner, inputClass, labelClass, PrimaryButton, SecondaryButton } from "@/components/business/ui";

const EMPTY_FORM = { sku: "", name: "", category: "", unit: "Pcs", openingStock: "0", minimumStock: "0", purchasePrice: "0", supplier: "", notes: "" };

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [transactions, setTransactions] = useState<StockTransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [moveOpen, setMoveOpen] = useState(false);
  const [moveForm, setMoveForm] = useState({ itemId: "", type: "IN" as "IN" | "OUT", quantity: "1", reference: "", notes: "" });
  const [moveError, setMoveError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [i, t] = await Promise.all([getInventoryItems(), getStockTransactions()]);
      setItems(i);
      setTransactions(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inventory.");
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
    if (!form.sku.trim() || !form.name.trim()) return setError("SKU and name are required.");

    setSaving(true);
    try {
      await createInventoryItem({
        sku: form.sku, name: form.name, category: form.category, unit: form.unit,
        openingStock: Number(form.openingStock), minimumStock: Number(form.minimumStock),
        purchasePrice: Number(form.purchasePrice), supplier: form.supplier, notes: form.notes,
      });
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save item.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this inventory item? Its stock history will remain but no longer be linked.")) return;
    try {
      await deleteInventoryItem(id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete item.");
    }
  }

  function openMove() {
    setMoveForm({ itemId: "", type: "IN", quantity: "1", reference: "", notes: "" });
    setMoveError("");
    setMoveOpen(true);
  }

  async function handleMove(e: React.FormEvent) {
    e.preventDefault();
    setMoveError("");
    const quantity = Number(moveForm.quantity);
    if (!moveForm.itemId) return setMoveError("Select an item.");
    if (!Number.isFinite(quantity) || quantity <= 0) return setMoveError("Quantity must be a positive number.");

    try {
      await recordStockMovement({ itemId: moveForm.itemId, type: moveForm.type, quantity, reference: moveForm.reference, notes: moveForm.notes });
      setMoveOpen(false);
      await load();
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : "Failed to record movement.");
    }
  }

  const lowStock = items.filter((i) => i.currentStock <= i.minimumStock);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Materials used in embroidery production — thread, backing, garments and more."
        action={
          <div className="flex gap-2">
            <SecondaryButton onClick={openMove}>Stock Movement</SecondaryButton>
            <PrimaryButton onClick={openCreate}>
              <span className="flex items-center gap-2"><Plus className="h-4 w-4" /> New Item</span>
            </PrimaryButton>
          </div>
        }
      />

      {lowStock.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {lowStock.length} item{lowStock.length > 1 ? "s" : ""} at or below minimum stock: {lowStock.map((i) => i.name).join(", ")}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading inventory…</p>
      ) : items.length === 0 ? (
        <EmptyState
          title="No inventory items yet"
          description="Add thread, needles, backing or other materials to start tracking stock."
          action={<PrimaryButton onClick={openCreate}>Add your first item</PrimaryButton>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Stock</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((i) => (
                <tr key={i.id} className={`hover:bg-slate-50 ${i.currentStock <= i.minimumStock ? "bg-amber-50/50" : ""}`}>
                  <td className="px-4 py-3 font-medium">{i.sku}</td>
                  <td className="px-4 py-3">{i.name}</td>
                  <td className="px-4 py-3 text-slate-600">{i.category || "—"}</td>
                  <td className="px-4 py-3">{i.currentStock} {i.unit}</td>
                  <td className="px-4 py-3">{formatCurrency(i.currentStock * i.purchasePrice)}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDelete(i.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {transactions.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent stock movements</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Quantity</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.slice(0, 10).map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-3">{t.itemName}</td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1 ${t.type === "IN" ? "text-green-700" : "text-red-600"}`}>
                        {t.type === "IN" ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />} {t.type}
                      </span>
                    </td>
                    <td className="px-4 py-3">{t.quantity}</td>
                    <td className="px-4 py-3 text-slate-600">{t.reference || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalOpen && (
        <Modal title="New Inventory Item" onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={error} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>SKU *</label>
                <input className={inputClass()} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Name *</label>
                <input className={inputClass()} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Category</label>
                <input className={inputClass()} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Unit</label>
                <input className={inputClass()} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Opening Stock</label>
                <input type="number" min="0" className={inputClass()} value={form.openingStock} onChange={(e) => setForm({ ...form, openingStock: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Minimum Stock</label>
                <input type="number" min="0" className={inputClass()} value={form.minimumStock} onChange={(e) => setForm({ ...form, minimumStock: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Purchase Price</label>
                <input type="number" min="0" step="0.01" className={inputClass()} value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Supplier</label>
                <input className={inputClass()} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setModalOpen(false)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : "Save Item"}</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}

      {moveOpen && (
        <Modal title="Stock Movement" onClose={() => setMoveOpen(false)}>
          <form onSubmit={handleMove} className="space-y-4">
            <ErrorBanner message={moveError} />
            <div>
              <label className={labelClass()}>Item *</label>
              <select className={inputClass()} value={moveForm.itemId} onChange={(e) => setMoveForm({ ...moveForm, itemId: e.target.value })}>
                <option value="">Select an item</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.currentStock} {i.unit})</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>Type</label>
                <select className={inputClass()} value={moveForm.type} onChange={(e) => setMoveForm({ ...moveForm, type: e.target.value as "IN" | "OUT" })}>
                  <option value="IN">Stock In</option>
                  <option value="OUT">Stock Out</option>
                </select>
              </div>
              <div>
                <label className={labelClass()}>Quantity *</label>
                <input type="number" min="1" className={inputClass()} value={moveForm.quantity} onChange={(e) => setMoveForm({ ...moveForm, quantity: e.target.value })} />
              </div>
            </div>
            <div>
              <label className={labelClass()}>Reference</label>
              <input className={inputClass()} value={moveForm.reference} onChange={(e) => setMoveForm({ ...moveForm, reference: e.target.value })} placeholder="PO number, order, etc." />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setMoveOpen(false)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit">Record Movement</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
