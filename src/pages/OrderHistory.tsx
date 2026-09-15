import { Fragment, useState, useMemo, useEffect } from 'react';
import { useAllOrders } from '@/hooks/useAllOrders';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { StatCard } from '@/components/ui/StatCard';
import { orderStatusMeta } from '@/lib/status';
import { formatCurrency, formatTime, formatDate } from '@/lib/format';
import {
  Search,
  Receipt,
  ChevronDown,
  ChevronRight,
  Calendar,
  DollarSign,
  ShoppingBag,
  Loader2,
  Filter,
  Tag,
  Check,
  Loader2 as SavingIcon,
  Trash2,
  AlertTriangle,
  Square,
  CheckSquare,
} from 'lucide-react';
import type { OrderStatus } from '@/types';

export function OrderHistory() {
  const { orders, loading, updateDiscount, deleteOrder, deleteOrders } = useAllOrders();

  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [discountDraft, setDiscountDraft] = useState<string>('');
  const [savingDiscount, setSavingDiscount] = useState(false);
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // Search by order number or item names
      const matchesSearch =
        search.trim() === '' ||
        String(order.order_number).includes(search.trim()) ||
        (order.order_items ?? []).some((i) =>
          i.name.toLowerCase().includes(search.trim().toLowerCase())
        );

      // Date filter
      const matchesDate =
        dateFilter === '' || order.created_at.startsWith(dateFilter);

      // Status filter
      const matchesStatus = statusFilter === 'all' || order.status === statusFilter;

      return matchesSearch && matchesDate && matchesStatus;
    });
  }, [orders, search, dateFilter, statusFilter]);

  // "Completed, paid sales" — same definition used by Analytics/Z Report:
  // status='served' AND payment_status='paid', net of any discount.
  const totalRevenue = filteredOrders
    .filter((o) => o.status === 'served' && o.payment_status === 'paid')
    .reduce((sum, o) => sum + (o.total - o.discount_amount), 0);
  const totalItems = filteredOrders.reduce((sum, o) => sum + o.item_count, 0);

  // Selection scope follows the current filters — clear it if the filters change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [search, dateFilter, statusFilter]);

  function startEditDiscount(orderId: string, currentDiscount: number) {
    setExpandedId(orderId);
    setDiscountDraft(String(currentDiscount));
    setDiscountError(null);
  }

  async function saveDiscount(orderId: string) {
    const value = Number(discountDraft);
    if (Number.isNaN(value) || value < 0) {
      setDiscountError('Enter a valid, non-negative amount.');
      return;
    }
    setSavingDiscount(true);
    setDiscountError(null);
    try {
      await updateDiscount(orderId, value);
    } catch (e) {
      setDiscountError((e as Error).message);
    } finally {
      setSavingDiscount(false);
    }
  }

  async function handleDeleteOrder(orderId: string, orderNumber: number) {
    const confirmed = window.confirm(
      `Permanently delete Order #${orderNumber}?\n\nThis removes the order and all its items from Order History forever. This cannot be undone and will affect historical totals. Already-closed Z Reports are not affected.`
    );
    if (!confirmed) return;

    setDeleteError(null);
    setDeletingId(orderId);
    try {
      await deleteOrder(orderId);
      setExpandedId(null);
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  function toggleSelectOne(orderId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) =>
      prev.size === filteredOrders.length
        ? new Set()
        : new Set(filteredOrders.map((o) => o.id))
    );
  }

  async function handleDeleteSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const confirmed = window.confirm(
      `Permanently delete ${ids.length} selected order${ids.length === 1 ? '' : 's'}?\n\nThis removes the orders and all their items from Order History forever. This cannot be undone and will affect historical totals. Already-closed Z Reports are not affected.`
    );
    if (!confirmed) return;

    setDeleteError(null);
    setBulkDeleting(true);
    try {
      await deleteOrders(ids);
      setSelectedIds(new Set());
      setExpandedId(null);
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleDeleteAll() {
    if (filteredOrders.length === 0) return;
    const scopeNote =
      search || dateFilter || statusFilter !== 'all'
        ? ' matching your current search/filters'
        : '';
    const confirmed = window.confirm(
      `Permanently delete ALL ${filteredOrders.length} order${filteredOrders.length === 1 ? '' : 's'}${scopeNote}?\n\nThis removes every one of these orders and their items from Order History forever. This cannot be undone and will affect historical totals. Already-closed Z Reports are not affected.`
    );
    if (!confirmed) return;

    setDeleteError(null);
    setBulkDeleting(true);
    try {
      await deleteOrders(filteredOrders.map((o) => o.id));
      setSelectedIds(new Set());
      setExpandedId(null);
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="animate-fade-in-up space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Order History</h1>
          <p className="mt-1 text-sm text-ink-500">
            Search, filter, and review all past orders
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard
            label="Filtered Orders"
            value={filteredOrders.length}
            icon={Receipt}
            tone="primary"
          />
          <StatCard
            label="Revenue (Served & Paid)"
            value={formatCurrency(totalRevenue)}
            icon={DollarSign}
            tone="success"
          />
          <StatCard
            label="Items Sold"
            value={totalItems}
            icon={ShoppingBag}
            tone="accent"
          />
        </div>

        {deleteError && (
          <div className="flex items-start gap-2 rounded-lg bg-error-50 border border-error-500/20 px-4 py-3">
            <AlertTriangle className="h-5 w-5 text-error-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-error-700">Couldn't delete order</p>
              <p className="text-xs text-error-600 mt-0.5">{deleteError}</p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-ink-400" />
            <input
              type="text"
              placeholder="Search by order # or item name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-ink-300 bg-surface pl-11 pr-4 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
            />
          </div>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-ink-400 pointer-events-none" />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="rounded-lg border border-ink-300 bg-surface pl-11 pr-4 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400 pointer-events-none" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-ink-300 bg-surface pl-10 pr-8 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition appearance-none"
            >
              <option value="all">All Statuses</option>
              <option value="new">New</option>
              <option value="preparing">Preparing</option>
              <option value="ready">Ready</option>
              <option value="served">Served</option>
            </select>
          </div>
        </div>

        {/* Bulk actions */}
        {!loading && filteredOrders.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg bg-surface ring-1 ring-ink-200/60 px-4 py-3">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-2 text-sm font-semibold text-ink-700 hover:text-primary-700 transition"
            >
              {selectedIds.size === filteredOrders.length ? (
                <CheckSquare className="h-4 w-4 text-primary-600" />
              ) : (
                <Square className="h-4 w-4 text-ink-400" />
              )}
              {selectedIds.size > 0
                ? `${selectedIds.size} selected`
                : `Select All (${filteredOrders.length})`}
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDeleteSelected}
                disabled={selectedIds.size === 0 || bulkDeleting}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-error-600 hover:bg-error-50 transition disabled:opacity-40 disabled:hover:bg-transparent"
              >
                {bulkDeleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Delete Selected
              </button>
              <button
                onClick={handleDeleteAll}
                disabled={bulkDeleting}
                className="flex items-center gap-1.5 rounded-md bg-error-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-error-700 transition disabled:opacity-50"
              >
                {bulkDeleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Delete All ({filteredOrders.length})
              </button>
            </div>
          </div>
        )}

        {/* Orders table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Receipt className="h-12 w-12 text-ink-300 mb-3" />
            <p className="text-sm font-medium text-ink-600">No orders found</p>
            <p className="text-xs text-ink-400 mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl bg-surface shadow-sm ring-1 ring-ink-200/60">
            <table className="w-full">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50/50">
                  <th className="px-3 py-3 w-10">
                    <button onClick={toggleSelectAll} className="flex items-center justify-center">
                      {selectedIds.size === filteredOrders.length ? (
                        <CheckSquare className="h-4 w-4 text-primary-600" />
                      ) : (
                        <Square className="h-4 w-4 text-ink-400" />
                      )}
                    </button>
                  </th>
                  <th className="px-3 py-3 w-10"></th>
                  <th className="text-left text-xs font-semibold text-ink-600 uppercase tracking-wider px-3 py-3">
                    Order #
                  </th>
                  <th className="text-left text-xs font-semibold text-ink-600 uppercase tracking-wider px-3 py-3">
                    Date
                  </th>
                  <th className="text-left text-xs font-semibold text-ink-600 uppercase tracking-wider px-3 py-3">
                    Time
                  </th>
                  <th className="text-center text-xs font-semibold text-ink-600 uppercase tracking-wider px-3 py-3">
                    Items
                  </th>
                  <th className="text-right text-xs font-semibold text-ink-600 uppercase tracking-wider px-3 py-3">
                    Total
                  </th>
                  <th className="text-center text-xs font-semibold text-ink-600 uppercase tracking-wider px-3 py-3">
                    Payment
                  </th>
                  <th className="text-center text-xs font-semibold text-ink-600 uppercase tracking-wider px-3 py-3">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filteredOrders.map((order) => {
                  const meta = orderStatusMeta[order.status as OrderStatus];
                  const isExpanded = expandedId === order.id;
                  return (
                    <Fragment key={order.id}>
                      <tr
                        onClick={() =>
                          isExpanded
                            ? setExpandedId(null)
                            : startEditDiscount(order.id, order.discount_amount)
                        }
                        className="hover:bg-ink-50/50 transition cursor-pointer"
                      >
                        <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => toggleSelectOne(order.id)}
                            className="flex items-center justify-center"
                          >
                            {selectedIds.has(order.id) ? (
                              <CheckSquare className="h-4 w-4 text-primary-600" />
                            ) : (
                              <Square className="h-4 w-4 text-ink-400" />
                            )}
                          </button>
                        </td>
                        <td className="px-3 py-3 text-center">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-ink-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-ink-400" />
                          )}
                        </td>
                        <td className="px-3 py-3 font-bold text-ink-900 text-sm">
                          #{order.order_number}
                        </td>
                        <td className="px-3 py-3 text-sm text-ink-600">
                          {formatDate(order.created_at)}
                        </td>
                        <td className="px-3 py-3 text-sm text-ink-600">
                          {formatTime(order.created_at)}
                        </td>
                        <td className="px-3 py-3 text-center text-sm text-ink-600 tabular-nums">
                          {order.item_count}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-sm">
                          {order.discount_amount > 0 ? (
                            <div>
                              <div className="text-ink-400 line-through text-xs">
                                {formatCurrency(order.total)}
                              </div>
                              <div className="font-bold text-ink-900">
                                {formatCurrency(order.total - order.discount_amount)}
                              </div>
                            </div>
                          ) : (
                            <div className="font-bold text-ink-900">
                              {formatCurrency(order.total)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              order.payment_status === 'paid'
                                ? 'bg-success-50 text-success-700'
                                : 'bg-warning-50 text-warning-700'
                            }`}
                          >
                            {order.payment_status === 'paid' ? 'Paid' : 'Unpaid'}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full ${meta.bgColor} ${meta.color} px-2.5 py-0.5 text-xs font-bold`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                            {meta.label}
                          </span>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-ink-50/30">
                          <td colSpan={9} className="px-8 py-4">
                            <div className="space-y-2">
                              <div className="text-xs font-semibold text-ink-500 uppercase tracking-wider mb-2">
                                Order Details
                              </div>
                              {(order.order_items ?? []).map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-baseline gap-3 text-sm py-1"
                                >
                                  <span className="font-bold text-ink-900 tabular-nums w-10">
                                    {item.quantity}×
                                  </span>
                                  <span className="text-ink-800 flex-1">
                                    {item.name}
                                    {item.notes && (
                                      <span className="text-ink-500 italic"> — {item.notes}</span>
                                    )}
                                  </span>
                                  <span className="text-ink-600 tabular-nums">
                                    {formatCurrency(item.price * item.quantity)}
                                  </span>
                                </div>
                              ))}
                              {order.notes && (
                                <div className="mt-3 rounded-md bg-surface border border-ink-200 p-3">
                                  <div className="text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1">
                                    Order Notes
                                  </div>
                                  <div className="text-sm text-ink-700">{order.notes}</div>
                                </div>
                              )}

                              {/* Summary + discount editor (admin only — enforced by DB trigger regardless) */}
                              <div
                                className="mt-3 rounded-md bg-surface border border-ink-200 p-3 space-y-2"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-ink-500">Subtotal</span>
                                  <span className="tabular-nums text-ink-800">
                                    {formatCurrency(order.total)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-sm gap-3">
                                  <span className="text-ink-500 flex items-center gap-1.5">
                                    <Tag className="h-3.5 w-3.5" />
                                    Discount
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={discountDraft}
                                      onChange={(e) => setDiscountDraft(e.target.value)}
                                      className="w-28 rounded-md border border-ink-300 bg-surface px-2 py-1 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
                                    />
                                    <button
                                      onClick={() => saveDiscount(order.id)}
                                      disabled={savingDiscount}
                                      className="flex items-center gap-1 rounded-md bg-primary-600 px-2.5 py-1 text-xs font-semibold text-ink-950 hover:bg-primary-700 transition disabled:opacity-60"
                                    >
                                      {savingDiscount ? (
                                        <SavingIcon className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Check className="h-3.5 w-3.5" />
                                      )}
                                      Apply
                                    </button>
                                  </div>
                                </div>
                                {discountError && (
                                  <p className="text-xs text-error-600">{discountError}</p>
                                )}
                                <div className="flex items-center justify-between text-sm font-bold pt-2 border-t border-ink-100">
                                  <span className="text-ink-900">Final Total</span>
                                  <span className="tabular-nums text-ink-900">
                                    {formatCurrency(order.total - order.discount_amount)}
                                  </span>
                                </div>
                              </div>

                              {/* Destructive — admin only, enforced by DB RLS regardless */}
                              <div
                                className="flex items-center justify-between rounded-md bg-error-50 border border-error-500/20 p-3"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <span className="text-xs text-error-700">
                                  Permanently deletes this order and its items from Order
                                  History. Cannot be undone.
                                </span>
                                <button
                                  onClick={() => handleDeleteOrder(order.id, order.order_number)}
                                  disabled={deletingId === order.id}
                                  className="flex-shrink-0 flex items-center gap-1.5 rounded-md bg-error-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-error-700 transition disabled:opacity-60"
                                >
                                  {deletingId === order.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-3.5 w-3.5" />
                                  )}
                                  Delete Order
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
