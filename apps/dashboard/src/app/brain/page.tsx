'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, BrainCircuit, Tag, FileText, ChevronDown, ChevronRight, RefreshCw, Plus, X, Clock, CheckCircle, AlertCircle, Trash2, Edit3 } from 'lucide-react';
import { generateActionToken, type BrainLesson, type BrainSearchResult, type BrainStats } from '@/lib/api';

// ── Helpers ────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const CONF_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  high: { label: 'High', color: 'text-green-700', bg: 'bg-green-50' },
  medium: { label: 'Medium', color: 'text-yellow-700', bg: 'bg-yellow-50' },
  low: { label: 'Low', color: 'text-red-700', bg: 'bg-red-50' },
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error (${res.status}): ${body.substring(0, 200)}`);
  }
  return res.json();
}

// ── Stats Cards ────────────────────────────────────────────────────────

function StatsCards({ stats }: { stats: BrainStats | null }) {
  if (!stats) return null;
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="text-2xl font-bold text-[#2490ef]">{stats.total_lessons}</div>
        <div className="text-xs text-gray-500">Total Lessons</div>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="text-2xl font-bold text-green-600">{stats.has_embeddings}</div>
        <div className="text-xs text-gray-500">With Embeddings</div>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="text-2xl font-bold text-yellow-600">{stats.needs_embeddings}</div>
        <div className="text-xs text-gray-500">Needs Embedding</div>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="text-2xl font-bold text-purple-600">
          {Object.keys(stats.by_tag).length}
        </div>
        <div className="text-xs text-gray-500">Unique Tags</div>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="text-2xl font-bold text-gray-700">
          {Object.keys(stats.by_agent).length}
        </div>
        <div className="text-xs text-gray-500">AI Agents</div>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="text-lg font-semibold text-gray-700 truncate" title={stats.by_confidence.high !== undefined ? `High: ${stats.by_confidence.high}` : ''}>
          {stats.by_confidence.high ?? 0}H / {stats.by_confidence.medium ?? 0}M / {stats.by_confidence.low ?? 0}L
        </div>
        <div className="text-xs text-gray-500">Confidence Split</div>
      </div>
    </div>
  );
}

// ── Lesson Card ────────────────────────────────────────────────────────

function LessonCard({
  lesson,
  onDelete,
  onRefetch,
}: {
  lesson: BrainLesson;
  onDelete: (id: string) => void;
  onRefetch: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const conf = CONF_CONFIG[lesson.confidence] ?? CONF_CONFIG.medium;
  const sim = lesson.similarity != null ? `${Math.round(lesson.similarity * 100)}%` : null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white transition-shadow hover:shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${conf.bg} ${conf.color}`}>
              {lesson.confidence}
            </span>
            {sim && (
              <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                {sim} match
              </span>
            )}
            <span className="text-xs text-gray-400">{lesson.agent}</span>
          </div>
          <h3 className="mt-1 text-sm font-medium text-gray-900 line-clamp-1">{lesson.title}</h3>
        </div>
        <span className="shrink-0 text-xs text-gray-400">{formatDate(lesson.created_at)}</span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3">
          {lesson.summary && (
            <p className="mb-2 text-sm text-gray-600">{lesson.summary}</p>
          )}
          <details className="mb-2">
            <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
              Full Content
            </summary>
            <p className="mt-1 whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-600">
              {lesson.content}
            </p>
          </details>

          {lesson.tags.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {lesson.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                >
                  <Tag className="h-3 w-3" />
                  {tag}
                </span>
              ))}
            </div>
          )}

          {lesson.related_files.length > 0 && (
            <div className="mb-2">
              <span className="text-xs font-medium text-gray-500">Files:</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {lesson.related_files.map((f) => (
                  <code key={f} className="rounded bg-gray-50 px-1.5 py-0.5 text-xs text-gray-500">{f}</code>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>Source: {lesson.source}</span>
            {lesson.source_ref && <span>Ref: {lesson.source_ref}</span>}
            <button
              type="button"
              onClick={() => onDelete(lesson.id)}
              className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-red-500 hover:bg-red-50"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── New Lesson Modal ───────────────────────────────────────────────────

function NewLessonModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [summary, setSummary] = useState('');
  const [tags, setTags] = useState('');
  const [confidence, setConfidence] = useState<'high' | 'medium' | 'low'>('medium');
  const [relatedFiles, setRelatedFiles] = useState('');
  const [source, setSource] = useState('manual');
  const [sourceRef, setSourceRef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      setError('Title and content are required.');
      return;
    }
    setError('');
    setSubmitting(true);

    try {
      await fetchJson('/brain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          summary: summary.trim() || undefined,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          confidence,
          source,
          source_ref: sourceRef.trim() || undefined,
          related_files: relatedFiles.split(',').map((f) => f.trim()).filter(Boolean),
        }),
      });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create lesson.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">🧠 New Lesson</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
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
              placeholder="Lesson title"
              maxLength={500}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Content *</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2490ef] focus:outline-none focus:ring-1 focus:ring-[#2490ef]"
              placeholder="Full lesson content"
              rows={6}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Summary</label>
            <input
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2490ef] focus:outline-none focus:ring-1 focus:ring-[#2490ef]"
              placeholder="Short one-line summary"
              maxLength={500}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Tags (comma-separated)</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2490ef] focus:outline-none focus:ring-1 focus:ring-[#2490ef]"
                placeholder="docker, deployment, telegram"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Confidence</label>
              <select
                value={confidence}
                onChange={(e) => setConfidence(e.target.value as 'high' | 'medium' | 'low')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2490ef] focus:outline-none focus:ring-1 focus:ring-[#2490ef]"
              >
                <option value="high">🟢 High</option>
                <option value="medium">🟡 Medium</option>
                <option value="low">🔴 Low</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Related Files (comma-separated)</label>
            <input
              type="text"
              value={relatedFiles}
              onChange={(e) => setRelatedFiles(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2490ef] focus:outline-none focus:ring-1 focus:ring-[#2490ef]"
              placeholder="apps/api/src/server.ts, apps/telegram-bot/src/bot.ts"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Source</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2490ef] focus:outline-none focus:ring-1 focus:ring-[#2490ef]"
              >
                <option value="manual">Manual</option>
                <option value="commit">Commit</option>
                <option value="auto-extract">Auto-Extract</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Source Ref (optional)</label>
              <input
                type="text"
                value={sourceRef}
                onChange={(e) => setSourceRef(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2490ef] focus:outline-none focus:ring-1 focus:ring-[#2490ef]"
                placeholder="Commit hash or reference"
              />
            </div>
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
              className="rounded-lg bg-[#2490ef] px-4 py-2 text-sm text-white hover:bg-[#1a7cd6] disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Save Lesson'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────

export default function BrainPage() {
  const [stats, setStats] = useState<BrainStats | null>(null);
  const [lessons, setLessons] = useState<BrainLesson[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [tagFilter, setTagFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [error, setError] = useState('');

  const fetchStats = useCallback(async () => {
    try {
      const s = await fetchJson<BrainStats>('/brain/stats');
      setStats(s);
    } catch { /* non-fatal */ }
  }, []);

  const fetchLessons = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (searchQuery.trim()) {
        const params = new URLSearchParams({ q: searchQuery.trim(), limit: '50' });
        if (tagFilter) params.set('tags', tagFilter);
        if (agentFilter) params.set('agent', agentFilter);
        const result = await fetchJson<BrainSearchResult>(`/brain/search?${params}`);
        setLessons(result.lessons);
        setTotal(result.total);
      } else {
        const params = new URLSearchParams({ limit: '50', sort: 'created_at', order: 'desc' });
        if (tagFilter) params.set('tag', tagFilter);
        if (agentFilter) params.set('agent', agentFilter);
        const result = await fetchJson<{ lessons: BrainLesson[]; total: number }>(`/brain?${params}`);
        setLessons(result.lessons);
        setTotal(result.total);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load lessons');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, tagFilter, agentFilter]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    fetchLessons();
  }, [fetchLessons]);

  async function handleDelete(id: string) {
    if (!confirm('Delete this lesson?')) return;
    try {
      await fetchJson(`/brain/${id}`, { method: 'DELETE' });
      setLessons((prev) => prev.filter((l) => l.id !== id));
      fetchStats();
    } catch (err: any) {
      alert(err.message || 'Delete failed');
    }
  }

  async function handleReembed() {
    if (!confirm('Generate embeddings for lessons missing them? This may take a while.')) return;
    try {
      const result = await fetchJson<{ processed: number; errors: number }>('/brain/reembed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 100 }),
      });
      alert(`Re-embedded ${result.processed} lessons (${result.errors} errors)`);
      fetchStats();
    } catch (err: any) {
      alert(err.message || 'Re-embed failed');
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchQuery(query);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BrainCircuit className="h-7 w-7 text-[#2490ef]" />
            CentralBrain
          </h1>
          <p className="text-sm text-gray-500">AI Learning Layer — Persistent knowledge base with semantic search</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReembed}
            className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            title="Re-embed lessons missing embeddings"
          >
            <RefreshCw className="h-4 w-4" />
            Re-Embed
          </button>
          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-1 rounded-lg bg-[#2490ef] px-4 py-2 text-sm text-white hover:bg-[#1a7cd6]"
          >
            <Plus className="h-4 w-4" />
            New Lesson
          </button>
        </div>
      </div>

      {/* Stats */}
      <StatsCards stats={stats} />

      {/* Search & Filters */}
      <form onSubmit={handleSearch} className="mb-4 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-[#2490ef] focus:outline-none focus:ring-1 focus:ring-[#2490ef]"
            placeholder="Search lessons (semantic AI search)..."
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-[#2490ef] px-4 py-2 text-sm text-white hover:bg-[#1a7cd6]"
        >
          Search
        </button>
        {(searchQuery || tagFilter || agentFilter) && (
          <button
            type="button"
            onClick={() => { setSearchQuery(''); setQuery(''); setTagFilter(''); setAgentFilter(''); }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Clear Filters
          </button>
        )}
      </form>

      {/* Filter pills */}
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="text"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="w-32 rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:border-[#2490ef] focus:outline-none"
          placeholder="Filter by tag"
        />
        <input
          type="text"
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="w-32 rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:border-[#2490ef] focus:outline-none"
          placeholder="Filter by agent"
        />
        <span className="self-center text-xs text-gray-400">
          {total} lesson{total !== 1 ? 's' : ''}
          {searchQuery && ` matching "${searchQuery}"`}
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Lesson List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : lessons.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center">
          <BrainCircuit className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">No lessons found</p>
          <p className="text-xs text-gray-400">
            {searchQuery ? 'Try a different search query' : 'Click "New Lesson" to add the first lesson'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {lessons.map((lesson) => (
            <LessonCard
              key={lesson.id}
              lesson={lesson}
              onDelete={handleDelete}
              onRefetch={fetchLessons}
            />
          ))}
        </div>
      )}

      {/* New Lesson Modal */}
      {showNewModal && (
        <NewLessonModal
          onClose={() => setShowNewModal(false)}
          onCreated={() => { fetchLessons(); fetchStats(); }}
        />
      )}
    </div>
  );
}
