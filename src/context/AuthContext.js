// src/context/AuthContext.js
// CMS Security layer (session 7-bis, Sprint 7.1/7.2) — session lifecycle +
// Authenticator Assurance Level (AAL) tracking for the 2FA gate in front of
// the Admin CMS surfaces (see components/cms/).
//
// Deliberately independent of App.js's own `user` state: this operates
// directly on the shared Supabase Auth session (same client singleton —
// there is only one active session per browser tab regardless of whether
// the sign-in came from Google or a password), so it works no matter which
// path the main app used to authenticate. Stepping up to aal2 here elevates
// that one shared session app-wide — Supabase JWTs don't carry a per-route
// AAL, so there is no such thing as a "CMS-only" elevated session.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const AuthCtx = createContext(null);

// Proactively refresh this many ms before the access token expires.
const REFRESH_LEAD_MS = 5 * 60 * 1000;

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aal, setAal] = useState({ currentLevel: null, nextLevel: null });
  // True only when a silent proactive refresh has already failed — distinct
  // from "no session" so CMSPrivateRoute can show the extend-or-reauth modal
  // instead of bouncing straight to the login form mid-task.
  const [sessionWarning, setSessionWarning] = useState(false);
  const refreshTimer = useRef(null);

  const refreshAal = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!error && data) setAal({ currentLevel: data.currentLevel, nextLevel: data.nextLevel });
  }, []);

  const scheduleRefresh = useCallback((sess) => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    if (!sess?.expires_at) return;
    const dueInMs = sess.expires_at * 1000 - Date.now() - REFRESH_LEAD_MS;
    refreshTimer.current = setTimeout(async () => {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data?.session) {
        setSessionWarning(true); // silent refresh failed — surface the modal
      } else {
        setSessionWarning(false);
        scheduleRefresh(data.session); // chain the next proactive refresh
      }
    }, Math.max(dueInMs, 0));
  }, []);

  // Manual extend — called by SessionExpiryModal's "הארך הפעלה" button.
  const extendSession = useCallback(async () => {
    if (!supabase) return false;
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data?.session) return false;
    setSessionWarning(false);
    setSession(data.session);
    scheduleRefresh(data.session);
    return true;
  }, [scheduleRefresh]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s) {
        scheduleRefresh(s);
        setTimeout(() => { refreshAal(); }, 0);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s) {
        setSessionWarning(false);
        scheduleRefresh(s);
        setTimeout(() => { refreshAal(); }, 0);
      } else {
        setAal({ currentLevel: null, nextLevel: null });
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
      }
    });

    return () => {
      subscription.unsubscribe();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signInWithPassword = useCallback(async (email, password) => {
    if (!supabase) return { error: { message: "Supabase not configured" } };
    return supabase.auth.signInWithPassword({ email, password });
  }, []);

  // Full sign-out — there is only one shared session for the whole app (see
  // file header), so this signs the user out of the main app too, not just
  // the CMS. Used by SessionExpiryModal when extend fails.
  const signOutCms = useCallback(async () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    if (supabase) { try { await supabase.auth.signOut(); } catch {} }
    setSession(null);
    setAal({ currentLevel: null, nextLevel: null });
    setSessionWarning(false);
  }, []);

  const value = {
    session,
    loading,
    aal,
    sessionWarning,
    isAal2: aal.currentLevel === "aal2",
    mfaRequired: aal.nextLevel === "aal2" && aal.currentLevel !== "aal2",
    signInWithPassword,
    extendSession,
    signOutCms,
    refreshAal,
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
