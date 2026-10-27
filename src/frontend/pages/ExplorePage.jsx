import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Leaf, RefreshCw, ShoppingBag, Ticket } from 'lucide-react';
import BagCard from '@/components/BagCard';
import CheckoutModal from '@/components/CheckoutModal';
import MapView, { isAvailable } from '@/components/MapView';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useGeolocation } from '@/hooks/useGeolocation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { distanceKm, formatUgx } from '@/lib/format';
import { cn } from '@/lib/utils';

const DISTRICTS = ['All', 'Ntinda', 'Kololo', 'Bugolobi', 'Nakasero'];
const REFRESH_MS = 60_000;

export default function ExplorePage() {
  const navigate = useNavigate();
  const { user, getAuthHeaders } = useAuth();
  const { position, status: geoStatus, request: locate } = useGeolocation({ auto: false });
  const [bags, setBags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [district, setDistrict] = useState('All');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [checkoutBag, setCheckoutBag] = useState(null);
  const [readyOrders, setReadyOrders] = useState([]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const data = await api.listBags();
      setBags(data.bags);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load({ quiet: true }), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!user) return;
    api
      .listOrders(getAuthHeaders())
      .then(({ orders }) => setReadyOrders(orders.filter((o) => o.status === 'paid')))
      .catch(() => setReadyOrders([]));
  }, [user, getAuthHeaders]);

  const visible = useMemo(() => {
    const filtered = bags
      .filter((bag) => district === 'All' || bag.merchant.district === district)
      .filter((bag) => !availableOnly || isAvailable(bag))
      .map((bag) => ({ bag, km: distanceKm(position, [bag.merchant.latitude, bag.merchant.longitude]) }));
    return filtered.sort((a, b) => {
      const availability = Number(isAvailable(b.bag)) - Number(isAvailable(a.bag));
      if (availability) return availability;
      if (a.km !== null && b.km !== null) return a.km - b.km;
      return new Date(a.bag.pickup_start_time) - new Date(b.bag.pickup_start_time);
    });
  }, [bags, district, availableOnly, position]);

  const stats = useMemo(() => {
    const available = bags.filter(isAvailable);
    return {
      bags: available.reduce((sum, b) => sum + b.quantity_available, 0),
      stores: new Set(available.map((b) => b.merchant.id)).size,
      savings: available.reduce((sum, b) => sum + (b.original_price - b.discount_price) * b.quantity_available, 0),
    };
  }, [bags]);

  const mapBags = useMemo(() => visible.map((v) => v.bag), [visible]);

  const handlePaid = (order) => {
    setTimeout(() => {
      setCheckoutBag(null);
      navigate(`/orders/${order.id}`);
    }, 900);
  };

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col lg:grid lg:h-[calc(100dvh-4rem)] lg:grid-cols-[minmax(380px,460px)_1fr]">
      <MapView
        bags={mapBags}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onReserve={setCheckoutBag}
        userPosition={position}
        onLocate={locate}
        locating={geoStatus === 'locating'}
        className="order-1 h-[42dvh] min-h-[280px] border-b lg:order-2 lg:h-full lg:border-b-0 lg:border-l"
      />

      <section className="order-2 flex min-h-0 flex-col lg:order-1">
        <div className="space-y-4 border-b p-4">
          <div>
            <h1 className="text-2xl leading-tight font-extrabold tracking-tight text-balance">
              Good food, rescued tonight in Kampala
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Surprise bags from local bakeries, cafés and kitchens at up to 70% off. Pay with MTN MoMo or Airtel Money, collect with
              your code.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat icon={ShoppingBag} value={loading ? '–' : stats.bags} label="bags left" />
            <Stat icon={Leaf} value={loading ? '–' : stats.stores} label="stores" />
            <Stat value={loading ? '–' : formatUgx(stats.savings).replace('UGX ', '')} label="UGX to save" />
          </div>

          {readyOrders.length > 0 && (
            <Link
              to={readyOrders.length === 1 ? `/orders/${readyOrders[0].id}` : '/orders'}
              className="flex items-center gap-3 rounded-xl bg-primary p-3 text-primary-foreground shadow-sm transition-opacity hover:opacity-95"
            >
              <Ticket className="size-5 shrink-0" />
              <span className="flex-1 text-sm font-semibold">
                {readyOrders.length === 1
                  ? `Your pickup code for ${readyOrders[0].merchant.name} is ready`
                  : `${readyOrders.length} pickup codes ready`}
              </span>
              <ArrowRight className="size-4" />
            </Link>
          )}

          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {DISTRICTS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDistrict(d)}
                className={cn(
                  'shrink-0 cursor-pointer rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors',
                  district === d ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted',
                )}
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAvailableOnly((v) => !v)}
              aria-pressed={availableOnly}
              className={cn(
                'shrink-0 cursor-pointer rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors',
                availableOnly ? 'border-primary bg-secondary text-primary' : 'bg-card hover:bg-muted',
              )}
            >
              Available only
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[116px] rounded-xl" />)
          ) : error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
              <p className="font-semibold">We couldn't load today's bags</p>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" className="mt-4" onClick={() => load()}>
                <RefreshCw /> Try again
              </Button>
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <ShoppingBag className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 font-semibold">
                No {availableOnly ? 'available ' : ''}bags {district !== 'All' ? `in ${district} ` : ''}right now
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Stores usually list their surplus in the late afternoon. Check back after 5pm or try another area.
              </p>
            </div>
          ) : (
            visible.map(({ bag, km }) => (
              <BagCard
                key={bag.id}
                bag={bag}
                distanceKm={km}
                selected={bag.id === selectedId}
                onSelect={setSelectedId}
                onReserve={setCheckoutBag}
              />
            ))
          )}
          {geoStatus === 'denied' && (
            <p className="text-center text-xs text-muted-foreground">Location is off, so bags are sorted by pickup time.</p>
          )}
        </div>
      </section>

      <CheckoutModal
        bag={checkoutBag}
        open={Boolean(checkoutBag)}
        onOpenChange={(open) => {
          if (!open) {
            setCheckoutBag(null);
            load({ quiet: true });
          }
        }}
        onPaid={handlePaid}
      />
    </div>
  );
}

function Stat({ icon: Icon, value, label }) {
  return (
    <div className="rounded-xl bg-secondary/70 px-2 py-2.5">
      <p className="flex items-center justify-center gap-1 text-lg font-extrabold text-primary tabular-nums">
        {Icon && <Icon className="size-4" />}
        {value}
      </p>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
    </div>
  );
}
