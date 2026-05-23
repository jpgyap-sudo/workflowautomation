'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { sendTelegramActionCode, verifyTelegramActionCode } from '@/lib/api';
import { X, ShieldAlert, RefreshCw, Send } from 'lucide-react';

interface OtpModalProps {
  open: boolean;
  title: string;
  description: string;
  onVerified: (actionToken: string) => void;
  onClose: () => void;
}

export default function OtpModal({ open, title, description, onVerified, onClose }: OtpModalProps) {
  const { user } = useAuth();
  const [digits, setDigits] = useState(['', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [step, setStep] = useState<'code' | 'confirm'>('code');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Send code automatically when modal opens
  useEffect(() => {
    if (open && user?.email) {
      setDigits(['', '', '', '']);
      setError('');
      setLoading(false);
      setStep('code');
      setCodeSent(false);
      setResendCooldown(0);
      sendCode();
    }
  }, [open]);

  async function sendCode() {
    if (!user?.email) return;
    setSending(true);
    setError('');
    try {
      const result = await sendTelegramActionCode(user.email);
      if (result.ok) {
        setCodeSent(true);
        setResendCooldown(60);
        startCooldown();
        setTimeout(() => inputRefs.current[0]?.focus(), 100);
      } else {
        setError('Failed to send code. Please try again.');
      }
    } catch (err: any) {
      setError(err.message ?? 'Failed to send code');
    } finally {
      setSending(false);
    }
  }

  function startCooldown() {
    const interval = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
  }

  if (!open) return null;

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    const code = digits.join('');
    if (code.length < 4) { setError('Enter all 4 digits'); return; }
    if (!user?.email) { setError('User not found'); return; }

    setLoading(true);
    setError('');

    try {
      const result = await verifyTelegramActionCode(user.email, code);
      if (result.ok && result.actionToken) {
        setStep('confirm');
        (window as any).__actionToken = result.actionToken;
      } else {
        setError('Verification failed');
        setDigits(['', '', '', '']);
        inputRefs.current[0]?.focus();
      }
    } catch (err: any) {
      setError(err.message ?? 'Invalid code');
      setDigits(['', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  function handleDigitChange(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    if (digit && index < 3) inputRefs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    // Auto-submit when all 4 digits are filled
    if (e.key === 'Enter') {
      const code = digits.join('');
      if (code.length === 4) handleSubmit({ preventDefault: () => {} });
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const d = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (!d) return;
    e.preventDefault();
    const next = [...digits];
    d.split('').forEach((ch, i) => { next[i] = ch; });
    setDigits(next);
    inputRefs.current[Math.min(d.length, 3)]?.focus();
  }

  function handleConfirm() {
    const token = (window as any).__actionToken;
    if (token) {
      onVerified(token);
      (window as any).__actionToken = null;
    }
    onClose();
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

        {step === 'code' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-gray-600">{description}</p>

            {sending ? (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-500">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-[#2490ef]" />
                Sending code to Telegram…
              </div>
            ) : (
              <>
                {/* Telegram indicator */}
                <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                  <Send className="h-4 w-4 shrink-0 text-[#2490ef]" />
                  <p className="text-xs text-gray-600">
                    {codeSent
                      ? 'A 4-digit code was sent to your Telegram.'
                      : 'Sending a 4-digit code to Telegram…'}
                  </p>
                </div>

                {/* 4-digit inputs */}
                <div className="flex justify-center gap-3">
                  {digits.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => { inputRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleDigitChange(i, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(i, e)}
                      onPaste={i === 0 ? handlePaste : undefined}
                      className="h-14 w-12 rounded-xl border-2 border-gray-200 text-center text-xl font-bold text-gray-900 outline-none transition-colors focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
                    />
                  ))}
                </div>

                {error && (
                  <p className="text-center text-xs text-red-500">{error}</p>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={loading || !codeSent || digits.join('').length < 4}
                    className="flex-1 rounded-lg bg-[#2490ef] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1a7ad9] disabled:opacity-50"
                  >
                    {loading ? 'Verifying…' : 'Verify Code'}
                  </button>
                  <button
                    type="button"
                    onClick={sendCode}
                    disabled={sending || resendCooldown > 0}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    title="Resend code"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${sending ? 'animate-spin' : ''}`} />
                    {resendCooldown > 0 ? `${resendCooldown}s` : 'Resend'}
                  </button>
                </div>
              </>
            )}
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              ✅ Code verified. Tap <strong>Confirm</strong> to proceed with this action.
            </div>
            <p className="text-xs text-gray-500 text-center">{description}</p>
            <button
              onClick={handleConfirm}
              className="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-600"
            >
              Confirm Action
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
