import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import {
  LayoutDashboard,
  Users,
  Receipt,
  ChefHat,
  LogOut,
  Menu as MenuIcon,
  X,
  UserCircle,
  UtensilsCrossed,
  Package,
  Clock,
  BarChart3,
  FileText,
  QrCode,
  Megaphone,
} from 'lucide-react';
import type { UserRole } from '@/types';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: UserRole[];
}

const navItems: NavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin'] },
  { to: '/admin/menu', label: 'Menu Management', icon: UtensilsCrossed, roles: ['admin'] },
  { to: '/admin/tables', label: 'Table Management', icon: QrCode, roles: ['admin'] },
  { to: '/admin/promotions', label: 'Promotions', icon: Megaphone, roles: ['admin'] },
  { to: '/admin/inventory', label: 'Inventory', icon: Package, roles: ['admin'] },
  { to: '/admin/staff', label: 'Staff Management', icon: Users, roles: ['admin'] },
  { to: '/admin/pos', label: 'POS Terminal', icon: Receipt, roles: ['admin'] },
  { to: '/admin/orders', label: 'Order History', icon: Clock, roles: ['admin'] },
  { to: '/admin/analytics', label: 'Analytics', icon: BarChart3, roles: ['admin'] },
  { to: '/admin/z-report', label: 'Z Report', icon: FileText, roles: ['admin'] },
  { to: '/cashier', label: 'Dashboard', icon: LayoutDashboard, roles: ['cashier'] },
  { to: '/cashier/pos', label: 'New Order (POS)', icon: Receipt, roles: ['cashier'] },
  { to: '/kitchen', label: 'Kitchen Board', icon: ChefHat, roles: ['kitchen'] },
];

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

export function DashboardLayout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (!profile) return null;

  const items = navItems.filter((item) => item.roles.includes(profile.role));

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center border-b border-ink-200 px-5">
        <Logo size="sm" />
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
        {items.map((item) => {
          const active =
            location.pathname === item.to ||
            (item.to !== `/${profile.role}` && location.pathname.startsWith(item.to));
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-primary-600 text-ink-950 shadow-sm'
                  : 'text-ink-400 hover:bg-ink-100 hover:text-white'
              }`}
            >
              <Icon className="h-5 w-5 flex-shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-ink-200 p-3">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 mb-2">
          <div className="h-9 w-9 rounded-full bg-ink-200 flex items-center justify-center flex-shrink-0">
            <UserCircle className="h-5 w-5 text-primary-500" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-white truncate">
              {profile.full_name ?? profile.email}
            </div>
            <span
              className={`inline-block mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${roleBadgeColors[profile.role]}`}
            >
              {roleLabels[profile.role]}
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          className="w-full text-ink-400 hover:bg-ink-100 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-ink-50">
      {/* Desktop sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 lg:flex lg:flex-col bg-ink-50 border-r border-ink-200">
        {sidebar}
      </aside>

      {/* Mobile sidebar */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-ink-950/60 animate-fade-in"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative w-64 flex flex-col bg-ink-50 border-r border-ink-200 animate-fade-in-up">
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute top-4 right-3 text-ink-400 hover:text-white"
              aria-label="Close menu"
            >
              <X className="h-6 w-6" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-ink-200 bg-surface px-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-ink-600 hover:text-ink-900"
            aria-label="Open menu"
          >
            <MenuIcon className="h-6 w-6" />
          </button>
          <Logo size="sm" />
        </header>

        <main className="p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
