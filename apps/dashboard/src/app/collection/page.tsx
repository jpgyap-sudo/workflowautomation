'use client';

import { useState, useRef, useEffect } from 'react';
import { useOrdersByStage } from '@/lib/useApi';
import type { Order } from '@/lib/api';
import { updateOrder, deleteOrder, grantDeliveryException, revokeDeliveryException, recordStageUpdate } from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import OtpModal from '@/components/OtpModal';
import { DollarSign, CheckCircle2, Clock, AlertTriangle, Pencil, Trash2, X, Check, ShieldAlert, ShieldCheck, FileText, Scale, Upload, Image, Loader2, ArrowRight } from 'lucide-react';

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

function OrderPaymentInfo({ order }: { order: Order }) {
  const totalAmount = Number(order.total_amount ?? 0);
  const depositAmount = Number(order.deposit_amount ?? 0);
  const balance = totalAmount - depositAmount;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
      {order.total_amount != null && (
        <span>Total: ₱{totalAmount.toLocaleString()}</span>
      )}
      {order.deposit_amount != null && (
        <span>Downpayment: ₱{depositAmount.toLocaleString()}</span>
      )}
      {order.total_amount != null && (
        <span className={balance > 0 ? 'font-medium text-violet-600' : 'text-green-600'}>
          Balance: {order.balance_paid ? '✅ Paid' : `₱${balance.toLocaleString()} due`}
        </span>
      )}
    </div>
  );
}

