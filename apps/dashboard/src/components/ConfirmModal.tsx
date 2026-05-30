'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { generateActionToken } from '@/lib/api';
import { X, ShieldAlert } from 'lucide-react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  onVerified: (actionToken: string) => void;
  onClose: () => void;
}

export default function ConfirmModal({ open, title, description, onVerified, onClose }: ConfirmModalProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [prefetchStatus, setPrefetchStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const cachedToken = useRef<string | null>(null);

  // Pre-fetch action token when modal opens so it's ready when user clicks Confirm
  useEffect(() => {
    if (!open) {
      cachedToken.current = null;
      setPrefetchStatus('idle');
      return;
    }
    cachedToken.current = null;
    setPrefetchStatus('loading');
    generateActionToken(user?.email ?? '', user?.name ?? undefined)
      .then((result) => {
        if (result.ok && result.actionToken) {
          cachedToken.current = result.actionToken;
          setPrefetchStatus('ready');
        } else {
          setPrefetchStatus('failed');
        }
      })
      .catch(() => {
        setPrefetchStatus('failed');
      });
  }, [open, user?.email, user?.name]);

  if (!open) return null;

  async function handleConfirm() {
    setLoading(true);
    setError('');
    try {
      // Use cached token if available, otherwise fetch fresh
      const token = cachedToken.current || (await generateActionToken(user?.email ?? '', user?.name ?? undefined)).actionToken;
      if (token) {
        onVerified(token);
      } else {
        setError('Failed to generate action token. Please try again.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-gray-600">{description}</p>

          {prefetchStatus === 'loading' && (
            <p className="text-center text-xs text-amber-500">Preparing confirmation…</p>
          )}

          {error && (
            <p className="text-center text-xs text-red-500">{error}</p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading}
              className="flex-1 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {loading ? 'Processing…' : 'Confirm Action'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
