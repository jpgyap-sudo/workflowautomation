'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOrdersByStage, usePartialProductionOrders } from '@/lib/useApi';
import { useAuth } from '@/lib/auth';
import type { Order, OrderItem, ItemCompletion } from '@/lib/api';
import {
  updateOrder, deleteOrder,
  reportProductionStatus, finishProduction, confirmEnRoute, setProduction,
  getItemCompletion, getOrderItems, updateOrderItem,
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
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [updatingEnRouteItemId, setUpdatingEnRouteItemId] = useState<string | null>(null);

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
    // Fetch item-level details for production status table
    if (order.id) {
      setLoadingItems(true);
      getOrderItems(order.id).then((res) => {
        if (!cancelled && res.ok) {
          setItems(res.items);
          setLoadingItems(false);
        }
      }).catch(() => {
        if (!cancelled) setLoadingItems(false);
      });
    }
    return () => { cancelled = true; };
  }, [order.id, order.production_started, order.current_stage]);

  async function refreshItemState() {
    const [itemsRes, completionRes] = await Promise.all([
      getOrderItems(order.id),
      getItemCompletion(order.id).catch(() => null),
    ]);
    if (itemsRes.ok) setItems(itemsRes.items);
    if (completionRes?.ok) setCompletion(completionRes);
  }

  async function handleItemProductionStatus(
    item: OrderItem,
    productionStatus: 'pending' | 'in_progress' | 'finished'
  ) {
    setUpdatingItemId(item.id);
    try {
      await updateOrderItem(order.id, item.id, { production_status: productionStatus });
      await refreshItemState();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update item production status');
    } finally {
      setUpdatingItemId(null);
    }
  }

  async function handleItemEnRouteStatus(
    item: OrderItem,
    enRouteStatus: 'not_yet' | 'en_route' | 'arrived'
  ) {
    let estimatedArrivalDays: number | null = item.estimated_arrival_days ?? null;
    if (enRouteStatus === 'en_route' && !estimatedArrivalDays) {
      const input = window.prompt(`Estimated arrival days for "${item.name}"?`, '28');
      if (input === null) return; // cancelled
      const days = parseInt(input.replace(/[^0-9]/g, ''), 10);
      if (!days || days <= 0) { alert('Please enter a valid number of days.'); return; }
      estimatedArrivalDays = days;
    }
    setUpdatingEnRouteItemId(item.id);
    try {
      await updateOrderItem(order.id, item.id, {
        en_route_status: enRouteStatus,
        ...(estimatedArrivalDays != null ? { estimated_arrival_days: estimatedArrivalDays } : {}),
      });
      await refreshItemState();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update en route status');
    } finally {
      setUpdatingEnRouteItemId(null);
    }
  }

  if (!order.production_started && !order.partial_production_items?.length && items.length === 0) return null;
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

      {/* Item-level production status table */}
      {items.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Items ({items.length})
          </p>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Production</th>
                  <th className="px-3 py-2">En Route</th>
                  <th className="px-3 py-2">Inventory</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-800">{item.name}</td>
                    <td className="px-3 py-2 text-gray-600">{item.quantity}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          item.production_status === 'finished'
                            ? 'bg-green-100 text-green-700'
                            : item.production_status === 'in_progress'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {item.production_status === 'finished' ? '✓ Finished' : item.production_status === 'in_progress' ? '⟳ In Progress' : '○ Pending'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          item.en_route_status === 'arrived'
                            ? 'bg-green-100 text-green-700'
                            : item.en_route_status === 'en_route'
                              ? 'bg-sky-100 text-sky-700'
                              : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {item.en_route_status === 'arrived' ? '✓ Arrived' : item.en_route_status === 'en_route' ? '⟳ En Route' : '○ Not Yet'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {item.en_route_status === 'arrived' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          ✓ In Stock
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {/* Production status buttons — hidden for en_route stage (focus on en route actions) */}
                        {order.current_stage !== 'en_route' && (['pending', 'in_progress', 'finished'] as const).map((status) => {
                          const isActive = item.production_status === status;
                          const label = status === 'pending' ? 'Pending' : status === 'in_progress' ? 'Started' : 'Finished';
                          return (
                            <button
                              key={status}
                              type="button"
                              disabled={isActive || updatingItemId === item.id}
                              onClick={() => handleItemProductionStatus(item, status)}
                              className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition ${
                                isActive
                                  ? 'cursor-default border-gray-200 bg-gray-100 text-gray-400'
                                  : status === 'finished'
                                    ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
                                    : status === 'in_progress'
                                      ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                              }`}
                            >
                              {updatingItemId === item.id && !isActive ? 'Saving...' : label}
                            </button>
                          );
                        })}
                        {/* En route action buttons — only shown for en_route stage orders */}
                        {order.current_stage === 'en_route' && (() => {
                          const isBusy = updatingEnRouteItemId === item.id;
                          if (item.en_route_status === 'arrived') {
                            return <span className="text-[10px] text-gray-400 italic">Arrived ✓</span>;
                          }
                          return (
                            <>
                              {item.en_route_status !== 'en_route' && (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleItemEnRouteStatus(item, 'en_route')}
                                  className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50"
                                >
                                  {isBusy ? 'Saving...' : '🚚 En Route'}
                                </button>
                              )}
                              {item.en_route_status === 'en_route' && (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleItemEnRouteStatus(item, 'arrived')}
                                  className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                                >
                                  {isBusy ? 'Saving...' : '📦 Arrived'}
                                </button>
                              )}
                              {item.en_route_status !== 'not_yet' && (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleItemEnRouteStatus(item, 'not_yet')}
                                  className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                                >
                                  ✕ Not Yet
                                </button>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {loadingItems && items.length === 0 && (
        <div className="mb-3 flex items-center justify-center py-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-[#2490ef]" />
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
  onStartProduction?: (o: Order) => void;
  onReportOnTime?: (o: Order) => void;
  onReportDelayed?: (o: Order) => void;
  onFinishProduction?: (o: Order) => void;
  onConfirmEnRoute?: (o: Order) => void;
  onGrantException?: (o: Order) => void;
  onRevokeException?: (o: Order) => void;
}

function OrderRow({ order, onEdit, onDelete, onViewFiles, onStartProduction, onReportOnTime, onReportDelayed, onFinishProduction, onConfirmEnRoute, onGrantException, onRevokeException }: OrderRowProps) {
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
            {/* Start Production button for production_pending orders */}
            {onStartProduction && !order.production_started && (
              <button onClick={() => onStartProduction(order)}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">
                Start Production
              </button>
            )}
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
            {(!order.deposit_paid || !order.deposit_verified) && !order.production_exception && onGrantException && (
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
    useOrdersByStage('production_pending');
  const { data: partialOrders = [], isLoading: loadingPartial, error: errorPartial, mutate: mutatePartial } =
    usePartialProductionOrders();
  const { data: confirmedOrders = [], isLoading: loadingConfirmed, error: errorConfirmed, mutate: mutateConfirmed } =
    useOrdersByStage('production_confirmed');
  const { data: enRouteOrders = [], isLoading: loadingEnRoute, error: errorEnRoute, mutate: mutateEnRoute } =
    useOrdersByStage('en_route');

  // Split confirmed orders into in-progress vs finished
  const inProgressOrders = confirmedOrders.filter((o: Order) => !o.production_finished);
  const finishedOrders = confirmedOrders.filter((o: Order) => o.production_finished);

  // Fetch item completion for en_route orders so we can split them into
  // "En Route Verification" (some items not yet en_route) vs "En Route" (all tracking)
  const [enRouteCompletion, setEnRouteCompletion] = useState<Record<string, { pct: number; allArrived: boolean }>>({});
  useEffect(() => {
    if (enRouteOrders.length === 0) return;
    let cancelled = false;
    async function fetchEnRouteCompletion() {
      const map: Record<string, { pct: number; allArrived: boolean }> = {};
      await Promise.all(
        enRouteOrders.map(async (order: Order) => {
          try {
            const [compRes, itemsRes] = await Promise.all([
              getItemCompletion(order.id),
              getOrderItems(order.id),
            ]);
            if (!cancelled) {
              const items = itemsRes.items ?? [];
              const allArrived = items.length > 0 && items.every((i: any) => i.en_route_status === 'arrived');
              map[order.id] = { pct: compRes.en_route_completion_pct ?? 0, allArrived };
            }
          } catch { /* ignore */ }
        })
      );
      if (!cancelled) setEnRouteCompletion(map);
    }
    fetchEnRouteCompletion();
    return () => { cancelled = true; };
  }, [enRouteOrders]);

  const enRouteVerificationOrders = enRouteOrders.filter((o: Order) => {
    const comp = enRouteCompletion[o.id];
    return !comp || comp.pct < 100;
  });
  const enRouteTrackingOrders = enRouteOrders.filter((o: Order) => {
    const comp = enRouteCompletion[o.id];
    return comp && comp.pct >= 100 && !comp.allArrived;
  });

  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingOrder, setDeletingOrder] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);

  // File viewer state
  const { viewingFilesOrder, orderFiles, handleViewFiles, refreshFiles, closeViewer } = useOrderFileViewer();
  const [otpModal, setOtpModal] = useState<{
    open: boolean; title: string; description: string; pendingAction: 'edit' | 'delete' | 'reportStatus' | 'finishProduction' | 'confirmEnRoute' | 'grantProductionException' | 'revokeProductionException' | 'setProduction';
  }>({ open: false, title: '', description: '', pendingAction: 'edit' });

  function refresh() { mutatePending(); mutatePartial(); mutateConfirmed(); mutateEnRoute(); }

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
    else if (otpModal.pendingAction === 'reportStatus') handleReportStatusVerified(actionToken);
    else if (otpModal.pendingAction === 'finishProduction') handleFinishProductionVerified(actionToken);
    else if (otpModal.pendingAction === 'confirmEnRoute') handleConfirmEnRouteVerified(actionToken);
    else if (otpModal.pendingAction === 'setProduction') handleStartProductionVerified(actionToken);
    else if (otpModal.pendingAction === 'grantProductionException') handleGrantExceptionVerified(actionToken);
    else if (otpModal.pendingAction === 'revokeProductionException') handleRevokeExceptionVerified(actionToken);
  }

  async function handleGrantExceptionVerified(actionToken: string) {
    const pending = (window as any).__pendingGrantExceptionData;
    if (!pending) return;
    try {
      await grantProductionException(pending.orderId, { notes: pending.notes, granted_by: 'dashboard', action_token: actionToken });
      refresh();
    } catch (err: any) { alert('Failed to grant exception: ' + (err.message ?? 'Unknown error')); }
    finally { (window as any).__pendingGrantExceptionData = null; }
  }

  async function handleRevokeExceptionVerified(actionToken: string) {
    const pending = (window as any).__pendingRevokeExceptionData;
    if (!pending) return;
    try {
      await revokeProductionException(pending.orderId, actionToken);
      refresh();
    } catch (err: any) { alert('Failed to revoke exception: ' + (err.message ?? 'Unknown error')); }
    finally { (window as any).__pendingRevokeExceptionData = null; }
  }

  async function handleReportStatusVerified(actionToken: string) {
    const pending = (window as any).__pendingReportStatusData;
    if (!pending) return;
    try {
      await reportProductionStatus(pending.orderId, { ...pending.data, action_token: actionToken });
      refresh();
    } catch (err: any) { alert('Failed: ' + (err.message ?? 'Unknown error')); }
    finally { (window as any).__pendingReportStatusData = null; }
  }

  async function handleStartProductionVerified(actionToken: string) {
    const pending = (window as any).__pendingStartProductionData;
    if (!pending) return;
    try {
      await setProduction(pending.orderId, { production_started: true, estimated_production_days: pending.days, action_token: actionToken });
      refresh();
    } catch (err: any) { alert('Failed to start production: ' + (err.message ?? 'Unknown error')); }
    finally { (window as any).__pendingStartProductionData = null; }
  }

  async function handleFinishProductionVerified(actionToken: string) {
    const pending = (window as any).__pendingFinishProductionData;
    if (!pending) return;
    try {
      await finishProduction(pending.orderId, { delivery_estimated_days: pending.days, action_token: actionToken });
      refresh();
    } catch (err: any) { alert('Failed: ' + (err.message ?? 'Unknown error')); }
    finally { (window as any).__pendingFinishProductionData = null; }
  }

  async function handleConfirmEnRouteVerified(actionToken: string) {
    const pending = (window as any).__pendingConfirmEnRouteData;
    if (!pending) return;
    try {
      await confirmEnRoute(pending.orderId, { estimated_arrival_days: pending.days, action_token: actionToken });
      refresh();
    } catch (err: any) { alert('Failed: ' + (err.message ?? 'Unknown error')); }
    finally { (window as any).__pendingConfirmEnRouteData = null; }
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
    setOtpModal({ open: true, title: 'Report Production Status',
      description: `You are about to report order "${order.quotation_number ?? '—'}" as on time. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'reportStatus' });
    (window as any).__pendingReportStatusData = { orderId: order.id, data: { on_time: true, delay_days: 0 } };
  }

  async function handleReportDelayed(order: Order) {
    const input = window.prompt('How many days delayed?', order.production_delay_days?.toString() ?? '');
    if (!input) return;
    const days = Number(input.replace(/[^0-9]/g, ''));
    if (!Number.isInteger(days) || days < 0) { alert('Please enter a valid delay in days.'); return; }
    setOtpModal({ open: true, title: 'Report Production Status',
      description: `You are about to report order "${order.quotation_number ?? '—'}" as delayed by ${days} day(s). Enter the OTP sent to your email to confirm.`,
      pendingAction: 'reportStatus' });
    (window as any).__pendingReportStatusData = { orderId: order.id, data: { on_time: false, delay_days: days } };
  }

  async function handleStartProduction(order: Order) {
    const input = window.prompt('Estimated production days?', order.estimated_production_days?.toString() ?? '');
    if (!input) return;
    const days = Number(input.replace(/[^0-9]/g, ''));
    if (!Number.isInteger(days) || days <= 0) { alert('Please enter a valid positive number of days.'); return; }
    setOtpModal({ open: true, title: 'Start Production',
      description: `You are about to start production for order "${order.quotation_number ?? '—'}" with ${days} day(s) estimate. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'setProduction' });
    (window as any).__pendingStartProductionData = { orderId: order.id, days };
  }

  async function handleFinishProduction(order: Order) {
    const input = window.prompt('Days until available for delivery?', order.delivery_estimated_days?.toString() ?? '28');
    if (!input) return;
    const days = Number(input.replace(/[^0-9]/g, ''));
    if (!Number.isInteger(days) || days <= 0) { alert('Please enter a valid positive number of days.'); return; }
    setOtpModal({ open: true, title: 'Finish Production',
      description: `You are about to mark order "${order.quotation_number ?? '—'}" as finished with ${days} day(s) delivery estimate. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'finishProduction' });
    (window as any).__pendingFinishProductionData = { orderId: order.id, days };
  }

  async function handleConfirmEnRoute(order: Order) {
    const input = window.prompt('Days estimated for inventory to arrive?', order.estimated_arrival_days?.toString() ?? '28');
    if (!input) return;
    const days = Number(input.replace(/[^0-9]/g, ''));
    if (!Number.isInteger(days) || days <= 0) { alert('Please enter a valid positive number of days.'); return; }
    setOtpModal({ open: true, title: 'Confirm En Route',
      description: `You are about to confirm order "${order.quotation_number ?? '—'}" as en route with ${days} day(s) estimated arrival. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'confirmEnRoute' });
    (window as any).__pendingConfirmEnRouteData = { orderId: order.id, days };
  }

  async function handleGrantException(order: Order) {
    const notes = window.prompt('Reason for production exception (why is production starting without downpayment)?');
    if (!notes) return;
    setOtpModal({ open: true, title: 'Grant Production Exception',
      description: `You are about to grant a production exception for order "${order.quotation_number ?? '—'}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'grantProductionException' });
    (window as any).__pendingGrantExceptionData = { orderId: order.id, notes };
  }

  async function handleRevokeException(order: Order) {
    if (!window.confirm(`Revoke production exception for #${order.quotation_number ?? 'unknown'}? This will block production until downpayment is verified.`)) return;
    setOtpModal({ open: true, title: 'Revoke Production Exception',
      description: `You are about to revoke the production exception for order "${order.quotation_number ?? '—'}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'revokeProductionException' });
    (window as any).__pendingRevokeExceptionData = { orderId: order.id };
  }

  const totalActive = pendingOrders.length + partialOrders.length + inProgressOrders.length + finishedOrders.length + enRouteOrders.length;
  const totalEnRouteSections = enRouteVerificationOrders.length + enRouteTrackingOrders.length;

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

      {/* Production Pending */}
      <OrderSection
        icon={<Clock className="h-4 w-4 text-indigo-500" />}
        title="Production Pending"
        count={pendingOrders.length}
        countBg="bg-indigo-100" countText="text-indigo-700"
        orders={pendingOrders} isLoading={loadingPending} error={errorPending}
        onRetry={() => mutatePending()}
        emptyText="No orders pending production"
      >
        {(order) => (
          <>
            <OrderRow order={order} onEdit={handleEdit} onDelete={handleDeleteClick} onViewFiles={handleViewFiles} onStartProduction={handleStartProduction} />
            {editingOrder?.id === order.id && (
              <EditForm order={order} onSave={handleEditSave} onCancel={handleCancelEdit} saving={saving} />
            )}
          </>
        )}
      </OrderSection>

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

      {/* Production In Progress */}
      <OrderSection
        icon={<Factory className="h-4 w-4 text-indigo-500" />}
        title="Production In Progress"
        count={inProgressOrders.length}
        countBg="bg-indigo-100" countText="text-indigo-700"
        orders={inProgressOrders} isLoading={loadingConfirmed} error={errorConfirmed}
        onRetry={() => mutateConfirmed()}
        emptyText="No orders in production"
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

      {/* Production Finished */}
      <OrderSection
        icon={<CheckCircle className="h-4 w-4 text-green-500" />}
        title="Production Finished"
        count={finishedOrders.length}
        countBg="bg-green-100" countText="text-green-700"
        orders={finishedOrders} isLoading={loadingConfirmed} error={errorConfirmed}
        onRetry={() => mutateConfirmed()}
        emptyText="No finished orders awaiting en-route confirmation"
      >
        {(order) => (
          <>
            <OrderRow
              order={order} onEdit={handleEdit} onDelete={handleDeleteClick} onViewFiles={handleViewFiles}
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

      {/* En Route Verification — some items still not confirmed en route */}
      <OrderSection
        icon={<Truck className="h-4 w-4 text-amber-500" />}
        title="En Route Verification"
        count={enRouteVerificationOrders.length}
        countBg="bg-amber-100" countText="text-amber-700"
        orders={enRouteVerificationOrders} isLoading={loadingEnRoute} error={errorEnRoute}
        onRetry={() => mutateEnRoute()}
        emptyText="No orders awaiting en route confirmation"
      >
        {(order) => (
          <>
            <OrderRow
              order={order} onEdit={handleEdit} onDelete={handleDeleteClick} onViewFiles={handleViewFiles}
              onConfirmEnRoute={handleConfirmEnRoute}
              onGrantException={handleGrantException}
              onRevokeException={handleRevokeException}
            />
            {editingOrder?.id === order.id && (
              <EditForm order={order} onSave={handleEditSave} onCancel={handleCancelEdit} saving={saving} />
            )}
          </>
        )}
      </OrderSection>

      {/* En Route — all items confirmed en route, awaiting arrival */}
      <OrderSection
        icon={<Truck className="h-4 w-4 text-sky-500" />}
        title="En Route"
        count={enRouteTrackingOrders.length}
        countBg="bg-sky-100" countText="text-sky-700"
        orders={enRouteTrackingOrders} isLoading={loadingEnRoute} error={errorEnRoute}
        onRetry={() => mutateEnRoute()}
        emptyText="No orders fully en route"
      >
        {(order) => (
          <>
            <OrderRow
              order={order} onEdit={handleEdit} onDelete={handleDeleteClick} onViewFiles={handleViewFiles}
              onConfirmEnRoute={handleConfirmEnRoute}
              onGrantException={handleGrantException}
              onRevokeException={handleRevokeException}
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
