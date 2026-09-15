import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { StatCard } from '@/components/ui/StatCard';
import { Button } from '@/components/ui/Button';
import { QrOrderQueue } from '@/components/cashier/QrOrderQueue';
import { useAuth } from '@/context/AuthContext';
import { useActiveOrders } from '@/hooks/useActiveOrders';
import { orderStatusMeta } from '@/lib/status';
import { formatCurrency, formatTime } from '@/lib/format';
import { useNavigate } from 'react-router-dom';
import {
  Receipt,
  CreditCard as PendingPaymentIcon,
  Clock,
  ShoppingBag,
  Plus,
  Loader2,
  CheckCircle2,
  Flame,
  Bell,
  CreditCard,
  AlertCircle,
} from 'lucide-react';

export function CashierDashboard() {
  const { profile } = useAuth();
  const { orders, loading, error, realtimeStatus, updatePaymentStatus } = useActiveOrders('cashier');
  const navigate = useNavigate();

  // In cashier view, `orders` is already scoped to payment_status != 'paid'
  // (any kitchen status, including 'served') — this IS the payment queue.
  // A QR order the cashier hasn't accepted yet isn't in the kitchen
  // workflow yet, so it's shown separately in the QrOrderQueue panel below
  // rather than mixed into the regular active-orders list/stats.
  const activeOrders = orders.filter((o) => o.order_source !== 'qr' || o.confirmed_at);
  const pendingPayment = orders.length;

  return (
    <DashboardLayout>
      <div className="animate-fade-in-up space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink-900">Cashier Dashboard</h1>
            <p className="mt-1 text-sm text-ink-500">
              Hello, {profile?.full_name ?? 'Cashier'}. Ready to take orders.
            </p>
          </div>
          <Button size="lg" onClick={() => navigate('/cashier/pos')}>
            <Plus className="h-5 w-5" />
            New Order
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-error-50 border border-error-500/20 px-4 py-3">
            <AlertCircle className="h-5 w-5 text-error-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-error-700">Couldn't load orders</p>
              <p className="text-xs text-error-600 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {!error && realtimeStatus === 'error' && (
          <div className="flex items-start gap-2 rounded-lg bg-warning-50 border border-warning-500/20 px-4 py-3">
            <AlertCircle className="h-5 w-5 text-warning-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-warning-700">
                Live updates aren't connected
              </p>
              <p className="text-xs text-warning-600 mt-0.5">
                Order status changes won't appear automatically — refresh to see the latest.
              </p>
            </div>
          </div>
        )}

        <QrOrderQueue orders={orders} />

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Active Orders" value={activeOrders.length} icon={Receipt} tone="primary" />
          <StatCard
            label="Pending Payment"
            value={pendingPayment}
            icon={PendingPaymentIcon}
            tone="warning"
          />
          <StatCard
            label="In Kitchen"
            value={activeOrders.filter((o) => o.status === 'new' || o.status === 'preparing').length}
            icon={Clock}
            tone="warning"
          />
          <StatCard
            label="Ready to Serve"
            value={activeOrders.filter((o) => o.status === 'ready').length}
            icon={ShoppingBag}
            tone="accent"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Active orders */}
          <div className="lg:col-span-2 rounded-xl bg-surface p-6 shadow-sm ring-1 ring-ink-200/60">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-ink-900">Active Orders</h2>
              {loading && <Loader2 className="h-4 w-4 animate-spin text-ink-400" />}
            </div>

            {activeOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="h-14 w-14 rounded-full bg-ink-100 flex items-center justify-center mb-3">
                  <Receipt className="h-7 w-7 text-ink-400" />
                </div>
                <p className="text-sm font-medium text-ink-600">No active orders</p>
                <p className="text-xs text-ink-400 mt-1">
                  Create a new order to get started.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeOrders.map((order) => {
                  const meta = orderStatusMeta[order.status];
                  const StatusIcon =
                    order.status === 'new'
                      ? Bell
                      : order.status === 'preparing'
                      ? Flame
                      : order.status === 'ready'
                      ? CheckCircle2
                      : Receipt;
                  return (
                    <div
                      key={order.id}
                      className="flex items-center justify-between rounded-lg border border-ink-200 p-4 hover:border-primary-300 transition"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div className={`flex-shrink-0 h-10 w-10 rounded-lg ${meta.bgColor} flex items-center justify-center`}>
                          <StatusIcon className={`h-5 w-5 ${meta.color}`} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-ink-900">
                              #{order.order_number}
                            </span>
                            {order.table && (
                              <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-bold text-ink-600">
                                Table {order.table.table_number}
                              </span>
                            )}
                            <span
                              className={`rounded-full ${meta.bgColor} ${meta.color} px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide`}
                            >
                              {meta.label}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                order.payment_status === 'paid'
                                  ? 'bg-success-50 text-success-700'
                                  : 'bg-warning-50 text-warning-700'
                              }`}
                            >
                              {order.payment_status === 'paid' ? 'Paid' : 'Unpaid'}
                            </span>
                          </div>
                          <p className="text-xs text-ink-500 mt-0.5">
                            {order.item_count} items · {formatCurrency(order.total)} ·{' '}
                            {formatTime(order.created_at)}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          updatePaymentStatus(
                            order.id,
                            order.payment_status === 'paid' ? 'unpaid' : 'paid'
                          )
                        }
                        className={`flex-shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                          order.payment_status === 'paid'
                            ? 'bg-ink-100 text-ink-500 hover:bg-ink-200'
                            : 'bg-success-500 text-white hover:bg-success-600'
                        }`}
                      >
                        <CreditCard className="h-3.5 w-3.5" />
                        {order.payment_status === 'paid' ? 'Mark Unpaid' : 'Mark Paid'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="space-y-6">
            <div className="rounded-xl bg-surface p-6 shadow-sm ring-1 ring-ink-200/60">
              <h2 className="text-lg font-bold text-ink-900 mb-4">Quick Actions</h2>
              <div className="grid grid-cols-1 gap-3">
                <button
                  onClick={() => navigate('/cashier/pos')}
                  className="flex flex-col items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 p-4 hover:border-primary-400 hover:bg-primary-50 transition"
                >
                  <Plus className="h-6 w-6 text-primary-600" />
                  <span className="text-sm font-semibold text-ink-700">New Order</span>
                </button>
              </div>
            </div>

            {activeOrders.filter((o) => o.status === 'ready').length > 0 && (
              <div className="rounded-xl bg-success-50 border border-success-500/20 p-6">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-5 w-5 text-success-600" />
                  <h2 className="font-bold text-success-800">Orders Ready</h2>
                </div>
                <p className="text-sm text-success-700">
                  {activeOrders.filter((o) => o.status === 'ready').length} order(s) are ready to serve to guests.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
