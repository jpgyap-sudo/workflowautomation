'use client';

import { useState, useMemo } from 'react';
import { MessageSquare, Search, Filter, RefreshCw, AlertCircle, CheckCircle, Clock, ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { useBotLogs } from '@/lib/useApi';
import type { BotLogEntry } from '@/lib/api';

const STATUS_ICONS: Record<string, typeof AlertCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  pending: Clock,
};

const STATUS_COLORS: Record<string, string> = {
  success: 'text-green-600 bg-green-50 border-green-200',
  error: 'text-red-600 bg-red-50 border-red-200',
  pending: 'text-yellow-600 bg-yellow-50 border-yellow-200',
};

const MESSAGE_TYPE_COLORS: Record<string, string> = {
  text: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  photo: 'bg-purple-50 text-purple-700 border-purple-200',
  document: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  upload: 'bg-green-50 text-green-700 border-green-200',
  callback_query: 'bg-orange-50 text-orange-700 border-orange-200',
  command: 'bg-gray-50 text-gray-700 border-gray-200',
  error: 'bg-red-50 text-red-700 border-red-200',
  vision: 'bg-pink-50 text-pink-700 border-pink-200',
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-SG', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function StatusBadge({ status }: { status: string }) {
  const Icon = STATUS_ICONS[status] ?? AlertCircle;
  const color = STATUS_COLORS[status] ?? 'text-gray-600 bg-gray-50 border-gray-200';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${color}`}>
      <Icon size={12} />
      {status}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  const color = MESSAGE_TYPE_COLORS[type] ?? 'bg-gray-50 text-gray-700 border-gray-200';
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${color}`}>
      {type.replace('_', ' ')}
    </span>
  );
}

function MetadataView({ metadata }: { metadata: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false);
  if (!metadata || Object.keys(metadata).length === 0) return <span className="text-xs text-gray-400">—</span>;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
      >
        {open ? <EyeOff size={12} /> : <Eye size={12} />}
        {open ? 'Hide' : 'Show'} metadata
      </button>
      {open && (
        <pre className="mt-1 max-w-lg overflow-x-auto rounded bg-gray-50 p-2 text-[10px] text-gray-600">
          {JSON.stringify(metadata, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function BotLogsPage() {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterDirection, setFilterDirection] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: logs = [], error, isLoading, mutate } = useBotLogs({ limit: 200 });

  const messageTypes = useMemo(() => [...new Set(logs.map((l) => l.message_type))].sort(), [logs]);
  const directions = useMemo(() => [...new Set(logs.map((l) => l.direction))].sort(), [logs]);

  const filtered = useMemo(() => {
    return logs.filter((log) => {
      if (filterType !== 'all' && log.message_type !== filterType) return false;
      if (filterStatus !== 'all' && log.status !== filterStatus) return false;
      if (filterDirection !== 'all' && log.direction !== filterDirection) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          (log.content ?? '').toLowerCase().includes(q) ||
          (log.username ?? '').toLowerCase().includes(q) ||
          (log.chat_id ?? '').includes(q) ||
          (log.user_id ?? '').includes(q) ||
          JSON.stringify(log.metadata ?? {}).toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [logs, filterType, filterStatus, filterDirection, search]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Bot Logs</h1>
          <p className="mt-1 text-sm text-gray-500">
            Track all Telegram bot messages, uploads, errors, and interactions
          </p>
        </div>
        <button
          onClick={() => mutate()}
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
          />
        </div>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
        >
          <option value="all">All Types</option>
          {messageTypes.map((t) => (
            <option key={t} value={t}>{t.replace('_', ' ')}</option>
          ))}
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
        >
          <option value="all">All Statuses</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
          <option value="pending">Pending</option>
        </select>

        <select
          value={filterDirection}
          onChange={(e) => setFilterDirection(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
        >
          <option value="all">All Directions</option>
          {directions.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        <span className="text-xs text-gray-400">
          {filtered.length} / {logs.length} entries
        </span>
      </div>

      {/* Loading / Error */}
      {isLoading && logs.length === 0 && (
        <div className="flex items-center justify-center py-20 text-sm text-gray-400">
          <RefreshCw size={20} className="mr-2 animate-spin" />
          Loading bot logs...
        </div>
      )}

      {error && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-8 text-sm text-red-600">
          <AlertCircle size={18} />
          Failed to load bot logs. Make sure the API server is running.
        </div>
      )}

      {/* Logs Table */}
      {!isLoading && !error && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Chat ID</th>
                <th className="px-4 py-3">Content</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Direction</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-gray-400">
                    <MessageSquare size={24} className="mx-auto mb-2 opacity-30" />
                    No bot logs found matching your filters.
                  </td>
                </tr>
              ) : (
                filtered.map((log) => (
                  <tr
                    key={log.id}
                    className={`hover:bg-gray-50/50 ${log.status === 'error' ? 'bg-red-50/30' : ''}`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                      {formatTime(log.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadge type={log.message_type} />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {log.username ? (
                        <span className="font-medium">@{log.username}</span>
                      ) : log.user_id ? (
                        <span className="text-gray-400">{log.user_id.slice(0, 8)}…</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-gray-400">
                      {log.chat_id.length > 10 ? `${log.chat_id.slice(0, 10)}…` : log.chat_id}
                    </td>
                    <td className="max-w-[240px] truncate px-4 py-3 text-xs text-gray-700">
                      {log.content ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={log.status} />
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${
                        log.direction === 'incoming'
                          ? 'bg-emerald-50 text-emerald-600'
                          : log.direction === 'outgoing'
                          ? 'bg-green-50 text-green-600'
                          : 'bg-gray-50 text-gray-500'
                      }`}>
                        {log.direction}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                        className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
                      >
                        {expandedId === log.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {expandedId === log.id ? 'Less' : 'More'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Expanded metadata rows */}
      {expandedId && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          {(() => {
            const log = logs.find((l) => l.id === expandedId);
            if (!log) return null;
            return (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-gray-900">Log Details</h3>
                  <button
                    onClick={() => setExpandedId(null)}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    Close
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Log ID</span>
                    <p className="mt-0.5 font-mono text-xs text-gray-700">{log.id}</p>
                  </div>
                  <div>
                    <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Chat ID</span>
                    <p className="mt-0.5 font-mono text-xs text-gray-700">{log.chat_id}</p>
                  </div>
                  <div>
                    <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">User ID</span>
                    <p className="mt-0.5 font-mono text-xs text-gray-700">{log.user_id ?? '—'}</p>
                  </div>
                  <div>
                    <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Username</span>
                    <p className="mt-0.5 text-xs text-gray-700">{log.username ? `@${log.username}` : '—'}</p>
                  </div>
                  <div>
                    <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Created At</span>
                    <p className="mt-0.5 text-xs text-gray-700">{formatTime(log.created_at)}</p>
                  </div>
                  <div>
                    <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Content</span>
                    <p className="mt-0.5 text-xs text-gray-700 break-all">{log.content ?? '—'}</p>
                  </div>
                </div>
                <div>
                  <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Metadata</span>
                  <MetadataView metadata={log.metadata} />
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
