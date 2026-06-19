'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { getUpdateLogs, type UpdateLogEntry } from '@/lib/api';
import {
  FileText,
  Loader2,
  ShieldAlert,
  AlertCircle,
  CheckCircle,
  Clock,
  RefreshCw,
  Search,
  Filter,
} from 'lucide-react';

// ── Status Badge ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase().trim();

  if (normalized.includes('done') || normalized.includes('✅')) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-[11px] font-medium text-green-700">
        <CheckCircle className="h-3 w-3" />
        Done
      </span>
    );
  }

  if (normalized.includes('active') || normalized.includes('🔴') || normalized.includes('in progress') || normalized.includes('🔄')) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">
        <Clock className="h-3 w-3" />
        Active
      </span>
    );
  }

  if (normalized.includes('blocked') || normalized.includes('⏸️')) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-medium text-red-700">
        <AlertCircle className="h-3 w-3" />
        Blocked
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2.5 py-0.5 text-[11px] font-medium text-gray-600">
      {status}
    </span>
  );
}

// ── Extension Badge ────────────────────────────────────────────────────

const EXTENSION_COLORS: Record<string, string> = {
  'Roo': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Roo (Code)': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Claude': 'bg-purple-50 text-purple-700 border-purple-200',
  'Claude Sonnet 4.6': 'bg-purple-50 text-purple-700 border-purple-200',
  'Codex': 'bg-cyan-50 text-cyan-700 border-cyan-200',
  'Kimi': 'bg-rose-50 text-rose-700 border-rose-200',
};

function ExtensionBadge({ extension }: { extension: string }) {
  const colorClass = EXTENSION_COLORS[extension] ?? 'bg-gray-50 text-gray-700 border-gray-200';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${colorClass}`}>
      {extension}
    </span>
  );
}

// ── Main Update Logs Page ──────────────────────────────────────────────

export default function UpdateLogsPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<UpdateLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterExtension, setFilterExtension] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  useEffect(() => {
    if (!user?.email) return;

    async function load() {
      if (!user?.email || !user?.role) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getUpdateLogs(user.email, user.role);
        setLogs(data);
      } catch (err: any) {
        console.error('[update-logs] Failed to load:', err);
        setError(err.message || 'Failed to load update logs');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user?.email, user?.role]);

  // Check if user is admin
  const isAdmin = user?.role === 'admin';

  // Get unique extensions for filter
  const extensions = [...new Set(logs.map((l) => l.extension))].sort();

  // Filter logs
  const filteredLogs = logs.filter((log) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!log.description.toLowerCase().includes(q) && !log.date.toLowerCase().includes(q)) {
        return false;
      }
    }
    if (filterExtension !== 'all' && log.extension !== filterExtension) return false;
    if (filterStatus !== 'all') {
      const normalized = log.status.toLowerCase();
      if (filterStatus === 'done' && !normalized.includes('done') && !normalized.includes('✅')) return false;
      if (filterStatus === 'active' && !normalized.includes('active') && !normalized.includes('🔴') && !normalized.includes('in progress') && !normalized.includes('🔄')) return false;
      if (filterStatus === 'blocked' && !normalized.includes('blocked') && !normalized.includes('⏸️')) return false;
    }
    return true;
  });

  // Group by date
  const groupedLogs: Record<string, UpdateLogEntry[]> = {};
  for (const log of filteredLogs) {
    const dateKey = log.date.split(' ')[0]; // Extract just the date part
    if (!groupedLogs[dateKey]) groupedLogs[dateKey] = [];
    groupedLogs[dateKey].push(log);
  }

  const sortedDates = Object.keys(groupedLogs).sort((a, b) => b.localeCompare(a));

  // ── Non-admin view ─────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
          <ShieldAlert className="h-8 w-8 text-red-400" />
        </div>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Access Denied</h2>
        <p className="max-w-md text-center text-sm text-gray-500">
          Only administrators and the system bot can view update logs. If you need to see
          this information, please contact your system administrator.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Update Logs</h1>
          <p className="mt-1 text-sm text-gray-500">
            Track all platform updates, bug fixes, and feature changes across extensions
          </p>
        </div>
        <button
          onClick={() => {
            setLoading(true);
            setError(null);
            getUpdateLogs(user!.email, user!.role)
              .then(setLogs)
              .catch((err) => setError(err.message))
              .finally(() => setLoading(false));
          }}
          className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Access info banner */}
      <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span>
          <strong>Admin access only.</strong> These logs contain internal development tracking
          information and are only visible to administrators and the system bot.
        </span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search logs..."
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm text-gray-700 placeholder:text-gray-400 focus:border-[var(--primary)] focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            value={filterExtension}
            onChange={(e) => setFilterExtension(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-[var(--primary)] focus:outline-none"
          >
            <option value="all">All Extensions</option>
            {extensions.map((ext) => (
              <option key={ext} value={ext}>{ext}</option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-[var(--primary)] focus:outline-none"
          >
            <option value="all">All Status</option>
            <option value="done">Done</option>
            <option value="active">Active</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Logs */}
      {!loading && !error && (
        <>
          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <FileText className="mb-3 h-12 w-12" />
              <p className="text-sm">No update logs found</p>
              {searchQuery && (
                <p className="mt-1 text-xs">Try adjusting your search or filters</p>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {sortedDates.map((date) => (
                <div key={date}>
                  <h2 className="mb-3 text-sm font-semibold text-gray-800">{date}</h2>
                  <div className="space-y-2">
                    {groupedLogs[date].map((log, i) => (
                      <div
                        key={`${date}-${i}`}
                        className="rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <ExtensionBadge extension={log.extension} />
                              <StatusBadge status={log.status} />
                              <span className="text-[11px] text-gray-400">{log.date}</span>
                            </div>
                            <p className="text-sm leading-relaxed text-gray-700">
                              {log.description}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Summary */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-800">Summary</h2>
            <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <div>
                <p className="text-xs text-gray-500">Total Entries</p>
                <p className="text-lg font-bold text-gray-900">{logs.length}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Extensions</p>
                <p className="text-lg font-bold text-gray-900">{extensions.length}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Completed</p>
                <p className="text-lg font-bold text-green-600">
                  {logs.filter((l) => l.status.toLowerCase().includes('done') || l.status.includes('✅')).length}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Active</p>
                <p className="text-lg font-bold text-amber-600">
                  {logs.filter((l) => l.status.toLowerCase().includes('active') || l.status.includes('🔴') || l.status.includes('🔄')).length}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
