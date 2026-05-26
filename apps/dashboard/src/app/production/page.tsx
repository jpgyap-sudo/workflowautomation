'use client';

import { Fragment, useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useOrdersByStage, usePartialProductionOrders } from '@/lib/useApi';
import { useAuth } from '@/lib/auth';
import type { Order, OrderItem, ItemCompletion } from '@/lib/api';
import {
  updateOrder, deleteOrder,
  reportProductionStatus, finishProduction, finishAllItems, bulkEnRoute, confirmEnRoute, setProduction,
  recordStageUpdate,
  getItemCompletion, getOrderItems, updateOrderItem,
  grantProductionException, revokeProductionException,
  createStockReplenishmentOrder,
  getOrderNotes, postProductionNote,
} from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import OtpModal from '@/components/OtpModal';
import { QuotationNumberCell, FileViewerModal, useOrderFileViewer } from '@/components/OrderFileViewer';
import {
  Factory, Truck, AlertTriangle, Clock, Calendar, CheckCircle,
  Pencil, Trash2, X, Check, ChevronDown, ChevronUp,
  RefreshCw, Package, Loader2, MessageSquare,
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

function addDays(dateStr: string | null | undefined, days: number | null | undefined): Date | null {
  if (!dateStr || !days || days <= 0) return null;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + days);
  return date;
}

function getEstimatedInventoryArrivalDate(order: Order): Date | null {
  return addDays(order.en_route_confirmed_at, order.estimated_arrival_days)
    ?? addDays(order.inventory_en_route_at, order.estimated_inventory_arrival_days);
}

function getEstimatedItemInventoryArrivalDate(order: Order, item: OrderItem): Date | null {
  const baseDate = order.en_route_confirmed_at
    ?? ((item.en_route_status === 'en_route' || item.en_route_status === 'arrived') ? item.updated_at : null);
  return addDays(baseDate, item.estimated_arrival_days)
    ?? getEstimatedInventoryArrivalDate(order);
}

