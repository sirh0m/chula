import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ExternalLink, Loader2, Minus, Plus, ShieldCheck, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { discountPercent, formatUgx, formatWindow } from '@/lib/format';
import { detectNetwork, formatLocal, localDigits, toInternational } from '@/lib/phone';
import { cn } from '@/lib/utils';

const PHONE_KEY = 'chula.lastMomoNumber';
const POLL_MS = 2000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;
const MAX_PER_ORDER = 5;

const NETWORKS = [
  { id: 'MTN', label: 'MTN MoMo', className: 'data-[active=true]:border-mtn data-[active=true]:bg-mtn/20', dot: 'bg-mtn' },
  { id: 'AIRTEL', label: 'Airtel Money', className: 'data-[active=true]:border-airtel data-[active=true]:bg-airtel/10', dot: 'bg-airtel' },
];

/**
 * 1-tap Mobile Money checkout: collects an MTN/Airtel number, triggers the
 * STK push, then waits for the customer to approve on their handset.
 */
export default function CheckoutModal({ bag, open, onOpenChange, onPaid }) {
  const { user, getAuthHeaders, supabaseEnabled } = useAuth();
  const [phone, setPhone] = useState(() => localStorage.getItem(PHONE_KEY) || '');
  const [network, setNetwork] = useState(() => detectNetwork(localStorage.getItem(PHONE_KEY) || ''));
  const [networkTouched, setNetworkTouched] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [step, setStep] = useState('form');
  const [error, setError] = useState('');
  const [order, setOrder] = useState(null);
  const [payment, setPayment] = useState(null);
  const pollRef = useRef(null);

  const stopPolling = () => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
  };

  useEffect(() => {
    if (open) {
      setQuantity(1);
      setStep('form');
      setError('');
      setOrder(null);
      setPayment(null);
    } else {
      stopPolling();
    }
    return stopPolling;
  }, [open, bag?.id]);

  if (!bag) return null;

  const maxQty = Math.min(MAX_PER_ORDER, bag.quantity_available);
  const total = bag.discount_price * quantity;
  const saved = (bag.original_price - bag.discount_price) * quantity;
  const digits = localDigits(phone);
  const phoneValid = digits.length === 9;
  const detected = detectNetwork(phone);

  const handlePhoneChange = (event) => {
    const next = event.target.value;
    setPhone(formatLocal(next));
    const guess = detectNetwork(next);
    if (guess && !networkTouched) setNetwork(guess);
  };

  const pollOrder = (orderId, startedAt) => {
    pollRef.current = setTimeout(async () => {
      try {
        const { order: latest } = await api.getOrder(orderId, getAuthHeaders());
        setOrder(latest);
        if (latest.status === 'paid' || latest.status === 'collected') {
          setStep('success');
          onPaid?.(latest);
          return;
        }
        if (['cancelled', 'refunded'].includes(latest.status)) {
          setStep('failed');
          setError(
            latest.status === 'refunded'
              ? 'The last bag sold out while your payment was processing. Your money has been refunded.'
              : 'The payment was declined or cancelled on your phone. You have not been charged.',
          );
          return;
        }
      } catch {
        // Network hiccup: keep polling until the timeout below.
      }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setStep('failed');
        setError("We didn't receive approval in time. If you were charged, your pickup code will appear in My orders.");
        return;
      }
      pollOrder(orderId, startedAt);
    }, POLL_MS);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!phoneValid || !network) return;
    setError('');
    setStep('sending');
    try {
      const international = toInternational(phone);
      localStorage.setItem(PHONE_KEY, international);
      const result = await api.stkPush({ bagId: bag.id, quantity, phone: international, network }, getAuthHeaders());
      setOrder(result.order);
      setPayment(result.payment);
      setStep('awaiting');
      pollOrder(result.order.id, Date.now());
    } catch (err) {
      setStep('form');
      setError(err.message);
    }
  };

  const cancelPending = async () => {
    stopPolling();
    if (order?.status === 'pending_payment') {
      await api.cancelOrder(order.id, getAuthHeaders()).catch(() => {});
    }
    onOpenChange(false);
  };

  const needsSignIn = supabaseEnabled && !user;

  return (
    <Dialog open={open} onOpenChange={(next) => (step === 'awaiting' && !next ? cancelPending() : onOpenChange(next))}>
      <DialogContent>
        {step === 'awaiting' ? (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <DialogHeader className="sr-only">
              <DialogTitle>Approve the payment on your phone</DialogTitle>
              <DialogDescription>Waiting for Mobile Money approval</DialogDescription>
            </DialogHeader>
            <div className="relative grid size-20 place-items-center">
              <span className="animate-pulse-ring absolute inset-0 rounded-full bg-primary/30" />
              <span className="relative grid size-16 place-items-center rounded-full bg-primary text-primary-foreground">
                <Smartphone className="size-7" />
              </span>
            </div>
            <div>
              <p className="text-lg font-bold">Check your phone</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter your {network === 'MTN' ? 'MTN MoMo' : 'Airtel Money'} PIN to approve{' '}
                <span className="font-semibold text-foreground">{formatUgx(order?.amount_paid ?? total)}</span> to Chula.
              </p>
              {payment?.message && <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{payment.message}</p>}
            </div>
            {payment?.redirectUrl && (
              <Button asChild variant="outline" className="w-full">
                <a href={payment.redirectUrl} target="_blank" rel="noreferrer">
                  Complete authorisation <ExternalLink />
                </a>
              </Button>
            )}
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Waiting for confirmation…
            </p>
            <Button variant="ghost" size="sm" onClick={cancelPending}>
              Cancel payment
            </Button>
          </div>
        ) : step === 'failed' ? (
          <div className="flex flex-col items-center gap-4 py-2 text-center">
            <span className="grid size-16 place-items-center rounded-full bg-destructive/10 text-destructive">
              <AlertCircle className="size-8" />
            </span>
            <DialogHeader className="items-center pr-0 text-center">
              <DialogTitle>Payment not completed</DialogTitle>
              <DialogDescription>{error}</DialogDescription>
            </DialogHeader>
            <div className="flex w-full flex-col gap-2 sm:flex-row-reverse">
              <Button
                className="sm:flex-1"
                onClick={() => {
                  setError('');
                  setStep('form');
                }}
              >
                Try again
              </Button>
              <Button variant="outline" className="sm:flex-1" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : step === 'success' ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <DialogHeader className="sr-only">
              <DialogTitle>Payment received</DialogTitle>
              <DialogDescription>Your pickup code is ready</DialogDescription>
            </DialogHeader>
            <span className="grid size-16 place-items-center rounded-full bg-success/15 text-primary">
              <ShieldCheck className="size-8" />
            </span>
            <p className="text-lg font-bold">Payment received</p>
            <p className="text-sm text-muted-foreground">Opening your pickup code…</p>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-5">
            <DialogHeader>
              <DialogTitle>Reserve {bag.title}</DialogTitle>
              <DialogDescription>
                {bag.merchant.name}, {bag.merchant.district} · Pickup {formatWindow(bag.pickup_start_time, bag.pickup_end_time)}
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center justify-between rounded-xl bg-muted/70 p-3">
              <div>
                <p className="text-sm font-semibold">Quantity</p>
                <p className="text-xs text-muted-foreground">{bag.quantity_available} left today</p>
              </div>
              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" size="icon" className="size-9 rounded-full" onClick={() => setQuantity((q) => Math.max(1, q - 1))} disabled={quantity <= 1} aria-label="Fewer bags">
                  <Minus />
                </Button>
                <span className="w-5 text-center text-lg font-bold tabular-nums">{quantity}</span>
                <Button type="button" variant="outline" size="icon" className="size-9 rounded-full" onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))} disabled={quantity >= maxQty} aria-label="More bags">
                  <Plus />
                </Button>
              </div>
            </div>

            {needsSignIn ? (
              <div className="rounded-xl border border-dashed p-4 text-center">
                <p className="text-sm font-semibold">Sign in to reserve</p>
                <p className="mt-1 text-xs text-muted-foreground">We'll keep your pickup codes safe in your account.</p>
                <Button asChild className="mt-3 w-full">
                  <Link to={`/signin?next=${encodeURIComponent(window.location.pathname)}`}>Sign in with email</Link>
                </Button>
              </div>
            ) : (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="momo-phone">Mobile Money number</Label>
                  <div className="flex">
                    <span className="inline-flex items-center rounded-l-md border border-r-0 border-input bg-muted px-3 text-sm font-semibold text-muted-foreground">
                      +256
                    </span>
                    <Input
                      id="momo-phone"
                      inputMode="tel"
                      autoComplete="tel-national"
                      placeholder="772 123 456"
                      value={formatLocal(phone)}
                      onChange={handlePhoneChange}
                      className="rounded-l-none text-base font-semibold tracking-wide"
                      aria-invalid={phone.length > 0 && !phoneValid ? true : undefined}
                      autoFocus
                    />
                  </div>
                  {phone.length > 0 && digits.length >= 2 && !detected && (
                    <p className="text-xs text-muted-foreground">We couldn't tell the network from this number. Pick one below.</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Mobile Money network">
                  {NETWORKS.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      role="radio"
                      aria-checked={network === n.id}
                      data-active={network === n.id}
                      onClick={() => {
                        setNetwork(n.id);
                        setNetworkTouched(true);
                      }}
                      className={cn(
                        'flex h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-input bg-card text-sm font-bold transition-colors hover:bg-muted',
                        n.className,
                      )}
                    >
                      <span className={cn('size-3 rounded-full', n.dot)} /> {n.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
              </p>
            )}

            <div className="flex items-end justify-between border-t pt-4">
              <div>
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-2xl font-extrabold tabular-nums">{formatUgx(total)}</p>
              </div>
              {saved > 0 && (
                <p className="text-right text-xs font-semibold text-primary">
                  You save {formatUgx(saved)}
                  <br />
                  <span className="text-muted-foreground">{discountPercent(bag.original_price, bag.discount_price)}% off retail</span>
                </p>
              )}
            </div>

            {!needsSignIn && (
              <Button type="submit" size="lg" className="w-full" disabled={!phoneValid || !network || step === 'sending' || maxQty < 1}>
                {step === 'sending' ? (
                  <>
                    <Loader2 className="animate-spin" /> Sending prompt…
                  </>
                ) : (
                  <>Pay {formatUgx(total)} with {network === 'AIRTEL' ? 'Airtel Money' : network === 'MTN' ? 'MTN MoMo' : 'Mobile Money'}</>
                )}
              </Button>
            )}
            <p className="-mt-2 text-center text-[11px] text-muted-foreground">
              You'll get a prompt on your phone. Nothing is charged until you enter your PIN.
            </p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
