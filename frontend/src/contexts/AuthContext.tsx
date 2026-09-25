import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AuthUser, Checkpoint, UserRole } from '../types';

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  checkpoint: Checkpoint | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  applySession: (token: string, user: AuthUser) => void;
  selectCheckpoint: (cp: Checkpoint | null) => void;
  isOfficer: boolean;
  isPostIncharge: boolean;
  isAdmin: boolean;
  hasRole: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  checkpoint: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => ({ ok: false }),
  logout: () => {},
  applySession: () => {},
  selectCheckpoint: () => {},
  isOfficer: false,
  isPostIncharge: false,
  isAdmin: false,
  hasRole: () => false,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem('pehchaan_token');
    if (savedToken) {
      fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${savedToken}` },
      })
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((data) => {
          setUser(data.user);
          setToken(savedToken);
          const savedCp = localStorage.getItem('pehchaan_checkpoint');
          if (savedCp) {
            try { setCheckpoint(JSON.parse(savedCp)); } catch {}
          }
        })
        .catch(() => {
          localStorage.removeItem('pehchaan_token');
          localStorage.removeItem('pehchaan_checkpoint');
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || 'Login failed' };
      }
      setUser(data.user);
      setToken(data.token);
      localStorage.setItem('pehchaan_token', data.token);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error' };
    }
  }, []);

  const applySession = useCallback((newToken: string, newUser: AuthUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('pehchaan_token', newToken);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    setCheckpoint(null);
    localStorage.removeItem('pehchaan_token');
    localStorage.removeItem('pehchaan_checkpoint');
  }, []);

  const selectCheckpoint = useCallback((cp: Checkpoint | null) => {
    setCheckpoint(cp);
    if (cp) {
      localStorage.setItem('pehchaan_checkpoint', JSON.stringify(cp));
    } else {
      localStorage.removeItem('pehchaan_checkpoint');
    }
  }, []);

  const role = user?.role;
  const isOfficer = role === 'OFFICER';
  const isPostIncharge = role === 'POST_INCHARGE';
  const isAdmin = role === 'ADMIN';
  const hasRole = useCallback((...roles: UserRole[]) => !!role && roles.includes(role), [role]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        checkpoint,
        isAuthenticated: !!user && !!token,
        isLoading,
        login,
        logout,
        applySession,
        selectCheckpoint,
        isOfficer,
        isPostIncharge,
        isAdmin,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
