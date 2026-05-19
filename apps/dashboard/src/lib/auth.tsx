'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export interface Account {
  email: string;
  password: string;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
  createdAt: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: { email: string; name: string; role: string } | null;
  accounts: Account[];
  sendOtp: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  verifyOtp: (email: string, otp: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  createAccount: (account: Omit<Account, 'createdAt'>) => Promise<{ success: boolean; error?: string }>;
  updateAccount: (email: string, updates: Partial<Account>) => Promise<{ success: boolean; error?: string }>;
  deleteAccount: (email: string) => Promise<{ success: boolean; error?: string }>;
  updatePassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_STORAGE_KEY = 'qas_auth';
const ACCOUNTS_STORAGE_KEY = 'qas_accounts';

const DEFAULT_ACCOUNTS: Account[] = [
  {
    email: 'jpgyap@gmail.com',
    password: 'Tracking888',
    name: 'Admin',
    role: 'admin',
    createdAt: new Date('2025-01-01').toISOString(),
  },
];

function getStoredAccounts(): Account[] {
  try {
    const stored = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore
  }
  // Seed defaults
  localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(DEFAULT_ACCOUNTS));
  return DEFAULT_ACCOUNTS;
}

function persistAccounts(accounts: Account[]) {
  localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<{ email: string; name: string; role: string } | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [, setInitialized] = useState(false);

  // Hydrate from localStorage on mount
  useEffect(() => {
    queueMicrotask(() => {
      const accts = getStoredAccounts();
      setAccounts(accts);

      try {
        const stored = localStorage.getItem(AUTH_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as { email?: string };
          if (parsed?.email) {
            const match = accts.find((a) => a.email === parsed.email);
            if (match) {
              setIsAuthenticated(true);
              setUser({ email: match.email, name: match.name, role: match.role });
            }
          }
        }
      } catch {
        // ignore corrupt storage
      }
      setInitialized(true);
    });
  }, []);

  // Step 1: validate credentials locally, then ask API to send OTP
  const sendOtp = useCallback(async (email: string, password: string) => {
    await new Promise((r) => setTimeout(r, 300));

    const accts = getStoredAccounts();
    const match = accts.find((a) => a.email.toLowerCase().trim() === email.toLowerCase().trim());
    if (!match) return { success: false, error: 'Invalid email address' };
    if (match.password !== password) return { success: false, error: 'Invalid password' };

    try {
      const res = await fetch(`${API_BASE}/auth/send-otp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: match.email }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return { success: false, error: data.error ?? 'Failed to send OTP' };
      }
    } catch {
      return { success: false, error: 'Could not reach the server. Please try again.' };
    }

    return { success: true };
  }, []);

  // Step 2: verify OTP with API, then complete login
  const verifyOtp = useCallback(async (email: string, otp: string) => {
    try {
      const res = await fetch(`${API_BASE}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase().trim(), otp }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return { success: false, error: data.error ?? 'Invalid OTP' };
      }
    } catch {
      return { success: false, error: 'Could not reach the server. Please try again.' };
    }

    const accts = getStoredAccounts();
    const match = accts.find((a) => a.email.toLowerCase().trim() === email.toLowerCase().trim());
    if (!match) return { success: false, error: 'Account not found' };

    const userData = { email: match.email, name: match.name, role: match.role };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(userData));
    setIsAuthenticated(true);
    setUser(userData);
    return { success: true };
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.controller?.postMessage({ type: 'CLEAR_STATIC_CACHE' });
    }
    setIsAuthenticated(false);
    setUser(null);
  }, []);

  const createAccount = useCallback(async (account: Omit<Account, 'createdAt'>) => {
    await new Promise((r) => setTimeout(r, 200));

    const accts = getStoredAccounts();
    if (accts.some((a) => a.email.toLowerCase() === account.email.toLowerCase())) {
      return { success: false, error: 'An account with this email already exists' };
    }

    const newAccount: Account = {
      ...account,
      createdAt: new Date().toISOString(),
    };

    const updated = [...accts, newAccount];
    persistAccounts(updated);
    setAccounts(updated);
    return { success: true };
  }, []);

  const updateAccount = useCallback(async (email: string, updates: Partial<Account>) => {
    await new Promise((r) => setTimeout(r, 200));

    const accts = getStoredAccounts();
    const idx = accts.findIndex((a) => a.email.toLowerCase() === email.toLowerCase());
    if (idx === -1) return { success: false, error: 'Account not found' };

    // If email is being changed, check for duplicates
    if (updates.email && updates.email.toLowerCase() !== email.toLowerCase()) {
      if (accts.some((a) => a.email.toLowerCase() === updates.email!.toLowerCase())) {
        return { success: false, error: 'An account with this email already exists' };
      }
    }

    accts[idx] = { ...accts[idx], ...updates };
    persistAccounts(accts);
    setAccounts([...accts]);

    // Update current session if the logged-in user was modified
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.email === email) {
        const updatedUser = { email: accts[idx].email, name: accts[idx].name, role: accts[idx].role };
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(updatedUser));
        setUser(updatedUser);
      }
    }

    return { success: true };
  }, []);

  const deleteAccount = useCallback(async (email: string) => {
    await new Promise((r) => setTimeout(r, 200));

    const accts = getStoredAccounts();
    const match = accts.find((a) => a.email.toLowerCase() === email.toLowerCase());
    if (!match) return { success: false, error: 'Account not found' };
    if (match.role === 'admin' && accts.filter((a) => a.role === 'admin').length <= 1) {
      return { success: false, error: 'Cannot delete the last admin account' };
    }

    const updated = accts.filter((a) => a.email.toLowerCase() !== email.toLowerCase());
    persistAccounts(updated);
    setAccounts(updated);

    // If the logged-in user deleted their own account, log them out
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.email === email) {
        logout();
      }
    }

    return { success: true };
  }, [logout]);

  const updatePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await new Promise((r) => setTimeout(r, 200));

    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return { success: false, error: 'Not authenticated' };

    const parsed = JSON.parse(stored);
    const accts = getStoredAccounts();
    const idx = accts.findIndex((a) => a.email === parsed.email);
    if (idx === -1) return { success: false, error: 'Account not found' };
    if (accts[idx].password !== currentPassword) {
      return { success: false, error: 'Current password is incorrect' };
    }

    accts[idx].password = newPassword;
    persistAccounts(accts);
    setAccounts([...accts]);
    return { success: true };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        user,
        accounts,
        sendOtp,
        verifyOtp,
        logout,
        createAccount,
        updateAccount,
        deleteAccount,
        updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
