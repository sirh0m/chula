import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseEnabled } from './supabase';

const DEMO_ID_KEY = 'chula.demoUserId';
const DEMO_NAME_KEY = 'chula.demoUserName';

const AuthContext = createContext(null);

function getDemoId() {
  let id = localStorage.getItem(DEMO_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEMO_ID_KEY, id);
  }
  return id;
}

/**
 * Supabase auth state when VITE_SUPABASE_URL is configured; otherwise a
 * per-device guest identity so the app is fully usable against the
 * backend's in-memory demo store.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(supabaseEnabled);
  const [demoName, setDemoName] = useState(() => localStorage.getItem(DEMO_NAME_KEY) || '');

  useEffect(() => {
    if (!supabaseEnabled) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next ?? null));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const demoId = useMemo(() => (supabaseEnabled ? null : getDemoId()), []);

  const user = useMemo(() => {
    if (supabaseEnabled) {
      if (!session?.user) return null;
      const meta = session.user.user_metadata ?? {};
      return {
        id: session.user.id,
        email: session.user.email,
        name: meta.full_name || session.user.email?.split('@')[0] || 'Chula member',
      };
    }
    return { id: demoId, email: null, name: demoName || 'Guest', isGuest: true };
  }, [session, demoId, demoName]);

  const signInWithEmail = useCallback(async (email, fullName) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname,
        data: fullName ? { full_name: fullName } : undefined,
      },
    });
    if (error) throw error;
  }, []);

  const verifyEmailCode = useCallback(async (email, token) => {
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (supabaseEnabled) await supabase.auth.signOut();
  }, []);

  const updateDemoName = useCallback((name) => {
    localStorage.setItem(DEMO_NAME_KEY, name);
    setDemoName(name);
  }, []);

  const getAuthHeaders = useCallback(() => {
    const headers = {};
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    if (demoId) headers['X-Chula-Demo-User'] = demoId;
    if (user?.name) headers['X-Chula-User-Name'] = encodeURIComponent(user.name);
    return headers;
  }, [session, demoId, user]);

  const value = useMemo(
    () => ({
      user,
      loading,
      supabaseEnabled,
      signInWithEmail,
      verifyEmailCode,
      signOut,
      updateDemoName,
      getAuthHeaders,
    }),
    [user, loading, signInWithEmail, verifyEmailCode, signOut, updateDemoName, getAuthHeaders],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
