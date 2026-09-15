import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { StatCard } from '@/components/ui/StatCard';
import { useAuth } from '@/context/AuthContext';
import { useActiveOrders } from '@/hooks/useActiveOrders';
import { useStaff } from '@/hooks/useStaff';
import { orderStatusMeta } from '@/lib/status';
import { formatCurrency, formatTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import {
  Users,
  Receipt,
  DollarSign,
  Clock,
  CheckCircle2,
  Activity,
  Flame,
  Bell,
  Utensils,
  Plus,
  Package,
  BarChart3,
  FileText,
} from 'lucide-react';
import type { UserRole, DailyReport } from '@/types';

const roleLabels: Record<UserRole, string> = {
  admin: 'Admin',
  cashier: 'Cashier',
  kitchen: 'Kitchen',
};

const roleBadgeColors: Record<UserRole, string> = {
  admin: 'bg-accent-100 text-accent-800',
  cashier: 'bg-primary-100 text-primary-800',
  kitchen: 'bg-success-50 text-success-700 ring-1 ring-success-500/20',
};

export function AdminDashboard() {
  const { profile } = useAuth();
  // 'cashier' view (payment_status != 'paid') gives the admin overview the
  // full active picture — including READY orders, which the kitchen view
  // no longer includes now that an order leaves the kitchen board the
  // moment it's marked READY (see useActiveOrders.ts). Unconfirmed QR
  // orders (not yet accepted by the cashier) are excluded from the
  // in-progress/ready breakdown below, same as on the Cashier Dashboard.
  const { orders: allActive } = useActiveOrders('cashier');
  const orders = allActive.filter((o) => o.order_source !== 'qr' || o.confirmed_at);
  const { staff } = useStaff();
  const navigate = useNavigate();
  const [report, setReport] = useState<DailyReport | null>(null);

  const fetchTodaysReport = useCallback(async () => {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase.rpc('get_daily_report', { p_target_date: today });
    if (error) {
      console.error('Failed to load today\'s report:', error.message);
      return;
    }
    setReport(data as DailyReport);
  }, []);

  useEffect(() => {
    fetchTodaysReport();
    // Active orders realtime already refetches on any order change; mirror
    // that here so revenue stays live as orders are marked served/paid.
    const channel = supabase
      .channel('admin-dashboard-report-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () =>
        fetchTodaysReport()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchTodaysReport]);

  const todaysOrders = orders.length;
  const todaysRevenue = report ? Number(report.total_revenue) : 0;
  const inProgress = orders.filter(
    (o) => o.status === 'new' || o.status === 'preparing'
  ).length;
  const ready = orders.filter((o) => o.status === 'ready').length;

  return (
    <DashboardLayout>
      <div className="animate-fade-in-up space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-ink-500">
            Welcome back, {profile?.full_name ?? 'Administrator'}. Here's the operations overview.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Active Orders" value={todaysOrders} icon={Receipt} tone="primary" />
          <StatCard
            label="Revenue Today"
            value={formatCurrency(todaysRevenue)}
            icon={DollarSign}
            tone="success"
          />
          <StatCard label="In Kitchen" value={inProgress} icon={Clock} tone="warning" />
          <StatCard label="Ready to Serve" value={ready} icon={CheckCircle2} tone="accent" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Live orders */}
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-xl bg-surface p-6 shadow-sm ring-1 ring-ink-200/60">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold text-ink-900">Live Orders</h2>
                <span className="flex items-center gap-1.5 text-xs font-semibold text-success-600">
                  <span className="h-2 w-2 rounded-full bg-success-500 animate-pulse" />
                  Realtime
                </span>
              </div>

              {orders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Activity className="h-10 w-10 text-ink-300 mb-3" />
                  <p className="text-sm font-medium text-ink-600">No active orders right now</p>
                  <p className="text-xs text-ink-400 mt-1">
                    Orders will appear here in real time as they come in.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {orders.slice(0, 8).map((order) => {
                    const meta = orderStatusMeta[order.status];
                    const StatusIcon =
                      order.status === 'new'
                        ? Bell
                        : order.status === 'preparing'
                        ? Flame
                        : CheckCircle2;
                    return (
                      <div
                        key={order.id}
                        className="flex items-center justify-between rounded-lg border border-ink-200 p-3.5"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`flex-shrink-0 h-9 w-9 rounded-lg ${meta.bgColor} flex items-center justify-center`}
                          >
                            <StatusIcon className={`h-4.5 w-4.5 ${meta.color}`} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-ink-900 text-sm">
                                #{order.order_number}
                              </span>
                              <span
                                className={`rounded-full ${meta.bgColor} ${meta.color} px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide`}
                              >
                                {meta.label}
                              </span>
                            </div>
                            <p className="text-xs text-ink-500 mt-0.5">
                              {order.item_count} items · {formatCurrency(order.total)} ·{' '}
                              {formatTime(order.created_at)}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Quick admin actions */}
            <div className="rounded-xl bg-surface p-6 shadow-sm ring-1 ring-ink-200/60">
              <h2 className="text-lg font-bold text-ink-900 mb-4">Quick Actions</h2>
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={() => navigate('/admin/pos')}
                  className="flex flex-col items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 p-4 hover:border-primary-400 hover:bg-primary-50 transition"
                >
                  <Plus className="h-6 w-6 text-primary-600" />
                  <span className="text-sm font-semibold text-ink-700">New Order</span>
                </button>
                <button
                  onClick={() => navigate('/admin/menu')}
                  className="flex flex-col items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 p-4 hover:border-primary-400 hover:bg-primary-50 transition"
                >
                  <Utensils className="h-6 w-6 text-success-600" />
                  <span className="text-sm font-semibold text-ink-700">Menu</span>
                </button>
                <button
                  onClick={() => navigate('/admin/inventory')}
                  className="flex flex-col items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 p-4 hover:border-primary-400 hover:bg-primary-50 transition"
                >
                  <Package className="h-6 w-6 text-warning-600" />
                  <span className="text-sm font-semibold text-ink-700">Inventory</span>
                </button>
                <button
                  onClick={() => navigate('/admin/staff')}
                  className="flex flex-col items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 p-4 hover:border-primary-400 hover:bg-primary-50 transition"
                >
                  <Users className="h-6 w-6 text-accent-600" />
                  <span className="text-sm font-semibold text-ink-700">Staff</span>
                </button>
                <button
                  onClick={() => navigate('/admin/analytics')}
                  className="flex flex-col items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 p-4 hover:border-primary-400 hover:bg-primary-50 transition"
                >
                  <BarChart3 className="h-6 w-6 text-primary-600" />
                  <span className="text-sm font-semibold text-ink-700">Analytics</span>
                </button>
                <button
                  onClick={() => navigate('/admin/z-report')}
                  className="flex flex-col items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 p-4 hover:border-primary-400 hover:bg-primary-50 transition"
                >
                  <FileText className="h-6 w-6 text-ink-600" />
                  <span className="text-sm font-semibold text-ink-700">Z Report</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-6">
            {/* Staff overview */}
            <div className="rounded-xl bg-surface p-6 shadow-sm ring-1 ring-ink-200/60">
              <h2 className="text-lg font-bold text-ink-900 mb-4">Staff Overview</h2>
              <div className="space-y-3">
                {staff.length === 0 ? (
                  <p className="text-sm text-ink-400">No staff members yet</p>
                ) : (
                  staff.slice(0, 5).map((member) => (
                    <div key={member.id} className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-ink-100 flex items-center justify-center flex-shrink-0">
                        <Users className="h-4 w-4 text-ink-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-ink-800 truncate">
                          {member.full_name ?? member.email}
                        </div>
                        <span
                          className={`inline-block mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${roleBadgeColors[member.role]}`}
                        >
                          {roleLabels[member.role]}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="w-full mt-4"
                onClick={() => navigate('/admin/staff')}
              >
                <Users className="h-4 w-4" />
                Manage Staff
              </Button>
            </div>

            {/* System status */}
            <div className="rounded-xl bg-gradient-to-br from-primary-700 to-primary-900 p-6 text-white shadow-sm">
              <h2 className="text-lg font-bold mb-3">System Status</h2>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-primary-100">Database</span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <span className="h-2 w-2 rounded-full bg-success-500 animate-pulse" />
                    Online
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-primary-100">Realtime</span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <span className="h-2 w-2 rounded-full bg-success-500 animate-pulse" />
                    Connected
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-primary-100">Kitchen Display</span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <span className="h-2 w-2 rounded-full bg-success-500 animate-pulse" />
                    Live
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
