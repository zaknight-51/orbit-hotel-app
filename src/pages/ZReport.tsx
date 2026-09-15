import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { formatCurrency, formatDateTime, formatDate } from '@/lib/format';
import {
  FileText,
  Loader2,
  Printer,
  DollarSign,
  Award,
  CheckCircle2,
  Lock,
  AlertCircle,
  History,
  ShoppingBag,
  Tag,
  Trash2,
} from 'lucide-react';
import type { DailyReport, ZReportRow } from '@/types';

const todayStr = () => new Date().toISOString().split('T')[0];

export function ZReport() {
  const { profile } = useAuth();

  const [todayReport, setTodayReport] = useState<DailyReport | null>(null);
  const [todayClosed, setTodayClosed] = useState<ZReportRow | null>(null);
  const [history, setHistory] = useState<ZReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadEverything = useCallback(async () => {
    setLoading(true);

    const [liveResult, closedTodayResult, historyResult] = await Promise.all([
      supabase.rpc('get_daily_report', { p_target_date: todayStr() }),
      supabase.from('z_reports').select('*').eq('business_date', todayStr()).maybeSingle(),
      supabase.from('z_reports').select('*').order('business_date', { ascending: false }),
    ]);

    if (liveResult.error) {
      console.error('Failed to load today\'s report:', liveResult.error.message);
    } else {
      setTodayReport(liveResult.data as DailyReport);
    }

    if (closedTodayResult.error) {
      console.error('Failed to check closed status:', closedTodayResult.error.message);
    } else {
      setTodayClosed((closedTodayResult.data as ZReportRow | null) ?? null);
    }

    if (historyResult.error) {
      console.error('Failed to load Z Report history:', historyResult.error.message);
    } else {
      setHistory((historyResult.data ?? []) as ZReportRow[]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadEverything();
  }, [loadEverything]);

  async function handleCloseDay() {
    setCloseError(null);
    setClosing(true);
    const { error } = await supabase.rpc('close_z_report', {
      p_business_date: todayStr(),
    });
    if (error) {
      setCloseError(error.message);
      setClosing(false);
      return;
    }
    await loadEverything();
    setClosing(false);
  }

  function handlePrint() {
    window.print();
  }

  async function handleDeleteReport(report: ZReportRow) {
    const confirmed = window.confirm(
      `Permanently delete the Z Report for ${formatDate(report.business_date + 'T00:00:00')} (${formatCurrency(
        Number(report.net_revenue)
      )})?\n\nThis only removes the report record — the underlying orders are NOT affected and remain in Order History. This cannot be undone.`
    );
    if (!confirmed) return;

    setDeleteError(null);
    setDeletingId(report.id);
    try {
      const { error } = await supabase.from('z_reports').delete().eq('id', report.id);
      if (error) throw error;
      await loadEverything();
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  const liveRevenue = todayReport ? Number(todayReport.total_revenue) : 0;
  const liveAvg = todayReport ? Number(todayReport.avg_order_value) : 0;

  return (
    <DashboardLayout>
      <div className="animate-fade-in-up space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 print:hidden">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary-100 flex items-center justify-center">
              <FileText className="h-6 w-6 text-primary-700" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-ink-900">Z Report</h1>
              <p className="mt-0.5 text-sm text-ink-500">
                Daily closing &amp; sales history
              </p>
            </div>
          </div>
          <Button onClick={handlePrint} variant="secondary" disabled={loading}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 print:hidden">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-8">
            {/* ===== Today's business day ===== */}
            <div className="bg-surface rounded-xl shadow-sm ring-1 ring-ink-200/60 overflow-hidden print:shadow-none print:ring-0">
              <div className="bg-primary-900 text-white px-8 py-6 print:bg-primary-900">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold">Orbit Hotel</h2>
                    <p className="text-sm text-primary-200 mt-0.5">
                      Restaurant POS · Current Business Period
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-primary-200">Business Date</div>
                    <div className="text-xl font-bold">
                      {new Date(todayStr() + 'T00:00:00').toLocaleDateString('en-US', {
                        weekday: 'short',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-b border-ink-200 px-8 py-4 bg-ink-50/50">
                {todayClosed ? (
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-2 text-success-700">
                      <Lock className="h-4 w-4" />
                      <span className="text-sm font-semibold">
                        Today's Z Report was closed at {formatDateTime(todayClosed.closed_at)} by{' '}
                        {todayClosed.closed_by_name ?? 'Administrator'} — figures below are for
                        the new period since then.
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <span className="text-sm text-ink-500">
                      This business day is still open — figures update live.
                    </span>
                    <Button onClick={handleCloseDay} disabled={closing}>
                      {closing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Lock className="h-4 w-4" />
                      )}
                      Z Report — Close Day
                    </Button>
                  </div>
                )}
                {closeError && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-error-50 border border-error-500/20 px-3 py-2.5">
                    <AlertCircle className="h-4 w-4 text-error-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-error-700">{closeError}</p>
                  </div>
                )}
              </div>

              {/* Sales summary — always live: the current OPEN period, i.e.
                  activity since the last closing (or since midnight if not
                  yet closed today). This is what correctly resets to zero
                  the instant the day is closed. */}
              <div className="px-8 py-6">
                <h3 className="text-lg font-bold text-ink-900 mb-4 flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-success-600" />
                  Sales Summary
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="rounded-lg bg-success-50 p-4">
                    <div className="text-xs text-success-700 font-semibold uppercase tracking-wider mb-1">
                      Net Revenue
                    </div>
                    <div className="text-2xl font-bold text-ink-900">
                      {formatCurrency(liveRevenue)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-primary-50 p-4">
                    <div className="text-xs text-primary-700 font-semibold uppercase tracking-wider mb-1">
                      Gross Sales
                    </div>
                    <div className="text-2xl font-bold text-ink-900">
                      {formatCurrency(Number(todayReport?.gross_sales ?? 0))}
                    </div>
                  </div>
                  <div className="rounded-lg bg-accent-50 p-4">
                    <div className="text-xs text-accent-700 font-semibold uppercase tracking-wider mb-1">
                      Discounts
                    </div>
                    <div className="text-2xl font-bold text-ink-900">
                      {formatCurrency(Number(todayReport?.total_discount ?? 0))}
                    </div>
                  </div>
                  <div className="rounded-lg bg-ink-100 p-4">
                    <div className="text-xs text-ink-600 font-semibold uppercase tracking-wider mb-1">
                      Avg Order
                    </div>
                    <div className="text-2xl font-bold text-ink-900">
                      {formatCurrency(liveAvg)}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
                  <div className="rounded-lg bg-ink-50 p-4">
                    <div className="text-xs text-ink-500 font-semibold uppercase tracking-wider mb-1">
                      Total Orders
                    </div>
                    <div className="text-xl font-bold text-ink-900">
                      {todayReport?.total_orders ?? 0}
                    </div>
                  </div>
                  <div className="rounded-lg bg-ink-50 p-4">
                    <div className="text-xs text-ink-500 font-semibold uppercase tracking-wider mb-1">
                      Paid Orders
                    </div>
                    <div className="text-xl font-bold text-ink-900">
                      {todayReport?.paid_orders ?? 0}
                    </div>
                  </div>
                  <div className="rounded-lg bg-warning-50 p-4">
                    <div className="text-xs text-warning-700 font-semibold uppercase tracking-wider mb-1">
                      Unpaid (Served)
                    </div>
                    <div className="text-xl font-bold text-ink-900">
                      {formatCurrency(Number(todayReport?.unpaid_amount ?? 0))}
                    </div>
                  </div>
                  <div className="rounded-lg bg-ink-50 p-4">
                    <div className="text-xs text-ink-500 font-semibold uppercase tracking-wider mb-1">
                      Items Sold
                    </div>
                    <div className="text-xl font-bold text-ink-900">
                      {todayReport?.items_sold ?? 0}
                    </div>
                  </div>
                </div>
              </div>

              {/* Best selling items — always live, for the current open period.
                  Naturally empty right after closing, populates as new
                  orders come in. */}
              <div className="border-t border-ink-200 px-8 py-6">
                <h3 className="text-lg font-bold text-ink-900 mb-4 flex items-center gap-2">
                  <Award className="h-5 w-5 text-accent-600" />
                  Best Selling Items — Current Period
                </h3>
                {!todayReport || todayReport.best_selling_items.length === 0 ? (
                  <p className="text-sm text-ink-500 py-4 text-center">
                    No completed, paid sales yet in the current period
                  </p>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-ink-200">
                        <th className="text-left text-xs font-semibold text-ink-600 uppercase tracking-wider pb-2">
                          #
                        </th>
                        <th className="text-left text-xs font-semibold text-ink-600 uppercase tracking-wider pb-2">
                          Item
                        </th>
                        <th className="text-center text-xs font-semibold text-ink-600 uppercase tracking-wider pb-2">
                          Qty Sold
                        </th>
                        <th className="text-right text-xs font-semibold text-ink-600 uppercase tracking-wider pb-2">
                          Revenue
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {todayReport.best_selling_items.map((item, idx) => (
                        <tr key={item.name} className="border-b border-ink-100">
                          <td className="py-2.5 text-sm font-bold text-ink-500 tabular-nums">
                            {idx + 1}
                          </td>
                          <td className="py-2.5 text-sm font-semibold text-ink-800">
                            {item.name}
                          </td>
                          <td className="py-2.5 text-center text-sm font-bold text-ink-900 tabular-nums">
                            {item.quantity}
                          </td>
                          <td className="py-2.5 text-right text-sm font-bold text-ink-900 tabular-nums">
                            {formatCurrency(Number(item.revenue))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="border-t-2 border-ink-200 px-8 py-6 bg-ink-50/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-success-600">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="text-sm font-semibold">
                      Viewed by {profile?.full_name ?? 'Administrator'}
                    </span>
                  </div>
                  <div className="text-xs text-ink-400">
                    Orbit Hotel · End of Day Report
                  </div>
                </div>
              </div>
            </div>

            {/* ===== History ===== */}
            <div className="bg-surface rounded-xl shadow-sm ring-1 ring-ink-200/60 overflow-hidden print:hidden">
              <div className="px-6 py-5 border-b border-ink-200 flex items-center gap-2">
                <History className="h-5 w-5 text-ink-500" />
                <h2 className="text-lg font-bold text-ink-900">Z Report History</h2>
              </div>
              {deleteError && (
                <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg bg-error-50 border border-error-500/20 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 text-error-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-error-700">{deleteError}</p>
                </div>
              )}
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <ShoppingBag className="h-10 w-10 text-ink-300 mb-3" />
                  <p className="text-sm text-ink-500">No closed business days yet</p>
                  <p className="text-xs text-ink-400 mt-1">
                    Closed Z Reports will appear here permanently.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-ink-200 bg-ink-50/50">
                        <th className="text-left text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                          Business Date
                        </th>
                        <th className="text-left text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                          Closed At
                        </th>
                        <th className="text-left text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                          Closed By
                        </th>
                        <th className="text-center text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                          Orders
                        </th>
                        <th className="text-center text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                          Items
                        </th>
                        <th className="text-right text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                          Gross
                        </th>
                        <th className="text-right text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                          <span className="inline-flex items-center gap-1">
                            <Tag className="h-3 w-3" /> Discount
                          </span>
                        </th>
                        <th className="text-right text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                          Net Revenue
                        </th>
                        <th className="text-right text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                          &nbsp;
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {history.map((r) => (
                        <tr key={r.id} className="hover:bg-ink-50/50 transition">
                          <td className="px-5 py-3.5 text-sm font-semibold text-ink-900">
                            {formatDate(r.business_date + 'T00:00:00')}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-ink-600">
                            {formatDateTime(r.closed_at)}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-ink-600">
                            {r.closed_by_name ?? '—'}
                          </td>
                          <td className="px-5 py-3.5 text-center text-sm text-ink-700 tabular-nums">
                            {r.total_orders}
                          </td>
                          <td className="px-5 py-3.5 text-center text-sm text-ink-700 tabular-nums">
                            {r.items_sold}
                          </td>
                          <td className="px-5 py-3.5 text-right text-sm text-ink-700 tabular-nums">
                            {formatCurrency(Number(r.gross_sales))}
                          </td>
                          <td className="px-5 py-3.5 text-right text-sm text-ink-700 tabular-nums">
                            {formatCurrency(Number(r.total_discount))}
                          </td>
                          <td className="px-5 py-3.5 text-right text-sm font-bold text-ink-900 tabular-nums">
                            {formatCurrency(Number(r.net_revenue))}
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <button
                              onClick={() => handleDeleteReport(r)}
                              disabled={deletingId === r.id}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-error-600 hover:bg-error-50 transition disabled:opacity-50"
                              title="Delete this Z Report record (does not affect orders)"
                            >
                              {deletingId === r.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {!loading && !todayReport && !todayClosed && (
          <div className="flex flex-col items-center justify-center py-20 text-center print:hidden">
            <p className="text-sm text-ink-500">Failed to load today's report</p>
            <Button variant="secondary" className="mt-4" onClick={loadEverything}>
              Retry
            </Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
