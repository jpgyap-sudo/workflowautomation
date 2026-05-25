'use client';

import { useRef, useState } from 'react';
import OtpModal from '@/components/OtpModal';
import { recordDepositWithFile, payBalanceWithFile, recordStageUpdate, getOrder, getOrderPayments } from '@/lib/api';
import { CreditCard, Scale, CalendarDays, CheckCircle, AlertCircle, Loader2, Paperclip, X } from 'lucide-react';

type ActionResult = { ok: boolean; message: string } | null;
const QUICK_ACTION_UPDATED_BY = 'dashboard_quick_action';

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function ResultBanner({ result, onDismiss }: { result: ActionResult; onDismiss: () => void }) {
  if (!result) return null;
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${result.ok ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
      {result.ok ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
      <span className="flex-1">{result.message}</span>
      <button onClick={onDismiss} className="text-xs opacity-60 hover:opacity-100">×</button>
    </div>
  );
}

function ActionCard({ title, icon: Icon, color, children }: {
  title: string;
  icon: typeof CreditCard;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="mb-5 flex items-center gap-3">
        <div className={`rounded-lg p-2.5 ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <h2 className="text-base font-semibold text-gray-800">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20';

/** Convert a File to base64 string (without data-URL prefix). */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/** Small pill showing the attached filename with a remove button. */
function FileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700">
      <Paperclip className="h-3 w-3 text-gray-400" />
      <span className="max-w-[180px] truncate">{file.name}</span>
      <button type="button" onClick={onRemove} className="text-gray-400 hover:text-red-500">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/** Reusable file-picker trigger button. */
function AttachButton({
  inputRef,
  disabled,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => inputRef.current?.click()}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
    >
      <Paperclip className="h-3.5 w-3.5" />
      Attach file
    </button>
  );
}

// ── Deposit Form ────────────────────────────────────────────────────────

function DepositForm({ onResult }: { onResult: (r: ActionResult) => void }) {
  const [qn, setQn] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [pending, setPending] = useState<{ quotation_number: string; amount: number; deposit_paid_at?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!f) return;
    const ok = f.type.startsWith('image/') || f.type === 'application/pdf';
    if (!ok) {
      onResult({ ok: false, message: 'Only JPEG, PNG, or PDF files are supported.' });
      return;
    }
    setFile(f);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount.replace(/,/g, ''));
    const quotationNumber = qn.trim();
    if (!quotationNumber || Number.isNaN(amt) || amt <= 0) {
      onResult({ ok: false, message: 'Enter a valid quotation number and amount.' });
      return;
    }
    setPending({ quotation_number: quotationNumber, amount: amt, deposit_paid_at: date || undefined });
    setOtpOpen(true);
  }

  async function handleVerified(actionToken: string) {
    if (!pending) return;
    setLoading(true);
    try {
      let imageBase64: string | undefined;
      if (file) imageBase64 = await fileToBase64(file);

      await recordDepositWithFile({
        quotation_number: pending.quotation_number,
        amount: pending.amount,
        deposit_paid_at: pending.deposit_paid_at,
        updated_by: QUICK_ACTION_UPDATED_BY,
        image_base64: imageBase64,
        mime_type: file?.type,
        original_filename: file?.name,
        action_token: actionToken,
      });

      onResult({
        ok: true,
        message: `Downpayment of ₱${pending.amount.toLocaleString()} recorded for ${pending.quotation_number}.${file ? ' Deposit slip uploaded.' : ''}`,
      });
      setQn(''); setAmount(''); setDate(''); setFile(null); setPending(null);
    } catch (err: unknown) {
      onResult({ ok: false, message: getErrorMessage(err, 'Failed to record downpayment.') });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Quotation Number">
          <input className={inputCls} placeholder="QTN-2026-001" value={qn} onChange={e => setQn(e.target.value)} />
        </Field>
        <Field label="Downpayment Amount (₱)">
          <input className={inputCls} placeholder="5000" value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))} />
        </Field>
        <Field label="Payment Date (optional)">
          <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
        </Field>

        {/* File attachment */}
        <Field label="Deposit Slip (JPEG / PDF) — optional">
          <input ref={fileInputRef} type="file" accept="image/*,application/pdf" onChange={handleFileChange} className="hidden" />
          {file ? (
            <FileChip file={file} onRemove={() => setFile(null)} />
          ) : (
            <AttachButton inputRef={fileInputRef} disabled={loading} />
          )}
        </Field>

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2490ef] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a7ad9] disabled:opacity-50"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Record Downpayment
        </button>
      </form>
      <OtpModal
        open={otpOpen}
        title="Confirm Downpayment"
        description={`You are about to record a downpayment for ${pending?.quotation_number ?? 'this order'}. Enter the OTP sent to your email to continue.`}
        onVerified={handleVerified}
        onClose={() => setOtpOpen(false)}
      />
    </>
  );
}

// ── Pay Balance Form ────────────────────────────────────────────────────

function PayBalanceForm({ onResult }: { onResult: (r: ActionResult) => void }) {
  const [qn, setQn] = useState('');
  const [amount, setAmount] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [pending, setPending] = useState<{ quotation_number: string; amount: number } | null>(null);
  const [orderInfo, setOrderInfo] = useState<{ remaining: number; expected: number; balancePaid: number } | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function lookupOrderInfo(quotationNumber: string) {
    if (!quotationNumber.trim()) { setOrderInfo(null); return; }
    setOrderLoading(true);
    try {
      const order = await getOrder(quotationNumber);
      if (order?.id) {
        const payments = await getOrderPayments(order.id);
        setOrderInfo({
          remaining: payments.totals.remaining_balance ?? Math.max(0, (order.total_amount ?? 0) - (order.deposit_amount ?? 0)),
          expected: payments.totals.expected_balance ?? Math.max(0, (order.total_amount ?? 0) - (order.deposit_amount ?? 0)),
          balancePaid: payments.totals.balance ?? 0,
        });
      } else {
        setOrderInfo(null);
      }
    } catch {
      setOrderInfo(null);
    } finally {
      setOrderLoading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!f) return;
    const ok = f.type.startsWith('image/') || f.type === 'application/pdf';
    if (!ok) {
      onResult({ ok: false, message: 'Only JPEG, PNG, or PDF files are supported.' });
      return;
    }
    setFile(f);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount.replace(/,/g, ''));
    const quotationNumber = qn.trim();
    if (!quotationNumber || Number.isNaN(amt) || amt <= 0) {
      onResult({ ok: false, message: 'Enter a valid quotation number and amount.' });
      return;
    }
    setPending({ quotation_number: quotationNumber, amount: amt });
    setOtpOpen(true);
  }

  async function handleVerified(actionToken: string) {
    if (!pending) return;
    setLoading(true);
    try {
      let imageBase64: string | undefined;
      if (file) imageBase64 = await fileToBase64(file);

      const res = await payBalanceWithFile({
        quotation_number: pending.quotation_number,
        amount: pending.amount,
        updated_by: QUICK_ACTION_UPDATED_BY,
        action_token: actionToken,
        image_base64: imageBase64,
        mime_type: file?.type,
        original_filename: file?.name,
      });

      let msg = `Balance of ₱${pending.amount.toLocaleString()} recorded for ${pending.quotation_number}.`;
      if (file) msg += ' Payment proof uploaded.';
      if (res.is_fully_paid) {
        msg += ' Balance fully paid.';
        if (res.overpayment && res.overpayment > 0) msg += ` Overpayment: ₱${res.overpayment.toLocaleString()}.`;
      } else {
        msg += ` Remaining: ₱${res.remaining_balance?.toLocaleString() ?? 'unknown'}.`;
      }
      onResult({ ok: true, message: msg });
      setQn(''); setAmount(''); setFile(null); setPending(null);
    } catch (err: unknown) {
      onResult({ ok: false, message: getErrorMessage(err, 'Failed to record balance payment.') });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Quotation Number">
          <input
            className={inputCls}
            placeholder="QTN-2026-001"
            value={qn}
            onChange={e => { setQn(e.target.value); setOrderInfo(null); }}
            onBlur={e => lookupOrderInfo(e.target.value)}
          />
        </Field>
        {orderLoading && <p className="text-xs text-gray-400">Looking up order...</p>}
        {orderInfo && (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <p className="text-gray-600">Expected balance: <span className="font-semibold text-gray-800">₱{orderInfo.expected.toLocaleString()}</span></p>
            {orderInfo.balancePaid > 0 && (
              <p className="text-gray-600">Already paid: <span className="font-semibold text-green-600">₱{orderInfo.balancePaid.toLocaleString()}</span></p>
            )}
            <p className="text-gray-600">Remaining: <span className="font-semibold text-violet-600">₱{orderInfo.remaining.toLocaleString()}</span></p>
          </div>
        )}
        <Field label={`Balance Amount (₱)${orderInfo ? ` — remaining ₱${orderInfo.remaining.toLocaleString()}` : ''}`}>
          <input className={inputCls} placeholder={orderInfo ? String(orderInfo.remaining) : '15000'} value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))} />
        </Field>

        {/* File attachment */}
        <Field label="Payment Proof (JPEG / PDF) — optional">
          <input ref={fileInputRef} type="file" accept="image/*,application/pdf" onChange={handleFileChange} className="hidden" />
          {file ? (
            <FileChip file={file} onRemove={() => setFile(null)} />
          ) : (
            <AttachButton inputRef={fileInputRef} disabled={loading} />
          )}
        </Field>

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Record Balance Payment
        </button>
      </form>
      <OtpModal
        open={otpOpen}
        title="Confirm Balance Payment"
        description={`You are about to record a balance payment for ${pending?.quotation_number ?? 'this order'}. Enter the OTP sent to your email to continue.`}
        onVerified={handleVerified}
        onClose={() => setOtpOpen(false)}
      />
    </>
  );
}

// ── Schedule Delivery Form ──────────────────────────────────────────────

function ScheduleDeliveryForm({ onResult }: { onResult: (r: ActionResult) => void }) {
  const [qn, setQn] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [pending, setPending] = useState<{ quotation_number: string; delivery_date: string } | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const quotationNumber = qn.trim();
    const deliveryDate = date.trim();
    if (!quotationNumber || !deliveryDate) {
      onResult({ ok: false, message: 'Enter quotation number and delivery date.' });
      return;
    }
    setPending({ quotation_number: quotationNumber, delivery_date: deliveryDate });
    setOtpOpen(true);
  }

  async function handleVerified(actionToken: string) {
    if (!pending) return;
    setLoading(true);
    try {
      await recordStageUpdate({ quotation_number: pending.quotation_number, stage: 'delivery_scheduled', status: 'scheduled', remarks: pending.delivery_date, delivery_date: pending.delivery_date, updated_by: QUICK_ACTION_UPDATED_BY, action_token: actionToken });
      onResult({ ok: true, message: `Delivery scheduled for ${pending.quotation_number} on ${pending.delivery_date}.` });
      setQn(''); setDate(''); setPending(null);
    } catch (err: unknown) {
      onResult({ ok: false, message: getErrorMessage(err, 'Failed to schedule delivery.') });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Quotation Number"><input className={inputCls} placeholder="QTN-2026-001" value={qn} onChange={e => setQn(e.target.value)} /></Field>
        <Field label="Delivery Date"><input className={inputCls} placeholder="May 22 2026" value={date} onChange={e => setDate(e.target.value)} /></Field>
        <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />} Schedule Delivery
        </button>
      </form>
      <OtpModal open={otpOpen} title="Confirm Delivery Schedule" description={`You are about to schedule delivery for ${pending?.quotation_number ?? 'this order'}. Enter the OTP sent to your email to continue.`} onVerified={handleVerified} onClose={() => setOtpOpen(false)} />
    </>
  );
}

// ── Mark Delivered Form ─────────────────────────────────────────────────

function MarkDeliveredForm({ onResult }: { onResult: (r: ActionResult) => void }) {
  const [qn, setQn] = useState('');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [pending, setPending] = useState<{ quotation_number: string; remarks?: string } | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const quotationNumber = qn.trim();
    if (!quotationNumber) {
      onResult({ ok: false, message: 'Enter a quotation number.' });
      return;
    }
    setPending({ quotation_number: quotationNumber, remarks: remarks.trim() || undefined });
    setOtpOpen(true);
  }

  async function handleVerified(actionToken: string) {
    if (!pending) return;
    setLoading(true);
    try {
      await recordStageUpdate({ quotation_number: pending.quotation_number, stage: 'delivered', status: 'delivered', remarks: pending.remarks, updated_by: QUICK_ACTION_UPDATED_BY, action_token: actionToken });
      onResult({ ok: true, message: `${pending.quotation_number} marked as delivered.` });
      setQn(''); setRemarks(''); setPending(null);
    } catch (err: unknown) {
      onResult({ ok: false, message: getErrorMessage(err, 'Failed to mark as delivered.') });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Quotation Number"><input className={inputCls} placeholder="QTN-2026-001" value={qn} onChange={e => setQn(e.target.value)} /></Field>
        <Field label="Remarks (optional)"><input className={inputCls} placeholder="Received by Juan dela Cruz" value={remarks} onChange={e => setRemarks(e.target.value)} /></Field>
        <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />} Mark as Delivered
        </button>
      </form>
      <OtpModal open={otpOpen} title="Confirm Delivered" description={`You are about to mark ${pending?.quotation_number ?? 'this order'} as delivered. Enter the OTP sent to your email to continue.`} onVerified={handleVerified} onClose={() => setOtpOpen(false)} />
    </>
  );
}

// ── Page ────────────────────────────────────────────────────────────────

export default function ActionsPage() {
  const [result, setResult] = useState<ActionResult>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Quick Actions</h1>
        <p className="mt-1 text-sm text-gray-500">
          Record downpayments, balance payments, and delivery updates with OTP verification. Successful quick actions notify the Telegram group.
        </p>
      </div>

      <ResultBanner result={result} onDismiss={() => setResult(null)} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ActionCard title="Record Downpayment" icon={CreditCard} color="bg-pink-100 text-pink-600"><DepositForm onResult={setResult} /></ActionCard>
        <ActionCard title="Pay Balance" icon={Scale} color="bg-violet-100 text-violet-600"><PayBalanceForm onResult={setResult} /></ActionCard>
        <ActionCard title="Schedule Delivery" icon={CalendarDays} color="bg-purple-100 text-purple-600"><ScheduleDeliveryForm onResult={setResult} /></ActionCard>
        <ActionCard title="Mark as Delivered" icon={CheckCircle} color="bg-green-100 text-green-600"><MarkDeliveredForm onResult={setResult} /></ActionCard>
      </div>
    </div>
  );
}