function getItemProductionFinishedDate(item: OrderItem): Date | null {
  if (item.production_status !== 'finished') return null;
  const rawDate = item.production_finished_at ?? item.updated_at;
  if (!rawDate) return null;
  const date = new Date(rawDate);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatStatusLabel(value: string | null | undefined): string {
  if (!value) return '\u2014';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getEnRouteVerificationText(order: Order, items?: OrderItem[]): string {
  if (order.en_route_confirmed || order.current_stage === 'en_route_verification' || order.current_stage === 'inventory_verification' || order.current_stage === 'inventory_arrived') {
    return order.en_route_confirmed_at ? `Verified ${formatDate(new Date(order.en_route_confirmed_at))}` : 'Verified';
  }
  // Item-level status for partial production
  if (items && items.length > 0) {
    const finishedItems = items.filter((i) => i.production_status === 'finished');
    const enRouteCount = finishedItems.filter((i) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived').length;
    const totalFinished = finishedItems.length;
    if (totalFinished > 0) {
      if (enRouteCount === totalFinished) return `${enRouteCount}/${totalFinished} en route`;
      return `${enRouteCount}/${totalFinished} en route`;
    }
  }
  return 'Pending';
}

function dedupeOrders(orders: Order[]): Order[] {
  const map = new Map<string, Order>();
  for (const order of orders) map.set(order.id, order);
  return Array.from(map.values());
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

interface ProductionInfoCardsProps {
  order: Order;
  onItemProductionStatus?: (item: OrderItem, status: 'pending' | 'in_progress' | 'finished') => void;
  onItemEnRouteStatus?: (item: OrderItem, status: 'not_yet' | 'en_route' | 'arrived') => void;
}

function ProductionInfoCards({ order, onItemProductionStatus, onItemEnRouteStatus }: ProductionInfoCardsProps) {
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
    if (onItemProductionStatus) {
      onItemProductionStatus(item, productionStatus);
    } else {
      // Fallback: direct call without OTP
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
  }

  async function handleItemEnRouteStatus(
    item: OrderItem,
    enRouteStatus: 'not_yet' | 'en_route' | 'arrived'
  ) {
    if (onItemEnRouteStatus) {
      onItemEnRouteStatus(item, enRouteStatus);
    } else {
      let estimatedArrivalDays: number | null = item.estimated_arrival_days ?? null;
      if (enRouteStatus === 'en_route' && !estimatedArrivalDays) {
        const input = window.prompt(`Estimated arrival days for "${item.name}"?`, '28');
        if (input === null) return;
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
  }

  // Always render if we have items (even if production hasn't started — for item-level Start buttons)
  if (items.length === 0 && !order.partial_production_items?.length) return null;
  const finishDate = computeFinishDate(order);
  const progress = getProductionProgress(order);
  const actualItemsByName = new Map(items.map((item) => [item.name, item.production_status]));
  const pendingPartialItems = (order.partial_production_items ?? []).filter((name) => {
    const actualStatus = actualItemsByName.get(name);
    return actualStatus == null || actualStatus !== 'finished';
  });
  const showPendingPartialItems = pendingPartialItems.length > 0 && !items.every((item) => item.production_status === 'finished');

  return (
    <div className="border-t border-gray-100 bg-gray-50/50 px-6 py-3">
      {/* Partial items list */}
      {showPendingPartialItems && (
        <div className="mb-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600">Items Still Pending</p>
          <div className="flex flex-wrap gap-1.5">
            {pendingPartialItems.map((item, i) => (
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
                        {/* Production status buttons — only shown when production has started */}
                        {order.production_started && order.current_stage !== 'en_route' && order.current_stage !== 'production_pending' && (['pending', 'in_progress', 'finished'] as const).map((status) => {
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
                        {/* Item-level Start button for Production Pending — prompts for production days */}
                        {!order.production_started && (
                          <button
                            type="button"
                            disabled={updatingItemId === item.id}
                            onClick={async () => {
                              const input = window.prompt(`Production days for "${item.name}"?`, item.estimated_production_days?.toString() ?? '30');
                              if (input === null) return;
                              const days = parseInt(input.replace(/[^0-9]/g, ''), 10);
                              if (!days || days <= 0) { alert('Please enter a valid number of production days.'); return; }
                              // First save the production days (metadata, no OTP needed)
                              setUpdatingItemId(item.id);
                              try {
                                await updateOrderItem(order.id, item.id, { estimated_production_days: days });
                                await refreshItemState();
                                // Then trigger OTP for the status change
                                handleItemProductionStatus(item, 'in_progress');
                              } catch (err) {
                                alert(err instanceof Error ? err.message : 'Failed to set production days');
                                setUpdatingItemId(null);
                              }
                            }}
                            className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                          >
                            {updatingItemId === item.id ? 'Saving...' : '▶ Start'}
                          </button>
                        )}
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
  onProceedInventoryVerification?: (o: Order) => void;
  onGrantException?: (o: Order) => void;
  onRevokeException?: (o: Order) => void;
  onItemProductionStatus?: (item: OrderItem, status: 'pending' | 'in_progress' | 'finished') => void;
  onItemEnRouteStatus?: (item: OrderItem, status: 'not_yet' | 'en_route' | 'arrived') => void;
}

function OrderRow({ order, onEdit, onDelete, onViewFiles, onStartProduction, onReportOnTime, onReportDelayed, onFinishProduction, onConfirmEnRoute, onProceedInventoryVerification, onGrantException, onRevokeException, onItemProductionStatus, onItemEnRouteStatus }: OrderRowProps) {
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
          <ProductionInfoCards order={order} onItemProductionStatus={onItemProductionStatus} onItemEnRouteStatus={onItemEnRouteStatus} />
          <div className="flex flex-wrap gap-2 border-t border-gray-100 bg-white px-6 py-3">
            {/* Start Production button for production_pending orders */}
            {onStartProduction && !order.production_started && (
              <button onClick={() => onStartProduction(order)}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">
                Start Production
              </button>
            )}
            {/* Production Confirmed actions */}
            {order.production_started && !order.production_finished && order.current_stage !== 'en_route' && order.current_stage !== 'production_pending' && (
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
            {/* Early arrival action */}
            {order.current_stage === 'en_route_verification' && onProceedInventoryVerification && (
              <button onClick={() => onProceedInventoryVerification(order)}
                className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700">
                Proceed to Inventory Verification
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

// ── Item Status Badge ─────────────────────────────────────────────────

function ItemStatusBadge({ status }: { status: string | null | undefined }) {
  if (status === 'pending' || !status) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-semibold text-gray-500">
        <Clock className="h-3 w-3" /> Pending Production
      </span>
    );
  }
  if (status === 'in_progress') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700">
        <Factory className="h-3 w-3" /> Production Started
      </span>
    );
  }
  if (status === 'finished') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-semibold text-green-700">
        <CheckCircle className="h-3 w-3" /> Finished
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-semibold text-gray-500">
      {status ?? 'Unknown'}
    </span>
  );
}

/** Compute estimated finish date for an item based on its production days */
function getItemEstimatedFinishDate(item: OrderItem): Date | null {
  if (!item.estimated_production_days || item.production_status === 'pending') return null;
  // Use updated_at as a proxy for when production started on this item
  const startDate = item.production_status === 'in_progress' && item.updated_at
    ? new Date(item.updated_at)
    : new Date();
  if (Number.isNaN(startDate.getTime())) return null;
  const d = new Date(startDate);
  d.setDate(d.getDate() + item.estimated_production_days);
  return d;
}

// ── Production Item Section (for Partial Production & Production In Progress) ──

interface ProductionItemSectionProps {
  icon: React.ReactNode;
  title: string;
  count: number;
  countBg: string;
  countText: string;
  orders: Order[];
  isLoading: boolean;
  error?: Error;
  onRetry?: () => void;
  emptyText: string;
  /** Filter function to determine which items to show for an order */
  itemFilter: (item: OrderItem) => boolean;
  /** Show Start button for items */
  showStartButton?: boolean;
  /** Show Finished button for items */
  showFinishedButton?: boolean;
  /** Show Delayed button for items */
  showDelayedButton?: boolean;
  /** Show bulk "Finish All" button for an order */
  showBulkFinishButton?: boolean;
  /** Callback when Start is clicked for an item */
  onItemStart?: (order: Order, item: OrderItem) => void;
  /** Callback when Start is confirmed with production days */
  onItemStartConfirm?: (order: Order, item: OrderItem, days: number) => void;
  /** Callback when Finished is clicked for an item */
  onItemFinished?: (order: Order, item: OrderItem) => void;
  /** Callback when Delayed is clicked for an item */
  onItemDelayed?: (order: Order, item: OrderItem) => void;
  /** Callback when bulk Finish All is clicked for an order */
  onBulkFinish?: (order: Order) => void;
  /** Callback when Finish Selected is clicked with specific item IDs */
  onBulkFinishSelected?: (order: Order, itemIds: string[]) => void;
  /** Callback to view files */
  onViewFiles?: (o: Order) => void;
  /** Callback to edit */
  onEdit?: (o: Order) => void;
  /** Callback to delete */
  onDelete?: (o: Order) => void;
  /** Currently updating item ID */
  updatingItemId?: string | null;
  /** Callback when Finish Production is clicked for an order (order-level) */
  onFinishProduction?: (order: Order) => void;
}

function ProductionItemSection({
  icon, title, count, countBg, countText,
  orders, isLoading, error, onRetry, emptyText,
  itemFilter,
  showStartButton, showFinishedButton, showDelayedButton, showBulkFinishButton,
  onItemStart, onItemStartConfirm, onItemFinished, onItemDelayed, onBulkFinish, onBulkFinishSelected,
  onViewFiles, onEdit, onDelete,
  updatingItemId,
  onFinishProduction,
}: ProductionItemSectionProps) {
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [itemsByOrder, setItemsByOrder] = useState<Record<string, OrderItem[]>>({});
  const [loadingItemsForOrder, setLoadingItemsForOrder] = useState<string | null>(null);
  // Multi-select state: per-order set of selected item IDs (only in_progress items)
  const [selectedItemIds, setSelectedItemIds] = useState<Record<string, Set<string>>>({});

  function toggleSelectItem(orderId: string, itemId: string) {
    setSelectedItemIds((prev) => {
      const current = new Set(prev[orderId] ?? []);
      if (current.has(itemId)) current.delete(itemId); else current.add(itemId);
      return { ...prev, [orderId]: current };
    });
  }

  function toggleSelectAll(orderId: string, selectableItems: OrderItem[]) {
    setSelectedItemIds((prev) => {
      const current = prev[orderId] ?? new Set<string>();
      const allSelected = selectableItems.every((i) => current.has(i.id));
      return { ...prev, [orderId]: allSelected ? new Set() : new Set(selectableItems.map((i) => i.id)) };
    });
  }

  // Per-item start production modal
  const [startItemModal, setStartItemModal] = useState<{
    open: boolean;
    order: Order | null;
    item: OrderItem | null;
    productionDays: string;
  }>({ open: false, order: null, item: null, productionDays: '' });

  async function toggleOrder(order: Order) {
    if (expandedOrderId === order.id) {
      setExpandedOrderId(null);
      setSelectedItemIds((prev) => { const next = { ...prev }; delete next[order.id]; return next; });
      return;
    }
    setExpandedOrderId(order.id);
    if (!itemsByOrder[order.id]) {
      setLoadingItemsForOrder(order.id);
      try {
        const res = await getOrderItems(order.id);
        setItemsByOrder((prev) => ({ ...prev, [order.id]: res.items ?? [] }));
      } catch {
        setItemsByOrder((prev) => ({ ...prev, [order.id]: [] }));
      } finally {
        setLoadingItemsForOrder(null);
      }
    }
  }

  function handleStartClick(order: Order, item: OrderItem) {
    setStartItemModal({
      open: true,
      order,
      item,
      productionDays: item.estimated_production_days?.toString() ?? '',
    });
  }

  async function handleStartConfirm() {
    const modal = startItemModal;
    if (!modal.order || !modal.item) return;
    const days = parseInt(modal.productionDays.replace(/[^0-9]/g, ''));
    if (!days || days <= 0) { alert('Please enter a valid number of production days.'); return; }
    setStartItemModal({ ...modal, open: false });
    if (onItemStartConfirm) {
      onItemStartConfirm(modal.order, modal.item, days);
    } else {
      // Fallback: direct call without OTP
      try {
        await updateOrderItem(modal.order.id, modal.item.id, {
          estimated_production_days: days,
          production_status: 'in_progress',
        });
        const res = await getOrderItems(modal.order.id);
        if (res.ok) {
          setItemsByOrder((prev) => ({ ...prev, [modal.order!.id]: res.items }));
        }
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to start production for item');
      }
    }
  }

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
          {orders.map((order) => {
            const isExpanded = expandedOrderId === order.id;
            const orderItems = itemsByOrder[order.id] ?? [];
            const filteredItems = orderItems.filter(itemFilter);
            const hasRelevantItems = filteredItems.length > 0;

            return (
              <div key={order.id}>
                {/* Order header row */}
                <button
                  onClick={() => toggleOrder(order)}
                  className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-gray-50/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <QuotationNumberCell order={order} onViewFiles={onViewFiles} />
                      {order.client_name && (
                        <span className="text-xs text-gray-500">— {order.client_name}</span>
                      )}
                    </div>
                    {order.sales_agent && (
                      <p className="text-[11px] text-gray-400">{order.sales_agent}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <DaysAgo updatedAt={order.updated_at} />
                    <StageBadge stage={order.current_stage} />
                    <div className="flex items-center gap-1">
                      {onEdit && (
                        <button onClick={(e) => { e.stopPropagation(); onEdit(order); }}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#2490ef]" title="Edit order">
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {onDelete && (
                        <button onClick={(e) => { e.stopPropagation(); onDelete(order); }}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500" title="Delete order">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    {onFinishProduction && order.production_started && !order.production_finished && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onFinishProduction(order); }}
                        className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 transition-colors"
                      >
                        Finish Production
                      </button>
                    )}
                    {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                  </div>
                </button>

                {/* Expanded items table */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50/50 px-6 py-3">
                    {loadingItemsForOrder === order.id ? (
                      <div className="flex items-center justify-center py-4">
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-[#2490ef]" />
                      </div>
                    ) : !hasRelevantItems ? (
                      <p className="py-2 text-center text-xs text-gray-400">
                        {orderItems.length === 0 ? 'No items found for this order.' : `No items match the current section criteria.`}
                      </p>
                    ) : (
                      (() => {
                        const orderSelected = selectedItemIds[order.id] ?? new Set<string>();
                        const selectableItems = filteredItems.filter((i) => i.production_status === 'in_progress');
                        const allSelected = selectableItems.length > 0 && selectableItems.every((i) => orderSelected.has(i.id));
                        const someSelected = orderSelected.size > 0 && !allSelected;
                        return (
                          <div>
                            {/* Toolbar: Finish Selected + Finish All */}
                            {(showBulkFinishButton || (showFinishedButton && onBulkFinishSelected)) && (
                              <div className="mb-2 flex items-center justify-end gap-2">
                                {showFinishedButton && onBulkFinishSelected && orderSelected.size > 0 && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onBulkFinishSelected(order, Array.from(orderSelected)); }}
                                    className="rounded-md border border-green-300 bg-green-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-green-700 transition-colors"
                                  >
                                    ✓ Finish Selected ({orderSelected.size})
                                  </button>
                                )}
                                {showBulkFinishButton && (() => {
                                  const unfinished = filteredItems.filter((i) => i.production_status !== 'finished');
                                  if (unfinished.length === 0) return null;
                                  return (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); onBulkFinish?.(order); }}
                                      className="rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-[11px] font-semibold text-green-700 hover:bg-green-100 transition-colors"
                                    >
                                      ✓ Finish All ({unfinished.length})
                                    </button>
                                  );
                                })()}
                              </div>
                            )}
                            <div className="overflow-x-auto rounded-lg border border-gray-200">
                              <table className="w-full text-left text-xs">
                                <thead>
                                  <tr className="border-b border-gray-200 bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                                    {showFinishedButton && (
                                      <th className="w-8 px-3 py-2">
                                        <input
                                          type="checkbox"
                                          title="Select all"
                                          checked={allSelected}
                                          ref={(el) => { if (el) el.indeterminate = someSelected; }}
                                          onChange={(e) => { e.stopPropagation(); toggleSelectAll(order.id, selectableItems); }}
                                          disabled={selectableItems.length === 0}
                                          className="rounded border-gray-300 accent-green-600 disabled:opacity-30"
                                        />
                                      </th>
                                    )}
                                    <th className="px-3 py-2">Item</th>
                                    <th className="px-3 py-2">Qty</th>
                                    <th className="px-3 py-2">Status</th>
                                    <th className="px-3 py-2">Est. Finish Date</th>
                                    <th className="px-3 py-2">Actions</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {filteredItems.map((item) => {
                                    const estFinishDate = getItemEstimatedFinishDate(item);
                                    const isSelectable = item.production_status === 'in_progress';
                                    const isChecked = orderSelected.has(item.id);
                                    return (
                                      <tr
                                        key={item.id}
                                        className={`hover:bg-gray-50 ${isChecked ? 'bg-green-50/40' : ''}`}
                                      >
                                        {showFinishedButton && (
                                          <td className="px-3 py-2">
                                            {isSelectable && (
                                              <input
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={(e) => { e.stopPropagation(); toggleSelectItem(order.id, item.id); }}
                                                className="rounded border-gray-300 accent-green-600"
                                              />
                                            )}
                                          </td>
                                        )}
                                        <td className="px-3 py-2 font-medium text-gray-800">{item.name}</td>
                                        <td className="px-3 py-2 text-gray-600">{item.quantity}</td>
                                        <td className="px-3 py-2">
                                          <ItemStatusBadge status={item.production_status} />
                                        </td>
                                        <td className="px-3 py-2 text-gray-600">
                                          {estFinishDate ? (
                                            <span className="text-[11px]">{formatDate(estFinishDate)}</span>
                                          ) : (
                                            <span className="text-[11px] text-gray-400">—</span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2">
                                          <div className="flex flex-wrap gap-1.5">
                                            {showStartButton && item.production_status === 'pending' && (
                                              <button
                                                type="button"
                                                disabled={updatingItemId === item.id}
                                                onClick={(e) => { e.stopPropagation(); handleStartClick(order, item); }}
                                                className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 transition-colors"
                                              >
                                                {updatingItemId === item.id ? 'Starting...' : '▶ Start'}
                                              </button>
                                            )}
                                            {showFinishedButton && item.production_status !== 'pending' && (
                                              <button
                                                type="button"
                                                disabled={updatingItemId === item.id || item.production_status === 'finished'}
                                                onClick={(e) => { e.stopPropagation(); onItemFinished?.(order, item); }}
                                                className="rounded-md border border-green-200 bg-green-50 px-3 py-1 text-[11px] font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50 transition-colors"
                                              >
                                                {updatingItemId === item.id ? 'Saving...' : item.production_status === 'finished' ? '✓ Finished' : '✓ Finish'}
                                              </button>
                                            )}
                                            {showDelayedButton && item.production_status !== 'pending' && item.production_status !== 'finished' && (
                                              <button
                                                type="button"
                                                disabled={updatingItemId === item.id}
                                                onClick={(e) => { e.stopPropagation(); onItemDelayed?.(order, item); }}
                                                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors"
                                              >
                                                {updatingItemId === item.id ? 'Saving...' : '⚠ Delayed'}
                                              </button>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })()
                    )}
                </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Per-item Start Production Modal */}
      {startItemModal.open && startItemModal.order && startItemModal.item && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Start Item Production</h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  {startItemModal.order.quotation_number} · {startItemModal.item.name}
                </p>
              </div>
              <button
                onClick={() => setStartItemModal((prev) => ({ ...prev, open: false }))}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">
                  Estimated production days for this item
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={startItemModal.productionDays}
                    onChange={(e) => setStartItemModal((prev) => ({ ...prev, productionDays: e.target.value }))}
                    placeholder="e.g. 14"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                  />
                  <span className="shrink-0 text-xs text-gray-500">days</span>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setStartItemModal((prev) => ({ ...prev, open: false }))}
                  className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleStartConfirm}
                  disabled={!startItemModal.productionDays || parseInt(startItemModal.productionDays) <= 0}
                  className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Start Production
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────

interface ProductionFinishedSummary {
  hasFinishedProduction: boolean;
  finishedCount: number;
  totalCount: number;
}

function ProductionFinishedTrackingSection({
  orders,
  summaries,
  isLoading,
  error,
  onRetry,
  onViewFiles,
  onItemEnRouteStatus,
  onBulkEnRoute,
  onBulkEnRouteSelected,
}: {
  orders: Order[];
  summaries: Record<string, ProductionFinishedSummary>;
  isLoading: boolean;
  error: any;
  onRetry: () => void;
  onViewFiles?: (o: Order) => void;
  onItemEnRouteStatus?: (orderId: string, item: OrderItem, status: 'not_yet' | 'en_route' | 'arrived') => void;
  onBulkEnRoute?: (order: Order, items: OrderItem[]) => void;
  onBulkEnRouteSelected?: (order: Order, itemIds: string[]) => void;
}) {
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [itemsByOrder, setItemsByOrder] = useState<Record<string, OrderItem[]>>({});
  const [loadingItemsForOrder, setLoadingItemsForOrder] = useState<string | null>(null);
  const [notesByOrder, setNotesByOrder] = useState<Record<string, { id: string; order_id: string; agent_name: string; note: string; created_at: string }[]>>({});
  const [notesLoading, setNotesLoading] = useState<Record<string, boolean>>({});
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState<Record<string, boolean>>({});
  // Multi-select en-route state: per-order set of selected item IDs
  const [selectedEnRouteIds, setSelectedEnRouteIds] = useState<Record<string, Set<string>>>({});

  function toggleEnRouteItem(orderId: string, itemId: string) {
    setSelectedEnRouteIds((prev) => {
      const current = new Set(prev[orderId] ?? []);
      if (current.has(itemId)) current.delete(itemId); else current.add(itemId);
      return { ...prev, [orderId]: current };
    });
  }

  function toggleEnRouteSelectAll(orderId: string, selectableItems: OrderItem[]) {
    setSelectedEnRouteIds((prev) => {
      const current = prev[orderId] ?? new Set<string>();
      const allSelected = selectableItems.every((i) => current.has(i.id));
      return { ...prev, [orderId]: allSelected ? new Set() : new Set(selectableItems.map((i) => i.id)) };
    });
  }

  async function toggleOrderItems(order: Order) {
    if (expandedOrderId === order.id) {
      setExpandedOrderId(null);
      setSelectedEnRouteIds((prev) => { const next = { ...prev }; delete next[order.id]; return next; });
      return;
    }
    setExpandedOrderId(order.id);
    if (!itemsByOrder[order.id]) {
      setLoadingItemsForOrder(order.id);
      try {
        const res = await getOrderItems(order.id);
        setItemsByOrder((prev) => ({ ...prev, [order.id]: res.items ?? [] }));
      } catch {
        setItemsByOrder((prev) => ({ ...prev, [order.id]: [] }));
      } finally {
        setLoadingItemsForOrder(null);
      }
    }
  }

  async function loadNotes(orderId: string) {
    if (notesByOrder[orderId]) return;
    setNotesLoading((prev) => ({ ...prev, [orderId]: true }));
    try {
      const notes = await getOrderNotes(orderId);
      setNotesByOrder((prev) => ({ ...prev, [orderId]: notes }));
    } catch {
      setNotesByOrder((prev) => ({ ...prev, [orderId]: [] }));
    } finally {
      setNotesLoading((prev) => ({ ...prev, [orderId]: false }));
    }
  }

  async function handleAddNote(orderId: string) {
    const text = noteInputs[orderId]?.trim();
    if (!text) return;
    setSavingNote((prev) => ({ ...prev, [orderId]: true }));
    try {
      const newNote = await postProductionNote(orderId, text);
      setNotesByOrder((prev) => ({
        ...prev,
        [orderId]: [newNote, ...(prev[orderId] ?? [])],
      }));
      setNoteInputs((prev) => ({ ...prev, [orderId]: '' }));
    } catch {
      // silently fail
    } finally {
      setSavingNote((prev) => ({ ...prev, [orderId]: false }));
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <div className="flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <h2 className="font-semibold text-gray-800">Production Finished</h2>
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">{orders.length}</span>
        </div>
        <button onClick={onRetry} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#2490ef]">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {error ? (
        <div className="px-6 py-8 text-center">
          <p className="text-sm text-red-500">Failed to load orders</p>
          <button onClick={onRetry} className="mt-2 text-xs text-[#2490ef] hover:underline">Retry</button>
        </div>
      ) : isLoading ? (
        <div className="space-y-3 p-6">
          {[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />)}
        </div>
      ) : orders.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">No orders with finished production items awaiting inventory arrival verification</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-6 py-3">Order #</th>
                <th className="px-4 py-3">Client Name</th>
                <th className="px-4 py-3">Production Finished</th>
                <th className="px-4 py-3">Dispatch Pending</th>
                <th className="px-4 py-3">Estimated Inventory Arrival Date</th>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orders.map((order) => {
                const summary = summaries[order.id];
                const estimatedArrival = getEstimatedInventoryArrivalDate(order);
                const orderItems = itemsByOrder[order.id] ?? [];
                const enRouteVerified = getEnRouteVerificationText(order, orderItems) !== 'Pending';
                const isExpanded = expandedOrderId === order.id;
                const orderNotes = notesByOrder[order.id] ?? [];
                const isNotesLoading = notesLoading[order.id];
                const isSaving = savingNote[order.id];
                const noteValue = noteInputs[order.id] ?? '';
                return (
                  <Fragment key={order.id}>
                    <tr
                      onClick={() => toggleOrderItems(order)}
                      className="cursor-pointer hover:bg-gray-50/60"
                    >
                      <td className="px-6 py-4 font-medium text-gray-900">
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                          <QuotationNumberCell order={order} onViewFiles={onViewFiles} />
                        </div>
                      </td>
                      <td className="px-4 py-4 text-gray-700">{order.client_name ?? 'Unknown client'}</td>
                      <td className="px-4 py-4">
                        <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">
                          {summary ? `${summary.finishedCount}/${summary.totalCount} item${summary.totalCount === 1 ? '' : 's'}` : 'At least 1 item'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${enRouteVerified ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                          {getEnRouteVerificationText(order)}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-gray-700">
                        {estimatedArrival ? formatDate(estimatedArrival) : <span className="text-gray-400">Pending en-route days</span>}
                      </td>
                      <td className="px-4 py-4"><StageBadge stage={order.current_stage} /></td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-400">
                            {orderNotes.length > 0 ? `${orderNotes.length} note${orderNotes.length === 1 ? '' : 's'}` : 'No notes'}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              loadNotes(order.id);
                              if (!isExpanded) toggleOrderItems(order);
                            }}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-[#2490ef]"
                            title="View notes"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${order.id}-items`} className="bg-gray-50/70">
                        <td colSpan={7} className="px-6 py-4">
                          {/* Notes section */}
                          <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3">
                            <div className="mb-2 flex items-center gap-2">
                              <MessageSquare className="h-3.5 w-3.5 text-gray-400" />
                              <span className="text-xs font-semibold text-gray-600">Notes</span>
                            </div>
                            <div className="mb-2 flex gap-2">
                              <input
                                type="text"
                                value={noteValue}
                                onChange={(e) => setNoteInputs((prev) => ({ ...prev, [order.id]: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !isSaving) {
                                    e.preventDefault();
                                    handleAddNote(order.id);
                                  }
                                }}
                                placeholder="Add a note about this order..."
                                className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                                disabled={isSaving}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <button
                                onClick={(e) => { e.stopPropagation(); handleAddNote(order.id); }}
                                disabled={isSaving || !noteValue.trim()}
                                className="rounded-lg bg-[#2490ef] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1a7ad9] disabled:opacity-50"
                              >
                                {isSaving ? 'Saving...' : 'Add'}
                              </button>
                            </div>
                            {isNotesLoading ? (
                              <div className="py-2 text-center text-xs text-gray-400">Loading notes...</div>
                            ) : orderNotes.length === 0 ? (
                              <div className="py-2 text-center text-xs text-gray-400">No notes yet. Add a note above.</div>
                            ) : (
                              <div className="max-h-40 space-y-1.5 overflow-y-auto">
                                {orderNotes.map((n) => (
                                  <div key={n.id} className="rounded-md bg-gray-50 px-3 py-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[10px] font-medium text-gray-500">{n.agent_name}</span>
                                      <span className="text-[10px] text-gray-400">{new Date(n.created_at).toLocaleString()}</span>
                                    </div>
                                    <p className="mt-0.5 text-xs text-gray-700">{n.note}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          {/* Items table */}
                          {loadingItemsForOrder === order.id ? (
                            <div className="text-xs text-gray-400">Loading item list...</div>
                          ) : orderItems.length === 0 ? (
                            <div className="text-xs text-gray-400">No item records found for this order.</div>
                          ) : (() => {
                            const orderSelected = selectedEnRouteIds[order.id] ?? new Set<string>();
                            const selectableItems = orderItems.filter((i) => i.production_status === 'finished' && i.en_route_status !== 'arrived');
                            const allSelected = selectableItems.length > 0 && selectableItems.every((i) => orderSelected.has(i.id));
                            const someSelected = orderSelected.size > 0 && !allSelected;
                            return (
                            <div>
                              {/* Toolbar */}
                              <div className="mb-2 flex items-center justify-end gap-2">
                                {onBulkEnRouteSelected && orderSelected.size > 0 && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onBulkEnRouteSelected(order, Array.from(orderSelected)); }}
                                    className="rounded-md border border-sky-300 bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-sky-700 transition-colors"
                                  >
                                    🚚 Mark Selected En Route ({orderSelected.size})
                                  </button>
                                )}
                                {onBulkEnRoute && (() => {
                                  const notYetItems = orderItems.filter((i) => i.en_route_status === 'not_yet');
                                  if (notYetItems.length === 0) return null;
                                  return (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); onBulkEnRoute(order, orderItems); }}
                                      className="rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-[11px] font-semibold text-sky-700 hover:bg-sky-100 transition-colors"
                                    >
                                      🚚 Mark All En Route ({notYetItems.length})
                                    </button>
                                  );
                                })()}
                              </div>
                              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                              <table className="w-full text-left text-xs">
                                <thead className="bg-gray-50 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                  <tr>
                                    <th className="w-8 px-3 py-2">
                                      <input
                                        type="checkbox"
                                        title="Select all"
                                        checked={allSelected}
                                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                                        onChange={(e) => { e.stopPropagation(); toggleEnRouteSelectAll(order.id, selectableItems); }}
                                        disabled={selectableItems.length === 0}
                                        className="rounded border-gray-300 accent-sky-600 disabled:opacity-30"
                                      />
                                    </th>
                                    <th className="px-3 py-2">Item</th>
                                    <th className="px-3 py-2">Qty</th>
                                    <th className="px-3 py-2">Production</th>
                                    <th className="px-3 py-2">Production Finished Date</th>
                                    <th className="px-3 py-2">En Route</th>
                                    <th className="px-3 py-2">Item Arrival Days</th>
                                    <th className="px-3 py-2">Estimated Inventory Arrival Date</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {orderItems.map((item) => {
                                    const itemArrival = getEstimatedItemInventoryArrivalDate(order, item);
                                    const itemProductionFinishedDate = getItemProductionFinishedDate(item);
                                    const isSelectable = item.production_status === 'finished' && item.en_route_status !== 'arrived';
                                    const isChecked = orderSelected.has(item.id);
                                    return (
                                      <tr key={item.id} className={isChecked ? 'bg-sky-50/40' : ''}>
                                        <td className="px-3 py-2">
                                          {isSelectable && (
                                            <input
                                              type="checkbox"
                                              checked={isChecked}
                                              onChange={(e) => { e.stopPropagation(); toggleEnRouteItem(order.id, item.id); }}
                                              className="rounded border-gray-300 accent-sky-600"
                                            />
                                          )}
                                        </td>
                                        <td className="px-3 py-2 font-medium text-gray-800">{item.name}</td>
                                        <td className="px-3 py-2 text-gray-600">{item.quantity}</td>
                                        <td className="px-3 py-2">
                                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.production_status === 'finished' ? 'bg-green-100 text-green-700' : item.production_status === 'in_progress' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                                            {formatStatusLabel(item.production_status)}
                                          </span>
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">
                                          {itemProductionFinishedDate ? formatDate(itemProductionFinishedDate) : <span className="text-gray-400">Not finished</span>}
                                        </td>
                                        <td className="px-3 py-2">
                                          <div className="flex items-center gap-2">
                                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.en_route_status === 'arrived' ? 'bg-green-100 text-green-700' : item.en_route_status === 'en_route' ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-500'}`}>
                                              {formatStatusLabel(item.en_route_status)}
                                            </span>
                                            {item.production_status === 'finished' && item.en_route_status !== 'arrived' && onItemEnRouteStatus && (
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  onItemEnRouteStatus(order.id, item, item.en_route_status === 'en_route' ? 'not_yet' : 'en_route');
                                                }}
                                                className="rounded px-1.5 py-0.5 text-[10px] font-medium text-sky-600 hover:bg-sky-50"
                                                title={item.en_route_status === 'en_route' ? 'Mark not en route' : 'Mark en route'}
                                              >
                                                {item.en_route_status === 'en_route' ? 'Undo' : 'Mark En Route'}
                                              </button>
                                            )}
                                          </div>
                                        </td>
                                        <td className="px-3 py-2 text-gray-600">{item.estimated_arrival_days ? `${item.estimated_arrival_days} day(s)` : '\u2014'}</td>
                                        <td className="px-3 py-2 text-gray-700">
                                          {itemArrival ? formatDate(itemArrival) : <span className="text-gray-400">Pending en-route days</span>}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                            );
                          })()}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

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
  const { data: inProgressStageOrders = [], isLoading: loadingInProgress, error: errorInProgress, mutate: mutateInProgress } =
    useOrdersByStage('production_in_progress');
  const { data: enRouteOrders = [], isLoading: loadingEnRoute, error: errorEnRoute, mutate: mutateEnRoute } =
    useOrdersByStage('en_route');
  const { data: enRouteVerificationStageOrders = [], isLoading: loadingEnRouteStage, error: errorEnRouteStage, mutate: mutateEnRouteStage } =
    useOrdersByStage('en_route_verification');
  const { data: inventoryVerificationOrders = [], isLoading: loadingInventoryVerification, error: errorInventoryVerification, mutate: mutateInventoryVerification } =
    useOrdersByStage('inventory_verification');
  const { data: inventoryArrivedOrders = [], isLoading: loadingInventoryArrived, error: errorInventoryArrived, mutate: mutateInventoryArrived } =
    useOrdersByStage('inventory_arrived');

  // Fetch item completion for en_route orders so we can split them into
  // "Dispatch Pending" (some items not yet en_route) vs "En Route — In Transit" (all tracking)
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

  const productionFinishedCandidateOrders = dedupeOrders([
    ...partialOrders,
    ...inProgressStageOrders,
    ...enRouteOrders,
    ...enRouteVerificationStageOrders,
    ...inventoryVerificationOrders,
    ...inventoryArrivedOrders,
  ]);
  const productionFinishedCandidateKey = productionFinishedCandidateOrders.map((o) => o.id).sort().join('|');
  const [productionFinishedSummaries, setProductionFinishedSummaries] = useState<Record<string, ProductionFinishedSummary>>({});

  useEffect(() => {
    if (productionFinishedCandidateOrders.length === 0) {
      setProductionFinishedSummaries({});
      return;
    }
    let cancelled = false;
    async function fetchProductionFinishedSummaries() {
      const map: Record<string, ProductionFinishedSummary> = {};
      await Promise.all(
        productionFinishedCandidateOrders.map(async (order: Order) => {
          try {
            const res = await getOrderItems(order.id);
            const items = res.items ?? [];
            const finishedCount = items.filter((item) => item.production_status === 'finished').length;
            if (!cancelled) {
              map[order.id] = {
                hasFinishedProduction: finishedCount > 0,
                finishedCount,
                totalCount: items.length,
              };
            }
          } catch { /* ignore per-order item errors */ }
        })
      );
      if (!cancelled) setProductionFinishedSummaries(map);
    }
    fetchProductionFinishedSummaries();
    return () => { cancelled = true; };
  }, [productionFinishedCandidateKey]);

  const finishedOrders = productionFinishedCandidateOrders.filter((order) => {
    const summary = productionFinishedSummaries[order.id];
    return summary?.hasFinishedProduction && !['balance_due', 'delivery_pending', 'delivery_scheduled', 'delivered', 'payment_received', 'payment_confirmed', 'completed'].includes(order.current_stage);
  });
  const loadingFinished = loadingPartial || loadingInProgress || loadingEnRoute || loadingEnRouteStage || loadingInventoryVerification || loadingInventoryArrived;
  const errorFinished = errorPartial || errorInProgress || errorEnRoute || errorEnRouteStage || errorInventoryVerification || errorInventoryArrived;

  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingOrder, setDeletingOrder] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Production days modal — per-item input before starting production
  const [prodDaysModal, setProdDaysModal] = useState<{
    open: boolean;
    order: Order | null;
    items: OrderItem[];
    loadingItems: boolean;
  }>({ open: false, order: null, items: [], loadingItems: false });
  const [itemDays, setItemDays] = useState<Record<string, string>>({});
  const [overallProductionDays, setOverallProductionDays] = useState('');

  // File viewer state
  const { viewingFilesOrder, orderFiles, handleViewFiles, refreshFiles, closeViewer } = useOrderFileViewer();
  const [otpModal, setOtpModal] = useState<{
    open: boolean; title: string; description: string; pendingAction: 'edit' | 'delete' | 'reportStatus' | 'finishProduction' | 'confirmEnRoute' | 'proceedInventoryVerification' | 'grantProductionException' | 'revokeProductionException' | 'setProduction' | 'stockReplenishment' | 'itemFinish' | 'itemDelayed' | 'itemProductionStatus' | 'itemEnRouteStatus' | 'itemStartConfirm' | 'bulkFinish' | 'bulkEnRoute' | 'bulkFinishSelected' | 'bulkEnRouteSelected';
  }>({ open: false, title: '', description: '', pendingAction: 'edit' });

  // Stock replenishment modal state
  const [stockReplModal, setStockReplModal] = useState(false);
  const [stockReplFile, setStockReplFile] = useState<File | null>(null);
  const [stockReplLabel, setStockReplLabel] = useState('');
  const [stockReplUploading, setStockReplUploading] = useState(false);
  const [stockReplError, setStockReplError] = useState('');
  const [stockReplSuccess, setStockReplSuccess] = useState<{ ref: string; itemCount: number; items: Array<{ name: string; quantity: number }> } | null>(null);
  const stockReplFileRef = useRef<HTMLInputElement>(null);

  // Per-item production action state
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);

  function refresh() { mutatePending(); mutatePartial(); mutateEnRoute(); mutateEnRouteStage(); mutateInventoryVerification(); mutateInventoryArrived(); mutateInProgress(); }

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
    else if (otpModal.pendingAction === 'proceedInventoryVerification') handleProceedInventoryVerificationVerified(actionToken);
    else if (otpModal.pendingAction === 'setProduction') handleStartProductionVerified(actionToken);
    else if (otpModal.pendingAction === 'grantProductionException') handleGrantExceptionVerified(actionToken);
    else if (otpModal.pendingAction === 'revokeProductionException') handleRevokeExceptionVerified(actionToken);
    else if (otpModal.pendingAction === 'stockReplenishment') handleStockReplVerified(actionToken);
    else if (otpModal.pendingAction === 'itemFinish') handleItemFinishVerified(actionToken);
    else if (otpModal.pendingAction === 'itemDelayed') handleItemDelayedVerified(actionToken);
    else if (otpModal.pendingAction === 'bulkFinish') handleBulkFinishVerified(actionToken);
    else if (otpModal.pendingAction === 'bulkEnRoute') handleBulkEnRouteVerified(actionToken);
    else if (otpModal.pendingAction === 'bulkFinishSelected') handleBulkFinishSelectedVerified(actionToken);
    else if (otpModal.pendingAction === 'bulkEnRouteSelected') handleBulkEnRouteSelectedVerified(actionToken);
    else if (otpModal.pendingAction === 'itemProductionStatus') handleItemProductionStatusVerified(actionToken);
    else if (otpModal.pendingAction === 'itemEnRouteStatus') handleItemEnRouteStatusVerified(actionToken);
    else if (otpModal.pendingAction === 'itemStartConfirm') handleItemStartConfirmVerified(actionToken);
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
      // Save per-item production days AND mark items as in_progress
      if (pending.itemDays && Object.keys(pending.itemDays).length > 0) {
        await Promise.all(
          Object.entries(pending.itemDays as Record<string, number>).map(([itemId, days]) =>
            updateOrderItem(pending.orderId, itemId, {
              estimated_production_days: days,
              production_status: 'in_progress',
            })
          )
        );
      }
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

  async function handleProceedInventoryVerificationVerified(actionToken: string) {
    const pending = (window as any).__pendingProceedInventoryVerificationData;
    if (!pending) return;
    try {
      await recordStageUpdate({
        quotation_number: pending.quotationNumber,
        stage: 'inventory_verification',
        status: 'manual_advanced',
        remarks: 'Items arrived early; manually proceeded from En Route Awaiting Arrival to Inventory Verification.',
        updated_by: 'dashboard_quick_action',
        action_token: actionToken,
      });
      refresh();
    } catch (err: any) { alert('Failed to proceed to inventory verification: ' + (err.message ?? 'Unknown error')); }
    finally { (window as any).__pendingProceedInventoryVerificationData = null; }
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
    setProdDaysModal({ open: true, order, items: [], loadingItems: true });
    setItemDays({});
    setOverallProductionDays(order.estimated_production_days?.toString() ?? '');
    try {
      const res = await getOrderItems(order.id);
      const items = res.items ?? [];
      const initialDays: Record<string, string> = {};
      for (const item of items) {
        initialDays[item.id] = item.estimated_production_days?.toString() ?? '';
      }
      setItemDays(initialDays);
      // Auto-set overall to max of existing item days if no order-level days set
      if (!order.estimated_production_days && items.length > 0) {
        const maxDays = Math.max(0, ...Object.values(initialDays).map((v) => parseInt(v) || 0));
        if (maxDays > 0) setOverallProductionDays(maxDays.toString());
      }
      setProdDaysModal({ open: true, order, items, loadingItems: false });
    } catch {
      setProdDaysModal({ open: true, order, items: [], loadingItems: false });
    }
  }

  function handleProdDaysConfirm() {
    const days = parseInt(overallProductionDays.replace(/[^0-9]/g, ''));
    if (!days || days <= 0) { alert('Please enter a valid overall number of production days.'); return; }
    const pendingItemDays: Record<string, number> = {};
    for (const [id, val] of Object.entries(itemDays)) {
      const d = parseInt(val.replace(/[^0-9]/g, ''));
      if (d > 0) pendingItemDays[id] = d;
    }
    const order = prodDaysModal.order!;
    setProdDaysModal((prev) => ({ ...prev, open: false }));
    setOtpModal({
      open: true,
      title: 'Start Production',
      description: `You are about to start production for order "${order.quotation_number ?? '—'}" with ${days} day(s) overall estimate. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'setProduction',
    });
    (window as any).__pendingStartProductionData = { orderId: order.id, days, itemDays: pendingItemDays };
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

  async function handleProceedInventoryVerification(order: Order) {
    if (!order.quotation_number) { alert('Cannot proceed: this order has no quotation number.'); return; }
    if (!window.confirm(`Proceed order "${order.quotation_number}" to Inventory Verification now? Use this when items arrived earlier than the estimated arrival date.`)) return;
    setOtpModal({ open: true, title: 'Proceed to Inventory Verification',
      description: `You are about to manually move order "${order.quotation_number}" to Inventory Verification because items arrived early. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'proceedInventoryVerification' });
    (window as any).__pendingProceedInventoryVerificationData = { orderId: order.id, quotationNumber: order.quotation_number };
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

  function handleOpenStockRepl() {
    setStockReplSuccess(null);
    setStockReplError('');
    setStockReplFile(null);
    setStockReplLabel('');
    if (stockReplFileRef.current) stockReplFileRef.current.value = '';
    setStockReplModal(true);
  }

  function handleCloseStockRepl() {
    setStockReplModal(false);
    setStockReplSuccess(null);
    setStockReplError('');
    setStockReplFile(null);
    setStockReplLabel('');
    if (stockReplFileRef.current) stockReplFileRef.current.value = '';
  }

  function handleCreateStockReplenishment() {
    if (!stockReplFile) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      (window as any).__pendingStockRepl = {
        base64,
        mime_type: stockReplFile.type || 'application/octet-stream',
        filename: stockReplFile.name,
        label: stockReplLabel.trim() || undefined,
      };
      setOtpModal({
        open: true,
        title: 'Create Stock Replenishment Order',
        description: 'Enter the OTP sent to your email to confirm the stock replenishment order creation.',
        pendingAction: 'stockReplenishment',
      });
    };
    reader.readAsDataURL(stockReplFile);
  }

  async function handleStockReplVerified(actionToken: string) {
    const pending = (window as any).__pendingStockRepl;
    if (!pending) return;
    setStockReplUploading(true);
    setStockReplError('');
    try {
      const result = await createStockReplenishmentOrder(
        pending.base64, pending.mime_type, pending.filename, actionToken, pending.label
      );
      setStockReplSuccess({ ref: result.order.quotation_number ?? 'N/A', itemCount: result.items_created, items: result.items });
      setStockReplFile(null);
      setStockReplLabel('');
      if (stockReplFileRef.current) stockReplFileRef.current.value = '';
      refresh();
    } catch (err: any) {
      setStockReplError(err.message ?? 'Failed to create stock replenishment order');
    } finally {
      setStockReplUploading(false);
      (window as any).__pendingStockRepl = null;
    }
  }

  // ── Per-item production action handlers ──────────────────────────────

  async function handleItemFinish(order: Order, item: OrderItem) {
    setOtpModal({
      open: true,
      title: 'Finish Item Production',
      description: `You are about to mark item "${item.name}" in order "${order.quotation_number ?? '—'}" as finished. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'itemFinish',
    });
    (window as any).__pendingItemFinishData = { orderId: order.id, itemId: item.id };
  }

  async function handleItemFinishVerified(actionToken: string) {
    const pending = (window as any).__pendingItemFinishData;
    if (!pending) return;
    setUpdatingItemId(pending.itemId);
    try {
      await updateOrderItem(pending.orderId, pending.itemId, { production_status: 'finished', action_token: actionToken });
      refresh();
    } catch (err: any) {
      alert('Failed to finish item: ' + (err.message ?? 'Unknown error'));
    } finally {
      setUpdatingItemId(null);
      (window as any).__pendingItemFinishData = null;
    }
  }

  async function handleItemDelayed(order: Order, item: OrderItem) {
    const input = window.prompt('How many days delayed for this item?', '1');
    if (!input) return;
    const days = Number(input.replace(/[^0-9]/g, ''));
    if (!Number.isInteger(days) || days < 0) { alert('Please enter a valid delay in days.'); return; }
    setOtpModal({
      open: true,
      title: 'Report Item Delay',
      description: `You are about to report item "${item.name}" in order "${order.quotation_number ?? '—'}" as delayed by ${days} day(s). Enter the OTP sent to your email to confirm.`,
      pendingAction: 'itemDelayed',
    });
    (window as any).__pendingItemDelayedData = { orderId: order.id, itemId: item.id, delayDays: days };
  }

  async function handleItemDelayedVerified(actionToken: string) {
    const pending = (window as any).__pendingItemDelayedData;
    if (!pending) return;
    setUpdatingItemId(pending.itemId);
    try {
      await updateOrderItem(pending.orderId, pending.itemId, {
        production_status: 'in_progress',
        action_token: actionToken,
      } as any);
      // Note: delay tracking is done via the order-level reportProductionStatus API.
      // For item-level, we just keep the item in in_progress status with the OTP audit trail.
      refresh();
    } catch (err: any) {
      alert('Failed to report item delay: ' + (err.message ?? 'Unknown error'));
    } finally {
      setUpdatingItemId(null);
      (window as any).__pendingItemDelayedData = null;
    }
  }

  // ── Bulk finish all items ────────────────────────────────────────────

  function handleBulkFinish(order: Order) {
    setOtpModal({
      open: true,
      title: 'Finish All Items',
      description: `You are about to mark all unfinished items in order "${order.quotation_number ?? '—'}" as finished. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'bulkFinish',
    });
    (window as any).__pendingBulkFinishData = { orderId: order.id };
  }

  async function handleBulkFinishVerified(actionToken: string) {
    const pending = (window as any).__pendingBulkFinishData;
    if (!pending) return;
    try {
      await finishAllItems(pending.orderId, { action_token: actionToken });
      refresh();
    } catch (err: any) {
      alert('Failed to finish all items: ' + (err.message ?? 'Unknown error'));
    } finally {
      (window as any).__pendingBulkFinishData = null;
    }
  }

  // ── Bulk finish selected items ───────────────────────────────────────

  function handleBulkFinishSelected(order: Order, itemIds: string[]) {
    const names = itemIds.length === 1 ? '1 item' : `${itemIds.length} items`;
    setOtpModal({
      open: true,
      title: 'Finish Selected Items',
      description: `You are about to mark ${names} in order "${order.quotation_number ?? '—'}" as finished. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'bulkFinishSelected',
    });
    (window as any).__pendingBulkFinishSelectedData = { orderId: order.id, itemIds };
  }

  async function handleBulkFinishSelectedVerified(actionToken: string) {
    const pending = (window as any).__pendingBulkFinishSelectedData as { orderId: string; itemIds: string[] } | null;
    if (!pending) return;
    try {
      await Promise.all(
        pending.itemIds.map((itemId) =>
          updateOrderItem(pending.orderId, itemId, { production_status: 'finished', action_token: actionToken })
        )
      );
      refresh();
    } catch (err: any) {
      alert('Failed to finish selected items: ' + (err.message ?? 'Unknown error'));
    } finally {
      (window as any).__pendingBulkFinishSelectedData = null;
    }
  }

  // ── Bulk en route all items ──────────────────────────────────────────

  function handleBulkEnRoute(order: Order, items: OrderItem[]) {
    const itemsNeedingDays = items.filter((i) => i.en_route_status === 'not_yet' && !i.estimated_arrival_days);
    let defaultDays: number | undefined;
    if (itemsNeedingDays.length > 0) {
      const input = window.prompt(
        `${itemsNeedingDays.length} item(s) missing arrival days. Default arrival days for all?`,
        '28'
      );
      if (input === null) return;
      const days = parseInt(input.replace(/[^0-9]/g, ''), 10);
      if (!days || days <= 0) { alert('Please enter a valid number of days.'); return; }
      defaultDays = days;
    }
    setOtpModal({
      open: true,
      title: 'Mark All En Route',
      description: `You are about to mark all not-yet items in order "${order.quotation_number ?? '—'}" as en route. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'bulkEnRoute',
    });
    (window as any).__pendingBulkEnRouteData = { orderId: order.id, defaultDays };
  }

  async function handleBulkEnRouteVerified(actionToken: string) {
    const pending = (window as any).__pendingBulkEnRouteData;
    if (!pending) return;
    try {
      await bulkEnRoute(pending.orderId, { action_token: actionToken, default_arrival_days: pending.defaultDays });
      refresh();
    } catch (err: any) {
      alert('Failed to mark all items en route: ' + (err.message ?? 'Unknown error'));
    } finally {
      (window as any).__pendingBulkEnRouteData = null;
    }
  }

  // ── Bulk en route selected items ─────────────────────────────────────

  function handleBulkEnRouteSelected(order: Order, itemIds: string[]) {
    const names = itemIds.length === 1 ? '1 item' : `${itemIds.length} items`;
    // Prompt for arrival days once, applied to all selected items that don't have one
    const input = window.prompt(`Estimated arrival days for ${names}? (applied to items missing arrival days)`, '28');
    if (input === null) return;
    const days = parseInt(input.replace(/[^0-9]/g, ''), 10);
    if (!days || days <= 0) { alert('Please enter a valid number of days.'); return; }
    setOtpModal({
      open: true,
      title: 'Mark Selected En Route',
      description: `You are about to mark ${names} in order "${order.quotation_number ?? '—'}" as en route. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'bulkEnRouteSelected',
    });
    (window as any).__pendingBulkEnRouteSelectedData = { orderId: order.id, itemIds, defaultDays: days };
  }

  async function handleBulkEnRouteSelectedVerified(actionToken: string) {
    const pending = (window as any).__pendingBulkEnRouteSelectedData as { orderId: string; itemIds: string[]; defaultDays: number } | null;
    if (!pending) return;
    try {
      await Promise.all(
        pending.itemIds.map((itemId) =>
          updateOrderItem(pending.orderId, itemId, {
            en_route_status: 'en_route',
            estimated_arrival_days: pending.defaultDays,
            action_token: actionToken,
          })
        )
      );
      refresh();
    } catch (err: any) {
      alert('Failed to mark selected items en route: ' + (err.message ?? 'Unknown error'));
    } finally {
      (window as any).__pendingBulkEnRouteSelectedData = null;
    }
  }

  // ── Item production status (from ProductionInfoCards) ────────────────

  // These are called from ProductionInfoCards which has access to the order
  // We store the orderId alongside the item data
  function handleItemProductionStatusAction(orderId: string, item: OrderItem, status: 'pending' | 'in_progress' | 'finished') {
    setOtpModal({
      open: true,
      title: 'Update Item Production Status',
      description: `You are about to change production status of item "${item.name}" to "${status}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'itemProductionStatus',
    });
    (window as any).__pendingItemProductionStatusData = { orderId, item, status };
  }

  async function handleItemProductionStatusVerified(actionToken: string) {
    const pending = (window as any).__pendingItemProductionStatusData;
    if (!pending) return;
    const { orderId, item, status } = pending as { orderId: string; item: OrderItem; status: 'pending' | 'in_progress' | 'finished' };
    setUpdatingItemId(item.id);
    try {
      await updateOrderItem(orderId, item.id, { production_status: status, action_token: actionToken });
      // If starting production on an item and the order doesn't have production_started,
      // also set production_started on the order so agent reminders fire correctly
      if (status === 'in_progress') {
        try {
          await setProduction(orderId, { production_started: true, action_token: actionToken });
        } catch {
          // Non-fatal: item status was already updated, order-level flag is a bonus
        }
      }
      refresh();
    } catch (err: any) {
      alert('Failed to update item production status: ' + (err.message ?? 'Unknown error'));
    } finally {
      setUpdatingItemId(null);
      (window as any).__pendingItemProductionStatusData = null;
    }
  }

  function handleItemEnRouteStatusAction(orderId: string, item: OrderItem, enRouteStatus: 'not_yet' | 'en_route' | 'arrived') {
    let estimatedArrivalDays: number | null = item.estimated_arrival_days ?? null;
    if (enRouteStatus === 'en_route' && !estimatedArrivalDays) {
      const input = window.prompt(`Estimated arrival days for "${item.name}"?`, '28');
      if (input === null) return;
      const days = parseInt(input.replace(/[^0-9]/g, ''), 10);
      if (!days || days <= 0) { alert('Please enter a valid number of days.'); return; }
      estimatedArrivalDays = days;
    }
    setOtpModal({
      open: true,
      title: 'Update Item En Route Status',
      description: `You are about to change en route status of item "${item.name}" to "${enRouteStatus}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'itemEnRouteStatus',
    });
    (window as any).__pendingItemEnRouteStatusData = { orderId, item, enRouteStatus, estimatedArrivalDays };
  }

  async function handleItemEnRouteStatusVerified(actionToken: string) {
    const pending = (window as any).__pendingItemEnRouteStatusData;
    if (!pending) return;
    const { orderId, item, enRouteStatus, estimatedArrivalDays } = pending as {
      orderId: string; item: OrderItem; enRouteStatus: 'not_yet' | 'en_route' | 'arrived'; estimatedArrivalDays: number | null;
    };
    setUpdatingItemId(item.id);
    try {
      await updateOrderItem(orderId, item.id, {
        en_route_status: enRouteStatus,
        ...(estimatedArrivalDays != null ? { estimated_arrival_days: estimatedArrivalDays } : {}),
        action_token: actionToken,
      });
      refresh();
    } catch (err: any) {
      alert('Failed to update en route status: ' + (err.message ?? 'Unknown error'));
    } finally {
      setUpdatingItemId(null);
      (window as any).__pendingItemEnRouteStatusData = null;
    }
  }

  // ── Item start confirm (from ProductionItemSection) ──────────────────

  function handleItemStartConfirm(order: Order, item: OrderItem, days: number) {
    setOtpModal({
      open: true,
      title: 'Start Item Production',
      description: `You are about to start production for item "${item.name}" in order "${order.quotation_number ?? '—'}" with ${days} day(s) estimate. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'itemStartConfirm',
    });
    (window as any).__pendingItemStartConfirmData = { orderId: order.id, itemId: item.id, days };
  }

  async function handleItemStartConfirmVerified(actionToken: string) {
    const pending = (window as any).__pendingItemStartConfirmData;
    if (!pending) return;
    setUpdatingItemId(pending.itemId);
    try {
      await updateOrderItem(pending.orderId, pending.itemId, {
        estimated_production_days: pending.days,
        production_status: 'in_progress',
        action_token: actionToken,
      });
      refresh();
    } catch (err: any) {
      alert('Failed to start production for item: ' + (err.message ?? 'Unknown error'));
    } finally {
      setUpdatingItemId(null);
      (window as any).__pendingItemStartConfirmData = null;
    }
  }

  // ── Wrapper callbacks for OrderRow → ProductionInfoCards ──────────────
  // These capture the order ID so ProductionInfoCards can trigger OTP-based item actions
  function makeItemProductionStatusHandler(order: Order) {
    return (item: OrderItem, status: 'pending' | 'in_progress' | 'finished') => {
      handleItemProductionStatusAction(order.id, item, status);
    };
  }
  function makeItemEnRouteStatusHandler(order: Order) {
    return (item: OrderItem, status: 'not_yet' | 'en_route' | 'arrived') => {
      handleItemEnRouteStatusAction(order.id, item, status);
    };
  }

  // Merge partial_production orders into Production In Progress section too,
  // so the same order# can appear in both Partial Production (pending items)
  // and Production In Progress (started/finished items)
  const inProgressMergedOrders = dedupeOrders([...inProgressStageOrders, ...partialOrders]);

  const totalActive = pendingOrders.length + partialOrders.length + inProgressStageOrders.length + finishedOrders.length + enRouteOrders.length + enRouteVerificationStageOrders.length + inventoryVerificationOrders.length + inventoryArrivedOrders.length;

  return (
    <div className="space-y-6">
      {/* Header info */}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
        <div className="flex items-start justify-between gap-3">
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
          <button
            onClick={handleOpenStockRepl}
            className="shrink-0 flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            <Package className="h-3.5 w-3.5" />
            Stock Replenishment
          </button>
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
            <OrderRow order={order} onEdit={handleEdit} onDelete={handleDeleteClick} onViewFiles={handleViewFiles} onStartProduction={handleStartProduction}
              onItemProductionStatus={makeItemProductionStatusHandler(order)}
              onItemEnRouteStatus={makeItemEnRouteStatusHandler(order)}
            />
            {editingOrder?.id === order.id && (
              <EditForm order={order} onSave={handleEditSave} onCancel={handleCancelEdit} saving={saving} />
            )}
          </>
        )}
      </OrderSection>

      {/* Partial Production — shows only items that are still pending (not started) */}
      <ProductionItemSection
        icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
        title="Partial Production"
        count={partialOrders.length}
        countBg="bg-amber-100" countText="text-amber-700"
        orders={partialOrders}
        isLoading={loadingPartial}
        error={errorPartial}
        onRetry={() => mutatePartial()}
        emptyText="No orders with partial production pending"
        itemFilter={(item) => item.production_status === 'pending'}
        showStartButton={true}
        showFinishedButton={false}
        showDelayedButton={false}
        onItemStartConfirm={handleItemStartConfirm}
        onViewFiles={handleViewFiles}
        onEdit={handleEdit}
        onDelete={handleDeleteClick}
        updatingItemId={updatingItemId}
        onFinishProduction={handleFinishProduction}
      />

      {/* Production In Progress — shows only started/finished items from both production_in_progress AND partial_production stages */}
      <ProductionItemSection
        icon={<Factory className="h-4 w-4 text-indigo-500" />}
        title="Production In Progress"
        count={inProgressMergedOrders.length}
        countBg="bg-indigo-100" countText="text-indigo-700"
        orders={inProgressMergedOrders}
        isLoading={loadingInProgress || loadingPartial}
        error={errorInProgress || errorPartial}
        onRetry={() => { mutateInProgress(); mutatePartial(); }}
        emptyText="No orders in production"
        itemFilter={(item) => item.production_status !== 'pending'}
        showStartButton={false}
        showFinishedButton={true}
        showDelayedButton={true}
        showBulkFinishButton={true}
        onItemFinished={handleItemFinish}
        onItemDelayed={handleItemDelayed}
        onBulkFinish={handleBulkFinish}
        onBulkFinishSelected={handleBulkFinishSelected}
        onViewFiles={handleViewFiles}
        onEdit={handleEdit}
        onDelete={handleDeleteClick}
        updatingItemId={updatingItemId}
      />

      {/* Production Finished */}
      <ProductionFinishedTrackingSection
        orders={finishedOrders}
        summaries={productionFinishedSummaries}
        isLoading={loadingFinished}
        error={errorFinished}
        onRetry={refresh}
        onViewFiles={handleViewFiles}
        onItemEnRouteStatus={handleItemEnRouteStatusAction}
        onBulkEnRoute={handleBulkEnRoute}
        onBulkEnRouteSelected={handleBulkEnRouteSelected}
      />

      {/* Dispatch Pending — some items still not confirmed en route */}
      <OrderSection
        icon={<Truck className="h-4 w-4 text-amber-500" />}
        title="Dispatch Pending"
        count={enRouteVerificationOrders.length}
        countBg="bg-amber-100" countText="text-amber-700"
        orders={enRouteVerificationOrders} isLoading={loadingEnRoute} error={errorEnRoute}
        onRetry={() => mutateEnRoute()}
        emptyText="No orders pending dispatch confirmation"
      >
        {(order) => (
          <>
            <OrderRow
              order={order} onEdit={handleEdit} onDelete={handleDeleteClick} onViewFiles={handleViewFiles}
              onConfirmEnRoute={handleConfirmEnRoute}
              onGrantException={handleGrantException}
              onRevokeException={handleRevokeException}
              onItemProductionStatus={makeItemProductionStatusHandler(order)}
              onItemEnRouteStatus={makeItemEnRouteStatusHandler(order)}
            />
            {editingOrder?.id === order.id && (
              <EditForm order={order} onSave={handleEditSave} onCancel={handleCancelEdit} saving={saving} />
            )}
          </>
        )}
      </OrderSection>

      {/* En Route — In Transit — all items confirmed en route, awaiting arrival */}
      <OrderSection
        icon={<Truck className="h-4 w-4 text-sky-500" />}
        title="En Route — In Transit"
        count={enRouteTrackingOrders.length}
        countBg="bg-sky-100" countText="text-sky-700"
        orders={enRouteTrackingOrders} isLoading={loadingEnRoute} error={errorEnRoute}
        onRetry={() => mutateEnRoute()}
        emptyText="No orders in transit"
      >
        {(order) => (
          <>
            <OrderRow
              order={order} onEdit={handleEdit} onDelete={handleDeleteClick} onViewFiles={handleViewFiles}
              onConfirmEnRoute={handleConfirmEnRoute}
              onGrantException={handleGrantException}
              onRevokeException={handleRevokeException}
              onItemProductionStatus={makeItemProductionStatusHandler(order)}
              onItemEnRouteStatus={makeItemEnRouteStatusHandler(order)}
            />
            {editingOrder?.id === order.id && (
              <EditForm order={order} onSave={handleEditSave} onCancel={handleCancelEdit} saving={saving} />
            )}
          </>
        )}
      </OrderSection>

      {/* Arrival Verification — all items dispatched, waiting for inventory arrival */}
      <OrderSection
        icon={<Truck className="h-4 w-4 text-blue-500" />}
        title="Arrival Verification"
        count={enRouteVerificationStageOrders.length}
        countBg="bg-blue-100" countText="text-blue-700"
        orders={enRouteVerificationStageOrders} isLoading={loadingEnRouteStage} error={errorEnRouteStage}
        onRetry={() => mutateEnRouteStage()}
        emptyText="No orders awaiting arrival verification"
      >
        {(order) => (
          <>
            <OrderRow
              order={order} onEdit={handleEdit} onDelete={handleDeleteClick} onViewFiles={handleViewFiles}
              onProceedInventoryVerification={handleProceedInventoryVerification}
              onGrantException={handleGrantException}
              onRevokeException={handleRevokeException}
              onItemProductionStatus={makeItemProductionStatusHandler(order)}
              onItemEnRouteStatus={makeItemEnRouteStatusHandler(order)}
            />
            {editingOrder?.id === order.id && (
              <EditForm order={order} onSave={handleEditSave} onCancel={handleCancelEdit} saving={saving} />
            )}
          </>
        )}
      </OrderSection>

      {/* Production Days Modal */}
      {prodDaysModal.open && prodDaysModal.order && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Start Production</h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  {prodDaysModal.order.quotation_number} · {prodDaysModal.order.client_name}
                </p>
              </div>
              <button
                onClick={() => setProdDaysModal((prev) => ({ ...prev, open: false }))}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {prodDaysModal.loadingItems ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-500" />
              </div>
            ) : (
              <div className="space-y-4">
                {prodDaysModal.items.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold text-gray-700">Production days per item:</p>
                    <div className="space-y-2">
                      {prodDaysModal.items.map((item) => (
                        <div key={item.id} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-gray-800">{item.name}</p>
                            <p className="text-xs text-gray-400">Qty: {item.quantity}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <input
                              type="number"
                              min="1"
                              value={itemDays[item.id] ?? ''}
                              onChange={(e) => {
                                const newVal = e.target.value;
                                setItemDays((prev) => {
                                  const updated = { ...prev, [item.id]: newVal };
                                  // Auto-update overall to max of all item days
                                  const maxDays = Math.max(0, ...Object.values(updated).map((v) => parseInt(v) || 0));
                                  if (maxDays > 0) setOverallProductionDays(maxDays.toString());
                                  return updated;
                                });
                              }}
                              placeholder="Days"
                              className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-center text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                            />
                            <span className="text-xs text-gray-500">days</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-700">
                    Overall estimated production days
                    {prodDaysModal.items.length > 0 && (
                      <span className="ml-1 font-normal text-gray-400">(auto-set to longest item)</span>
                    )}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      value={overallProductionDays}
                      onChange={(e) => setOverallProductionDays(e.target.value)}
                      placeholder="e.g. 30"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                    />
                    <span className="shrink-0 text-xs text-gray-500">days</span>
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setProdDaysModal((prev) => ({ ...prev, open: false }))}
                    className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleProdDaysConfirm}
                    disabled={!overallProductionDays || parseInt(overallProductionDays) <= 0}
                    className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Continue →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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

      {/* Stock Replenishment Modal */}
      {stockReplModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-indigo-600" />
                <h2 className="text-base font-semibold text-gray-900">New Stock Replenishment Order</h2>
              </div>
              <button onClick={handleCloseStockRepl} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {stockReplSuccess ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-green-50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="h-5 w-5 text-green-500" />
                    <p className="text-sm font-semibold text-green-800">Order Created Successfully</p>
                  </div>
                  <p className="text-xs text-green-700">Ref: <strong>{stockReplSuccess.ref}</strong></p>
                  <p className="mt-1 text-xs text-green-700">{stockReplSuccess.itemCount} item(s) added to Production Pending</p>
                  {stockReplSuccess.items.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {stockReplSuccess.items.map((item, i) => (
                        <li key={i} className="text-xs text-green-700">• {item.name} ×{item.quantity}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  onClick={handleCloseStockRepl}
                  className="w-full rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-gray-500">
                  Upload a CSV, PDF, or image containing items to restock. Items will be AI-extracted and added directly to Production Pending — no deposit or purchasing flow required.
                </p>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Label <span className="font-normal text-gray-400">(optional)</span></label>
                  <input
                    type="text"
                    value={stockReplLabel}
                    onChange={(e) => setStockReplLabel(e.target.value)}
                    placeholder="e.g. Sofa restock May 2026"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">File <span className="font-normal text-gray-400">(CSV, PDF, or image)</span></label>
                  <input
                    ref={stockReplFileRef}
                    type="file"
                    accept=".csv,.pdf,image/*"
                    onChange={(e) => setStockReplFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-gray-500 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-indigo-700"
                  />
                </div>

                {stockReplError && (
                  <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{stockReplError}</div>
                )}

                <button
                  onClick={handleCreateStockReplenishment}
                  disabled={!stockReplFile || stockReplUploading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {stockReplUploading
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
                    : <><Package className="h-4 w-4" /> Extract &amp; Create Order</>
                  }
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
