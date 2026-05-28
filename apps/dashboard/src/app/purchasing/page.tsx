'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useOrdersByStage, useAwaitingDownpayment, useProductionExceptionOrders } from '@/lib/useApi';
import { useAuth } from '@/lib/auth';
import type { Order, OrderItem, ItemCompletion, Client } from '@/lib/api';
import { updateOrder, deleteOrder, recordStageUpdate, getItemCompletion, getOrderItems, verifyDeposit, verifyBalance, updateOrderItem, searchClients, grantProductionException, revokeProductionException, visionExtract, recordDeposit, recordDepositWithFile, payBalanceWithFile, uploadOrderFile } from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import OtpModal from '@/components/OtpModal';
import { QuotationNumberCell, FileViewerModal, useOrderFileViewer } from '@/components/OrderFileViewer';
import {
  ShoppingCart, Clock, Package,
  Pencil, Trash2, X, Check, ChevronDown, ChevronUp,
  AlertTriangle, RefreshCw, CheckCircle,
  Shield, DollarSign, ShieldAlert, Loader2,
  Search, XCircle, Zap, RotateCcw, Calendar, BadgeCheck, BadgeX,
  Upload, FileText, Image,
} from 'lucide-react';

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface OrderRowProps {
  order: Order;
  onEdit: (order: Order) => void;
  onDelete: (order: Order) => void;
  onStartProductionWorkflow?: (order: Order) => void;
  onViewFiles?: (order: Order) => void;
  onVerifyDeposit?: (order: Order) => void;
  onVerifyBalance?: (order: Order) => void;
  onMarkDepositPaid?: (order: Order) => void;
  onGrantSpecialCase?: (order: Order) => void;
  onRevokeException?: (order: Order) => void;
  // Production exception slip uploads
  depositSlipUpload?: { orderId: string | null; file: { name: string; data: string; mime: string; preview: string } | null; extracting: boolean; extractedAmount: string; extractedDate: string; extractedRef: string; extractedNote: string | null };
  onDepositSlipFileSelect?: (e: React.ChangeEvent<HTMLInputElement>, order: Order) => void;
  onUploadDepositSlip?: (order: Order) => void;
  onClearDepositSlip?: () => void;
  onSetDepositSlipField?: (field: string, value: string) => void;
  balanceSlipUpload?: { orderId: string | null; file: { name: string; data: string; mime: string; preview: string } | null; extracting: boolean; extractedAmount: string; extractedDate: string; extractedRef: string; extractedNote: string | null; submitting: boolean };
  onBalanceSlipFileSelect?: (e: React.ChangeEvent<HTMLInputElement>, order: Order) => void;
  onMarkBalancePaid?: (order: Order) => void;
  onClearBalanceSlip?: () => void;
  onSetBalanceSlipField?: (field: string, value: string) => void;
}

