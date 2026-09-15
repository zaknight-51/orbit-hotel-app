import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { StatCard } from '@/components/ui/StatCard';
import { formatCurrency } from '@/lib/format';
import {
  DollarSign,
  Receipt,
  TrendingUp,
  Award,
  Loader2,
  ShoppingBag,
  Utensils,
  Tag,
} from 'lucide-react';
import type { BestSellingItem } from '@/types';

type Period = 'today' | 'week' | 'month' | 'year';

// The subset of fields common to both get_daily_report and
// get_range_report — everything Analytics needs to display, regardless
// of which period is selected.
interface PeriodStats {
  total_orders: number;
  paid_orders: number;
  gross_sales: number;
  total_revenue: number;
  total_discount: number;
  avg_order_value: number;
  unpaid_served_orders: number;
  unpaid_amount: number;
  items_sold: number;
  best_selling_items: BestSellingItem[];
}

const periodLabels: Record<Period, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  year: 'This Year',
};

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

/** Start date (inclusive) for a period, ending today. Boundary math only —
 * all sales aggregation happens in the database via get_daily_report /
 * get_range_report. */
function periodStart(period: Period, today: Date): Date {
  const d = new Date(today);
  if (period === 'week') {
    // Monday as the start of the week
    const day = d.getDay(); // 0=Sun..6=Sat
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
  } else if (period === 'month') {
    d.setDate(1);
  } else if (period === 'year') {
    d.setMonth(0, 1);
  }
  return d;
}

