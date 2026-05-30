'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useOrdersByStage } from '@/lib/useApi';
import type { Order } from '@/lib/api';
import { updateOrder, deleteOrder, grantDeliveryException, revokeDeliveryException, recordStageUpdate, verifyDeposit, verifyBalance, payBalance, payBalanceWithFileBulk, visionExtract, getOrderPayments, getAcknowledgementReceipts, searchClients, recordDeposit, confirmPayment, generateActionToken, revertStage, type AcknowledgementReceipt, type Client } from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import OtpModal from '@/components/OtpModal';
import ConfirmModal from '@/components/ConfirmModal';
import { QuotationNumberCell, FileViewerModal, useOrderFileViewer } from '@/components/OrderFileViewer';
import { DollarSign, CheckCircle2, Clock, AlertTriangle, Pencil, Trash2, X, Check, ShieldAlert, ShieldCheck, FileText, Scale, Upload, Image, Loader2, ArrowRight, Search, ThumbsUp, CreditCard, Send, Download, XCircle, ArrowLeft } from 'lucide-react';

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
  // If the deposit covers the full order amount it was a one-shot full payment,
  // not a partial downpayment — show the correct label.
  const depositIsFullPayment =
    order.total_amount != null && totalAmount > 0 && depositAmount >= totalAmount;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
      {order.total_amount != null && (
        <span>Total: ₱{totalAmount.toLocaleString()}</span>
      )}
      {order.deposit_amount != null && (
        <span>{depositIsFullPayment ? 'Full Payment' : 'Downpayment'}: ₱{depositAmount.toLocaleString()}</span>
      )}
      {order.total_amount != null && !depositIsFullPayment && (
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
            Download PDF receipts for verified payments. Balance payments must be verified first.
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
                <tr key={receipt.payment_id} className={`hover:bg-indigo-50/30 ${!receipt.verified ? 'opacity-60' : ''}`}>
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
                      {receipt.verified ? 'Verified' : 'Pending Verification'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3">
                    {receipt.verified ? (
                      <a
                        href={`${API_BASE}${receipt.download_url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                      >
                        <Download className="h-3 w-3" />
                        Download
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-400 cursor-not-allowed">
                        <Clock className="h-3 w-3" />
                        Pending
                      </span>
                    )}
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
    pendingAction: 'edit' | 'delete' | 'verifyDeposit' | 'verifyBalance';
  }>({ open: false, title: '', description: '', pendingAction: 'edit' });
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    description: string;
    pendingAction: 'grantDeliveryException' | 'revokeDeliveryException' | 'confirmPayment' | 'markCountered' | 'markCompleted' | 'syncPaymentReceived' | 'editPaymentDate' | 'advancePaymentReceived' | 'advancePaymentConfirmed' | 'markPaymentReceived' | 'recordDeposit' | 'recordBalance';
  }>({ open: false, title: '', description: '', pendingAction: 'confirmPayment' });
  const [paymentDateSavingKey, setPaymentDateSavingKey] = useState<string | null>(null);

  // ── Revert Stage ────────────────────────────────────────────────────
  const [revertTargetOrder, setRevertTargetOrder] = useState<Order | null>(null);
  const [showRevertOtp, setShowRevertOtp] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [revertResult, setRevertResult] = useState<{ ok: boolean; previous_stage: string; current_stage: string } | null>(null);

  // Special case (delivery exception) state
  const [exceptionModal, setExceptionModal] = useState<{
    open: boolean;
    order: Order | null;
    notes: string;
    granting: boolean;
  }>({ open: false, order: null, notes: '', granting: false });
  const [paymentResult, setPaymentResult] = useState<string | null>(null);

  // ── Client filter ──────────────────────────────────────────────────────
  const [clientFilter, setClientFilter] = useState('');
  const [clientSuggestions, setClientSuggestions] = useState<Client[]>([]);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [searchingClient, setSearchingClient] = useState(false);
  const clientFilterRef = useRef<HTMLDivElement>(null);
  const clientFilterInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (clientFilterRef.current && !clientFilterRef.current.contains(e.target as Node) &&
          clientFilterInputRef.current && !clientFilterInputRef.current.contains(e.target as Node)) {
        setShowClientDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleClientFilterSearch = useCallback(async (q: string) => {
    setClientFilter(q);
    const trimmed = q.trim();
    if (!trimmed) { setClientSuggestions([]); setShowClientDropdown(false); return; }
    setSearchingClient(true);
    try {
      const results = await searchClients(trimmed);
      setClientSuggestions(results);
      setShowClientDropdown(results.length > 0);
    } catch { setClientSuggestions([]); }
    finally { setSearchingClient(false); }
  }, []);

  function selectClientFilter(name: string) {
    setClientFilter(name);
    setShowClientDropdown(false);
    setClientSuggestions([]);
  }

  function clearClientFilter() {
    setClientFilter('');
    setClientSuggestions([]);
    setShowClientDropdown(false);
  }

  function filterByClient(orders: Order[]): Order[] {
    if (!clientFilter.trim()) return orders;
    return orders.filter(o =>
      o.client_name?.toLowerCase().includes(clientFilter.trim().toLowerCase())
    );
  }

  // Payment confirmation modal state
  const [paymentModal, setPaymentModal] = useState<{
    open: boolean;
    order: Order | null;
    uploading: boolean;
    error: string | null;
    remainingBalance: number | null;
    balancePaidSoFar: number | null;
  }>({ open: false, order: null, uploading: false, error: null, remainingBalance: null, balancePaidSoFar: null });

  interface BalanceSlip {
    amount: string;
    date: string;
    reference: string;
    file: { name: string; data: string; mime: string; preview: string } | null;
    extracting: boolean;
    extractedNote: string | null;
  }

  const emptySlip = (): BalanceSlip => ({
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    reference: '',
    file: null,
    extracting: false,
    extractedNote: null,
  });

  const [balanceSlips, setBalanceSlips] = useState<BalanceSlip[]>([emptySlip()]);
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);

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

  function handleRevertClick(order: Order) {
    setRevertTargetOrder(order);
    setShowRevertOtp(true);
  }

  async function handleRevertVerified(actionToken: string) {
    if (!revertTargetOrder) return;
    setReverting(true);
    try {
      const res = await revertStage({
        quotation_number: revertTargetOrder.quotation_number ?? '',
        action_token: actionToken,
        updated_by: 'dashboard_quick_action',
      });
      setRevertResult(res);
      mutateArrived();
      mutateBalanceDue();
      mutateDelivered();
      mutateCountered();
      mutateReceived();
      mutateConfirmed();
      mutateCompleted();
      mutateDepositVerification();
      mutateBalanceVerification();
    } catch (err: any) {
      alert('Failed to revert stage: ' + (err.message ?? 'Unknown error'));
    } finally {
      setReverting(false);
      setShowRevertOtp(false);
      setRevertTargetOrder(null);
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
    }
  }

  async function handleConfirmVerified(actionToken: string) {
    const pendingAction = confirmModal.pendingAction;
    if (pendingAction === 'grantDeliveryException') {
      handleGrantExceptionVerified(actionToken);
    } else if (pendingAction === 'revokeDeliveryException') {
      handleRevokeExceptionVerified(actionToken);
    } else if (pendingAction === 'confirmPayment') {
      executeConfirmPayment(actionToken);
    } else if (pendingAction === 'markCountered') {
      const pending = (window as any).__pendingMarkCounteredData as { order: Order } | undefined;
      if (pending) executeMarkCountered(pending.order, actionToken);
    } else if (pendingAction === 'markCompleted') {
      const pending = (window as any).__pendingMarkCompletedData as { order: Order } | undefined;
      if (pending) executeMarkCompleted(pending.order, actionToken);
    } else if (pendingAction === 'syncPaymentReceived') {
      const pending = (window as any).__pendingSyncData as { order: Order } | undefined;
      if (pending) executeSyncPaymentReceived(pending.order, actionToken);
    } else if (pendingAction === 'editPaymentDate') {
      const pending = (window as any).__pendingPaymentDateData as {
        order: Order;
        field: 'deposit_paid_at' | 'balance_paid_at';
        value: string;
      } | undefined;
      if (pending) executePaymentDateUpdate(pending.order, pending.field, pending.value, actionToken);
    } else if (pendingAction === 'markPaymentReceived') {
      const pending = (window as any).__pendingMarkPaymentReceivedData as { order: Order } | undefined;
      if (pending) executeMarkPaymentReceived(pending.order, actionToken);
    } else if (pendingAction === 'advancePaymentReceived') {
      const pending = (window as any).__pendingAdvancePaymentReceivedData as { order: Order } | undefined;
      if (pending) executeAdvancePaymentReceived(pending.order, actionToken);
    } else if (pendingAction === 'advancePaymentConfirmed') {
      const pending = (window as any).__pendingAdvancePaymentConfirmedData as { order: Order } | undefined;
      if (pending) executeAdvancePaymentConfirmed(pending.order, actionToken);
    } else if (pendingAction === 'recordDeposit') {
      handleRecordDepositVerified(actionToken);
    } else if (pendingAction === 'recordBalance') {
      handleRecordBalanceVerified(actionToken);
    }
    setConfirmModal((prev) => ({ ...prev, open: false }));
  }

  function handlePaymentDateEdit(order: Order, field: 'deposit_paid_at' | 'balance_paid_at', value: string) {
    const label = field === 'deposit_paid_at' ? 'downpayment date' : 'balance payment date';
    (window as any).__pendingPaymentDateData = { order, field, value };
    setConfirmModal({
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
      await confirmPayment(order.id, {
        confirmed_by: 'dashboard_quick_action',
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
    setConfirmModal({ open: true, title: 'Grant Delivery Exception',
      description: `Grant a delivery exception for order "${exceptionModal.order.quotation_number ?? '—'}"? This allows delivery without payment.`,
      pendingAction: 'grantDeliveryException' });
    (window as any).__pendingGrantExceptionData = { orderId: exceptionModal.order.id, notes: exceptionModal.notes || undefined };
  }

  async function handleRevokeException(order: Order) {
    setConfirmModal({ open: true, title: 'Revoke Delivery Exception',
      description: `Revoke the delivery exception for order "${order.quotation_number ?? '—'}"? The order will no longer be treated as a special case.`,
      pendingAction: 'revokeDeliveryException' });
    (window as any).__pendingRevokeExceptionData = { orderId: order.id };
  }

  // ── Record Deposit (quick action for inventory_arrived / balance_due) ──
  function handleRecordDeposit(order: Order) {
    (window as any).__pendingRecordDepositData = { order };
    setConfirmModal({
      open: true,
      title: 'Record Downpayment',
      description: `Record downpayment for "${order.quotation_number ?? '—'}" (₱${Number(order.total_amount ?? 0).toLocaleString()})? This will notify the collection group and create a deposit verification reminder.`,
      pendingAction: 'recordDeposit',
    });
  }

  async function handleRecordDepositVerified(actionToken: string) {
    const pending = (window as any).__pendingRecordDepositData as { order: Order } | undefined;
    if (!pending) return;
    try {
      await recordDeposit({
        quotation_number: pending.order.quotation_number ?? '',
        amount: Number(pending.order.total_amount ?? 0),
        action_token: actionToken,
      });
      mutateArrived();
      mutateBalanceDue();
      mutateDepositVerification();
      refreshAcknowledgementReceipts();
    } catch (err: any) {
      alert('Failed to record deposit: ' + (err.message ?? 'Unknown error'));
    } finally {
      (window as any).__pendingRecordDepositData = null;
    }
  }

  // ── Record Balance (quick action without file upload) ─────────────────
  function handleRecordBalance(order: Order) {
    const totalAmount = Number(order.total_amount ?? 0);
    const depositAmount = Number(order.deposit_amount ?? 0);
    const computedBalance = Math.max(0, totalAmount - depositAmount);
    (window as any).__pendingRecordBalanceData = { order, amount: computedBalance };
    setConfirmModal({
      open: true,
      title: 'Record Balance Payment',
      description: `Record balance payment for "${order.quotation_number ?? '—'}" (₱${computedBalance.toLocaleString()})? This will notify the collection group via Telegram.`,
      pendingAction: 'recordBalance',
    });
  }

  async function handleRecordBalanceVerified(actionToken: string) {
    const pending = (window as any).__pendingRecordBalanceData as { order: Order; amount: number } | undefined;
    if (!pending) return;
    try {
      await payBalance({
        quotation_number: pending.order.quotation_number ?? '',
        amount: pending.amount,
        action_token: actionToken,
      });
      mutateArrived();
      mutateBalanceDue();
      mutateBalanceVerification();
      refreshAcknowledgementReceipts();
    } catch (err: any) {
      alert('Failed to record balance payment: ' + (err.message ?? 'Unknown error'));
    } finally {
      (window as any).__pendingRecordBalanceData = null;
    }
  }

  // ── Payment Confirmation with Deposit Slip Upload ──────────────────────

  async function handlePaymentConfirmClick(order: Order) {
    const totalAmount = Number(order.total_amount ?? 0);
    const depositAmount = Number(order.deposit_amount ?? 0);
    const computedBalance = Math.max(0, totalAmount - depositAmount);
    const firstSlip = emptySlip();
    firstSlip.amount = computedBalance > 0 ? computedBalance.toFixed(2) : '';
    setBalanceSlips([firstSlip]);
    setPaymentModal({ open: true, order, uploading: false, error: null, remainingBalance: null, balancePaidSoFar: null });
    try {
      const payments = await getOrderPayments(order.id);
      const remaining = payments.totals.remaining_balance ?? computedBalance;
      const paidSoFar = payments.totals.balance ?? 0;
      setPaymentModal((prev) => ({ ...prev, remainingBalance: remaining, balancePaidSoFar: paidSoFar }));
      setBalanceSlips(prev => {
        const updated = [...prev];
        if (updated[0] && remaining > 0) updated[0] = { ...updated[0], amount: remaining.toFixed(2) };
        return updated;
      });
    } catch {
      // fallback: keep computed balance
    }
  }

  function updateSlip(index: number, patch: Partial<BalanceSlip>) {
    setBalanceSlips(prev => prev.map((s, i) => i === index ? { ...s, ...patch } : s));
  }

  function addSlip() {
    setBalanceSlips(prev => [...prev, emptySlip()]);
  }

  function removeSlip(index: number) {
    setBalanceSlips(prev => prev.filter((_, i) => i !== index));
  }

  function handleSlipFileSelect(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      const commaIndex = result.indexOf(',');
      const base64 = commaIndex !== -1 ? result.substring(commaIndex + 1) : result;
      const mime = file.type || 'image/jpeg';
      updateSlip(index, { file: { name: file.name, data: base64, mime, preview: result }, extracting: true, extractedNote: null });
      extractSlipData(index, base64, mime);
    };
    reader.readAsDataURL(file);
  }

  async function extractSlipData(index: number, base64: string, mimeType: string) {
    try {
      const result = await visionExtract({ image_base64: base64, mime_type: mimeType, mode: 'payment' });
      const payment = result.payment;
      const updates: string[] = [];
      const patch: Partial<BalanceSlip> = { extracting: false };
      if (payment?.amount && Number(payment.amount) > 0) {
        patch.amount = String(payment.amount);
        updates.push(`amount ₱${Number(payment.amount).toLocaleString()}`);
      }
      if (payment?.payment_date) {
        patch.date = payment.payment_date.slice(0, 10);
        updates.push(`date ${payment.payment_date.slice(0, 10)}`);
      }
      if (payment?.reference_number) {
        patch.reference = payment.reference_number;
        updates.push(`ref ${payment.reference_number}`);
      }
      patch.extractedNote = updates.length
        ? `AI extracted ${updates.join(', ')}.`
        : 'AI could not find fields. Enter manually.';
      updateSlip(index, patch);
    } catch (err: any) {
      updateSlip(index, { extracting: false, extractedNote: 'AI extraction failed. Enter manually.' });
    }
  }

  function getDuplicateIndices(slips: BalanceSlip[]): Set<number> {
    const seen = new Map<string, number>();
    const dupes = new Set<number>();
    slips.forEach((s, i) => {
      const amt = s.amount.replace(/,/g, '').trim();
      const dt = s.date.trim();
      if (!amt || !dt) return;
      const key = `${amt}|${dt}`;
      if (seen.has(key)) {
        dupes.add(seen.get(key)!);
        dupes.add(i);
      } else {
        seen.set(key, i);
      }
    });
    return dupes;
  }

  function handleConfirmPayment() {
    const order = paymentModal.order;
    if (!order) return;
    const validSlips = balanceSlips.filter(s => {
      const amt = Number(s.amount.replace(/,/g, ''));
      return Number.isFinite(amt) && amt > 0;
    });
    if (validSlips.length === 0) {
      setPaymentModal((prev) => ({ ...prev, error: 'Enter at least one valid payment amount before confirming.' }));
      return;
    }
    const dupes = getDuplicateIndices(balanceSlips);
    if (dupes.size > 0) {
      setPaymentModal((prev) => ({ ...prev, error: 'Remove duplicate slips (same amount + same date) before confirming.' }));
      return;
    }
    (window as any).__pendingConfirmPaymentData = { order };
    setConfirmModal({
      open: true,
      title: 'Record Balance Payment',
      description: `Record ${validSlips.length} balance payment slip(s) for "${order.quotation_number ?? '?'}"? This will move the order to Balance Verification, not Payment Confirmed yet.`,
      pendingAction: 'confirmPayment',
    });
  }

  async function executeConfirmPayment(actionToken: string) {
    const pending = (window as any).__pendingConfirmPaymentData as { order: Order } | undefined;
    if (!pending) return;
    const { order } = pending;
    setPaymentModal((prev) => ({ ...prev, uploading: true, error: null }));
    try {
      const validSlips = balanceSlips.filter(s => {
        const amt = Number(s.amount.replace(/,/g, ''));
        return Number.isFinite(amt) && amt > 0;
      });
      if (validSlips.length === 0) throw new Error('No valid slips to record.');

      const res = await payBalanceWithFileBulk({
        quotation_number: order.quotation_number ?? '',
        slips: validSlips.map(s => ({
          amount: Number(s.amount.replace(/,/g, '')),
          payment_date: s.date || undefined,
          reference_number: s.reference || undefined,
          image_base64: s.file?.data,
          mime_type: s.file?.mime,
          original_filename: s.file?.name,
        })),
        updated_by: 'dashboard_quick_action',
        action_token: actionToken,
      });

      const total = res.total_this_submission ?? validSlips.reduce((sum, s) => sum + Number(s.amount.replace(/,/g, '')), 0);
      let note = `${validSlips.length} slip(s) totalling ₱${total.toLocaleString()} recorded.`;
      if (res.is_fully_paid) {
        note += ' Balance fully paid.';
        if (res.overpayment && res.overpayment > 0) note += ` Overpayment: ₱${res.overpayment.toLocaleString()}.`;
      } else {
        note += ` Remaining: ₱${res.remaining_balance?.toLocaleString() ?? 'unknown'}.`;
      }
      setPaymentModal({ open: false, order: null, uploading: false, error: null, remainingBalance: null, balancePaidSoFar: null });
      setPaymentResult(note);
      setBalanceSlips([emptySlip()]);
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
    setPaymentModal({ open: false, order: null, uploading: false, error: null, remainingBalance: null, balancePaidSoFar: null });
    setBalanceSlips([emptySlip()]);
  }

  // ── Apply client filter ──────────────────────────────────────────────
  const filteredInventoryArrivedOrders = filterByClient(inventoryArrivedOrders);
  const filteredBalanceDueOrders = filterByClient(balanceDueOrders);
  const filteredDepositVerificationOrders = filterByClient(depositVerificationOrders);
  const filteredBalanceVerificationOrders = filterByClient(balanceVerificationOrders);
  const filteredDeliveredOrders = filterByClient(deliveredOrders);
  const filteredCounteredOrders = filterByClient(counteredOrders);
  const filteredPaymentReceivedOrders = filterByClient(paymentReceivedOrders);
  const filteredPaymentConfirmedOrders = filterByClient(paymentConfirmedOrders);
  const filteredCompletedOrders = filterByClient(completedOrders);
  const filteredUnsyncedOrders = unsyncedOrders.filter(o =>
    !clientFilter.trim() || o.client_name?.toLowerCase().includes(clientFilter.trim().toLowerCase())
  );

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
                    setConfirmModal({
                      open: true,
                      title: 'Mark as Countered',
                      description: `Mark "${order.quotation_number ?? '—'}" as countered (special case)?`,
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
                    setConfirmModal({
                      open: true,
                      title: 'Complete Order',
                      description: `Complete "${order.quotation_number ?? '—'}" (steps 14–16 N/A)?`,
                      pendingAction: 'markCompleted',
                    });
                  }}
                  className="rounded-lg p-1.5 text-green-600 hover:bg-green-50 hover:text-green-700"
                  title="Complete directly (steps 14–16 are N/A)"
                >
                  <CheckCircle2 className="h-4 w-4" />
                </button>
              )}
              {/* Record Deposit — for inventory_arrived / balance_due where deposit not yet paid */}
              {(order.current_stage === 'inventory_arrived' || order.current_stage === 'balance_due') && !order.deposit_paid && (
                <button
                  onClick={() => handleRecordDeposit(order)}
                  className="rounded-lg p-1.5 text-pink-500 hover:bg-pink-50 hover:text-pink-700"
                  title="Record downpayment"
                >
                  <DollarSign className="h-4 w-4" />
                </button>
              )}
              {/* Record Balance (quick) — for inventory_arrived / balance_due where deposit is paid */}
              {(order.current_stage === 'inventory_arrived' || order.current_stage === 'balance_due') && order.deposit_paid && (
                <button
                  onClick={() => handleRecordBalance(order)}
                  className="rounded-lg p-1.5 text-violet-500 hover:bg-violet-50 hover:text-violet-700"
                  title="Record balance payment (quick)"
                >
                  <CreditCard className="h-4 w-4" />
                </button>
              )}
              {/* Confirm Payment (with file upload) — only for inventory_arrived / balance_due */}
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
                    setConfirmModal({
                      open: true,
                      title: 'Mark Payment Received',
                      description: `Mark "${order.quotation_number ?? '—'}" as Payment Received (from Countered)?`,
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
                    setConfirmModal({
                      open: true,
                      title: 'Confirm Payment',
                      description: `Advance "${order.quotation_number ?? '—'}" from Payment Received to Payment Confirmed?`,
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
                    setConfirmModal({
                      open: true,
                      title: 'Complete Order',
                      description: `Complete "${order.quotation_number ?? '—'}" (from Payment Confirmed)?`,
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
              {order.current_stage !== 'quotation_received' && (
                <button
                  onClick={() => handleRevertClick(order)}
                  className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600"
                  title="Revert stage (OTP required)"
                >
                  <ArrowLeft className="h-4 w-4" />
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
        <div className="flex items-start justify-between gap-3">
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
          {/* Client filter */}
          <div className="relative shrink-0" ref={clientFilterRef}>
            <div className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2 py-1.5">
              <Search className="h-3.5 w-3.5 text-gray-400" />
              <input
                ref={clientFilterInputRef}
                type="text"
                placeholder="Filter by client..."
                value={clientFilter}
                onChange={(e) => handleClientFilterSearch(e.target.value)}
                onFocus={() => { if (clientSuggestions.length > 0) setShowClientDropdown(true); }}
                className="w-36 text-xs outline-none bg-transparent text-gray-700 placeholder-gray-400"
              />
              {clientFilter && (
                <button onClick={clearClientFilter} className="text-gray-400 hover:text-gray-600">
                  <XCircle className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {showClientDropdown && (
              <div className="absolute right-0 z-50 mt-1 w-64 rounded-lg border border-gray-200 bg-white shadow-lg">
                {searchingClient ? (
                  <div className="flex items-center justify-center py-3">
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                  </div>
                ) : (
                  <ul className="max-h-48 overflow-auto py-1">
                    {clientSuggestions.map((c) => (
                      <li key={c.id}>
                        <button
                          onClick={() => selectClientFilter(c.client_name)}
                          className="w-full px-3 py-2 text-left text-xs hover:bg-emerald-50"
                        >
                          <span className="font-medium text-gray-800">{c.client_name}</span>
                          {c.order_count != null && (
                            <span className="ml-2 text-gray-400">{c.order_count} orders</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
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
            {filteredDeliveredOrders.length}
          </span>
        </div>
        {filteredDeliveredOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No delivered orders pending</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredDeliveredOrders.filter(o => !o.delivery_exception).length > 0 && (
              <>
                <div className="bg-yellow-50/50 px-6 py-2">
                  <p className="text-xs font-medium text-yellow-700">
                    🚛 Standard delivery — Steps 14–16 are N/A, advance directly to Completed
                  </p>
                </div>
                {filteredDeliveredOrders.filter(o => !o.delivery_exception).map((order) => renderOrderRow(order, [mutateDelivered, mutateCompleted]))}
              </>
            )}
            {filteredDeliveredOrders.filter(o => o.delivery_exception).length > 0 && (
              <>
                <div className="bg-amber-50/50 px-6 py-2">
                  <p className="text-xs font-medium text-amber-700">
                    ⚠️ Special Case — Must go through Countered → Payment Received → Payment Confirmed
                  </p>
                </div>
                {filteredDeliveredOrders.filter(o => o.delivery_exception).map((order) => renderOrderRow(order, [mutateDelivered, mutateCountered]))}
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
            {filteredCounteredOrders.length}
          </span>
        </div>
        {filteredCounteredOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No countered orders</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredCounteredOrders.map((order) => renderOrderRow(order, [mutateCountered]))}
          </div>
        )}
      </div>

      {/* Payment Received */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <Clock className="h-4 w-4 text-emerald-500" />
          <h2 className="text-base font-semibold text-gray-800">Payment Received (Pending Confirmation)</h2>
          <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            {filteredPaymentReceivedOrders.length + filteredUnsyncedOrders.length}
          </span>
        </div>
        {filteredPaymentReceivedOrders.length === 0 && filteredUnsyncedOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No pending payment confirmations</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {/* Unsynced orders — balance_paid=TRUE but stage stuck at balance_due (legacy gap) */}
            {filteredUnsyncedOrders.length > 0 && (
              <>
                <div className="bg-amber-50/50 px-6 py-2">
                  <p className="text-xs font-medium text-amber-700">
                    ⚠️ Legacy — Balance paid but not yet synced to Payment Received stage
                  </p>
                </div>
                {filteredUnsyncedOrders.map((order) => (
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
                            setConfirmModal({
                              open: true,
                              title: 'Sync to Payment Received',
                              description: `Sync "${order.quotation_number ?? '—'}" to Payment Received stage?`,
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
            {filteredPaymentReceivedOrders.map((order) => renderOrderRow(order, [mutateReceived]))}
          </div>
        )}
      </div>

      {/* Payment Confirmed */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <h2 className="text-base font-semibold text-gray-800">Payment Confirmed</h2>
          <span className="ml-auto rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            {filteredPaymentConfirmedOrders.length}
          </span>
        </div>
        {filteredPaymentConfirmedOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No confirmed payments</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredPaymentConfirmedOrders.map((order) => renderOrderRow(order, [mutateConfirmed]))}
          </div>
        )}
      </div>

      {/* Completed */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <CheckCircle2 className="h-4 w-4 text-gray-500" />
          <h2 className="text-base font-semibold text-gray-800">Completed Orders</h2>
          <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
            {filteredCompletedOrders.length}
          </span>
        </div>
        {filteredCompletedOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No completed orders</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredCompletedOrders.map((order) => renderOrderRow(order, [mutateCompleted]))}
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

      {/* Payment Confirmation Modal — Multiple Deposit Slips */}
      {paymentModal.open && paymentModal.order && (() => {
        const dupeIndices = getDuplicateIndices(balanceSlips);
        const slipTotal = balanceSlips.reduce((sum, s) => {
          const amt = Number(s.amount.replace(/,/g, ''));
          return sum + (Number.isFinite(amt) ? amt : 0);
        }, 0);
        const remaining = paymentModal.remainingBalance ?? (Number(paymentModal.order.total_amount ?? 0) - Number(paymentModal.order.deposit_amount ?? 0));
        const anyExtracting = balanceSlips.some(s => s.extracting);
        const hasValidSlip = balanceSlips.some(s => {
          const amt = Number(s.amount.replace(/,/g, ''));
          return Number.isFinite(amt) && amt > 0;
        });
        return (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-8">
            <div className="mx-4 w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
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
                    <span>Previously Paid:</span>
                    <span className="font-medium">₱{paymentModal.balancePaidSoFar.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-gray-200 pt-1.5 mt-1.5 text-violet-700 font-medium">
                  <span>Remaining Balance:</span>
                  <span>₱{remaining.toLocaleString()}</span>
                </div>
                {slipTotal > 0 && (
                  <div className={`flex justify-between pt-1 font-semibold ${slipTotal >= remaining ? 'text-emerald-700' : 'text-amber-700'}`}>
                    <span>This submission:</span>
                    <span>₱{slipTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{slipTotal >= remaining ? ' ✓ Covers balance' : ` (₱${(remaining - slipTotal).toLocaleString()} short)`}</span>
                  </div>
                )}
              </div>

              {/* Slip list */}
              <div className="mb-3 space-y-4">
                {balanceSlips.map((slip, idx) => {
                  const isDupe = dupeIndices.has(idx);
                  const inputRef = (el: HTMLInputElement | null) => { fileInputRefs.current[idx] = el; };
                  return (
                    <div key={idx} className={`rounded-lg border p-3 ${isDupe ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-700">Slip {idx + 1}</span>
                        <div className="flex items-center gap-2">
                          {isDupe && (
                            <span className="text-[10px] font-medium text-red-600">⚠ Duplicate — same amount + date</span>
                          )}
                          {balanceSlips.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeSlip(idx)}
                              className="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                              title="Remove slip"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block text-xs font-medium text-gray-600">
                          Amount
                          <input
                            value={slip.amount}
                            onChange={(e) => updateSlip(idx, { amount: e.target.value.replace(/[^0-9.,]/g, '') })}
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                            placeholder="e.g. 5000"
                          />
                        </label>
                        <label className="block text-xs font-medium text-gray-600">
                          Payment date
                          <input
                            type="date"
                            value={slip.date}
                            onChange={(e) => updateSlip(idx, { date: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                          />
                        </label>
                      </div>
                      <label className="mt-2 block text-xs font-medium text-gray-600">
                        Reference no. (optional)
                        <input
                          value={slip.reference}
                          onChange={(e) => updateSlip(idx, { reference: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                          placeholder="Bank / GCash reference"
                        />
                      </label>

                      {/* File upload */}
                      <div
                        onClick={() => fileInputRefs.current[idx]?.click()}
                        className={`mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed p-2 text-xs transition-colors ${
                          slip.file ? 'border-emerald-300 bg-emerald-50' : 'border-gray-300 bg-white hover:border-emerald-300'
                        }`}
                      >
                        {slip.file ? (
                          <>
                            {slip.file.mime.startsWith('image/') ? (
                              <img src={slip.file.preview} alt="slip" className="h-8 w-8 rounded object-cover" />
                            ) : (
                              <FileText className="h-5 w-5 text-emerald-500" />
                            )}
                            <span className="truncate text-emerald-700">{slip.file.name}</span>
                            <span className="ml-auto shrink-0 text-[10px] text-emerald-500">change</span>
                          </>
                        ) : (
                          <>
                            <Upload className="h-4 w-4 text-gray-400" />
                            <span className="text-gray-500">Upload proof slip (optional, AI extracts fields)</span>
                          </>
                        )}
                        <input
                          ref={inputRef}
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          onChange={(e) => handleSlipFileSelect(idx, e)}
                        />
                      </div>

                      {slip.extracting && (
                        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-blue-600">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          AI extracting...
                        </div>
                      )}
                      {slip.extractedNote && !slip.extracting && (
                        <p className="mt-1.5 text-[11px] text-emerald-700">{slip.extractedNote}</p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add slip button */}
              <button
                type="button"
                onClick={addSlip}
                className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-emerald-300 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-50"
              >
                + Add another slip
              </button>

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
                  disabled={paymentModal.uploading || anyExtracting || !hasValidSlip || dupeIndices.size > 0}
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
                      Record {balanceSlips.filter(s => Number(s.amount.replace(/,/g, '')) > 0).length > 1
                        ? `${balanceSlips.filter(s => Number(s.amount.replace(/,/g, '')) > 0).length} Slips`
                        : 'Payment'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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

      {/* Confirm Modal */}
      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        description={confirmModal.description}
        onVerified={handleConfirmVerified}
        onClose={() => {
          setConfirmModal({ ...confirmModal, open: false });
          (window as any).__pendingConfirmPaymentData = null;
          (window as any).__pendingMarkCounteredData = null;
          (window as any).__pendingMarkCompletedData = null;
          (window as any).__pendingSyncData = null;
          (window as any).__pendingPaymentDateData = null;
          (window as any).__pendingMarkPaymentReceivedData = null;
          (window as any).__pendingAdvancePaymentReceivedData = null;
          (window as any).__pendingAdvancePaymentConfirmedData = null;
          (window as any).__pendingRecordDepositData = null;
          (window as any).__pendingRecordBalanceData = null;
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

      {/* ── Revert Stage OTP Modal ──────────────────────────────────────── */}
      <OtpModal
        open={showRevertOtp}
        title="Revert Stage"
        description={revertTargetOrder ? `You are about to revert order "${revertTargetOrder.quotation_number ?? '—'}" (${revertTargetOrder.client_name ?? 'Unknown'}) to the previous stage. Enter the OTP sent to your email to confirm.` : ''}
        onVerified={handleRevertVerified}
        onClose={() => { setShowRevertOtp(false); setRevertTargetOrder(null); }}
      />

      {reverting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-xl bg-white p-6 text-center shadow-xl">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-red-500" />
            <p className="text-sm text-gray-600">Reverting stage...</p>
          </div>
        </div>
      )}

      {revertResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRevertResult(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              {revertResult.ok ? (
                <>
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                    <CheckCircle2 className="h-6 w-6 text-green-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">Stage Reverted</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Order moved from <strong>{revertResult.previous_stage}</strong> back to <strong>{revertResult.current_stage}</strong>.
                  </p>
                </>
              ) : (
                <>
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                    <XCircle className="h-6 w-6 text-red-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">Revert Failed</h3>
                  <p className="mt-1 text-sm text-gray-500">Could not revert the stage. Please try again.</p>
                </>
              )}
            </div>
            <button onClick={() => setRevertResult(null)}
              className="mt-4 w-full rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
