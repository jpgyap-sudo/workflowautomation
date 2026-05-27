'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useOrdersByStage } from '@/lib/useApi';
import type { Order, Client } from '@/lib/api';
import { updateOrder, deleteOrder, payBalance, payBalanceWithFileBulk, visionExtract, recordStageUpdate, getOrderPayments, searchClients, getDeliveryProgress, partialDelivery, type DeliveryProgressItem, type DeliveryProgressSummary } from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import OtpModal from '@/components/OtpModal';
import { QuotationNumberCell, FileViewerModal, useOrderFileViewer } from '@/components/OrderFileViewer';
import { Truck, Calendar, CheckCircle2, Scale, Pencil, Trash2, X, Check, MapPin, Phone, UserCheck, ShieldAlert, DollarSign, PackageCheck, PackageOpen, Clock, ThumbsUp, CreditCard, Send, Upload, FileText, Loader2, Search, XCircle, Package, ListChecks } from 'lucide-react';

interface EditFormProps {
  order: Order;
  onSave: (data: { client_name?: string; sales_agent?: string; total_amount?: number; quotation_number?: string }) => void;
  onCancel: () => void;
  saving: boolean;
}

interface ScheduleFormProps {
  order: Order;
  value: string;
  remarks: string;
  onValueChange: (value: string) => void;
  onRemarksChange: (value: string) => void;
  onSave: () => void;
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

function ScheduleForm({ order, value, remarks, onValueChange, onRemarksChange, onSave, onCancel, saving }: ScheduleFormProps) {
  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 bg-purple-50/50 px-6 py-3">
      <div>
        <label className="mb-1 block text-[11px] font-medium text-purple-700">Delivery date & time</label>
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className="rounded-lg border border-purple-200 px-3 py-1.5 text-xs outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
        />
      </div>
      <div className="min-w-[220px] flex-1">
        <label className="mb-1 block text-[11px] font-medium text-purple-700">Remarks</label>
        <input
          value={remarks}
          onChange={(e) => onRemarksChange(e.target.value)}
          placeholder="Optional remarks"
          className="w-full rounded-lg border border-purple-200 px-3 py-1.5 text-xs outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
        />
      </div>
      <button
        type="button"
        onClick={onSave}
        disabled={saving || !value.trim()}
        className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save Schedule'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg bg-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-300"
      >
        Cancel
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

export default function DeliveryPage() {
  const { data: inventoryArrivedOrders = [], isLoading: loadingInventory, mutate: mutateInventory } = useOrdersByStage('inventory_arrived');
  const { data: balanceDueOrders = [], isLoading: loadingBalanceDue, mutate: mutateBalanceDue } = useOrdersByStage('balance_due');
  const { data: balanceVerificationOrders = [], isLoading: loadingBalanceVerification, mutate: mutateBalanceVerification } = useOrdersByStage('balance_verification');
  const { data: pendingOrders = [], isLoading: loadingPending, mutate: mutatePending } = useOrdersByStage('delivery_pending');
  const { data: scheduledOrders = [], isLoading: loadingScheduled, mutate: mutateScheduled } = useOrdersByStage('delivery_scheduled');
  const { data: deliveredOrders = [], isLoading: loadingDelivered, mutate: mutateDelivered } = useOrdersByStage('delivered');
  const { data: paymentReceivedOrders = [], isLoading: loadingPaymentReceived, mutate: mutatePaymentReceived } = useOrdersByStage('payment_received');
  const { data: paymentConfirmedOrders = [], isLoading: loadingPaymentConfirmed, mutate: mutatePaymentConfirmed } = useOrdersByStage('payment_confirmed');
  const { data: stockPrepOrders = [], isLoading: loadingStockPrep, mutate: mutateStockPrep } = useOrdersByStage('stock_preparation');

  const loading = loadingInventory && loadingBalanceDue && loadingBalanceVerification && loadingPending && loadingScheduled && loadingDelivered && loadingPaymentReceived && loadingPaymentConfirmed && loadingStockPrep;

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
    pendingAction: 'edit' | 'delete' | 'mark_delivered' | 'mark_countered' | 'advance_balance_due' | 'schedule_delivery' | 'cancel_schedule' | 'record_payment' | 'complete_directly' | 'verify_balance' | 'advance_payment_received' | 'advance_payment_confirmed' | 'mark_payment_received' | 'mark_payment_confirmed' | 'confirmPayment' | 'partial_delivery';
  }>({ open: false, title: '', description: '', pendingAction: 'edit' });

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
    mutateInventory(); mutateBalanceDue(); mutateBalanceVerification(); mutatePending(); mutateScheduled(); mutateDelivered(); mutatePaymentReceived(); mutatePaymentConfirmed(); mutateStockPrep();
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
    setOtpModal({
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
    setOtpModal({
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
    setOtpModal({
      open: true,
      title: 'Schedule Delivery',
      description: `Confirm the delivery schedule for "${order.quotation_number ?? '-'}". Enter the OTP sent to your email to continue.`,
      pendingAction: 'schedule_delivery',
    });
  }

  async function handleScheduleVerified(actionToken: string) {
    const pending = (window as any).__pendingScheduleData as
      | { order: Order; delivery_date: string; remarks: string }
      | undefined;
    if (!pending) return;

    const { order, delivery_date, remarks } = pending;

    setActionLoading(order.id);
    try {
      await recordStageUpdate({
        quotation_number: order.quotation_number ?? '',
        stage: 'delivery_scheduled',
        status: 'scheduled',
        remarks: remarks || delivery_date,
        delivery_date,
        action_token: actionToken,
      });
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
    setOtpModal({
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
    setOtpModal({
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
      await recordStageUpdate({
        quotation_number: order.quotation_number ?? '',
        stage: 'completed',
        status: 'auto_completed',
        remarks: 'Balance already paid — auto-completed on delivery (steps 14-16 N/A)',
        action_token: actionToken,
      });
      mutateDelivered();
    } catch (err: any) {
      alert('Failed to complete order: ' + (err.message ?? 'Unknown error'));
    } finally {
      setActionLoading(null);
    }
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
    setOtpModal({
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
    setOtpModal({
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
    setOtpModal({
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
    (window as any).__pendingActionOrder = order;
    setOtpModal({
      open: true,
      title: 'Advance to Payment Confirmed',
      description: `Confirm payment for "${order.quotation_number ?? '—'}" and advance from Payment Received to Payment Confirmed.`,
      pendingAction: 'advance_payment_received',
    });
  }

  async function executeAdvancePaymentReceived(order: Order, actionToken: string) {
    setActionLoading(order.id);
    try {
      await recordStageUpdate({
        quotation_number: order.quotation_number ?? '',
        stage: 'payment_confirmed',
        status: 'auto_advanced',
        remarks: 'Payment confirmed — advancing from payment received',
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
    setOtpModal({
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

  function handleOtpVerified(actionToken: string) {
    const order = (window as any).__pendingActionOrder as Order | undefined;
    if (otpModal.pendingAction === 'edit') { handleEditVerified(actionToken); return; }
    if (otpModal.pendingAction === 'delete') { handleDeleteVerified(actionToken); return; }
    if (otpModal.pendingAction === 'schedule_delivery') { handleScheduleVerified(actionToken); return; }
    if (otpModal.pendingAction === 'record_payment') { executeConfirmPayment(actionToken); return; }
    if (otpModal.pendingAction === 'confirmPayment') { executeConfirmPayment(actionToken); return; }
    if (otpModal.pendingAction === 'complete_directly') {
      const pending = (window as any).__pendingCompleteData as { order: Order } | undefined;
      if (pending) executeCompleteDirectly(pending.order, actionToken);
      return;
    }
    if (otpModal.pendingAction === 'partial_delivery') { handlePartialDeliveryOtp(actionToken); return; }
    if (!order) return;
    if (otpModal.pendingAction === 'mark_delivered') executeMarkDelivered(order, actionToken);
    else if (otpModal.pendingAction === 'mark_countered') executeMarkCountered(order, actionToken);
    else if (otpModal.pendingAction === 'advance_balance_due') executeAdvanceBalanceDue(order, actionToken);
    else if (otpModal.pendingAction === 'cancel_schedule') executeCancelSchedule(order, actionToken);
    else if (otpModal.pendingAction === 'verify_balance') executeVerifyBalance(order, actionToken);
    else if (otpModal.pendingAction === 'mark_payment_received') executeMarkPaymentReceived(order, actionToken);
    else if (otpModal.pendingAction === 'mark_payment_confirmed') executeMarkPaymentConfirmed(order, actionToken);
    else if (otpModal.pendingAction === 'advance_payment_received') executeAdvancePaymentReceived(order, actionToken);
    else if (otpModal.pendingAction === 'advance_payment_confirmed') executeAdvancePaymentConfirmed(order, actionToken);
    (window as any).__pendingActionOrder = null;
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
            .filter((item) => !item.fully_delivered && item.verified_qty > 0)
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

  function handlePartialDeliveryOtp(actionToken: string) {
    const modal = partialDeliveryModal;
    if (!modal.order || modal.selectedItemIds.size === 0) return;
    executePartialDelivery(modal.order, Array.from(modal.selectedItemIds), modal.deliveryNote, actionToken);
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

  // ── Shared row actions (edit + delete buttons) ─────────────────────────

  function RowActions({ order }: { order: Order }) {
    return (
      <div className="flex items-center gap-1">
        <button onClick={() => setEditingOrder(order)}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#2490ef]" title="Edit order">
          <Pencil className="h-4 w-4" />
        </button>
        <button onClick={() => handleDeleteClick(order)}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500" title="Delete order">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // ── Apply client filter ──────────────────────────────────────────────
  const filteredInventoryArrivedOrders = filterByClient(inventoryArrivedOrders);
  const filteredBalanceDueOrders = filterByClient(balanceDueOrders);
  const filteredBalanceVerificationOrders = filterByClient(balanceVerificationOrders);
  const filteredPendingOrders = filterByClient(pendingOrders);
  const filteredScheduledOrders = filterByClient(scheduledOrders);
  const filteredDeliveredOrders = filterByClient(deliveredOrders);
  const filteredPaymentReceivedOrders = filterByClient(paymentReceivedOrders);
  const filteredPaymentConfirmedOrders = filterByClient(paymentConfirmedOrders);
  const filteredStockPrepOrders = filterByClient(stockPrepOrders);

  if (loading && inventoryArrivedOrders.length === 0 && balanceDueOrders.length === 0 && balanceVerificationOrders.length === 0 && pendingOrders.length === 0 && scheduledOrders.length === 0 && deliveredOrders.length === 0 && paymentReceivedOrders.length === 0 && paymentConfirmedOrders.length === 0) {
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
                      {order.partial_delivery && (
                        <button
                          onClick={() => handleOpenPartialDelivery(order)}
                          disabled={actionLoading === order.id}
                          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-40"
                          title="Record partial delivery of verified items"
                        >
                          {actionLoading === order.id ? '…' : <><Package className="mr-1 inline h-3 w-3" />Partial Delivery</>}
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
                      <RowActions order={order} />
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
                      <button
                        onClick={() => handleAdvanceBalanceDue(order)}
                        disabled={actionLoading === order.id}
                        className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-40"
                        title="Advance to Balance Due"
                      >
                        {actionLoading === order.id ? '…' : 'Balance Due →'}
                      </button>
                      <RowActions order={order} />
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
                      <RowActions order={order} />
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
                      <RowActions order={order} />
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

      {/* ── Delivery Pending ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <Clock className="h-4 w-4 text-amber-500" />
          <h2 className="text-base font-semibold text-gray-800">Delivery Pending</h2>
          <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            {filteredPendingOrders.length}
          </span>
        </div>
        {filteredPendingOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No orders pending delivery scheduling</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredPendingOrders.map((order) => {
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
                          Total: ₱{totalAmount.toLocaleString()} | Balance: {order.balance_paid ? '✅ Paid' : `₱${balance.toLocaleString()}`}
                        </p>
                      )}
                      {hasException && order.delivery_exception_notes && (
                        <p className="mt-0.5 text-[11px] italic text-amber-600">Exception: {order.delivery_exception_notes}</p>
                      )}
                      <DeliveryInfo order={order} />
                    </div>
                    <div className="flex items-center gap-3">
                      <StageBadge stage={order.current_stage} />
                      <button
                        onClick={() => handleOpenSchedule(order)}
                        disabled={actionLoading === order.id}
                        className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-40"
                        title="Schedule delivery"
                      >
                        {actionLoading === order.id ? '…' : 'Schedule Delivery'}
                      </button>
                      <RowActions order={order} />
                    </div>
                  </div>
                  {editingOrder?.id === order.id && (
                    <EditForm order={order} onSave={handleEditSave} onCancel={() => setEditingOrder(null)} saving={saving} />
                  )}
                  {schedulingOrder?.id === order.id && (
                    <ScheduleForm
                      order={order}
                      value={scheduleDate}
                      remarks={scheduleRemarks}
                      onValueChange={setScheduleDate}
                      onRemarksChange={setScheduleRemarks}
                      onSave={() => handleScheduleSubmit(order)}
                      onCancel={() => setSchedulingOrder(null)}
                      saving={actionLoading === order.id}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Scheduled Deliveries ──────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <Calendar className="h-4 w-4 text-purple-500" />
          <h2 className="text-base font-semibold text-gray-800">Scheduled Deliveries</h2>
          <span className="ml-auto rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
            {filteredScheduledOrders.length}
          </span>
        </div>
        {filteredScheduledOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No scheduled deliveries</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredScheduledOrders.map((order) => {
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
                          Total: ₱{totalAmount.toLocaleString()} | Balance: {order.balance_paid ? '✅ Paid' : `₱${balance.toLocaleString()}`}
                        </p>
                      )}
                      {order.delivery_date ? (
                        <p className="mt-0.5 text-xs font-medium text-purple-700">
                          Scheduled for: {formatDeliveryDate(order.delivery_date) ?? order.delivery_date}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-xs font-medium text-amber-600">
                          Schedule missing - set the delivery date/time before dispatch.
                        </p>
                      )}
                      {hasException && order.delivery_exception_notes && (
                        <p className="mt-0.5 text-[11px] italic text-amber-600">Exception: {order.delivery_exception_notes}</p>
                      )}
                      <DeliveryInfo order={order} />
                    </div>
                    <div className="flex items-center gap-3">
                      <StageBadge stage={order.current_stage} />
                      <button
                        onClick={() => handleOpenSchedule(order)}
                        disabled={actionLoading === order.id}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-50 disabled:opacity-40"
                        title='Schedule delivery'
                      >
                        Schedule
                      </button>
                      <button
                        onClick={() => handleCancelSchedule(order)}
                        disabled={actionLoading === order.id}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-40"
                        title="Cancel schedule"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleMarkDelivered(order)}
                        disabled={actionLoading === order.id}
                        className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
                        title="Mark as delivered"
                      >
                        <PackageCheck className="h-4 w-4" />
                      </button>
                      <RowActions order={order} />
                    </div>
                  </div>
                  {editingOrder?.id === order.id && (
                    <EditForm order={order} onSave={handleEditSave} onCancel={() => setEditingOrder(null)} saving={saving} />
                  )}
                  {schedulingOrder?.id === order.id && (
                    <ScheduleForm
                      order={order}
                      value={scheduleDate}
                      remarks={scheduleRemarks}
                      onValueChange={setScheduleDate}
                      onRemarksChange={setScheduleRemarks}
                      onSave={() => handleScheduleSubmit(order)}
                      onCancel={() => setSchedulingOrder(null)}
                      saving={actionLoading === order.id}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Delivered ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <CheckCircle2 className="h-4 w-4 text-orange-500" />
          <h2 className="text-base font-semibold text-gray-800">Delivered</h2>
          <span className="ml-auto rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
            {filteredDeliveredOrders.length}
          </span>
        </div>
        {filteredDeliveredOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No delivered orders</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredDeliveredOrders.map((order) => {
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
                          Total: ₱{totalAmount.toLocaleString()} | Balance: {order.balance_paid ? '✅ Paid' : `₱${balance.toLocaleString()} unpaid`}
                        </p>
                      )}
                      {order.delivery_date && (
                        <p className="mt-0.5 text-xs text-gray-400">
                          Scheduled delivery date: {formatDeliveryDate(order.delivery_date) ?? order.delivery_date}
                        </p>
                      )}
                      <DeliveryInfo order={order} />
                    </div>
                    <div className="flex items-center gap-3">
                      <StageBadge stage={order.current_stage} />
                      {order.balance_paid ? (
                        <button
                          onClick={() => {
                            if (!confirm(`Balance already paid. Mark "${order.quotation_number ?? '—'}" as Completed?`)) return;
                            (window as any).__pendingCompleteData = { order };
                            setOtpModal({
                              open: true,
                              title: 'Complete Order',
                              description: `Confirm completion of "${order.quotation_number ?? '—'}" (balance already paid).`,
                              pendingAction: 'complete_directly',
                            });
                          }}
                          disabled={actionLoading === order.id}
                          className="rounded-lg p-1.5 text-green-600 hover:bg-green-50 disabled:opacity-40"
                          title="Balance already paid — complete directly (steps 14-16 N/A)"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => handleMarkPaymentReceived(order)}
                            disabled={actionLoading === order.id}
                            className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50 disabled:opacity-40"
                            title="Mark payment received"
                          >
                            <CreditCard className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleMarkPaymentConfirmed(order)}
                            disabled={actionLoading === order.id}
                            className="rounded-lg p-1.5 text-indigo-600 hover:bg-indigo-50 disabled:opacity-40"
                            title="Mark payment confirmed"
                          >
                            <ThumbsUp className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleMarkCountered(order)}
                            disabled={actionLoading === order.id}
                            className="rounded-lg p-1.5 text-orange-600 hover:bg-orange-50 disabled:opacity-40"
                            title="Mark as countered (awaiting payment)"
                          >
                            <DollarSign className="h-4 w-4" />
                          </button>
                        </>
                      )}
                      <RowActions order={order} />
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
                      <RowActions order={order} />
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
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                        title="Complete order"
                      >
                        {actionLoading === order.id ? '…' : 'Complete →'}
                      </button>
                      <RowActions order={order} />
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
                        const canDeliver = !item.fully_delivered && item.verified_qty > 0;
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
                      setOtpModal({
                        open: true,
                        title: 'Record Partial Delivery',
                        description: `Deliver ${partialDeliveryModal.selectedItemIds.size} selected item(s) for #${partialDeliveryModal.order?.quotation_number ?? '—'}.`,
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
        }}
      />

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
