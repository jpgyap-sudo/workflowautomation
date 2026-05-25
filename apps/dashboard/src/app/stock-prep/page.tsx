'use client';

import { useState } from 'react';
import { useOrdersByStage } from '@/lib/useApi';
import { STAGE_CONFIG } from '@/lib/api';
import type { Order } from '@/lib/api';
import { markStockReady, setStockPrep } from '@/lib/api';
import OtpModal from '@/components/OtpModal';
import { PackageCheck, Clock, CheckCircle, AlertCircle, Loader2, Edit2, Save, X } from 'lucide-react';

function formatDate(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function daysDiff(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return diff;
}

function ReadyBadge({ readyAt }: { readyAt: string | null | undefined }) {
  if (!readyAt) return <span className="text-xs text-gray-400">No date set</span>;
  const diff = daysDiff(readyAt);
  if (diff === null) return null;
  if (diff <= 0) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-lime-100 px-2 py-0.5 text-xs font-medium text-lime-800">
      <CheckCircle className="h-3 w-3" /> Ready
    </span>
  );
  if (diff <= 2) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
      <Clock className="h-3 w-3" /> {diff}d left
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
      <Clock className="h-3 w-3" /> {diff}d left
    </span>
  );
}

function StockPrepCard({ order, onUpdated }: { order: Order; onUpdated: () => void }) {
  const [showOtp, setShowOtp] = useState(false);
  const [pendingAction, setPendingAction] = useState<'ready' | null>(null);
  const [deductInventory, setDeductInventory] = useState(true);
  const [marking, setMarking] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Prep days edit
  const [editingDays, setEditingDays] = useState(false);
  const [daysInput, setDaysInput] = useState(String(order.stock_prep_days ?? 0));
  const [savingDays, setSavingDays] = useState(false);

  function handleMarkReady() {
    setPendingAction('ready');
    setShowOtp(true);
  }

  async function handleVerified(actionToken: string) {
    if (pendingAction !== 'ready') return;
    setMarking(true);
    setMsg(null);
    try {
      await markStockReady(order.id, { deduct_inventory: deductInventory, updated_by: 'dashboard' });
      setMsg({ ok: true, text: '✅ Stock marked ready — order advanced to Balance Due' });
      setTimeout(() => onUpdated(), 800);
    } catch (err: any) {
      setMsg({ ok: false, text: err.message ?? 'Failed to mark stock ready' });
    } finally {
      setMarking(false);
    }
  }

  async function handleSaveDays() {
    const days = parseInt(daysInput, 10);
    if (isNaN(days) || days < 0) return;
    setSavingDays(true);
    try {
      await setStockPrep(order.id, days);
      setEditingDays(false);
      onUpdated();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message ?? 'Failed to update prep days' });
    } finally {
      setSavingDays(false);
    }
  }

  const readyDate = order.stock_prep_ready_at;
  const isImmediate = (order.stock_prep_days ?? 0) === 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">{order.quotation_number ?? `#${order.id.slice(0, 8)}`}</p>
          <p className="text-xs text-gray-500">{order.client_name ?? 'No client'}</p>
          {order.sales_agent && <p className="text-[10px] text-gray-400">Agent: {order.sales_agent}</p>}
        </div>
        <ReadyBadge readyAt={readyDate} />
      </div>

      {/* Preparation timeline */}
      <div className="rounded-lg bg-lime-50 border border-lime-200 px-3 py-2 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-medium text-lime-700 uppercase tracking-wide">Preparation</p>
            {editingDays ? (
              <div className="flex items-center gap-1 mt-0.5">
                <input
                  type="number" min={0} max={365}
                  value={daysInput}
                  onChange={e => setDaysInput(e.target.value)}
                  className="w-20 rounded border border-lime-400 px-2 py-1 text-xs"
                  autoFocus
                />
                <span className="text-xs text-gray-500">days</span>
                <button onClick={handleSaveDays} disabled={savingDays} className="rounded px-2 py-1 bg-lime-600 text-white text-xs hover:bg-lime-700 disabled:opacity-50">
                  {savingDays ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                </button>
                <button onClick={() => setEditingDays(false)} className="rounded px-2 py-1 bg-gray-100 text-gray-600 text-xs hover:bg-gray-200">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1 mt-0.5">
                <p className="text-sm font-medium text-lime-800">
                  {isImmediate ? '⚡ Immediate' : `${order.stock_prep_days} day(s)`}
                </p>
                <button onClick={() => { setEditingDays(true); setDaysInput(String(order.stock_prep_days ?? 0)); }} className="rounded p-0.5 text-lime-600 hover:bg-lime-100" title="Edit prep days">
                  <Edit2 className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
          {readyDate && !editingDays && (
            <div className="text-right">
              <p className="text-[10px] text-lime-600">Ready by</p>
              <p className="text-xs font-medium text-lime-800">{formatDate(readyDate)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Amount */}
      {order.total_amount != null && (
        <p className="text-xs text-gray-600">
          Total: <span className="font-medium">₱{Number(order.total_amount).toLocaleString()}</span>
          {order.deposit_amount != null && (
            <span className="ml-2 text-gray-400">Deposit: ₱{Number(order.deposit_amount).toLocaleString()}</span>
          )}
        </p>
      )}

      {/* Inventory deduction toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={deductInventory} onChange={e => setDeductInventory(e.target.checked)} className="h-3.5 w-3.5 rounded accent-lime-600" />
        <span className="text-xs text-gray-600">Deduct quantities from inventory when marking ready</span>
      </label>

      {/* Status message */}
      {msg && (
        <p className={`rounded-lg px-3 py-2 text-xs ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {msg.text}
        </p>
      )}

      {/* Mark Ready button */}
      <button
        onClick={handleMarkReady}
        disabled={marking}
        className="w-full rounded-lg bg-lime-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-lime-700 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {marking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
        Mark Stock Ready → Balance Due
      </button>

      <OtpModal
        open={showOtp}
        title="Confirm: Mark Stock Ready"
        description={`Marking stock ready for ${order.quotation_number ?? 'this order'}${deductInventory ? ' and deducting from inventory' : ''}. This will advance the order to Balance Due.`}
        onVerified={handleVerified}
        onClose={() => { setShowOtp(false); setPendingAction(null); }}
      />
    </div>
  );
}

export default function StockPrepPage() {
  const { data: orders, isLoading, mutate } = useOrdersByStage('stock_preparation');

  const stageConfig = STAGE_CONFIG['stock_preparation'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime-100">
            <PackageCheck className="h-5 w-5 text-lime-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Existing Stock Preparation</h1>
            <p className="text-sm text-gray-500">Orders fulfilled from existing inventory — no production needed</p>
          </div>
        </div>
        {orders && orders.length > 0 && (
          <span className="rounded-full bg-lime-100 px-3 py-1 text-sm font-medium text-lime-800">
            {orders.length} order{orders.length !== 1 ? 's' : ''} pending
          </span>
        )}
      </div>

      {/* Stage explanation */}
      <div className="rounded-xl border border-lime-200 bg-lime-50 p-4">
        <h3 className="text-sm font-medium text-lime-800 mb-1">📦 What is Stock Preparation?</h3>
        <p className="text-xs text-lime-700">
          These orders have items available in existing inventory. They skip the full production/purchasing/en-route flow.
          Once the deposit is verified, stock is gathered and prepared for delivery.
          Mark an order as ready when the stock is physically prepared — this advances it to <b>Balance Due</b> for payment collection.
        </p>
      </div>

      {/* Orders */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          <span className="ml-2 text-sm text-gray-500">Loading orders...</span>
        </div>
      ) : !orders || orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <PackageCheck className="h-10 w-10 text-gray-300 mb-3" />
          <p className="text-sm font-medium text-gray-500">No orders in Stock Preparation</p>
          <p className="text-xs text-gray-400 mt-1">From-stock orders will appear here after deposit is verified</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {orders.map(order => (
            <StockPrepCard key={order.id} order={order} onUpdated={() => mutate()} />
          ))}
        </div>
      )}

      {/* Manual input section */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-500" />
          Manual Order Entry
        </h3>
        <p className="text-xs text-gray-500">
          To add an order to Stock Preparation, create it from the <b>Orders</b> page and toggle <b>"Item is from existing stock"</b> before saving.
          After the deposit is verified, the order will automatically appear here.
        </p>
      </div>
    </div>
  );
}