export default function CollectionPage() {
  const { data: inventoryArrivedOrders = [], isLoading: loadingArrived, mutate: mutateArrived } = useOrdersByStage('inventory_arrived');
  const { data: balanceDueOrders = [], isLoading: loadingBalanceDue, mutate: mutateBalanceDue } = useOrdersByStage('balance_due');
  const { data: deliveredOrders = [], isLoading: loadingDelivered, mutate: mutateDelivered } = useOrdersByStage('delivered');
  const { data: counteredOrders = [], isLoading: loadingCountered, mutate: mutateCountered } = useOrdersByStage('countered');
  const { data: paymentReceivedOrders = [], isLoading: loadingReceived, mutate: mutateReceived } = useOrdersByStage('payment_received');
  const { data: paymentConfirmedOrders = [], isLoading: loadingConfirmed, mutate: mutateConfirmed } = useOrdersByStage('payment_confirmed');
  const { data: completedOrders = [], isLoading: loadingCompleted, mutate: mutateCompleted } = useOrdersByStage('completed');
  // Fetch unsynced orders — balance_paid=TRUE but stage still balance_due (legacy gap)
  const [unsyncedOrders, setUnsyncedOrders] = useState<Order[]>([]);
  const [loadingUnsynced, setLoadingUnsynced] = useState(true);

  // Fetch unsynced payments on mount
  useEffect(() => {
    const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
    fetch(`${API_BASE}/orders/unsynced-payments`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { setUnsyncedOrders(data); setLoadingUnsynced(false); })
      .catch(() => setLoadingUnsynced(false));
  }, []);

  const loading = loadingArrived && loadingBalanceDue && loadingDelivered && loadingCountered && loadingReceived && loadingConfirmed && loadingCompleted && loadingUnsynced;

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

  // Special case (delivery exception) state
  const [exceptionModal, setExceptionModal] = useState<{
    open: boolean;
    order: Order | null;
    notes: string;
    granting: boolean;
  }>({ open: false, order: null, notes: '', granting: false });

  // Payment confirmation modal state
  const [paymentModal, setPaymentModal] = useState<{
    open: boolean;
    order: Order | null;
    uploading: boolean;
    error: string | null;
  }>({ open: false, order: null, uploading: false, error: null });
  const [depositSlipFile, setDepositSlipFile] = useState<{
    name: string;
    data: string; // base64
    mime: string;
    preview: string; // data URL for preview
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      mutateArrived();
      mutateBalanceDue();
      mutateDelivered();
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
      mutateArrived();
      mutateBalanceDue();
      mutateDelivered();
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

  // Special case handlers
  function openExceptionModal(order: Order) {
    setExceptionModal({ open: true, order, notes: order.delivery_exception_notes ?? '', granting: false });
  }

  function openRevokeExceptionModal(order: Order) {
    setExceptionModal({ open: true, order, notes: '', granting: false });
  }

  async function handleGrantException() {
    if (!exceptionModal.order) return;
    setExceptionModal((prev) => ({ ...prev, granting: true }));
    try {
      await grantDeliveryException(exceptionModal.order.id, exceptionModal.notes || undefined);
      setExceptionModal({ open: false, order: null, notes: '', granting: false });
      mutateArrived();
      mutateBalanceDue();
    } catch (err: any) {
      alert('Failed to grant delivery exception: ' + (err.message ?? 'Unknown error'));
      setExceptionModal((prev) => ({ ...prev, granting: false }));
    }
  }

  async function handleRevokeException(order: Order) {
    try {
      await revokeDeliveryException(order.id);
      mutateArrived();
      mutateBalanceDue();
      mutateCountered();
    } catch (err: any) {
      alert('Failed to revoke delivery exception: ' + (err.message ?? 'Unknown error'));
    }
  }

  // ── Payment Confirmation with Deposit Slip Upload ──────────────────────

  function handlePaymentConfirmClick(order: Order) {
    setPaymentModal({ open: true, order, uploading: false, error: null });
    setDepositSlipFile(null);
  }

  function handleDepositSlipFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      // result is a data URL like "data:image/png;base64,iVBOR..."
      const commaIndex = result.indexOf(',');
      const base64 = commaIndex !== -1 ? result.substring(commaIndex + 1) : result;
      setDepositSlipFile({
        name: file.name,
        data: base64,
        mime: file.type || 'image/jpeg',
        preview: result, // full data URL for preview
      });
    };
    reader.readAsDataURL(file);
  }

  async function handleConfirmPayment() {
    const order = paymentModal.order;
    if (!order || !depositSlipFile) return;

    setPaymentModal((prev) => ({ ...prev, uploading: true, error: null }));
    try {
      // Record stage update — payment confirmed
      // Deposit slips are not stored on VPS (privacy policy)
      await recordStageUpdate({
        quotation_number: order.quotation_number ?? '',
        stage: 'payment_confirmed',
        status: 'confirmed',
        remarks: `Payment confirmed via dashboard.`,
        updated_by: 'dashboard',
      });

      // Close modal and refresh
      setPaymentModal({ open: false, order: null, uploading: false, error: null });
      setDepositSlipFile(null);
      mutateArrived();
      mutateBalanceDue();
      mutateDelivered();
      mutateCountered();
      mutateReceived();
      mutateConfirmed();
      mutateCompleted();
    } catch (err: any) {
      setPaymentModal((prev) => ({
        ...prev,
        uploading: false,
        error: err.message ?? 'Failed to confirm payment. Please try again.',
      }));
    }
  }

  function closePaymentModal() {
    setPaymentModal({ open: false, order: null, uploading: false, error: null });
    setDepositSlipFile(null);
  }

  if (loading && inventoryArrivedOrders.length === 0 && balanceDueOrders.length === 0 && deliveredOrders.length === 0 && counteredOrders.length === 0 && paymentReceivedOrders.length === 0 && paymentConfirmedOrders.length === 0 && completedOrders.length === 0 && unsyncedOrders.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
      </div>
    );
  }

  function renderOrderRow(order: Order, mutates: (() => void)[]) {
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
            <OrderPaymentInfo order={order} />
            {hasException && order.delivery_exception_notes && (
              <p className="mt-1 text-[11px] italic text-amber-600">
                Note: {order.delivery_exception_notes}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <StageBadge stage={order.current_stage} />
            <div className="flex items-center gap-1">
              {/* Mark as Payment Received — for delivered stage (skip countered) */}
              {order.current_stage === 'delivered' && (
                <button
                  onClick={async () => {
                    try {
                      await recordStageUpdate({
                        quotation_number: order.quotation_number ?? '',
                        stage: 'payment_received',
                        status: 'received',
                        remarks: 'Payment received (delivered → payment_received, skipped countered)',
                        updated_by: 'dashboard',
                      });
                      mutateDelivered();
                      mutateReceived();
                    } catch (err: any) {
                      alert('Failed to mark payment received: ' + (err.message ?? 'Unknown error'));
                    }
                  }}
                  className="rounded-lg p-1.5 text-emerald-500 hover:bg-emerald-50 hover:text-emerald-700"
                  title="Mark as Payment Received (skip countered)"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
              {/* Payment Confirmed button — only for inventory_arrived / balance_due */}
              {(order.current_stage === 'inventory_arrived' || order.current_stage === 'balance_due') && (
                <button
                  onClick={() => handlePaymentConfirmClick(order)}
                  className="rounded-lg p-1.5 text-emerald-500 hover:bg-emerald-50 hover:text-emerald-700"
                  title="Confirm payment — upload deposit slip to Google Drive"
                >
                  <CheckCircle2 className="h-4 w-4" />
                </button>
              )}
              {/* Special Case button */}
              {!hasException && (
                <button
                  onClick={() => openExceptionModal(order)}
                  className="rounded-lg p-1.5 text-amber-400 hover:bg-amber-50 hover:text-amber-600"
                  title="Grant delivery exception (special case)"
                >
                  <ShieldAlert className="h-4 w-4" />
                </button>
              )}
              {hasException && (
                <button
                  onClick={() => handleRevokeException(order)}
                  className="rounded-lg p-1.5 text-green-500 hover:bg-green-50 hover:text-green-700"
                  title="Revoke delivery exception"
                >
                  <ShieldCheck className="h-4 w-4" />
                </button>
              )}
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
              <strong>Policy:</strong> Payment is required <em>before</em> delivery, unless a Special Case exception is granted.
              Collection team sends deposit slip/proof of payment → Updates via{' '}
              <code className="rounded bg-emerald-100 px-1">/payment QTN-2026-001 confirmed</code>
              {' '}→ When confirmed, order becomes completed → Verification notification sent
            </p>
          </div>
        </div>
      </div>

      {/* For Payment Before Delivery (Inventory Arrived + Balance Due) */}
      <div className="rounded-xl border border-amber-200 bg-white">
        <div className="flex items-center gap-2 border-b border-amber-200 px-6 py-4">
          <Scale className="h-4 w-4 text-amber-500" />
          <h2 className="text-base font-semibold text-gray-800">For Payment Before Delivery</h2>
          <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            {(inventoryArrivedOrders.length + balanceDueOrders.length)}
          </span>
        </div>
        {inventoryArrivedOrders.length === 0 && balanceDueOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No orders awaiting payment before delivery</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {/* Inventory Arrived sub-section */}
            {inventoryArrivedOrders.length > 0 && (
              <>
                <div className="bg-amber-50/50 px-6 py-2">
                  <p className="text-xs font-medium text-amber-700">
                    📦 Inventory Arrived — Payment needed before delivery can proceed
                  </p>
                </div>
                {inventoryArrivedOrders.map((order) => renderOrderRow(order, [mutateArrived, mutateBalanceDue]))}
              </>
            )}
            {/* Balance Due sub-section */}
            {balanceDueOrders.length > 0 && (
              <>
                <div className="bg-violet-50/50 px-6 py-2">
                  <p className="text-xs font-medium text-violet-700">
                    ⚖️ Balance Due — Payment needed before delivery can proceed
                  </p>
                </div>
                {balanceDueOrders.map((order) => renderOrderRow(order, [mutateBalanceDue]))}
              </>
            )}
          </div>
        )}
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
            {counteredOrders.map((order) => renderOrderRow(order, [mutateCountered]))}
          </div>
        )}
      </div>

      {/* Payment Received */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <Clock className="h-4 w-4 text-emerald-500" />
          <h2 className="text-base font-semibold text-gray-800">Payment Received (Pending Confirmation)</h2>
          <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            {paymentReceivedOrders.length + unsyncedOrders.length}
          </span>
        </div>
        {paymentReceivedOrders.length === 0 && unsyncedOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No pending payment confirmations</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {/* Unsynced orders — balance_paid=TRUE but stage stuck at balance_due (legacy gap) */}
            {unsyncedOrders.length > 0 && (
              <>
                <div className="bg-amber-50/50 px-6 py-2">
                  <p className="text-xs font-medium text-amber-700">
                    ⚠️ Legacy — Balance paid but not yet synced to Payment Received stage
                  </p>
                </div>
                {unsyncedOrders.map((order) => (
                  <div key={order.id}>
                    <div className="flex items-center justify-between px-6 py-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900">{order.quotation_number ?? '—'}</p>
                        </div>
                        <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                        {order.sales_agent && (
                          <p className="text-[11px] text-gray-400">{order.sales_agent}</p>
                        )}
                        <OrderPaymentInfo order={order} />
                      </div>
                      <div className="flex items-center gap-3">
                        <StageBadge stage={order.current_stage} />
                        <button
                          onClick={async () => {
                            try {
                              const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
                              await fetch(`${API_BASE}/stage-updates`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  quotation_number: order.quotation_number ?? '',
                                  stage: 'payment_received',
                                  status: 'balance_paid',
                                  remarks: 'Synced from legacy — balance was already paid but stage was not updated',
                                  updated_by: 'dashboard',
                                }),
                              });
                              // Also update the order's current_stage
                              await fetch(`${API_BASE}/orders/unsynced-payments/sync`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ order_id: order.id }),
                              });
                              // Re-fetch unsynced list
                              const res = await fetch(`${API_BASE}/orders/unsynced-payments`);
                              const data = res.ok ? await res.json() : [];
                              setUnsyncedOrders(data);
                              mutateReceived();
                            } catch (err: any) {
                              alert('Failed to sync: ' + (err.message ?? 'Unknown error'));
                            }
                          }}
                          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
                          title="Sync this order to Payment Received stage"
                        >
                          Sync to Payment Received
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
            {paymentReceivedOrders.map((order) => renderOrderRow(order, [mutateReceived]))}
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
            {paymentConfirmedOrders.map((order) => renderOrderRow(order, [mutateConfirmed]))}
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
            {completedOrders.map((order) => renderOrderRow(order, [mutateCompleted]))}
          </div>
        )}
      </div>

      {/* Payment Confirmation Modal — Upload Deposit Slip */}
      {paymentModal.open && paymentModal.order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
              <div>
                <h3 className="text-base font-semibold text-gray-900">Confirm Payment</h3>
                <p className="text-xs text-gray-500">
                  {paymentModal.order.quotation_number ?? '—'} — {paymentModal.order.client_name ?? 'Unknown'}
                </p>
              </div>
            </div>

            {/* Order payment summary */}
            <div className="mb-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
              <div className="flex justify-between">
                <span>Total Amount:</span>
                <span className="font-medium">₱{Number(paymentModal.order.total_amount ?? 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Downpayment Paid:</span>
                <span className="font-medium">₱{Number(paymentModal.order.deposit_amount ?? 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-violet-700">
                <span>Balance Due:</span>
                <span className="font-medium">
                  ₱{(Number(paymentModal.order.total_amount ?? 0) - Number(paymentModal.order.deposit_amount ?? 0)).toLocaleString()}
                </span>
              </div>
            </div>

            <p className="mb-3 text-sm text-gray-600">
              Upload the <strong>deposit slip</strong> or proof of balance payment. The file will be
              automatically saved to the client's Google Drive folder.
            </p>

            {/* File upload area */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`mb-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors ${
                depositSlipFile
                  ? 'border-emerald-300 bg-emerald-50'
                  : 'border-gray-300 bg-gray-50 hover:border-emerald-300 hover:bg-emerald-50'
              }`}
            >
              {depositSlipFile ? (
                <div className="flex flex-col items-center gap-2">
                  {depositSlipFile.mime.startsWith('image/') ? (
                    <img
                      src={depositSlipFile.preview}
                      alt="Deposit slip preview"
                      className="max-h-32 max-w-full rounded-lg object-contain"
                    />
                  ) : (
                    <FileText className="h-10 w-10 text-emerald-500" />
                  )}
                  <span className="text-xs font-medium text-emerald-700">{depositSlipFile.name}</span>
                  <span className="text-[10px] text-emerald-500">Click to change file</span>
                </div>
              ) : (
                <>
                  <Upload className="mb-2 h-8 w-8 text-gray-400" />
                  <span className="text-sm font-medium text-gray-600">Click to upload deposit slip</span>
                  <span className="mt-1 text-[11px] text-gray-400">PNG, JPG, or PDF accepted</span>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={handleDepositSlipFileSelect}
              />
            </div>

            {/* Error message */}
            {paymentModal.error && (
              <div className="mb-4 rounded-lg bg-red-50 p-3 text-xs text-red-700">
                {paymentModal.error}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex justify-end gap-2">
              <button
                onClick={closePaymentModal}
                disabled={paymentModal.uploading}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmPayment}
                disabled={paymentModal.uploading || !depositSlipFile}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {paymentModal.uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Confirm Payment
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Special Case Exception Modal */}
      {exceptionModal.open && exceptionModal.order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <ShieldAlert className="h-6 w-6 text-amber-500" />
              <div>
                <h3 className="text-base font-semibold text-gray-900">Grant Delivery Exception</h3>
                <p className="text-xs text-gray-500">
                  {exceptionModal.order.quotation_number ?? '—'} — {exceptionModal.order.client_name ?? 'Unknown'}
                </p>
              </div>
            </div>
            <p className="mb-4 text-sm text-gray-600">
              This will mark the order as a <strong>Special Case</strong>, allowing delivery to proceed
              without payment. Please provide a reason for the exception.
            </p>
            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-gray-600">Reason / Notes</label>
              <textarea
                value={exceptionModal.notes}
                onChange={(e) => setExceptionModal((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="e.g. Long-time client, payment guaranteed within 7 days"
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setExceptionModal({ open: false, order: null, notes: '', granting: false })}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleGrantException}
                disabled={exceptionModal.granting || !exceptionModal.notes.trim()}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {exceptionModal.granting ? 'Granting...' : 'Grant Exception'}
              </button>
            </div>
          </div>
        </div>
      )}

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
