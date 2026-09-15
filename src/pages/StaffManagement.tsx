import { useState, useEffect } from 'react';
import { useStaff } from '@/hooks/useStaff';
import { useAuth } from '@/context/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/ui/StatCard';
import { formatDate } from '@/lib/format';
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Users,
  ShieldCheck,
  Receipt,
  ChefHat,
  Loader2,
  AlertCircle,
  Check,
  X,
} from 'lucide-react';
import type { Profile, UserRole } from '@/types';

type StaffModal = { mode: 'create' } | { mode: 'edit'; member: Profile } | null;

const roleLabels: Record<UserRole, string> = {
  admin: 'Administrator',
  cashier: 'Cashier',
  kitchen: 'Kitchen Staff',
};

const roleBadgeColors: Record<UserRole, string> = {
  admin: 'bg-accent-100 text-accent-800',
  cashier: 'bg-primary-100 text-primary-800',
  kitchen: 'bg-success-50 text-success-700 ring-1 ring-success-500/20',
};

export function StaffManagement() {
  const { profile: currentProfile } = useAuth();
  const { staff, loading, createStaff, updateStaff, deleteStaff } = useStaff();

  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<StaffModal>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('cashier');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (modal?.mode === 'create') {
      setFullName('');
      setEmail('');
      setPassword('');
      setRole('cashier');
      setIsActive(true);
    } else if (modal?.mode === 'edit') {
      setFullName(modal.member.full_name ?? '');
      setEmail(modal.member.email);
      setRole(modal.member.role);
      setIsActive(modal.member.is_active);
    }
  }, [modal]);

  const filteredStaff = staff.filter((member) => {
    const term = search.trim().toLowerCase();
    if (term === '') return true;
    return (
      member.email.toLowerCase().includes(term) ||
      (member.full_name ?? '').toLowerCase().includes(term)
    );
  });

  const counts = {
    admin: staff.filter((s) => s.role === 'admin').length,
    cashier: staff.filter((s) => s.role === 'cashier').length,
    kitchen: staff.filter((s) => s.role === 'kitchen').length,
  };

  async function handleSave() {
    setError(null);

    if (modal?.mode === 'create') {
      if (!fullName.trim() || !email.trim() || password.length < 6) {
        setError('Name, email, and a password (6+ characters) are required.');
        return;
      }
      setSaving(true);
      try {
        await createStaff({ email, password, full_name: fullName, role });
        setModal(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSaving(false);
      }
    } else if (modal?.mode === 'edit') {
      if (!fullName.trim()) {
        setError('Name is required.');
        return;
      }
      setSaving(true);
      try {
        await updateStaff(modal.member.id, {
          full_name: fullName.trim(),
          role,
          is_active: isActive,
        });
        setModal(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSaving(false);
      }
    }
  }

  async function handleDelete(member: Profile) {
    if (member.id === currentProfile?.id) {
      setError('You cannot remove your own account.');
      return;
    }
    if (!window.confirm(`Remove "${member.full_name ?? member.email}" from staff?`)) return;
    setError(null);
    try {
      await deleteStaff(member.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <DashboardLayout>
      <div className="animate-fade-in-up space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink-900">Staff Management</h1>
            <p className="mt-1 text-sm text-ink-500">
              Manage staff accounts, roles, and access
            </p>
          </div>
          <Button onClick={() => setModal({ mode: 'create' })}>
            <Plus className="h-4 w-4" />
            Add Staff Member
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard label="Administrators" value={counts.admin} icon={ShieldCheck} tone="accent" />
          <StatCard label="Cashiers" value={counts.cashier} icon={Receipt} tone="primary" />
          <StatCard label="Kitchen Staff" value={counts.kitchen} icon={ChefHat} tone="success" />
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

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-ink-400" />
          <input
            type="text"
            placeholder="Search staff by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-ink-300 bg-surface pl-11 pr-4 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
          />
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        ) : filteredStaff.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Users className="h-12 w-12 text-ink-300 mb-3" />
            <p className="text-sm font-medium text-ink-600">No staff members found</p>
            <p className="text-xs text-ink-400 mt-1">Add a staff member to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl bg-surface shadow-sm ring-1 ring-ink-200/60">
            <table className="w-full">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50/50">
                  <th className="text-left text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                    Name
                  </th>
                  <th className="text-left text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                    Email
                  </th>
                  <th className="text-center text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                    Role
                  </th>
                  <th className="text-center text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                    Status
                  </th>
                  <th className="text-left text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                    Joined
                  </th>
                  <th className="text-right text-xs font-semibold text-ink-600 uppercase tracking-wider px-5 py-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filteredStaff.map((member) => (
                  <tr key={member.id} className="hover:bg-ink-50/50 transition">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-ink-100 flex items-center justify-center flex-shrink-0">
                          <Users className="h-4 w-4 text-ink-500" />
                        </div>
                        <div className="font-semibold text-ink-900 text-sm">
                          {member.full_name ?? '—'}
                          {member.id === currentProfile?.id && (
                            <span className="ml-2 text-xs text-ink-400 font-normal">(you)</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-ink-600">{member.email}</td>
                    <td className="px-5 py-3.5 text-center">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${roleBadgeColors[member.role]}`}
                      >
                        {roleLabels[member.role]}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          member.is_active
                            ? 'bg-success-50 text-success-700 ring-1 ring-success-500/20'
                            : 'bg-ink-100 text-ink-500'
                        }`}
                      >
                        {member.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-ink-500">
                      {formatDate(member.created_at)}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setModal({ mode: 'edit', member })}
                          className="p-1.5 text-ink-400 hover:text-primary-600 hover:bg-primary-50 rounded-md transition"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(member)}
                          disabled={member.id === currentProfile?.id}
                          className="p-1.5 text-ink-400 hover:text-error-600 hover:bg-error-50 rounded-md transition disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Staff Modal */}
      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal?.mode === 'edit' ? 'Edit Staff Member' : 'Add Staff Member'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !fullName.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {modal?.mode === 'edit' ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-ink-700 mb-1.5">
              Full Name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Maria Santos"
              className="w-full rounded-lg border border-ink-300 bg-surface px-4 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-ink-700 mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@orbithotel.com"
              disabled={modal?.mode === 'edit'}
              className="w-full rounded-lg border border-ink-300 bg-surface px-4 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition disabled:bg-ink-50 disabled:text-ink-400"
            />
          </div>
          {modal?.mode === 'create' && (
            <div>
              <label className="block text-sm font-semibold text-ink-700 mb-1.5">
                Temporary Password
              </label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full rounded-lg border border-ink-300 bg-surface px-4 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
              />
              <p className="mt-1.5 text-xs text-ink-400">
                Share this with the staff member so they can sign in and change it.
              </p>
            </div>
          )}
          <div>
            <label className="block text-sm font-semibold text-ink-700 mb-1.5">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              disabled={modal?.mode === 'edit' && modal.member.id === currentProfile?.id}
              className="w-full rounded-lg border border-ink-300 bg-surface px-4 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition disabled:bg-ink-50 disabled:text-ink-400"
            >
              <option value="admin">Administrator</option>
              <option value="cashier">Cashier</option>
              <option value="kitchen">Kitchen Staff</option>
            </select>
            {modal?.mode === 'edit' && modal.member.id === currentProfile?.id && (
              <p className="mt-1.5 text-xs text-ink-400">
                You cannot change your own role.
              </p>
            )}
          </div>
          {modal?.mode === 'edit' && (
            <label className="flex items-center gap-2.5 cursor-pointer">
              <button
                type="button"
                onClick={() => setIsActive((v) => !v)}
                disabled={modal.member.id === currentProfile?.id}
                className={`relative h-6 w-11 rounded-full transition disabled:opacity-40 ${
                  isActive ? 'bg-success-500' : 'bg-ink-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    isActive ? 'left-[1.375rem]' : 'left-0.5'
                  }`}
                />
              </button>
              <span className="text-sm font-semibold text-ink-700">
                {isActive ? 'Active' : 'Inactive'}
              </span>
              {modal.member.id === currentProfile?.id && (
                <span className="text-xs text-ink-400">(cannot deactivate yourself)</span>
              )}
            </label>
          )}
        </div>
      </Modal>
    </DashboardLayout>
  );
}
