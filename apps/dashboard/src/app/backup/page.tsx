'use client';

import { useBackups } from '@/lib/useApi';
import {
  Database,
  CheckCircle,
  AlertCircle,
  Clock,
  RefreshCw,
  HardDrive,
  CalendarDays,
  FileText,
  Download,
  ExternalLink,
  type LucideIcon,
} from 'lucide-react';

// ── Helpers ────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatLogPayload(payload: Record<string, unknown> | null): string {
  if (!payload) return '';
  const message = payload.message;
  return typeof message === 'string' ? message : JSON.stringify(payload);
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'ok':
    case 'success':
    case 'complete':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
          <CheckCircle className="h-3 w-3" />
          Success
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
          <AlertCircle className="h-3 w-3" />
          Failed
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
          <Clock className="h-3 w-3" />
          {status}
        </span>
      );
  }
}

// ── Stat Card ──────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500">{label}</p>
          <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
          {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color.replace('text-', 'bg-').replace('700', '100')}`}>
          <Icon className={`h-5 w-5 ${color}`} />
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────

export default function BackupPage() {
  const { data, error, isLoading, mutate } = useBackups();

  const files = data?.files ?? [];
  const latestLog = data?.latestLog ?? null;
  const apiError = data?.error ?? null;

  // Compute stats
  const totalSize = files.reduce((sum, f) => sum + f.size_bytes, 0);
  const lastBackupTime = latestLog?.created_at ?? null;
  const lastBackupStatus = latestLog?.status ?? null;
  const lastBackupError = latestLog?.error ?? null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Database Backups</h1>
          <p className="mt-1 text-sm text-gray-500">
            Monitor Supabase off-site backups — automatically created every 24 hours
          </p>
        </div>
        <button
          onClick={() => mutate()}
          className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* API Error Banner */}
      {apiError && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Supabase API error: {apiError}</span>
        </div>
      )}

      {/* Loading */}
      {isLoading && !data && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
        </div>
      )}

      {/* Error */}
      {error && !data && (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-red-500">Failed to load backup data. Retrying...</p>
        </div>
      )}

      {data && (
        <>
          {/* Stats Row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Database}
              label="Total Backups"
              value={files.length}
              sub="In Supabase Storage"
              color="text-blue-700"
            />
            <StatCard
              icon={HardDrive}
              label="Total Size"
              value={formatBytes(totalSize)}
              sub="Across all backups"
              color="text-purple-700"
            />
            <StatCard
              icon={CalendarDays}
              label="Last Backup"
              value={lastBackupTime ? timeAgo(lastBackupTime) : 'Never'}
              sub={lastBackupTime ? formatDate(lastBackupTime) : undefined}
              color="text-emerald-700"
            />
            <StatCard
              icon={lastBackupStatus === 'ok' ? CheckCircle : AlertCircle}
              label="Last Status"
              value={lastBackupStatus === 'ok' ? 'Successful' : lastBackupStatus ?? 'N/A'}
              sub={lastBackupError ?? undefined}
              color={lastBackupStatus === 'ok' ? 'text-green-700' : 'text-red-700'}
            />
          </div>

          {/* Latest Backup Log */}
          {latestLog && (
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-gray-800">Latest Backup Run</h2>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-600">Status:</span>
                  {getStatusBadge(latestLog.status)}
                </div>
                <div>
                  <span className="font-medium text-gray-600">Time:</span>{' '}
                  <span className="text-gray-800">{formatDate(latestLog.created_at)}</span>
                </div>
                {latestLog.output && (
                  <div>
                    <span className="font-medium text-gray-600">Output:</span>{' '}
                    <span className="text-gray-700">
                      {formatLogPayload(latestLog.output)}
                    </span>
                  </div>
                )}
                {latestLog.error && (
                  <div>
                    <span className="font-medium text-red-600">Error:</span>{' '}
                    <span className="text-red-500">{latestLog.error}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Backup Files Table */}
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-200 px-5 py-4">
              <h2 className="text-sm font-semibold text-gray-800">
                Backup Files ({files.length})
              </h2>
            </div>

            {files.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Database className="mb-3 h-12 w-12" />
                <p className="text-sm">No backup files found</p>
                <p className="mt-1 text-xs">
                  Backups are created every 24 hours. The first backup will appear here after the agent runs.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500">
                      <th className="px-5 py-3">Filename</th>
                      <th className="px-5 py-3">Size</th>
                      <th className="px-5 py-3">Created</th>
                      <th className="px-5 py-3">Age</th>
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {files.map((file) => (
                      <tr key={file.name} className="hover:bg-gray-50">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                            <span className="font-medium text-gray-800">{file.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-gray-600">
                          {formatBytes(file.size_bytes)}
                        </td>
                        <td className="px-5 py-3 text-gray-600">
                          {formatDate(file.created_at)}
                        </td>
                        <td className="px-5 py-3 text-gray-500">
                          {timeAgo(file.created_at)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <a
                            href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/backups/download/${encodeURIComponent(file.name)}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                            title="Download backup file"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Download
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Info Card */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-800">About Automated Backups</h2>
            <div className="space-y-2 text-sm text-gray-600">
              <p>
                The <strong>Supabase Backup Agent</strong> runs automatically every 24 hours. It:
              </p>
              <ul className="list-inside list-disc space-y-1 pl-2">
                <li>Dumps the PostgreSQL database via <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">pg_dump</code></li>
                <li>Compresses with gzip and uploads to Supabase Storage</li>
                <li>Auto-removes backups older than the retention period (default: 30 days)</li>
                <li>Sends a Telegram alert if the backup fails (if configured)</li>
              </ul>
              <p className="mt-2 text-xs text-gray-400">
                Backups are stored in the <code className="rounded bg-gray-100 px-1 py-0.5">db-backups</code> bucket on{' '}
                <a
                  href="https://supabase.com/dashboard/project/zetmxacmioodgxxmursa/storage/buckets"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#2490ef] hover:underline"
                >
                  Supabase Dashboard
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
