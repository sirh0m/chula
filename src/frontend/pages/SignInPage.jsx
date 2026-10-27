import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth';

export default function SignInPage() {
  const { user, supabaseEnabled, signInWithEmail, verifyEmailCode } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get('next') || '/';
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user && supabaseEnabled) navigate(next, { replace: true });
  }, [user, supabaseEnabled, next, navigate]);

  if (!supabaseEnabled) return <Navigate to={next} replace />;

  const sendLink = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signInWithEmail(email.trim(), fullName.trim());
      setStep('code');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await verifyEmailCode(email.trim(), code.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 items-center px-4 py-10">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl">{step === 'email' ? 'Sign in to Chula' : 'Check your email'}</CardTitle>
          <CardDescription>
            {step === 'email'
              ? 'We will email you a sign-in link and a 6-digit code. No password needed.'
              : `We sent a link and code to ${email}. Tap the link, or enter the code here.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'email' ? (
            <form onSubmit={sendLink} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Your name</Label>
                <Input id="name" autoComplete="name" placeholder="Amina Nakato" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" size="lg" disabled={busy || !email}>
                {busy && <Loader2 className="animate-spin" />} Email me a sign-in link
              </Button>
            </form>
          ) : (
            <form onSubmit={verify} className="grid gap-4">
              <div className="flex justify-center">
                <MailCheck className="size-10 text-primary" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="code">6-digit code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="text-center text-xl font-bold tracking-[0.4em]"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" size="lg" disabled={busy || code.length !== 6}>
                {busy && <Loader2 className="animate-spin" />} Verify and continue
              </Button>
              <Button type="button" variant="ghost" onClick={() => setStep('email')}>
                Use a different email
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
