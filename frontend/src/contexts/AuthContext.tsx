import React, { createContext, useContext, useEffect, useState } from 'react';
import client from '../api/client';
import { User } from '../types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('procuraflow_user');
    if (!stored) { setLoading(false); return; }
    setUser(JSON.parse(stored));
    client.get('/auth/me').then(({ data }) => { localStorage.setItem('procuraflow_user', JSON.stringify(data)); setUser(data); }).finally(() => setLoading(false));
  }, []);

  async function login(username: string, password: string) {
    const { data } = await client.post('/auth/login', { username, password });
    localStorage.setItem('procuraflow_token', data.token);
    localStorage.setItem('procuraflow_user', JSON.stringify(data.user));
    setUser(data.user);
  }

  function logout() {
    client.post('/dashboard/activity/logout').catch(() => undefined).finally(() => {
      localStorage.removeItem('procuraflow_token');
      localStorage.removeItem('procuraflow_user');
      setUser(null);
    });
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
