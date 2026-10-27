import { useMemo, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, TileLayer } from 'react-leaflet';
import { Check, CheckCircle2, Clock, Copy, MapPin, Navigation, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useNow } from '@/hooks/useNow';
import { directionsUrl, distanceKm, formatDay, formatDistance, formatUgx, formatWindow, pickupState } from '@/lib/format';
import { cn } from '@/lib/utils';

const storeIcon = L.divIcon({ className: 'chula-marker', html: '<div class="chula-store-pin"></div>', iconSize: [0, 0] });
const userIcon = L.divIcon({ className: 'chula-marker', html: '<div class="chula-user-dot"></div>', iconSize: [0, 0] });

const STATUS = {
  paid: { label: 'Ready for pickup', variant: 'success' },
  collected: { label: 'Collected', variant: 'secondary' },
  pending_payment: { label: 'Awaiting payment', variant: 'accent' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
  refunded: { label: 'Refunded', variant: 'destructive' },
};

function DirectionsMap({ merchant, userPosition }) {
  const store = [merchant.latitude, merchant.longitude];
  const bounds = useMemo(
    () => (userPosition ? L.latLngBounds([store, userPosition]).pad(0.25) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [merchant.latitude, merchant.longitude, userPosition?.[0], userPosition?.[1]],
  );
  return (
    <MapContainer
      key={bounds ? 'with-user' : 'store-only'}
      center={store}
      zoom={15}
      bounds={bounds ?? undefined}
      zoomControl={false}
      attributionControl={false}
      scrollWheelZoom={false}
      dragging={false}
      doubleClickZoom={false}
      className="h-full w-full"
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" subdomains="abcd" />
      <Marker position={store} icon={storeIcon} interactive={false} />
      {userPosition && (
        <>
          <Marker position={userPosition} icon={userIcon} interactive={false} />
          <Polyline positions={[userPosition, store]} pathOptions={{ color: '#15803d', weight: 3, dashArray: '6 8' }} />
        </>
      )}
    </MapContainer>
  );
}

/**
 * The customer's proof of purchase: live 6-digit pickup code, pickup
 * window countdown and a directions map to the store.
 */
export default function ActiveTokenCard({ order, userPosition, compact = false }) {
  const now = useNow(15_000);
  const [copied, setCopied] = useState(false);
  const { bag, merchant } = order;
  const status = STATUS[order.status] ?? STATUS.paid;
  const pickup = pickupState(bag.pickup_start_time, bag.pickup_end_time, now);
  const distance = formatDistance(distanceKm(userPosition, [merchant.latitude, merchant.longitude]));
  const live = order.status === 'paid';
  const digits = (order.pickup_token ?? '------').split('');

  const copy = async () => {
    await navigator.clipboard?.writeText(order.pickup_token).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card className={cn('overflow-hidden', live && 'border-primary/30 shadow-lg shadow-primary/5')}>
      <div className={cn('relative px-5 pt-5 pb-6 text-primary-foreground', live ? 'bg-primary' : 'bg-foreground/80')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold tracking-wide uppercase opacity-80">
              {merchant.name} · {merchant.district}
            </p>
            <p className="mt-0.5 truncate text-lg font-bold">
              {order.quantity} × {bag.title}
            </p>
          </div>
          <Badge variant={live ? 'accent' : 'secondary'} className={cn(live && 'bg-accent text-accent-foreground')}>
            {order.status === 'collected' ? <CheckCircle2 /> : order.status === 'paid' ? <Clock /> : <XCircle />}
            {status.label}
          </Badge>
        </div>

        {order.pickup_token ? (
          <div className="mt-5">
            <p className="text-center text-xs font-medium opacity-80">
              {live ? 'Show this code at the counter' : 'Pickup code'}
            </p>
            <div className={cn('mt-2 flex justify-center gap-1.5 sm:gap-2', !live && 'opacity-60')} aria-label={`Pickup code ${order.pickup_token}`}>
              {digits.map((digit, index) => (
                <span
                  key={index}
                  className={cn(
                    'grid h-14 w-11 place-items-center rounded-lg bg-card text-3xl font-extrabold text-foreground tabular-nums shadow-sm sm:h-16 sm:w-12 sm:text-4xl',
                    index === 2 && 'mr-2 sm:mr-3',
                    !live && 'line-through decoration-2',
                  )}
                >
                  {digit}
                </span>
              ))}
            </div>
            {live && (
              <div className="mt-3 flex justify-center">
                <Button size="sm" variant="ghost" className="text-primary-foreground hover:bg-white/15 hover:text-primary-foreground" onClick={copy}>
                  {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy code'}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-4 text-sm opacity-90">
            {order.status === 'pending_payment'
              ? 'Approve the Mobile Money prompt on your phone to get your pickup code.'
              : order.status === 'refunded'
                ? 'This bag sold out while your payment was processing. Your money was refunded.'
                : 'This order was cancelled. You were not charged.'}
          </p>
        )}
      </div>

      <div className="grid gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-primary">
            <Clock className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">
              {formatDay(bag.pickup_start_time)}, {formatWindow(bag.pickup_start_time, bag.pickup_end_time)}
            </p>
            <p
              className={cn(
                'text-xs',
                pickup.phase === 'open' ? 'font-semibold text-primary' : pickup.phase === 'closed' ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {order.status === 'collected' ? 'Enjoy your food!' : pickup.label}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-primary">
            <MapPin className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{merchant.name}</p>
            <p className="text-xs text-muted-foreground">
              {merchant.address || merchant.district}
              {distance && ` · ${distance} away`}
            </p>
          </div>
        </div>

        {!compact && (
          <div className="relative isolate h-44 overflow-hidden rounded-xl border">
            <DirectionsMap merchant={merchant} userPosition={userPosition} />
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Paid {formatUgx(order.amount_paid)}
            {order.payment_network && ` via ${order.payment_network === 'MTN' ? 'MTN MoMo' : 'Airtel Money'}`}
          </p>
          <Button asChild size="sm" variant={live ? 'default' : 'outline'}>
            <a href={directionsUrl(merchant.latitude, merchant.longitude)} target="_blank" rel="noreferrer">
              <Navigation /> Directions
            </a>
          </Button>
        </div>
      </div>
    </Card>
  );
}
