'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';
import type { User } from './types';

interface AuthState {
  user: User | null;
  /** True while the stored token is being checked on first load. */
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: { name: string; email: string; password: string; phone?: string }) => Promise<User>;
  logout: () => void;
  /** Re-reads the profile, e.g. to pick up a changed TeslaPay balance. */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((u) => !cancelled && setUser(u))
      .catch(() => setToken(null)) // expired or invalid token: fall back to the login page
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // The API client fires this when any call returns 401 with a token attached.
  useEffect(() => {
    const onUnauthorized = () => {
      setToken(null);
      setUser(null);
    };
    window.addEventListener('tesla:unauthorized', onUnauthorized);
    return () => window.removeEventListener('tesla:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(async (input: { name: string; email: string; password: string; phone?: string }) => {
    const res = await api.register(input);
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch {
      /* a 401 is handled by the unauthorized listener; other errors are retried on the next poll */
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refreshUser }),
    [user, loading, login, register, logout, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
