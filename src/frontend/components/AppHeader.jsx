import { Link, NavLink } from 'react-router-dom';
import { LogIn, LogOut, MessageCircle, Receipt, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2" aria-label="Chula home">
      <img src="/favicon.svg" alt="" className="size-8" />
      <span className="text-xl font-extrabold tracking-tight text-primary">chula</span>
    </Link>
  );
}

const navClass = ({ isActive }) =>
  cn(
    'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors',
    isActive ? 'bg-secondary text-primary' : 'text-muted-foreground hover:text-foreground',
  );

export default function AppHeader({ health }) {
  const { user, supabaseEnabled, signOut } = useAuth();
  const demo = health?.modes && (health.modes.payments === 'simulated' || health.modes.data === 'memory');

  return (
    <header className="sticky top-0 z-[1000] border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4">
        <Logo />
        {demo && (
          <span
            className="hidden rounded-full bg-accent/30 px-2.5 py-1 text-[11px] font-bold text-accent-foreground sm:inline"
            title="No Flutterwave/Supabase keys configured: payments are simulated and data is in memory"
          >
            Demo mode
          </span>
        )}
        <nav className="ml-auto flex items-center gap-1">
          <NavLink to="/" end className={navClass}>
            <Store className="size-4" /> <span className="hidden sm:inline">Explore</span>
          </NavLink>
          <NavLink to="/orders" className={navClass}>
            <Receipt className="size-4" /> <span className="hidden sm:inline">My orders</span>
          </NavLink>
          {health?.whatsappSimulator && (
            <NavLink to="/merchant" className={navClass}>
              <MessageCircle className="size-4" /> <span className="hidden sm:inline">Merchant WhatsApp</span>
            </NavLink>
          )}
          {supabaseEnabled &&
            (user ? (
              <Button variant="ghost" size="sm" onClick={signOut} title={user.email}>
                <LogOut /> <span className="hidden md:inline">Sign out</span>
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link to="/signin">
                  <LogIn /> Sign in
                </Link>
              </Button>
            ))}
        </nav>
      </div>
    </header>
  );
}
