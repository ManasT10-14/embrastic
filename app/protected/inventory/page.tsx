"use client";

import { useEffect, useState } from "react";
import { Plus, ArrowDownCircle, ArrowUpCircle, Pencil, Trash2 } from "lucide-react";
import {
  getInventoryItems, createInventoryItem, updateInventoryItem, deleteInventoryItem,
  getStockTransactions, recordStockMovement, isLowStock,
  type InventoryItemRow, type StockTransactionRow,
} from "@/lib/db";
import { formatCurrency, formatDate } from "@/lib/calculations";
import {
  PageHeader, EmptyState, Modal, ErrorBanner, SuccessBanner, SearchInput,
  FilterSelect, Toolbar, RowAction, inputClass, labelClass, PrimaryButton, SecondaryButton,
} from "@/components/business/ui";

const UNITS = ["Pcs", "Cone", "Metre", "Roll", "Box", "Kg", "Sheet"];
const EMPTY_FORM = {
  sku: "", name: "", category: "", unit: "Pcs", openingStock: "0",
  minimumStock: "0", purchasePrice: "0", supplier: "", notes: "",
};

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [transactions, setTransactions] = useState<StockTransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [lowOnly, setLowOnly] = useState(false);

  const [moveOpen, setMoveOpen] = useState(false);
  const [moveForm, setMoveForm] = useState({ itemId: "", type: "IN" as "IN" | "OUT", quantity: "1", reference: "", notes: "" });
  const [moveError, setMoveError] = useState("");
  const [moving, setMoving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [i, t] = await Promise.all([getInventoryItems(), getStockTransactions()]);
      setItems(i);
      setTransactions(t);
      setError("");
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
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(item: InventoryItemRow) {
    setEditingId(item.id);
    setForm({
      sku: item.sku, name: item.name, category: item.category, unit: item.unit,
      openingStock: String(item.openingStock), minimumStock: String(item.minimumStock),
      purchasePrice: String(item.purchasePrice), supplier: item.supplier, notes: item.notes,
    });
    setFormError("");
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.sku.trim()) return setFormError("SKU is required.");
    if (!form.name.trim()) return setFormError("Name is required.");

    const openingStock = Number(form.openingStock);
    const minimumStock = Number(form.minimumStock);
    const purchasePrice = Number(form.purchasePrice);
    if (!Number.isInteger(openingStock) || openingStock < 0) return setFormError("Opening stock must be a whole number of zero or more.");
    if (!Number.isInteger(minimumStock) || minimumStock < 0) return setFormError("Minimum stock must be a whole number of zero or more.");
    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) return setFormError("Purchase price must be zero or more.");

    const duplicate = items.find((i) => i.id !== editingId && i.sku.trim().toLowerCase() === form.sku.trim().toLowerCase());
    if (duplicate) return setFormError(`SKU ${duplicate.sku} is already used by "${duplicate.name}".`);

    setSaving(true);
    try {
      const payload = {
        sku: form.sku, name: form.name, category: form.category.trim(), unit: form.unit,
        minimumStock, purchasePrice, supplier: form.supplier, notes: form.notes,
      };
      if (editingId) {
        await updateInventoryItem(editingId, payload);
        setNotice(`${form.name} updated.`);
      } else {
        await createInventoryItem({ ...payload, openingStock });
        setNotice(`${form.name} added with ${openingStock} ${form.unit} opening stock.`);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save item.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: InventoryItemRow) {
    if (!confirm(`Delete ${item.name}? Only items with no recorded stock movements can be deleted.`)) return;
    setError("");
    try {
      await deleteInventoryItem(item.id);
      setNotice(`${item.name} deleted.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete item.");
    }
  }

  function openMove(itemId = "") {
    setMoveForm({ itemId, type: "IN", quantity: "1", reference: "", notes: "" });
    setMoveError("");
    setMoveOpen(true);
  }

  async function handleMove(e: React.FormEvent) {
    e.preventDefault();
    setMoveError("");
    const quantity = Number(moveForm.quantity);
    if (!moveForm.itemId) return setMoveError("Select an item.");
    if (!Number.isInteger(quantity) || quantity <= 0) return setMoveError("Quantity must be a whole number greater than zero.");

    const item = items.find((i) => i.id === moveForm.itemId);
    if (moveForm.type === "OUT" && item && quantity > item.currentStock) {
      return setMoveError(`Only ${item.currentStock} ${item.unit} of ${item.name} in stock.`);
    }

    setMoving(true);
    try {
      const newStock = await recordStockMovement({
        itemId: moveForm.itemId, type: moveForm.type, quantity,
        reference: moveForm.reference, notes: moveForm.notes,
      });
      setNotice(`${item?.name ?? "Item"} is now at ${newStock} ${item?.unit ?? ""}.`);
      setMoveOpen(false);
      await load();
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : "Failed to record movement.");
    } finally {
      setMoving(false);
    }
  }

  const lowStock = items.filter(isLowStock);
  const categories = Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort();
  const stockValue = items.reduce((sum, i) => sum + i.currentStock * i.purchasePrice, 0);

  const filtered = items.filter((i) => {
    if (categoryFilter && i.category !== categoryFilter) return false;
    if (lowOnly && !isLowStock(i)) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      i.sku.toLowerCase().includes(term) ||
      i.name.toLowerCase().includes(term) ||
      i.category.toLowerCase().includes(term) ||
      i.supplier.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Materials used in embroidery production — thread, backing, garments and more."
        action={
          <>
            <SecondaryButton onClick={() => openMove()}>Stock Movement</SecondaryButton>
            <PrimaryButton onClick={openCreate}>
              <span className="flex items-center gap-2"><Plus className="h-4 w-4" /> New Item</span>
            </PrimaryButton>
          </>
        }
      />

      <ErrorBanner message={error} onDismiss={() => setError("")} />
      <SuccessBanner message={notice} onDismiss={() => setNotice("")} />

      {items.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Items tracked</p>
            <p className="text-xl font-bold">{items.length}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Stock value (at purchase price)</p>
            <p className="text-xl font-bold">{formatCurrency(stockValue)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Needs reordering</p>
            <p className={`text-xl font-bold ${lowStock.length > 0 ? "text-amber-600" : ""}`}>{lowStock.length}</p>
          </div>
        </div>
      )}

      {lowStock.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {lowStock.length} item{lowStock.length > 1 ? "s are" : " is"} out of stock or at/below the minimum:{" "}
          {lowStock.map((i) => `${i.name} (${i.currentStock} ${i.unit})`).join(", ")}
        </div>
      )}

      {items.length > 0 && (
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search SKU, name, category or supplier" />
          {categories.length > 0 && (
            <FilterSelect value={categoryFilter} onChange={setCategoryFilter} options={categories} allLabel="All categories" />
          )}
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="rounded border-slate-300" />
            Low stock only
          </label>
          <span className="text-xs text-slate-500">{filtered.length} of {items.length}</span>
        </Toolbar>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading inventory…</p>
      ) : items.length === 0 ? (
        <EmptyState
          title="No inventory items yet"
          description="Add thread, needles, backing or other materials to start tracking stock."
          action={<PrimaryButton onClick={openCreate}>Add your first item</PrimaryButton>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching items" description="Try a different search term or filter." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3 text-right">Minimum</th>
                <th className="px-4 py-3 text-right">Value</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((i) => (
                <tr key={i.id} className={`hover:bg-slate-50 ${isLowStock(i) ? "bg-amber-50/50" : ""}`}>
                  <td className="px-4 py-3 font-medium">{i.sku}</td>
                  <td className="px-4 py-3">
                    <div>{i.name}</div>
                    {i.supplier && <div className="text-xs text-slate-400">{i.supplier}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{i.category || "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className={isLowStock(i) ? "font-semibold text-amber-700" : ""}>{i.currentStock}</span>
                    <span className="text-slate-400"> {i.unit}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{i.minimumStock || "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(i.currentStock * i.purchasePrice)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                      <RowAction tone="primary" onClick={() => openMove(i.id)}>Move stock</RowAction>
                      <RowAction onClick={() => openEdit(i)}><Pencil className="h-3.5 w-3.5" /> Edit</RowAction>
                      <RowAction tone="danger" onClick={() => handleDelete(i)}><Trash2 className="h-3.5 w-3.5" /> Delete</RowAction>
                    </div>
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
                  <th className="px-4 py-3 text-right">Quantity</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.slice(0, 15).map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-3">{t.itemName || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1 ${t.type === "IN" ? "text-green-700" : "text-red-600"}`}>
                        {t.type === "IN" ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />} {t.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{t.quantity}</td>
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
        <Modal title={editingId ? "Edit Inventory Item" : "New Inventory Item"} onClose={() => setModalOpen(false)} wide>
          <form onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={formError} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                <input className={inputClass()} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Thread, Backing, Garment" list="inventory-categories" />
                <datalist id="inventory-categories">
                  {categories.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div>
                <label className={labelClass()}>Unit</label>
                <select className={inputClass()} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass()}>{editingId ? "Opening Stock (fixed)" : "Opening Stock"}</label>
                <input
                  type="number" min="0" step="1" className={inputClass()} value={form.openingStock}
                  onChange={(e) => setForm({ ...form, openingStock: e.target.value })}
                  disabled={!!editingId}
                />
                {editingId && (
                  <p className="mt-1 text-xs text-slate-500">Stock only changes through recorded movements, so the running balance always matches its history.</p>
                )}
              </div>
              <div>
                <label className={labelClass()}>Minimum Stock (reorder level)</label>
                <input type="number" min="0" step="1" className={inputClass()} value={form.minimumStock} onChange={(e) => setForm({ ...form, minimumStock: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Purchase Price (per unit)</label>
                <input type="number" min="0" step="0.01" className={inputClass()} value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} />
              </div>
              <div>
                <label className={labelClass()}>Supplier</label>
                <input className={inputClass()} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
              </div>
            </div>
            <div>
              <label className={labelClass()}>Notes</label>
              <textarea className={inputClass()} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setModalOpen(false)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Save Changes" : "Save Item"}</PrimaryButton>
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
                  <option value="IN">Stock In (received)</option>
                  <option value="OUT">Stock Out (consumed)</option>
                </select>
              </div>
              <div>
                <label className={labelClass()}>Quantity *</label>
                <input type="number" min="1" step="1" className={inputClass()} value={moveForm.quantity} onChange={(e) => setMoveForm({ ...moveForm, quantity: e.target.value })} />
              </div>
            </div>
            <div>
              <label className={labelClass()}>Reference</label>
              <input className={inputClass()} value={moveForm.reference} onChange={(e) => setMoveForm({ ...moveForm, reference: e.target.value })} placeholder="PO number, order, etc." />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setMoveOpen(false)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit" disabled={moving}>{moving ? "Recording…" : "Record Movement"}</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
