'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useOrdersByStage } from '@/lib/useApi';
import type { Order } from '@/lib/api';
import { updateOrder, deleteOrder, bulkDeleteOrders, revertStage, generateActionToken } from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import OtpModal from '@/components/OtpModal';
import ConfirmModal from '@/components/ConfirmModal';
import { QuotationNumberCell, FileViewerModal, useOrderFileViewer } from '@/components/OrderFileViewer';
import { ArrowLeft, CheckCircle2, MapPin, Phone, UserCheck, Pencil, Trash2, ArrowLeft as ArrowLeftIcon, Loader2, Search, X, CheckSquare, Square, Trash as TrashIcon } from 'lucide-react';

export default function CompletedOrdersPage() {
  const { data: completedOrders = [], isLoading, mutate } = useOrdersByStage('completed');

  // ── Selection state ──────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filteredOrders.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredOrders.map(o => o.id)));
    }
  }

  const selectedCount = selectedIds.size;

  // ── Edit state ──────────────────────────────────────────────────────
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    client_name: '',
    sales_agent: '',
    total_amount: '',
    quotation_number: '',
  });

  // ── Delete state (single) ────────────────────────────────────────────
  const [deletingOrder, setDeletingOrder] = useState<Order | null>(null);

  // ── Bulk delete state ────────────────────────────────────────────────
  const [showBulkDeleteOtp, setShowBulkDeleteOtp] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // ── Revert state ────────────────────────────────────────────────────
  const [revertTargetOrder, setRevertTargetOrder] = useState<Order | null>(null);
  const [showRevertOtp, setShowRevertOtp] = useState(false);
  const [revertResult, setRevertResult] = useState<{ ok: boolean; message: string } | null>(null);

  // ── OTP / Confirm modals ────────────────────────────────────────────
  const [otpModal, setOtpModal] = useState<{
    open: boolean;
    title: string;
    description: string;
    pendingAction: 'edit' | 'delete' | 'bulk-delete';
  }>({ open: false, title: '', description: '', pendingAction: 'edit' });

  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    description: string;
  }>({ open: false, title: '', description: '' });

  const { viewingFilesOrder, orderFiles, handleViewFiles, closeViewer } = useOrderFileViewer();

  // ── Search / filter ─────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');

  const filteredOrders = searchQuery.trim()
    ? completedOrders.filter(o =>
        o.quotation_number?.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
        o.client_name?.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
        o.sales_agent?.toLowerCase().includes(searchQuery.trim().toLowerCase())
      )
    : completedOrders;

  // ── Helpers ─────────────────────────────────────────────────────────
  function formatDate(value?: string | null) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString('en-PH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function DeliveryInfo({ order }: { order: Order }) {
    if (!order.delivery_address && !order.contact_number && !order.authorized_receiver_name && !order.authorized_receiver_contact) return null;
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-purple-700">
        {order.delivery_address && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{order.delivery_address}</span>}
        {order.contact_number && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{order.contact_number}</span>}
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

  function RowActions({ order }: { order: Order }) {
    return (
      <div className="flex items-center gap-1">
        <button onClick={() => handleRevertClick(order)}
          className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600" title="Revert stage (OTP required)">
          <ArrowLeftIcon className="h-4 w-4" />
        </button>
        <button onClick={() => handleEditClick(order)}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[var(--primary)]" title="Edit order">
          <Pencil className="h-4 w-4" />
        </button>
        <button onClick={() => handleDeleteClick(order)}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500" title="Delete order">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // ── Edit handlers ───────────────────────────────────────────────────
  function handleEditClick(order: Order) {
    setEditingOrder(order);
    setEditForm({
      client_name: order.client_name ?? '',
      sales_agent: order.sales_agent ?? '',
      total_amount: order.total_amount?.toString() ?? '',
      quotation_number: order.quotation_number ?? '',
    });
  }

  async function handleEditSave() {
    if (!editingOrder) return;
    setSaving(true);
    try {
      const tokenResult = await generateActionToken('system', 'dashboard');
      if (!tokenResult.ok || !tokenResult.actionToken) {
        setConfirmModal({ open: true, title: 'Error', description: 'Failed to generate action token', });
        return;
      }

      const data: {
        client_name?: string;
        sales_agent?: string;
        total_amount?: number;
        quotation_number?: string;
        action_token: string;
      } = { action_token: tokenResult.actionToken };

      if (editForm.client_name !== (editingOrder.client_name ?? '')) data.client_name = editForm.client_name;
      if (editForm.sales_agent !== (editingOrder.sales_agent ?? '')) data.sales_agent = editForm.sales_agent;
      if (editForm.quotation_number !== (editingOrder.quotation_number ?? '')) data.quotation_number = editForm.quotation_number;
      const parsedAmount = parseFloat(editForm.total_amount);
      if (!Number.isNaN(parsedAmount) && parsedAmount !== Number(editingOrder.total_amount ?? 0)) data.total_amount = parsedAmount;

      if (Object.keys(data).length === 1) { setEditingOrder(null); return; }

      await updateOrder(editingOrder.id, data);
      setEditingOrder(null);
      mutate();
    } catch (err: any) {
      setConfirmModal({ open: true, title: 'Error', description: err.message ?? 'Failed to update order', });
    } finally {
      setSaving(false);
    }
  }

  // ── Delete handlers (single) ────────────────────────────────────────
  function handleDeleteClick(order: Order) {
    setDeletingOrder(order);
    setOtpModal({ open: true, title: 'Delete Order', description: `Are you sure you want to delete order ${order.quotation_number ?? ''}?`, pendingAction: 'delete' });
  }

  async function handleDeleteVerified(actionToken: string) {
    if (!deletingOrder) return;
    try {
      await deleteOrder(deletingOrder.id, actionToken);
      setDeletingOrder(null);
      mutate();
    } catch (err: any) {
      setConfirmModal({ open: true, title: 'Error', description: err.message ?? 'Failed to delete order', });
    }
  }

  // ── Bulk delete handlers ────────────────────────────────────────────
  function handleBulkDeleteClick() {
    setOtpModal({
      open: true,
      title: 'Delete Selected Orders',
      description: `Are you sure you want to delete ${selectedCount} selected completed order${selectedCount !== 1 ? 's' : ''}?`,
      pendingAction: 'bulk-delete',
    });
  }

  async function handleBulkDeleteVerified(actionToken: string) {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      const result = await bulkDeleteOrders(Array.from(selectedIds), actionToken);
      if (result.ok) {
        setSelectedIds(new Set());
        mutate();
      } else {
        setConfirmModal({ open: true, title: 'Error', description: 'Bulk delete failed' });
      }
    } catch (err: any) {
      setConfirmModal({ open: true, title: 'Error', description: err.message ?? 'Bulk delete failed' });
    } finally {
      setBulkDeleting(false);
    }
  }

  // ── Revert handlers ─────────────────────────────────────────────────
  function handleRevertClick(order: Order) {
    setRevertTargetOrder(order);
    setShowRevertOtp(true);
  }

  async function handleRevertVerified(actionToken: string) {
    if (!revertTargetOrder) return;
    try {
      const result = await revertStage({
        quotation_number: revertTargetOrder.quotation_number ?? '',
        action_token: actionToken,
      });
      setRevertResult({ ok: result.ok, message: result.ok ? 'Order reverted successfully' : 'Revert failed' });
      if (result.ok) {
        setShowRevertOtp(false);
        setRevertTargetOrder(null);
        mutate();
      }
    } catch (err: any) {
      setRevertResult({ ok: false, message: err.message ?? 'Revert failed' });
    }
  }

  // ── OTP handler ─────────────────────────────────────────────────────
  async function handleOtpVerified(actionToken: string) {
    if (otpModal.pendingAction === 'delete') {
      await handleDeleteVerified(actionToken);
    } else if (otpModal.pendingAction === 'bulk-delete') {
      await handleBulkDeleteVerified(actionToken);
    }
    setOtpModal(prev => ({ ...prev, open: false }));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/delivery"
          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          title="Back to Delivery"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800">Completed Orders</h1>
          <p className="text-xs text-gray-500">
            {completedOrders.length} order{completedOrders.length !== 1 ? 's' : ''} completed
          </p>
        </div>
        {/* Bulk Delete button */}
        {selectedCount > 0 && (
          <button
            onClick={handleBulkDeleteClick}
            disabled={bulkDeleting}
            className="flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-2 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-40"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            Delete Selected ({selectedCount})
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search by quotation number, client name, or sales agent..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-4 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="py-20 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-4 text-sm text-gray-400">
            {searchQuery ? 'No completed orders match your search' : 'No completed orders yet'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white">
          {/* Select All header row */}
          <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-3">
            <button onClick={toggleSelectAll} className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700">
              {selectedIds.size === filteredOrders.length ? (
                <CheckSquare className="h-4 w-4 text-[var(--primary)]" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              {selectedIds.size === filteredOrders.length ? 'Deselect all' : `Select all (${filteredOrders.length})`}
            </button>
            {selectedCount > 0 && (
              <span className="text-xs text-gray-400">{selectedCount} selected</span>
            )}
          </div>
          <div className="divide-y divide-gray-100">
            {filteredOrders.map((order) => {
              const totalAmount = Number(order.total_amount ?? 0);
              const depositAmount = Number(order.deposit_amount ?? 0);
              const balance = totalAmount - depositAmount;
              const isSelected = selectedIds.has(order.id);
              return (
                <div key={order.id} className={`transition-colors ${isSelected ? 'bg-emerald-50' : ''}`}>
                  <div className="flex items-center justify-between px-6 py-4">
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleSelect(order.id)}
                      className="mr-3 shrink-0"
                      title={isSelected ? 'Deselect' : 'Select'}
                    >
                      {isSelected ? (
                        <CheckSquare className="h-4 w-4 text-[var(--primary)]" />
                      ) : (
                        <Square className="h-4 w-4 text-gray-300 hover:text-gray-500" />
                      )}
                    </button>

                    <div className="min-w-0 flex-1">
                      <QuotationNumberCell order={order} onViewFiles={handleViewFiles} />
                      <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                      {order.sales_agent && <p className="text-[11px] text-gray-400">{order.sales_agent}</p>}
                      {order.total_amount != null && (
                        <p className="mt-0.5 text-xs text-gray-400">
                          Total: ₱{totalAmount.toLocaleString()} | {order.balance_paid ? '✅ Fully Paid' : `Balance: ₱${balance.toLocaleString()}`}
                        </p>
                      )}
                      {order.completed_at && (
                        <p className="mt-0.5 text-[11px] text-emerald-600">
                          ✅ Completed: {formatDate(order.completed_at)}
                        </p>
                      )}
                      <DeliveryInfo order={order} />
                    </div>
                    <div className="flex shrink-0 items-center gap-3 pl-4">
                      <StageBadge stage={order.current_stage} />
                      <RowActions order={order} />
                    </div>
                  </div>
                  {editingOrder?.id === order.id && (
                    <div className="border-t border-gray-100 bg-gray-50 px-6 py-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-600">Client Name</label>
                          <input
                            type="text"
                            value={editForm.client_name}
                            onChange={(e) => setEditForm(prev => ({ ...prev, client_name: e.target.value }))}
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600">Sales Agent</label>
                          <input
                            type="text"
                            value={editForm.sales_agent}
                            onChange={(e) => setEditForm(prev => ({ ...prev, sales_agent: e.target.value }))}
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600">Total Amount (₱)</label>
                          <input
                            type="number"
                            value={editForm.total_amount}
                            onChange={(e) => setEditForm(prev => ({ ...prev, total_amount: e.target.value }))}
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600">Quotation Number</label>
                          <input
                            type="text"
                            value={editForm.quotation_number}
                            onChange={(e) => setEditForm(prev => ({ ...prev, quotation_number: e.target.value }))}
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none"
                          />
                        </div>
                      </div>
                      <div className="mt-4 flex justify-end gap-2">
                        <button
                          onClick={() => setEditingOrder(null)}
                          className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleEditSave}
                          disabled={saving}
                          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--primary-dark)] disabled:opacity-40"
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* OTP Modal (single delete / bulk delete) */}
      <OtpModal
        open={otpModal.open}
        title={otpModal.title}
        description={otpModal.description}
        onVerified={handleOtpVerified}
        onClose={() => setOtpModal(prev => ({ ...prev, open: false }))}
      />

      {/* Confirm Modal */}
      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        description={confirmModal.description}
        onVerified={() => {}}
        onClose={() => setConfirmModal(prev => ({ ...prev, open: false }))}
      />

      {/* Revert OTP Modal */}
      <OtpModal
        open={showRevertOtp}
        title="Revert Stage"
        description={`Revert order ${revertTargetOrder?.quotation_number ?? ''} from completed to the previous stage?`}
        onVerified={handleRevertVerified}
        onClose={() => { setShowRevertOtp(false); setRevertTargetOrder(null); }}
      />

      {/* Revert Result Modal */}
      <ConfirmModal
        open={revertResult !== null}
        title={revertResult?.ok ? 'Reverted' : 'Revert Failed'}
        description={revertResult?.message ?? ''}
        onVerified={() => {}}
        onClose={() => setRevertResult(null)}
      />

      {/* File Viewer */}
      {viewingFilesOrder && (
        <FileViewerModal
          order={viewingFilesOrder}
          files={orderFiles}
          onClose={closeViewer}
        />
      )}
    </div>
  );
}
