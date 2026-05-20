'use client';

import { useState } from 'react';
import { useOrdersByStage } from '@/lib/useApi';
import type { Order } from '@/lib/api';
import { updateOrder, deleteOrder, setProduction, reportProductionStatus, finishProduction, recalcProductionReminders } from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import OtpModal from '@/components/OtpModal';
import { ShoppingCart, Factory, Clock, ExternalLink, Pencil, Trash2, X, Check, ChevronDown, ChevronUp, AlertTriangle, CheckCircle, Calendar, RefreshCw, Package } from 'lucide-react';

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

function computeFinishDate(order: Order): Date | null {
  if (!order.production_started || !order.estimated_production_days) return null;
  const startDate = order.production_finished_at
    ? new Date(order.production_finished_at)
    : order.production_started_at
      ? new Date(order.production_started_at)
      : new Date(order.created_at);
  const finishDate = new Date(startDate);
  finishDate.setDate(finishDate.getDate() + order.estimated_production_days);
  return finishDate;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getProductionProgress(order: Order): { pct: number; remainingDays: number; isOverdue: boolean; isDueSoon: boolean } | null {
  if (!order.production_started || !order.estimated_production_days || order.production_finished) return null;
  const startDate = order.production_started_at ? new Date(order.production_started_at) : new Date(order.created_at);
  const now = new Date();
  const elapsedMs = now.getTime() - startDate.getTime();
  const totalMs = order.estimated_production_days * 86_400_000;
  const pct = Math.min(100, Math.max(0, Math.round((elapsedMs / totalMs) * 100)));
  const remainingDays = Math.max(0, order.estimated_production_days - Math.floor(elapsedMs / 86_400_000));
  const isOverdue = elapsedMs > totalMs;
  const isDueSoon = !isOverdue && remainingDays <= Math.max(3, Math.ceil(order.estimated_production_days * 0.15));
  return { pct, remainingDays, isOverdue, isDueSoon };
}

function ProductionInfo({ order }: { order: Order }) {
  if (!order.production_started) return null;

  const finishDate = computeFinishDate(order);
  const isDelayed = order.production_delayed;
  const delayDays = order.production_delay_days;
  const isFinished = order.production_finished;
  const deliveryDays = order.delivery_estimated_days;
  const startedAt = order.production_started_at
    ? new Date(order.production_started_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  const progress = getProductionProgress(order);

  return (
    <div className="border-t border-gray-100 bg-gray-50/50 px-6 py-3">
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
        {/* Production Started */}
        <div className="rounded-lg bg-white p-2.5 shadow-sm">
          <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
            <Factory className="h-3 w-3 text-indigo-500" />
            Production
          </span>
          <p className="mt-1 font-semibold text-gray-800">
            {order.production_started ? 'Started' : 'Not Started'}
          </p>
        </div>

        {/* Started At */}
        {startedAt && (
          <div className="rounded-lg bg-white p-2.5 shadow-sm">
            <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
              <Calendar className="h-3 w-3 text-indigo-500" />
              Started At
            </span>
            <p className="mt-1 font-semibold text-gray-800">{startedAt}</p>
          </div>
        )}

        {/* Estimated Duration */}
        {order.estimated_production_days && (
          <div className="rounded-lg bg-white p-2.5 shadow-sm">
            <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
              <Clock className="h-3 w-3 text-amber-500" />
              Est. Duration
            </span>
            <p className="mt-1 font-semibold text-gray-800">
              {order.estimated_production_days} days
            </p>
          </div>
        )}

        {/* Estimated Finish Date */}
        {finishDate && !isFinished && (
          <div className="rounded-lg bg-white p-2.5 shadow-sm">
            <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
              <Calendar className="h-3 w-3 text-blue-500" />
              Est. Finish
            </span>
            <p className="mt-1 font-semibold text-gray-800">{formatDate(finishDate)}</p>
          </div>
        )}

        {/* Delay Status */}
        {isDelayed !== null && (
          <div className="rounded-lg bg-white p-2.5 shadow-sm">
            <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
              <AlertTriangle className={`h-3 w-3 ${isDelayed ? 'text-red-500' : 'text-green-500'}`} />
              Status
            </span>
            <p className={`mt-1 font-semibold ${isDelayed ? 'text-red-600' : 'text-green-600'}`}>
              {isDelayed ? `Delayed ${delayDays ? `(${delayDays}d)` : ''}` : 'On Time'}
            </p>
          </div>
        )}

        {/* Finished */}
        {isFinished !== null && (
          <div className="rounded-lg bg-white p-2.5 shadow-sm">
            <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
              <CheckCircle className={`h-3 w-3 ${isFinished ? 'text-green-500' : 'text-gray-400'}`} />
              Finished
            </span>
            <p className={`mt-1 font-semibold ${isFinished ? 'text-green-600' : 'text-gray-500'}`}>
              {isFinished ? 'Yes' : 'No'}
            </p>
          </div>
        )}

        {/* Delivery Estimate */}
        {deliveryDays && (
          <div className="rounded-lg bg-white p-2.5 shadow-sm">
            <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
              <Calendar className="h-3 w-3 text-purple-500" />
              Delivery Est.
            </span>
            <p className="mt-1 font-semibold text-gray-800">{deliveryDays} days</p>
          </div>
        )}
      </div>

      {/* Progress Bar — only show when production is in progress (not finished) */}
      {progress && !isFinished && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              {progress.isOverdue ? (
                <span className="font-semibold text-red-600">Overdue by {Math.abs(progress.remainingDays)} days</span>
              ) : (
                <span>{progress.remainingDays} days remaining</span>
              )}
            </span>
            <span>{progress.pct}%</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                progress.isOverdue
                  ? 'bg-red-500'
                  : progress.isDueSoon
                    ? 'bg-amber-500'
                    : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(progress.pct, 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface OrderRowProps {
  order: Order;
  onEdit: (order: Order) => void;
  onDelete: (order: Order) => void;
  onStartProduction: (order: Order) => void;
  onReportOnTime: (order: Order) => void;
  onReportDelayed: (order: Order) => void;
  onFinishProduction: (order: Order) => void;
}

function OrderRow({
  order,
  onEdit,
  onDelete,
  onStartProduction,
  onReportOnTime,
  onReportDelayed,
  onFinishProduction,
}: OrderRowProps) {
  const [expanded, setExpanded] = useState(false);

  // Determine overdue/due-soon status for row highlighting
  const progress = getProductionProgress(order);
  const rowHighlight = progress && !order.production_finished
    ? progress.isOverdue
      ? 'border-l-4 border-l-red-500'
      : progress.isDueSoon
        ? 'border-l-4 border-l-amber-500'
        : ''
    : '';

  return (
    <div className={rowHighlight}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-gray-50/50"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium text-gray-900">{order.quotation_number ?? '—'}</p>
            {/* Overdue / Due-soon badge */}
            {progress && !order.production_finished && (
              <>
                {progress.isOverdue && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                    <AlertTriangle className="h-3 w-3" />
                    Overdue
                  </span>
                )}
                {progress.isDueSoon && !progress.isOverdue && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    <Clock className="h-3 w-3" />
                    Due Soon
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
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </button>
      {expanded && (
        <>
          <ProductionInfo order={order} />
          <div className="flex flex-wrap gap-2 border-t border-gray-100 bg-white px-6 py-3">
            {!order.production_started && (
              <button
                onClick={() => onStartProduction(order)}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                Mark Production Started
              </button>
            )}
            {order.production_started && !order.production_finished && (
              <>
                <button
                  onClick={() => onReportOnTime(order)}
                  className="rounded-lg bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100"
                >
                  On Time
                </button>
                <button
                  onClick={() => onReportDelayed(order)}
                  className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
                >
                  Mark Delayed
                </button>
                <button
                  onClick={() => onFinishProduction(order)}
                  className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700"
                >
                  Finish Production
                </button>
              </>
            )}
            <span className="self-center text-xs text-gray-500">
              Deposit: {order.deposit_paid ? `Paid${order.deposit_amount ? ` ₱${Number(order.deposit_amount).toLocaleString()}` : ''}` : 'Pending'}
              {' · '}
              Balance: {order.balance_paid ? 'Paid' : 'Pending'}
            </span>
          </div>
        </>
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
      <input
        value={quotationNumber}
        onChange={(e) => setQuotationNumber(e.target.value)}
        placeholder="Quotation #"
        className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
      />
      <input
        value={clientName}
        onChange={(e) => setClientName(e.target.value)}
        placeholder="Client name"
        className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
      />
      <input
        value={salesAgent}
        onChange={(e) => setSalesAgent(e.target.value)}
        placeholder="Sales agent"
        className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
      />
      <input
        value={totalAmount}
        onChange={(e) => setTotalAmount(e.target.value.replace(/[^0-9.]/g, ''))}
        placeholder="Amount"
        className="w-28 rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
      />
      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-[#2490ef] p-1.5 text-white hover:bg-[#1a7ad9] disabled:opacity-50"
        title="Save"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg bg-gray-200 p-1.5 text-gray-600 hover:bg-gray-300"
        title="Cancel"
      >
        <X className="h-4 w-4" />
      </button>
    </form>
  );
}

// ── Section Component ─────────────────────────────────────────────────
function OrderSection({
  icon,
  title,
  count,
  countBg,
  countText,
  orders,
  isLoading,
  error,
  onRetry,
  emptyText,
  children,
}: {
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
  children: (order: Order) => React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
        {icon}
        <h2 className="text-base font-semibold text-gray-800">{title}</h2>
        <span className={`ml-auto rounded-full ${countBg} px-2 py-0.5 text-xs font-medium ${countText}`}>
          {count}
        </span>
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
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2490ef] px-4 py-2 text-xs font-medium text-white hover:bg-[#1a7ad9]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          )}
        </div>
      ) : orders.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">{emptyText}</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {orders.map((order) => (
            <div key={order.id}>
              {children(order)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PurchasingPage() {
  const {
    data: pendingOrders = [],
    isLoading: loadingPending,
    error: errorPending,
    mutate: mutatePending,
  } = useOrdersByStage('purchasing_pending');

  const {
    data: productionOrders = [],
    isLoading: loadingProduction,
    error: errorProduction,
    mutate: mutateProduction,
  } = useOrdersByStage('production_confirmed');

  const {
    data: inventoryOrders = [],
    isLoading: loadingInventory,
    error: errorInventory,
    mutate: mutateInventory,
  } = useOrdersByStage('inventory_arrived');

  // Edit state
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deletingOrder, setDeletingOrder] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);

  // OTP modal state
  const [otpModal, setOtpModal] = useState<{
    open: boolean;
    title: string;
    description: string;
    pendingAction: 'edit' | 'delete';
  }>({ open: false, title: '', description: '', pendingAction: 'edit' });

  function handleEdit(order: Order) {
    setEditingOrder(order);
  }

  function handleCancelEdit() {
    setEditingOrder(null);
  }

  function handleEditSave(data: { client_name?: string; sales_agent?: string; total_amount?: number; quotation_number?: string }) {
    if (!editingOrder) return;
    setOtpModal({
      open: true,
      title: 'Edit Order',
      description: `You are about to edit order "${editingOrder.quotation_number ?? '—'}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'edit',
    });
    // Store the edit data temporarily
    (window as any).__pendingEditData = { orderId: editingOrder.id, data };
  }

  async function handleEditVerified(actionToken: string) {
    const pending = (window as any).__pendingEditData;
    if (!pending) return;
    setSaving(true);
    try {
      await updateOrder(pending.orderId, { ...pending.data, action_token: actionToken });
      setEditingOrder(null);
      mutatePending();
      mutateProduction();
      mutateInventory();
    } catch (err: any) {
      alert('Failed to update order: ' + (err.message ?? 'Unknown error'));
    } finally {
      setSaving(false);
      (window as any).__pendingEditData = null;
    }
  }

  function handleDeleteClick(order: Order) {
    setDeletingOrder(order);
    setOtpModal({
      open: true,
      title: 'Delete Order',
      description: `You are about to permanently delete order "${order.quotation_number ?? '—'}". This will also remove all stage updates, files, and reminders. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'delete',
    });
  }

  async function handleDeleteVerified(actionToken: string) {
    if (!deletingOrder) return;
    setDeleting(true);
    try {
      await deleteOrder(deletingOrder.id, actionToken);
      setDeletingOrder(null);
      mutatePending();
      mutateProduction();
      mutateInventory();
    } catch (err: any) {
      alert('Failed to delete order: ' + (err.message ?? 'Unknown error'));
    } finally {
      setDeleting(false);
    }
  }

  function handleOtpVerified(actionToken: string) {
    if (otpModal.pendingAction === 'edit') {
      handleEditVerified(actionToken);
    } else if (otpModal.pendingAction === 'delete') {
      handleDeleteVerified(actionToken);
    }
  }

  function refreshPurchasingLists() {
    mutatePending();
    mutateProduction();
    mutateInventory();
  }

  async function handleStartProduction(order: Order) {
    const input = window.prompt('Estimated production days?', order.estimated_production_days?.toString() ?? '');
    if (!input) return;
    const days = Number(input.replace(/[^0-9]/g, ''));
    if (!Number.isInteger(days) || days <= 0) {
      alert('Please enter a valid positive number of days.');
      return;
    }
    try {
      await setProduction(order.id, { production_started: true, estimated_production_days: days });
      refreshPurchasingLists();
    } catch (err: any) {
      alert('Failed to start production: ' + (err.message ?? 'Unknown error'));
    }
  }

  async function handleReportOnTime(order: Order) {
    try {
      await reportProductionStatus(order.id, { on_time: true, delay_days: 0 });
      refreshPurchasingLists();
    } catch (err: any) {
      alert('Failed to update production status: ' + (err.message ?? 'Unknown error'));
    }
  }

  async function handleReportDelayed(order: Order) {
    const input = window.prompt('How many days delayed?', order.production_delay_days?.toString() ?? '');
    if (!input) return;
    const days = Number(input.replace(/[^0-9]/g, ''));
    if (!Number.isInteger(days) || days < 0) {
      alert('Please enter a valid delay in days.');
      return;
    }
    try {
      await reportProductionStatus(order.id, { on_time: false, delay_days: days });
      refreshPurchasingLists();
    } catch (err: any) {
      alert('Failed to mark delayed: ' + (err.message ?? 'Unknown error'));
    }
  }

  async function handleFinishProduction(order: Order) {
    const input = window.prompt('Days until available for delivery?', order.delivery_estimated_days?.toString() ?? '28');
    if (!input) return;
    const days = Number(input.replace(/[^0-9]/g, ''));
    if (!Number.isInteger(days) || days <= 0) {
      alert('Please enter a valid positive number of days.');
      return;
    }
    try {
      await finishProduction(order.id, { delivery_estimated_days: days });
      refreshPurchasingLists();
    } catch (err: any) {
      alert('Failed to finish production: ' + (err.message ?? 'Unknown error'));
    }
  }

  return (
    <div className="space-y-6">
      {/* Workflow info from Excel */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <ShoppingCart className="mt-0.5 h-5 w-5 text-amber-600" />
          <div>
            <h3 className="text-sm font-semibold text-amber-800">Purchasing / Production Workflow</h3>
            <p className="mt-1 text-xs text-amber-700">
              Sales forwards approved quotation → Bot uploads to Google Drive → Quotation math checked →
              Daily reminders ask if production/purchasing has started → Team replies with <code className="rounded bg-amber-100 px-1">/produce QTN-2026-001 yes 10 days</code>
            </p>
          </div>
        </div>
      </div>

      {/* Pending Purchasing */}
      <OrderSection
        icon={<Clock className="h-4 w-4 text-amber-500" />}
        title="Pending Purchasing"
        count={pendingOrders.length}
        countBg="bg-amber-100"
        countText="text-amber-700"
        orders={pendingOrders}
        isLoading={loadingPending}
        error={errorPending}
        onRetry={() => mutatePending()}
        emptyText="No pending purchasing orders"
      >
        {(order) => (
          <>
            <OrderRow
              order={order}
              onEdit={handleEdit}
              onDelete={handleDeleteClick}
              onStartProduction={handleStartProduction}
              onReportOnTime={handleReportOnTime}
              onReportDelayed={handleReportDelayed}
              onFinishProduction={handleFinishProduction}
            />
            {editingOrder?.id === order.id && (
              <EditForm
                order={order}
                onSave={handleEditSave}
                onCancel={handleCancelEdit}
                saving={saving}
              />
            )}
          </>
        )}
      </OrderSection>

      {/* Production Confirmed */}
      <OrderSection
        icon={<Factory className="h-4 w-4 text-indigo-500" />}
        title="Production Confirmed"
        count={productionOrders.length}
        countBg="bg-indigo-100"
        countText="text-indigo-700"
        orders={productionOrders}
        isLoading={loadingProduction}
        error={errorProduction}
        onRetry={() => mutateProduction()}
        emptyText="No production confirmed orders"
      >
        {(order) => (
          <>
            <OrderRow
              order={order}
              onEdit={handleEdit}
              onDelete={handleDeleteClick}
              onStartProduction={handleStartProduction}
              onReportOnTime={handleReportOnTime}
              onReportDelayed={handleReportDelayed}
              onFinishProduction={handleFinishProduction}
            />
            {editingOrder?.id === order.id && (
              <EditForm
                order={order}
                onSave={handleEditSave}
                onCancel={handleCancelEdit}
                saving={saving}
              />
            )}
          </>
        )}
      </OrderSection>

      {/* Inventory Arrived (completed production) */}
      <OrderSection
        icon={<Package className="h-4 w-4 text-emerald-500" />}
        title="Inventory Arrived"
        count={inventoryOrders.length}
        countBg="bg-emerald-100"
        countText="text-emerald-700"
        orders={inventoryOrders}
        isLoading={loadingInventory}
        error={errorInventory}
        onRetry={() => mutateInventory()}
        emptyText="No inventory arrived orders"
      >
        {(order) => (
          <>
            <OrderRow
              order={order}
              onEdit={handleEdit}
              onDelete={handleDeleteClick}
              onStartProduction={handleStartProduction}
              onReportOnTime={handleReportOnTime}
              onReportDelayed={handleReportDelayed}
              onFinishProduction={handleFinishProduction}
            />
            {editingOrder?.id === order.id && (
              <EditForm
                order={order}
                onSave={handleEditSave}
                onCancel={handleCancelEdit}
                saving={saving}
              />
            )}
          </>
        )}
      </OrderSection>

      {/* OTP Modal */}
      <OtpModal
        open={otpModal.open}
        title={otpModal.title}
        description={otpModal.description}
        onVerified={handleOtpVerified}
        onClose={() => {
          setOtpModal({ ...otpModal, open: false });
          (window as any).__pendingEditData = null;
        }}
      />

      {/* Deleting overlay */}
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
