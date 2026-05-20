'use client';

import { useState } from 'react';
import { useOrdersByStage } from '@/lib/useApi';
import type { Order } from '@/lib/api';
import { updateOrder, deleteOrder } from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import OtpModal from '@/components/OtpModal';
import { Truck, Calendar, CheckCircle2, Scale, AlertTriangle, Pencil, Trash2, X, Check, MapPin, Phone, UserCheck, ShieldAlert } from 'lucide-react';

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

function OrderDeliveryInfo({ order }: { order: Order }) {
  if (!order.delivery_address && !order.contact_number && !order.authorized_receiver_name && !order.authorized_receiver_contact) {
    return null;
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-purple-700">
      {order.delivery_address && (
        <span className="flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          {order.delivery_address}
        </span>
      )}
      {order.contact_number && (
        <span className="flex items-center gap-1">
          <Phone className="h-3 w-3" />
          {order.contact_number}
        </span>
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

export default function DeliveryPage() {
  const {
    data: balanceDueOrders = [],
    isLoading: loadingBalanceDue,
    mutate: mutateBalanceDue,
  } = useOrdersByStage('balance_due');

  const {
    data: scheduledOrders = [],
    isLoading: loadingScheduled,
    mutate: mutateScheduled,
  } = useOrdersByStage('delivery_scheduled');

  const {
    data: deliveredOrders = [],
    isLoading: loadingDelivered,
    mutate: mutateDelivered,
  } = useOrdersByStage('delivered');

  const loading = loadingBalanceDue && loadingScheduled && loadingDelivered;

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
      mutateBalanceDue();
      mutateScheduled();
      mutateDelivered();
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
      mutateBalanceDue();
      mutateScheduled();
      mutateDelivered();
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

  if (loading && balanceDueOrders.length === 0 && scheduledOrders.length === 0 && deliveredOrders.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Workflow info from Excel */}
      <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
        <div className="flex items-start gap-3">
          <Truck className="mt-0.5 h-5 w-5 text-purple-600" />
          <div>
            <h3 className="text-sm font-semibold text-purple-800">Delivery Workflow</h3>
            <p className="mt-1 text-xs text-purple-700">
              Balance must be paid before delivery can be scheduled → Team records payment via{' '}
              <code className="rounded bg-purple-100 px-1">/paybalance QTN-2026-001 15000</code>
              {' '}→ Then schedules delivery via{' '}
              <code className="rounded bg-purple-100 px-1">/deliverydate QTN-2026-001 May 22 2026</code>
              {' '}→ Delivery team sends photos/DR → Updates via{' '}
              <code className="rounded bg-purple-100 px-1">/delivered QTN-2026-001 yes countered</code>
            </p>
          </div>
        </div>
      </div>

      {/* Balance Due (blocked until paid) */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <Scale className="h-4 w-4 text-violet-500" />
          <h2 className="text-base font-semibold text-gray-800">Balance Due (Awaiting Payment)</h2>
          <span className="ml-auto rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
            {balanceDueOrders.length}
          </span>
        </div>
        {balanceDueOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No orders awaiting balance payment</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {balanceDueOrders.map((order) => {
              const totalAmount = Number(order.total_amount ?? 0);
              const depositAmount = Number(order.deposit_amount ?? 0);
              const balance = totalAmount - depositAmount;
              const hasException = order.delivery_exception === true;
              return (
                <div key={order.id}>
                  <div className="flex items-center justify-between px-6 py-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900">{order.quotation_number ?? '—'}</p>
                        {hasException && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            <ShieldAlert className="h-3 w-3" />
                            Special Case
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                      {order.sales_agent && (
                        <p className="text-[11px] text-gray-400">{order.sales_agent}</p>
                      )}
                      {hasException && order.delivery_exception_notes && (
                        <p className="mt-1 text-[11px] italic text-amber-600">
                          Exception: {order.delivery_exception_notes}
                        </p>
                      )}
                      <OrderDeliveryInfo order={order} />
                    </div>
                    <div className="flex items-center gap-3">
                      {hasException ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          Exception Granted
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-violet-600">
                          ₱{balance.toLocaleString()} due
                        </span>
                      )}
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
              );
            })}
          </div>
        )}
      </div>

      {/* Scheduled Deliveries */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <Calendar className="h-4 w-4 text-purple-500" />
          <h2 className="text-base font-semibold text-gray-800">Scheduled Deliveries</h2>
          <span className="ml-auto rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
            {scheduledOrders.length}
          </span>
        </div>
        {scheduledOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No scheduled deliveries</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {scheduledOrders.map((order) => {
              const totalAmount = Number(order.total_amount ?? 0);
              const depositAmount = Number(order.deposit_amount ?? 0);
              const balance = totalAmount - depositAmount;
              const hasException = order.delivery_exception === true;
              return (
                <div key={order.id}>
                  <div className="flex items-center justify-between px-6 py-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900">{order.quotation_number ?? '—'}</p>
                        {hasException && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            <ShieldAlert className="h-3 w-3" />
                            Special Case
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                      {order.sales_agent && (
                        <p className="text-[11px] text-gray-400">{order.sales_agent}</p>
                      )}
                      {order.total_amount != null && (
                        <p className="mt-0.5 text-xs text-gray-400">
                          Total: ₱{totalAmount.toLocaleString()} | Balance: {order.balance_paid ? '✅ Paid' : `₱${balance.toLocaleString()}`}
                        </p>
                      )}
                      {hasException && order.delivery_exception_notes && (
                        <p className="mt-0.5 text-[11px] italic text-amber-600">
                          Exception: {order.delivery_exception_notes}
                        </p>
                      )}
                      <OrderDeliveryInfo order={order} />
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">
                        {new Date(order.created_at).toLocaleDateString()}
                      </span>
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
              );
            })}
          </div>
        )}
      </div>

      {/* Delivered */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <CheckCircle2 className="h-4 w-4 text-orange-500" />
          <h2 className="text-base font-semibold text-gray-800">Delivered</h2>
          <span className="ml-auto rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
            {deliveredOrders.length}
          </span>
        </div>
        {deliveredOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No delivered orders</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {deliveredOrders.map((order) => (
              <div key={order.id}>
                <div className="flex items-center justify-between px-6 py-4">
                  <div>
                    <p className="font-medium text-gray-900">{order.quotation_number ?? '—'}</p>
                    <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                    {order.sales_agent && (
                      <p className="text-[11px] text-gray-400">{order.sales_agent}</p>
                    )}
                    <OrderDeliveryInfo order={order} />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">
                      {new Date(order.created_at).toLocaleDateString()}
                    </span>
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

      {/* Workflow fields from Excel */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Estimated Delivery Date</p>
          <p className="mt-1 text-sm text-gray-800">—</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Actual Delivery Date</p>
          <p className="mt-1 text-sm text-gray-800">—</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">PO / Quotation #</p>
          <p className="mt-1 text-sm text-gray-800">—</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Delivery Issues</p>
          <p className="mt-1 text-sm text-gray-800">—</p>
        </div>
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