export function AnalyticsDashboard() {
  const [period, setPeriod] = useState<Period>('today');
  const [stats, setStats] = useState<PeriodStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);

    const today = new Date();
    const todayStr = toDateStr(today);

    if (p === 'today') {
      const { data, error: fetchError } = await supabase.rpc('get_daily_report', {
        p_target_date: todayStr,
      });
      if (fetchError) {
        setError(fetchError.message);
        setStats(null);
      } else {
        setStats(data as PeriodStats);
      }
    } else {
      const startStr = toDateStr(periodStart(p, today));
      const { data, error: fetchError } = await supabase.rpc('get_range_report', {
        p_start_date: startStr,
        p_end_date: todayStr,
      });
      if (fetchError) {
        setError(fetchError.message);
        setStats(null);
      } else {
        setStats(data as PeriodStats);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStats(period);
  }, [period, fetchStats]);

  const totalRevenue = stats ? Number(stats.total_revenue) : 0;
  const avgOrder = stats ? Number(stats.avg_order_value) : 0;

  return (
    <DashboardLayout>
      <div className="animate-fade-in-up space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink-900">Analytics Dashboard</h1>
            <p className="mt-1 text-sm text-ink-500">
              Sales performance and restaurant statistics
            </p>
          </div>
          <div className="flex rounded-lg ring-1 ring-ink-200/60 bg-surface p-1">
            {(Object.keys(periodLabels) as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-4 py-1.5 text-sm font-semibold rounded-md transition ${
                  period === p
                    ? 'bg-primary-600 text-ink-950'
                    : 'text-ink-600 hover:bg-ink-50'
                }`}
              >
                {periodLabels[p]}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-sm text-error-600">{error}</p>
          </div>
        ) : stats ? (
          <>
            {/* Top stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Total Orders"
                value={stats.total_orders}
                icon={Receipt}
                tone="primary"
              />
              <StatCard
                label="Net Revenue"
                value={formatCurrency(totalRevenue)}
                icon={DollarSign}
                tone="success"
              />
              <StatCard
                label="Avg Order Value"
                value={formatCurrency(avgOrder)}
                icon={TrendingUp}
                tone="accent"
              />
              <StatCard
                label="Items Sold"
                value={stats.items_sold}
                icon={ShoppingBag}
                tone="warning"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Revenue breakdown */}
              <div className="rounded-xl bg-surface p-6 shadow-sm ring-1 ring-ink-200/60">
                <h2 className="text-lg font-bold text-ink-900 mb-5">Revenue Breakdown</h2>
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-ink-100 pb-3">
                    <span className="text-sm font-semibold text-ink-600">Gross Sales</span>
                    <span className="text-sm font-bold text-ink-900 tabular-nums">
                      {formatCurrency(Number(stats.gross_sales))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-ink-100 pb-3">
                    <span className="text-sm font-semibold text-ink-600 flex items-center gap-1.5">
                      <Tag className="h-3.5 w-3.5" /> Discounts
                    </span>
                    <span className="text-sm font-bold text-error-600 tabular-nums">
                      − {formatCurrency(Number(stats.total_discount))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-ink-100 pb-3">
                    <span className="text-sm font-semibold text-ink-900">Net Revenue</span>
                    <span className="text-sm font-bold text-success-700 tabular-nums">
                      {formatCurrency(totalRevenue)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-ink-100 pb-3">
                    <span className="text-sm font-semibold text-ink-600">Paid Orders</span>
                    <span className="text-sm font-bold text-ink-900 tabular-nums">
                      {stats.paid_orders}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-warning-700">
                      Unpaid (Served)
                    </span>
                    <span className="text-sm font-bold text-warning-700 tabular-nums">
                      {stats.unpaid_served_orders} orders ·{' '}
                      {formatCurrency(Number(stats.unpaid_amount))}
                    </span>
                  </div>
                </div>
              </div>

              {/* Popular items */}
              <div className="rounded-xl bg-surface p-6 shadow-sm ring-1 ring-ink-200/60">
                <div className="flex items-center gap-2 mb-5">
                  <Award className="h-5 w-5 text-accent-600" />
                  <h2 className="text-lg font-bold text-ink-900">Popular Menu Items</h2>
                </div>
                {stats.best_selling_items.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <Utensils className="h-10 w-10 text-ink-300 mb-3" />
                    <p className="text-sm text-ink-500">No sales data for this period</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {stats.best_selling_items.slice(0, 8).map((item, idx) => {
                      const maxQty = stats.best_selling_items[0]?.quantity || 1;
                      const pct = (item.quantity / maxQty) * 100;
                      return (
                        <div key={item.name} className="flex items-center gap-3">
                          <span className="flex-shrink-0 h-7 w-7 rounded-full bg-accent-100 text-accent-700 flex items-center justify-center text-xs font-bold">
                            {idx + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-semibold text-ink-800 truncate">
                                {item.name}
                              </span>
                              <span className="text-xs font-bold text-ink-600 tabular-nums flex-shrink-0 ml-2">
                                {item.quantity} sold
                              </span>
                            </div>
                            <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-accent-500 transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Revenue summary */}
            <div className="rounded-xl bg-gradient-to-br from-primary-700 to-primary-900 p-6 text-white shadow-sm">
              <h2 className="text-lg font-bold mb-4">
                {periodLabels[period]} Revenue Summary
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-primary-200 uppercase tracking-wider mb-1">
                    Net Revenue
                  </div>
                  <div className="text-2xl font-bold">{formatCurrency(totalRevenue)}</div>
                </div>
                <div>
                  <div className="text-xs text-primary-200 uppercase tracking-wider mb-1">
                    Paid Orders
                  </div>
                  <div className="text-2xl font-bold">{stats.paid_orders}</div>
                </div>
                <div>
                  <div className="text-xs text-primary-200 uppercase tracking-wider mb-1">
                    Avg / Order
                  </div>
                  <div className="text-2xl font-bold">{formatCurrency(avgOrder)}</div>
                </div>
                <div>
                  <div className="text-xs text-primary-200 uppercase tracking-wider mb-1">
                    Total Orders
                  </div>
                  <div className="text-2xl font-bold">{stats.total_orders}</div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-sm text-ink-500">Failed to load analytics data</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