function OrderRow({ order, onEdit, onDelete, onStartProductionWorkflow, onViewFiles, onVerifyDeposit, onVerifyBalance, onMarkDepositPaid, onGrantSpecialCase, onRevokeException, depositSlipUpload, onDepositSlipFileSelect, onUploadDepositSlip, onClearDepositSlip, onSetDepositSlipField, balanceSlipUpload, onBalanceSlipFileSelect, onMarkBalancePaid, onClearBalanceSlip, onSetBalanceSlipField }: OrderRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [completion, setCompletion] = useState<ItemCompletion | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getItemCompletion(order.id).then((res) => {
      if (!cancelled && res.ok) setCompletion(res);
    }).catch(() => {});

    if (order.current_stage === 'purchasing_pending') {
      setLoadingItems(true);
      getOrderItems(order.id).then((res) => {
        if (!cancelled && res.ok) setItems(res.items);
        setLoadingItems(false);
      }).catch(() => setLoadingItems(false));
    }
    return () => { cancelled = true; };
  }, [order.id, order.current_stage]);

  async function handleItemProductionStatus(itemId: string, status: 'pending' | 'in_progress' | 'finished') {
    setUpdatingItemId(itemId);
    try {
      await updateOrderItem(order.id, itemId, { production_status: status });
      const res = await getOrderItems(order.id);
      if (res.ok) setItems(res.items);
      const compRes = await getItemCompletion(order.id);
      if (compRes.ok) setCompletion(compRes);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update production status');
    } finally {
      setUpdatingItemId(null);
    }
  }

  // Order stays in this tab until all items are marked produced in the Production tab
  const allItemsProduced = items.length === 0 || (completion !== null && completion.production_completion_pct >= 100);
  const pendingItemCount = items.filter((i) => i.production_status !== 'finished').length;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-gray-50/50"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <QuotationNumberCell order={order} onViewFiles={onViewFiles} />
            {(order.escalation_level ?? 0) > 0 && (
              <span className="flex items-center gap-0.5">
                {Array.from({ length: Math.min(order.escalation_level ?? 0, 3) }).map((_, i) => (
                  <span key={i} className="h-2 w-2 rounded-full bg-red-500" />
                ))}
              </span>
            )}
            {/* Item-level production badges for purchasing_pending */}
            {order.current_stage === 'purchasing_pending' && items.length > 0 && (
              allItemsProduced ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                  <CheckCircle className="h-3 w-3" /> All Produced
                </span>
              ) : (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  completion && completion.production_completion_pct >= 50
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-amber-100 text-amber-700'
                }`}>
                  <Package className="h-3 w-3" />
                  {pendingItemCount} item{pendingItemCount !== 1 ? 's' : ''} pending
                  {completion && completion.production_completion_pct > 0 && ` · ${completion.production_completion_pct}%`}
                </span>
              )
            )}
            {completion && order.current_stage !== 'purchasing_pending' && (
              <>
                {completion.production_completion_pct > 0 && completion.production_completion_pct < 100 && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    completion.production_completion_pct >= 50 ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    <Package className="h-3 w-3" /> Prod: {completion.production_completion_pct}%
                  </span>
                )}
                {completion.production_completion_pct >= 100 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                    <CheckCircle className="h-3 w-3" /> Prod Complete
                  </span>
                )}
              </>
            )}
          </div>
          <p className="truncate text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
          {order.sales_agent && (
            <p className="text-[11px] text-gray-400">{order.sales_agent}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {(() => {
            const days = Math.floor((Date.now() - new Date(order.updated_at).getTime()) / 86_400_000);
            return days > 0 ? (
              <span className={`hidden text-xs sm:inline ${days >= 7 ? 'font-semibold text-red-500' : days >= 3 ? 'text-amber-500' : 'text-gray-400'}`}>
                {days}d
              </span>
            ) : null;
          })()}
          <StageBadge stage={order.current_stage} />
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(order); }}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#2490ef]"
              title="Edit order"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(order); }}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
              title="Delete order"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </button>
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50/50">
          {/* Item production tracking table (purchasing_pending only) */}
          {order.current_stage === 'purchasing_pending' && (
            <div className="px-6 py-3">
              {loadingItems && items.length === 0 ? (
                <div className="flex items-center justify-center py-4">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-[#2490ef]" />
                </div>
              ) : items.length > 0 ? (
                <div className="mb-3">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Items ({items.length}) — mark each as produced before advancing to production
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                          <th className="px-3 py-2">Item</th>
                          <th className="px-3 py-2">Qty</th>
                          <th className="px-3 py-2">Production Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {items.map((item) => (
                          <tr key={item.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-medium text-gray-800">{item.name}</td>
                            <td className="px-3 py-2 text-gray-600">{item.quantity}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1.5">
                                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  item.production_status === 'finished'
                                    ? 'bg-green-100 text-green-700'
                                    : item.production_status === 'in_progress'
                                      ? 'bg-blue-100 text-blue-700'
                                      : 'bg-amber-100 text-amber-700'
                                }`}>
                                  {item.production_status === 'finished' ? '✓ Produced' : item.production_status === 'in_progress' ? '⟳ In Progress' : '○ Pending'}
                                </span>
                                {/* Manual production status buttons — only shown when production has started */}
                                {order.production_started && (
                                  <div className="flex gap-0.5">
                                    {(['pending', 'in_progress', 'finished'] as const).map((s) => (
                                      <button
                                        key={s}
                                        disabled={updatingItemId === item.id || item.production_status === s}
                                        onClick={() => handleItemProductionStatus(item.id, s)}
                                        className={`rounded px-1.5 py-0.5 text-[9px] font-medium transition-colors disabled:opacity-30 ${
                                          item.production_status === s
                                            ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                                            : s === 'finished'
                                              ? 'bg-green-50 text-green-600 hover:bg-green-100'
                                              : s === 'in_progress'
                                                ? 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                                                : 'bg-amber-50 text-amber-600 hover:bg-amber-100'
                                        }`}
                                        title={`Mark as ${s.replace('_', ' ')}`}
                                      >
                                        {updatingItemId === item.id ? '...' : s === 'finished' ? '✓' : s === 'in_progress' ? '⟳' : '○'}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {!order.production_started && (
                                  <span className="text-[9px] text-gray-400 italic">Not started</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Production progress bar */}
                  {completion && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            completion.production_completion_pct >= 100 ? 'bg-green-500' : completion.production_completion_pct >= 50 ? 'bg-amber-500' : 'bg-gray-400'
                          }`}
                          style={{ width: `${Math.min(completion.production_completion_pct, 100)}%` }}
                        />
                      </div>
                      <span className={`text-xs font-semibold ${
                        completion.production_completion_pct >= 100 ? 'text-green-600' : completion.production_completion_pct >= 50 ? 'text-amber-600' : 'text-gray-500'
                      }`}>
                        {completion.production_completion_pct}%
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">No items on record — you can advance to production directly.</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-white px-6 py-3">
            {onMarkDepositPaid && !order.deposit_paid && (
              <button
                onClick={() => onMarkDepositPaid(order)}
                className="rounded-lg bg-pink-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-pink-700"
              >
                <DollarSign className="mr-1 inline-block h-3.5 w-3.5" />
                Mark Deposit Paid
              </button>
            )}
            {onVerifyDeposit && order.deposit_paid && !order.deposit_verified && (
              <button
                onClick={() => onVerifyDeposit(order)}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700"
              >
                <Shield className="mr-1 inline-block h-3.5 w-3.5" />
                Verify Deposit
              </button>
            )}
            {onVerifyBalance && order.balance_paid && !order.balance_verified && (
              <button
                onClick={() => onVerifyBalance(order)}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                <Shield className="mr-1 inline-block h-3.5 w-3.5" />
                Verify Balance
              </button>
            )}
            {/* Workflow acknowledgement only: actual production start is handled later in the Production tab. */}
            {onStartProductionWorkflow && !order.production_started && (
              <button
                onClick={() => onStartProductionWorkflow(order)}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                Start Production Workflow
              </button>
            )}
            {/* Special Case — allow production before downpayment */}
            {onGrantSpecialCase && !order.production_exception && (
              <button
                onClick={() => onGrantSpecialCase(order)}
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                <Zap className="mr-1 inline-block h-3.5 w-3.5 text-amber-600" />
                Special Case
              </button>
            )}
            {/* Revoke Exception */}
            {onRevokeException && order.production_exception && (
              <button
                onClick={() => onRevokeException(order)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                <RotateCcw className="mr-1 inline-block h-3.5 w-3.5" />
                Revoke Exception
              </button>
            )}

            <span className="self-center text-xs text-gray-500">
              Downpayment: {order.deposit_paid ? `Paid${order.deposit_amount ? ` ₱${Number(order.deposit_amount).toLocaleString()}` : ''}` : 'Pending'}
              {' · '}
              Balance: {order.balance_paid ? 'Paid' : 'Pending'}
            </span>
          </div>

          {/* Production Exception tracking panel — shows full payment & delivery trail */}
          {order.production_exception && (
            <div className="border-t border-amber-100 bg-amber-50/40 px-6 py-4">
              {order.production_exception_notes && (
                <p className="mb-3 text-xs text-amber-800">
                  <span className="font-semibold">Exception reason:</span> {order.production_exception_notes}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
                {/* Downpayment */}
                <div className="rounded-lg bg-white p-2.5 shadow-sm">
                  <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    <DollarSign className="h-3 w-3 text-pink-500" /> Downpayment
                  </span>
                  <p className={`mt-1 font-semibold ${order.deposit_paid ? 'text-green-600' : 'text-red-500'}`}>
                    {order.deposit_paid
                      ? `Paid${order.deposit_amount ? ` ₱${Number(order.deposit_amount).toLocaleString()}` : ''}`
                      : 'Not Paid'}
                  </p>
                </div>
                {/* DP Date */}
                <div className="rounded-lg bg-white p-2.5 shadow-sm">
                  <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    <Calendar className="h-3 w-3 text-pink-400" /> DP Date
                  </span>
                  <p className="mt-1 font-semibold text-gray-700">{fmtDate(order.deposit_paid_at)}</p>
                </div>
                {/* DP Verification */}
                <div className="rounded-lg bg-white p-2.5 shadow-sm">
                  <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    {order.deposit_verified
                      ? <BadgeCheck className="h-3 w-3 text-green-500" />
                      : <BadgeX className="h-3 w-3 text-red-400" />}
                    DP Verified
                  </span>
                  <p className={`mt-1 font-semibold ${order.deposit_verified ? 'text-green-600' : 'text-red-500'}`}>
                    {order.deposit_verified ? fmtDate(order.deposit_verified_at) : 'Pending'}
                  </p>
                </div>
                {/* Balance */}
                <div className="rounded-lg bg-white p-2.5 shadow-sm">
                  <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    <DollarSign className="h-3 w-3 text-indigo-500" /> Balance
                  </span>
                  <p className={`mt-1 font-semibold ${order.balance_paid ? 'text-green-600' : 'text-amber-600'}`}>
                    {order.balance_paid ? 'Paid' : 'Pending'}
                  </p>
                </div>
                {/* Balance Date */}
                <div className="rounded-lg bg-white p-2.5 shadow-sm">
                  <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    <Calendar className="h-3 w-3 text-indigo-400" /> Balance Date
                  </span>
                  <p className="mt-1 font-semibold text-gray-700">{fmtDate(order.balance_paid_at)}</p>
                </div>
                {/* Balance Verification */}
                <div className="rounded-lg bg-white p-2.5 shadow-sm">
                  <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    {order.balance_verified
                      ? <BadgeCheck className="h-3 w-3 text-green-500" />
                      : <BadgeX className="h-3 w-3 text-gray-400" />}
                    Bal. Verified
                  </span>
                  <p className={`mt-1 font-semibold ${order.balance_verified ? 'text-green-600' : 'text-gray-500'}`}>
                    {order.balance_verified ? fmtDate(order.balance_verified_at) : 'Pending'}
                  </p>
                </div>
                {/* Delivery Date */}
                {(order.delivery_date || order.current_stage === 'completed') && (
                  <div className="rounded-lg bg-white p-2.5 shadow-sm">
                    <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                      <Calendar className="h-3 w-3 text-sky-500" /> Delivery
                    </span>
                    <p className="mt-1 font-semibold text-gray-700">{fmtDate(order.delivery_date)}</p>
                  </div>
                )}
              </div>

              {/* Deposit slip upload */}
              {!order.deposit_paid && onDepositSlipFileSelect && (
                <div className="mt-3 rounded-lg border border-dashed border-pink-200 bg-pink-50/50 p-3">
                  <p className="mb-2 text-[11px] font-medium text-pink-700">Upload Deposit Slip (optional)</p>
                  {depositSlipUpload?.orderId === order.id && depositSlipUpload?.file ? (
                    <div className="space-y-2">
                      {depositSlipUpload.extracting ? (
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          AI extracting payment details...
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {depositSlipUpload.extractedNote && (
                            <p className="text-[11px] italic text-gray-500">{depositSlipUpload.extractedNote}</p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <input
                              type="text" placeholder="Amount"
                              value={depositSlipUpload.extractedAmount}
                              onChange={(e) => onSetDepositSlipField?.('extractedAmount', e.target.value)}
                              className="w-24 rounded border border-gray-300 px-2 py-1 text-xs outline-none"
                            />
                            <input
                              type="date" placeholder="Date"
                              value={depositSlipUpload.extractedDate}
                              onChange={(e) => onSetDepositSlipField?.('extractedDate', e.target.value)}
                              className="w-36 rounded border border-gray-300 px-2 py-1 text-xs outline-none"
                            />
                            <input
                              type="text" placeholder="Reference"
                              value={depositSlipUpload.extractedRef}
                              onChange={(e) => onSetDepositSlipField?.('extractedRef', e.target.value)}
                              className="w-28 rounded border border-gray-300 px-2 py-1 text-xs outline-none"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => onUploadDepositSlip?.(order)}
                              className="rounded bg-pink-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-pink-700"
                            >
                              <Upload className="mr-1 inline-block h-3 w-3" />Upload & Record
                            </button>
                            <button
                              onClick={() => onClearDepositSlip?.()}
                              className="rounded bg-gray-200 px-3 py-1 text-[11px] text-gray-600 hover:bg-gray-300"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded bg-white px-3 py-1.5 text-[11px] font-medium text-pink-700 shadow-sm hover:bg-pink-50">
                      <Upload className="h-3.5 w-3.5" />
                      Choose file
                      <input
                        type="file" accept="image/*"
                        onChange={(e) => onDepositSlipFileSelect(e, order)}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>
              )}

              {/* Balance slip upload + Mark Balance Paid */}
              {!order.balance_paid && onBalanceSlipFileSelect && (
                <div className="mt-3 rounded-lg border border-dashed border-indigo-200 bg-indigo-50/50 p-3">
                  <p className="mb-2 text-[11px] font-medium text-indigo-700">Mark Balance Paid (optional upload)</p>
                  {balanceSlipUpload?.orderId === order.id && balanceSlipUpload?.file ? (
                    <div className="space-y-2">
                      {balanceSlipUpload.extracting ? (
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          AI extracting payment details...
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {balanceSlipUpload.extractedNote && (
                            <p className="text-[11px] italic text-gray-500">{balanceSlipUpload.extractedNote}</p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <input
                              type="text" placeholder="Amount"
                              value={balanceSlipUpload.extractedAmount}
                              onChange={(e) => onSetBalanceSlipField?.('extractedAmount', e.target.value)}
                              className="w-24 rounded border border-gray-300 px-2 py-1 text-xs outline-none"
                            />
                            <input
                              type="date" placeholder="Date"
                              value={balanceSlipUpload.extractedDate}
                              onChange={(e) => onSetBalanceSlipField?.('extractedDate', e.target.value)}
                              className="w-36 rounded border border-gray-300 px-2 py-1 text-xs outline-none"
                            />
                            <input
                              type="text" placeholder="Reference"
                              value={balanceSlipUpload.extractedRef}
                              onChange={(e) => onSetBalanceSlipField?.('extractedRef', e.target.value)}
                              className="w-28 rounded border border-gray-300 px-2 py-1 text-xs outline-none"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => onMarkBalancePaid?.(order)}
                              disabled={balanceSlipUpload.submitting}
                              className="rounded bg-indigo-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                            >
                              {balanceSlipUpload.submitting ? (
                                <><Loader2 className="mr-1 inline-block h-3 w-3 animate-spin" />Submitting...</>
                              ) : (
                                <><DollarSign className="mr-1 inline-block h-3 w-3" />Mark Balance Paid</>
                              )}
                            </button>
                            <button
                              onClick={() => onClearBalanceSlip?.()}
                              className="rounded bg-gray-200 px-3 py-1 text-[11px] text-gray-600 hover:bg-gray-300"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded bg-white px-3 py-1.5 text-[11px] font-medium text-indigo-700 shadow-sm hover:bg-indigo-50">
                        <Upload className="h-3.5 w-3.5" />
                        Upload slip
                        <input
                          type="file" accept="image/*"
                          onChange={(e) => onBalanceSlipFileSelect(e, order)}
                          className="hidden"
                        />
                      </label>
                      <span className="text-[11px] text-gray-400">or</span>
                      <button
                        onClick={() => onMarkBalancePaid?.(order)}
                        className="rounded bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-700"
                      >
                        <DollarSign className="mr-1 inline-block h-3 w-3" />Mark Balance Paid (no slip)
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface EditFormProps {
  order: Order;
  onSave: (data: { client_name?: string; sales_agent?: string; total_amount?: number; quotation_number?: string }) => void;
  onCancel: () => void;
  saving: boolean;
}

function EditForm({ order, onSave, onCancel, saving }: EditFormProps) {
  const [clientName, setClientName] = useState(order.client_name ?? '');
  const [salesAgent, setSalesAgent] = useState(order.sales_agent ?? '');
  const [totalAmount, setTotalAmount] = useState(order.total_amount?.toString() ?? '');
  const [quotationNumber, setQuotationNumber] = useState(order.quotation_number ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const data: { client_name?: string; sales_agent?: string; total_amount?: number; quotation_number?: string } = {};
    if (clientName.trim()) data.client_name = clientName.trim();
    if (salesAgent.trim()) data.sales_agent = salesAgent.trim();
    if (totalAmount.trim()) data.total_amount = Number(totalAmount.replace(/,/g, ''));
    if (quotationNumber.trim()) data.quotation_number = quotationNumber.trim();
    onSave(data);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2 px-6 py-3 bg-blue-50/50">
      <input value={quotationNumber} onChange={(e) => setQuotationNumber(e.target.value)} placeholder="Quotation #"
        className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20" />
      <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client name"
        className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20" />
      <input value={salesAgent} onChange={(e) => setSalesAgent(e.target.value)} placeholder="Sales agent"
        className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20" />
      <input value={totalAmount} onChange={(e) => setTotalAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Amount"
        className="w-28 rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20" />
      <button type="submit" disabled={saving}
        className="rounded-lg bg-[#2490ef] p-1.5 text-white hover:bg-[#1a7ad9] disabled:opacity-50" title="Save">
        <Check className="h-4 w-4" />
      </button>
      <button type="button" onClick={onCancel}
        className="rounded-lg bg-gray-200 p-1.5 text-gray-600 hover:bg-gray-300" title="Cancel">
        <X className="h-4 w-4" />
      </button>
    </form>
  );
}

function OrderSection({
  icon, title, count, countBg, countText, orders, isLoading, error, onRetry, emptyText, children,
}: {
  icon: React.ReactNode; title: string; count: number; countBg: string; countText: string;
  orders: Order[]; isLoading: boolean; error?: Error; onRetry?: () => void;
  emptyText: string; children: (order: Order) => React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
        {icon}
        <h2 className="text-base font-semibold text-gray-800">{title}</h2>
        <span className={`ml-auto rounded-full ${countBg} px-2 py-0.5 text-xs font-medium ${countText}`}>{count}</span>
      </div>
      {isLoading && orders.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-12">
          <AlertTriangle className="h-8 w-8 text-red-400" />
          <p className="text-sm text-red-500">Failed to load: {error.message}</p>
          {onRetry && (
            <button onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2490ef] px-4 py-2 text-xs font-medium text-white hover:bg-[#1a7ad9]">
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          )}
        </div>
      ) : orders.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">{emptyText}</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {orders.map((order) => <div key={order.id}>{children(order)}</div>)}
        </div>
      )}
    </div>
  );
}

export default function PurchasingPage() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user && user.role !== 'admin') {
      router.replace('/');
    }
  }, [user, router]);

  if (!user || user.role !== 'admin') {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    );
  }

  const { data: pendingOrders = [], isLoading: loadingPending, error: errorPending, mutate: mutatePending } =
    useOrdersByStage('purchasing_pending');
  // Awaiting downpayment: covers quotation_received, order_confirmation_received, math_verified, deposit_pending
  const { data: depositPendingOrders = [], isLoading: loadingDepositPending, error: errorDepositPending, mutate: mutateDepositPending } =
    useAwaitingDownpayment();
  const { data: depositVerificationOrders = [], isLoading: loadingDepositVerification, error: errorDepositVerification, mutate: mutateDepositVerification } =
    useOrdersByStage('deposit_verification');
  // Production Exception: all orders with exception flag, shown until 60 days post-delivery
  const { data: exceptionOrders = [], isLoading: loadingExceptions, error: errorExceptions, mutate: mutateExceptions } =
    useProductionExceptionOrders();

  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingOrder, setDeletingOrder] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [verifyingDepositOrder, setVerifyingDepositOrder] = useState<Order | null>(null);
  const [verifyingDeposit, setVerifyingDeposit] = useState(false);
  const [verifyingBalanceOrder, setVerifyingBalanceOrder] = useState<Order | null>(null);
  const [verifyingBalance, setVerifyingBalance] = useState(false);
  const [otpModal, setOtpModal] = useState<{
    open: boolean; title: string; description: string;
    pendingAction: 'edit' | 'delete' | 'startProductionWorkflow' | 'verifyDeposit' | 'verifyBalance' | 'markDepositPaid' | 'grantProductionException' | 'revokeProductionException' | 'markBalancePaid';
  }>({ open: false, title: '', description: '', pendingAction: 'edit' });

  // ── Deposit slip upload (production exception section) ──────────────
  const [depositSlipUpload, setDepositSlipUpload] = useState<{
    orderId: string | null;
    file: { name: string; data: string; mime: string; preview: string } | null;
    extracting: boolean;
    extractedAmount: string;
    extractedDate: string;
    extractedRef: string;
    extractedNote: string | null;
  }>({ orderId: null, file: null, extracting: false, extractedAmount: '', extractedDate: '', extractedRef: '', extractedNote: null });

  // ── Balance slip upload (production exception section) ──────────────
  const [balanceSlipUpload, setBalanceSlipUpload] = useState<{
    orderId: string | null;
    file: { name: string; data: string; mime: string; preview: string } | null;
    extracting: boolean;
    extractedAmount: string;
    extractedDate: string;
    extractedRef: string;
    extractedNote: string | null;
    submitting: boolean;
  }>({ orderId: null, file: null, extracting: false, extractedAmount: '', extractedDate: '', extractedRef: '', extractedNote: null, submitting: false });

  const { viewingFilesOrder, orderFiles, handleViewFiles, refreshFiles, closeViewer } = useOrderFileViewer();

  // ── Client filter ──────────────────────────────────────────────────────
  const [clientFilter, setClientFilter] = useState('');
  const [clientSuggestions, setClientSuggestions] = useState<Client[]>([]);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [searchingClient, setSearchingClient] = useState(false);
  const clientFilterRef = useRef<HTMLDivElement>(null);
  const clientFilterInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (clientFilterRef.current && !clientFilterRef.current.contains(e.target as Node) &&
          clientFilterInputRef.current && !clientFilterInputRef.current.contains(e.target as Node)) {
        setShowClientDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleClientFilterSearch = useCallback(async (q: string) => {
    setClientFilter(q);
    const trimmed = q.trim();
    if (!trimmed) { setClientSuggestions([]); setShowClientDropdown(false); return; }
    setSearchingClient(true);
    try {
      const results = await searchClients(trimmed);
      setClientSuggestions(results);
      setShowClientDropdown(results.length > 0);
    } catch { setClientSuggestions([]); }
    finally { setSearchingClient(false); }
  }, []);

  function selectClientFilter(name: string) {
    setClientFilter(name);
    setShowClientDropdown(false);
    setClientSuggestions([]);
  }

  function clearClientFilter() {
    setClientFilter('');
    setClientSuggestions([]);
    setShowClientDropdown(false);
  }

  function filterByClient(orders: Order[]): Order[] {
    if (!clientFilter.trim()) return orders;
    return orders.filter(o =>
      o.client_name?.toLowerCase().includes(clientFilter.trim().toLowerCase())
    );
  }

  function refresh() {
    mutatePending();
    mutateDepositPending();
    mutateDepositVerification();
    mutateExceptions();
  }

  async function handleEditVerified(actionToken: string) {
    const pending = (window as any).__pendingEditData;
    if (!pending) return;
    setSaving(true);
    try {
      await updateOrder(pending.orderId, { ...pending.data, action_token: actionToken });
      setEditingOrder(null);
      refresh();
    } catch (err: any) {
      alert('Failed to update order: ' + (err.message ?? 'Unknown error'));
    } finally {
      setSaving(false);
      (window as any).__pendingEditData = null;
    }
  }

  async function handleDeleteVerified(actionToken: string) {
    if (!deletingOrder) return;
    setDeleting(true);
    try {
      await deleteOrder(deletingOrder.id, actionToken);
      setDeletingOrder(null);
      refresh();
    } catch (err: any) {
      alert('Failed to delete order: ' + (err.message ?? 'Unknown error'));
    } finally {
      setDeleting(false);
    }
  }

  function handleOtpVerified(actionToken: string) {
    if (otpModal.pendingAction === 'edit') handleEditVerified(actionToken);
    else if (otpModal.pendingAction === 'delete') handleDeleteVerified(actionToken);
    else if (otpModal.pendingAction === 'startProductionWorkflow') handleStartProductionWorkflowVerified(actionToken);
    else if (otpModal.pendingAction === 'verifyDeposit') handleVerifyDepositVerified(actionToken);
    else if (otpModal.pendingAction === 'verifyBalance') handleVerifyBalanceVerified(actionToken);
    else if (otpModal.pendingAction === 'markDepositPaid') handleMarkDepositPaidVerified(actionToken);
    else if (otpModal.pendingAction === 'grantProductionException') handleGrantProductionExceptionVerified(actionToken);
    else if (otpModal.pendingAction === 'revokeProductionException') handleRevokeProductionExceptionVerified(actionToken);
    else if (otpModal.pendingAction === 'markBalancePaid') handleMarkBalancePaidVerified(actionToken);
  }

  async function handleMarkDepositPaidVerified(actionToken: string) {
    const pending = (window as any).__pendingMarkDepositPaidData as { order: Order } | undefined;
    if (!pending) return;
    try {
      // Use recordDeposit instead of recordStageUpdate so the deposit amount
      // is recorded in the payments table and Telegram notifications are sent
      await recordDeposit({
        quotation_number: pending.order.quotation_number ?? '',
        amount: Number(pending.order.total_amount ?? 0),
        action_token: actionToken,
      });
      refresh();
    } catch (err: any) {
      alert('Failed to record deposit: ' + (err.message ?? 'Unknown error'));
    } finally {
      (window as any).__pendingMarkDepositPaidData = null;
    }
  }

  async function handleStartProductionWorkflowVerified(actionToken: string) {
    const pending = (window as any).__pendingStartProductionWorkflowData;
    if (!pending) return;
    try {
      await recordStageUpdate({
        quotation_number: pending.quotationNumber,
        stage: 'production_pending',
        status: 'workflow_started',
        remarks: 'Production workflow acknowledged from dashboard; actual production has not started yet.',
        action_token: actionToken,
      });
      refresh();
    } catch (err: any) {
      alert('Failed to start production workflow: ' + (err.message ?? 'Unknown error'));
    } finally {
      (window as any).__pendingStartProductionWorkflowData = null;
    }
  }

  async function handleVerifyDepositVerified(actionToken: string) {
    if (!verifyingDepositOrder) return;
    setVerifyingDeposit(true);
    try {
      const res = await verifyDeposit(verifyingDepositOrder.id, {
        verified_by: 'dashboard',
        action_token: actionToken,
      });
      if (res.ok) {
        alert(`✅ Deposit verified! Advancing to ${res.next_stage?.replace(/_/g, ' ') ?? 'next stage'}.`);
        setVerifyingDepositOrder(null);
        refresh();
      } else {
        alert('Failed to verify deposit.');
      }
    } catch (err: any) {
      alert('Failed to verify deposit: ' + (err.message ?? 'Unknown error'));
    } finally {
      setVerifyingDeposit(false);
    }
  }

  function handleEdit(order: Order) { setEditingOrder(order); }
  function handleCancelEdit() { setEditingOrder(null); }

  function handleEditSave(data: { client_name?: string; sales_agent?: string; total_amount?: number; quotation_number?: string }) {
    if (!editingOrder) return;
    setOtpModal({ open: true, title: 'Edit Order',
      description: `You are about to edit order "${editingOrder.quotation_number ?? '—'}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'edit' });
    (window as any).__pendingEditData = { orderId: editingOrder.id, data };
  }

  function handleDeleteClick(order: Order) {
    setDeletingOrder(order);
    setOtpModal({ open: true, title: 'Delete Order',
      description: `You are about to permanently delete order "${order.quotation_number ?? '—'}". This will also remove all stage updates, files, and reminders. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'delete' });
  }

  async function handleStartProductionWorkflow(order: Order) {
    if (!order.quotation_number) { alert('Cannot start production workflow: quotation number is missing.'); return; }
    setOtpModal({ open: true, title: 'Start Production Workflow',
      description: `You are about to move order "${order.quotation_number}" to Production Pending. This only acknowledges the production team workflow; it does not mark actual production as started. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'startProductionWorkflow' });
    (window as any).__pendingStartProductionWorkflowData = { orderId: order.id, quotationNumber: order.quotation_number };
  }

  function handleVerifyDeposit(order: Order) {
    setVerifyingDepositOrder(order);
    setOtpModal({ open: true, title: 'Verify Deposit',
      description: `You are about to verify the downpayment for order "${order.quotation_number ?? '—'}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'verifyDeposit' });
  }

  function handleVerifyBalance(order: Order) {
    setVerifyingBalanceOrder(order);
    setOtpModal({ open: true, title: 'Verify Balance Payment',
      description: `You are about to verify the balance payment for order "${order.quotation_number ?? '—'}". This will advance the order to the next stage and send Telegram notifications.`,
      pendingAction: 'verifyBalance' });
  }

  async function handleVerifyBalanceVerified(actionToken: string) {
    if (!verifyingBalanceOrder) return;
    setVerifyingBalance(true);
    try {
      const res = await verifyBalance(verifyingBalanceOrder.id, {
        verified_by: 'dashboard',
        action_token: actionToken,
      });
      if (res.ok) {
        alert(`✅ Balance verified! Advancing to ${res.next_stage?.replace(/_/g, ' ') ?? 'next stage'}.`);
        setVerifyingBalanceOrder(null);
        refresh();
      } else {
        alert('Failed to verify balance.');
      }
    } catch (err: any) {
      alert('Failed to verify balance: ' + (err.message ?? 'Unknown error'));
    } finally {
      setVerifyingBalance(false);
    }
  }

  function handleMarkDepositPaid(order: Order) {
    setOtpModal({ open: true, title: 'Mark Deposit Paid',
      description: `You are about to mark deposit as paid for order "${order.quotation_number ?? '—'}". This will advance the order to Deposit Verification. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'markDepositPaid' });
    (window as any).__pendingMarkDepositPaidData = { order };
  }

  // ── Special Case (Production Exception) ─────────────────────────────

  function handleGrantSpecialCase(order: Order) {
    const reason = window.prompt(
      `Enter reason for Special Case — "${order.quotation_number ?? order.id}":\n(Production will be allowed to start before downpayment is received.)`
    );
    if (!reason || !reason.trim()) return;
    setOtpModal({
      open: true,
      title: 'Grant Special Case',
      description: `You are granting a production exception for "${order.quotation_number ?? '—'}". Reason: "${reason.trim()}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'grantProductionException',
    });
    (window as any).__pendingGrantExceptionData = { order, reason: reason.trim() };
  }

  async function handleGrantProductionExceptionVerified(actionToken: string) {
    const pending = (window as any).__pendingGrantExceptionData as { order: Order; reason: string } | null;
    if (!pending) return;
    try {
      await grantProductionException(pending.order.id, {
        notes: pending.reason,
        granted_by: 'dashboard',
        action_token: actionToken,
      });
      refresh();
    } catch (err: any) {
      alert('Failed to grant exception: ' + (err.message ?? 'Unknown error'));
    } finally {
      (window as any).__pendingGrantExceptionData = null;
    }
  }

  // ── Deposit slip upload (production exception) ──────────────────────
  function handleDepositSlipFileSelect(e: React.ChangeEvent<HTMLInputElement>, order: Order) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      const commaIndex = result.indexOf(',');
      const base64 = commaIndex !== -1 ? result.substring(commaIndex + 1) : result;
      const mime = file.type || 'image/jpeg';
      setDepositSlipUpload({
        orderId: order.id,
        file: { name: file.name, data: base64, mime, preview: result },
        extracting: true,
        extractedAmount: '',
        extractedDate: '',
        extractedRef: '',
        extractedNote: null,
      });
      // AI extract
      visionExtract({ image_base64: base64, mime_type: mime, mode: 'payment' }).then((res) => {
        const payment = res.payment;
        const updates: string[] = [];
        const patch: any = { extracting: false };
        if (payment?.amount && Number(payment.amount) > 0) {
          patch.extractedAmount = String(payment.amount);
          updates.push(`amount ₱${Number(payment.amount).toLocaleString()}`);
        }
        if (payment?.payment_date) {
          patch.extractedDate = payment.payment_date.slice(0, 10);
          updates.push(`date ${payment.payment_date.slice(0, 10)}`);
        }
        if (payment?.reference_number) {
          patch.extractedRef = payment.reference_number;
          updates.push(`ref ${payment.reference_number}`);
        }
        patch.extractedNote = updates.length
          ? `AI extracted ${updates.join(', ')}.`
          : 'AI could not find fields. Enter manually.';
        setDepositSlipUpload((prev) => ({ ...prev, ...patch }));
      }).catch(() => {
        setDepositSlipUpload((prev) => ({ ...prev, extracting: false, extractedNote: 'AI extraction failed. Enter manually.' }));
      });
    };
    reader.readAsDataURL(file);
  }

  async function handleUploadDepositSlip(order: Order) {
    if (!depositSlipUpload.file) return;
    try {
      const amount = Number(depositSlipUpload.extractedAmount) || 0;
      await recordDepositWithFile({
        quotation_number: order.quotation_number ?? '',
        amount,
        deposit_paid_at: depositSlipUpload.extractedDate || undefined,
        image_base64: depositSlipUpload.file.data,
        mime_type: depositSlipUpload.file.mime,
        original_filename: depositSlipUpload.file.name,
      });
      alert('✅ Deposit slip uploaded and recorded.');
      setDepositSlipUpload({ orderId: null, file: null, extracting: false, extractedAmount: '', extractedDate: '', extractedRef: '', extractedNote: null });
      refresh();
    } catch (err: any) {
      alert('Failed to upload deposit slip: ' + (err.message ?? 'Unknown error'));
    }
  }

  // ── Balance slip upload (production exception) ──────────────────────
  function handleBalanceSlipFileSelect(e: React.ChangeEvent<HTMLInputElement>, order: Order) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      const commaIndex = result.indexOf(',');
      const base64 = commaIndex !== -1 ? result.substring(commaIndex + 1) : result;
      const mime = file.type || 'image/jpeg';
      setBalanceSlipUpload({
        orderId: order.id,
        file: { name: file.name, data: base64, mime, preview: result },
        extracting: true,
        extractedAmount: '',
        extractedDate: '',
        extractedRef: '',
        extractedNote: null,
        submitting: false,
      });
      // AI extract
      visionExtract({ image_base64: base64, mime_type: mime, mode: 'payment' }).then((res) => {
        const payment = res.payment;
        const updates: string[] = [];
        const patch: any = { extracting: false };
        if (payment?.amount && Number(payment.amount) > 0) {
          patch.extractedAmount = String(payment.amount);
          updates.push(`amount ₱${Number(payment.amount).toLocaleString()}`);
        }
        if (payment?.payment_date) {
          patch.extractedDate = payment.payment_date.slice(0, 10);
          updates.push(`date ${payment.payment_date.slice(0, 10)}`);
        }
        if (payment?.reference_number) {
          patch.extractedRef = payment.reference_number;
          updates.push(`ref ${payment.reference_number}`);
        }
        patch.extractedNote = updates.length
          ? `AI extracted ${updates.join(', ')}.`
          : 'AI could not find fields. Enter manually.';
        setBalanceSlipUpload((prev) => ({ ...prev, ...patch }));
      }).catch(() => {
        setBalanceSlipUpload((prev) => ({ ...prev, extracting: false, extractedNote: 'AI extraction failed. Enter manually.' }));
      });
    };
    reader.readAsDataURL(file);
  }

  function handleMarkBalancePaid(order: Order) {
    setOtpModal({
      open: true,
      title: 'Mark Balance Paid',
      description: `You are about to mark balance as paid for "${order.quotation_number ?? '—'}". This will record the balance payment. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'markBalancePaid',
    });
    (window as any).__pendingMarkBalancePaidData = { order };
  }

  async function handleMarkBalancePaidVerified(actionToken: string) {
    const pending = (window as any).__pendingMarkBalancePaidData as { order: Order } | null;
    if (!pending) return;
    const order = pending.order;
    setBalanceSlipUpload((prev) => ({ ...prev, submitting: true }));
    try {
      // Use payBalanceWithFile instead of recordStageUpdate so the balance amount
      // is recorded in the payments table and Telegram notifications are sent
      const amount = Number(balanceSlipUpload.extractedAmount) || Number(order.total_amount ?? 0);
      await payBalanceWithFile({
        quotation_number: order.quotation_number ?? '',
        amount,
        payment_date: balanceSlipUpload.extractedDate || undefined,
        reference_number: balanceSlipUpload.extractedRef || undefined,
        image_base64: balanceSlipUpload.file?.data,
        mime_type: balanceSlipUpload.file?.mime,
        original_filename: balanceSlipUpload.file?.name,
        action_token: actionToken,
      });
      setBalanceSlipUpload({ orderId: null, file: null, extracting: false, extractedAmount: '', extractedDate: '', extractedRef: '', extractedNote: null, submitting: false });
      refresh();
    } catch (err: any) {
      alert('Failed to record balance payment: ' + (err.message ?? 'Unknown error'));
      setBalanceSlipUpload((prev) => ({ ...prev, submitting: false }));
    } finally {
      (window as any).__pendingMarkBalancePaidData = null;
    }
  }

  function handleRevokeException(order: Order) {
    setOtpModal({
      open: true,
      title: 'Revoke Production Exception',
      description: `You are about to revoke the production exception for "${order.quotation_number ?? '—'}". The order will return to the normal downpayment-required flow. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'revokeProductionException',
    });
    (window as any).__pendingRevokeExceptionData = { order };
  }

  async function handleRevokeProductionExceptionVerified(actionToken: string) {
    const pending = (window as any).__pendingRevokeExceptionData as { order: Order } | null;
    if (!pending) return;
    try {
      await revokeProductionException(pending.order.id, actionToken);
      refresh();
    } catch (err: any) {
      alert('Failed to revoke exception: ' + (err.message ?? 'Unknown error'));
    } finally {
      (window as any).__pendingRevokeExceptionData = null;
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <ShoppingCart className="mt-0.5 h-5 w-5 text-amber-600" />
            <div>
              <h3 className="text-sm font-semibold text-amber-800">Purchasing Workflow</h3>
              <p className="mt-1 text-xs text-amber-700">
                Orders flow through: Downpayment Pending → Deposit Verification → Purchasing → Production.
                Once production starts, the order moves to the{' '}
                <strong>Production</strong> tab. Once en route is confirmed, the order moves to the{' '}
                <strong>Delivery</strong> tab for balance payment and delivery scheduling.
              </p>
            </div>
          </div>
          {/* Client filter */}
          <div className="relative shrink-0" ref={clientFilterRef}>
            <div className="flex items-center gap-1 rounded-lg border border-amber-200 bg-white px-2 py-1.5">
              <Search className="h-3.5 w-3.5 text-gray-400" />
              <input
                ref={clientFilterInputRef}
                type="text"
                placeholder="Filter by client..."
                value={clientFilter}
                onChange={(e) => handleClientFilterSearch(e.target.value)}
                onFocus={() => { if (clientSuggestions.length > 0) setShowClientDropdown(true); }}
                className="w-36 text-xs outline-none bg-transparent text-gray-700 placeholder-gray-400"
              />
              {clientFilter && (
                <button onClick={clearClientFilter} className="text-gray-400 hover:text-gray-600">
                  <XCircle className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {showClientDropdown && (
              <div className="absolute right-0 z-50 mt-1 w-64 rounded-lg border border-gray-200 bg-white shadow-lg">
                {searchingClient ? (
                  <div className="flex items-center justify-center py-3">
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                  </div>
                ) : (
                  <ul className="max-h-48 overflow-auto py-1">
                    {clientSuggestions.map((c) => (
                      <li key={c.id}>
                        <button
                          onClick={() => selectClientFilter(c.client_name)}
                          className="w-full px-3 py-2 text-left text-xs hover:bg-amber-50"
                        >
                          <span className="font-medium text-gray-800">{c.client_name}</span>
                          {c.order_count != null && (
                            <span className="ml-2 text-gray-400">{c.order_count} orders</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Downpayment Pending */}
      <OrderSection
        icon={<DollarSign className="h-4 w-4 text-pink-500" />}
        title="Downpayment Pending"
        count={filterByClient(depositPendingOrders).length}
        countBg="bg-pink-100" countText="text-pink-700"
        orders={filterByClient(depositPendingOrders)} isLoading={loadingDepositPending} error={errorDepositPending}
        onRetry={() => mutateDepositPending()}
        emptyText="No orders awaiting downpayment"
      >
        {(order) => (
          <>
            <OrderRow
              order={order} onEdit={handleEdit} onDelete={handleDeleteClick}
              onMarkDepositPaid={handleMarkDepositPaid}
              onGrantSpecialCase={handleGrantSpecialCase}
              onViewFiles={handleViewFiles}
            />
            {editingOrder?.id === order.id && (
              <EditForm order={order} onSave={handleEditSave} onCancel={handleCancelEdit} saving={saving} />
            )}
          </>
        )}
      </OrderSection>

      {/* Deposit Verification */}
      <OrderSection
        icon={<Shield className="h-4 w-4 text-rose-500" />}
        title="Deposit Verification"
        count={filterByClient(depositVerificationOrders).length}
        countBg="bg-rose-100" countText="text-rose-700"
        orders={filterByClient(depositVerificationOrders)} isLoading={loadingDepositVerification} error={errorDepositVerification}
        onRetry={() => mutateDepositVerification()}
        emptyText="No orders awaiting deposit verification"
      >
        {(order) => (
          <>
            <OrderRow order={order} onEdit={handleEdit} onDelete={handleDeleteClick} onVerifyDeposit={handleVerifyDeposit} onViewFiles={handleViewFiles} />
            {editingOrder?.id === order.id && (
              <EditForm order={order} onSave={handleEditSave} onCancel={handleCancelEdit} saving={saving} />
            )}
          </>
        )}
      </OrderSection>

      {/* Production Exception — shown until 60 days after delivery */}
      <OrderSection
        icon={<ShieldAlert className="h-4 w-4 text-red-500" />}
        title="Production Exception"
        count={filterByClient(exceptionOrders).length}
        countBg="bg-red-100" countText="text-red-700"
        orders={filterByClient(exceptionOrders)} isLoading={loadingExceptions} error={errorExceptions}
        onRetry={() => mutateExceptions()}
        emptyText="No production exceptions"
      >
        {(order) => (
          <>
            <OrderRow
              order={order} onEdit={handleEdit} onDelete={handleDeleteClick}
              onStartProductionWorkflow={!order.production_started ? handleStartProductionWorkflow : undefined}
              onVerifyDeposit={order.deposit_paid && !order.deposit_verified ? handleVerifyDeposit : undefined}
              onVerifyBalance={order.balance_paid && !order.balance_verified ? handleVerifyBalance : undefined}
              onMarkDepositPaid={!order.deposit_paid ? handleMarkDepositPaid : undefined}
              onRevokeException={handleRevokeException}
              onViewFiles={handleViewFiles}
              depositSlipUpload={depositSlipUpload}
              onDepositSlipFileSelect={handleDepositSlipFileSelect}
              onUploadDepositSlip={handleUploadDepositSlip}
              onClearDepositSlip={() => setDepositSlipUpload({ orderId: null, file: null, extracting: false, extractedAmount: '', extractedDate: '', extractedRef: '', extractedNote: null })}
              onSetDepositSlipField={(field, value) => setDepositSlipUpload((prev) => ({ ...prev, [field]: value }))}
              balanceSlipUpload={balanceSlipUpload}
              onBalanceSlipFileSelect={handleBalanceSlipFileSelect}
              onMarkBalancePaid={handleMarkBalancePaid}
              onClearBalanceSlip={() => setBalanceSlipUpload({ orderId: null, file: null, extracting: false, extractedAmount: '', extractedDate: '', extractedRef: '', extractedNote: null, submitting: false })}
              onSetBalanceSlipField={(field, value) => setBalanceSlipUpload((prev) => ({ ...prev, [field]: value }))}
            />
            {editingOrder?.id === order.id && (
              <EditForm order={order} onSave={handleEditSave} onCancel={handleCancelEdit} saving={saving} />
            )}
          </>
        )}
      </OrderSection>

      {/* Pending Purchasing */}
      <OrderSection
        icon={<Clock className="h-4 w-4 text-amber-500" />}
        title="Pending Purchasing"
        count={filterByClient(pendingOrders).length}
        countBg="bg-amber-100" countText="text-amber-700"
        orders={filterByClient(pendingOrders)} isLoading={loadingPending} error={errorPending}
        onRetry={() => mutatePending()}
        emptyText="No pending purchasing orders"
      >
        {(order) => (
          <>
            <OrderRow order={order} onEdit={handleEdit} onDelete={handleDeleteClick} onStartProductionWorkflow={handleStartProductionWorkflow} onViewFiles={handleViewFiles} />
            {editingOrder?.id === order.id && (
              <EditForm order={order} onSave={handleEditSave} onCancel={handleCancelEdit} saving={saving} />
            )}
          </>
        )}
      </OrderSection>

      {/* Verify Deposit loading overlay */}
      {verifyingDeposit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-xl bg-white p-6 text-center shadow-xl">
            <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-rose-500" />
            <p className="text-sm text-gray-600">Verifying deposit...</p>
          </div>
        </div>
      )}

      <OtpModal
        open={otpModal.open} title={otpModal.title} description={otpModal.description}
        onVerified={handleOtpVerified}
        onClose={() => { setOtpModal({ ...otpModal, open: false }); (window as any).__pendingEditData = null; (window as any).__pendingStartProductionData = null; (window as any).__pendingMarkDepositPaidData = null; setVerifyingDepositOrder(null); }}
      />

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-xl bg-white p-6 text-center shadow-xl">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-red-500" />
            <p className="text-sm text-gray-600">Deleting order...</p>
          </div>
        </div>
      )}

      {viewingFilesOrder && (
        <FileViewerModal
          order={viewingFilesOrder}
          files={orderFiles}
          onClose={closeViewer}
          onUploadComplete={refreshFiles}
        />
      )}
    </div>
  );
}
