'use client';

import { useState } from 'react';
import { useOrdersByStage } from '@/lib/useApi';
import type { Order } from '@/lib/api';
import { updateOrder, deleteOrder } from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import OtpModal from '@/components/OtpModal';
import { ShoppingCart, Factory, Clock, ExternalLink, Pencil, Trash2, X, Check, ChevronDown, ChevronUp, AlertTriangle, CheckCircle, Calendar } from 'lucide-react';

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

function computeFinishDate(order: Order): string | null {
  if (!order.production_started || !order.estimated_production_days) return null;
  // Estimate start date from created_at or production_finished_at
  const startDate = order.production_finished_at
    ? new Date(order.production_finished_at)
    : new Date(order.created_at);
  // If production_finished, use finished_at; otherwise estimate from created_at
  const finishDate = new Date(startDate);
  finishDate.setDate(finishDate.getDate() + order.estimated_production_days);
  return finishDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function ProductionInfo({ order }: { order: Order }) {
  if (!order.production_started) return null;

  const finishDate = computeFinishDate(order);
  const isDelayed = order.production_delayed;
  const delayDays = order.production_delay_days;
  const isFinished = order.production_finished;
  const deliveryDays = order.delivery_estimated_days;

  return (
    <div className="border-t border-gray-100 bg-gray-50/50 px-6 py-3">
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
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
            <p className="mt-1 font-semibold text-gray-800">{finishDate}</p>
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
    </div>
  );
}

interface OrderRowProps {
  order: Order;
  onEdit: (order: Order) => void;
  onDelete: (order: Order) => void;
}

function OrderRow({ order, onEdit, onDelete }: OrderRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-gray-50/50"
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-900">{order.quotation_number ?? '—'}</p>
          <p className="truncate text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
          {order.sales_agent && (
            <p className="text-[11px] text-gray-400">{order.sales_agent}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <DriveLink folderId={order.google_drive_folder_id} />
          <span className="hidden text-xs text-gray-400 sm:inline">
            {new Date(order.created_at).toLocaleDateString()}
          </span>
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
      {expanded && <ProductionInfo order={order} />}
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

export default function PurchasingPage() {
  const {
    data: pendingOrders = [],
    isLoading: loadingPending,
    mutate: mutatePending,
  } = useOrdersByStage('purchasing_pending');

  const {
    data: productionOrders = [],
    isLoading: loadingProduction,
    mutate: mutateProduction,
  } = useOrdersByStage('production_confirmed');

  const loading = loadingPending && loadingProduction;

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

  if (loading && pendingOrders.length === 0 && productionOrders.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
      </div>
    );
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
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <Clock className="h-4 w-4 text-amber-500" />
          <h2 className="text-base font-semibold text-gray-800">Pending Purchasing</h2>
          <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            {pendingOrders.length}
          </span>
        </div>
        {pendingOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No pending purchasing orders</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {pendingOrders.map((order) => (
              <div key={order.id}>
                <OrderRow order={order} onEdit={handleEdit} onDelete={handleDeleteClick} />
                {editingOrder?.id === order.id && (
                  <EditForm
                    order={order}
                    onSave={handleEditSave}
                    onCancel={handleCancelEdit}
                    saving={saving}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Production Confirmed */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <Factory className="h-4 w-4 text-indigo-500" />
          <h2 className="text-base font-semibold text-gray-800">Production Confirmed</h2>
          <span className="ml-auto rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
            {productionOrders.length}
          </span>
        </div>
        {productionOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No production confirmed orders</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {productionOrders.map((order) => (
              <div key={order.id}>
                <OrderRow order={order} onEdit={handleEdit} onDelete={handleDeleteClick} />
                {editingOrder?.id === order.id && (
                  <EditForm
                    order={order}
                    onSave={handleEditSave}
                    onCancel={handleCancelEdit}
                    saving={saving}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

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
