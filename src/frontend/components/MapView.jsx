import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, ZoomControl, useMap } from 'react-leaflet';
import { LocateFixed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TILE_ATTRIBUTION, TILE_URL } from '@/lib/map';
import { KAMPALA_CENTER, discountPercent, formatShortUgx, formatUgx, formatWindow } from '@/lib/format';
import { cn } from '@/lib/utils';

const BAG_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>';

export const isAvailable = (bag) => bag.status === 'active' && bag.quantity_available > 0;

function bagIcon(bag, selected) {
  const available = isAvailable(bag);
  return L.divIcon({
    className: 'chula-marker',
    html: `<div class="chula-pin ${available ? 'is-available' : 'is-soldout'} ${selected ? 'is-selected' : ''}"><span class="chula-pin-dot">${BAG_SVG}</span>${available ? formatShortUgx(bag.discount_price) : 'Sold out'}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    popupAnchor: [0, -30],
  });
}

const userIcon = L.divIcon({ className: 'chula-marker', html: '<div class="chula-user-dot"></div>', iconSize: [0, 0] });

/** Spread bags from the same store so their markers don't stack exactly. */
function positionBags(bags) {
  const perMerchant = new Map();
  return bags.map((bag) => {
    const index = perMerchant.get(bag.merchant.id) ?? 0;
    perMerchant.set(bag.merchant.id, index + 1);
    const offset = index * 0.0009;
    return { bag, position: [bag.merchant.latitude + offset * 0.4, bag.merchant.longitude + offset] };
  });
}

function MapController({ placed, selectedId, userPosition }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || placed.length === 0) return;
    fitted.current = true;
    const bounds = L.latLngBounds(placed.map((p) => p.position));
    map.fitBounds(bounds.pad(0.2), { maxZoom: 14 });
  }, [map, placed]);

  useEffect(() => {
    const target = placed.find((p) => p.bag.id === selectedId);
    if (target) map.flyTo(target.position, Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [map, placed, selectedId]);

  useEffect(() => {
    if (userPosition) map.flyTo(userPosition, Math.max(map.getZoom(), 14), { duration: 0.6 });
  }, [map, userPosition]);

  return null;
}

function BagPopup({ bag, onReserve }) {
  const available = isAvailable(bag);
  const off = discountPercent(bag.original_price, bag.discount_price);
  return (
    <div className="p-4">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {bag.merchant.name} · {bag.merchant.district}
      </p>
      <p className="mt-0.5 text-[15px] leading-snug font-bold text-foreground">{bag.title}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-base font-extrabold text-primary">{formatUgx(bag.discount_price)}</span>
        <span className="text-xs text-muted-foreground line-through">{formatUgx(bag.original_price)}</span>
        {off > 0 && <span className="ml-auto rounded-full bg-accent/40 px-1.5 text-[11px] font-bold text-accent-foreground">-{off}%</span>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Pickup {formatWindow(bag.pickup_start_time, bag.pickup_end_time)}</p>
      {available ? (
        <Button size="sm" className="mt-3 w-full" onClick={() => onReserve(bag)}>
          Reserve · {bag.quantity_available} left
        </Button>
      ) : (
        <p className="mt-3 rounded-md bg-destructive/10 py-1.5 text-center text-xs font-semibold text-destructive">
          Sold out for today
        </p>
      )}
    </div>
  );
}

/**
 * Interactive Kampala map of surplus bags.
 * Green markers = available to reserve, red = sold out.
 */
export default function MapView({ bags, selectedId, onSelect, onReserve, userPosition, onLocate, locating, className }) {
  const placed = useMemo(() => positionBags(bags), [bags]);
  const markerRefs = useRef(new Map());

  useEffect(() => {
    if (selectedId) markerRefs.current.get(selectedId)?.openPopup();
  }, [selectedId]);

  const availableCount = bags.filter(isAvailable).length;

  return (
    <div className={cn('relative isolate overflow-hidden', className)}>
      <MapContainer center={KAMPALA_CENTER} zoom={13} zoomControl={false} className="h-full w-full" scrollWheelZoom>
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} maxZoom={19} />
        <ZoomControl position="bottomright" />
        <MapController placed={placed} selectedId={selectedId} userPosition={userPosition} />
        {placed.map(({ bag, position }) => (
          <Marker
            key={bag.id}
            position={position}
            icon={bagIcon(bag, bag.id === selectedId)}
            zIndexOffset={isAvailable(bag) ? 500 : 0}
            ref={(ref) => {
              if (ref) markerRefs.current.set(bag.id, ref);
              else markerRefs.current.delete(bag.id);
            }}
            eventHandlers={{ click: () => onSelect?.(bag.id) }}
          >
            <Popup closeButton>
              <BagPopup bag={bag} onReserve={onReserve} />
            </Popup>
          </Marker>
        ))}
        {userPosition && <Marker position={userPosition} icon={userIcon} interactive={false} />}
      </MapContainer>

      <div className="pointer-events-none absolute top-3 left-3 z-[500] flex flex-col gap-2">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border bg-card/95 px-3 py-1.5 text-xs font-semibold shadow-md backdrop-blur">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[#15803d]" /> Available ({availableCount})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[#dc2626]" /> Sold out ({bags.length - availableCount})
          </span>
        </div>
      </div>

      {onLocate && (
        <Button
          variant="outline"
          size="sm"
          className="absolute top-3 right-3 z-[500] rounded-full bg-card/95 shadow-md backdrop-blur"
          onClick={onLocate}
          disabled={locating}
        >
          <LocateFixed /> {locating ? 'Locating…' : 'Near me'}
        </Button>
      )}
    </div>
  );
}
