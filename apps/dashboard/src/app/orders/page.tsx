'use client';

import { useState, useRef } from 'react';
import { useOrders } from '@/lib/useApi';
import { STAGE_CONFIG } from '@/lib/api';
import type { Order } from '@/lib/api';
import { updateOrder, deleteOrder, bulkDeleteOrders, createOrder, recordDeposit, recordDepositWithFile, uploadOrderFile, visionExtract } from '@/lib/api';
import OrderTable from '@/components/OrderTable';
import OtpModal from '@/components/OtpModal';
import { FileViewerModal, useOrderFileViewer } from '@/components/OrderFileViewer';
import { X, Check, Plus, Loader2, Trash2, Upload, Sparkles as SparklesIcon } from 'lucide-react';

function NewOrderModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [qn, setQn] = useState('');
  const [clientName, setClientName] = useState('');
  const [salesAgent, setSalesAgent] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOtp, setShowOtp] = useState(false);

  // File upload states
  const [quotationFile, setQuotationFile] = useState<File | null>(null);
  const [orderConfirmFile, setOrderConfirmFile] = useState<File | null>(null);
  const [depositFile, setDepositFile] = useState<File | null>(null);

  // AI extraction states
  const [extractedItems, setExtractedItems] = useState<{ name: string; quantity: number }[]>([]);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositPaidAt, setDepositPaidAt] = useState('');
  const [extractingQuotation, setExtractingQuotation] = useState(false);
  const [extractingDeposit, setExtractingDeposit] = useState(false);
  const [extractResult, setExtractResult] = useState<{ ok: boolean; message: string } | null>(null);

  const quotationFileRef = useRef<HTMLInputElement>(null);
  const orderConfirmFileRef = useRef<HTMLInputElement>(null);
  const depositFileRef = useRef<HTMLInputElement>(null);

  function fileToBase64(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? '');
        const commaIndex = result.indexOf(',');
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(f);
    });
  }

  async function handleQuotationExtract() {
    if (!quotationFile) return;
    setExtractingQuotation(true);
    setExtractResult(null);
    try {
      const base64 = await fileToBase64(quotationFile);
      const res = await visionExtract({ image_base64: base64, mime_type: quotationFile.type, mode: 'quotation' });
      if (res.ok && res.quotation) {
        if (res.quotation.client_name && !clientName) setClientName(res.quotation.client_name);
        if (res.quotation.sales_agent && !salesAgent) setSalesAgent(res.quotation.sales_agent);
        if (res.quotation.total_amount && !totalAmount) setTotalAmount(String(res.quotation.total_amount));
        if (res.quotation.quotation_number && !qn) setQn(res.quotation.quotation_number);
        const items = (res.quotation.items ?? [])
          .filter((i: any) => i?.product_name)
          .map((i: any) => ({ name: i.product_name, quantity: Number(i.quantity ?? 1) }));
        setExtractedItems(items);
        setExtractResult({ ok: true, message: `AI extracted ${items.length} item(s), client, and amount.` });
      } else {
        setExtractResult({ ok: false, message: 'AI could not extract quotation data.' });
      }
    } catch (err: any) {
      setExtractResult({ ok: false, message: err.message ?? 'AI extraction failed' });
    } finally {
      setExtractingQuotation(false);
    }
  }

  async function handleDepositExtract() {
    if (!depositFile) return;
    setExtractingDeposit(true);
    setExtractResult(null);
    try {
      const base64 = await fileToBase64(depositFile);
      const res = await visionExtract({ image_base64: base64, mime_type: depositFile.type, mode: 'payment' });
      if (res.ok && res.payment?.amount) {
        setDepositAmount(String(res.payment.amount));
        if (res.payment.payment_date && !depositPaidAt) setDepositPaidAt(res.payment.payment_date.slice(0, 10));
        setExtractResult({ ok: true, message: `AI extracted deposit: ₱${res.payment.amount.toLocaleString()}` });
      } else {
        setExtractResult({ ok: false, message: 'AI could not extract deposit amount.' });
      }
    } catch (err: any) {
      setExtractResult({ ok: false, message: err.message ?? 'AI extraction failed' });
    } finally {
      setExtractingDeposit(false);
    }
  }

  function handleAddItem() {
    setExtractedItems((prev) => [...prev, { name: '', quantity: 1 }]);
  }

  function handleRemoveItem(idx: number) {
    setExtractedItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleUpdateItem(idx: number, field: 'name' | 'quantity', value: string) {
    setExtractedItems((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: field === 'quantity' ? Math.max(1, parseInt(value, 10) || 1) : value } : item));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!qn.trim()) { setError('Quotation number is required.'); return; }
    setError(null);
    setShowOtp(true);
  }

  async function handleVerified(actionToken: string) {
    setSaving(true);
    setError(null);
    const results: string[] = [];
    try {
      // 1. Create order
      const data: Parameters<typeof createOrder>[0] = { quotation_number: qn.trim(), action_token: actionToken };
      if (clientName.trim()) data.client_name = clientName.trim();
      if (salesAgent.trim()) data.sales_agent = salesAgent.trim();
      if (totalAmount.trim()) data.total_amount = parseFloat(totalAmount.replace(/,/g, ''));
      if (extractedItems.length > 0) data.items = extractedItems;
      await createOrder(data);
      results.push('✅ Order created');

      // 2. Upload files
      if (quotationFile) {
        try {
          const base64 = await fileToBase64(quotationFile);
          await uploadOrderFile({ quotation_number: qn.trim(), file_type: 'quotation', original_filename: quotationFile.name, mime_type: quotationFile.type, file_data: base64 });
          results.push('✅ Quotation file uploaded');
        } catch (err: any) { results.push(`⚠️ Quotation upload failed: ${err.message}`); }
      }
      if (orderConfirmFile) {
        try {
          const base64 = await fileToBase64(orderConfirmFile);
          await uploadOrderFile({ quotation_number: qn.trim(), file_type: 'order_confirmation', original_filename: orderConfirmFile.name, mime_type: orderConfirmFile.type, file_data: base64 });
          results.push('✅ Order confirmation uploaded');
        } catch (err: any) { results.push(`⚠️ Order confirmation upload failed: ${err.message}`); }
      }
      if (depositFile) {
        try {
          const base64 = await fileToBase64(depositFile);
          await uploadOrderFile({ quotation_number: qn.trim(), file_type: 'deposit', original_filename: depositFile.name, mime_type: depositFile.type, file_data: base64 });
          results.push('✅ Deposit proof uploaded');
        } catch (err: any) { results.push(`⚠️ Deposit upload failed: ${err.message}`); }
      }

      // 3. Record deposit if amount provided
      const depositAmt = parseFloat(depositAmount.replace(/,/g, ''));
      if (!isNaN(depositAmt) && depositAmt > 0) {
        try {
          await recordDeposit({ quotation_number: qn.trim(), amount: depositAmt, deposit_paid_at: depositPaidAt || undefined, action_token: actionToken });
          results.push('✅ Deposit recorded');
        } catch (err: any) { results.push(`⚠️ Deposit recording failed: ${err.message}`); }
      }

      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'Failed to create order.');
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-800">New Order</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
          {extractResult && (
            <p className={`rounded-lg px-3 py-2 text-xs ${extractResult.ok ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
              {extractResult.message}
            </p>
          )}

          {/* Basic Info */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Quotation Number <span className="text-red-500">*</span></label>
            <input className={inputCls} placeholder="QTN-2026-001" value={qn} onChange={e => setQn(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Client Name</label>
            <input className={inputCls} placeholder="Juan dela Cruz" value={clientName} onChange={e => setClientName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Sales Agent</label>
            <input className={inputCls} placeholder="Agent name" value={salesAgent} onChange={e => setSalesAgent(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Total Amount (₱)</label>
            <input className={inputCls} placeholder="20000" value={totalAmount} onChange={e => setTotalAmount(e.target.value.replace(/[^0-9.,]/g, ''))} />
          </div>

          {/* Quotation File */}
          <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3 space-y-2">
            <label className="text-xs font-medium text-gray-700">📄 Quotation File</label>
            <div className="flex gap-2">
              <input ref={quotationFileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => setQuotationFile(e.target.files?.[0] ?? null)} />
              <button type="button" onClick={() => quotationFileRef.current?.click()} className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-600 hover:bg-gray-50">
                {quotationFile ? quotationFile.name : 'Choose file'}
              </button>
              {quotationFile && (
                <button type="button" onClick={handleQuotationExtract} disabled={extractingQuotation} className="flex items-center gap-1 rounded-lg bg-purple-50 px-3 py-2 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50">
                  {extractingQuotation ? <Loader2 className="h-3 w-3 animate-spin" /> : <SparklesIcon className="h-3 w-3" />}
                  AI Extract
                </button>
              )}
            </div>

            {/* Extracted Items */}
            {extractedItems.length > 0 && (
              <div className="space-y-1 pt-1">
                <p className="text-[10px] font-medium text-gray-500">Extracted Items</p>
                {extractedItems.map((item, idx) => (
                  <div key={idx} className="flex gap-2">
                    <input className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs" placeholder="Item name" value={item.name} onChange={e => handleUpdateItem(idx, 'name', e.target.value)} />
                    <input className="w-16 rounded border border-gray-300 px-2 py-1 text-xs" type="number" min={1} value={item.quantity} onChange={e => handleUpdateItem(idx, 'quantity', e.target.value)} />
                    <button type="button" onClick={() => handleRemoveItem(idx)} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={handleAddItem} className="flex items-center gap-1 text-[10px] font-medium text-[#2490ef] hover:underline">
                  <Plus className="h-3 w-3" /> Add item
                </button>
              </div>
            )}
          </div>

          {/* Order Confirmation File */}
          <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3 space-y-2">
            <label className="text-xs font-medium text-gray-700">📝 Order Confirmation</label>
            <div className="flex gap-2">
              <input ref={orderConfirmFileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => setOrderConfirmFile(e.target.files?.[0] ?? null)} />
              <button type="button" onClick={() => orderConfirmFileRef.current?.click()} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-600 hover:bg-gray-50">
                {orderConfirmFile ? orderConfirmFile.name : 'Choose file'}
              </button>
            </div>
          </div>

          {/* Deposit Proof */}
          <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3 space-y-2">
            <label className="text-xs font-medium text-gray-700">💰 Downpayment Deposit</label>
            <div className="flex gap-2">
              <input ref={depositFileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => setDepositFile(e.target.files?.[0] ?? null)} />
              <button type="button" onClick={() => depositFileRef.current?.click()} className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-600 hover:bg-gray-50">
                {depositFile ? depositFile.name : 'Choose file'}
              </button>
              {depositFile && (
                <button type="button" onClick={handleDepositExtract} disabled={extractingDeposit} className="flex items-center gap-1 rounded-lg bg-purple-50 px-3 py-2 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50">
                  {extractingDeposit ? <Loader2 className="h-3 w-3 animate-spin" /> : <SparklesIcon className="h-3 w-3" />}
                  AI Extract
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <label className="text-[10px] font-medium text-gray-500">Amount (₱)</label>
                <input className={inputCls} placeholder="10000" value={depositAmount} onChange={e => setDepositAmount(e.target.value.replace(/[^0-9.,]/g, ''))} />
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-[10px] font-medium text-gray-500">Date</label>
                <input className={inputCls} type="date" value={depositPaidAt} onChange={e => setDepositPaidAt(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#2490ef] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a7ad9] disabled:opacity-50">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Order
            </button>
          </div>
        </form>
      </div>
      {showOtp && (
        <OtpModal
          open={showOtp}
          title="Create Order"
          description={`You are about to create a new order "${qn}" with files. Enter the OTP sent to your email to confirm.`}
          onVerified={handleVerified}
          onClose={() => setShowOtp(false)}
        />
      )}
    </div>
  );
}

function EditForm({ order, onSave, onCancel, saving }: {
  order: Order;
  onSave: (data: { client_name?: string; sales_agent?: string; total_amount?: number; quotation_number?: string }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
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

export default function OrdersPage() {
  const { data: orders = [], error, isLoading, mutate } = useOrders();
  const [filter, setFilter] = useState<string>('all');
  const [showNewOrder, setShowNewOrder] = useState(false);

  const { viewingFilesOrder, orderFiles, handleViewFiles, refreshFiles, closeViewer } = useOrderFileViewer();

  // Edit state
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deletingOrder, setDeletingOrder] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Deposit modal state
  const [depositOrder, setDepositOrder] = useState<Order | null>(null);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositFile, setDepositFile] = useState<File | null>(null);
  const [depositRecording, setDepositRecording] = useState(false);
  const [depositExtracting, setDepositExtracting] = useState(false);
  const [depositResult, setDepositResult] = useState<{ ok: boolean; message: string } | null>(null);
  const depositFileRef = useRef<HTMLInputElement>(null);

  async function depositFileToBase64(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? '');
        const commaIndex = result.indexOf(',');
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(f);
    });
  }

  function handleRecordDepositClick(order: Order) {
    setDepositOrder(order);
    setDepositAmount('');
    setDepositFile(null);
    setDepositResult(null);
  }

  async function handleDepositExtractAI() {
    if (!depositFile) return;
    setDepositExtracting(true);
    setDepositResult(null);
    try {
      const base64 = await depositFileToBase64(depositFile);
      const res = await visionExtract({ image_base64: base64, mime_type: depositFile.type, mode: 'payment' });
      if (res.ok && res.payment?.amount) {
        setDepositAmount(String(res.payment.amount));
        setDepositResult({ ok: true, message: `AI extracted: ₱${res.payment.amount.toLocaleString()}` });
      } else {
        setDepositResult({ ok: false, message: 'AI could not extract amount. Enter manually.' });
      }
    } catch (err: any) {
      setDepositResult({ ok: false, message: err.message ?? 'AI extraction failed' });
    } finally {
      setDepositExtracting(false);
    }
  }

  // Deposit OTP state
  const [depositOtpOpen, setDepositOtpOpen] = useState(false);

  function handleDepositSubmit() {
    if (!depositOrder) return;
    const parsed = parseFloat(depositAmount);
    if (isNaN(parsed) || parsed <= 0) {
      setDepositResult({ ok: false, message: 'Enter a valid amount.' });
      return;
    }
    // Open OTP modal to verify action before recording deposit
    setDepositOtpOpen(true);
  }

  async function handleDepositVerified(actionToken: string) {
    if (!depositOrder) return;
    const parsed = parseFloat(depositAmount);
    setDepositRecording(true);
    setDepositResult(null);
    try {
      let imageBase64: string | undefined;
      let mimeType: string | undefined;
      let originalFilename: string | undefined;
      if (depositFile) {
        imageBase64 = await depositFileToBase64(depositFile);
        mimeType = depositFile.type;
        originalFilename = depositFile.name;
      }
      await recordDepositWithFile({
        quotation_number: depositOrder.quotation_number ?? '',
        amount: parsed,
        updated_by: 'dashboard_quick_action',
        image_base64: imageBase64,
        mime_type: mimeType,
        original_filename: originalFilename,
        action_token: actionToken,
      });
      setDepositResult({ ok: true, message: `✅ Deposit of ₱${parsed.toLocaleString()} recorded!` });
      setTimeout(() => {
        setDepositOrder(null);
        mutate();
      }, 1500);
    } catch (err: any) {
      setDepositResult({ ok: false, message: err.message ?? 'Failed to record deposit' });
    } finally {
      setDepositRecording(false);
    }
  }

  // OTP modal state
  const [otpModal, setOtpModal] = useState<{
    open: boolean;
    title: string;
    description: string;
    pendingAction: 'edit' | 'delete' | 'bulk-delete';
  }>({ open: false, title: '', description: '', pendingAction: 'edit' });

  const filtered = filter === 'all' ? orders : orders.filter((o) => o.current_stage === filter);

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
      mutate();
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
      mutate();
    } catch (err: any) {
      alert('Failed to delete order: ' + (err.message ?? 'Unknown error'));
    } finally {
      setDeleting(false);
    }
  }

  // ── Bulk selection handlers ──
  function handleSelect(id: string, selected: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function handleSelectAll(selected: boolean) {
    if (selected) {
      setSelectedIds(new Set(filtered.map((o) => o.id)));
    } else {
      setSelectedIds(new Set());
    }
  }

  function handleBulkDeleteClick() {
    if (selectedIds.size === 0) return;
    const names = filtered
      .filter((o) => selectedIds.has(o.id))
      .map((o) => o.quotation_number ?? o.id)
      .slice(0, 5)
      .join(', ');
    const more = selectedIds.size > 5 ? ` and ${selectedIds.size - 5} more` : '';
    setOtpModal({
      open: true,
      title: 'Bulk Delete Orders',
      description: `You are about to permanently delete ${selectedIds.size} order(s): ${names}${more}. This will also remove all stage updates, files, and reminders. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'bulk-delete',
    });
  }

  async function handleBulkDeleteVerified(actionToken: string) {
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      await bulkDeleteOrders(ids, actionToken);
      setSelectedIds(new Set());
      mutate();
    } catch (err: any) {
      alert('Failed to delete orders: ' + (err.message ?? 'Unknown error'));
    } finally {
      setBulkDeleting(false);
    }
  }

  function handleOtpVerified(actionToken: string) {
    if (otpModal.pendingAction === 'edit') {
      handleEditVerified(actionToken);
    } else if (otpModal.pendingAction === 'delete') {
      handleDeleteVerified(actionToken);
    } else if (otpModal.pendingAction === 'bulk-delete') {
      handleBulkDeleteVerified(actionToken);
    }
  }

  if (isLoading && orders.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            filter === 'all' ? 'bg-[#2490ef] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
          }`}
        >
          All ({orders.length})
        </button>
        <button
          onClick={() => setFilter('active')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            filter === 'active' ? 'bg-[#2490ef] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
          }`}
        >
          Active ({orders.filter((o) => o.status === 'active').length})
        </button>
        <button
          onClick={() => setFilter('completed')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            filter === 'completed' ? 'bg-[#2490ef] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
          }`}
        >
          Completed ({orders.filter((o) => o.current_stage === 'completed').length})
        </button>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-2.5">
          <span className="text-sm font-medium text-red-700">
            {selectedIds.size} order{selectedIds.size > 1 ? 's' : ''} selected
          </span>
          <button
            onClick={handleBulkDeleteClick}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete Selected
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-800">All Orders</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">{filtered.length} orders</span>
            <button
              onClick={() => setShowNewOrder(true)}
              className="flex items-center gap-1.5 rounded-lg bg-[#2490ef] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1a7ad9]"
            >
              <Plus className="h-3.5 w-3.5" />
              New Order
            </button>
          </div>
        </div>
        <OrderTable
          orders={filtered}
          onEdit={handleEdit}
          onDelete={handleDeleteClick}
          onViewFiles={handleViewFiles}
          onRecordDeposit={handleRecordDepositClick}
          selectable
          selectedIds={selectedIds}
          onSelect={handleSelect}
          onSelectAll={handleSelectAll}
        />
        {editingOrder && (
          <EditForm
            order={editingOrder}
            onSave={handleEditSave}
            onCancel={handleCancelEdit}
            saving={saving}
          />
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

      {/* New Order Modal */}
      {showNewOrder && (
        <NewOrderModal onClose={() => setShowNewOrder(false)} onCreated={() => mutate()} />
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

      {/* Bulk deleting overlay */}
      {bulkDeleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-xl bg-white p-6 text-center shadow-xl">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-red-500" />
            <p className="text-sm text-gray-600">Deleting {selectedIds.size} orders...</p>
          </div>
        </div>
      )}

      {/* File Viewer Modal */}
      {viewingFilesOrder && (
        <FileViewerModal
          order={viewingFilesOrder}
          files={orderFiles}
          onClose={closeViewer}
          onUploadComplete={refreshFiles}
        />
      )}

      {/* Deposit Modal */}
      {depositOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-base font-semibold text-gray-800">
                Record Deposit — {depositOrder.quotation_number ?? '—'}
              </h2>
              <button
                onClick={() => setDepositOrder(null)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              {/* File upload */}
              <div>
                <label className="text-xs font-medium text-gray-600">Deposit Slip (JPEG/PDF) — optional</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    ref={depositFileRef}
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setDepositFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-xs text-gray-600 file:mr-2 file:rounded file:border-0 file:bg-blue-100 file:px-2 file:py-1 file:text-xs file:font-medium file:text-blue-700 hover:file:bg-blue-200"
                  />
                  {depositFile && (
                    <button
                      onClick={handleDepositExtractAI}
                      disabled={depositExtracting}
                      className="flex items-center gap-1 rounded bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-200 disabled:opacity-50"
                    >
                      {depositExtracting ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <SparklesIcon className="h-3 w-3" />
                      )}
                      AI Extract
                    </button>
                  )}
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="text-xs font-medium text-gray-600">Amount (₱)</label>
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="e.g. 5000"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
                />
              </div>

              {/* Result */}
              {depositResult && (
                <p className={`text-xs font-medium ${depositResult.ok ? 'text-green-700' : 'text-red-600'}`}>
                  {depositResult.message}
                </p>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setDepositOrder(null)}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDepositSubmit}
                  disabled={depositRecording || !depositAmount}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#2490ef] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a7ad9] disabled:opacity-50"
                >
                  {depositRecording ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {depositRecording ? 'Recording...' : 'Record Deposit'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Deposit OTP Modal */}
      <OtpModal
        open={depositOtpOpen}
        title="Verify Deposit Recording"
        description={depositOrder ? `You are about to record a downpayment of ₱${parseFloat(depositAmount || '0').toLocaleString()} for order "${depositOrder.quotation_number ?? '—'}". Enter the code sent to your Telegram or email to confirm.` : ''}
        onVerified={(token) => {
          setDepositOtpOpen(false);
          handleDepositVerified(token);
        }}
        onClose={() => setDepositOtpOpen(false)}
      />
    </div>
  );
}
