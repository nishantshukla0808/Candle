'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, type PublicUser } from './api';

/**
 * Auth state for the web app.
 *
 * - The access token lives in memory only (never localStorage).
 * - The refresh token lives in the API's httpOnly cookie; silent
 *   re-authentication on page load uses POST /auth/refresh.
 * - Roles gate the admin section (server still enforces RBAC).
 */

interface AuthContextValue {
  user: PublicUser | null;
  accessToken: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<string>;
  logout: () => Promise<void>;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const data = await api<{ accessToken: string }>('/auth/refresh', { method: 'POST' });
      setAccessToken(data.accessToken);
      const me = await api<PublicUser>('/users/me', { token: data.accessToken });
      setUser(me);
      return true;
    } catch {
      setAccessToken(null);
      setUser(null);
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok = await refresh();
      if (!cancelled && !ok) setLoading(false);
      if (!cancelled && ok) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const data = await api<{ user: PublicUser; accessToken: string }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setAccessToken(data.accessToken);
    setUser(data.user);
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName?: string): Promise<string> => {
      const data = await api<{ user: PublicUser; devVerificationToken?: string }>(
        '/auth/register',
        {
          method: 'POST',
          body: { email, password, displayName },
        }
      );
      // In non-production the API returns the verification token directly
      // (no mailer in Phase 1); production sends it by email.
      return data.devVerificationToken ?? '';
    },
    []
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api('/auth/logout', { method: 'POST', token: accessToken });
    } catch {
      // Logout is best-effort client-side; the cookie is cleared anyway.
    }
    setAccessToken(null);
    setUser(null);
  }, [accessToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      accessToken,
      loading,
      login,
      register,
      logout,
      isAdmin: user?.roles.includes('ADMIN') ?? false,
    }),
    [user, accessToken, loading, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
