'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export interface SubUser {
  code: string;
  name: string;
}

// All available dashboard tab routes
export const ALL_TAB_ROUTES = [
  '/', '/orders', '/actions', '/clients', '/purchasing', '/production',
  '/inventory', '/stock-prep', '/delivery', '/sales', '/collection', '/stages', '/workflow',
  '/calendar', '/agents', '/logs', '/bot-logs', '/bugs', '/telegram',
  '/backup', '/vision', '/settings', '/guides', '/chat', '/update-logs',
] as const;

export type TabRoute = (typeof ALL_TAB_ROUTES)[number];

export interface AuthUser {
  email: string;
  name: string;
  role: string;
}

export interface Account {
  email: string;
  password: string;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
  createdAt: string;
  subUsers?: SubUser[];
  allowedTabs?: TabRoute[];
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: AuthUser | null;
  accounts: Account[];
  sendOtp: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  verifyOtp: (email: string, otp: string) => Promise<{ success: boolean; needsUserCode?: boolean; error?: string }>;
  selectSubUser: (email: string, code: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  createAccount: (account: Omit<Account, 'createdAt'>) => Promise<{ success: boolean; error?: string }>;
  updateAccount: (email: string, updates: Partial<Account>) => Promise<{ success: boolean; error?: string }>;
  deleteAccount: (email: string) => Promise<{ success: boolean; error?: string }>;
  updatePassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  setAccountPassword: (email: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_STORAGE_KEY = 'qas_auth';
const ACCOUNTS_STORAGE_KEY = 'qas_accounts';
const DELETED_ACCOUNTS_KEY = 'qas_deleted_accounts';

function getDeletedEmails(): Set<string> {
  try {
    const stored = localStorage.getItem(DELETED_ACCOUNTS_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch { /* ignore */ }
  return new Set();
}

function addDeletedEmail(email: string) {
  const set = getDeletedEmails();
  set.add(email.toLowerCase());
  localStorage.setItem(DELETED_ACCOUNTS_KEY, JSON.stringify([...set]));
}

function removeDeletedEmail(email: string) {
  const set = getDeletedEmails();
  set.delete(email.toLowerCase());
  localStorage.setItem(DELETED_ACCOUNTS_KEY, JSON.stringify([...set]));
}

// Default tab access for non-admin roles (editor/viewer)
const DEFAULT_TAB_ACCESS: TabRoute[] = [
  '/', '/orders', '/actions', '/clients', '/purchasing', '/production',
  '/inventory', '/stock-prep', '/delivery', '/sales', '/collection', '/stages', '/workflow',
  '/calendar', '/agents', '/logs', '/bot-logs', '/bugs', '/telegram',
  '/backup', '/vision', '/settings', '/guides', '/chat',
];

const DEFAULT_ACCOUNTS: Account[] = [
  {
    email: 'jpgyap@gmail.com',
    password: 'Purchasing@888',
    name: 'Admin',
    role: 'admin',
    createdAt: new Date('2025-01-01').toISOString(),
  },
  {
    email: 'maiquocquynh2506@gmail.com',
    password: 'Purchasing@888',
    name: 'Quynh Mai',
    role: 'editor',
    createdAt: new Date('2026-05-20').toISOString(),
    allowedTabs: DEFAULT_TAB_ACCESS,
  },
  {
    email: 'sales.homeu@gmail.com',
    password: 'Homeu@888',
    name: 'Sales Team',
    role: 'editor',
    createdAt: new Date('2026-05-23').toISOString(),
    subUsers: [
      { code: '777', name: 'Mariella Ignaco' },
      { code: '888', name: 'Cathlyn Roma' },
    ],
    allowedTabs: DEFAULT_TAB_ACCESS,
  },
];

function getStoredAccounts(): Account[] {
  try {
    const stored = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const deleted = getDeletedEmails();
        // Merge defaults into stored accounts so subUsers updates from source
        // code are applied — but NEVER re-add accounts the admin explicitly deleted.
        let changed = false;
        for (const def of DEFAULT_ACCOUNTS) {
          if (deleted.has(def.email.toLowerCase())) continue; // respect admin deletion
          const idx = parsed.findIndex((a: Account) => a.email.toLowerCase() === def.email.toLowerCase());
          if (idx >= 0) {
            // Merge subUsers from defaults (subUsers are maintained in source only)
            if (def.subUsers && JSON.stringify(parsed[idx].subUsers) !== JSON.stringify(def.subUsers)) {
              parsed[idx].subUsers = def.subUsers;
              changed = true;
            }
            // Sync password from defaults (source of truth for default accounts)
            if (parsed[idx].password !== def.password) {
              parsed[idx].password = def.password;
              changed = true;
            }
          } else {
            // Add new default account that doesn't exist in storage
            parsed.push(def);
            changed = true;
          }
        }
        if (changed) {
          localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(parsed));
        }
        return parsed;
      }
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

export function normalizeTabRoutes(value: unknown): TabRoute[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    return value.filter((tab): tab is TabRoute =>
      typeof tab === 'string' && (ALL_TAB_ROUTES as readonly string[]).includes(tab),
    );
  }
  if (typeof value === 'string') {
    try {
      return normalizeTabRoutes(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function routeMatchesTab(pathname: string, tab: TabRoute): boolean {
  if (tab === '/') return pathname === '/';
  return pathname === tab || pathname.startsWith(`${tab}/`);
}

export function getAllowedTabsForUser(user: AuthUser | null, accounts: Account[]): TabRoute[] | undefined {
  if (!user) return [];
  if (user.role === 'admin') return undefined;

  const account = accounts.find((a) => a.email.toLowerCase() === user.email.toLowerCase());
  if (!account) return [];

  const normalized = normalizeTabRoutes(account.allowedTabs);
  return normalized ?? [];
}

function normalizeServerAccount(s: any): Partial<Account> {
  return {
    email: s.email,
    name: s.name,
    role: s.role,
    allowedTabs: normalizeTabRoutes(s.allowedTabs),
    subUsers: normalizeSubUsers(s.subUsers),
    createdAt: s.createdAt,
  };
}

function normalizeSubUsers(value: unknown): SubUser[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    return value.filter((user): user is SubUser =>
      Boolean(user) && typeof user.code === 'string' && typeof user.name === 'string',
    );
  }
  if (typeof value === 'string') {
    try {
      return normalizeSubUsers(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// Fetch accounts from server (source of truth for allowedTabs + subUsers)
async function fetchServerAccounts(): Promise<Partial<Account>[] | null> {
  try {
    const res = await fetch(`${API_BASE}/dashboard-accounts`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    return data.map(normalizeServerAccount);
  } catch {
    return null;
  }
}

// Merge server accounts into local accounts (server wins on allowedTabs/subUsers)
function mergeServerAccounts(local: Account[], server: Partial<Account>[]): Account[] {
  const merged = local.map((acct) => {
    const serverAcct = server.find((s) => s.email?.toLowerCase() === acct.email.toLowerCase());
    if (!serverAcct) return acct;
    return {
      ...acct,
      allowedTabs: serverAcct.allowedTabs !== undefined ? serverAcct.allowedTabs : acct.allowedTabs,
      subUsers: serverAcct.subUsers !== undefined ? serverAcct.subUsers : acct.subUsers,
      name: serverAcct.name ?? acct.name,
      role: (serverAcct.role as Account['role']) ?? acct.role,
    };
  });
  // Add any server-only accounts (they won't have passwords locally)
  for (const s of server) {
    const serverEmail = s.email;
    if (!serverEmail) continue;
    if (!merged.some((a) => a.email.toLowerCase() === serverEmail.toLowerCase())) {
      merged.push({
        email: serverEmail,
        password: '',
        name: s.name ?? serverEmail,
        role: (s.role as Account['role']) ?? 'editor',
        createdAt: s.createdAt ?? new Date().toISOString(),
        allowedTabs: s.allowedTabs,
        subUsers: s.subUsers,
      });
    }
  }
  return merged;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [, setInitialized] = useState(false);

  // Hydrate from localStorage + server on mount
  useEffect(() => {
    queueMicrotask(async () => {
      let accts = getStoredAccounts();

      // Pull server-side settings (allowedTabs, subUsers) and merge
      const serverAccts = await fetchServerAccounts();
      if (serverAccts && serverAccts.length > 0) {
        accts = mergeServerAccounts(accts, serverAccts);
        persistAccounts(accts);
      }

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

  // Sync accounts across tabs when localStorage changes
  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === ACCOUNTS_STORAGE_KEY) {
        const accts = getStoredAccounts();
        setAccounts(accts);
      }
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Step 1: validate credentials locally, then ask API to send OTP
  const sendOtp = useCallback(async (email: string, password: string) => {
    await new Promise((r) => setTimeout(r, 300));

    const accts = getStoredAccounts();
    const match = accts.find((a) => a.email.toLowerCase().trim() === email.toLowerCase().trim());
    if (!match) return { success: false, error: 'Invalid email address' };
    if (match.password !== password) return { success: false, error: 'Invalid password' };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

      let res;
      try {
        res = await fetch(`${API_BASE}/auth/send-otp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: match.email }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return { success: false, error: data.error ?? 'Failed to send OTP' };
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { success: false, error: 'Request timed out. Please try again.' };
      }
      return { success: false, error: 'Could not reach the server. Please try again.' };
    }

    return { success: true };
  }, []);

  // Step 2: verify OTP with API, then complete login
  const verifyOtp = useCallback(async (email: string, otp: string) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

      let res;
      try {
        res = await fetch(`${API_BASE}/auth/verify-otp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: email.toLowerCase().trim(), otp }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return { success: false, error: data.error ?? 'Invalid OTP' };
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { success: false, error: 'Request timed out. Please try again.' };
      }
      return { success: false, error: 'Could not reach the server. Please try again.' };
    }

    try {
      const accts = getStoredAccounts();
      const match = accts.find((a) => a.email.toLowerCase().trim() === email.toLowerCase().trim());
      if (!match) return { success: false, error: 'Account not found' };

      // If the account has sub-users, don't finalise the session yet —
      // the login page will show a user-code step first.
      if (match.subUsers && match.subUsers.length > 0) {
        return { success: true, needsUserCode: true };
      }

      const userData = { email: match.email, name: match.name, role: match.role };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(userData));
      setIsAuthenticated(true);
      setUser(userData);
      return { success: true };
    } catch {
      return { success: false, error: 'Failed to save login state. Please try again.' };
    }
  }, []);

  // Step 3 (sub-user accounts only): resolve the personal code to a real name
  const selectSubUser = useCallback(async (email: string, code: string) => {
    const accts = getStoredAccounts();
    const match = accts.find((a) => a.email.toLowerCase().trim() === email.toLowerCase().trim());
    if (!match) return { success: false, error: 'Account not found' };

    const subUser = match.subUsers?.find((s) => s.code === code);
    if (!subUser) return { success: false, error: 'Invalid code. Please try again.' };

    try {
      const userData = { email: match.email, name: subUser.name, role: match.role };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(userData));
      setIsAuthenticated(true);
      setUser(userData);
      return { success: true };
    } catch {
      return { success: false, error: 'Failed to save login state. Please try again.' };
    }
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

    // Remove from deleted set so it can be re-created cleanly
    removeDeletedEmail(account.email);

    const newAccount: Account = {
      ...account,
      allowedTabs: account.allowedTabs ?? (account.role === 'admin' ? undefined : [...DEFAULT_TAB_ACCESS]),
      createdAt: new Date().toISOString(),
    };

    const updated = [...accts, newAccount];
    persistAccounts(updated);
    setAccounts(updated);

    // Sync to server
    try {
      await fetch(`${API_BASE}/dashboard-accounts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: newAccount.email,
          name: newAccount.name,
          role: newAccount.role,
          allowedTabs: newAccount.allowedTabs,
          subUsers: newAccount.subUsers,
        }),
      });
    } catch { /* non-fatal */ }

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

    const previousAccounts = accts.map((acct) => ({ ...acct }));
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

    // Sync to server (server is source of truth for allowedTabs + subUsers)
    const serverBody: Record<string, unknown> = {};
    if (updates.allowedTabs !== undefined) serverBody.allowedTabs = updates.allowedTabs;
    if (updates.subUsers !== undefined) serverBody.subUsers = updates.subUsers;
    if (updates.name !== undefined) serverBody.name = updates.name;
    if (updates.role !== undefined) serverBody.role = updates.role;

    if (Object.keys(serverBody).length > 0) {
      try {
        const res = await fetch(`${API_BASE}/dashboard-accounts/${encodeURIComponent(email)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(serverBody),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          persistAccounts(previousAccounts);
          setAccounts(previousAccounts);
          return { success: false, error: data.error ?? 'Failed to save account settings on server' };
        }
        const data = (await res.json().catch(() => ({}))) as { account?: Partial<Account> };
        if (data.account) {
          const serverAccount = normalizeServerAccount(data.account);
          const confirmed = accts.map((acct) =>
            acct.email.toLowerCase() === email.toLowerCase()
              ? {
                  ...acct,
                  ...updates,
                  allowedTabs: serverAccount.allowedTabs !== undefined ? serverAccount.allowedTabs : acct.allowedTabs,
                  subUsers: serverAccount.subUsers !== undefined ? serverAccount.subUsers : acct.subUsers,
                  name: serverAccount.name ?? acct.name,
                  role: (serverAccount.role as Account['role']) ?? acct.role,
                }
              : acct,
          );
          persistAccounts(confirmed);
          setAccounts(confirmed);
        }
      } catch {
        persistAccounts(previousAccounts);
        setAccounts(previousAccounts);
        return { success: false, error: 'Could not reach server to save account settings' };
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

    // Mark as hard-deleted so defaults don't re-seed this email on next load
    addDeletedEmail(email);

    // If the logged-in user deleted their own account, log them out
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.email === email) {
        logout();
      }
    }

    // Sync to server
    try {
      await fetch(`${API_BASE}/dashboard-accounts/${encodeURIComponent(email)}`, {
        method: 'DELETE',
      });
    } catch { /* non-fatal */ }

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

  // Admin-only: set any account's password directly (no current-password required)
  const setAccountPassword = useCallback(async (email: string, newPassword: string) => {
    await new Promise((r) => setTimeout(r, 200));
    if (newPassword.length < 6) return { success: false, error: 'Password must be at least 6 characters' };
    const accts = getStoredAccounts();
    const idx = accts.findIndex((a) => a.email.toLowerCase() === email.toLowerCase());
    if (idx === -1) return { success: false, error: 'Account not found' };
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
        selectSubUser,
        logout,
        createAccount,
        updateAccount,
        deleteAccount,
        updatePassword,
        setAccountPassword,
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
