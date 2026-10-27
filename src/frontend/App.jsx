import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useHealth } from '@/hooks/useHealth';
import { AuthProvider, useAuth } from '@/lib/auth';
import ExplorePage from '@/pages/ExplorePage';
import MerchantSimulatorPage from '@/pages/MerchantSimulatorPage';
import OrderPage from '@/pages/OrderPage';
import OrdersPage from '@/pages/OrdersPage';
import SignInPage from '@/pages/SignInPage';

function RequireUser({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="grid flex-1 place-items-center py-20 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname)}`} replace />;
  return children;
}

function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <p className="text-5xl font-extrabold text-primary">404</p>
      <p className="mt-2 font-semibold">This page has been eaten.</p>
      <a href="/" className="mt-4 inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline">
        Back to today's bags
      </a>
    </div>
  );
}

function Shell() {
  const health = useHealth();
  return (
    <div className="flex min-h-full flex-col">
      <AppHeader health={health} />
      <main className="flex flex-1 flex-col">
        <Routes>
          <Route path="/" element={<ExplorePage />} />
          <Route path="/signin" element={<SignInPage />} />
          <Route
            path="/orders"
            element={
              <RequireUser>
                <OrdersPage />
              </RequireUser>
            }
          />
          <Route
            path="/orders/:orderId"
            element={
              <RequireUser>
                <OrderPage />
              </RequireUser>
            }
          />
          {health?.whatsappSimulator && <Route path="/merchant" element={<MerchantSimulatorPage />} />}
          <Route path="*" element={health ? <NotFound /> : null} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
