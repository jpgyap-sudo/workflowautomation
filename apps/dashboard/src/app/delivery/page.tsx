'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useOrdersByStage } from '@/lib/useApi';
import type { Order, Client, PaymentCounter } from '@/lib/api';
import { updateOrder, deleteOrder, payBalance, payBalanceWithFileBulk, visionExtract, recordStageUpdate, getOrderPayments, searchClients, getDeliveryProgress, partialDelivery, grantSpecialCase, verifyCountered, updatePaymentCounter, getPaymentCounter, uploadOrderFile, recordDeposit, confirmPayment, completeInventoryVerificationPartial, scheduleDeliveryItems, generateActionToken, revertStage, type DeliveryProgressItem, type DeliveryProgressSummary } from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import OtpModal from '@/components/OtpModal';
import ConfirmModal from '@/components/ConfirmModal';
import DeliveryItemSection from '@/components/DeliveryItemSection';
import { QuotationNumberCell, FileViewerModal, useOrderFileViewer } from '@/components/OrderFileViewer';
import { Truck, Calendar, CheckCircle2, Scale, Pencil, Trash2, X, Check, MapPin, Phone, UserCheck, ShieldAlert, DollarSign, PackageCheck, PackageOpen, Clock, ThumbsUp, CreditCard, Send, Upload, FileText, Loader2, Search, XCircle, Package, ListChecks, ChevronUp, ChevronDown, ArrowLeft } from 'lucide-react';

interface EditFormProps {
  order: Order;
  onSave: (data: { client_name?: string; sales_agent?: string; total_amount?: number; quotation_number?: string }) => void;
  onCancel: () => void;
  saving: boolean;
}

function formatDeliveryDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function toDateTimeLocalValue(value?: string | null) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const offsetMs = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16);
}

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

interface RowActionsProps {
  order: Order;
  onEdit: (order: Order) => void;
  onDelete: (order: Order) => void;
  onRevert?: (order: Order) => void;
}

