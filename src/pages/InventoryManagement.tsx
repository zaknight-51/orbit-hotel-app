import { useState, useMemo, useEffect } from 'react';
import { useInventory } from '@/hooks/useInventory';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/ui/StatCard';
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Package,
  Loader2,
  AlertCircle,
  Check,
  AlertTriangle,
  Boxes,
  X,
} from 'lucide-react';
import type { InventoryItem } from '@/types';

type ItemModal =
  | { mode: 'create' }
  | { mode: 'edit'; item: InventoryItem }
  | null;

const unitOptions = ['pcs', 'kg', 'g', 'L', 'mL', 'bottle', 'loaf', 'box', 'pack'];

export function InventoryManagement() {
  const { items, loading, createItem, updateItem, deleteItem } = useInventory();

  const [search, setSearch] = useState('');
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  const [modal, setModal] = useState<ItemModal>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [stock, setStock] = useState('');
  const [threshold, setThreshold] = useState('');

  useEffect(() => {
    if (modal?.mode === 'create') {
      setName('');
      setUnit('pcs');
      setStock('');
      setThreshold('10');
    } else if (modal?.mode === 'edit') {
      setName(modal.item.name);
      setUnit(modal.item.unit);
      setStock(String(modal.item.stock_quantity));
      setThreshold(String(modal.item.low_stock_threshold));
    }
  }, [modal]);

  const lowStockItems = useMemo(
    () => items.filter((i) => i.stock_quantity <= i.low_stock_threshold),
    [items]
  );

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch =
        search.trim() === '' ||
        item.name.toLowerCase().includes(search.trim().toLowerCase());
      const matchesLowStock = !showLowStockOnly || item.stock_quantity <= item.low_stock_threshold;
      return matchesSearch && matchesLowStock;
    });
  }, [items, search, showLowStockOnly]);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const stockVal = parseFloat(stock);
      const thresholdVal = parseFloat(threshold);
      if (!name.trim() || isNaN(stockVal) || isNaN(thresholdVal)) {
        setError('Name and valid stock/threshold values are required.');
        setSaving(false);
        return;
      }

      const payload = {
        name: name.trim(),
        unit,
        stock_quantity: stockVal,
        low_stock_threshold: thresholdVal,
      };

      if (modal?.mode === 'create') {
        await createItem(payload);
      } else if (modal?.mode === 'edit') {
        await updateItem(modal.item.id, payload);
      }
      setModal(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: InventoryItem) {
    if (!window.confirm(`Delete "${item.name}" from inventory?`)) return;
    setError(null);
    try {
      await deleteItem(item.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function quickAdjustStock(item: InventoryItem, delta: number) {
    const newStock = Math.max(0, item.stock_quantity + delta);
    try {
      await updateItem(item.id, { stock_quantity: newStock });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <DashboardLayout>
      <div className="animate-fade-in-up space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink-900">Inventory Management</h1>
            <p className="mt-1 text-sm text-ink-500">
              Track ingredients, stock levels, and low-stock alerts
            </p>
          </div>
          <Button onClick={() => setModal({ mode: 'create' })}>
            <Plus className="h-4 w-4" />
            Add Ingredient
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            label="Total Ingredients"
            value={items.length}
            icon={Boxes}
            tone="primary"
          />
          <StatCard
            label="Low Stock Alerts"
            value={lowStockItems.length}
            icon={AlertTriangle}
            tone={lowStockItems.length > 0 ? 'error' : 'success'}
          />
          <StatCard
            label="Well Stocked"
            value={items.length - lowStockItems.length}
            icon={Check}
            tone="success"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-error-50 border border-error-500/20 px-4 py-3">
            <AlertCircle className="h-5 w-5 text-error-600 flex-shrink-0 mt-0.5" />
            <span className="text-sm text-error-700">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-error-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-ink-400" />
            <input
              type="text"
              placeholder="Search ingredients…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-ink-300 bg-surface pl-11 pr-4 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
            />
          </div>
          <button
            onClick={() => setShowLowStockOnly((v) => !v)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition whitespace-nowrap ${
              showLowStockOnly
                ? 'bg-error-600 text-white'
                : 'bg-surface text-ink-600 border border-ink-300 hover:bg-ink-50'
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
            Low Stock Only ({lowStockItems.length})
          </button>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Package className="h-12 w-12 text-ink-300 mb-3" />
            <p className="text-sm font-medium text-ink-600">No ingredients found</p>
            <p className="text-xs text-ink-400 mt-1">Add ingredients to track stock levels</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl bg-surface shadow-sm ring-1 ring-ink-200/60">
            <table className="w-full">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50/50">
                  <th className="text-left text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                    Ingredient
                  </th>
                  <th className="text-center text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                    Unit
                  </th>
                  <th className="text-center text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                    Stock Level
                  </th>
                  <th className="text-center text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                    Threshold
                  </th>
                  <th className="text-center text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                    Status
                  </th>
                  <th className="text-right text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filteredItems.map((item) => {
                  const isLow = item.stock_quantity <= item.low_stock_threshold;
                  const stockPct = item.low_stock_threshold > 0
                    ? Math.min(100, (item.stock_quantity / (item.low_stock_threshold * 2)) * 100)
                    : 100;
                  return (
                    <tr key={item.id} className="hover:bg-ink-50/50 transition">
                      <td className="px-5 py-3.5 font-semibold text-ink-900 text-sm">
                        {item.name}
                      </td>
                      <td className="px-5 py-3.5 text-center text-sm text-ink-600">
                        {item.unit}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => quickAdjustStock(item, -1)}
                            className="h-6 w-6 rounded border border-ink-300 flex items-center justify-center text-ink-600 hover:bg-ink-50 transition text-sm font-bold"
                          >
                            −
                          </button>
                          <span className="font-bold text-ink-900 tabular-nums text-sm w-14 text-center">
                            {item.stock_quantity}
                          </span>
                          <button
                            onClick={() => quickAdjustStock(item, 1)}
                            className="h-6 w-6 rounded border border-ink-300 flex items-center justify-center text-ink-600 hover:bg-ink-50 transition text-sm font-bold"
                          >
                            +
                          </button>
                        </div>
                        <div className="mt-1.5 mx-auto w-32 h-1.5 rounded-full bg-ink-200 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              isLow ? 'bg-error-500' : 'bg-success-500'
                            }`}
                            style={{ width: `${stockPct}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-center text-sm text-ink-500 tabular-nums">
                        {item.low_stock_threshold}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        {isLow ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-error-50 text-error-700 px-2.5 py-0.5 text-xs font-bold">
                            <AlertTriangle className="h-3 w-3" />
                            Low Stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success-50 text-success-700 px-2.5 py-0.5 text-xs font-bold">
                            <Check className="h-3 w-3" />
                            OK
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setModal({ mode: 'edit', item })}
                            className="p-1.5 text-ink-400 hover:text-primary-600 hover:bg-primary-50 rounded-md transition"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(item)}
                            className="p-1.5 text-ink-400 hover:text-error-600 hover:bg-error-50 rounded-md transition"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal?.mode === 'edit' ? 'Edit Ingredient' : 'Add Ingredient'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {modal?.mode === 'edit' ? 'Save' : 'Add'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-ink-700 mb-1.5">
              Ingredient Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Tomatoes"
              className="w-full rounded-lg border border-ink-300 bg-surface px-4 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-ink-700 mb-1.5">Unit</label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="w-full rounded-lg border border-ink-300 bg-surface px-4 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
            >
              {unitOptions.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-ink-700 mb-1.5">
                Stock Quantity
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border border-ink-300 bg-surface px-4 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink-700 mb-1.5">
                Low Stock Threshold
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="10"
                className="w-full rounded-lg border border-ink-300 bg-surface px-4 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
              />
            </div>
          </div>
        </div>
      </Modal>
    </DashboardLayout>
  );
}
