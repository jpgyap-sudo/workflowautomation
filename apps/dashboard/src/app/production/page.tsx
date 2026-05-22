'use client';

import { useState, useEffect } from 'react';
import { useOrdersByStage, usePartialProductionOrders } from '@/lib/useApi';
import type { Order, OrderItem, ItemCompletion } from '@/lib/api';
import {
  updateOrder, deleteOrder,
  reportProductionStatus, finishProduction, confirmEnRoute,
  getItemCompletion, getOrderItems,
  grantProductionException, revokeProductionException,
} from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import OtpModal from '@/components/OtpModal';
import { QuotationNumberCell, FileViewerModal, useOrderFileViewer } from '@/components/OrderFileViewer';
import {
  Factory, Truck, AlertTriangle, Clock, Calendar, CheckCircle,
  ExternalLink, Pencil, Trash2, X, Check, ChevronDown, ChevronUp,
  RefreshCw, Package, FileText, Eye, List,
} from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────

function DaysAgo({ updatedAt }: { updatedAt: string }) {
  const days = Math.floor((new Date().getTime() - new Date(updatedAt).getTime()) / 86_400_000);
  if (days <= 0) return null;
  const cls = days >= 7 ? 'font-semibold text-red-500' : days >= 3 ? 'text-amber-500' : 'text-gray-400';
  return <span className={`hidden text-xs sm:inline ${cls}`}>{days}d</span>;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function computeFinishDate(order: Order): Date | null {
  if (!order.production_started || !order.estimated_production_days) return null;
  const start = order.production_started_at ? new Date(order.production_started_at) : new Date(order.created_at);
  const d = new Date(start);
  d.setDate(d.getDate() + order.estimated_production_days);
  return d;
}

function getProductionProgress(order: Order) {
  if (!order.production_started || !order.estimated_production_days || order.production_finished) return null;
  const start = order.production_started_at ? new Date(order.production_started_at) : new Date(order.created_at);
  const elapsedMs = Date.now() - start.getTime();
  const totalMs = order.estimated_production_days * 86_400_000;
  const pct = Math.min(100, Math.max(0, Math.round((elapsedMs / totalMs) * 100)));
  const remainingDays = Math.max(0, order.estimated_production_days - Math.floor(elapsedMs / 86_400_000));
  const isOverdue = elapsedMs > totalMs;
  const isDueSoon = !isOverdue && remainingDays <= Math.max(3, Math.ceil(order.estimated_production_days * 0.15));
  return { pct, remainingDays, isOverdue, isDueSoon };
}

// ── Item Completion Bar ───────────────────────────────────────────────

function ItemCompletionBar({ pct, label, color }: { pct: number; label: string; color: string }) {
  return (
    <div className="rounded-lg bg-white p-2.5 shadow-sm">
      <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
        <Package className={`h-3 w-3 ${color}`} /> {label}
      </span>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-full rounded-full transition-all duration-500 ${pct >= 100 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-gray-400'}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <span className={`text-xs font-semibold ${pct >= 100 ? 'text-green-600' : pct >= 50 ? 'text-amber-600' : 'text-gray-500'}`}>
          {pct}%
        </span>
      </div>
    </div>
  );
}

// ── Production Info Cards ─────────────────────────────────────────────

function ProductionInfoCards({ order }: { order: Order }) {
  const [completion, setCompletion] = useState<ItemCompletion | null>(null);
  const [loadingCompletion, setLoadingCompletion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (order.production_started || order.current_stage === 'en_route') {
      setLoadingCompletion(true);
      getItemCompletion(order.id).then((res) => {
        if (!cancelled) {
          setCompletion(res.ok ? res : null);
          setLoadingCompletion(false);
        }
      }).catch(() => {
        if (!cancelled) setLoadingCompletion(false);
      });
    }
    return () => { cancelled = true; };
  }, [order.id, order.production_started, order.current_stage]);

  if (!order.production_started && !order.partial_production_items?.length) return null;
  const finishDate = computeFinishDate(order);
  const progress = getProductionProgress(order);

  return (
    <div className="border-t border-gray-100 bg-gray-50/50 px-6 py-3">
      {/* Partial items list */}
      {order.partial_production_items && order.partial_production_items.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600">Items Still Pending</p>
          <div className="flex flex-wrap gap-1.5">
            {order.partial_production_items.map((item, i) => (
              <span key={i} className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                {item}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Production stat cards */}
      {order.production_started && (
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-lg bg-white p-2.5 shadow-sm">
            <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
              <Factory className="h-3 w-3 text-indigo-500" /> Production
            </span>
            <p className="mt-1 font-semibold text-gray-800">Started</p>
          </div>
          {order.production_started_at && (
            <div className="rounded-lg bg-white p-2.5 shadow-sm">
              <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                <Calendar className="h-3 w-3 text-indigo-500" /> Started At
              </span>
              <p className="mt-1 font-semibold text-gray-800">
                {new Date(order.production_started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          )}
          {order.estimated_production_days && (
            <div className="rounded-lg bg-white p-2.5 shadow-sm">
              <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                <Clock className="h-3 w-3 text-amber-500" /> Est. Duration
              </span>
              <p className="mt-1 font-semibold text-gray-800">{order.estimated_production_days} days</p>
            </div>
          )}
          {finishDate && !order.production_finished && (
            <div className="rounded-lg bg-white p-2.5 shadow-sm">
              <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                <Calendar className="h-3 w-3 text-blue-500" /> Est. Finish
              </span>
              <p className="mt-1 font-semibold text-gray-800">{formatDate(finishDate)}</p>
            </div>
          )}
          {order.production_delayed != null && (
            <div className="rounded-lg bg-white p-2.5 shadow-sm">
              <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                <AlertTriangle className={`h-3 w-3 ${order.production_delayed ? 'text-red-500' : 'text-green-500'}`} /> Status
              </span>
              <p className={`mt-1 font-semibold ${order.production_delayed ? 'text-red-600' : 'text-green-600'}`}>
                {order.production_delayed ? `Delayed${order.production_delay_days ? ` (${order.production_delay_days}d)` : ''}` : 'On Time'}
              </p>
            </div>
          )}
          {order.production_finished != null && (
            <div className="rounded-lg bg-white p-2.5 shadow-sm">
              <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                <CheckCircle className={`h-3 w-3 ${order.production_finished ? 'text-green-500' : 'text-gray-400'}`} /> Finished
              </span>
              <p className={`mt-1 font-semibold ${order.production_finished ? 'text-green-600' : 'text-gray-500'}`}>
                {order.production_finished ? 'Yes' : 'No'}
              </p>
            </div>
          )}
          {order.delivery_estimated_days && (
            <div className="rounded-lg bg-white p-2.5 shadow-sm">
              <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                <Calendar className="h-3 w-3 text-purple-500" /> Delivery Est.
              </span>
              <p className="mt-1 font-semibold text-gray-800">{order.delivery_estimated_days} days</p>
            </div>
          )}
          {order.estimated_arrival_days && (
            <div className="rounded-lg bg-white p-2.5 shadow-sm">
              <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                <Package className="h-3 w-3 text-sky-500" /> Arrival Est.
              </span>
              <p className="mt-1 font-semibold text-gray-800">{order.estimated_arrival_days} days</p>
            </div>
          )}
        </div>
      )}

      {/* Item-level completion bars */}
      {completion && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <ItemCompletionBar
            pct={completion.production_completion_pct}
            label="Production %"
            color="text-indigo-500"
          />
          <ItemCompletionBar
            pct={completion.en_route_completion_pct}
            label="En Route %"
            color="text-sky-500"
          />
          <ItemCompletionBar
            pct={completion.inventory_completion_pct}
            label="Inventory %"
            color="text-emerald-500"
          />
        </div>
      )}
      {loadingCompletion && !completion && (
        <div className="mt-3 flex items-center justify-center py-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-[#2490ef]" />
        </div>
      )}

      {/* Progress bar */}
      {progress && !order.production_finished && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              {progress.isOverdue
                ? <span className="font-semibold text-red-600">Overdue by {Math.abs(progress.remainingDays)} days</span>
                : <span>{progress.remainingDays} days remaining</span>}
            </span>
            <span>{progress.pct}%</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className={`h-full rounded-full transition-all duration-500 ${progress.isOverdue ? 'bg-red-500' : progress.isDueSoon ? 'bg-amber-500' : 'bg-green-500'}`}
              style={{ width: `${Math.min(progress.pct, 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Order Row ─────────────────────────────────────────────────────────

interface OrderRowProps {
  order: Order;
  onEdit: (o: Order) => void;
  onDelete: (o: Order) => void;
  onViewFiles?: (o: Order) => void;
  onReportOnTime?: (o: Order) => void;
  onReportDelayed?: (o: Order) => void;
  onFinishProduction?: (o: Order) => void;
  onConfirmEnRoute?: (o: Order) => void;
  onGrantException?: (o: Order) => void;
  onRevokeException?: (o: Order) => void;
}

function OrderRow({ order, onEdit, onDelete, onViewFiles, onReportOnTime, onReportDelayed, onFinishProduction, onConfirmEnRoute, onGrantException, onRevokeException }: OrderRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [completion, setCompletion] = useState<ItemCompletion | null>(null);
  const progress = getProductionProgress(order);
  const rowHighlight = progress && !order.production_finished
    ? progress.isOverdue ? 'border-l-4 border-l-red-500'
    : progress.isDueSoon ? 'border-l-4 border-l-amber-500' : ''
    : '';

  // Fetch item-level completion for inline badges
  useEffect(() => {
    let cancelled = false;
    if (order.production_started || order.current_stage === 'en_route' || order.current_stage === 'inventory_arrived') {
      getItemCompletion(order.id).then((res) => {
        if (!cancelled && res.ok) setCompletion(res);
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [order.id, order.production_started, order.current_stage]);

  return (
    <div className={rowHighlight}>
      <button onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-gray-50/50">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <QuotationNumberCell order={order} onViewFiles={onViewFiles} />
            {/* Item-level completion badges inline */}
            {completion && (
              <>
                {completion.production_completion_pct > 0 && completion.production_completion_pct < 100 && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    completion.production_completion_pct >= 50 ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    <Package className="h-3 w-3" /> Prod: {completion.production_completion_pct}%
                  </span>
                )}
                {completion.en_route_completion_pct > 0 && completion.en_route_completion_pct < 100 && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    completion.en_route_completion_pct >= 50 ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    <Truck className="h-3 w-3" /> En Route: {completion.en_route_completion_pct}%
                  </span>
                )}
                {completion.inventory_completion_pct > 0 && completion.inventory_completion_pct < 100 && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    completion.inventory_completion_pct >= 50 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    <Package className="h-3 w-3" /> Inv: {completion.inventory_completion_pct}%
                  </span>
                )}
                {completion.production_completion_pct >= 100 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                    <CheckCircle className="h-3 w-3" /> Prod Complete
                  </span>
                )}
                {completion.en_route_completion_pct >= 100 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                    <CheckCircle className="h-3 w-3" /> All En Route
                  </span>
                )}
                {completion.inventory_completion_pct >= 100 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                    <CheckCircle className="h-3 w-3" /> All Arrived
                  </span>
                )}
              </>
            )}
            {progress && !order.production_finished && (
              <>
                {progress.isOverdue && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                    <AlertTriangle className="h-3 w-3" /> Overdue
                  </span>
                )}
                {progress.isDueSoon && !progress.isOverdue && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    <Clock className="h-3 w-3" /> Due Soon
                  </span>
                )}
              </>
            )}
            {(order.escalation_level ?? 0) > 0 && (
              <span className="flex items-center gap-0.5">
                {Array.from({ length: Math.min(order.escalation_level ?? 0, 3) }).map((_, i) => (
                  <span key={i} className="h-2 w-2 rounded-full bg-red-500" />
                ))}
              </span>
            )}
            {order.production_exception && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700" title={order.production_exception_notes ?? 'Production exception granted'}>
                <AlertTriangle className="h-3 w-3" /> Exception
              </span>
            )}
          </div>
          <p className="truncate text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
          {order.sales_agent && <p className="text-[11px] text-gray-400">{order.sales_agent}</p>}
        </div>
        <div className="flex items-center gap-3">
          <DaysAgo updatedAt={order.updated_at} />
          <StageBadge stage={order.current_stage} />
          <div className="flex items-center gap-1">
            <button onClick={(e) => { e.stopPropagation(); onEdit(order); }}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#2490ef]" title="Edit order">
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(order); }}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500" title="Delete order">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <>
          <ProductionInfoCards order={order} />
          <div className="flex flex-wrap gap-2 border-t border-gray-100 bg-white px-6 py-3">
            {/* Production Confirmed actions */}
            {order.production_started && !order.production_finished && order.current_stage !== 'en_route' && (
              <>
                {onReportOnTime && (
                  <button onClick={() => onReportOnTime(order)}
                    className="rounded-lg bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100">
                    On Time
                  </button>
                )}
                {onReportDelayed && (
                  <button onClick={() => onReportDelayed(order)}
                    className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100">
                    Mark Delayed
                  </button>
                )}
                {onFinishProduction && (
                  <button onClick={() => onFinishProduction(order)}
                    className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700">
                    Finish Production
                  </button>
                )}
              </>
            )}
            {/* En Route action */}
            {order.current_stage === 'en_route' && onConfirmEnRoute && (
              <button onClick={() => onConfirmEnRoute(order)}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700">
                Confirm En Route
              </button>
            )}
            {/* Production Exception actions */}
            {!order.deposit_verified && !order.production_exception && onGrantException && (
              <button onClick={() => onGrantException(order)}
                className="rounded-lg bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100">
                Grant Exception (No DP)
              </button>
            )}
            {order.production_exception && onRevokeException && (
              <button onClick={() => onRevokeException(order)}
                className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100">
                Revoke Exception
              </button>
            )}
            <span className="self-center text-xs text-gray-500">
              Downpayment: {order.deposit_paid ? `Paid${order.deposit_amount ? ` ₱${Number(order.deposit_amount).toLocaleString()}` : ''}` : 'Pending'}
              {' · '}
              Balance: {order.balance_paid ? 'Paid' : 'Pending'}
              {order.production_exception && ' · ⚠️ Exception'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ── Edit Form ─────────────────────────────────────────────────────────

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
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2 bg-blue-50/50 px-6 py-3">
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

// ── Section Component ─────────────────────────────────────────────────

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

// ── Page ──────────────────────────────────────────────────────────────

export default function ProductionPage() {
  const { data: partialOrders = [], isLoading: loadingPartial, error: errorPartial, mutate: mutatePartial } =
    usePartialProductionOrders();
  const { data: confirmedOrders = [], isLoading: loadingConfirmed, error: errorConfirmed, mutate: mutateConfirmed } =
    useOrdersByStage('production_confirmed');
  const { data: enRouteOrders = [], isLoading: loadingEnRoute, error: errorEnRoute, mutate: mutateEnRoute } =
    useOrdersByStage('en_route');

  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingOrder, setDeletingOrder] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);

  // File viewer state
  const { viewingFilesOrder, orderFiles, handleViewFiles, refreshFiles, closeViewer } = useOrderFileViewer();
  const [otpModal, setOtpModal] = useState<{
    open: boolean; title: string; description: string; pendingAction: 'edit' | 'delete';
  }>({ open: false, title: '', description: '', pendingAction: 'edit' });

  function refresh() { mutatePartial(); mutateConfirmed(); mutateEnRoute(); }

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
    else handleDeleteVerified(actionToken);
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
      description: `You are about to permanently delete order "${order.quotation_number ?? '—'}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'delete' });
  }

  async function handleReportOnTime(order: Order) {
    try {
      await reportProductionStatus(order.id, { on_time: true, delay_days: 0 });
      refresh();
    } catch (err: any) { alert('Failed: ' + (err.message ?? 'Unknown error')); }
  }

  async function handleReportDelayed(order: Order) {
    const input = window.prompt('How many days delayed?', order.production_delay_days?.toString() ?? '');
    if (!input) return;
    const days = Number(input.replace(/[^0-9]/g, ''));
    if (!Number.isInteger(days) || days < 0) { alert('Please enter a valid delay in days.'); return; }
    try {
      await reportProductionStatus(order.id, { on_time: false, delay_days: days });
      refresh();
    } catch (err: any) { alert('Failed: ' + (err.message ?? 'Unknown error')); }
  }

  async function handleFinishProduction(order: Order) {
    const input = window.prompt('Days until available for delivery?', order.delivery_estimated_days?.toString() ?? '28');
    if (!input) return;
    const days = Number(input.replace(/[^0-9]/g, ''));
    if (!Number.isInteger(days) || days <= 0) { alert('Please enter a valid positive number of days.'); return; }
    try {
      await finishProduction(order.id, { delivery_estimated_days: days });
      refresh();
    } catch (err: any) { alert('Failed: ' + (err.message ?? 'Unknown error')); }
  }

  async function handleConfirmEnRoute(order: Order) {
    const input = window.prompt('Days estimated for inventory to arrive?', order.estimated_arrival_days?.toString() ?? '28');
    if (!input) return;
    const days = Number(input.replace(/[^0-9]/g, ''));
    if (!Number.isInteger(days) || days <= 0) { alert('Please enter a valid positive number of days.'); return; }
    try {
      await confirmEnRoute(order.id, { estimated_arrival_days: days });
      refresh();
    } catch (err: any) { alert('Failed: ' + (err.message ?? 'Unknown error')); }
  }

  async function handleGrantException(order: Order) {
    const notes = window.prompt('Reason for production exception (why is production starting without downpayment)?');
    if (!notes) return;
    try {
      await grantProductionException(order.id, notes);
      refresh();
    } catch (err: any) { alert('Failed to grant exception: ' + (err.message ?? 'Unknown error')); }
  }

  async function handleRevokeException(order: Order) {
    if (!window.confirm(`Revoke production exception for #${order.quotation_number ?? 'unknown'}? This will block production until downpayment is verified.`)) return;
    try {
      await revokeProductionException(order.id);
      refresh();
    } catch (err: any) { alert('Failed to revoke exception: ' + (err.message ?? 'Unknown error')); }
  }

  const totalActive = partialOrders.length + confirmedOrders.length + enRouteOrders.length;

  return (
    <div className="space-y-6">
      {/* Header info */}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
        <div className="flex items-start gap-3">
          <Factory className="mt-0.5 h-5 w-5 text-indigo-600" />
          <div>
            <h3 className="text-sm font-semibold text-indigo-800">Production Workflow</h3>
            <p className="mt-1 text-xs text-indigo-700">
              Tracks all orders from partial production through full production confirmation and en-route shipping.
              The <strong>Production Agent</strong> sends adaptive reminders — more frequent as deadlines approach.
              {totalActive > 0 && <span className="ml-1 font-semibold">{totalActive} active order{totalActive !== 1 ? 's' : ''} in production pipeline.</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Partial Production */}
      <OrderSection
        icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
        title="Partial Production"
        count={partialOrders.length}
        countBg="bg-amber-100" countText="text-amber-700"
        orders={partialOrders} isLoading={loadingPartial} error={errorPartial}
        onRetry={() => mutatePartial()}
        emptyText="No orders with partial production pending"
      >
        {(order) => (
          <>
            <OrderRow order={order} onEdit={handleEdit} onDelete={handleDeleteClick} onViewFiles={handleViewFiles} />
            {editingOrder?.id === order.id && (
              <EditForm order={order} onSave={handleEditSave} onCancel={handleCancelEdit} saving={saving} />
            )}
          </>
        )}
      </OrderSection>

      {/* Production Confirmed */}
      <OrderSection
        icon={<Factory className="h-4 w-4 text-indigo-500" />}
        title="Production Confirmed"
        count={confirmedOrders.length}
        countBg="bg-indigo-100" countText="text-indigo-700"
        orders={confirmedOrders} isLoading={loadingConfirmed} error={errorConfirmed}
        onRetry={() => mutateConfirmed()}
        emptyText="No production confirmed orders"
      >
        {(order) => (
          <>
            <OrderRow
              order={order} onEdit={handleEdit} onDelete={handleDeleteClick} onViewFiles={handleViewFiles}
              onReportOnTime={handleReportOnTime}
              onReportDelayed={handleReportDelayed}
              onFinishProduction={handleFinishProduction}
              onGrantException={handleGrantException}
              onRevokeException={handleRevokeException}
            />
            {editingOrder?.id === order.id && (
              <EditForm order={order} onSave={handleEditSave} onCancel={handleCancelEdit} saving={saving} />
            )}
          </>
        )}
      </OrderSection>

      {/* En Route */}
      <OrderSection
        icon={<Truck className="h-4 w-4 text-sky-500" />}
        title="En Route"
        count={enRouteOrders.length}
        countBg="bg-sky-100" countText="text-sky-700"
        orders={enRouteOrders} isLoading={loadingEnRoute} error={errorEnRoute}
        onRetry={() => mutateEnRoute()}
        emptyText="No orders en route"
      >
        {(order) => (
          <>
            <OrderRow
              order={order} onEdit={handleEdit} onDelete={handleDeleteClick} onViewFiles={handleViewFiles}
              onConfirmEnRoute={handleConfirmEnRoute}
            />
            {editingOrder?.id === order.id && (
              <EditForm order={order} onSave={handleEditSave} onCancel={handleCancelEdit} saving={saving} />
            )}
          </>
        )}
      </OrderSection>

      <OtpModal
        open={otpModal.open} title={otpModal.title} description={otpModal.description}
        onVerified={handleOtpVerified}
        onClose={() => { setOtpModal({ ...otpModal, open: false }); (window as any).__pendingEditData = null; }}
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
