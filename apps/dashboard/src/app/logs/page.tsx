'use client';

import { useState } from 'react';
import { Activity, Search, Filter, RefreshCw, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { useAgentLogs } from '@/lib/useApi';

interface AgentLog {
  id: string;
  agent_name: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  created_at: string;
}

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

export default function AgentLogsPage() {
  const { data: logs = [], error, isLoading, mutate } = useAgentLogs();
  const [search, setSearch] = useState('');
  const [filterAgent, setFilterAgent] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const agents = [...new Set(logs.map((l) => l.agent_name))].sort();

  const filtered = logs.filter((log) => {
    if (filterAgent !== 'all' && log.agent_name !== filterAgent) return false;
    if (filterStatus !== 'all' && log.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        log.agent_name.toLowerCase().includes(q) ||
        log.status.toLowerCase().includes(q) ||
        JSON.stringify(log.input).toLowerCase().includes(q) ||
        JSON.stringify(log.output).toLowerCase().includes(q) ||
        (log.error ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  function formatTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString('en-SG', {
      timeZone: 'Asia/Singapore',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function truncate(obj: unknown, max = 120): string {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1);
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agent Logs</h1>
          <p className="mt-1 text-sm text-gray-500">
            Track all automated agent activities and their outcomes
          </p>
        </div>
        <button
          onClick={() => mutate()}
          disabled={isLoading}
          className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search logs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            value={filterAgent}
            onChange={(e) => setFilterAgent(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2490ef]"
          >
            <option value="all">All Agents</option>
            {agents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2490ef]"
          >
            <option value="all">All Status</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
            <option value="pending">Pending</option>
          </select>
        </div>

        <span className="text-sm text-gray-400">
          {filtered.length} of {logs.length} logs
        </span>
      </div>

      {/* Logs List */}
      {isLoading && logs.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="h-8 w-8 animate-spin text-gray-300" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Activity className="mb-3 h-12 w-12" />
          <p className="text-sm">No agent logs found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((log) => {
            const StatusIcon = STATUS_ICONS[log.status] ?? AlertCircle;
            const statusColor = STATUS_COLORS[log.status] ?? 'text-gray-600 bg-gray-50 border-gray-200';
            const isExpanded = expandedId === log.id;

            return (
              <div
                key={log.id}
                className="rounded-xl border border-gray-200 bg-white transition-shadow hover:shadow-sm"
              >
                {/* Summary row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : log.id)}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left"
                >
                  <div className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${statusColor}`}>
                    <StatusIcon className="h-3.5 w-3.5" />
                    {log.status}
                  </div>
                  <span className="font-mono text-sm font-medium text-gray-800">
                    {log.agent_name}
                  </span>
                  <span className="ml-auto text-xs text-gray-400">
                    {formatTime(log.created_at)}
                  </span>
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-5 py-4 space-y-4">
                    {log.error && (
                      <div>
                        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-500">Error</h4>
                        <pre className="rounded-lg bg-red-50 p-3 text-xs text-red-700 overflow-x-auto whitespace-pre-wrap">
                          {log.error}
                        </pre>
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Input</h4>
                        <pre className="rounded-lg bg-gray-50 p-3 text-xs text-gray-700 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                          {JSON.stringify(log.input, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Output</h4>
                        <pre className="rounded-lg bg-gray-50 p-3 text-xs text-gray-700 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                          {JSON.stringify(log.output, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
