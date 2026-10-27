import { Clock, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isAvailable } from '@/components/MapView';
import { discountPercent, formatDistance, formatUgx, formatWindow } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function BagCard({ bag, selected, distanceKm, onSelect, onReserve }) {
  const available = isAvailable(bag);
  const off = discountPercent(bag.original_price, bag.discount_price);
  const distance = formatDistance(distanceKm);

  return (
    <article
      onClick={() => onSelect(bag.id)}
      className={cn(
        'group relative cursor-pointer rounded-xl border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-md',
        selected && 'border-primary ring-2 ring-primary/20',
        !available && 'opacity-75',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'grid size-12 shrink-0 place-items-center rounded-lg text-xs font-extrabold',
            available ? 'bg-secondary text-primary' : 'bg-destructive/10 text-destructive',
          )}
          aria-hidden
        >
          {available ? `-${off}%` : 'Sold'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-muted-foreground">
            {bag.merchant.name} · {bag.merchant.district}
          </p>
          <h3 className="truncate leading-snug font-bold">{bag.title}</h3>
          {bag.description && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{bag.description}</p>}
        </div>
        <div className="text-right">
          <p className="font-extrabold text-primary tabular-nums">{formatUgx(bag.discount_price)}</p>
          <p className="text-xs text-muted-foreground line-through tabular-nums">{formatUgx(bag.original_price)}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="size-3.5" /> {formatWindow(bag.pickup_start_time, bag.pickup_end_time)}
        </span>
        {distance && (
          <span className="flex items-center gap-1">
            <MapPin className="size-3.5" /> {distance}
          </span>
        )}
        <span className="ml-auto">
          {available ? (
            <Button
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                onReserve(bag);
              }}
            >
              Reserve · {bag.quantity_available} left
            </Button>
          ) : (
            <span className="rounded-full bg-destructive/10 px-2.5 py-1 font-semibold text-destructive">Sold out</span>
          )}
        </span>
      </div>
    </article>
  );
}
