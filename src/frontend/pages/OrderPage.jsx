import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, PartyPopper } from 'lucide-react';
import ActiveTokenCard from '@/components/ActiveTokenCard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useGeolocation } from '@/hooks/useGeolocation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function OrderPage() {
  const { orderId } = useParams();
  const { getAuthHeaders } = useAuth();
  const { position } = useGeolocation();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let timer;
    const load = async () => {
      try {
        const data = await api.getOrder(orderId, getAuthHeaders());
        if (cancelled) return;
        setOrder(data.order);
        setError('');
        // Keep polling while the status can still change (payment or pickup).
        if (['pending_payment', 'paid'].includes(data.order.status)) timer = setTimeout(load, 5000);
      } catch (err) {
        if (cancelled) return;
        setError(err.status === 404 ? 'We could not find this order on your account.' : err.message);
      }
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [orderId, getAuthHeaders]);

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link to="/orders">
          <ArrowLeft /> My orders
        </Link>
      </Button>

      {error ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="font-semibold">Order unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <Button asChild className="mt-4">
            <Link to="/">Back to the map</Link>
          </Button>
        </div>
      ) : !order ? (
        <Skeleton className="h-[540px] rounded-xl" />
      ) : (
        <div className="space-y-4">
          {order.status === 'collected' && (
            <div className="flex items-center gap-3 rounded-xl bg-secondary p-4 text-sm font-semibold text-primary">
              <PartyPopper className="size-5" /> Collected. Thanks for rescuing food with Chula!
            </div>
          )}
          <ActiveTokenCard order={order} userPosition={position} />
          {order.status === 'paid' && (
            <p className="text-center text-xs text-muted-foreground">
              Staff will confirm your code on their phone. This page updates automatically once collected.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
