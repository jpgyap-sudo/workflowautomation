'use client';

import { useState } from 'react';
import type { Order, DeliveryProgressItem } from '@/lib/api';
import { getDeliveryProgress } from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import { QuotationNumberCell } from '@/components/OrderFileViewer';
import {
  ChevronUp, ChevronDown, Pencil, Trash2, ArrowLeft,
  MapPin, Phone, UserCheck,
} from 'lucide-react';

// ── DeliveryInfo (inline, was module-level in page.tsx) ──────────────────

function DeliveryInfo({ order }: { order: Order }) {
  if (!order.delivery_address && !order.contact_number && !order.authorized_receiver_name && !order.authorized_receiver_contact) {
    return null;
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-purple-700">
      {order.delivery_address && (
        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{order.delivery_address}</span>
      )}
      {order.contact_number && (
        <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{order.contact_number}</span>
      )}
      {order.authorized_receiver_name && (
        <span className="flex items-center gap-1">
          <UserCheck className="h-3 w-3" />
          {order.authorized_receiver_name}
          {order.authorized_receiver_contact && ` (${order.authorized_receiver_contact})`}
        </span>
      )}
    </div>
  );
}

// ── ScheduleForm (inline, was module-level in page.tsx) ──────────────────

function formatDeliveryDate(value?: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 16);
}

