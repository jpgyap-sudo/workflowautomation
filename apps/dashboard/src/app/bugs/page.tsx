'use client';

import { useState, useEffect, useCallback } from 'react';
import { Bug, Plus, CheckCircle, Clock, AlertCircle, XCircle, RefreshCw, Search, MessageSquare } from 'lucide-react';
import { getBugReports, reportBug, updateBugReportStatus, generateActionToken, type BugReport } from '@/lib/api';
import OtpModal from '@/components/OtpModal';
import ConfirmModal from '@/components/ConfirmModal';

// ── Helpers ────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof Clock }> = {
  open: { label: 'Open', color: 'text-red-700', bg: 'bg-red-50', icon: AlertCircle },
  in_progress: { label: 'In Progress', color: 'text-yellow-700', bg: 'bg-yellow-50', icon: Clock },
  resolved: { label: 'Resolved', color: 'text-green-700', bg: 'bg-green-50', icon: CheckCircle },
  closed: { label: 'Closed', color: 'text-gray-500', bg: 'bg-gray-100', icon: XCircle },
};

const STATUS_OPTIONS = ['open', 'in_progress', 'resolved', 'closed'] as const;

// ── New Bug Report Modal ───────────────────────────────────────────────

function NewBugModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [reporterName, setReporterName] = useState('');
  const [reporterContact, setReporterContact] = useState('');
  const [orderReference, setOrderReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showOtp, setShowOtp] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError('Title and description are required.');
      return;
    }
    setError('');
    setShowOtp(true);
  }

  async function handleVerified(actionToken: string) {
    setSubmitting(true);
    setError('');
    try {
      await reportBug({
        title: title.trim(),
        description: description.trim(),
        reporter_name: reporterName.trim() || undefined,
        reporter_contact: reporterContact.trim() || undefined,
        order_reference: orderReference.trim() || undefined,
        action_token: actionToken,
      });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to submit bug report.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">🐛 Report a Bug</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <XCircle className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2490ef] focus:outline-none focus:ring-1 focus:ring-[#2490ef]"
              placeholder="Brief summary of the bug"
              maxLength={200}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2490ef] focus:outline-none focus:ring-1 focus:ring-[#2490ef]"
              placeholder="What happened? What did you expect?"
              rows={4}
              maxLength={5000}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Your Name</label>
              <input
                type="text"
                value={reporterName}
                onChange={(e) => setReporterName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2490ef] focus:outline-none focus:ring-1 focus:ring-[#2490ef]"
                placeholder="Optional"
                maxLength={200}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Contact</label>
              <input
                type="text"
                value={reporterContact}
                onChange={(e) => setReporterContact(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2490ef] focus:outline-none focus:ring-1 focus:ring-[#2490ef]"
                placeholder="Phone or email"
                maxLength={200}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Order Reference</label>
            <input
              type="text"
              value={orderReference}
              onChange={(e) => setOrderReference(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2490ef] focus:outline-none focus:ring-1 focus:ring-[#2490ef]"
              placeholder="Quotation number (optional)"
              maxLength={100}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-[#2490ef] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a7ad9] disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
      {showOtp && (
        <ConfirmModal
          open={showOtp}
          title="Report a Bug"
          description={`You are about to submit a bug report "${title}".`}
          onVerified={handleVerified}
          onClose={() => setShowOtp(false)}
        />
      )}
    </div>
  );
}

// ── Status Badge ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.open;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.color} ${cfg.bg}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────

export default function BugsPage() {
  const [reports, setReports] = useState<BugReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    description: string;
  }>({ open: false, title: '', description: '' });

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getBugReports();
      setReports(data.reports);
    } catch (err: any) {
      setError(err.message || 'Failed to load bug reports.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  function handleStatusChange(id: string, status: 'open' | 'in_progress' | 'resolved' | 'closed') {
    const report = reports.find((r) => r.id === id);
    (window as any).__pendingBugStatusChange = { id, status };
    setConfirmModal({
      open: true,
      title: 'Update Bug Status',
      description: `Confirm changing "${report?.title ?? 'this report'}" to ${status.replace(/_/g, ' ')}.`,
    });
  }

  async function handleConfirmVerified(actionToken: string) {
    try {
      await handleStatusChangeVerified(actionToken);
      setConfirmModal((prev) => ({ ...prev, open: false }));
    } catch (err: any) {
      alert('Action failed: ' + (err.message ?? 'Unknown error'));
    }
  }

  async function handleStatusChangeVerified(actionToken: string) {
    const pending = (window as any).__pendingBugStatusChange as
      | { id: string; status: 'open' | 'in_progress' | 'resolved' | 'closed' }
      | undefined;
    if (!pending) return;
    setUpdatingId(pending.id);
    try {
      await updateBugReportStatus(pending.id, pending.status, actionToken);
      setReports((prev) =>
        prev.map((r) => (r.id === pending.id ? { ...r, status: pending.status, updated_at: new Date().toISOString() } : r))
      );
    } catch (err: any) {
      console.error('Failed to update status:', err);
      alert(err.message ?? 'Failed to update status');
    } finally {
      setUpdatingId(null);
      (window as any).__pendingBugStatusChange = null;
    }
  }

  const filteredReports = reports.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        r.title.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        (r.reporter_name ?? '').toLowerCase().includes(q) ||
        (r.order_reference ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const counts = {
    all: reports.length,
    open: reports.filter((r) => r.status === 'open').length,
    in_progress: reports.filter((r) => r.status === 'in_progress').length,
    resolved: reports.filter((r) => r.status === 'resolved').length,
    closed: reports.filter((r) => r.status === 'closed').length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">🐛 Bug Reports</h1>
          <p className="mt-1 text-sm text-gray-500">
            Report bugs and track their resolution status.
          </p>
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#2490ef] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a7ad9]"
        >
          <Plus className="h-4 w-4" />
          Report a Bug
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'All', count: counts.all, color: 'text-gray-900', bg: 'bg-gray-100' },
          { label: 'Open', count: counts.open, color: 'text-red-700', bg: 'bg-red-50' },
          { label: 'In Progress', count: counts.in_progress, color: 'text-yellow-700', bg: 'bg-yellow-50' },
          { label: 'Resolved', count: counts.resolved, color: 'text-green-700', bg: 'bg-green-50' },
          { label: 'Closed', count: counts.closed, color: 'text-gray-500', bg: 'bg-gray-100' },
        ].map((stat) => (
          <button
            key={stat.label}
            onClick={() => setStatusFilter(stat.label === 'All' ? 'all' : stat.label.toLowerCase().replace(' ', '_'))}
            className={`rounded-xl border p-4 text-left transition-colors ${
              (statusFilter === 'all' && stat.label === 'All') || statusFilter === stat.label.toLowerCase().replace(' ', '_')
                ? 'border-[#2490ef] ring-1 ring-[#2490ef]'
                : 'border-gray-200 hover:border-gray-300'
            } ${stat.bg}`}
          >
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.count}</div>
            <div className="mt-1 text-xs font-medium text-gray-500">{stat.label}</div>
          </button>
        ))}
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, description, reporter, or order..."
            className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm focus:border-[#2490ef] focus:outline-none focus:ring-1 focus:ring-[#2490ef]"
          />
        </div>
        <button
          onClick={fetchReports}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Bug Report List */}
      {loading && reports.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-sm text-gray-400">Loading bug reports...</div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : filteredReports.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 py-20 text-gray-400">
          <Bug className="mb-3 h-12 w-12" />
          <p className="text-sm font-medium">No bug reports found</p>
          <p className="mt-1 text-xs">
            {searchQuery || statusFilter !== 'all'
              ? 'Try adjusting your search or filter.'
              : 'Click "Report a Bug" to submit the first report.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredReports.map((report) => {
            const isUpdating = updatingId === report.id;
            return (
              <div
                key={report.id}
                className="rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-sm"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-gray-900">{report.title}</h3>
                      <StatusBadge status={report.status} />
                      {report.source === 'telegram' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">
                          <MessageSquare className="h-2.5 w-2.5" />
                          Telegram
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-gray-600 line-clamp-3">
                      {report.description}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
                      <span>Reported {formatDate(report.created_at)}</span>
                      {report.reporter_name && <span>by {report.reporter_name}</span>}
                      {report.order_reference && (
                        <span className="font-mono text-gray-500">Order: {report.order_reference}</span>
                      )}
                      {report.created_at !== report.updated_at && (
                        <span>Updated {formatDate(report.updated_at)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <select
                      value={report.status}
                      onChange={(e) => handleStatusChange(report.id, e.target.value as any)}
                      disabled={isUpdating}
                      className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 focus:border-[#2490ef] focus:outline-none focus:ring-1 focus:ring-[#2490ef] disabled:opacity-50"
                    >
                      {STATUS_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {STATUS_CONFIG[opt].label}
                        </option>
                      ))}
                    </select>
                    {isUpdating && <RefreshCw className="h-4 w-4 animate-spin text-gray-400" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New Bug Report Modal */}
      {showNewModal && (
        <NewBugModal
          onClose={() => setShowNewModal(false)}
          onCreated={fetchReports}
        />
      )}

      {/* Confirm Modal */}
      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        description={confirmModal.description}
        onVerified={handleConfirmVerified}
        onClose={() => {
          setConfirmModal({ ...confirmModal, open: false });
          (window as any).__pendingBugStatusChange = null;
        }}
      />
    </div>
  );
}
