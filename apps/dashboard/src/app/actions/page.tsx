'use client';

import { useState } from 'react';
import { recordDeposit, payBalance, recordStageUpdate } from '@/lib/api';
import { CreditCard, Scale, CalendarDays, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

type ActionResult = { ok: boolean; message: string } | null;

function ResultBanner({ result, onDismiss }: { result: ActionResult; onDismiss: () => void }) {
  if (!result) return null;
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${result.ok ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
      {result.ok ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
      <span className="flex-1">{result.message}</span>
      <button onClick={onDismiss} className="text-xs opacity-60 hover:opacity-100">✕</button>
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

// ── Record Deposit ──────────────────────────────────────────────────────
function DepositForm({ onResult }: { onResult: (r: ActionResult) => void }) {
  const [qn, setQn] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount.replace(/,/g, ''));
    if (!qn.trim() || isNaN(amt) || amt <= 0) {
      onResult({ ok: false, message: 'Enter a valid quotation number and amount.' });
      return;
    }
    setLoading(true);
    try {
      await recordDeposit({ quotation_number: qn.trim(), amount: amt, deposit_paid_at: date || undefined });
      onResult({ ok: true, message: `Downpayment of ₱${amt.toLocaleString()} recorded for ${qn.trim()}.` });
      setQn(''); setAmount(''); setDate('');
    } catch (err: any) {
      onResult({ ok: false, message: err.message ?? 'Failed to record downpayment.' });
    } finally {
      setLoading(false);
    }
  }

  return (
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
      <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2490ef] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a7ad9] disabled:opacity-50">
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Record Downpayment
      </button>
    </form>
  );
}

// ── Pay Balance ─────────────────────────────────────────────────────────
function PayBalanceForm({ onResult }: { onResult: (r: ActionResult) => void }) {
  const [qn, setQn] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount.replace(/,/g, ''));
    if (!qn.trim() || isNaN(amt) || amt <= 0) {
      onResult({ ok: false, message: 'Enter a valid quotation number and amount.' });
      return;
    }
    setLoading(true);
    try {
      const res = await payBalance({ quotation_number: qn.trim(), amount: amt });
      let msg = `Balance of ₱${amt.toLocaleString()} recorded for ${qn.trim()}.`;
      if (res.overpayment && res.overpayment > 0) msg += ` Overpayment: ₱${res.overpayment.toLocaleString()}.`;
      onResult({ ok: true, message: msg });
      setQn(''); setAmount('');
    } catch (err: any) {
      onResult({ ok: false, message: err.message ?? 'Failed to record balance payment.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Quotation Number">
        <input className={inputCls} placeholder="QTN-2026-001" value={qn} onChange={e => setQn(e.target.value)} />
      </Field>
      <Field label="Balance Amount (₱)">
        <input className={inputCls} placeholder="15000" value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))} />
      </Field>
      <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Record Balance Payment
      </button>
    </form>
  );
}

// ── Schedule Delivery ───────────────────────────────────────────────────
function ScheduleDeliveryForm({ onResult }: { onResult: (r: ActionResult) => void }) {
  const [qn, setQn] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!qn.trim() || !date.trim()) {
      onResult({ ok: false, message: 'Enter quotation number and delivery date.' });
      return;
    }
    setLoading(true);
    try {
      await recordStageUpdate({ quotation_number: qn.trim(), stage: 'delivery_scheduled', status: 'scheduled', remarks: date.trim(), updated_by: 'dashboard' });
      onResult({ ok: true, message: `Delivery scheduled for ${qn.trim()} on ${date.trim()}.` });
      setQn(''); setDate('');
    } catch (err: any) {
      onResult({ ok: false, message: err.message ?? 'Failed to schedule delivery.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Quotation Number">
        <input className={inputCls} placeholder="QTN-2026-001" value={qn} onChange={e => setQn(e.target.value)} />
      </Field>
      <Field label="Delivery Date">
        <input className={inputCls} placeholder="May 22 2026" value={date} onChange={e => setDate(e.target.value)} />
      </Field>
      <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50">
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Schedule Delivery
      </button>
    </form>
  );
}

// ── Mark as Delivered ───────────────────────────────────────────────────
function MarkDeliveredForm({ onResult }: { onResult: (r: ActionResult) => void }) {
  const [qn, setQn] = useState('');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!qn.trim()) {
      onResult({ ok: false, message: 'Enter a quotation number.' });
      return;
    }
    setLoading(true);
    try {
      await recordStageUpdate({ quotation_number: qn.trim(), stage: 'delivered', status: 'delivered', remarks: remarks.trim() || undefined, updated_by: 'dashboard' });
      onResult({ ok: true, message: `${qn.trim()} marked as delivered.` });
      setQn(''); setRemarks('');
    } catch (err: any) {
      onResult({ ok: false, message: err.message ?? 'Failed to mark as delivered.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Quotation Number">
        <input className={inputCls} placeholder="QTN-2026-001" value={qn} onChange={e => setQn(e.target.value)} />
      </Field>
      <Field label="Remarks (optional)">
        <input className={inputCls} placeholder="Received by Juan dela Cruz" value={remarks} onChange={e => setRemarks(e.target.value)} />
      </Field>
      <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Mark as Delivered
      </button>
    </form>
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
          Record downpayments, balance payments, and delivery updates directly — no Telegram required.
        </p>
      </div>

      <ResultBanner result={result} onDismiss={() => setResult(null)} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ActionCard title="Record Downpayment" icon={CreditCard} color="bg-pink-100 text-pink-600">
          <DepositForm onResult={setResult} />
        </ActionCard>

        <ActionCard title="Pay Balance" icon={Scale} color="bg-violet-100 text-violet-600">
          <PayBalanceForm onResult={setResult} />
        </ActionCard>

        <ActionCard title="Schedule Delivery" icon={CalendarDays} color="bg-purple-100 text-purple-600">
          <ScheduleDeliveryForm onResult={setResult} />
        </ActionCard>

        <ActionCard title="Mark as Delivered" icon={CheckCircle} color="bg-green-100 text-green-600">
          <MarkDeliveredForm onResult={setResult} />
        </ActionCard>
      </div>
    </div>
  );
}
