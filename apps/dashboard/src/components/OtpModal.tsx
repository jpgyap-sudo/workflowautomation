'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { verifyOtpForAction } from '@/lib/api';
import { X, ShieldAlert } from 'lucide-react';

interface OtpModalProps {
  open: boolean;
  title: string;
  description: string;
  onVerified: (actionToken: string) => void;
  onClose: () => void;
}

export default function OtpModal({ open, title, description, onVerified, onClose }: OtpModalProps) {
  const { user } = useAuth();
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'otp' | 'confirm'>('otp');
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setOtp(['', '', '', '', '', '']);
      setError('');
      setLoading(false);
      setStep('otp');
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    }
  }, [open]);

  if (!open) return null;

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    const code = otp.join('');
    if (code.length < 6) { setError('Enter all 6 digits'); return; }
    if (!user?.email) { setError('User email not found'); return; }

    setLoading(true);
    setError('');

    try {
      const result = await verifyOtpForAction(user.email, code);
      if (result.ok && result.actionToken) {
        setStep('confirm');
        // Store token temporarily
        (window as any).__actionToken = result.actionToken;
      } else {
        setError('Verification failed');
        setOtp(['', '', '', '', '', '']);
      }
    } catch (err: any) {
      setError(err.message ?? 'Invalid OTP');
      setOtp(['', '', '', '', '', '']);
    } finally {
      setLoading(false);
    }
  }

  function handleOtpChange(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);
    if (digit && index < 5) otpRefs.current[index + 1]?.focus();
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!digits) return;
    e.preventDefault();
    const next = [...otp];
    digits.split('').forEach((d, i) => { next[i] = d; });
    setOtp(next);
    otpRefs.current[Math.min(digits.length, 5)]?.focus();
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
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {step === 'otp' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-gray-600">{description}</p>
            <p className="text-xs text-gray-400">
              A 6-digit code was sent to <span className="font-medium text-gray-600">{user?.email}</span>
            </p>

            <div className="flex justify-center gap-2">
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { otpRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(i, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(i, e)}
                  onPaste={i === 0 ? handleOtpPaste : undefined}
                  className="h-12 w-10 rounded-lg border border-gray-300 text-center text-lg font-semibold text-gray-900 outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
                />
              ))}
            </div>

            {error && (
              <p className="text-center text-xs text-red-500">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[#2490ef] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1a7ad9] disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Verify OTP'}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              ✅ OTP verified. Tap <strong>Confirm</strong> to proceed with this action.
            </div>
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
