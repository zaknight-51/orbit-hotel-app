import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { RequireAuth, RequireRole } from '@/components/auth/ProtectedRoute';
import { LoginPage } from '@/pages/LoginPage';
import { AdminDashboard } from '@/pages/AdminDashboard';
import { CashierDashboard } from '@/pages/CashierDashboard';
import { KitchenDashboard } from '@/pages/KitchenDashboard';
import { PosScreen } from '@/pages/PosScreen';
import { MenuManagement } from '@/pages/MenuManagement';
import { StaffManagement } from '@/pages/StaffManagement';
import { InventoryManagement } from '@/pages/InventoryManagement';
import { OrderHistory } from '@/pages/OrderHistory';
import { AnalyticsDashboard } from '@/pages/AnalyticsDashboard';
import { ZReport } from '@/pages/ZReport';
import { TableManagement } from '@/pages/TableManagement';
import { PromotionManagement } from '@/pages/PromotionManagement';
import { CustomerOrderPage } from '@/pages/CustomerOrderPage';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import type { UserRole } from '@/types';
import { Loader2 } from 'lucide-react';

function RootRedirect() {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;
  const role: UserRole = profile?.role ?? 'kitchen';
  return <Navigate to={`/${role}`} replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RootRedirect />} />

      {/* Admin routes */}
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <RequireRole allowedRoles={['admin']}>
              <AdminDashboard />
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/pos"
        element={
          <RequireAuth>
            <RequireRole allowedRoles={['admin', 'cashier']}>
              <DashboardLayout>
                <PosScreen />
              </DashboardLayout>
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/menu"
        element={
          <RequireAuth>
            <RequireRole allowedRoles={['admin']}>
              <MenuManagement />
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/tables"
        element={
          <RequireAuth>
            <RequireRole allowedRoles={['admin']}>
              <TableManagement />
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/promotions"
        element={
          <RequireAuth>
            <RequireRole allowedRoles={['admin']}>
              <PromotionManagement />
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/staff"
        element={
          <RequireAuth>
            <RequireRole allowedRoles={['admin']}>
              <StaffManagement />
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/inventory"
        element={
          <RequireAuth>
            <RequireRole allowedRoles={['admin']}>
              <InventoryManagement />
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/orders"
        element={
          <RequireAuth>
            <RequireRole allowedRoles={['admin']}>
              <OrderHistory />
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/analytics"
        element={
          <RequireAuth>
            <RequireRole allowedRoles={['admin']}>
              <AnalyticsDashboard />
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/z-report"
        element={
          <RequireAuth>
            <RequireRole allowedRoles={['admin']}>
              <ZReport />
            </RequireRole>
          </RequireAuth>
        }
      />

      {/* Cashier routes */}
      <Route
        path="/cashier"
        element={
          <RequireAuth>
            <RequireRole allowedRoles={['cashier']}>
              <CashierDashboard />
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        path="/cashier/pos"
        element={
          <RequireAuth>
            <RequireRole allowedRoles={['cashier']}>
              <DashboardLayout>
                <PosScreen />
              </DashboardLayout>
            </RequireRole>
          </RequireAuth>
        }
      />
      {/* Kitchen routes */}
      <Route
        path="/kitchen"
        element={
          <RequireAuth>
            <RequireRole allowedRoles={['kitchen']}>
              <KitchenDashboard />
            </RequireRole>
          </RequireAuth>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// The public customer QR-ordering page is deliberately mounted OUTSIDE
// AuthProvider: it uses its own anonymous Supabase session (see
// CustomerOrderPage.tsx), and staff auth (AuthContext's session/profile
// self-heal logic) must never run for that anonymous session. Every
// existing staff route below is completely unchanged — still wrapped in
// AuthProvider exactly as before.
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/order/:token" element={<CustomerOrderPage />} />
        <Route
          path="/*"
          element={
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