function toDateTimeLocalValue(value?: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface ScheduleFormProps {
  order: Order;
  value: string;
  remarks: string;
  onValueChange: (v: string) => void;
  onRemarksChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}

function ScheduleForm({ order, value, remarks, onValueChange, onRemarksChange, onSave, onCancel, saving }: ScheduleFormProps) {
  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
      <p className="mb-2 text-xs font-medium text-purple-800">
        Schedule delivery for <strong>{order.quotation_number ?? '—'}</strong>
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-[10px] font-medium text-purple-700">Delivery Date & Time</label>
          <input
            type="datetime-local"
            value={toDateTimeLocalValue(value)}
            onChange={(e) => onValueChange(formatDeliveryDate(e.target.value))}
            className="w-full rounded-lg border border-purple-300 bg-white px-3 py-2 text-xs outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-[10px] font-medium text-purple-700">Remarks (optional)</label>
          <input
            type="text"
            value={remarks}
            onChange={(e) => onRemarksChange(e.target.value)}
            placeholder="e.g., Deliver to back door"
            className="w-full rounded-lg border border-purple-300 bg-white px-3 py-2 text-xs outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
          />
        </div>
        <button
          onClick={onSave}
          disabled={saving || !value}
          className="rounded-lg bg-purple-600 px-4 py-2 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Schedule'}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg bg-gray-200 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Props ────────────────────────────────────────────────────────────────

export interface DeliveryItemSectionProps {
  icon: React.ReactNode;
  title: string;
  count: number;
  countBg: string;
  countText: string;
  orders: Order[];
  isLoading: boolean;
  emptyText: string;
  onDeliverItem?: (order: Order, item: DeliveryProgressItem) => void;
  onDeliverSelected?: (order: Order, itemIds: string[]) => void;
  onDeliverAll?: (order: Order) => void;
  onScheduleDelivery?: (order: Order) => void;
  onScheduleSelected?: (order: Order, itemIds: string[]) => void;
  onScheduleAll?: (order: Order) => void;
  /** Reschedule callbacks — shown on Scheduled Deliveries section */
  onRescheduleDelivery?: (order: Order) => void;
  onRescheduleSelected?: (order: Order, itemIds: string[]) => void;
  onRescheduleAll?: (order: Order) => void;
  /** Cancel schedule callback — moves order back to Delivery Pending */
  onCancelSchedule?: (order: Order) => void;
  schedulingOrderId?: string | null;
  scheduleDate?: string;
  scheduleRemarks?: string;
  onScheduleDateChange?: (v: string) => void;
  onScheduleRemarksChange?: (v: string) => void;
  onScheduleSubmit?: (order: Order) => void;
  onScheduleCancel?: () => void;
  scheduleSaving?: boolean;
  onViewFiles?: (order: Order) => void;
  onEdit?: (order: Order) => void;
  onDelete?: (order: Order) => void;
  onRevert?: (order: Order) => void;
  onCompleteOrder?: (order: Order) => void;
  actionLoading?: string | null;
}

// ── Component ────────────────────────────────────────────────────────────

export default function DeliveryItemSection({
  icon, title, count, countBg, countText,
  orders, isLoading, emptyText,
  onDeliverItem, onDeliverSelected, onDeliverAll,
  onScheduleDelivery, onScheduleSelected, onScheduleAll,
  onRescheduleDelivery, onRescheduleSelected, onRescheduleAll,
  onCancelSchedule,
  schedulingOrderId, scheduleDate, scheduleRemarks,
  onScheduleDateChange, onScheduleRemarksChange, onScheduleSubmit, onScheduleCancel, scheduleSaving,
  onViewFiles, onEdit, onDelete, onRevert, onCompleteOrder,
  actionLoading,
}: DeliveryItemSectionProps) {
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [itemsByOrder, setItemsByOrder] = useState<Record<string, DeliveryProgressItem[]>>({});
  const [loadingItemsForOrder, setLoadingItemsForOrder] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Record<string, Set<string>>>({});

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
        const data = await getDeliveryProgress(order.id);
        setItemsByOrder((prev) => ({ ...prev, [order.id]: data.items ?? [] }));
      } catch {
        setItemsByOrder((prev) => ({ ...prev, [order.id]: [] }));
      } finally {
        setLoadingItemsForOrder(null);
      }
    }
  }

  function toggleSelectItem(orderId: string, itemId: string) {
    setSelectedItemIds((prev) => {
      const current = new Set(prev[orderId] ?? []);
      if (current.has(itemId)) current.delete(itemId); else current.add(itemId);
      return { ...prev, [orderId]: current };
    });
  }

  function toggleSelectAll(orderId: string, selectableItems: DeliveryProgressItem[]) {
    setSelectedItemIds((prev) => {
      const current = prev[orderId] ?? new Set<string>();
      const allSelected = selectableItems.every((i) => current.has(i.id));
      return { ...prev, [orderId]: allSelected ? new Set() : new Set(selectableItems.map((i) => i.id)) };
    });
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
      ) : orders.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">{emptyText}</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {orders.map((order) => {
            const isExpanded = expandedOrderId === order.id;
            const orderItems = itemsByOrder[order.id] ?? [];
            const deliverableItems = orderItems.filter((i) => {
              if (i.fully_delivered) return false;
              // Item must have physically arrived (arrived_qty > 0) or been verified (verified_qty > 0) to be deliverable
              return i.verified_qty > 0 || (i.arrived_qty ?? 0) > 0;
            });
            const hasDeliverableItems = deliverableItems.length > 0;
            const orderSelected = selectedItemIds[order.id] ?? new Set<string>();
            const allSelected = deliverableItems.length > 0 && deliverableItems.every((i) => orderSelected.has(i.id));
            const someSelected = orderSelected.size > 0 && !allSelected;

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
                    {order.total_amount != null && (
                      <p className="mt-0.5 text-xs text-gray-400">
                        Total: ₱{Number(order.total_amount).toLocaleString()}
                      </p>
                    )}
                    <DeliveryInfo order={order} />
                    {/* Show partial delivery summary */}
                    {order.partial_delivery === true && orderItems.length > 0 && (
                      <p className="mt-1 text-[11px] text-amber-600">
                        📦 Partial delivery: {orderItems.filter(i => i.fully_delivered).length}/{orderItems.length} items delivered
                        {' — '}
                        {orderItems.filter(i => !i.fully_delivered && i.delivered_qty > 0).length} partially delivered,
                        {orderItems.filter(i => i.delivered_qty === 0).length} pending
                      </p>
                    )}
                    {/* Show scheduled delivery date in the header row */}
                    {order.delivery_date && (onDeliverSelected || onDeliverAll) && (
                      <p className="mt-1 text-[11px] text-purple-600">
                        📅 Scheduled:{' '}
                        {new Date(order.delivery_date).toLocaleString('en-PH', {
                          year: 'numeric', month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <StageBadge stage={order.current_stage} />
                    {onCompleteOrder && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onCompleteOrder(order); }}
                        disabled={actionLoading === order.id}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
                        title="Manually complete this order"
                      >
                        {actionLoading === order.id ? '…' : 'Complete Order'}
                      </button>
                    )}
                    <div className="flex items-center gap-1">
                      {onRevert && order.current_stage !== 'quotation_received' && (
                        <button onClick={(e) => { e.stopPropagation(); onRevert(order); }}
                          className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600" title="Revert stage (OTP required)">
                          <ArrowLeft className="h-4 w-4" />
                        </button>
                      )}
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
                    ) : orderItems.length === 0 ? (
                      <p className="py-2 text-center text-xs text-gray-400">No items found for this order.</p>
                    ) : (
                      <div>
                      {/* Toolbar: Schedule Delivery (pending section) OR Schedule Selected (pending with checkboxes) OR Deliver Selected + Deliver All (scheduled section) OR Reschedule (scheduled section) */}
                      {onScheduleDelivery && !onScheduleSelected ? (
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[11px] text-gray-400">Schedule this order before delivering items.</span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onScheduleDelivery(order); }}
                            className="rounded-md border border-purple-300 bg-purple-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-purple-700 transition-colors"
                          >
                            📅 Schedule Delivery
                          </button>
                        </div>
                      ) : (onScheduleSelected || onScheduleAll) ? (
                        <div className="mb-2 flex items-center justify-end gap-2">
                          {onScheduleSelected && orderSelected.size > 0 && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onScheduleSelected(order, Array.from(orderSelected)); }}
                              className="rounded-md border border-purple-300 bg-purple-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-purple-700 transition-colors"
                            >
                              📅 Schedule Selected ({orderSelected.size})
                            </button>
                          )}
                          {onScheduleAll && hasDeliverableItems && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onScheduleAll(order); }}
                              className="rounded-md border border-purple-200 bg-purple-50 px-3 py-1.5 text-[11px] font-semibold text-purple-700 hover:bg-purple-100 transition-colors"
                            >
                              📅 Schedule All ({deliverableItems.length})
                            </button>
                          )}
                        </div>
                      ) : (onRescheduleDelivery && !onRescheduleSelected) ? (
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[11px] text-gray-400">
                            Scheduled for{' '}
                            <strong>
                              {order.delivery_date
                                ? new Date(order.delivery_date).toLocaleString('en-PH', {
                                    year: 'numeric', month: 'short', day: 'numeric',
                                    hour: '2-digit', minute: '2-digit',
                                  })
                                : '—'}
                            </strong>
                          </span>
                          <div className="flex items-center gap-2">
                            {onCancelSchedule && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onCancelSchedule(order); }}
                                disabled={actionLoading === order.id}
                                className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50"
                              >
                                ✕ Cancel Schedule
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onRescheduleDelivery(order); }}
                              className="rounded-md border border-purple-300 bg-purple-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-purple-700 transition-colors"
                            >
                              📅 Reschedule
                            </button>
                          </div>
                        </div>
                      ) : (onRescheduleSelected || onRescheduleAll) ? (
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[11px] text-gray-400">
                            Scheduled for{' '}
                            <strong>
                              {order.delivery_date
                                ? new Date(order.delivery_date).toLocaleString('en-PH', {
                                    year: 'numeric', month: 'short', day: 'numeric',
                                    hour: '2-digit', minute: '2-digit',
                                  })
                                : '—'}
                            </strong>
                          </span>
                          <div className="flex items-center gap-2">
                            {onCancelSchedule && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onCancelSchedule(order); }}
                                disabled={actionLoading === order.id}
                                className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50"
                              >
                                ✕ Cancel Schedule
                              </button>
                            )}
                            {onRescheduleSelected && orderSelected.size > 0 && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onRescheduleSelected(order, Array.from(orderSelected)); }}
                                className="rounded-md border border-purple-300 bg-purple-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-purple-700 transition-colors"
                              >
                                📅 Reschedule Selected ({orderSelected.size})
                              </button>
                            )}
                            {onRescheduleAll && hasDeliverableItems && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onRescheduleAll(order); }}
                                className="rounded-md border border-purple-200 bg-purple-50 px-3 py-1.5 text-[11px] font-semibold text-purple-700 hover:bg-purple-100 transition-colors"
                              >
                                📅 Reschedule All ({deliverableItems.length})
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (onDeliverSelected || onDeliverAll) && (
                        <div className="mb-2 flex items-center justify-end gap-2">
                          {onDeliverSelected && orderSelected.size > 0 && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onDeliverSelected(order, Array.from(orderSelected)); }}
                              className="rounded-md border border-amber-300 bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-700 transition-colors"
                            >
                              🚚 Deliver Selected ({orderSelected.size})
                            </button>
                          )}
                          {onDeliverAll && hasDeliverableItems && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onDeliverAll(order); }}
                              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
                            >
                              🚚 Deliver All ({deliverableItems.length})
                            </button>
                          )}
                        </div>
                      )}
                      <div className="overflow-x-auto rounded-lg border border-gray-200">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-gray-200 bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                              {(onDeliverSelected || onDeliverAll || onScheduleSelected || onScheduleAll || onRescheduleSelected || onRescheduleAll) && (
                                <th className="w-8 px-3 py-2">
                                  <input
                                    type="checkbox"
                                    title="Select all"
                                    checked={allSelected}
                                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                                    onChange={(e) => { e.stopPropagation(); toggleSelectAll(order.id, deliverableItems); }}
                                    disabled={deliverableItems.length === 0}
                                    className="rounded border-gray-300 accent-purple-600 disabled:opacity-30"
                                  />
                                </th>
                              )}
                                <th className="px-3 py-2">Item</th>
                                <th className="px-3 py-2">Ordered</th>
                                <th className="px-3 py-2">Verified</th>
                                <th className="px-3 py-2">Delivered</th>
                                <th className="px-3 py-2">Remaining</th>
                                <th className="px-3 py-2">Status</th>
                                <th className="px-3 py-2">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {orderItems.map((item) => {
                                const canDeliver = !item.fully_delivered && (item.verified_qty > 0 || (item.arrived_qty ?? 0) > 0);
                                const isChecked = orderSelected.has(item.id);
                                return (
                                  <tr
                                    key={item.id}
                                    className={`hover:bg-gray-50 ${isChecked ? (onScheduleSelected || onScheduleAll || onRescheduleSelected || onRescheduleAll ? 'bg-purple-50/40' : 'bg-amber-50/40') : ''} ${item.fully_delivered ? 'opacity-60' : ''}`}
                                  >
                                    {(onDeliverSelected || onDeliverAll || onScheduleSelected || onScheduleAll || onRescheduleSelected || onRescheduleAll) && (
                                      <td className="px-3 py-2">
                                        {canDeliver && (
                                          <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={(e) => { e.stopPropagation(); toggleSelectItem(order.id, item.id); }}
                                            className={`rounded border-gray-300 ${onScheduleSelected || onScheduleAll || onRescheduleSelected || onRescheduleAll ? 'accent-purple-600' : 'accent-amber-600'}`}
                                          />
                                        )}
                                      </td>
                                    )}
                                    <td className="px-3 py-2 font-medium text-gray-800">{item.name}</td>
                                    <td className="px-3 py-2 text-gray-600">{item.quantity}</td>
                                    <td className="px-3 py-2 text-gray-600">{item.verified_qty}</td>
                                    <td className="px-3 py-2 text-gray-600">{item.delivered_qty}</td>
                                    <td className="px-3 py-2">
                                      {item.remaining_qty > 0 ? (
                                        <span className="font-medium text-amber-600">{item.remaining_qty}</span>
                                      ) : (
                                        <span className="text-gray-400">0</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2">
                                      {item.fully_delivered ? (
                                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">✅ Done</span>
                                      ) : item.delivered_qty > 0 ? (
                                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">Partial</span>
                                      ) : (
                                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">Pending</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="flex flex-wrap gap-1.5">
                                        {!onScheduleDelivery && onDeliverItem && canDeliver && (
                                          <button
                                            type="button"
                                            disabled={actionLoading === order.id}
                                            onClick={(e) => { e.stopPropagation(); onDeliverItem(order, item); }}
                                            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors"
                                          >
                                            {actionLoading === order.id ? '...' : '🚚 Deliver'}
                                          </button>
                                        )}
                                        {item.fully_delivered && (
                                          <span className="rounded-md border border-green-200 bg-green-50 px-3 py-1 text-[11px] font-semibold text-green-700">
                                            ✓ Delivered
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {/* Inline schedule form — schedule mode or reschedule mode */}
                        {(onScheduleDelivery || onRescheduleDelivery) && schedulingOrderId === order.id && (
                          <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                            <ScheduleForm
                              order={order}
                              value={scheduleDate ?? ''}
                              remarks={scheduleRemarks ?? ''}
                              onValueChange={onScheduleDateChange ?? (() => {})}
                              onRemarksChange={onScheduleRemarksChange ?? (() => {})}
                              onSave={() => onScheduleSubmit?.(order)}
                              onCancel={() => onScheduleCancel?.()}
                              saving={scheduleSaving ?? false}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
