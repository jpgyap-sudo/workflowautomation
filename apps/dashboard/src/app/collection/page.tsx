'use client';

import { useState, useRef, useEffect } from 'react';
import { useOrdersByStage } from '@/lib/useApi';
import type { Order } from '@/lib/api';
import { updateOrder, deleteOrder, grantDeliveryException, revokeDeliveryException, recordStageUpdate, verifyDeposit, verifyBalance, payBalanceWithFile, visionExtract, getOrderPayments, getAcknowledgementReceipts, type AcknowledgementReceipt } from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import OtpModal from '@/components/OtpModal';
import { QuotationNumberCell, FileViewerModal, useOrderFileViewer } from '@/components/OrderFileViewer';
import { DollarSign, CheckCircle2, Clock, AlertTriangle, Pencil, Trash2, X, Check, ShieldAlert, ShieldCheck, FileText, Scale, Upload, Image, Loader2, ArrowRight, Search, ThumbsUp, CreditCard, Send, Download } from 'lucide-react';

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

function formatCollectionDate(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function PaymentStatusBadge({
  paidAt,
  verified,
  verifiedAt,
}: {
  paidAt: string | null | undefined;
  verified: boolean | null | undefined;
  verifiedAt: string | null | undefined;
}) {
  if (!paidAt) {
    return (
      <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
        Not paid
      </span>
    );
  }

  if (verified) {
    return (
      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
        Verified{verifiedAt ? ` · ${formatCollectionDate(verifiedAt)}` : ''}
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
      Pending verification
    </span>
  );
}

function CollectionSummary({
  orders,
  onDateEdit,
  savingKey,
}: {
  orders: Order[];
  onDateEdit: (order: Order, field: 'deposit_paid_at' | 'balance_paid_at', value: string) => void;
  savingKey: string | null;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
        <DollarSign className="h-4 w-4 text-emerald-500" />
        <div>
          <h2 className="text-base font-semibold text-gray-800">Collection Summary</h2>
          <p className="text-xs text-gray-500">
            Client, quotation/order number, downpayment, and balance verification status.
          </p>
        </div>
        <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
          {orders.length}
        </span>
      </div>

      {orders.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-400">No collection orders to summarize</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-left text-xs">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-6 py-3 font-semibold">Client</th>
                <th className="px-6 py-3 font-semibold">Quotation / Order #</th>
                <th className="px-6 py-3 font-semibold">Downpayment Date</th>
                <th className="px-6 py-3 font-semibold">Downpayment Verification</th>
                <th className="px-6 py-3 font-semibold">Balance Payment Date</th>
                <th className="px-6 py-3 font-semibold">Balance Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-gray-50/70">
                  <td className="whitespace-nowrap px-6 py-3 font-medium text-gray-800">
                    {order.client_name ?? 'Unknown client'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-[#2490ef]">
                    {order.quotation_number ?? order.id.slice(0, 8)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-gray-600">
                    <input
                      type="date"
                      defaultValue={toDateInputValue(order.deposit_paid_at)}
                      disabled={savingKey === `${order.id}:deposit_paid_at`}
                      onChange={(e) => onDateEdit(order, 'deposit_paid_at', e.target.value)}
                      className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef] disabled:opacity-50"
                      title="Edit downpayment date"
                    />
                  </td>
                  <td className="whitespace-nowrap px-6 py-3">
                    <PaymentStatusBadge
                      paidAt={order.deposit_paid_at}
                      verified={order.deposit_verified}
                      verifiedAt={order.deposit_verified_at}
                    />
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-gray-600">
                    <input
                      type="date"
                      defaultValue={toDateInputValue(order.balance_paid_at)}
                      disabled={savingKey === `${order.id}:balance_paid_at`}
                      onChange={(e) => onDateEdit(order, 'balance_paid_at', e.target.value)}
                      className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef] disabled:opacity-50"
                      title="Edit balance payment date"
                    />
                  </td>
                  <td className="whitespace-nowrap px-6 py-3">
                    <PaymentStatusBadge
                      paidAt={order.balance_paid_at}
                      verified={order.balance_verified}
                      verifiedAt={order.balance_verified_at}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AcknowledgementReceiptsSection({
  receipts,
  loading,
}: {
  receipts: AcknowledgementReceipt[];
  loading: boolean;
}) {
  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

  return (
    <div className="overflow-hidden rounded-xl border border-indigo-200 bg-white">
      <div className="flex items-center gap-2 border-b border-indigo-200 px-6 py-4">
        <FileText className="h-4 w-4 text-indigo-500" />
        <div>
          <h2 className="text-base font-semibold text-gray-800">Acknowledgement Receipts</h2>
          <p className="text-xs text-gray-500">
            Download PDF receipts automatically generated for downpayment, balance, and full payments.
          </p>
        </div>
        <span className="ml-auto rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
          {receipts.length}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-indigo-500" />
        </div>
      ) : receipts.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-400">No payment receipts recorded yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-left text-xs">
            <thead className="bg-indigo-50/60 text-[11px] uppercase tracking-wider text-indigo-700">
              <tr>
                <th className="px-6 py-3 font-semibold">Receipt #</th>
                <th className="px-6 py-3 font-semibold">Order #</th>
                <th className="px-6 py-3 font-semibold">Client</th>
                <th className="px-6 py-3 font-semibold">Payment</th>
                <th className="px-6 py-3 font-semibold">Amount</th>
                <th className="px-6 py-3 font-semibold">Date</th>
                <th className="px-6 py-3 font-semibold">Status</th>
                <th className="px-6 py-3 font-semibold">PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {receipts.map((receipt) => (
                <tr key={receipt.payment_id} className="hover:bg-indigo-50/30">
                  <td className="whitespace-nowrap px-6 py-3 font-medium text-gray-800">{receipt.receipt_number}</td>
                  <td className="whitespace-nowrap px-6 py-3 text-[#2490ef]">{receipt.quotation_number ?? receipt.order_id.slice(0, 8)}</td>
                  <td className="whitespace-nowrap px-6 py-3 text-gray-600">{receipt.client_name ?? 'Unknown client'}</td>
                  <td className="whitespace-nowrap px-6 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      receipt.payment_type === 'Full Payment'
                        ? 'bg-purple-100 text-purple-700'
                        : receipt.payment_type === 'Balance Payment'
                          ? 'bg-violet-100 text-violet-700'
                          : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {receipt.payment_type}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 font-medium text-gray-800">
                    ₱{Number(receipt.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-gray-600">
                    {formatCollectionDate(receipt.payment_date ?? receipt.created_at)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      receipt.verified ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {receipt.verified ? 'Verified' : 'Pending'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3">
                    <a
                      href={`${API_BASE}${receipt.download_url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                    >
                      <Download className="h-3 w-3" />
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function CollectionPage() {
  const { viewingFilesOrder, orderFiles, handleViewFiles, refreshFiles, closeViewer } = useOrderFileViewer();

  const { data: inventoryArrivedOrders = [], isLoading: loadingArrived, mutate: mutateArrived } = useOrdersByStage('inventory_arrived');
  const { data: balanceDueOrders = [], isLoading: loadingBalanceDue, mutate: mutateBalanceDue } = useOrdersByStage('balance_due');
  const { data: deliveredOrders = [], isLoading: loadingDelivered, mutate: mutateDelivered } = useOrdersByStage('delivered');
  const { data: counteredOrders = [], isLoading: loadingCountered, mutate: mutateCountered } = useOrdersByStage('countered');
  const { data: paymentReceivedOrders = [], isLoading: loadingReceived, mutate: mutateReceived } = useOrdersByStage('payment_received');
  const { data: paymentConfirmedOrders = [], isLoading: loadingConfirmed, mutate: mutateConfirmed } = useOrdersByStage('payment_confirmed');
  const { data: completedOrders = [], isLoading: loadingCompleted, mutate: mutateCompleted } = useOrdersByStage('completed');
  // Payment verification stages
  const { data: depositVerificationOrders = [], isLoading: loadingDepositVerification, mutate: mutateDepositVerification } = useOrdersByStage('deposit_verification');
  const { data: balanceVerificationOrders = [], isLoading: loadingBalanceVerification, mutate: mutateBalanceVerification } = useOrdersByStage('balance_verification');
  // Fetch unsynced orders — balance_paid=TRUE but stage still balance_due (legacy gap)
  const [unsyncedOrders, setUnsyncedOrders] = useState<Order[]>([]);
  const [loadingUnsynced, setLoadingUnsynced] = useState(true);
  const [acknowledgementReceipts, setAcknowledgementReceipts] = useState<AcknowledgementReceipt[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(true);

  async function refreshAcknowledgementReceipts() {
    setLoadingReceipts(true);
    try {
      const res = await getAcknowledgementReceipts(100);
      if (res.ok) setAcknowledgementReceipts(res.receipts);
    } catch {
      setAcknowledgementReceipts([]);
    } finally {
      setLoadingReceipts(false);
    }
  }

  // Fetch unsynced payments on mount
  useEffect(() => {
    const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
    fetch(`${API_BASE}/orders/unsynced-payments`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { setUnsyncedOrders(data); setLoadingUnsynced(false); })
      .catch(() => setLoadingUnsynced(false));
  }, []);

  useEffect(() => {
    refreshAcknowledgementReceipts();
  }, []);

  const loading = loadingArrived && loadingBalanceDue && loadingDelivered && loadingCountered && loadingReceived && loadingConfirmed && loadingCompleted && loadingDepositVerification && loadingBalanceVerification && loadingUnsynced;

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
    pendingAction: 'edit' | 'delete' | 'verifyDeposit' | 'verifyBalance' | 'grantDeliveryException' | 'revokeDeliveryException' | 'confirmPayment' | 'markCountered' | 'markCompleted' | 'syncPaymentReceived' | 'editPaymentDate' | 'advancePaymentReceived' | 'advancePaymentConfirmed' | 'markPaymentReceived';
  }>({ open: false, title: '', description: '', pendingAction: 'edit' });
  const [paymentDateSavingKey, setPaymentDateSavingKey] = useState<string | null>(null);

  // Special case (delivery exception) state
  const [exceptionModal, setExceptionModal] = useState<{
    open: boolean;
    order: Order | null;
    notes: string;
    granting: boolean;
  }>({ open: false, order: null, notes: '', granting: false });
  const [paymentResult, setPaymentResult] = useState<string | null>(null);

  // Payment confirmation modal state
  const [paymentModal, setPaymentModal] = useState<{
    open: boolean;
    order: Order | null;
    uploading: boolean;
    extracting: boolean;
    error: string | null;
    extractedNote: string | null;
    remainingBalance: number | null;
    balancePaidSoFar: number | null;
  }>({ open: false, order: null, uploading: false, extracting: false, error: null, extractedNote: null, remainingBalance: null, balancePaidSoFar: null });
  const [balancePaymentAmount, setBalancePaymentAmount] = useState('');
  const [balancePaymentDate, setBalancePaymentDate] = useState('');
  const [balancePaymentReference, setBalancePaymentReference] = useState('');
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
      refreshAcknowledgementReceipts();
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
    } else if (otpModal.pendingAction === 'verifyDeposit') {
      handleVerifyDepositVerified(actionToken);
    } else if (otpModal.pendingAction === 'verifyBalance') {
      handleVerifyBalanceVerified(actionToken);
    } else if (otpModal.pendingAction === 'grantDeliveryException') {
      handleGrantExceptionVerified(actionToken);
    } else if (otpModal.pendingAction === 'revokeDeliveryException') {
      handleRevokeExceptionVerified(actionToken);
    } else if (otpModal.pendingAction === 'confirmPayment') {
      executeConfirmPayment(actionToken);
    } else if (otpModal.pendingAction === 'markCountered') {
      const pending = (window as any).__pendingMarkCounteredData as { order: Order } | undefined;
      if (pending) executeMarkCountered(pending.order, actionToken);
    } else if (otpModal.pendingAction === 'markCompleted') {
      const pending = (window as any).__pendingMarkCompletedData as { order: Order } | undefined;
      if (pending) executeMarkCompleted(pending.order, actionToken);
    } else if (otpModal.pendingAction === 'syncPaymentReceived') {
      const pending = (window as any).__pendingSyncData as { order: Order } | undefined;
      if (pending) executeSyncPaymentReceived(pending.order, actionToken);
    } else if (otpModal.pendingAction === 'editPaymentDate') {
      const pending = (window as any).__pendingPaymentDateData as {
        order: Order;
        field: 'deposit_paid_at' | 'balance_paid_at';
        value: string;
      } | undefined;
      if (pending) executePaymentDateUpdate(pending.order, pending.field, pending.value, actionToken);
    } else if (otpModal.pendingAction === 'markPaymentReceived') {
      const pending = (window as any).__pendingMarkPaymentReceivedData as { order: Order } | undefined;
      if (pending) executeMarkPaymentReceived(pending.order, actionToken);
    } else if (otpModal.pendingAction === 'advancePaymentReceived') {
      const pending = (window as any).__pendingAdvancePaymentReceivedData as { order: Order } | undefined;
      if (pending) executeAdvancePaymentReceived(pending.order, actionToken);
    } else if (otpModal.pendingAction === 'advancePaymentConfirmed') {
      const pending = (window as any).__pendingAdvancePaymentConfirmedData as { order: Order } | undefined;
      if (pending) executeAdvancePaymentConfirmed(pending.order, actionToken);
    }
  }

  function handlePaymentDateEdit(order: Order, field: 'deposit_paid_at' | 'balance_paid_at', value: string) {
    const label = field === 'deposit_paid_at' ? 'downpayment date' : 'balance payment date';
    (window as any).__pendingPaymentDateData = { order, field, value };
    setOtpModal({
      open: true,
      title: `Edit ${label}`,
      description: `Change ${label} for "${order.quotation_number ?? order.id.slice(0, 8)}" to ${value || 'blank'}? This corrects dates read incorrectly from payment slips.`,
      pendingAction: 'editPaymentDate',
    });
  }

  async function executePaymentDateUpdate(
    order: Order,
    field: 'deposit_paid_at' | 'balance_paid_at',
    value: string,
    actionToken: string,
  ) {
    const key = `${order.id}:${field}`;
    setPaymentDateSavingKey(key);
    try {
      await updateOrder(order.id, {
        [field]: value || null,
        action_token: actionToken,
      });
      mutateDepositVerification();
      mutateArrived();
      mutateBalanceDue();
      refreshAcknowledgementReceipts();
      mutateBalanceVerification();
      mutateDelivered();
      mutateCountered();
      mutateReceived();
      mutateConfirmed();
      mutateCompleted();
      const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
      const res = await fetch(`${API_BASE}/orders/unsynced-payments`);
      setUnsyncedOrders(res.ok ? await res.json() : []);
    } catch (err: any) {
      alert('Failed to update payment date: ' + (err.message ?? 'Unknown error'));
    } finally {
      setPaymentDateSavingKey(null);
      (window as any).__pendingPaymentDateData = null;
      setOtpModal((prev) => ({ ...prev, open: false }));
    }
  }

  async function executeMarkCountered(order: Order, actionToken: string) {
    try {
      await recordStageUpdate({
        quotation_number: order.quotation_number ?? '',
        stage: 'countered',
        status: 'countered',
        remarks: 'Marked as countered (special case delivered)',
        action_token: actionToken,
      });
      mutateDelivered();
      mutateCountered();
    } catch (err: any) {
      alert('Failed to mark as countered: ' + (err.message ?? 'Unknown error'));
    } finally {
      (window as any).__pendingMarkCounteredData = null;
    }
  }

  async function executeMarkCompleted(order: Order, actionToken: string) {
    try {
      await recordStageUpdate({
        quotation_number: order.quotation_number ?? '',
        stage: 'completed',
        status: 'completed',
        remarks: 'Completed directly — non-special case, steps 14–16 skipped (N/A)',
        action_token: actionToken,
      });
      mutateDelivered();
      mutateCompleted();
    } catch (err: any) {
      alert('Failed to complete order: ' + (err.message ?? 'Unknown error'));
    } finally {
      (window as any).__pendingMarkCompletedData = null;
    }
  }

  async function executeSyncPaymentReceived(order: Order, actionToken: string) {
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
          updated_by: 'dashboard_quick_action',
          action_token: actionToken,
        }),
      });
      await fetch(`${API_BASE}/orders/unsynced-payments/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id }),
      });
      const res = await fetch(`${API_BASE}/orders/unsynced-payments`);
      const data = res.ok ? await res.json() : [];
      setUnsyncedOrders(data);
      mutateReceived();
    } catch (err: any) {
      alert('Failed to sync: ' + (err.message ?? 'Unknown error'));
    } finally {
      (window as any).__pendingSyncData = null;
    }
  }

  // ── Countered → Payment Received ────────────────────────────────────
  async function executeMarkPaymentReceived(order: Order, actionToken: string) {
    try {
      await recordStageUpdate({
        quotation_number: order.quotation_number ?? '',
        stage: 'payment_received',
        status: 'balance_paid',
        remarks: 'Advanced from Countered to Payment Received (manual dashboard action)',
        action_token: actionToken,
      });
      mutateCountered();
      mutateReceived();
    } catch (err: any) {
      alert('Failed to advance to Payment Received: ' + (err.message ?? 'Unknown error'));
    } finally {
      (window as any).__pendingMarkPaymentReceivedData = null;
    }
  }

  // ── Payment Received → Payment Confirmed ────────────────────────────
  async function executeAdvancePaymentReceived(order: Order, actionToken: string) {
    try {
      await recordStageUpdate({
        quotation_number: order.quotation_number ?? '',
        stage: 'payment_confirmed',
        status: 'payment_confirmed',
        remarks: 'Advanced from Payment Received to Payment Confirmed (manual dashboard action)',
        action_token: actionToken,
      });
      mutateReceived();
      mutateConfirmed();
    } catch (err: any) {
      alert('Failed to advance to Payment Confirmed: ' + (err.message ?? 'Unknown error'));
    } finally {
      (window as any).__pendingAdvancePaymentReceivedData = null;
    }
  }

  // ── Payment Confirmed → Completed ───────────────────────────────────
  async function executeAdvancePaymentConfirmed(order: Order, actionToken: string) {
    try {
      await recordStageUpdate({
        quotation_number: order.quotation_number ?? '',
        stage: 'completed',
        status: 'completed',
        remarks: 'Advanced from Payment Confirmed to Completed (manual dashboard action)',
        action_token: actionToken,
      });
      mutateConfirmed();
      mutateCompleted();
    } catch (err: any) {
      alert('Failed to complete order: ' + (err.message ?? 'Unknown error'));
    } finally {
      (window as any).__pendingAdvancePaymentConfirmedData = null;
    }
  }

  async function handleVerifyDepositVerified(actionToken: string) {
    const pending = (window as any).__pendingVerifyDepositData;
    if (!pending) return;
    try {
      await verifyDeposit(pending.orderId, { verified_by: 'dashboard', action_token: actionToken });
      mutateDepositVerification();
      mutateArrived();
      mutateBalanceDue();
      refreshAcknowledgementReceipts();
    } catch (err: any) {
      alert('Failed to verify deposit: ' + (err.message ?? 'Unknown error'));
    } finally {
      (window as any).__pendingVerifyDepositData = null;
    }
  }

  async function handleVerifyBalanceVerified(actionToken: string) {
    const pending = (window as any).__pendingVerifyBalanceData;
    if (!pending) return;
    try {
      await verifyBalance(pending.orderId, { verified_by: 'dashboard', action_token: actionToken });
      mutateBalanceVerification();
      mutateReceived();
      refreshAcknowledgementReceipts();
    } catch (err: any) {
      alert('Failed to verify balance: ' + (err.message ?? 'Unknown error'));
    } finally {
      (window as any).__pendingVerifyBalanceData = null;
    }
  }

  async function handleGrantExceptionVerified(actionToken: string) {
    const pending = (window as any).__pendingGrantExceptionData;
    if (!pending) return;
    try {
      await grantDeliveryException(pending.orderId, { notes: pending.notes, granted_by: 'dashboard', action_token: actionToken });
      setExceptionModal({ open: false, order: null, notes: '', granting: false });
      mutateArrived();
      mutateBalanceDue();
    } catch (err: any) {
      alert('Failed to grant delivery exception: ' + (err.message ?? 'Unknown error'));
      setExceptionModal((prev) => ({ ...prev, granting: false }));
    } finally {
      (window as any).__pendingGrantExceptionData = null;
    }
  }

  async function handleRevokeExceptionVerified(actionToken: string) {
    const pending = (window as any).__pendingRevokeExceptionData;
    if (!pending) return;
    try {
      await revokeDeliveryException(pending.orderId, actionToken);
      mutateArrived();
      mutateBalanceDue();
      mutateCountered();
    } catch (err: any) {
      alert('Failed to revoke delivery exception: ' + (err.message ?? 'Unknown error'));
    } finally {
      (window as any).__pendingRevokeExceptionData = null;
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
    setOtpModal({ open: true, title: 'Grant Delivery Exception',
      description: `You are about to grant a delivery exception for order "${exceptionModal.order.quotation_number ?? '—'}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'grantDeliveryException' });
    (window as any).__pendingGrantExceptionData = { orderId: exceptionModal.order.id, notes: exceptionModal.notes || undefined };
  }

  async function handleRevokeException(order: Order) {
    setOtpModal({ open: true, title: 'Revoke Delivery Exception',
      description: `You are about to revoke the delivery exception for order "${order.quotation_number ?? '—'}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'revokeDeliveryException' });
    (window as any).__pendingRevokeExceptionData = { orderId: order.id };
  }

  // ── Payment Confirmation with Deposit Slip Upload ──────────────────────

  async function handlePaymentConfirmClick(order: Order) {
    const totalAmount = Number(order.total_amount ?? 0);
    const depositAmount = Number(order.deposit_amount ?? 0);
    const computedBalance = Math.max(0, totalAmount - depositAmount);
    setPaymentModal({ open: true, order, uploading: false, extracting: false, error: null, extractedNote: null, remainingBalance: null, balancePaidSoFar: null });
    setBalancePaymentAmount(computedBalance > 0 ? computedBalance.toFixed(2) : '');
    setBalancePaymentDate(new Date().toISOString().slice(0, 10));
    setBalancePaymentReference('');
    setDepositSlipFile(null);
    try {
      const payments = await getOrderPayments(order.id);
      const remaining = payments.totals.remaining_balance ?? computedBalance;
      const paidSoFar = payments.totals.balance ?? 0;
      setPaymentModal((prev) => ({ ...prev, remainingBalance: remaining, balancePaidSoFar: paidSoFar }));
      if (remaining > 0) setBalancePaymentAmount(remaining.toFixed(2));
    } catch {
      // fallback: keep computed balance
    }
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
      const mime = file.type || 'image/jpeg';
      setDepositSlipFile({
        name: file.name,
        data: base64,
        mime,
        preview: result, // full data URL for preview
      });
      extractBalancePaymentFromSlip(base64, mime);
    };
    reader.readAsDataURL(file);
  }

  async function extractBalancePaymentFromSlip(base64: string, mimeType: string) {
    setPaymentModal((prev) => ({ ...prev, extracting: true, error: null, extractedNote: null }));
    try {
      const result = await visionExtract({
        image_base64: base64,
        mime_type: mimeType,
        mode: 'payment',
      });
      const payment = result.payment;
      const updates: string[] = [];
      if (payment?.amount && Number(payment.amount) > 0) {
        setBalancePaymentAmount(String(payment.amount));
        updates.push(`amount ?${Number(payment.amount).toLocaleString()}`);
      }
      if (payment?.payment_date) {
        setBalancePaymentDate(payment.payment_date.slice(0, 10));
        updates.push(`date ${payment.payment_date.slice(0, 10)}`);
      }
      if (payment?.reference_number) {
        setBalancePaymentReference(payment.reference_number);
        updates.push(`reference ${payment.reference_number}`);
      }
      setPaymentModal((prev) => ({
        ...prev,
        extracting: false,
        extractedNote: updates.length
          ? `AI extracted ${updates.join(', ')}. You can still edit before confirming.`
          : 'AI could not find payment fields. Please enter the balance details manually.',
      }));
    } catch (err: any) {
      setPaymentModal((prev) => ({
        ...prev,
        extracting: false,
        error: err?.message ?? 'AI extraction failed. You can still enter the payment manually.',
      }));
    }
  }

  function handleConfirmPayment() {
    const order = paymentModal.order;
    const amount = Number(balancePaymentAmount.replace(/,/g, ''));
    if (!order || !Number.isFinite(amount) || amount <= 0) {
      setPaymentModal((prev) => ({ ...prev, error: 'Enter a valid balance payment amount before confirming.' }));
      return;
    }
    (window as any).__pendingConfirmPaymentData = { order };
    setOtpModal({
      open: true,
      title: 'Record Balance Payment',
      description: `Record balance payment for "${order.quotation_number ?? '?'}". This will move the order to Balance Verification, not Payment Confirmed yet.`,
      pendingAction: 'confirmPayment',
    });
  }

  async function executeConfirmPayment(actionToken: string) {
    const pending = (window as any).__pendingConfirmPaymentData as { order: Order } | undefined;
    if (!pending) return;
    const { order } = pending;
    setPaymentModal((prev) => ({ ...prev, uploading: true, error: null }));
    try {
      const amount = Number(balancePaymentAmount.replace(/,/g, ''));
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Enter a valid balance payment amount.');
      }
      const res = await payBalanceWithFile({
        quotation_number: order.quotation_number ?? '',
        amount,
        payment_date: balancePaymentDate || undefined,
        reference_number: balancePaymentReference || undefined,
        image_base64: depositSlipFile?.data,
        mime_type: depositSlipFile?.mime,
        original_filename: depositSlipFile?.name,
        updated_by: 'dashboard_quick_action',
        action_token: actionToken,
      });
      let note = `Payment of ₱${amount.toLocaleString()} recorded.`;
      if (res.is_fully_paid) {
        note += ' Balance fully paid.';
        if (res.overpayment && res.overpayment > 0) note += ` Overpayment: ₱${res.overpayment.toLocaleString()}.`;
      } else {
        note += ` Remaining: ₱${res.remaining_balance?.toLocaleString() ?? 'unknown'}.`;
      }
      setPaymentModal({ open: false, order: null, uploading: false, extracting: false, error: null, extractedNote: null, remainingBalance: null, balancePaidSoFar: null });
      setPaymentResult(note);
      setDepositSlipFile(null);
      setBalancePaymentAmount('');
      setBalancePaymentDate('');
      setBalancePaymentReference('');
      mutateArrived();
      mutateBalanceDue();
      mutateBalanceVerification();
      mutateDelivered();
      mutateCountered();
      mutateReceived();
      mutateConfirmed();
      mutateCompleted();
      refreshAcknowledgementReceipts();
    } catch (err: any) {
      setPaymentModal((prev) => ({
        ...prev,
        uploading: false,
        error: err.message ?? 'Failed to record balance payment. Please try again.',
      }));
    } finally {
      (window as any).__pendingConfirmPaymentData = null;
    }
  }

  function closePaymentModal() {
    setPaymentModal({ open: false, order: null, uploading: false, extracting: false, error: null, extractedNote: null, remainingBalance: null, balancePaidSoFar: null });
    setDepositSlipFile(null);
    setBalancePaymentAmount('');
    setBalancePaymentDate('');
    setBalancePaymentReference('');
  }

  const collectionSummaryOrders = Array.from(
    new Map(
      [
        ...depositVerificationOrders,
        ...inventoryArrivedOrders,
        ...balanceDueOrders,
        ...balanceVerificationOrders,
        ...deliveredOrders,
        ...counteredOrders,
        ...paymentReceivedOrders,
        ...unsyncedOrders,
        ...paymentConfirmedOrders,
        ...completedOrders,
      ].map((order) => [order.id, order] as const),
    ).values(),
  ).sort((a, b) => {
    const aTime = new Date(a.balance_paid_at ?? a.deposit_paid_at ?? a.updated_at ?? a.created_at).getTime();
    const bTime = new Date(b.balance_paid_at ?? b.deposit_paid_at ?? b.updated_at ?? b.created_at).getTime();
    return bTime - aTime;
  });

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
              <QuotationNumberCell order={order} onViewFiles={handleViewFiles} />
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
            {order.current_stage === 'delivered' && !hasException && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="inline-flex items-center rounded-md bg-yellow-100 px-2 py-0.5 text-[10px] font-semibold text-yellow-700 ring-1 ring-inset ring-yellow-300">
                  N/A
                </span>
                <span className="text-[10px] text-yellow-600">Steps 14–16 skipped (Countered / Payment Received / Payment Confirmed)</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <StageBadge stage={order.current_stage} />
            <div className="flex items-center gap-1">
              {/* Special case delivered → proceed to Countered */}
              {order.current_stage === 'delivered' && hasException && (
                <button
                  onClick={() => {
                    (window as any).__pendingMarkCounteredData = { order };
                    setOtpModal({
                      open: true,
                      title: 'Mark as Countered',
                      description: `Confirm marking "${order.quotation_number ?? '—'}" as countered (special case).`,
                      pendingAction: 'markCountered',
                    });
                  }}
                  className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                  title="Proceed to Countered (special case)"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
              {/* Non-special-case delivered → skip steps 14-16 (N/A), go directly to Completed */}
              {order.current_stage === 'delivered' && !hasException && (
                <button
                  onClick={() => {
                    if (!confirm(`Skip payment steps (N/A) and mark "${order.quotation_number ?? '—'}" as Completed?`)) return;
                    (window as any).__pendingMarkCompletedData = { order };
                    setOtpModal({
                      open: true,
                      title: 'Complete Order',
                      description: `Confirm completion of "${order.quotation_number ?? '—'}" (steps 14–16 N/A).`,
                      pendingAction: 'markCompleted',
                    });
                  }}
                  className="rounded-lg p-1.5 text-green-600 hover:bg-green-50 hover:text-green-700"
                  title="Complete directly (steps 14–16 are N/A)"
                >
                  <CheckCircle2 className="h-4 w-4" />
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
              {/* Countered → Payment Received */}
              {order.current_stage === 'countered' && (
                <button
                  onClick={() => {
                    (window as any).__pendingMarkPaymentReceivedData = { order };
                    setOtpModal({
                      open: true,
                      title: 'Mark Payment Received',
                      description: `Confirm marking "${order.quotation_number ?? '—'}" as Payment Received (from Countered).`,
                      pendingAction: 'markPaymentReceived',
                    });
                  }}
                  className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                  title="Advance to Payment Received"
                >
                  <CreditCard className="h-4 w-4" />
                </button>
              )}
              {/* Payment Received → Payment Confirmed */}
              {order.current_stage === 'payment_received' && (
                <button
                  onClick={() => {
                    (window as any).__pendingAdvancePaymentReceivedData = { order };
                    setOtpModal({
                      open: true,
                      title: 'Confirm Payment',
                      description: `Confirm advancing "${order.quotation_number ?? '—'}" from Payment Received to Payment Confirmed.`,
                      pendingAction: 'advancePaymentReceived',
                    });
                  }}
                  className="rounded-lg p-1.5 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700"
                  title="Advance to Payment Confirmed"
                >
                  <ThumbsUp className="h-4 w-4" />
                </button>
              )}
              {/* Payment Confirmed → Completed */}
              {order.current_stage === 'payment_confirmed' && (
                <button
                  onClick={() => {
                    (window as any).__pendingAdvancePaymentConfirmedData = { order };
                    setOtpModal({
                      open: true,
                      title: 'Complete Order',
                      description: `Confirm completing "${order.quotation_number ?? '—'}" (from Payment Confirmed).`,
                      pendingAction: 'advancePaymentConfirmed',
                    });
                  }}
                  className="rounded-lg p-1.5 text-green-600 hover:bg-green-50 hover:text-green-700"
                  title="Complete order"
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

      <CollectionSummary
        orders={collectionSummaryOrders}
        onDateEdit={handlePaymentDateEdit}
        savingKey={paymentDateSavingKey}
      />

      <AcknowledgementReceiptsSection
        receipts={acknowledgementReceipts}
        loading={loadingReceipts}
      />

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

      {/* Payment Verification — Deposit Verification */}
      <div className="rounded-xl border border-rose-200 bg-white">
        <div className="flex items-center gap-2 border-b border-rose-200 px-6 py-4">
          <Search className="h-4 w-4 text-rose-500" />
          <h2 className="text-base font-semibold text-gray-800">Deposit Verification</h2>
          <span className="ml-auto rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
            {depositVerificationOrders.length}
          </span>
        </div>
        {depositVerificationOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No deposits pending verification</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {depositVerificationOrders.map((order) => (
              <div key={order.id}>
                <div className="flex items-center justify-between px-6 py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <QuotationNumberCell order={order} onViewFiles={handleViewFiles} />
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
                      onClick={() => {
                        if (!confirm(`Verify deposit for ${order.quotation_number ?? '—'}? This will advance the order to production.`)) return;
                        setOtpModal({ open: true, title: 'Verify Deposit',
                          description: `You are about to verify the deposit for order "${order.quotation_number ?? '—'}". Enter the OTP sent to your email to confirm.`,
                          pendingAction: 'verifyDeposit' });
                        (window as any).__pendingVerifyDepositData = { orderId: order.id };
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600"
                      title="Verify deposit payment and advance to production"
                    >
                      <Search className="h-3 w-3" />
                      Verify Deposit
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Payment Verification — Balance Verification */}
      <div className="rounded-xl border border-fuchsia-200 bg-white">
        <div className="flex items-center gap-2 border-b border-fuchsia-200 px-6 py-4">
          <Search className="h-4 w-4 text-fuchsia-500" />
          <h2 className="text-base font-semibold text-gray-800">Balance Verification</h2>
          <span className="ml-auto rounded-full bg-fuchsia-100 px-2 py-0.5 text-xs font-medium text-fuchsia-700">
            {balanceVerificationOrders.length}
          </span>
        </div>
        {balanceVerificationOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No balance payments pending verification</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {balanceVerificationOrders.map((order) => (
              <div key={order.id}>
                <div className="flex items-center justify-between px-6 py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <QuotationNumberCell order={order} onViewFiles={handleViewFiles} />
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
                      onClick={() => {
                        if (!confirm(`Verify balance payment for ${order.quotation_number ?? '—'}? This will advance the order to Payment Received.`)) return;
                        setOtpModal({ open: true, title: 'Verify Balance',
                          description: `You are about to verify the balance payment for order "${order.quotation_number ?? '—'}". Enter the OTP sent to your email to confirm.`,
                          pendingAction: 'verifyBalance' });
                        (window as any).__pendingVerifyBalanceData = { orderId: order.id };
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-fuchsia-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-fuchsia-600"
                      title="Verify balance payment and advance to Payment Received"
                    >
                      <Search className="h-3 w-3" />
                      Verify Balance
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delivered */}
      <div className="rounded-xl border border-blue-200 bg-white">
        <div className="flex items-center gap-2 border-b border-blue-200 px-6 py-4">
          <ArrowRight className="h-4 w-4 text-blue-500" />
          <h2 className="text-base font-semibold text-gray-800">Delivered</h2>
          <span className="ml-auto rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
            {deliveredOrders.length}
          </span>
        </div>
        {deliveredOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No delivered orders pending</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {deliveredOrders.filter(o => !o.delivery_exception).length > 0 && (
              <>
                <div className="bg-yellow-50/50 px-6 py-2">
                  <p className="text-xs font-medium text-yellow-700">
                    🚛 Standard delivery — Steps 14–16 are N/A, advance directly to Completed
                  </p>
                </div>
                {deliveredOrders.filter(o => !o.delivery_exception).map((order) => renderOrderRow(order, [mutateDelivered, mutateCompleted]))}
              </>
            )}
            {deliveredOrders.filter(o => o.delivery_exception).length > 0 && (
              <>
                <div className="bg-amber-50/50 px-6 py-2">
                  <p className="text-xs font-medium text-amber-700">
                    ⚠️ Special Case — Must go through Countered → Payment Received → Payment Confirmed
                  </p>
                </div>
                {deliveredOrders.filter(o => o.delivery_exception).map((order) => renderOrderRow(order, [mutateDelivered, mutateCountered]))}
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
                          <QuotationNumberCell order={order} onViewFiles={handleViewFiles} />
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
                          onClick={() => {
                            (window as any).__pendingSyncData = { order };
                            setOtpModal({
                              open: true,
                              title: 'Sync to Payment Received',
                              description: `Confirm syncing "${order.quotation_number ?? '—'}" to Payment Received stage.`,
                              pendingAction: 'syncPaymentReceived',
                            });
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

      {/* Payment result toast */}
      {paymentResult && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3 mb-6">
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
          <div>
            <p className="text-sm font-medium text-emerald-800">Payment Recorded</p>
            <p className="text-xs text-emerald-700">{paymentResult}</p>
            <button onClick={() => setPaymentResult(null)} className="mt-1 text-xs text-emerald-600 hover:underline">Dismiss</button>
          </div>
        </div>
      )}

      {/* Payment Confirmation Modal — Upload Deposit Slip */}
      {paymentModal.open && paymentModal.order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
              <div>
                <h3 className="text-base font-semibold text-gray-900">Record Balance Payment</h3>
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
              {paymentModal.balancePaidSoFar != null && paymentModal.balancePaidSoFar > 0 && (
                <div className="flex justify-between text-green-700">
                  <span>Already Paid:</span>
                  <span className="font-medium">₱{paymentModal.balancePaidSoFar.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between text-violet-700">
                <span>{paymentModal.remainingBalance != null ? 'Remaining Balance:' : 'Balance Due:'}</span>
                <span className="font-medium">
                  ₱{(paymentModal.remainingBalance ?? (Number(paymentModal.order.total_amount ?? 0) - Number(paymentModal.order.deposit_amount ?? 0))).toLocaleString()}
                </span>
              </div>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-gray-600">
                Amount paid
                <input
                  value={balancePaymentAmount}
                  onChange={(e) => setBalancePaymentAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  placeholder="Amount"
                />
              </label>
              <label className="block text-xs font-medium text-gray-600">
                Payment date
                <input
                  type="date"
                  value={balancePaymentDate}
                  onChange={(e) => setBalancePaymentDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </label>
            </div>
            <label className="mb-4 block text-xs font-medium text-gray-600">
              Reference no. (optional, AI can fill this)
              <input
                value={balancePaymentReference}
                onChange={(e) => setBalancePaymentReference(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                placeholder="e.g. bank/GCash reference number"
              />
            </label>

            <p className="mb-3 text-sm text-gray-600">
              Uploading a <strong>deposit slip / balance payment proof</strong> is optional. If provided,
              AI will extract amount/date/reference and the proof will be saved to the order files.
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
                  <span className="text-sm font-medium text-gray-600">Click to upload proof slip (optional)</span>
                  <span className="mt-1 text-[11px] text-gray-400">PNG, JPG, or PDF accepted ? AI extraction runs after upload</span>
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

            {paymentModal.extracting && (
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-xs text-blue-700">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                AI is extracting amount, date, and reference from the proof...
              </div>
            )}
            {paymentModal.extractedNote && !paymentModal.extracting && (
              <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-700">
                {paymentModal.extractedNote}
              </div>
            )}

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
                disabled={paymentModal.uploading || paymentModal.extracting || !balancePaymentAmount}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {paymentModal.uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Recording...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Record Payment
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
          (window as any).__pendingConfirmPaymentData = null;
          (window as any).__pendingMarkCounteredData = null;
          (window as any).__pendingMarkCompletedData = null;
          (window as any).__pendingSyncData = null;
          (window as any).__pendingPaymentDateData = null;
          (window as any).__pendingMarkPaymentReceivedData = null;
          (window as any).__pendingAdvancePaymentReceivedData = null;
          (window as any).__pendingAdvancePaymentConfirmedData = null;
        }}
      />

      {/* File Viewer Modal */}
      {viewingFilesOrder && (
        <FileViewerModal
          order={viewingFilesOrder}
          files={orderFiles}
          onClose={closeViewer}
          onUploadComplete={refreshFiles}
        />
      )}

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
