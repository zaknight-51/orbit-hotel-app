import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useTables } from '@/hooks/useTables';
import {
  Plus,
  QrCode,
  Printer,
  Loader2,
  AlertCircle,
  UtensilsCrossed,
  X,
  Trash2,
} from 'lucide-react';
import type { RestaurantTable } from '@/types';

function tableOrderUrl(qrToken: string) {
  return `${window.location.origin}/order/${qrToken}`;
}

export function TableManagement() {
  const { tables, loading, error, addTable, deleteTable } = useTables();

  const [addOpen, setAddOpen] = useState(false);
  const [tableName, setTableName] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [qrTable, setQrTable] = useState<RestaurantTable | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Table numbers are auto-assigned by the database (see migrations) —
  // "Add Table" always creates the next sequential table (1, 2, 3, ...).
  // An optional label can still be added for something like "Patio 3".
  async function handleAddTable() {
    setSaving(true);
    setFormError(null);
    try {
      await addTable(tableName.trim());
      setAddOpen(false);
      setTableName('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to add table');
    } finally {
      setSaving(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  async function handleDeleteTable(table: RestaurantTable) {
    const confirm = window.confirm(
      `Delete Table ${table.table_number}${table.name ? ` (${table.name})` : ''}? Its QR code will stop working immediately. Past orders are kept but will no longer show a table link.`
    );
    if (!confirm) return;

    setDeletingId(table.id);
    try {
      await deleteTable(table.id);
      if (qrTable?.id === table.id) setQrTable(null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete table');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <DashboardLayout>
      <div className="animate-fade-in-up space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-ink-900">Table Management</h1>
            <p className="mt-1 text-sm text-ink-500">
              Add tables and generate their QR codes for customer ordering.
            </p>
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-5 w-5" />
            Add Table
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-error-50 border border-error-500/20 px-4 py-3">
            <AlertCircle className="h-5 w-5 text-error-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-error-700">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        ) : tables.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center rounded-xl bg-surface shadow-sm ring-1 ring-ink-200/60">
            <UtensilsCrossed className="h-10 w-10 text-ink-300 mb-3" />
            <p className="text-sm font-medium text-ink-600">No tables yet</p>
            <p className="text-xs text-ink-400 mt-1">Add your first table to generate its QR code.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {tables.map((table) => (
              <div
                key={table.id}
                className="relative rounded-xl bg-surface p-5 shadow-sm ring-1 ring-ink-200/60 flex flex-col items-center text-center"
              >
                <button
                  onClick={() => handleDeleteTable(table)}
                  disabled={deletingId === table.id}
                  aria-label={`Delete Table ${table.table_number}`}
                  className="absolute top-2.5 right-2.5 rounded-md p-1.5 text-ink-400 hover:text-error-600 hover:bg-error-50 transition disabled:opacity-50"
                >
                  {deletingId === table.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
                <div className="text-2xl font-bold text-ink-900">Table {table.table_number}</div>
                {table.name && <div className="text-xs text-ink-500 mt-0.5">{table.name}</div>}
                <button
                  onClick={() => setQrTable(table)}
                  className="mt-4 flex items-center gap-1.5 rounded-lg bg-primary-50 text-primary-700 px-3 py-1.5 text-xs font-semibold hover:bg-primary-100 transition"
                >
                  <QrCode className="h-3.5 w-3.5" />
                  View QR Code
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add table modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add Table"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddTable} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add Table
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="flex items-start gap-2 rounded-lg bg-error-50 border border-error-500/20 px-3 py-2">
              <AlertCircle className="h-4 w-4 text-error-600 flex-shrink-0 mt-0.5" />
              <span className="text-xs text-error-700">{formError}</span>
            </div>
          )}
          <p className="text-sm text-ink-500">
            The table number is assigned automatically — this will be{' '}
            <span className="font-semibold text-ink-700">
              Table {(tables[tables.length - 1]?.table_number ?? 0) + 1}
            </span>
            .
          </p>
          <div>
            <label className="block text-sm font-semibold text-ink-700 mb-1.5">
              Label <span className="font-normal text-ink-400">(optional)</span>
            </label>
            <input
              type="text"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              placeholder="e.g. Patio 3"
              className="w-full rounded-lg border border-ink-300 bg-surface px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
            />
          </div>
        </div>
      </Modal>

      {/* View / print QR modal */}
      {qrTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:static print:p-0">
          <div
            className="fixed inset-0 bg-ink-950/50 backdrop-blur-sm print:hidden"
            onClick={() => setQrTable(null)}
          />
          <div className="relative w-full max-w-sm rounded-2xl bg-surface shadow-2xl p-6 print:shadow-none print:rounded-none print:max-w-full">
            <button
              onClick={() => setQrTable(null)}
              className="absolute top-4 right-4 text-ink-400 hover:text-ink-600 transition print:hidden"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex flex-col items-center text-center py-2">
              {/* Printed card: QR code, then the table number clearly
                  beneath it — this exact block (qr-print-card) is what
                  ends up on the printed page. */}
              <div className="qr-print-card flex flex-col items-center">
                <div className="rounded-xl border-2 border-ink-200 p-4 bg-surface">
                  <QRCodeSVG value={tableOrderUrl(qrTable.qr_token)} size={220} />
                </div>
                <div className="mt-4 text-2xl font-extrabold tracking-wide text-ink-900">
                  TABLE {qrTable.table_number}
                </div>
                {qrTable.name && (
                  <div className="text-sm text-ink-500 mt-0.5">{qrTable.name}</div>
                )}
              </div>

              <p className="text-xs text-ink-400 mt-4 break-all px-4 print:hidden">
                {tableOrderUrl(qrTable.qr_token)}
              </p>
              <p className="text-xs text-ink-500 mt-2 print:hidden">
                Scan to view the menu and order
              </p>

              <div className="mt-5 flex items-center gap-2 print:hidden">
                <Button onClick={handlePrint}>
                  <Printer className="h-4 w-4" />
                  Print
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => handleDeleteTable(qrTable)}
                  disabled={deletingId === qrTable.id}
                  className="text-error-600 hover:text-error-700"
                >
                  {deletingId === qrTable.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
