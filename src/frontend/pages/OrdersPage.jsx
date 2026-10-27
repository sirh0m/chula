import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Receipt, RefreshCw } from 'lucide-react';
import ActiveTokenCard from '@/components/ActiveTokenCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDay, formatUgx, formatWindow } from '@/lib/format';

const STATUS_LABEL = {
  pending_payment: ['Awaiting payment', 'accent'],
  paid: ['Ready for pickup', 'success'],
  collected: ['Collected', 'secondary'],
  cancelled: ['Cancelled', 'destructive'],
  refunded: ['Refunded', 'destructive'],
};

export default function OrdersPage() {
  const { getAuthHeaders } = useAuth();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.listOrders(getAuthHeaders());
      setOrders(data.orders);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  const active = orders?.filter((o) => o.status === 'paid') ?? [];
  const past = orders?.filter((o) => o.status !== 'paid' && o.status !== 'pending_payment') ?? [];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-extrabold tracking-tight">My orders</h1>
      <p className="mt-1 text-sm text-muted-foreground">Show your 6-digit code at the store counter to collect your bag.</p>

      {error && (
        <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-center">
          <p className="font-semibold">Couldn't load your orders</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" className="mt-3" onClick={load}>
            <RefreshCw /> Try again
          </Button>
        </div>
      )}

      {!orders && !error && (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      )}

      {orders && orders.length === 0 && (
        <div className="mt-6 rounded-xl border border-dashed p-10 text-center">
          <Receipt className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 font-semibold">No orders yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Reserve a surprise bag near you and your pickup code will show up here.</p>
          <Button asChild className="mt-4">
            <Link to="/">Find bags near me</Link>
          </Button>
        </div>
      )}

      {active.length > 0 && (
        <section className="mt-6 space-y-4">
          <h2 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">Ready for pickup</h2>
          {active.map((order) => (
            <Link key={order.id} to={`/orders/${order.id}`} className="block">
              <ActiveTokenCard order={order} compact />
            </Link>
          ))}
        </section>
      )}

      {past.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">History</h2>
          <ul className="mt-3 divide-y rounded-xl border bg-card">
            {past.map((order) => {
              const [label, variant] = STATUS_LABEL[order.status];
              return (
                <li key={order.id}>
                  <Link to={`/orders/${order.id}`} className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/60">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">
                        {order.quantity} × {order.bag.title}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {order.merchant.name} · {formatDay(order.bag.pickup_start_time)}, {formatWindow(order.bag.pickup_start_time, order.bag.pickup_end_time)}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge variant={variant}>{label}</Badge>
                      <p className="mt-1 text-xs text-muted-foreground tabular-nums">{formatUgx(order.amount_paid)}</p>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
