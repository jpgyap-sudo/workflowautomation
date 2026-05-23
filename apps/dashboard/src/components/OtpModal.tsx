'use client';

/* eslint-disable react-hooks/set-state-in-effect, react-hooks/immutability */
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { sendTelegramActionCode, verifyTelegramActionCode, sendOtpForAction, verifyOtpForAction } from '@/lib/api';
import { X, ShieldAlert, RefreshCw, Send, Mail } from 'lucide-react';

interface OtpModalProps {
  open: boolean;
  title: string;
  description: string;
  onVerified: (actionToken: string) => void;
  onClose: () => void;
}

type Channel = 'telegram' | 'email';

export default function OtpModal({ open, title, description, onVerified, onClose }: OtpModalProps) {
  const { user } = useAuth();
  const [channel, setChannel] = useState<Channel>('telegram');
  const [digits, setDigits] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [step, setStep] = useState<'code' | 'confirm'>('code');
  const [actionToken, setActionToken] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const digitCount = channel === 'telegram' ? 4 : 6;

  // Reset and send code whenever the modal opens or channel changes
  useEffect(() => {
    if (open && user?.email) {
      setDigits(Array(digitCount).fill(''));
      setError('');
      setLoading(false);
      setStep('code');
      setCodeSent(false);
      setResendCooldown(0);
      setActionToken('');
      sendCode('telegram'); // always start with Telegram
    }
  }, [open]);

  // Resize digit array when channel changes
  useEffect(() => {
    setDigits(Array(digitCount).fill(''));
    setError('');
  }, [channel]);

  async function sendCode(ch: Channel = channel) {
    if (!user?.email) return;
    setSending(true);
    setError('');
    try {
      if (ch === 'telegram') {
        const result = await sendTelegramActionCode(user.email);
        if (result.ok) {
          setChannel('telegram');
          setCodeSent(true);
          startCooldown();
          setTimeout(() => inputRefs.current[0]?.focus(), 100);
        } else {
          // Telegram unavailable — fall through to email
          await switchToEmail();
        }
      } else {
        const result = await sendOtpForAction(user.email);
        if (result.ok) {
          setChannel('email');
          setCodeSent(true);
          startCooldown();
          setTimeout(() => inputRefs.current[0]?.focus(), 100);
        } else {
          setError('Failed to send email code. Please try again.');
        }
      }
    } catch (err: unknown) {
      // If Telegram threw, try email automatically
      if (ch === 'telegram') {
        await switchToEmail();
      } else {
        setError(err instanceof Error ? err.message : 'Failed to send code');
      }
    } finally {
      setSending(false);
    }
  }

  async function switchToEmail() {
    setChannel('email');
    setDigits(Array(6).fill(''));
    setError('');
    setSending(true);
    try {
      const result = await sendOtpForAction(user!.email!);
      if (result.ok) {
        setCodeSent(true);
        startCooldown();
        setTimeout(() => inputRefs.current[0]?.focus(), 100);
      } else {
        setError('Both Telegram and email are unavailable. Contact admin.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Both Telegram and email failed. Contact admin.');
    } finally {
      setSending(false);
    }
  }

  function startCooldown() {
    setResendCooldown(60);
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
    if (code.length < digitCount) { setError(`Enter all ${digitCount} digits`); return; }
    if (!user?.email) { setError('User not found'); return; }

    setLoading(true);
    setError('');

    try {
      let result: { ok: boolean; actionToken: string };
      if (channel === 'telegram') {
        result = await verifyTelegramActionCode(user.email, code, user.name);
      } else {
        result = await verifyOtpForAction(user.email, code, user.name);
      }

      if (result.ok && result.actionToken) {
        setActionToken(result.actionToken);
        setStep('confirm');
      } else {
        setError('Verification failed');
        setDigits(Array(digitCount).fill(''));
        inputRefs.current[0]?.focus();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid code');
      setDigits(Array(digitCount).fill(''));
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
    if (digit && index < digitCount - 1) inputRefs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'Enter') {
      const code = digits.join('');
      if (code.length === digitCount) handleSubmit({ preventDefault: () => {} });
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const d = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, digitCount);
    if (!d) return;
    e.preventDefault();
    const next = Array(digitCount).fill('');
    d.split('').forEach((ch, i) => { next[i] = ch; });
    setDigits(next);
    inputRefs.current[Math.min(d.length, digitCount - 1)]?.focus();
  }

  function handleConfirm() {
    if (actionToken) {
      onVerified(actionToken);
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
                {channel === 'telegram' ? 'Sending code to Telegram…' : 'Sending code to email…'}
              </div>
            ) : (
              <>
                {/* Channel indicator */}
                {channel === 'telegram' ? (
                  <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                    <Send className="h-4 w-4 shrink-0 text-[#2490ef]" />
                    <p className="text-xs text-gray-600">
                      {codeSent ? 'A 4-digit code was sent to Telegram.' : 'Sending a 4-digit code to Telegram…'}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
                    <Mail className="h-4 w-4 shrink-0 text-emerald-600" />
                    <p className="text-xs text-gray-600">
                      {codeSent
                        ? `A 6-digit code was sent to ${user?.email}.`
                        : `Sending a 6-digit code to ${user?.email}…`}
                    </p>
                  </div>
                )}

                {/* Digit inputs */}
                <div className="flex justify-center gap-2">
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
                      className="h-14 w-11 rounded-xl border-2 border-gray-200 text-center text-xl font-bold text-gray-900 outline-none transition-colors focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
                    />
                  ))}
                </div>

                {error && (
                  <p className="text-center text-xs text-red-500">{error}</p>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={loading || !codeSent || digits.join('').length < digitCount}
                    className="flex-1 rounded-lg bg-[#2490ef] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1a7ad9] disabled:opacity-50"
                  >
                    {loading ? 'Verifying…' : 'Verify Code'}
                  </button>
                  <button
                    type="button"
                    onClick={() => sendCode(channel)}
                    disabled={sending || resendCooldown > 0}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    title="Resend code"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${sending ? 'animate-spin' : ''}`} />
                    {resendCooldown > 0 ? `${resendCooldown}s` : 'Resend'}
                  </button>
                </div>

                {/* Fallback switcher */}
                {channel === 'telegram' ? (
                  <button
                    type="button"
                    onClick={switchToEmail}
                    disabled={sending}
                    className="flex w-full items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
                  >
                    <Mail className="h-3 w-3" />
                    Didn&apos;t get it? Send to email instead
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => sendCode('telegram')}
                    disabled={sending}
                    className="flex w-full items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
                  >
                    <Send className="h-3 w-3" />
                    Try Telegram instead
                  </button>
                )}
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
