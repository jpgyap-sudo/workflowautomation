'use client';

import { useState } from 'react';
import { useOrdersByStage } from '@/lib/useApi';
import type { Order } from '@/lib/api';
import { updateOrder, deleteOrder } from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import OtpModal from '@/components/OtpModal';
import { DollarSign, CheckCircle2, Clock, AlertTriangle, Pencil, Trash2, X, Check } from 'lucide-react';

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

export default function CollectionPage() {
  const { data: counteredOrders = [], isLoading: loadingCountered, mutate: mutateCountered } = useOrdersByStage('countered');
  const { data: paymentReceivedOrders = [], isLoading: loadingReceived, mutate: mutateReceived } = useOrdersByStage('payment_received');
  const { data: paymentConfirmedOrders = [], isLoading: loadingConfirmed, mutate: mutateConfirmed } = useOrdersByStage('payment_confirmed');
  const { data: completedOrders = [], isLoading: loadingCompleted, mutate: mutateCompleted } = useOrdersByStage('completed');

  const loading = loadingCountered && loadingReceived && loadingConfirmed && loadingCompleted;

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
    (window as any).__pendingEditData = { orderId: editingOrder.id, data };
  }

  async function handleEditVerified(actionToken: string) {
    const pending = (window as any).__pendingEditData;
    if (!pending) return;
    setSaving(true);
    try {
      await updateOrder(pending.orderId, { ...pending.data, action_token: actionToken });
      setEditingOrder(null);
      mutateCountered();
      mutateReceived();
      mutateConfirmed();
      mutateCompleted();
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
      mutateCountered();
      mutateReceived();
      mutateConfirmed();
      mutateCompleted();
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

  if (loading && counteredOrders.length === 0 && paymentReceivedOrders.length === 0 && paymentConfirmedOrders.length === 0 && completedOrders.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Workflow info from Excel */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-start gap-3">
          <DollarSign className="mt-0.5 h-5 w-5 text-emerald-600" />
          <div>
            <h3 className="text-sm font-semibold text-emerald-800">Counter & Collection Workflow</h3>
            <p className="mt-1 text-xs text-emerald-700">
              Collection team sends deposit slip/proof of payment → Updates via{' '}
              <code className="rounded bg-emerald-100 px-1">/payment QTN-2026-001 confirmed</code>
              {' '}→ When confirmed, order becomes completed → Verification notification sent
            </p>
          </div>
        </div>
      </div>

      {/* Countered */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <AlertTriangle className="h-4 w-4 text-rose-500" />
          <h2 className="text-base font-semibold text-gray-800">Countered</h2>
          <span className="ml-auto rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
            {counteredOrders.length}
          </span>
        </div>
        {counteredOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No countered orders</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {counteredOrders.map((order) => (
              <div key={order.id}>
                <div className="flex items-center justify-between px-6 py-4">
                  <div>
                    <p className="font-medium text-gray-900">{order.quotation_number ?? '—'}</p>
                    <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                    {order.sales_agent && (
                      <p className="text-[11px] text-gray-400">{order.sales_agent}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <StageBadge stage={order.current_stage} />
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEdit(order)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#2490ef]"
                        title="Edit order"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteClick(order)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                        title="Delete order"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
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

      {/* Payment Received */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <Clock className="h-4 w-4 text-emerald-500" />
          <h2 className="text-base font-semibold text-gray-800">Payment Received (Pending Confirmation)</h2>
          <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            {paymentReceivedOrders.length}
          </span>
        </div>
        {paymentReceivedOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No pending payment confirmations</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {paymentReceivedOrders.map((order) => (
              <div key={order.id}>
                <div className="flex items-center justify-between px-6 py-4">
                  <div>
                    <p className="font-medium text-gray-900">{order.quotation_number ?? '—'}</p>
                    <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                    {order.sales_agent && (
                      <p className="text-[11px] text-gray-400">{order.sales_agent}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <StageBadge stage={order.current_stage} />
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEdit(order)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#2490ef]"
                        title="Edit order"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteClick(order)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                        title="Delete order"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
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

      {/* Payment Confirmed */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <h2 className="text-base font-semibold text-gray-800">Payment Confirmed</h2>
          <span className="ml-auto rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            {paymentConfirmedOrders.length}
          </span>
        </div>
        {paymentConfirmedOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No confirmed payments</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {paymentConfirmedOrders.map((order) => (
              <div key={order.id}>
                <div className="flex items-center justify-between px-6 py-4">
                  <div>
                    <p className="font-medium text-gray-900">{order.quotation_number ?? '—'}</p>
                    <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                    {order.sales_agent && (
                      <p className="text-[11px] text-gray-400">{order.sales_agent}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <StageBadge stage={order.current_stage} />
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEdit(order)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#2490ef]"
                        title="Edit order"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteClick(order)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                        title="Delete order"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
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

      {/* Completed */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <CheckCircle2 className="h-4 w-4 text-gray-500" />
          <h2 className="text-base font-semibold text-gray-800">Completed Orders</h2>
          <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
            {completedOrders.length}
          </span>
        </div>
        {completedOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No completed orders</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {completedOrders.map((order) => (
              <div key={order.id}>
                <div className="flex items-center justify-between px-6 py-4">
                  <div>
                    <p className="font-medium text-gray-900">{order.quotation_number ?? '—'}</p>
                    <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                    {order.sales_agent && (
                      <p className="text-[11px] text-gray-400">{order.sales_agent}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <StageBadge stage={order.current_stage} />
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEdit(order)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#2490ef]"
                        title="Edit order"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteClick(order)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                        title="Delete order"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
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
