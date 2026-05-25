'use client';

import { useState, type FormEvent } from 'react';
import {
  User,
  Users,
  Key,
  Shield,
  Bell,
  Palette,
  Globe,
  Save,
  Plus,
  Trash2,
  Edit3,
  X,
  Check,
  Eye,
  EyeOff,
  AlertTriangle,
  Lock,
} from 'lucide-react';
import { useAuth, type Account, ALL_TAB_ROUTES, type TabRoute } from '@/lib/auth';

/* ─── Tabs ─────────────────────────────────────────── */
type Tab = 'account' | 'users' | 'security' | 'notifications' | 'appearance' | 'system';

const TABS: { id: Tab; label: string; icon: typeof User }[] = [
  { id: 'account',       label: 'My Account',      icon: User },
  { id: 'users',         label: 'User Management', icon: Users },
  { id: 'security',      label: 'Security',        icon: Shield },
  { id: 'notifications', label: 'Notifications',   icon: Bell },
  { id: 'appearance',    label: 'Appearance',      icon: Palette },
  { id: 'system',        label: 'System',          icon: Globe },
];

/* ─── Helpers ───────────────────────────────────────── */
function SectionCard({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-800">{title}</h3>
        {desc && <p className="mt-0.5 text-sm text-gray-500">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

function InputField({ label, id, type, value, onChange, placeholder, error }: {
  label: string; id: string; type?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; error?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      <input
        id={id} type={type ?? 'text'} value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`block w-full rounded-lg border px-3 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20 ${
          error ? 'border-red-300' : 'border-gray-300'
        }`}
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

/* ─── Role Badge ────────────────────────────────────── */
function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    admin: 'bg-purple-100 text-purple-700',
    editor: 'bg-blue-100 text-blue-700',
    viewer: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[role] ?? 'bg-gray-100 text-gray-600'}`}>
      {role}
    </span>
  );
}

/* ─── Main Page ─────────────────────────────────────── */
export default function SettingsPage() {
  const { user, accounts, createAccount, updateAccount, deleteAccount, updatePassword, setAccountPassword } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('account');

  /* ── My Account ── */
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setProfileMsg('');
    setProfileSaving(true);
    const res = await updateAccount(user!.email, { name, email });
    setProfileSaving(false);
    setProfileMsg(res.success ? 'Profile updated successfully' : res.error ?? 'Failed');
  }

  /* ── Password ── */
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState('');

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPwMsg('');
    if (newPw !== confirmPw) { setPwMsg('Passwords do not match'); return; }
    if (newPw.length < 6) { setPwMsg('Password must be at least 6 characters'); return; }
    setPwSaving(true);
    const res = await updatePassword(currentPw, newPw);
    setPwSaving(false);
    setPwMsg(res.success ? 'Password changed successfully' : res.error ?? 'Failed');
    if (res.success) { setCurrentPw(''); setNewPw(''); setConfirmPw(''); }
  }

  /* ── Create Account ── */
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'editor' | 'viewer'>('editor');
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState('');

  async function handleCreateAccount(e: FormEvent) {
    e.preventDefault();
    setCreateMsg('');
    if (!newEmail || !newName || !newPassword) { setCreateMsg('All fields are required'); return; }
    setCreating(true);
    const res = await createAccount({ email: newEmail, password: newPassword, name: newName, role: newRole });
    setCreating(false);
    if (res.success) {
      setCreateMsg('Account created successfully');
      setNewEmail(''); setNewName(''); setNewPassword(''); setNewRole('editor');
    } else {
      setCreateMsg(res.error ?? 'Failed');
    }
  }

  /* ── Delete Account ── */
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(email: string) {
    setDeleting(true);
    await deleteAccount(email);
    setDeleting(false);
    setDeleteTarget(null);
  }

  /* ── Set Password (admin) ── */
  const [pwTarget, setPwTarget] = useState<string | null>(null);
  const [newAcctPw, setNewAcctPw] = useState('');
  const [settingAcctPw, setSettingAcctPw] = useState(false);
  const [acctPwMsg, setAcctPwMsg] = useState('');

  async function handleSetPassword(email: string) {
    if (!newAcctPw) return;
    setSettingAcctPw(true);
    setAcctPwMsg('');
    const res = await setAccountPassword(email, newAcctPw);
    setSettingAcctPw(false);
    if (res.success) {
      setAcctPwMsg('Password updated');
      setTimeout(() => { setPwTarget(null); setNewAcctPw(''); setAcctPwMsg(''); }, 1200);
    } else {
      setAcctPwMsg(res.error ?? 'Failed');
    }
  }

  /* ── Edit Account (inline) ── */
  const [editingAccount, setEditingAccount] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<Account['role']>('viewer');

  function startEdit(acct: Account) {
    setEditingAccount(acct.email);
    setEditName(acct.name);
    setEditRole(acct.role);
  }

  async function saveEdit(email: string) {
    await updateAccount(email, { name: editName, role: editRole });
    setEditingAccount(null);
  }

  /* ── Tab Access Control ── */
  const [tabAccessAccount, setTabAccessAccount] = useState<string | null>(null);
  const [tabAccessTabs, setTabAccessTabs] = useState<TabRoute[]>([]);
  const [tabAccessSaving, setTabAccessSaving] = useState(false);
  const [tabAccessMsg, setTabAccessMsg] = useState('');
  const [tabAccessNotice, setTabAccessNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  function openTabAccess(acct: Account) {
    setTabAccessAccount(acct.email);
    setTabAccessTabs(acct.allowedTabs ?? [...ALL_TAB_ROUTES]);
    setTabAccessMsg('');
    setTabAccessNotice(null);
  }

  function toggleTabAccessTab(tab: TabRoute) {
    setTabAccessTabs((prev) =>
      prev.includes(tab) ? prev.filter((t) => t !== tab) : [...prev, tab]
    );
  }

  async function saveTabAccess() {
    if (!tabAccessAccount) return;
    setTabAccessSaving(true);
    setTabAccessMsg('');
    const res = await updateAccount(tabAccessAccount, { allowedTabs: tabAccessTabs });
    setTabAccessSaving(false);
    if (res.success) {
      setTabAccessNotice({ type: 'success', message: `Tab access saved for ${accounts.find((a) => a.email === tabAccessAccount)?.name ?? tabAccessAccount}.` });
      setTabAccessAccount(null);
    } else {
      const message = res.error ?? 'Failed to save tab access';
      setTabAccessMsg(message);
      setTabAccessNotice({ type: 'error', message });
    }
  }

  /* ── Sub-User Management ── */
  const [subUserAccount, setSubUserAccount] = useState<string | null>(null);
  const [subUsers, setSubUsers] = useState<{ code: string; name: string }[]>([]);
  const [newSubUserCode, setNewSubUserCode] = useState('');
  const [newSubUserName, setNewSubUserName] = useState('');
  const [editingSubUserIndex, setEditingSubUserIndex] = useState<number | null>(null);
  const [editSubUserCode, setEditSubUserCode] = useState('');
  const [editSubUserName, setEditSubUserName] = useState('');
  const [subUserMsg, setSubUserMsg] = useState('');

  function openSubUsers(acct: Account) {
    setSubUserAccount(acct.email);
    setSubUsers(acct.subUsers ? [...acct.subUsers] : []);
    setNewSubUserCode('');
    setNewSubUserName('');
    setEditingSubUserIndex(null);
    setSubUserMsg('');
  }

  function addSubUser() {
    if (!newSubUserCode.trim() || !newSubUserName.trim()) {
      setSubUserMsg('Both code and name are required');
      return;
    }
    if (subUsers.some((u) => u.code === newSubUserCode.trim())) {
      setSubUserMsg('A user with this code already exists');
      return;
    }
    setSubUsers((prev) => [...prev, { code: newSubUserCode.trim(), name: newSubUserName.trim() }]);
    setNewSubUserCode('');
    setNewSubUserName('');
    setSubUserMsg('');
  }

  function startEditSubUser(index: number) {
    setEditingSubUserIndex(index);
    setEditSubUserCode(subUsers[index].code);
    setEditSubUserName(subUsers[index].name);
  }

  function saveEditSubUser(index: number) {
    if (!editSubUserCode.trim() || !editSubUserName.trim()) {
      setSubUserMsg('Both code and name are required');
      return;
    }
    if (subUsers.some((u, i) => i !== index && u.code === editSubUserCode.trim())) {
      setSubUserMsg('A user with this code already exists');
      return;
    }
    setSubUsers((prev) => {
      const updated = [...prev];
      updated[index] = { code: editSubUserCode.trim(), name: editSubUserName.trim() };
      return updated;
    });
    setEditingSubUserIndex(null);
    setSubUserMsg('');
  }

  function removeSubUser(index: number) {
    setSubUsers((prev) => prev.filter((_, i) => i !== index));
    if (editingSubUserIndex === index) setEditingSubUserIndex(null);
  }

  async function saveSubUsers() {
    if (!subUserAccount) return;
    await updateAccount(subUserAccount, { subUsers });
    setSubUserAccount(null);
  }

  const TAB_LABELS: Record<string, string> = {
    '/': 'Dashboard',
    '/orders': 'All Orders',
    '/actions': 'Quick Actions',
    '/clients': 'Clients',
    '/purchasing': 'Purchasing',
    '/production': 'Production',
    '/inventory': 'Inventory',
    '/delivery': 'Delivery',
    '/sales': 'Sales',
    '/collection': 'Collection',
    '/stages': 'Stage Pipeline',
    '/workflow': 'Workflow',
    '/calendar': 'Calendar',
    '/agents': 'Agents',
    '/logs': 'Agent Logs',
    '/bot-logs': 'Bot Logs',
    '/bugs': 'Bug Report',
    '/telegram': 'Telegram',
    '/backup': 'Backups',
    '/vision': 'Vision Upload',
    '/settings': 'Settings',
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your account, users, and system preferences</p>
      </div>

      {/* Tab Bar */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-white p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-[#2490ef] text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Tab: My Account ── */}
      {activeTab === 'account' && (
        <div className="space-y-6">
          <SectionCard title="Profile Information" desc="Update your display name and email address">
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <InputField label="Full Name" id="name" value={name} onChange={setName} />
                <InputField label="Email Address" id="email" type="email" value={email} onChange={setEmail} />
              </div>
              {profileMsg && (
                <p className={`text-sm ${profileMsg.includes('successfully') ? 'text-green-600' : 'text-red-600'}`}>
                  {profileMsg}
                </p>
              )}
              <button
                type="submit" disabled={profileSaving}
                className="flex items-center gap-2 rounded-lg bg-[#2490ef] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1a7ad9] disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {profileSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </form>
          </SectionCard>

          <SectionCard title="Change Password" desc="Update your login password">
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="relative">
                <InputField label="Current Password" id="currentPw" type={showPw ? 'text' : 'password'} value={currentPw} onChange={setCurrentPw} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="relative">
                  <InputField label="New Password" id="newPw" type={showPw ? 'text' : 'password'} value={newPw} onChange={setNewPw} />
                </div>
                <div className="relative">
                  <InputField label="Confirm New Password" id="confirmPw" type={showPw ? 'text' : 'password'} value={confirmPw} onChange={setConfirmPw} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={showPw} onChange={() => setShowPw(!showPw)} className="rounded border-gray-300" />
                Show passwords
              </label>
              {pwMsg && (
                <p className={`text-sm ${pwMsg.includes('successfully') ? 'text-green-600' : 'text-red-600'}`}>
                  {pwMsg}
                </p>
              )}
              <button
                type="submit" disabled={pwSaving}
                className="flex items-center gap-2 rounded-lg bg-[#2490ef] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1a7ad9] disabled:opacity-60"
              >
                <Key className="h-4 w-4" />
                {pwSaving ? 'Updating…' : 'Update Password'}
              </button>
            </form>
          </SectionCard>
        </div>
      )}

      {/* ── Tab: User Management ── */}
      {activeTab === 'users' && (
        <div className="space-y-6">
          {/* Create Account */}
          <SectionCard title="Create New Account" desc="Add a new user who can access the dashboard">
            <form onSubmit={handleCreateAccount} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <InputField label="Full Name" id="newName" value={newName} onChange={setNewName} placeholder="e.g. John Tan" />
                <InputField label="Email Address" id="newEmail" type="email" value={newEmail} onChange={setNewEmail} placeholder="e.g. john@example.com" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <InputField label="Password" id="newPassword" type="text" value={newPassword} onChange={setNewPassword} placeholder="Minimum 6 characters" />
                <div>
                  <label htmlFor="newRole" className="mb-1 block text-sm font-medium text-gray-700">Role</label>
                  <select
                    id="newRole"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as 'editor' | 'viewer')}
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
                  >
                    <option value="editor">Editor — can modify orders and data</option>
                    <option value="viewer">Viewer — read-only access</option>
                  </select>
                </div>
              </div>
              {createMsg && (
                <p className={`text-sm ${createMsg.includes('successfully') ? 'text-green-600' : 'text-red-600'}`}>
                  {createMsg}
                </p>
              )}
              <button
                type="submit" disabled={creating}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                {creating ? 'Creating…' : 'Create Account'}
              </button>
            </form>
          </SectionCard>

          {/* Account List */}
          <SectionCard title={`All Accounts (${accounts.length})`} desc="Manage existing user accounts">
            {tabAccessNotice && (
              <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
                tabAccessNotice.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}>
                {tabAccessNotice.message}
              </div>
            )}
            <div className="space-y-3">
              {accounts.map((acct) => (
                <div
                  key={acct.email}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3"
                >
                  {editingAccount === acct.email ? (
                    /* Inline edit mode */
                    <div className="flex flex-1 flex-wrap items-center gap-3">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:border-[#2490ef]"
                        placeholder="Name"
                      />
                      <select
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value as Account['role'])}
                        className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:border-[#2490ef]"
                      >
                        <option value="admin">Admin</option>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <button onClick={() => saveEdit(acct.email)} className="rounded-lg p-1.5 text-green-600 hover:bg-green-50">
                        <Check className="h-4 w-4" />
                      </button>
                      <button onClick={() => setEditingAccount(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    /* Display mode */
                    <div className="flex flex-1 items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e8f4fd] text-sm font-medium text-[#2490ef]">
                        {acct.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-800">{acct.name}</p>
                        <p className="text-xs text-gray-500">{acct.email}</p>
                      </div>
                      <RoleBadge role={acct.role} />
                    </div>
                  )}

                  {/* Actions (only show when not editing) */}
                  {editingAccount !== acct.email && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => startEdit(acct)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        title="Edit account"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      {acct.role !== 'admin' && (
                        <button
                          onClick={() => openTabAccess(acct)}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#2490ef]"
                          title="Configure tab access"
                        >
                          <Lock className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => openSubUsers(acct)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#2490ef]"
                        title="Manage sub-users (entry codes)"
                      >
                        <Users className="h-4 w-4" />
                      </button>
                      {/* Set Password */}
                      {pwTarget === acct.email ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="password"
                            value={newAcctPw}
                            onChange={(e) => setNewAcctPw(e.target.value)}
                            placeholder="New password"
                            className="w-32 rounded-lg border border-gray-300 px-2 py-1 text-xs outline-none focus:border-[#2490ef]"
                            onKeyDown={(e) => e.key === 'Enter' && handleSetPassword(acct.email)}
                            autoFocus
                          />
                          <button
                            onClick={() => handleSetPassword(acct.email)}
                            disabled={settingAcctPw || !newAcctPw}
                            className="rounded-lg bg-[#2490ef] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#1a7ad9] disabled:opacity-50"
                          >
                            {settingAcctPw ? '…' : acctPwMsg === 'Password updated' ? '✓' : 'Save'}
                          </button>
                          {acctPwMsg && (
                            <span className={`text-xs ${acctPwMsg === 'Password updated' ? 'text-green-600' : 'text-red-500'}`}>
                              {acctPwMsg}
                            </span>
                          )}
                          <button
                            onClick={() => { setPwTarget(null); setNewAcctPw(''); setAcctPwMsg(''); }}
                            className="rounded-lg px-2 py-1 text-xs text-gray-400 hover:bg-gray-100"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setPwTarget(acct.email); setDeleteTarget(null); setNewAcctPw(''); setAcctPwMsg(''); }}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-[#2490ef]"
                          title="Change password"
                        >
                          <Key className="h-4 w-4" />
                        </button>
                      )}
                      {deleteTarget === acct.email ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(acct.email)}
                            disabled={deleting}
                            className="rounded-lg bg-red-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-600"
                          >
                            {deleting ? '…' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setDeleteTarget(null)}
                            className="rounded-lg px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-100"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setDeleteTarget(acct.email); setPwTarget(null); }}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                          title="Delete account"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>

          {/* Tab Access Modal */}
          {tabAccessAccount && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                  <h3 className="text-sm font-semibold text-gray-800">
                    Tab Access — {accounts.find((a) => a.email === tabAccessAccount)?.name ?? tabAccessAccount}
                  </h3>
                  <button
                    onClick={() => setTabAccessAccount(null)}
                    className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="max-h-80 overflow-y-auto p-5">
                  <p className="mb-3 text-xs text-gray-500">
                    Select which tabs this user can access. Unchecked tabs will be hidden from their sidebar.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {ALL_TAB_ROUTES.map((route) => (
                      <label
                        key={route}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                          tabAccessTabs.includes(route)
                            ? 'border-[#2490ef] bg-[#e8f4fd] text-gray-800'
                            : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={tabAccessTabs.includes(route)}
                          onChange={() => toggleTabAccessTab(route)}
                          className="rounded border-gray-300 text-[#2490ef] focus:ring-[#2490ef]"
                        />
                        {TAB_LABELS[route] ?? route}
                      </label>
                    ))}
                  </div>
                  {tabAccessMsg && (
                    <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      {tabAccessMsg}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
                  <button
                    onClick={() => setTabAccessAccount(null)}
                    disabled={tabAccessSaving}
                    className="rounded-lg border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveTabAccess}
                    disabled={tabAccessSaving}
                    className="flex items-center gap-1.5 rounded-lg bg-[#2490ef] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#1c7ad4] disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {tabAccessSaving ? 'Saving...' : 'Save Access'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Sub-User Management Modal */}
          {subUserAccount && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                  <h3 className="text-sm font-semibold text-gray-800">
                    Entry Codes — {accounts.find((a) => a.email === subUserAccount)?.name ?? subUserAccount}
                  </h3>
                  <button
                    onClick={() => setSubUserAccount(null)}
                    className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="max-h-80 overflow-y-auto p-5">
                  <p className="mb-3 text-xs text-gray-500">
                    Manage personal entry codes for this account. Each sub-user can log in using their unique code.
                  </p>

                  {/* Add new sub-user */}
                  <div className="mb-4 flex items-center gap-2">
                    <input
                      value={newSubUserCode}
                      onChange={(e) => setNewSubUserCode(e.target.value)}
                      placeholder="Code (e.g. 777)"
                      className="w-24 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:border-[#2490ef]"
                      onKeyDown={(e) => e.key === 'Enter' && addSubUser()}
                    />
                    <input
                      value={newSubUserName}
                      onChange={(e) => setNewSubUserName(e.target.value)}
                      placeholder="Name (e.g. Mariella)"
                      className="flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:border-[#2490ef]"
                      onKeyDown={(e) => e.key === 'Enter' && addSubUser()}
                    />
                    <button
                      onClick={addSubUser}
                      className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add
                    </button>
                  </div>

                  {subUserMsg && (
                    <p className="mb-3 text-xs text-red-500">{subUserMsg}</p>
                  )}

                  {/* Sub-user list */}
                  {subUsers.length === 0 ? (
                    <div className="flex items-center justify-center py-6 text-sm text-gray-400">
                      No entry codes configured yet.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {subUsers.map((su, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2"
                        >
                          {editingSubUserIndex === idx ? (
                            <div className="flex flex-1 items-center gap-2">
                              <input
                                value={editSubUserCode}
                                onChange={(e) => setEditSubUserCode(e.target.value)}
                                className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm outline-none focus:border-[#2490ef]"
                                placeholder="Code"
                                autoFocus
                              />
                              <input
                                value={editSubUserName}
                                onChange={(e) => setEditSubUserName(e.target.value)}
                                className="flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm outline-none focus:border-[#2490ef]"
                                placeholder="Name"
                              />
                              <button
                                onClick={() => saveEditSubUser(idx)}
                                className="rounded-lg p-1 text-green-600 hover:bg-green-50"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => setEditingSubUserIndex(null)}
                                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-3">
                                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#e8f4fd] text-xs font-bold text-[#2490ef]">
                                  {su.code}
                                </span>
                                <span className="text-sm font-medium text-gray-800">{su.name}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => startEditSubUser(idx)}
                                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                                  title="Edit"
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => removeSubUser(idx)}
                                  className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                                  title="Remove"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
                  <button
                    onClick={() => setSubUserAccount(null)}
                    className="rounded-lg border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveSubUsers}
                    className="flex items-center gap-1.5 rounded-lg bg-[#2490ef] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#1c7ad4]"
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Security ── */}
      {activeTab === 'security' && (
        <div className="space-y-6">
          <SectionCard title="Session" desc="Manage your current login session">
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-green-500" />
                  <div>
                    <p className="text-sm font-medium text-gray-800">Current Session</p>
                    <p className="text-xs text-gray-500">Signed in as {user?.email}</p>
                  </div>
                </div>
                <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">Active</span>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Login History" desc="Recent sign-in activity (coming soon)">
            <div className="flex items-center justify-center py-8 text-sm text-gray-400">
              <AlertTriangle className="mr-2 h-4 w-4" />
              Login history tracking will be available in a future update.
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── Tab: Notifications ── */}
      {activeTab === 'notifications' && (
        <SectionCard title="Notification Preferences" desc="Choose which notifications you receive">
          <div className="space-y-4">
            {[
              { id: 'order_updates', label: 'Order Updates', desc: 'When an order changes stage' },
              { id: 'payment_alerts', label: 'Payment Alerts', desc: 'When a payment is received or confirmed' },
              { id: 'delivery_reminders', label: 'Delivery Reminders', desc: 'Upcoming delivery notifications' },
              { id: 'system_alerts', label: 'System Alerts', desc: 'Agent errors or system warnings' },
            ].map((item) => (
              <label key={item.id} className="flex items-start gap-3 rounded-lg border border-gray-200 px-4 py-3">
                <input type="checkbox" defaultChecked className="mt-0.5 rounded border-gray-300 text-[#2490ef] focus:ring-[#2490ef]" />
                <div>
                  <p className="text-sm font-medium text-gray-800">{item.label}</p>
                  <p className="text-xs text-gray-500">{item.desc}</p>
                </div>
              </label>
            ))}
            <p className="text-xs text-gray-400">Notification settings are currently local preferences. Server-side notifications coming soon.</p>
          </div>
        </SectionCard>
      )}

      {/* ── Tab: Appearance ── */}
      {activeTab === 'appearance' && (
        <div className="space-y-6">
          <SectionCard title="Theme" desc="Customize the dashboard appearance">
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Color Scheme</label>
                <div className="flex gap-3">
                  {['Light', 'Dark', 'System'].map((theme) => (
                    <label key={theme} className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 has-checked:border-[#2490ef] has-checked:bg-[#e8f4fd]">
                      <input type="radio" name="theme" defaultChecked={theme === 'Light'} className="text-[#2490ef] focus:ring-[#2490ef]" />
                      {theme}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Sidebar Collapsed by Default</label>
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input type="checkbox" className="rounded border-gray-300 text-[#2490ef] focus:ring-[#2490ef]" />
                  Start with sidebar collapsed
                </label>
              </div>
              <p className="text-xs text-gray-400">Appearance settings are stored locally in your browser.</p>
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── Tab: System ── */}
      {activeTab === 'system' && (
        <div className="space-y-6">
          <SectionCard title="System Information" desc="About this Quotation Automation System">
            <div className="space-y-3">
              <div className="flex justify-between border-b border-gray-100 pb-2 text-sm">
                <span className="text-gray-500">Application</span>
                <span className="font-medium text-gray-800">Quotation Automation System</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-2 text-sm">
                <span className="text-gray-500">Version</span>
                <span className="font-medium text-gray-800">1.0.0</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-2 text-sm">
                <span className="text-gray-500">Framework</span>
                <span className="font-medium text-gray-800">Next.js 16 + Tailwind CSS 4</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-2 text-sm">
                <span className="text-gray-500">API Endpoint</span>
                <span className="font-medium text-gray-800">{process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-2 text-sm">
                <span className="text-gray-500">Accounts</span>
                <span className="font-medium text-gray-800">{accounts.length} registered</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Data Storage</span>
                <span className="font-medium text-gray-800">Browser localStorage (client-side)</span>
              </div>
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
