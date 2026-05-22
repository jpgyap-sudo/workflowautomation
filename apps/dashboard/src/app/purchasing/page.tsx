'use client';

import { useState, useEffect } from 'react';
import { useOrdersByStage } from '@/lib/useApi';
import type { Order, ItemCompletion } from '@/lib/api';
import { updateOrder, deleteOrder, setProduction, getItemCompletion } from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import OtpModal from '@/components/OtpModal';
import {
  ShoppingCart, Clock, Package, ExternalLink,
  Pencil, Trash2, X, Check, ChevronDown, ChevronUp,
  AlertTriangle, RefreshCw, List, Truck, CheckCircle,
} from 'lucide-react';

function DriveLink({ folderId }: { folderId: string | null }) {
  if (!folderId) return <span className="text-xs text-gray-400">—</span>;
  return (
    <a
      href={`https://drive.google.com/drive/folders/${folderId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-[#2490ef] hover:underline"
    >
      <ExternalLink className="h-3 w-3" />
      Open Drive
    </a>
  );
}

interface OrderRowProps {
  order: Order;
  onEdit: (order: Order) => void;
  onDelete: (order: Order) => void;
  onStartProduction?: (order: Order) => void;
}

function OrderRow({ order, onEdit, onDelete, onStartProduction }: OrderRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [completion, setCompletion] = useState<ItemCompletion | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Fetch item-level completion for all stages that might have items
    if (['production_confirmed', 'en_route', 'inventory_arrived', 'balance_due', 'delivery_scheduled'].includes(order.current_stage)) {
      getItemCompletion(order.id).then((res) => {
        if (!cancelled && res.ok) setCompletion(res);
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [order.id, order.current_stage]);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-gray-50/50"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium text-gray-900">{order.quotation_number ?? '—'}</p>
            {(order.escalation_level ?? 0) > 0 && (
              <span className="flex items-center gap-0.5">
                {Array.from({ length: Math.min(order.escalation_level ?? 0, 3) }).map((_, i) => (
                  <span key={i} className="h-2 w-2 rounded-full bg-red-500" />
                ))}
              </span>
            )}
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
          </div>
          <p className="truncate text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
          {order.sales_agent && (
            <p className="text-[11px] text-gray-400">{order.sales_agent}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <DriveLink folderId={order.google_drive_folder_id} />
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
        <div className="flex flex-wrap gap-2 border-t border-gray-100 bg-white px-6 py-3">
          {onStartProduction && !order.production_started && (
            <button
              onClick={() => onStartProduction(order)}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
            >
              Mark Production Started
            </button>
          )}

          {/* Item-level completion bars for expanded view */}
          {completion && (
            <div className="w-full space-y-2">
              {completion.production_completion_pct > 0 && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Package className="h-3 w-3 text-indigo-500" />
                  <span>Production</span>
                  <span className={`ml-auto font-semibold ${
                    completion.production_completion_pct >= 100 ? 'text-green-600' : completion.production_completion_pct >= 50 ? 'text-amber-600' : 'text-gray-500'
                  }`}>{completion.production_completion_pct}%</span>
                </div>
              )}
              {completion.en_route_completion_pct > 0 && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Truck className="h-3 w-3 text-sky-500" />
                  <span>En Route</span>
                  <span className={`ml-auto font-semibold ${
                    completion.en_route_completion_pct >= 100 ? 'text-green-600' : completion.en_route_completion_pct >= 50 ? 'text-amber-600' : 'text-gray-500'
                  }`}>{completion.en_route_completion_pct}%</span>
                </div>
              )}
              {completion.inventory_completion_pct > 0 && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Package className="h-3 w-3 text-emerald-500" />
                  <span>Inventory Arrival</span>
                  <span className={`ml-auto font-semibold ${
                    completion.inventory_completion_pct >= 100 ? 'text-green-600' : completion.inventory_completion_pct >= 50 ? 'text-amber-600' : 'text-gray-500'
                  }`}>{completion.inventory_completion_pct}%</span>
                </div>
              )}
            </div>
          )}

          <span className="self-center text-xs text-gray-500">
            Downpayment: {order.deposit_paid ? `Paid${order.deposit_amount ? ` ₱${Number(order.deposit_amount).toLocaleString()}` : ''}` : 'Pending'}
            {' · '}
            Balance: {order.balance_paid ? 'Paid' : 'Pending'}
          </span>
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
  const { data: pendingOrders = [], isLoading: loadingPending, error: errorPending, mutate: mutatePending } =
    useOrdersByStage('purchasing_pending');

  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingOrder, setDeletingOrder] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [otpModal, setOtpModal] = useState<{
    open: boolean; title: string; description: string; pendingAction: 'edit' | 'delete';
  }>({ open: false, title: '', description: '', pendingAction: 'edit' });

  function refresh() {
    mutatePending();
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
      description: `You are about to permanently delete order "${order.quotation_number ?? '—'}". This will also remove all stage updates, files, and reminders. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'delete' });
  }

  async function handleStartProduction(order: Order) {
    const input = window.prompt('Estimated production days?', order.estimated_production_days?.toString() ?? '');
    if (!input) return;
    const days = Number(input.replace(/[^0-9]/g, ''));
    if (!Number.isInteger(days) || days <= 0) { alert('Please enter a valid positive number of days.'); return; }
    try {
      await setProduction(order.id, { production_started: true, estimated_production_days: days });
      refresh();
    } catch (err: any) {
      alert('Failed to start production: ' + (err.message ?? 'Unknown error'));
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <ShoppingCart className="mt-0.5 h-5 w-5 text-amber-600" />
          <div>
            <h3 className="text-sm font-semibold text-amber-800">Purchasing Workflow</h3>
            <p className="mt-1 text-xs text-amber-700">
              Approved quotations waiting for purchasing to begin. Once production starts, the order moves to the{' '}
              <strong>Production</strong> tab. Once en route is confirmed, the order moves to the{' '}
              <strong>Delivery</strong> tab for balance payment and delivery scheduling.
            </p>
          </div>
        </div>
      </div>

      {/* Pending Purchasing */}
      <OrderSection
        icon={<Clock className="h-4 w-4 text-amber-500" />}
        title="Pending Purchasing"
        count={pendingOrders.length}
        countBg="bg-amber-100" countText="text-amber-700"
        orders={pendingOrders} isLoading={loadingPending} error={errorPending}
        onRetry={() => mutatePending()}
        emptyText="No pending purchasing orders"
      >
        {(order) => (
          <>
            <OrderRow order={order} onEdit={handleEdit} onDelete={handleDeleteClick} onStartProduction={handleStartProduction} />
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
    </div>
  );
}
