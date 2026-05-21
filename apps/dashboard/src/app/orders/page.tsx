'use client';

import { useState } from 'react';
import { useOrders } from '@/lib/useApi';
import { STAGE_CONFIG } from '@/lib/api';
import type { Order } from '@/lib/api';
import { updateOrder, deleteOrder, bulkDeleteOrders, createOrder } from '@/lib/api';
import OrderTable from '@/components/OrderTable';
import OtpModal from '@/components/OtpModal';
import { X, Check, Plus, Loader2, Trash2 } from 'lucide-react';

function NewOrderModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [qn, setQn] = useState('');
  const [clientName, setClientName] = useState('');
  const [salesAgent, setSalesAgent] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!qn.trim()) { setError('Quotation number is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      const data: Parameters<typeof createOrder>[0] = { quotation_number: qn.trim() };
      if (clientName.trim()) data.client_name = clientName.trim();
      if (salesAgent.trim()) data.sales_agent = salesAgent.trim();
      if (totalAmount.trim()) data.total_amount = parseFloat(totalAmount.replace(/,/g, ''));
      await createOrder(data);
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
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-800">New Order</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
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

  // Edit state
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deletingOrder, setDeletingOrder] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

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
    </div>
  );
}