function RowActions({ order, onEdit, onDelete, onRevert }: RowActionsProps) {
  return (
    <div className="flex items-center gap-1">
      {onRevert && order.current_stage !== 'quotation_received' && (
        <button onClick={() => onRevert(order)}
          className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600" title="Revert stage (OTP required)">
          <ArrowLeft className="h-4 w-4" />
        </button>
      )}
      <button onClick={() => onEdit(order)}
        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#2490ef]" title="Edit order">
        <Pencil className="h-4 w-4" />
      </button>
      <button onClick={() => onDelete(order)}
        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500" title="Delete order">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function EditForm({ order, onSave, onCancel, saving }: EditFormProps) {
  const [clientName, setClientName] = useState(order.client_name ?? '');
  const [salesAgent, setSalesAgent] = useState(order.sales_agent ?? '');
  const [totalAmount, setTotalAmount] = useState(order.total_amount?.toString() ?? '');
  const [quotationNumber, setQuotationNumber] = useState(order.quotation_number ?? '');
  const [deliveryAddress, setDeliveryAddress] = useState(order.delivery_address ?? '');
  const [contactNumber, setContactNumber] = useState(order.contact_number ?? '');
  const [authorizedReceiverName, setAuthorizedReceiverName] = useState(order.authorized_receiver_name ?? '');
  const [authorizedReceiverContact, setAuthorizedReceiverContact] = useState(order.authorized_receiver_contact ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const data: Record<string, string | number | null> = {};
    if (clientName.trim()) data.client_name = clientName.trim();
    if (salesAgent.trim()) data.sales_agent = salesAgent.trim();
    if (totalAmount.trim()) data.total_amount = Number(totalAmount.replace(/,/g, ''));
    if (quotationNumber.trim()) data.quotation_number = quotationNumber.trim();
    data.delivery_address = deliveryAddress.trim() || null;
    data.contact_number = contactNumber.trim() || null;
    data.authorized_receiver_name = authorizedReceiverName.trim() || null;
    data.authorized_receiver_contact = authorizedReceiverContact.trim() || null;
    onSave(data as any);
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
      <input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="Delivery address"
        className="min-w-0 flex-[2] rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20" />
      <input value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} placeholder="Contact #"
        className="w-32 rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20" />
      <input value={authorizedReceiverName} onChange={(e) => setAuthorizedReceiverName(e.target.value)} placeholder="Receiver name"
        className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20" />
      <input value={authorizedReceiverContact} onChange={(e) => setAuthorizedReceiverContact(e.target.value)} placeholder="Receiver contact"
        className="w-32 rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20" />
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

export default function DeliveryPage() {
  const { data: inventoryVerificationOrders = [], isLoading: loadingInventoryVerification, mutate: mutateInventoryVerification } = useOrdersByStage('inventory_verification');
  const { data: inventoryArrivedOrders = [], isLoading: loadingInventory, mutate: mutateInventory } = useOrdersByStage('inventory_arrived');
  const { data: balanceDueOrders = [], isLoading: loadingBalanceDue, mutate: mutateBalanceDue } = useOrdersByStage('balance_due');
  const { data: balanceVerificationOrders = [], isLoading: loadingBalanceVerification, mutate: mutateBalanceVerification } = useOrdersByStage('balance_verification');
  const { data: pendingOrders = [], isLoading: loadingPending, mutate: mutatePending } = useOrdersByStage('delivery_pending');
  const { data: scheduledOrders = [], isLoading: loadingScheduled, mutate: mutateScheduled } = useOrdersByStage('delivery_scheduled');
  const { data: counteredOrders = [], isLoading: loadingCountered, mutate: mutateCountered } = useOrdersByStage('countered');
  const { data: deliveredOrders = [], isLoading: loadingDelivered, mutate: mutateDelivered } = useOrdersByStage('delivered');
  const { data: paymentReceivedOrders = [], isLoading: loadingPaymentReceived, mutate: mutatePaymentReceived } = useOrdersByStage('payment_received');
  const { data: paymentConfirmedOrders = [], isLoading: loadingPaymentConfirmed, mutate: mutatePaymentConfirmed } = useOrdersByStage('payment_confirmed');
  const { data: stockPrepOrders = [], isLoading: loadingStockPrep, mutate: mutateStockPrep } = useOrdersByStage('stock_preparation');

  const loading = loadingInventoryVerification && loadingInventory && loadingBalanceDue && loadingBalanceVerification && loadingPending && loadingScheduled && loadingCountered && loadingDelivered && loadingPaymentReceived && loadingPaymentConfirmed && loadingStockPrep;

  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingOrder, setDeletingOrder] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [payResult, setPayResult] = useState<string | null>(null);
  const [schedulingOrder, setSchedulingOrder] = useState<Order | null>(null);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleRemarks, setScheduleRemarks] = useState('');

  const { viewingFilesOrder, orderFiles, handleViewFiles, refreshFiles, closeViewer } = useOrderFileViewer();

  const [otpModal, setOtpModal] = useState<{
    open: boolean;
    title: string;
    description: string;
    pendingAction: 'edit' | 'delete' | 'verify_balance';
  }>({ open: false, title: '', description: '', pendingAction: 'edit' });
  
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    description: string;
    pendingAction: string;
  }>({ open: false, title: '', description: '', pendingAction: '' });
  
  // Track which orders have been verified as countered (to hide "Verify Countered" button)
  const [verifiedCounterIds, setVerifiedCounterIds] = useState<Set<string>>(new Set());

  // ── Revert Stage ────────────────────────────────────────────────────
  const [revertTargetOrder, setRevertTargetOrder] = useState<Order | null>(null);
  const [showRevertOtp, setShowRevertOtp] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [revertResult, setRevertResult] = useState<{ ok: boolean; message: string } | null>(null);
  
  // ── Verify Countered Modal ─────────────────────────────────────────
  const [verifyCounteredModal, setVerifyCounteredModal] = useState<{
    open: boolean;
    order: Order | null;
    notes: string;
    submitting: boolean;
  }>({ open: false, order: null, notes: '', submitting: false });

  // ── Special Case Modal ──────────────────────────────────────────────
  const [specialCaseModal, setSpecialCaseModal] = useState<{
    open: boolean;
    order: Order | null;
    notes: string;
    submitting: boolean;
  }>({ open: false, order: null, notes: '', submitting: false });

  // ── Payment Counter Modal ───────────────────────────────────────────
  const [paymentCounterModal, setPaymentCounterModal] = useState<{
    open: boolean;
    order: Order | null;
    counter: PaymentCounter | null;
    salesInvoiceStatus: 'pending' | 'received';
    deliveryReceiptStatus: 'pending' | 'received';
    receivedDate: string;
    deliveryDate: string;
    salesInvoiceFile: File | null;
    deliveryReceiptFile: File | null;
    loading: boolean;
    submitting: boolean;
  }>({
    open: false,
    order: null,
    counter: null,
    salesInvoiceStatus: 'pending',
    deliveryReceiptStatus: 'pending',
    receivedDate: '',
    deliveryDate: '',
    salesInvoiceFile: null,
    deliveryReceiptFile: null,
    loading: false,
    submitting: false,
  });

  // ── Partial Delivery Modal ───────────────────────────────────────────
  const [partialDeliveryModal, setPartialDeliveryModal] = useState<{
    open: boolean;
    order: Order | null;
    items: DeliveryProgressItem[];
    summary: DeliveryProgressSummary | null;
    selectedItemIds: Set<string>;
    loading: boolean;
    submitting: boolean;
    deliveryNote: string;
  }>({
    open: false,
    order: null,
    items: [],
    summary: null,
    selectedItemIds: new Set(),
    loading: false,
    submitting: false,
    deliveryNote: '',
  });

  function mutateAll() {
    mutateInventoryVerification(); mutateInventory(); mutateBalanceDue(); mutateBalanceVerification(); mutatePending(); mutateScheduled(); mutateCountered(); mutateDelivered(); mutatePaymentReceived(); mutatePaymentConfirmed(); mutateStockPrep();
  }

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

  // ── Payment Modal (Deposit Slip Upload + AI Extract) ────────────────────

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

  const [paymentModal, setPaymentModal] = useState<{
    open: boolean;
    order: Order | null;
    uploading: boolean;
    error: string | null;
    remainingBalance: number | null;
    balancePaidSoFar: number | null;
  }>({ open: false, order: null, uploading: false, error: null, remainingBalance: null, balancePaidSoFar: null });

  const [balanceSlips, setBalanceSlips] = useState<BalanceSlip[]>([emptySlip()]);
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // ── Payment Received Upload Modal State ────────────────────────────────
  const [paymentReceivedModal, setPaymentReceivedModal] = useState<{
    open: boolean;
    order: Order | null;
    uploading: boolean;
    error: string | null;
  }>({ open: false, order: null, uploading: false, error: null });

  const [paymentReceivedSlips, setPaymentReceivedSlips] = useState<BalanceSlip[]>([emptySlip()]);
  const paymentReceivedFileInputRefs = useRef<(HTMLInputElement | null)[]>([]);

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

  function closePaymentModal() {
    setPaymentModal({ open: false, order: null, uploading: false, error: null, remainingBalance: null, balancePaidSoFar: null });
    setBalanceSlips([emptySlip()]);
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
      description: `Record ${validSlips.length} balance payment slip(s) for "${order.quotation_number ?? '?'}". This will move the order to Balance Verification.`,
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
      closePaymentModal();
      setPayResult(note);
      mutateBalanceDue();
      mutateBalanceVerification();
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

  // ── Advance inventory_arrived → balance_due ────────────────────────────

  function handleAdvanceBalanceDue(order: Order) {
    (window as any).__pendingActionOrder = order;
    setConfirmModal({
      open: true,
      title: 'Advance to Balance Due',
      description: `Confirm that inventory for "${order.quotation_number ?? '—'}" is ready and advance to Balance Due stage.`,
      pendingAction: 'advance_balance_due',
    });
  }

  async function executeAdvanceBalanceDue(order: Order, actionToken: string) {
    setActionLoading(order.id);
    try {
      await recordStageUpdate({
        quotation_number: order.quotation_number ?? '',
        stage: 'balance_due',
        status: 'auto_advanced',
        remarks: 'Inventory confirmed — advancing to balance due',
        action_token: actionToken,
      });
      mutateInventory();
      mutateBalanceDue();
    } catch (err: any) {
      alert('Failed to advance stage: ' + (err.message ?? 'Unknown error'));
    } finally {
      setActionLoading(null);
    }
  }

  // ── Mark delivered ──────────────────────────────────────────────────────


  // Schedule delivery
  function handleOpenSchedule(order: Order) {
    setSchedulingOrder(order);
    setScheduleDate(toDateTimeLocalValue(order.delivery_date));
    setScheduleRemarks('');
  }

  /** Schedule Selected — stores item IDs and opens schedule form */
  function handleScheduleSelected(order: Order, itemIds: string[]) {
    (window as any).__pendingScheduleItemIds = itemIds;
    handleOpenSchedule(order);
  }

  /** Schedule All — stores all deliverable items and opens schedule form */
  function handleScheduleAll(order: Order) {
    (window as any).__pendingScheduleItemIds = '__all__';
    handleOpenSchedule(order);
  }

  function handleScheduleSubmit(order: Order) {
    if (!scheduleDate.trim()) {
      alert('Please choose the delivery date and time.');
      return;
    }
    (window as any).__pendingScheduleData = {
      order,
      delivery_date: scheduleDate.trim(),
      remarks: scheduleRemarks.trim(),
    };
    setConfirmModal({
      open: true,
      title: 'Schedule Delivery',
      description: `Confirm the delivery schedule for "${order.quotation_number ?? '-'}".`,
      pendingAction: 'schedule_delivery',
    });
  }

  async function handleScheduleVerified(actionToken: string) {
    const pending = (window as any).__pendingScheduleData as
      | { order: Order; delivery_date: string; remarks: string }
      | undefined;
    if (!pending) return;

    const { order, delivery_date, remarks } = pending;
    const itemIds = (window as any).__pendingScheduleItemIds as string[] | string | undefined;
    (window as any).__pendingScheduleItemIds = undefined;

    setActionLoading(order.id);
    try {
      // If specific items were selected, use the itemized scheduling endpoint
      if (itemIds && itemIds !== '__all__' && Array.isArray(itemIds) && itemIds.length > 0) {
        await scheduleDeliveryItems(order.id, itemIds, delivery_date, actionToken, remarks || undefined);
      } else {
        await recordStageUpdate({
          quotation_number: order.quotation_number ?? '',
          stage: 'delivery_scheduled',
          status: 'scheduled',
          remarks: remarks || delivery_date,
          delivery_date,
          action_token: actionToken,
        });
      }
      setSchedulingOrder(null);
      setScheduleDate('');
      setScheduleRemarks('');
      mutateAll();
    } catch (err: any) {
      alert('Failed to schedule delivery: ' + (err.message ?? 'Unknown error'));
    } finally {
      setActionLoading(null);
      (window as any).__pendingScheduleData = null;
    }
  }

  function handleMarkDelivered(order: Order) {
    (window as any).__pendingActionOrder = order;
    setConfirmModal({
      open: true,
      title: 'Mark as Delivered',
      description: `Confirm that "${order.quotation_number ?? '—'}" has been delivered to the client.`,
      pendingAction: 'mark_delivered',
    });
  }

  async function executeMarkDelivered(order: Order, actionToken: string) {
    setActionLoading(order.id);
    try {
      await recordStageUpdate({
        quotation_number: order.quotation_number ?? '',
        stage: 'delivered',
        status: 'auto_advanced',
        remarks: 'Marked as delivered via dashboard',
        action_token: actionToken,
      });
      mutateScheduled();
      mutateDelivered();
    } catch (err: any) {
      alert('Failed to mark as delivered: ' + (err.message ?? 'Unknown error'));
    } finally {
      setActionLoading(null);
    }
  }

  // ── Mark countered ──────────────────────────────────────────────────────

  function handleMarkCountered(order: Order) {
    (window as any).__pendingActionOrder = order;
    setConfirmModal({
      open: true,
      title: 'Mark as Countered',
      description: `Mark "${order.quotation_number ?? '—'}" as delivered and awaiting payment collection.`,
      pendingAction: 'mark_countered',
    });
  }

  async function executeMarkCountered(order: Order, actionToken: string) {
    setActionLoading(order.id);
    try {
      await recordStageUpdate({
        quotation_number: order.quotation_number ?? '',
        stage: 'countered',
        status: 'auto_advanced',
        remarks: 'Delivered — awaiting payment (marked via dashboard)',
        action_token: actionToken,
      });
      mutateDelivered();
    } catch (err: any) {
      alert('Failed to mark as countered: ' + (err.message ?? 'Unknown error'));
    } finally {
      setActionLoading(null);
    }
  }

  // ── Special Case ──────────────────────────────────────────────────────

  function handleSpecialCase(order: Order) {
    setSpecialCaseModal({
      open: true,
      order,
      notes: '',
      submitting: false,
    });
  }

  async function executeSpecialCase(order: Order, actionToken: string) {
    setSpecialCaseModal((prev) => ({ ...prev, submitting: true }));
    try {
      await grantSpecialCase(order.id, {
        notes: specialCaseModal.notes,
        action_token: actionToken,
      });
      setSpecialCaseModal((prev) => ({ ...prev, open: false, submitting: false }));
      mutateAll();
    } catch (err: any) {
      alert('Failed to grant special case: ' + (err.message ?? 'Unknown error'));
      setSpecialCaseModal((prev) => ({ ...prev, submitting: false }));
    }
  }

  // ── Verify Countered ──────────────────────────────────────────────────

  function handleVerifyCountered(order: Order) {
    setVerifyCounteredModal({
      open: true,
      order,
      notes: '',
      submitting: false,
    });
  }

  async function executeVerifyCountered(order: Order, actionToken: string) {
    setVerifyCounteredModal((prev) => ({ ...prev, submitting: true }));
    try {
      await verifyCountered(order.id, {
        notes: verifyCounteredModal.notes,
        action_token: actionToken,
      });
      setVerifiedCounterIds((prev) => new Set(prev).add(order.id));
      setVerifyCounteredModal((prev) => ({ ...prev, open: false, submitting: false }));
      mutateAll();
    } catch (err: any) {
      alert('Failed to verify countered: ' + (err.message ?? 'Unknown error'));
      setVerifyCounteredModal((prev) => ({ ...prev, submitting: false }));
    }
  }

  // ── Payment Counter ───────────────────────────────────────────────────

  async function handleOpenPaymentCounter(order: Order) {
    setPaymentCounterModal((prev) => ({ ...prev, open: true, order, loading: true }));
    try {
      const result = await getPaymentCounter(order.id);
      const counter = result.payment_counter;
      if (counter) {
        setPaymentCounterModal((prev) => ({
          ...prev,
          counter,
          salesInvoiceStatus: counter.sales_invoice_status,
          deliveryReceiptStatus: counter.delivery_receipt_status,
          receivedDate: counter.received_date ?? '',
          deliveryDate: counter.delivery_date ?? '',
          loading: false,
        }));
      } else {
        setPaymentCounterModal((prev) => ({ ...prev, loading: false }));
      }
    } catch (err: any) {
      alert('Failed to load payment counter: ' + (err.message ?? 'Unknown error'));
      setPaymentCounterModal((prev) => ({ ...prev, open: false, loading: false }));
    }
  }

  async function handlePaymentCounterSubmit() {
    const order = paymentCounterModal.order;
    if (!order) return;
    setPaymentCounterModal((prev) => ({ ...prev, submitting: true }));
    try {
      // Helper to convert File to base64 and upload
      async function uploadFileAsOrderFile(file: File): Promise<string | null> {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = async (ev) => {
            const base64 = (ev.target?.result as string)?.split(',')[1];
            if (!base64) { resolve(null); return; }
            try {
              const result = await uploadOrderFile({
                order_id: order!.id,
                file_type: 'invoice',
                original_filename: file.name,
                mime_type: file.type,
                file_data: base64,
              });
              resolve(result.ok && result.file ? result.file.id : null);
            } catch { resolve(null); }
          };
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        });
      }

      let salesInvoiceFileId: string | null = paymentCounterModal.counter?.sales_invoice_file_id ?? null;
      let deliveryReceiptFileId: string | null = paymentCounterModal.counter?.delivery_receipt_file_id ?? null;

      if (paymentCounterModal.salesInvoiceFile) {
        salesInvoiceFileId = await uploadFileAsOrderFile(paymentCounterModal.salesInvoiceFile);
      }
      if (paymentCounterModal.deliveryReceiptFile) {
        deliveryReceiptFileId = await uploadFileAsOrderFile(paymentCounterModal.deliveryReceiptFile);
      }

      // Trigger OTP for payment counter update
      (window as any).__pendingActionOrder = order;
      (window as any).__pendingPaymentCounterData = {
        salesInvoiceStatus: paymentCounterModal.salesInvoiceStatus,
        deliveryReceiptStatus: paymentCounterModal.deliveryReceiptStatus,
        receivedDate: paymentCounterModal.receivedDate || null,
        deliveryDate: paymentCounterModal.deliveryDate || null,
        salesInvoiceFileId,
        deliveryReceiptFileId,
      };
      setConfirmModal({
        open: true,
        title: 'Update Payment Counter',
        description: `Confirm payment counter update for "${order.quotation_number ?? '—'}".`,
        pendingAction: 'payment_counter',
      });
      setPaymentCounterModal((prev) => ({ ...prev, submitting: false }));
    } catch (err: any) {
      alert('Failed to prepare payment counter update: ' + (err.message ?? 'Unknown error'));
      setPaymentCounterModal((prev) => ({ ...prev, submitting: false }));
    }
  }

  async function executePaymentCounter(order: Order, actionToken: string) {
    const data = (window as any).__pendingPaymentCounterData;
    if (!data) return;
    setActionLoading(order.id);
    try {
      await updatePaymentCounter(order.id, {
        sales_invoice_status: data.salesInvoiceStatus,
        delivery_receipt_status: data.deliveryReceiptStatus,
        received_date: data.receivedDate,
        delivery_date: data.deliveryDate,
        sales_invoice_file_id: data.salesInvoiceFileId,
        delivery_receipt_file_id: data.deliveryReceiptFileId,
        action_token: actionToken,
      });
      setPaymentCounterModal((prev) => ({ ...prev, open: false }));
      mutateAll();
    } catch (err: any) {
      alert('Failed to update payment counter: ' + (err.message ?? 'Unknown error'));
    } finally {
      setActionLoading(null);
      (window as any).__pendingPaymentCounterData = null;
    }
  }

  // ── Edit / Delete ───────────────────────────────────────────────────────

  function handleEditSave(data: { client_name?: string; sales_agent?: string; total_amount?: number; quotation_number?: string; delivery_address?: string | null; contact_number?: string | null; authorized_receiver_name?: string | null; authorized_receiver_contact?: string | null }) {
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
      mutateAll();
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

  function handleRevertClick(order: Order) {
    setRevertTargetOrder(order);
    setShowRevertOtp(true);
    setRevertResult(null);
  }

  async function handleRevertVerified(actionToken: string) {
    if (!revertTargetOrder) return;
    setReverting(true);
    setRevertResult(null);
    try {
      const res = await revertStage({
        quotation_number: revertTargetOrder.quotation_number ?? '',
        action_token: actionToken,
      });
      if (res.ok) {
        setRevertResult({ ok: true, message: `✅ Reverted from ${res.previous_stage.replace(/_/g, ' ')} to ${res.current_stage.replace(/_/g, ' ')}!` });
        setRevertTargetOrder(null);
        setTimeout(() => { setShowRevertOtp(false); mutateAll(); }, 1500);
      } else {
        setRevertResult({ ok: false, message: 'Failed to revert stage.' });
      }
    } catch (err: any) {
      setRevertResult({ ok: false, message: err.message ?? 'Failed to revert stage.' });
    } finally {
      setReverting(false);
    }
  }

  async function handleDeleteVerified(actionToken: string) {
    if (!deletingOrder) return;
    setDeleting(true);
    try {
      await deleteOrder(deletingOrder.id, actionToken);
      setDeletingOrder(null);
      mutateAll();
    } catch (err: any) {
      alert('Failed to delete order: ' + (err.message ?? 'Unknown error'));
    } finally {
      setDeleting(false);
    }
  }

  async function executeCompleteDirectly(order: Order, actionToken: string) {
    setActionLoading(order.id);
    try {
      const balancePaid = order.balance_paid ?? false;
      await recordStageUpdate({
        quotation_number: order.quotation_number ?? '',
        stage: 'completed',
        status: 'auto_completed',
        remarks: balancePaid
          ? 'Balance already paid — auto-completed on delivery (steps 14-16 N/A)'
          : 'Manually completed from delivered stage — balance may still be outstanding',
        action_token: actionToken,
      });
      mutateDelivered();
    } catch (err: any) {
      alert('Failed to complete order: ' + (err.message ?? 'Unknown error'));
    } finally {
      setActionLoading(null);
    }
  }

  function handleCompleteOrder(order: Order) {
    (window as any).__pendingCompleteData = { order };
    setConfirmModal({
      open: true,
      title: 'Complete Order',
      description: `Manually mark order ${order.quotation_number ?? '—'} (${order.client_name ?? 'Unknown'}) as completed? This will advance it from delivered to completed.`,
      pendingAction: 'complete_directly',
    });
  }

  // ── Verify Balance (balance_verification → delivery_pending) ────────────

  function handleVerifyBalance(order: Order) {
    (window as any).__pendingActionOrder = order;
    setOtpModal({
      open: true,
      title: 'Verify Balance Payment',
      description: `Confirm that the balance payment for "${order.quotation_number ?? '—'}" has been verified and advance to delivery pending.`,
      pendingAction: 'verify_balance',
    });
  }

  async function executeVerifyBalance(order: Order, actionToken: string) {
    setActionLoading(order.id);
    try {
      await recordStageUpdate({
        quotation_number: order.quotation_number ?? '',
        stage: 'delivery_pending',
        status: 'auto_advanced',
        remarks: 'Balance verified — advancing to delivery pending',
        action_token: actionToken,
      });
      mutateBalanceVerification();
      mutatePending();
    } catch (err: any) {
      alert('Failed to verify balance: ' + (err.message ?? 'Unknown error'));
    } finally {
      setActionLoading(null);
    }
  }

  // ── Cancel schedule: delivery_scheduled → delivery_pending ─────────────

  function handleCancelSchedule(order: Order) {
    (window as any).__pendingActionOrder = order;
    setConfirmModal({
      open: true,
      title: 'Cancel Delivery Schedule',
      description: `Cancel the delivery schedule for "${order.quotation_number ?? '—'}" and move back to Delivery Pending.`,
      pendingAction: 'cancel_schedule',
    });
  }

  async function executeCancelSchedule(order: Order, actionToken: string) {
    setActionLoading(order.id);
    try {
      await recordStageUpdate({
        quotation_number: order.quotation_number ?? '',
        stage: 'delivery_pending',
        status: 'schedule_cancelled',
        remarks: 'Delivery schedule cancelled via dashboard',
        action_token: actionToken,
      });
      mutateScheduled();
      mutatePending();
    } catch (err: any) {
      alert('Failed to cancel schedule: ' + (err.message ?? 'Unknown error'));
    } finally {
      setActionLoading(null);
    }
  }

  // ── Advance delivered → payment_received ────────────────────────────────

  function handleMarkPaymentReceived(order: Order) {
    (window as any).__pendingActionOrder = order;
    setConfirmModal({
      open: true,
      title: 'Mark Payment Received',
      description: `Confirm that payment has been received for "${order.quotation_number ?? '—'}" and advance to Payment Received stage.`,
      pendingAction: 'mark_payment_received',
    });
  }

  async function executeMarkPaymentReceived(order: Order, actionToken: string) {
    setActionLoading(order.id);
    try {
      await recordStageUpdate({
        quotation_number: order.quotation_number ?? '',
        stage: 'payment_received',
        status: 'auto_advanced',
        remarks: 'Payment received — advancing to payment received stage',
        action_token: actionToken,
      });
      mutateDelivered();
      mutatePaymentReceived();
    } catch (err: any) {
      alert('Failed to mark payment received: ' + (err.message ?? 'Unknown error'));
    } finally {
      setActionLoading(null);
    }
  }

  // ── Advance delivered → payment_confirmed ───────────────────────────────

  function handleMarkPaymentConfirmed(order: Order) {
    (window as any).__pendingActionOrder = order;
    setConfirmModal({
      open: true,
      title: 'Mark Payment Confirmed',
      description: `Confirm that payment has been confirmed for "${order.quotation_number ?? '—'}" and advance to Payment Confirmed stage.`,
      pendingAction: 'mark_payment_confirmed',
    });
  }

  async function executeMarkPaymentConfirmed(order: Order, actionToken: string) {
    setActionLoading(order.id);
    try {
      await recordStageUpdate({
        quotation_number: order.quotation_number ?? '',
        stage: 'payment_confirmed',
        status: 'auto_advanced',
        remarks: 'Payment confirmed — advancing to payment confirmed stage',
        action_token: actionToken,
      });
      mutateDelivered();
      mutatePaymentConfirmed();
    } catch (err: any) {
      alert('Failed to mark payment confirmed: ' + (err.message ?? 'Unknown error'));
    } finally {
      setActionLoading(null);
    }
  }

  // ── Advance payment_received → payment_confirmed ────────────────────────

  function handleAdvancePaymentReceived(order: Order) {
    // Show optional upload modal first
    const firstSlip = emptySlip();
    setPaymentReceivedSlips([firstSlip]);
    setPaymentReceivedModal({ open: true, order, uploading: false, error: null });
  }

  function closePaymentReceivedModal() {
    setPaymentReceivedModal({ open: false, order: null, uploading: false, error: null });
    setPaymentReceivedSlips([emptySlip()]);
  }

  function handlePaymentReceivedConfirm() {
    const order = paymentReceivedModal.order;
    if (!order) return;
    closePaymentReceivedModal();
    (window as any).__pendingActionOrder = order;
    setConfirmModal({
      open: true,
      title: 'Advance to Payment Confirmed',
      description: `Confirm payment for "${order.quotation_number ?? '—'}" and advance from Payment Received to Payment Confirmed.`,
      pendingAction: 'advance_payment_received',
    });
  }

  async function executeAdvancePaymentReceived(order: Order, actionToken: string) {
    setActionLoading(order.id);
    try {
      // Upload any payment proof files first
      const validSlips = paymentReceivedSlips.filter(s => {
        const amt = Number(s.amount.replace(/,/g, ''));
        return Number.isFinite(amt) && amt > 0 && s.file?.data;
      });
      if (validSlips.length > 0) {
        await Promise.all(
          validSlips.map(s =>
            uploadOrderFile({
              quotation_number: order.quotation_number ?? '',
              file_type: 'balance_proof',
              original_filename: s.file?.name ?? 'payment_receipt',
              mime_type: s.file?.mime ?? 'image/jpeg',
              file_data: s.file?.data ?? '',
            }).catch(err => console.warn('[executeAdvancePaymentReceived] File upload failed:', err))
          )
        );
      }

      // Call the confirm-payment endpoint (mirrors verify-balance behavior)
      await confirmPayment(order.id, {
        confirmed_by: 'dashboard_quick_action',
        action_token: actionToken,
      });
      mutatePaymentReceived();
      mutatePaymentConfirmed();
    } catch (err: any) {
      alert('Failed to advance payment: ' + (err.message ?? 'Unknown error'));
    } finally {
      setActionLoading(null);
    }
  }

  // ── Advance payment_confirmed → completed ───────────────────────────────

  function handleAdvancePaymentConfirmed(order: Order) {
    (window as any).__pendingActionOrder = order;
    setConfirmModal({
      open: true,
      title: 'Complete Order',
      description: `Confirm completion for "${order.quotation_number ?? '—'}" and advance from Payment Confirmed to Completed.`,
      pendingAction: 'advance_payment_confirmed',
    });
  }

  async function executeAdvancePaymentConfirmed(order: Order, actionToken: string) {
    setActionLoading(order.id);
    try {
      await recordStageUpdate({
        quotation_number: order.quotation_number ?? '',
        stage: 'completed',
        status: 'auto_completed',
        remarks: 'Payment confirmed — order completed',
        action_token: actionToken,
      });
      mutatePaymentConfirmed();
    } catch (err: any) {
      alert('Failed to complete order: ' + (err.message ?? 'Unknown error'));
    } finally {
      setActionLoading(null);
    }
  }

  // ── Record Deposit (quick action) ──────────────────────────────────────
  function handleRecordDeposit(order: Order) {
    (window as any).__pendingRecordDepositData = { order };
    setConfirmModal({
      open: true,
      title: 'Record Downpayment',
      description: `Record downpayment for "${order.quotation_number ?? '—'}" (₱${Number(order.total_amount ?? 0).toLocaleString()}). This will notify the collection group and create a deposit verification reminder.`,
      pendingAction: 'recordDeposit',
    });
  }

  async function handleRecordDepositVerified(actionToken: string) {
    const pending = (window as any).__pendingRecordDepositData as { order: Order } | undefined;
    if (!pending) return;
    setActionLoading(pending.order.id);
    try {
      await recordDeposit({
        quotation_number: pending.order.quotation_number ?? '',
        amount: Number(pending.order.total_amount ?? 0),
        action_token: actionToken,
      });
      mutateAll();
    } catch (err: any) {
      alert('Failed to record deposit: ' + (err.message ?? 'Unknown error'));
    } finally {
      setActionLoading(null);
      (window as any).__pendingRecordDepositData = null;
    }
  }

  function handleOtpVerified(actionToken: string) {
    if (otpModal.pendingAction === 'edit') { handleEditVerified(actionToken); return; }
    if (otpModal.pendingAction === 'delete') { handleDeleteVerified(actionToken); return; }
    if (otpModal.pendingAction === 'verify_balance') {
      const order = (window as any).__pendingActionOrder as Order | undefined;
      if (order) executeVerifyBalance(order, actionToken);
      (window as any).__pendingActionOrder = null;
      return;
    }
  }

  /** ConfirmModal verified handler — uses the pre-fetched action token from ConfirmModal */
  async function handleConfirmVerified(actionToken: string) {
    try {
      const order = (window as any).__pendingActionOrder as Order | undefined;

      if (confirmModal.pendingAction === 'advance_balance_due' && order) { executeAdvanceBalanceDue(order, actionToken); }
      else if (confirmModal.pendingAction === 'schedule_delivery') { handleScheduleVerified(actionToken); }
      else if (confirmModal.pendingAction === 'mark_delivered' && order) { executeMarkDelivered(order, actionToken); }
      else if (confirmModal.pendingAction === 'mark_countered' && order) { executeMarkCountered(order, actionToken); }
      else if (confirmModal.pendingAction === 'special_case' && order) { executeSpecialCase(order, actionToken); }
      else if (confirmModal.pendingAction === 'verify_countered' && order) { executeVerifyCountered(order, actionToken); }
      else if (confirmModal.pendingAction === 'complete_directly') {
        const pending = (window as any).__pendingCompleteData as { order: Order } | undefined;
        if (pending) executeCompleteDirectly(pending.order, actionToken);
        (window as any).__pendingCompleteData = null;
      }
      else if (confirmModal.pendingAction === 'cancel_schedule' && order) { executeCancelSchedule(order, actionToken); }
      else if (confirmModal.pendingAction === 'mark_payment_received' && order) { executeMarkPaymentReceived(order, actionToken); }
      else if (confirmModal.pendingAction === 'mark_payment_confirmed' && order) { executeMarkPaymentConfirmed(order, actionToken); }
      else if (confirmModal.pendingAction === 'advance_payment_received' && order) { executeAdvancePaymentReceived(order, actionToken); }
      else if (confirmModal.pendingAction === 'advance_payment_confirmed' && order) { executeAdvancePaymentConfirmed(order, actionToken); }
      else if (confirmModal.pendingAction === 'recordDeposit') { handleRecordDepositVerified(actionToken); }
      else if (confirmModal.pendingAction === 'confirmPayment') { executeConfirmPayment(actionToken); }
      else if (confirmModal.pendingAction === 'partial_delivery') { handlePartialDeliveryOtp(actionToken); }
      else if (confirmModal.pendingAction === 'complete_inventory_verification_partial') { handleCompleteInventoryVerificationPartialOtp(actionToken); }
      else if (confirmModal.pendingAction === 'payment_counter' && order) { executePaymentCounter(order, actionToken); }

      setConfirmModal((prev) => ({ ...prev, open: false }));
      (window as any).__pendingActionOrder = null;
    } catch (err: any) {
      alert('Action failed: ' + (err.message ?? 'Unknown error'));
    }
  }

  // ── Partial Delivery ────────────────────────────────────────────────────

  async function handleOpenPartialDelivery(order: Order) {
    setPartialDeliveryModal((prev) => ({ ...prev, open: true, order, loading: true }));
    try {
      const data = await getDeliveryProgress(order.id);
      setPartialDeliveryModal((prev) => ({
        ...prev,
        items: data.items,
        summary: data.summary,
        selectedItemIds: new Set(
          data.items
            .filter((item) => {
              if (item.fully_delivered) return false;
              // Items with verified_qty=0 (e.g. added after inventory verification) are still deliverable
              return item.verified_qty > 0 || Number(item.quantity) > 0;
            })
            .map((item) => item.id)
        ),
        loading: false,
      }));
    } catch (err: any) {
      alert('Failed to load delivery progress: ' + (err.message ?? 'Unknown error'));
      setPartialDeliveryModal((prev) => ({ ...prev, open: false, loading: false }));
    }
  }

  function togglePartialDeliveryItem(itemId: string) {
    setPartialDeliveryModal((prev) => {
      const next = new Set(prev.selectedItemIds);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return { ...prev, selectedItemIds: next };
    });
  }

  async function handlePartialDeliveryOtp(actionToken: string) {
    const pending = (window as any).__pendingPartialDeliveryData as { order: Order; itemIds: string[]; deliveryNote: string } | undefined;
    if (!pending) return;
    (window as any).__pendingPartialDeliveryData = null;
    await executePartialDelivery(pending.order, pending.itemIds, pending.deliveryNote, actionToken);
  }

  async function executePartialDelivery(order: Order, itemIds: string[], deliveryNote: string, actionToken: string) {
    setPartialDeliveryModal((prev) => ({ ...prev, submitting: true }));
    try {
      const result = await partialDelivery(order.id, itemIds, actionToken, deliveryNote || undefined);
      alert(result.message);
      setPartialDeliveryModal((prev) => ({ ...prev, open: false, submitting: false }));
      mutateAll();
    } catch (err: any) {
      alert('Failed to record partial delivery: ' + (err.message ?? 'Unknown error'));
      setPartialDeliveryModal((prev) => ({ ...prev, submitting: false }));
    }
  }

  // ── Complete Inventory Verification Partial (from delivery tab) ────────────

  function handleCompleteInventoryVerificationPartial(order: Order) {
    (window as any).__pendingActionOrder = order;
    setConfirmModal({
      open: true,
      title: 'Complete Partial Inventory Verification',
      description: `Advance order ${order.quotation_number ?? order.id.slice(0, 8)} to Inventory Arrived with partial delivery enabled. Verified items will be available for delivery.`,
      pendingAction: 'complete_inventory_verification_partial',
    });
  }

  async function handleCompleteInventoryVerificationPartialOtp(actionToken: string) {
    const order = (window as any).__pendingActionOrder as Order | undefined;
    if (!order) return;
    (window as any).__pendingActionOrder = null;
    setActionLoading(order.id);
    try {
      const result = await completeInventoryVerificationPartial(order.id, actionToken);
      alert(result.message);
      mutateAll();
    } catch (err: any) {
      alert('Failed to complete partial inventory verification: ' + (err.message ?? 'Unknown error'));
    } finally {
      setActionLoading(null);
    }
  }

  // ── Delivery Item Section handlers (itemized progression) ────────────────

  /** Deliver a single item — opens the partial delivery modal with just that item selected */
  function handleDeliverItem(order: Order, item: DeliveryProgressItem) {
    handleOpenPartialDelivery(order);
    // After the modal loads, we need to override the selectedItemIds to just this item
    // We do this by fetching and then setting only this item
    getDeliveryProgress(order.id).then((data) => {
      setPartialDeliveryModal((prev) => ({
        ...prev,
        items: data.items,
        summary: data.summary,
        selectedItemIds: new Set([item.id]),
        loading: false,
      }));
    }).catch((err: any) => {
      alert('Failed to load delivery progress: ' + (err.message ?? 'Unknown error'));
      setPartialDeliveryModal((prev) => ({ ...prev, open: false, loading: false }));
    });
  }

  /** Deliver selected items — opens the partial delivery modal with those items pre-selected */
  function handleDeliverSelected(order: Order, itemIds: string[]) {
    handleOpenPartialDelivery(order);
    getDeliveryProgress(order.id).then((data) => {
      setPartialDeliveryModal((prev) => ({
        ...prev,
        items: data.items,
        summary: data.summary,
        selectedItemIds: new Set(itemIds),
        loading: false,
      }));
    }).catch((err: any) => {
      alert('Failed to load delivery progress: ' + (err.message ?? 'Unknown error'));
      setPartialDeliveryModal((prev) => ({ ...prev, open: false, loading: false }));
    });
  }

  /** Deliver all items — opens the partial delivery modal with all deliverable items pre-selected */
  function handleDeliverAll(order: Order) {
    handleOpenPartialDelivery(order);
  }

  // ── Apply client filter ──────────────────────────────────────────────
  const filteredInventoryVerificationOrders = filterByClient(inventoryVerificationOrders);
  const filteredInventoryArrivedOrders = filterByClient(inventoryArrivedOrders);
  const filteredBalanceDueOrders = filterByClient(balanceDueOrders);
  const filteredBalanceVerificationOrders = filterByClient(balanceVerificationOrders);
  const filteredPendingOrders = filterByClient(pendingOrders);
  const filteredScheduledOrders = filterByClient(scheduledOrders);
  const filteredCounteredOrders = filterByClient(counteredOrders);
  const filteredDeliveredOrders = filterByClient(deliveredOrders);
  const filteredPaymentReceivedOrders = filterByClient(paymentReceivedOrders);
  const filteredPaymentConfirmedOrders = filterByClient(paymentConfirmedOrders);
  const filteredStockPrepOrders = filterByClient(stockPrepOrders);

  if (loading && inventoryVerificationOrders.length === 0 && inventoryArrivedOrders.length === 0 && balanceDueOrders.length === 0 && balanceVerificationOrders.length === 0 && pendingOrders.length === 0 && scheduledOrders.length === 0 && deliveredOrders.length === 0 && paymentReceivedOrders.length === 0 && paymentConfirmedOrders.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Workflow banner */}
      <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Truck className="mt-0.5 h-5 w-5 text-purple-600" />
            <div>
              <h3 className="text-sm font-semibold text-purple-800">Delivery Workflow</h3>
              <p className="mt-1 text-xs text-purple-700">
                Inventory arrives → Balance paid via{' '}
                <code className="rounded bg-purple-100 px-1">/paybalance QTN-2026-001 15000</code>
                {' '}→ Schedule via{' '}
                <code className="rounded bg-purple-100 px-1">/deliverydate QTN-2026-001 May 22 2026</code>
                {' '}→ Deliver → Update via{' '}
                <code className="rounded bg-purple-100 px-1">/delivered QTN-2026-001 yes countered</code>
              </p>
            </div>
          </div>
          {/* Client filter */}
          <div className="relative shrink-0" ref={clientFilterRef}>
            <div className="flex items-center gap-1 rounded-lg border border-purple-200 bg-white px-2 py-1.5">
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
                  <div className="max-h-48 overflow-y-auto">
                    {clientSuggestions.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => selectClientFilter(c.client_name)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-purple-50 transition-colors"
                      >
                        <span className="font-medium text-gray-700">{c.client_name}</span>
                        <span className="text-gray-400">{c.order_count ?? 0} orders</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Payment result toast */}
      {payResult && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
          <div>
            <p className="text-sm font-medium text-emerald-800">Payment Recorded</p>
            <p className="text-xs text-emerald-700">{payResult}</p>
            <button onClick={() => setPayResult(null)} className="mt-1 text-xs text-emerald-600 hover:underline">Dismiss</button>
          </div>
        </div>
      )}

      {/* ── Stock Preparation (From-Stock Orders) ─────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <PackageCheck className="h-4 w-4 text-cyan-500" />
          <h2 className="text-base font-semibold text-gray-800">Stock Preparation</h2>
          <span className="ml-auto rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-700">
            {filteredStockPrepOrders.length}
          </span>
        </div>
        {filteredStockPrepOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No from-stock orders awaiting stock preparation</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredStockPrepOrders.map((order) => {
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
                            <ShieldAlert className="h-3 w-3" />Special Case
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                      {order.sales_agent && <p className="text-[11px] text-gray-400">{order.sales_agent}</p>}
                      {order.total_amount != null && (
                        <p className="mt-0.5 text-xs text-gray-400">
                          Balance: {order.balance_paid ? '✅ Paid' : `₱${balance.toLocaleString()} due`}
                        </p>
                      )}
                      {order.stock_prep_ready_at && (
                        <p className="mt-0.5 text-xs text-cyan-600">
                          Stock ready by: {formatDeliveryDate(order.stock_prep_ready_at) ?? order.stock_prep_ready_at}
                        </p>
                      )}
                      <DeliveryInfo order={order} />
                    </div>
                    <div className="flex items-center gap-3">
                      <StageBadge stage={order.current_stage} />
                      {!order.deposit_paid && (
                        <button
                          onClick={() => handleRecordDeposit(order)}
                          disabled={actionLoading === order.id}
                          className="rounded-lg bg-pink-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-pink-600 disabled:opacity-40"
                          title="Record downpayment"
                        >
                          {actionLoading === order.id ? '…' : 'Record Deposit'}
                        </button>
                      )}
                      <button
                        onClick={() => handleAdvanceBalanceDue(order)}
                        disabled={actionLoading === order.id}
                        className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-40"
                        title="Advance to Balance Due"
                      >
                        {actionLoading === order.id ? '…' : 'Balance Due →'}
                      </button>
                      <RowActions order={order} onEdit={setEditingOrder} onDelete={handleDeleteClick} onRevert={handleRevertClick} />
                    </div>
                  </div>
                  {editingOrder?.id === order.id && (
                    <EditForm order={order} onSave={handleEditSave} onCancel={() => setEditingOrder(null)} saving={saving} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Inventory Verification (Partial Delivery) ──────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <ListChecks className="h-4 w-4 text-indigo-500" />
          <h2 className="text-base font-semibold text-gray-800">Inventory Verification</h2>
          <span className="ml-auto rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
            {filteredInventoryVerificationOrders.length}
          </span>
        </div>
        {filteredInventoryVerificationOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No orders awaiting inventory verification</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredInventoryVerificationOrders.map((order) => {
              const totalAmount = Number(order.total_amount ?? 0);
              const depositAmount = Number(order.deposit_amount ?? 0);
              const balance = totalAmount - depositAmount;
              return (
                <div key={order.id}>
                  <div className="flex items-center justify-between px-6 py-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <QuotationNumberCell order={order} onViewFiles={handleViewFiles} />
                      </div>
                      <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                      {order.sales_agent && <p className="text-[11px] text-gray-400">{order.sales_agent}</p>}
                      {order.total_amount != null && (
                        <p className="mt-0.5 text-xs text-gray-400">
                          Total: ₱{totalAmount.toLocaleString()}
                        </p>
                      )}
                      <DeliveryInfo order={order} />
                    </div>
                    <div className="flex items-center gap-3">
                      <StageBadge stage={order.current_stage} />
                      <button
                        onClick={() => handleCompleteInventoryVerificationPartial(order)}
                        disabled={actionLoading === order.id}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                        title="Complete partial verification and advance to Inventory Arrived"
                      >
                        {actionLoading === order.id ? '…' : 'Complete Partial Verification →'}
                      </button>
                      <RowActions order={order} onEdit={setEditingOrder} onDelete={handleDeleteClick} onRevert={handleRevertClick} />
                    </div>
                  </div>
                  {editingOrder?.id === order.id && (
                    <EditForm order={order} onSave={handleEditSave} onCancel={() => setEditingOrder(null)} saving={saving} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Inventory Arrived ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <PackageOpen className="h-4 w-4 text-teal-500" />
          <h2 className="text-base font-semibold text-gray-800">Inventory Arrived</h2>
          <span className="ml-auto rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-700">
            {filteredInventoryArrivedOrders.length}
          </span>
        </div>
        {filteredInventoryArrivedOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No orders with inventory arrived</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredInventoryArrivedOrders.map((order) => {
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
                            <ShieldAlert className="h-3 w-3" />Special Case
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                      {order.sales_agent && <p className="text-[11px] text-gray-400">{order.sales_agent}</p>}
                      {order.total_amount != null && (
                        <p className="mt-0.5 text-xs text-gray-400">
                          Balance: {order.balance_paid ? '✅ Paid' : `₱${balance.toLocaleString()} due`}
                        </p>
                      )}
                      <DeliveryInfo order={order} />
                    </div>
                    <div className="flex items-center gap-3">
                      <StageBadge stage={order.current_stage} />
                      {order.partial_delivery === true && (
                        <Link
                          href={`/inventory/verification/${encodeURIComponent(order.quotation_number ?? order.id)}`}
                          className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-600"
                          title="Verify remaining items for this partial-delivery order"
                        >
                          Verify Inventory
                        </Link>
                      )}
                      {!order.deposit_paid && (
                        <button
                          onClick={() => handleRecordDeposit(order)}
                          disabled={actionLoading === order.id}
                          className="rounded-lg bg-pink-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-pink-600 disabled:opacity-40"
                          title="Record downpayment"
                        >
                          {actionLoading === order.id ? '…' : 'Record Deposit'}
                        </button>
                      )}
                      <button
                        onClick={() => handleAdvanceBalanceDue(order)}
                        disabled={actionLoading === order.id}
                        className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-40"
                        title="Advance to Balance Due"
                      >
                        {actionLoading === order.id ? '…' : 'Balance Due →'}
                      </button>
                      <RowActions order={order} onEdit={setEditingOrder} onDelete={handleDeleteClick} onRevert={handleRevertClick} />
                    </div>
                  </div>
                  {editingOrder?.id === order.id && (
                    <EditForm order={order} onSave={handleEditSave} onCancel={() => setEditingOrder(null)} saving={saving} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Balance Due ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <Scale className="h-4 w-4 text-violet-500" />
          <h2 className="text-base font-semibold text-gray-800">Balance Due (Awaiting Payment)</h2>
          <span className="ml-auto rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
            {filteredBalanceDueOrders.length}
          </span>
        </div>
        {filteredBalanceDueOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No orders awaiting balance payment</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredBalanceDueOrders.map((order) => {
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
                            <ShieldAlert className="h-3 w-3" />Special Case
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                      {order.sales_agent && <p className="text-[11px] text-gray-400">{order.sales_agent}</p>}
                      {hasException && order.delivery_exception_notes && (
                        <p className="mt-1 text-[11px] italic text-amber-600">Exception: {order.delivery_exception_notes}</p>
                      )}
                      <DeliveryInfo order={order} />
                    </div>
                    <div className="flex items-center gap-3">
                      {!order.deposit_paid && (
                        <button
                          onClick={() => handleRecordDeposit(order)}
                          disabled={actionLoading === order.id}
                          className="rounded-lg bg-pink-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-pink-600 disabled:opacity-40"
                          title="Record downpayment"
                        >
                          {actionLoading === order.id ? '…' : 'Record Deposit'}
                        </button>
                      )}
                      {hasException ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          Exception Granted
                        </span>
                      ) : (
                        <button
                          onClick={() => handlePaymentConfirmClick(order)}
                          className="text-xs font-medium text-violet-600 hover:text-violet-800 hover:underline cursor-pointer"
                          title="Upload deposit slip and record balance payment"
                        >
                          ₱{balance.toLocaleString()} due
                        </button>
                      )}
                      <StageBadge stage={order.current_stage} />
                      <button
                        onClick={() => handlePaymentConfirmClick(order)}
                        disabled={actionLoading === order.id}
                        className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
                        title="Record payment with deposit slip"
                      >
                        <Upload className="h-4 w-4" />
                      </button>
                      {/* Special Case button for non-exception orders */}
                      {!hasException && (
                        <button
                          onClick={() => handleSpecialCase(order)}
                          disabled={actionLoading === order.id}
                          className="rounded-lg px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-40"
                          title="Skip payment — grant special case (goes through countered section)"
                        >
                          <ShieldAlert className="h-3.5 w-3.5 inline mr-0.5" />Special Case
                        </button>
                      )}
                      {/* Skip-payment buttons for exception orders */}
                      {hasException && (
                        <>
                          <button
                            onClick={() => handleOpenSchedule(order)}
                            disabled={actionLoading === order.id}
                            className="rounded-lg px-2 py-1 text-[11px] font-medium text-purple-700 hover:bg-purple-50 disabled:opacity-40"
                            title="Skip payment — schedule delivery directly"
                          >
                            <Calendar className="h-3.5 w-3.5 inline mr-0.5" />Schedule
                          </button>
                          <button
                            onClick={() => handleMarkDelivered(order)}
                            disabled={actionLoading === order.id}
                            className="rounded-lg px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                            title="Skip payment — mark as delivered directly"
                          >
                            <PackageCheck className="h-3.5 w-3.5 inline mr-0.5" />Deliver
                          </button>
                          <button
                            onClick={() => handleMarkCountered(order)}
                            disabled={actionLoading === order.id}
                            className="rounded-lg px-2 py-1 text-[11px] font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-40"
                            title="Skip payment — mark as countered directly"
                          >
                            <DollarSign className="h-3.5 w-3.5 inline mr-0.5" />Counter
                          </button>
                        </>
                      )}
                      <RowActions order={order} onEdit={setEditingOrder} onDelete={handleDeleteClick} onRevert={handleRevertClick} />
                    </div>
                  </div>
                  {editingOrder?.id === order.id && (
                    <EditForm order={order} onSave={handleEditSave} onCancel={() => setEditingOrder(null)} saving={saving} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Balance Verification ────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <ThumbsUp className="h-4 w-4 text-emerald-500" />
          <h2 className="text-base font-semibold text-gray-800">Balance Verification</h2>
          <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            {filteredBalanceVerificationOrders.length}
          </span>
        </div>
        {filteredBalanceVerificationOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No orders awaiting balance verification</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredBalanceVerificationOrders.map((order) => {
              const totalAmount = Number(order.total_amount ?? 0);
              const depositAmount = Number(order.deposit_amount ?? 0);
              const balance = totalAmount - depositAmount;
              return (
                <div key={order.id}>
                  <div className="flex items-center justify-between px-6 py-4">
                    <div>
                      <QuotationNumberCell order={order} onViewFiles={handleViewFiles} />
                      <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                      {order.sales_agent && <p className="text-[11px] text-gray-400">{order.sales_agent}</p>}
                      {order.total_amount != null && (
                        <p className="mt-0.5 text-xs text-gray-400">
                          Total: ₱{totalAmount.toLocaleString()} | Balance: {order.balance_paid ? '✅ Paid' : `₱${balance.toLocaleString()}`}
                        </p>
                      )}
                      <DeliveryInfo order={order} />
                    </div>
                    <div className="flex items-center gap-3">
                      <StageBadge stage={order.current_stage} />
                      <button
                        onClick={() => handleVerifyBalance(order)}
                        disabled={actionLoading === order.id}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
                        title="Verify balance and advance to delivery pending"
                      >
                        {actionLoading === order.id ? '…' : 'Verify Balance →'}
                      </button>
                      <RowActions order={order} onEdit={setEditingOrder} onDelete={handleDeleteClick} onRevert={handleRevertClick} />
                    </div>
                  </div>
                  {editingOrder?.id === order.id && (
                    <EditForm order={order} onSave={handleEditSave} onCancel={() => setEditingOrder(null)} saving={saving} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Delivery Pending (itemized progression) ──────────────────────── */}
      <DeliveryItemSection
        icon={<Clock className="h-4 w-4 text-amber-500" />}
        title="Delivery Pending"
        count={filteredPendingOrders.length}
        countBg="bg-amber-100"
        countText="text-amber-700"
        orders={filteredPendingOrders}
        isLoading={loading}
        emptyText="No orders pending delivery scheduling"
        onScheduleDelivery={handleOpenSchedule}
        schedulingOrderId={schedulingOrder?.id ?? null}
        scheduleDate={scheduleDate}
        scheduleRemarks={scheduleRemarks}
        onScheduleDateChange={setScheduleDate}
        onScheduleRemarksChange={setScheduleRemarks}
        onScheduleSubmit={handleScheduleSubmit}
        onScheduleCancel={() => { setSchedulingOrder(null); setScheduleDate(''); setScheduleRemarks(''); }}
        scheduleSaving={actionLoading !== null}
        onViewFiles={handleViewFiles}
        onEdit={setEditingOrder}
        onDelete={handleDeleteClick}
        onRevert={handleRevertClick}
        actionLoading={actionLoading}
      />

      {/* ── Scheduled Deliveries (itemized progression) ──────────────────── */}
      <DeliveryItemSection
        icon={<Calendar className="h-4 w-4 text-purple-500" />}
        title="Scheduled Deliveries"
        count={filteredScheduledOrders.length}
        countBg="bg-purple-100"
        countText="text-purple-700"
        orders={filteredScheduledOrders}
        isLoading={loading}
        emptyText="No scheduled deliveries"
        onDeliverItem={handleDeliverItem}
        onDeliverSelected={handleDeliverSelected}
        onDeliverAll={handleDeliverAll}
        onViewFiles={handleViewFiles}
        onEdit={setEditingOrder}
        onDelete={handleDeleteClick}
        onRevert={handleRevertClick}
        actionLoading={actionLoading}
      />

      {/* ── Delivered (itemized progression) ──────────────────────────────── */}
      <DeliveryItemSection
        icon={<CheckCircle2 className="h-4 w-4 text-orange-500" />}
        title="Delivered"
        count={filteredDeliveredOrders.length}
        countBg="bg-orange-100"
        countText="text-orange-700"
        orders={filteredDeliveredOrders}
        isLoading={loading}
        emptyText="No delivered orders"
        onDeliverItem={handleDeliverItem}
        onDeliverSelected={handleDeliverSelected}
        onDeliverAll={handleDeliverAll}
        onViewFiles={handleViewFiles}
        onEdit={setEditingOrder}
        onDelete={handleDeleteClick}
        onRevert={handleRevertClick}
        onCompleteOrder={handleCompleteOrder}
        actionLoading={actionLoading}
      />

      {/* ── Countered (Awaiting Payment) ───────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <DollarSign className="h-4 w-4 text-orange-500" />
          <h2 className="text-base font-semibold text-gray-800">Countered (Awaiting Payment)</h2>
          <span className="ml-auto rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
            {filteredCounteredOrders.length}
          </span>
        </div>
        {filteredCounteredOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No countered orders</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredCounteredOrders.map((order) => {
              const totalAmount = Number(order.total_amount ?? 0);
              const depositAmount = Number(order.deposit_amount ?? 0);
              const balance = totalAmount - depositAmount;
              const isSpecialCase = order.special_case === true;
              return (
                <div key={order.id}>
                  <div className="flex items-center justify-between px-6 py-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <QuotationNumberCell order={order} onViewFiles={handleViewFiles} />
                        {isSpecialCase && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            <ShieldAlert className="h-3 w-3" />Special Case
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                      {order.sales_agent && <p className="text-[11px] text-gray-400">{order.sales_agent}</p>}
                      {order.special_case_notes && (
                        <p className="mt-1 text-[11px] italic text-amber-600">Reason: {order.special_case_notes}</p>
                      )}
                      {order.total_amount != null && (
                        <p className="mt-0.5 text-xs text-gray-400">
                          Total: ₱{totalAmount.toLocaleString()} | Balance: ₱{balance.toLocaleString()}
                        </p>
                      )}
                      <DeliveryInfo order={order} />
                    </div>
                    <div className="flex items-center gap-3">
                      <StageBadge stage={order.current_stage} />
                      <button
                        onClick={() => handleMarkPaymentReceived(order)}
                        disabled={actionLoading === order.id}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                        title="Mark payment received and advance to Payment Received stage"
                      >
                        <CreditCard className="h-3.5 w-3.5 inline mr-1" />Mark Payment Received
                      </button>
                      {isSpecialCase && !verifiedCounterIds.has(order.id) && (
                        <button
                          onClick={() => handleVerifyCountered(order)}
                          disabled={actionLoading === order.id}
                          className="rounded-lg px-2 py-1 text-[11px] font-medium text-purple-700 hover:bg-purple-50 disabled:opacity-40"
                          title="Verify countered status and create payment counter record for invoice tracking"
                        >
                          <FileText className="h-3.5 w-3.5 inline mr-0.5" />Verify Countered
                        </button>
                      )}
                      <button
                        onClick={() => handleOpenPaymentCounter(order)}
                        disabled={actionLoading === order.id}
                        className="rounded-lg px-2 py-1 text-[11px] font-medium text-purple-700 hover:bg-purple-50 disabled:opacity-40"
                        title="Upload delivery receipt and sales invoice as records for the order"
                      >
                        <Upload className="h-3.5 w-3.5 inline mr-0.5" />Upload Invoice / Receipt
                      </button>
                      <RowActions order={order} onEdit={setEditingOrder} onDelete={handleDeleteClick} onRevert={handleRevertClick} />
                    </div>
                  </div>
                  {editingOrder?.id === order.id && (
                    <EditForm order={order} onSave={handleEditSave} onCancel={() => setEditingOrder(null)} saving={saving} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Payment Received ────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <CreditCard className="h-4 w-4 text-blue-500" />
          <h2 className="text-base font-semibold text-gray-800">Payment Received</h2>
          <span className="ml-auto rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
            {filteredPaymentReceivedOrders.length}
          </span>
        </div>
        {filteredPaymentReceivedOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No orders with payment received</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredPaymentReceivedOrders.map((order) => {
              const totalAmount = Number(order.total_amount ?? 0);
              const depositAmount = Number(order.deposit_amount ?? 0);
              const balance = totalAmount - depositAmount;
              return (
                <div key={order.id}>
                  <div className="flex items-center justify-between px-6 py-4">
                    <div>
                      <QuotationNumberCell order={order} onViewFiles={handleViewFiles} />
                      <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                      {order.sales_agent && <p className="text-[11px] text-gray-400">{order.sales_agent}</p>}
                      {order.total_amount != null && (
                        <p className="mt-0.5 text-xs text-gray-400">
                          Total: ₱{totalAmount.toLocaleString()} | Balance: {order.balance_paid ? '✅ Paid' : `₱${balance.toLocaleString()}`}
                        </p>
                      )}
                      <DeliveryInfo order={order} />
                    </div>
                    <div className="flex items-center gap-3">
                      <StageBadge stage={order.current_stage} />
                      <button
                        onClick={() => handleAdvancePaymentReceived(order)}
                        disabled={actionLoading === order.id}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                        title="Advance to Payment Confirmed"
                      >
                        {actionLoading === order.id ? '…' : 'Confirm Payment →'}
                      </button>
                      <RowActions order={order} onEdit={setEditingOrder} onDelete={handleDeleteClick} onRevert={handleRevertClick} />
                    </div>
                  </div>
                  {editingOrder?.id === order.id && (
                    <EditForm order={order} onSave={handleEditSave} onCancel={() => setEditingOrder(null)} saving={saving} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Payment Confirmed ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <ThumbsUp className="h-4 w-4 text-indigo-500" />
          <h2 className="text-base font-semibold text-gray-800">Payment Confirmed</h2>
          <span className="ml-auto rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
            {filteredPaymentConfirmedOrders.length}
          </span>
        </div>
        {filteredPaymentConfirmedOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No orders with payment confirmed</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredPaymentConfirmedOrders.map((order) => {
              const totalAmount = Number(order.total_amount ?? 0);
              const depositAmount = Number(order.deposit_amount ?? 0);
              const balance = totalAmount - depositAmount;
              return (
                <div key={order.id}>
                  <div className="flex items-center justify-between px-6 py-4">
                    <div>
                      <QuotationNumberCell order={order} onViewFiles={handleViewFiles} />
                      <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                      {order.sales_agent && <p className="text-[11px] text-gray-400">{order.sales_agent}</p>}
                      {order.total_amount != null && (
                        <p className="mt-0.5 text-xs text-gray-400">
                          Total: ₱{totalAmount.toLocaleString()} | Balance: {order.balance_paid ? '✅ Paid' : `₱${balance.toLocaleString()}`}
                        </p>
                      )}
                      <DeliveryInfo order={order} />
                    </div>
                    <div className="flex items-center gap-3">
                      <StageBadge stage={order.current_stage} />
                      <button
                        onClick={() => handleAdvancePaymentConfirmed(order)}
                        disabled={actionLoading === order.id}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
                        title="Mark order as complete"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 inline mr-1" />Order Complete
                      </button>
                      <RowActions order={order} onEdit={setEditingOrder} onDelete={handleDeleteClick} onRevert={handleRevertClick} />
                    </div>
                  </div>
                  {editingOrder?.id === order.id && (
                    <EditForm order={order} onSave={handleEditSave} onCancel={() => setEditingOrder(null)} saving={saving} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Payment Received Upload Modal (Optional Deposit Slip) ──────────── */}
      {paymentReceivedModal.open && paymentReceivedModal.order && (() => {
        const order = paymentReceivedModal.order;
        const hasValidSlip = paymentReceivedSlips.some(s => {
          const amt = Number(s.amount.replace(/,/g, ''));
          return Number.isFinite(amt) && amt > 0;
        });
        return (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-10">
            <div className="mx-auto w-full max-w-xl rounded-xl bg-white shadow-2xl">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-800">Confirm Payment Received</h3>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {order.quotation_number ?? '—'} — {order.client_name ?? 'Unknown'}
                  </p>
                </div>
                <button onClick={closePaymentReceivedModal} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Body */}
              <div className="space-y-4 px-6 py-4">
                {paymentReceivedModal.error && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                    {paymentReceivedModal.error}
                  </div>
                )}

                <p className="text-xs text-gray-600">
                  Optionally upload a deposit slip or proof of payment before confirming. You can skip this and just confirm.
                </p>

                {/* Slip list */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-700">Payment Proof (Optional)</span>
                    <button
                      onClick={() => setPaymentReceivedSlips(prev => [...prev, emptySlip()])}
                      className="rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
                    >
                      + Add Slip
                    </button>
                  </div>

                  {paymentReceivedSlips.map((slip, idx) => (
                    <div key={idx} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-gray-500">Slip #{idx + 1}</span>
                        {paymentReceivedSlips.length > 1 && (
                          <button
                            onClick={() => setPaymentReceivedSlips(prev => prev.filter((_, i) => i !== idx))}
                            className="text-[11px] text-red-500 hover:text-red-700"
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      {/* File upload */}
                      <div className="mb-3">
                        <input
                          ref={(el) => { paymentReceivedFileInputRefs.current[idx] = el; }}
                          type="file"
                          accept="image/*,.pdf"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              const result = ev.target?.result as string;
                              const commaIndex = result.indexOf(',');
                              const base64 = commaIndex !== -1 ? result.substring(commaIndex + 1) : result;
                              const mime = file.type || 'image/jpeg';
                              setPaymentReceivedSlips(prev => prev.map((s, i) => i === idx ? {
                                ...s,
                                file: { name: file.name, data: base64, mime, preview: result },
                                extracting: true,
                                extractedNote: null,
                              } : s));
                              // AI extract
                              visionExtract({ image_base64: base64, mime_type: mime, mode: 'payment' }).then(result => {
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
                                setPaymentReceivedSlips(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
                              }).catch(() => {
                                setPaymentReceivedSlips(prev => prev.map((s, i) => i === idx ? { ...s, extracting: false, extractedNote: 'AI extraction failed. Enter manually.' } : s));
                              });
                            };
                            reader.readAsDataURL(file);
                          }}
                        />
                        {slip.file ? (
                          <div className="relative">
                            <img src={slip.file.preview} alt="Slip preview" className="h-24 w-full rounded-lg border border-gray-200 object-cover" />
                            <button
                              onClick={() => setPaymentReceivedSlips(prev => prev.map((s, i) => i === idx ? { ...s, file: null, extractedNote: null } : s))}
                              className="absolute right-1 top-1 rounded-full bg-white/80 p-0.5 text-gray-500 hover:text-red-500"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => paymentReceivedFileInputRefs.current[idx]?.click()}
                            className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-6 text-xs text-gray-500 hover:border-emerald-400 hover:text-emerald-600"
                          >
                            <Upload className="h-5 w-5" />
                            Upload deposit slip (image or PDF)
                          </button>
                        )}
                      </div>

                      {/* Extracting indicator */}
                      {slip.extracting && (
                        <div className="mb-2 flex items-center gap-2 text-xs text-blue-600">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          AI extracting payment details…
                        </div>
                      )}

                      {/* Extracted note */}
                      {slip.extractedNote && (
                        <div className="mb-2 rounded bg-blue-50 px-2 py-1 text-[11px] text-blue-700">
                          {slip.extractedNote}
                        </div>
                      )}

                      {/* Amount + Date + Reference */}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block text-xs font-medium text-gray-600">
                          Amount (₱)
                          <input
                            value={slip.amount}
                            onChange={(e) => setPaymentReceivedSlips(prev => prev.map((s, i) => i === idx ? { ...s, amount: e.target.value.replace(/[^0-9.,]/g, '') } : s))}
                            placeholder="0.00"
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                          />
                        </label>
                        <label className="block text-xs font-medium text-gray-600">
                          Payment Date
                          <input
                            type="date"
                            value={slip.date}
                            onChange={(e) => setPaymentReceivedSlips(prev => prev.map((s, i) => i === idx ? { ...s, date: e.target.value } : s))}
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                          />
                        </label>
                      </div>
                      <label className="mt-2 block text-xs font-medium text-gray-600">
                        Reference Number
                        <input
                          value={slip.reference}
                          onChange={(e) => setPaymentReceivedSlips(prev => prev.map((s, i) => i === idx ? { ...s, reference: e.target.value } : s))}
                          placeholder="Optional"
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-6 py-4">
                <button onClick={closePaymentReceivedModal} className="rounded-lg bg-gray-100 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-200">
                  Cancel
                </button>
                <button
                  onClick={handlePaymentReceivedConfirm}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Confirm Payment
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Payment Modal (Deposit Slip Upload + AI Extract) ──────────────── */}
      {paymentModal.open && paymentModal.order && (() => {
        const order = paymentModal.order;
        const totalAmount = Number(order.total_amount ?? 0);
        const depositAmount = Number(order.deposit_amount ?? 0);
        const computedBalance = Math.max(0, totalAmount - depositAmount);
        const slipTotal = balanceSlips.reduce((sum, s) => {
          const amt = Number(s.amount.replace(/,/g, ''));
          return sum + (Number.isFinite(amt) ? amt : 0);
        }, 0);
        const hasValidSlip = balanceSlips.some(s => {
          const amt = Number(s.amount.replace(/,/g, ''));
          return Number.isFinite(amt) && amt > 0;
        });
        const dupes = getDuplicateIndices(balanceSlips);
        return (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-10">
            <div className="mx-auto w-full max-w-xl rounded-xl bg-white shadow-2xl">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-800">Record Balance Payment</h3>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {order.quotation_number ?? '—'} — {order.client_name ?? 'Unknown'}
                    {paymentModal.remainingBalance != null && (
                      <span className="ml-2 font-medium text-violet-600">
                        Remaining: ₱{paymentModal.remainingBalance.toLocaleString()}
                      </span>
                    )}
                  </p>
                </div>
                <button onClick={closePaymentModal} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Body */}
              <div className="space-y-4 px-6 py-4">
                {paymentModal.error && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                    {paymentModal.error}
                  </div>
                )}

                {/* Slip list */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-700">Deposit Slips</span>
                    <button onClick={addSlip} className="rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100">
                      + Add Slip
                    </button>
                  </div>

                  {balanceSlips.map((slip, idx) => {
                    const isDupe = dupes.has(idx);
                    return (
                      <div key={idx} className={`rounded-lg border p-3 ${isDupe ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[11px] font-medium text-gray-500">Slip #{idx + 1}</span>
                          {balanceSlips.length > 1 && (
                            <button onClick={() => removeSlip(idx)} className="text-[11px] text-red-500 hover:text-red-700">Remove</button>
                          )}
                        </div>

                        {/* File upload */}
                        <div className="mb-3">
                          <input
                            ref={(el) => { fileInputRefs.current[idx] = el; }}
                            type="file"
                            accept="image/*,.pdf"
                            className="hidden"
                            onChange={(e) => handleSlipFileSelect(idx, e)}
                          />
                          {slip.file ? (
                            <div className="relative">
                              <img src={slip.file.preview} alt="Slip preview" className="h-24 w-full rounded-lg border border-gray-200 object-cover" />
                              <button
                                onClick={() => updateSlip(idx, { file: null, extractedNote: null })}
                                className="absolute right-1 top-1 rounded-full bg-white/80 p-0.5 text-gray-500 hover:text-red-500"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => fileInputRefs.current[idx]?.click()}
                              className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-6 text-xs text-gray-500 hover:border-emerald-400 hover:text-emerald-600"
                            >
                              <Upload className="h-5 w-5" />
                              Upload deposit slip (image or PDF)
                            </button>
                          )}
                        </div>

                        {/* Extracting indicator */}
                        {slip.extracting && (
                          <div className="mb-2 flex items-center gap-2 text-xs text-blue-600">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            AI extracting payment details…
                          </div>
                        )}

                        {/* Extracted note */}
                        {slip.extractedNote && (
                          <div className="mb-2 rounded bg-blue-50 px-2 py-1 text-[11px] text-blue-700">
                            {slip.extractedNote}
                          </div>
                        )}

                        {/* Amount + Date + Reference */}
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="block text-xs font-medium text-gray-600">
                            Amount (₱)
                            <input
                              value={slip.amount}
                              onChange={(e) => updateSlip(idx, { amount: e.target.value.replace(/[^0-9.,]/g, '') })}
                              placeholder="0.00"
                              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                            />
                          </label>
                          <label className="block text-xs font-medium text-gray-600">
                            Payment Date
                            <input
                              type="date"
                              value={slip.date}
                              onChange={(e) => updateSlip(idx, { date: e.target.value })}
                              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                            />
                          </label>
                        </div>
                        <label className="mt-2 block text-xs font-medium text-gray-600">
                          Reference Number
                          <input
                            value={slip.reference}
                            onChange={(e) => updateSlip(idx, { reference: e.target.value })}
                            placeholder="Optional"
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>

                {/* Summary */}
                <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5">
                  <span className="text-xs font-medium text-gray-600">Total this submission</span>
                  <span className="text-sm font-bold text-emerald-700">₱{slipTotal.toLocaleString()}</span>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-6 py-4">
                <button onClick={closePaymentModal} className="rounded-lg bg-gray-100 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-200">
                  Cancel
                </button>
                <button
                  onClick={handleConfirmPayment}
                  disabled={!hasValidSlip || paymentModal.uploading}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {paymentModal.uploading ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing…</>
                  ) : (
                    <><FileText className="h-3.5 w-3.5" /> Confirm & Record Payment</>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Partial Delivery Modal ──────────────────────────────────────── */}
      {partialDeliveryModal.open && partialDeliveryModal.order && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-10">
          <div className="mx-auto w-full max-w-2xl rounded-xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-amber-600" />
                <h2 className="text-base font-semibold text-gray-900">
                  Partial Delivery — #{partialDeliveryModal.order.quotation_number ?? '—'}
                </h2>
              </div>
              <button
                onClick={() => setPartialDeliveryModal((prev) => ({ ...prev, open: false }))}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {partialDeliveryModal.loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <>
                {/* Summary */}
                {partialDeliveryModal.summary && (
                  <div className="grid grid-cols-4 gap-3 border-b border-gray-100 bg-amber-50/50 px-6 py-3">
                    <div className="text-center">
                      <p className="text-lg font-bold text-gray-800">{partialDeliveryModal.summary.total_quantity}</p>
                      <p className="text-[10px] text-gray-500">Total Units</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-emerald-700">{partialDeliveryModal.summary.total_delivered}</p>
                      <p className="text-[10px] text-gray-500">Delivered</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-amber-700">{partialDeliveryModal.summary.delivery_pct}%</p>
                      <p className="text-[10px] text-gray-500">Progress</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-gray-800">{partialDeliveryModal.summary.pending_items}</p>
                      <p className="text-[10px] text-gray-500">Pending</p>
                    </div>
                  </div>
                )}

                {/* Items list */}
                <div className="max-h-80 overflow-y-auto px-6 py-4">
                  <p className="mb-2 text-xs font-medium text-gray-500">
                    Select items to deliver (only verified, undelivered items are selectable):
                  </p>
                  {partialDeliveryModal.items.length === 0 ? (
                    <p className="py-8 text-center text-sm text-gray-400">No items found for this order.</p>
                  ) : (
                    <div className="space-y-2">
                      {partialDeliveryModal.items.map((item) => {
                        const canDeliver = !item.fully_delivered && (item.verified_qty > 0 || Number(item.quantity) > 0);
                        const isSelected = partialDeliveryModal.selectedItemIds.has(item.id);
                        return (
                          <div
                            key={item.id}
                            className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                              item.fully_delivered
                                ? 'border-green-200 bg-green-50 opacity-60'
                                : canDeliver
                                  ? isSelected
                                    ? 'border-amber-300 bg-amber-50'
                                    : 'border-gray-200 hover:border-amber-200 hover:bg-amber-50/50 cursor-pointer'
                                  : 'border-gray-100 bg-gray-50 opacity-50'
                            }`}
                            onClick={() => {
                              if (canDeliver) togglePartialDeliveryItem(item.id);
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={!canDeliver}
                              onChange={() => {
                                if (canDeliver) togglePartialDeliveryItem(item.id);
                              }}
                              className="rounded border-gray-300 accent-amber-600 disabled:opacity-30"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                              <p className="text-xs text-gray-500">
                                Ordered: {item.quantity} | Verified: {item.verified_qty} | Delivered: {item.delivered_qty}
                                {item.remaining_qty > 0 && (
                                  <span className="ml-2 font-medium text-amber-600">Remaining: {item.remaining_qty}</span>
                                )}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              {item.fully_delivered ? (
                                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">✅ Done</span>
                              ) : item.verified_qty > 0 ? (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                  {item.verified_qty - item.delivered_qty} ready
                                </span>
                              ) : (
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">Not verified</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Delivery note */}
                <div className="border-t border-gray-100 px-6 py-3">
                  <label className="mb-1 block text-xs font-medium text-gray-600">Delivery Note (optional)</label>
                  <input
                    type="text"
                    value={partialDeliveryModal.deliveryNote}
                    onChange={(e) => setPartialDeliveryModal((prev) => ({ ...prev, deliveryNote: e.target.value }))}
                    placeholder="e.g., Delivered 5 units of Item A to client"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-6 py-4">
                  <button
                    onClick={() => setPartialDeliveryModal((prev) => ({ ...prev, open: false }))}
                    className="rounded-lg bg-gray-100 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (partialDeliveryModal.selectedItemIds.size === 0) {
                        alert('Please select at least one item to deliver.');
                        return;
                      }
                      const order = partialDeliveryModal.order;
                      if (!order) return;
                      (window as any).__pendingPartialDeliveryData = {
                        order,
                        itemIds: Array.from(partialDeliveryModal.selectedItemIds),
                        deliveryNote: partialDeliveryModal.deliveryNote,
                      };
                      setConfirmModal({
                        open: true,
                        title: 'Record Partial Delivery',
                        description: `Deliver ${partialDeliveryModal.selectedItemIds.size} selected item(s) for #${order.quotation_number ?? '—'}.`,
                        pendingAction: 'partial_delivery',
                      });
                    }}
                    disabled={partialDeliveryModal.selectedItemIds.size === 0 || partialDeliveryModal.submitting}
                    className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {partialDeliveryModal.submitting ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing…</>
                    ) : (
                      <><PackageCheck className="h-3.5 w-3.5" /> Deliver Selected ({partialDeliveryModal.selectedItemIds.size})</>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Special Case Modal ──────────────────────────────────────────── */}
      {specialCaseModal.open && specialCaseModal.order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-auto w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="border-b border-gray-200 px-6 py-4">
              <h3 className="text-base font-semibold text-gray-800">Grant Special Case</h3>
              <p className="mt-1 text-xs text-gray-500">
                Skip balance payment for "{specialCaseModal.order.quotation_number ?? '—'}" and advance to Delivery Pending. After delivery, verify countered status with invoice tracking.
              </p>
            </div>
            <div className="px-6 py-4">
              <label className="mb-1 block text-xs font-medium text-gray-600">Reason for Special Case *</label>
              <textarea
                value={specialCaseModal.notes}
                onChange={(e) => setSpecialCaseModal((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="e.g., Client will pay upon delivery, approved by management"
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-6 py-4">
              <button
                onClick={() => setSpecialCaseModal((prev) => ({ ...prev, open: false }))}
                className="rounded-lg bg-gray-100 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!specialCaseModal.notes.trim()) {
                    alert('Please provide a reason for the special case.');
                    return;
                  }
                  (window as any).__pendingActionOrder = specialCaseModal.order;
                  setConfirmModal({
                    open: true,
                    title: 'Grant Special Case',
                    description: `Confirm special case for "${specialCaseModal.order!.quotation_number ?? '—'}" with reason: ${specialCaseModal.notes}`,
                    pendingAction: 'special_case',
                  });
                }}
                disabled={specialCaseModal.submitting}
                className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {specialCaseModal.submitting ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing…</>
                ) : (
                  <><ShieldAlert className="h-3.5 w-3.5" /> Confirm Special Case</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Verify Countered Modal ──────────────────────────────────────── */}
      {verifyCounteredModal.open && verifyCounteredModal.order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-auto w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="border-b border-gray-200 px-6 py-4">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-purple-600" />
                <h3 className="text-base font-semibold text-gray-800">Verify Countered</h3>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Create payment counter record for "{verifyCounteredModal.order.quotation_number ?? '—'}" to enable invoice tracking.
              </p>
            </div>
            <div className="px-6 py-4">
              <label className="mb-1 block text-xs font-medium text-gray-600">Notes (optional)</label>
              <textarea
                value={verifyCounteredModal.notes}
                onChange={(e) => setVerifyCounteredModal((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="e.g., Delivery completed, verified by staff"
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-6 py-4">
              <button
                onClick={() => setVerifyCounteredModal((prev) => ({ ...prev, open: false }))}
                className="rounded-lg bg-gray-100 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  (window as any).__pendingActionOrder = verifyCounteredModal.order;
                  setConfirmModal({
                    open: true,
                    title: 'Verify Countered',
                    description: `Create payment counter record for "${verifyCounteredModal.order!.quotation_number ?? '—'}" with notes: ${verifyCounteredModal.notes || '(none)'}`,
                    pendingAction: 'verify_countered',
                  });
                }}
                disabled={verifyCounteredModal.submitting}
                className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {verifyCounteredModal.submitting ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing…</>
                ) : (
                  <><FileText className="h-3.5 w-3.5" /> Confirm Verify Countered</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Payment Counter Modal ──────────────────────────────────────── */}
      {paymentCounterModal.open && paymentCounterModal.order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-auto w-full max-w-lg rounded-xl bg-white shadow-xl">
            <div className="border-b border-gray-200 px-6 py-4">
              <h3 className="text-base font-semibold text-gray-800">Payment Counter</h3>
              <p className="mt-1 text-xs text-gray-500">
                Update invoice status and dates for "{paymentCounterModal.order.quotation_number ?? '—'}"
              </p>
            </div>
            {paymentCounterModal.loading ? (
              <div className="flex items-center justify-center px-6 py-12">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <>
                <div className="space-y-4 px-6 py-4">
                  {/* Sales Invoice Status */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Sales Invoice Status</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setPaymentCounterModal((prev) => ({ ...prev, salesInvoiceStatus: 'pending' }))}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                          paymentCounterModal.salesInvoiceStatus === 'pending'
                            ? 'bg-gray-200 text-gray-800'
                            : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        Pending
                      </button>
                      <button
                        onClick={() => setPaymentCounterModal((prev) => ({ ...prev, salesInvoiceStatus: 'received' }))}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                          paymentCounterModal.salesInvoiceStatus === 'received'
                            ? 'bg-emerald-200 text-emerald-800'
                            : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        Received
                      </button>
                    </div>
                  </div>

                  {/* Delivery Receipt Status */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Delivery Receipt Status</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setPaymentCounterModal((prev) => ({ ...prev, deliveryReceiptStatus: 'pending' }))}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                          paymentCounterModal.deliveryReceiptStatus === 'pending'
                            ? 'bg-gray-200 text-gray-800'
                            : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        Pending
                      </button>
                      <button
                        onClick={() => setPaymentCounterModal((prev) => ({ ...prev, deliveryReceiptStatus: 'received' }))}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                          paymentCounterModal.deliveryReceiptStatus === 'received'
                            ? 'bg-emerald-200 text-emerald-800'
                            : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        Received
                      </button>
                    </div>
                  </div>

                  {/* Received Date */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Received Date</label>
                    <input
                      type="date"
                      value={paymentCounterModal.receivedDate}
                      onChange={(e) => setPaymentCounterModal((prev) => ({ ...prev, receivedDate: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                    />
                  </div>

                  {/* Delivery Date */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Delivery Date</label>
                    <input
                      type="date"
                      value={paymentCounterModal.deliveryDate}
                      onChange={(e) => setPaymentCounterModal((prev) => ({ ...prev, deliveryDate: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                    />
                  </div>

                  {/* Sales Invoice File Upload */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Upload Sales Invoice</label>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        setPaymentCounterModal((prev) => ({ ...prev, salesInvoiceFile: file }));
                      }}
                      className="w-full text-xs text-gray-500 file:mr-2 file:rounded-lg file:border-0 file:bg-amber-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-amber-700 hover:file:bg-amber-100"
                    />
                    {paymentCounterModal.counter?.sales_invoice_file_id && (
                      <p className="mt-1 text-[10px] text-gray-400">Existing file attached (re-upload to replace)</p>
                    )}
                  </div>

                  {/* Delivery Receipt File Upload */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Upload Delivery Receipt</label>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        setPaymentCounterModal((prev) => ({ ...prev, deliveryReceiptFile: file }));
                      }}
                      className="w-full text-xs text-gray-500 file:mr-2 file:rounded-lg file:border-0 file:bg-amber-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-amber-700 hover:file:bg-amber-100"
                    />
                    {paymentCounterModal.counter?.delivery_receipt_file_id && (
                      <p className="mt-1 text-[10px] text-gray-400">Existing file attached (re-upload to replace)</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-6 py-4">
                  <button
                    onClick={() => setPaymentCounterModal((prev) => ({ ...prev, open: false }))}
                    className="rounded-lg bg-gray-100 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handlePaymentCounterSubmit}
                    disabled={paymentCounterModal.submitting}
                    className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                  >
                    {paymentCounterModal.submitting ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
                    ) : (
                      <><FileText className="h-3.5 w-3.5" /> Save Payment Counter</>
                    )}
                  </button>
                </div>
              </>
            )}
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
          (window as any).__pendingActionOrder = null;
          (window as any).__pendingScheduleData = null;
          (window as any).__pendingPaymentData = null;
          (window as any).__pendingCompleteData = null;
          (window as any).__pendingConfirmPaymentData = null;
          (window as any).__pendingRecordDepositData = null;
        }}
      />

      {/* Confirm Modal (no OTP — just confirm/cancel) */}
      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        description={confirmModal.description}
        onVerified={handleConfirmVerified}
        onClose={() => {
          setConfirmModal({ ...confirmModal, open: false });
          (window as any).__pendingActionOrder = null;
          (window as any).__pendingScheduleData = null;
          (window as any).__pendingPaymentData = null;
          (window as any).__pendingCompleteData = null;
          (window as any).__pendingConfirmPaymentData = null;
          (window as any).__pendingRecordDepositData = null;
          (window as any).__pendingPaymentCounterData = null;
        }}
      />

      {/* Revert OTP Modal */}
      <OtpModal
        open={showRevertOtp}
        title="Stage Revert (OTP Required)"
        description={
          revertTargetOrder
            ? `Revert ${revertTargetOrder.quotation_number ?? 'this order'} to the previous stage? This requires OTP verification.`
            : ''
        }
        onVerified={handleRevertVerified}
        onClose={() => {
          setShowRevertOtp(false);
          setRevertTargetOrder(null);
          setRevertResult(null);
        }}
      />

      {/* Revert result toast */}
      {revertResult && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
          revertResult.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {revertResult.message}
          <button onClick={() => setRevertResult(null)} className="ml-3 text-white/80 hover:text-white">
            <X className="h-4 w-4 inline" />
          </button>
        </div>
      )}

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-xl bg-white p-6 text-center shadow-xl">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-red-500" />
            <p className="text-sm text-gray-600">Deleting order…</p>
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
    </div>
  );
}
