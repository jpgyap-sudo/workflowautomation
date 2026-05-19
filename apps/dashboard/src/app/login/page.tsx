'use client';

import { useState, useRef, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Eye, EyeOff, LogIn, Mail, RotateCcw } from 'lucide-react';

type Step = 'credentials' | 'otp';

export default function LoginPage() {
  const { sendOtp, verifyOtp } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  async function handleCredentials(e: { preventDefault(): void }) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await sendOtp(email, password);
    setLoading(false);
    if (result.success) {
      setStep('otp');
      setResendCooldown(60);
      startCooldown();
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } else {
      setError(result.error ?? 'Login failed');
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

  async function handleResend() {
    if (resendCooldown > 0) return;
    setError('');
    setLoading(true);
    const result = await sendOtp(email, password);
    setLoading(false);
    if (result.success) {
      setOtp(['', '', '', '', '', '']);
      setResendCooldown(60);
      startCooldown();
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } else {
      setError(result.error ?? 'Failed to resend OTP');
    }
  }

  async function handleOtpSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError('');
    const code = otp.join('');
    if (code.length < 6) { setError('Enter all 6 digits'); return; }
    setLoading(true);
    const result = await verifyOtp(email, code);
    setLoading(false);
    if (result.success) {
      router.replace('/');
    } else {
      setError(result.error ?? 'Invalid OTP');
      setOtp(['', '', '', '', '', '']);
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    }
  }

  function handleOtpChange(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);
    if (digit && index < 5) otpRefs.current[index + 1]?.focus();
  }

  function handleOtpKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f5f7] p-4">
      <div className="w-full max-w-md">
        {/* Logo / Branding */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-[#2490ef] p-2.5 shadow-lg shadow-[#2490ef]/20">
            <img src="/icons/icon.svg" alt="Logo" className="h-full w-full" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Quotation Automation System</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in to access the dashboard</p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          {step === 'credentials' ? (
            <form onSubmit={handleCredentials} className="space-y-5">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-gray-700">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                  autoComplete="email"
                  className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-gray-700">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    autoComplete="current-password"
                    className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 pr-10 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-600">{error}</div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2490ef] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1a7ad9] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <LogIn className="h-4 w-4" />
                )}
                {loading ? 'Sending OTP…' : 'Continue'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleOtpSubmit} className="space-y-5">
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-blue-50">
                  <Mail className="h-5 w-5 text-[#2490ef]" />
                </div>
                <p className="text-sm font-medium text-gray-900">Check your email</p>
                <p className="mt-1 text-sm text-gray-500">
                  We sent a 6-digit code to <span className="font-medium text-gray-700">{email}</span>
                </p>
              </div>

              <div className="flex justify-center gap-2" onPaste={handleOtpPaste}>
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
                    className="h-12 w-10 rounded-lg border border-gray-300 text-center text-lg font-semibold text-gray-900 outline-none transition-colors focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
                  />
                ))}
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-600">{error}</div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2490ef] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1a7ad9] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <LogIn className="h-4 w-4" />
                )}
                {loading ? 'Verifying…' : 'Verify & Sign in'}
              </button>

              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => { setStep('credentials'); setError(''); setOtp(['', '', '', '', '', '']); }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendCooldown > 0 || loading}
                  className="flex items-center gap-1 text-[#2490ef] hover:text-[#1a7ad9] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend OTP'}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Authorized personnel only. Unauthorized access is prohibited.
        </p>
      </div>
    </div>
  );
}
