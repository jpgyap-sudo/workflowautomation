'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import OtpModal from '@/components/OtpModal';
import { useInventory, useInventoryDrafts, useOrdersByStage } from '@/lib/useApi';
import {
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  extractInventoryImage,
  bulkUploadInventory,
  updateInventoryDraft,
  approveInventoryDraft,
  approveAllInventoryDrafts,
  rejectInventoryDraft,
  clearProcessedDrafts,
  getInventoryImageUrl,
  getItemCompletion,
  getOrderItems,
  inventoryVerifyItem,
  completeInventoryVerification,
  confirmInventoryArrived,
  updateOrderItem,
  type OrderItem,
} from '@/lib/api';
import {
  Package,
  Plus,
  Upload,
  ScanEye,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Trash2,
  Edit2,
  Save,
  X,
  Image as ImageIcon,
  FileText,
  Table,
  CheckSquare,
  Square,
  Search,
  ArrowRight,
  Clock,
  ExternalLink,
  Eye,
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

type ModalView = 'none' | 'add' | 'bulk' | 'drafts';

interface DraftEditState {
  [id: string]: {
    product_name: string;
    description: string;
    dimension: string;
    category: string;
    quantity: string;
  };
}

export default function InventoryPage() {
  const { data: items = [], isLoading: itemsLoading, mutate: mutateItems } = useInventory();
  const { data: drafts = [], isLoading: draftsLoading, mutate: mutateDrafts } = useInventoryDrafts();

  const [modal, setModal] = useState<ModalView>('none');
  const [searchQuery, setSearchQuery] = useState('');

  // Single add form
  const [addForm, setAddForm] = useState({
    product_name: '',
    description: '',
    dimension: '',
    category: '',
    quantity: '0',
    image_url: '',
  });
  const [addPreview, setAddPreview] = useState<string | null>(null);
  const [addFileName, setAddFileName] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);
  const addFileRef = useRef<HTMLInputElement>(null);

  // Bulk upload
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkPreview, setBulkPreview] = useState<string | null>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [bulkSuccess, setBulkSuccess] = useState('');
  const bulkFileRef = useRef<HTMLInputElement>(null);

  // Draft editing
  const [draftEdits, setDraftEdits] = useState<DraftEditState>({});
  const [selectedDrafts, setSelectedDrafts] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);
  const [draftError, setDraftError] = useState('');

  // Edit item inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ product_name: '', description: '', dimension: '', category: '', quantity: '0' });
  const [otpModal, setOtpModal] = useState<{
    open: boolean; title: string; description: string; pendingAction: 'add' | 'edit' | 'delete' | 'bulk-upload' | 'approve-selected' | 'approve-all' | 'reject-draft' | 'clear-drafts';
  }>({ open: false, title: '', description: '', pendingAction: 'edit' });

  // Initialize draft edits when drafts load
  useEffect(() => {
    const next: DraftEditState = {};
    for (const d of drafts) {
      next[d.id] = {
        product_name: d.product_name ?? '',
        description: d.description ?? '',
        dimension: d.dimension ?? '',
        category: d.category ?? '',
        quantity: d.quantity !== null && d.quantity !== undefined ? String(d.quantity) : '',
      };
    }
    setDraftEdits(next);
    setSelectedDrafts(new Set(drafts.map((d) => d.id)));
  }, [drafts.length]);

  const filteredItems = items.filter((item) => {
    const q = searchQuery.toLowerCase();
    return (
      item.product_name.toLowerCase().includes(q) ||
      (item.description ?? '').toLowerCase().includes(q) ||
      (item.dimension ?? '').toLowerCase().includes(q) ||
      (item.category ?? '').toLowerCase().includes(q)
    );
  });

  // ── Single Add ──
  function handleAddFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAddFileName(file.name);
    setAddError('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setAddPreview(dataUrl);
      // Store only the base64 data (without the data:... prefix) to avoid
      // bloating the database with large data URLs.
      const base64 = dataUrl.split(',')[1];
      setAddForm((f) => ({ ...f, image_url: base64 }));
    };
    reader.readAsDataURL(file);
  }

  async function handleExtractFromImage() {
    if (!addPreview) return;
    setExtracting(true);
    setAddError('');
    try {
      const base64 = addPreview.split(',')[1];
      const mimeType = addPreview.split(';')[0].split(':')[1];
      const result = await extractInventoryImage(base64, mimeType);
      if (result.type !== 'inventory' || !result.inventory?.length) {
        throw new Error(result.raw_text ? 'Could not extract product details from image' : 'Extraction failed');
      }
      const item = result.inventory[0];
      setAddForm((f) => ({
        ...f,
        product_name: item.product_name ?? f.product_name,
        description: item.description ?? f.description,
        dimension: item.dimension ?? f.dimension,
        quantity: item.quantity !== undefined ? String(item.quantity) : f.quantity,
      }));
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  }

  function handleCreateItem() {
    if (!addForm.product_name.trim()) {
      setAddError('Product name is required');
      return;
    }
    (window as any).__pendingInventoryAdd = {
      product_name: addForm.product_name.trim(),
      description: addForm.description.trim() || null,
      dimension: addForm.dimension.trim() || null,
      category: addForm.category.trim() || null,
      quantity: Number(addForm.quantity) || 0,
      image_url: addForm.image_url || null,
    };
    setOtpModal({
      open: true,
      title: 'Add Inventory Item',
      description: `You are about to add "${addForm.product_name.trim()}" to inventory. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'add',
    });
  }

  async function handleAddVerified(actionToken: string) {
    const pending = (window as any).__pendingInventoryAdd;
    if (!pending) return;
    setSaving(true);
    try {
      await createInventoryItem({ ...pending, action_token: actionToken });
      mutateItems();
      setModal('none');
      setAddForm({ product_name: '', description: '', dimension: '', category: '', quantity: '0', image_url: '' });
      setAddPreview(null);
      setAddFileName('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to create item');
    } finally {
      setSaving(false);
      (window as any).__pendingInventoryAdd = null;
    }
  }

  // ── Bulk Upload ──
  function handleBulkFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkFile(file);
    setBulkError('');
    setBulkSuccess('');
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => setBulkPreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setBulkPreview(null);
    }
  }

  async function handleBulkUpload() {
    if (!bulkFile) return;
    // Read file first, store in window for later use
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      (window as any).__pendingBulkUpload = {
        base64: dataUrl.split(',')[1],
        mime_type: bulkFile.type || 'application/octet-stream',
        filename: bulkFile.name,
      };
      setOtpModal({
        open: true,
        title: 'Bulk Upload Inventory',
        description: `You are about to upload "${bulkFile.name}" for bulk inventory creation. Enter the OTP sent to your email to confirm.`,
        pendingAction: 'bulk-upload',
      });
    };
    reader.readAsDataURL(bulkFile);
  }

  async function handleBulkUploadVerified(actionToken: string) {
    const pending = (window as any).__pendingBulkUpload;
    if (!pending) return;
    setBulkUploading(true);
    setBulkError('');
    try {
      const result = await bulkUploadInventory(pending.base64, pending.mime_type, pending.filename, actionToken);
      mutateDrafts();
      setBulkSuccess(`${result.drafts_created} draft(s) created. Review them before approval.`);
      setBulkFile(null);
      setBulkPreview(null);
      if (bulkFileRef.current) bulkFileRef.current.value = '';
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBulkUploading(false);
      (window as any).__pendingBulkUpload = null;
    }
  }

  // ── Draft Actions ──
  function toggleDraftSelect(id: string) {
    setSelectedDrafts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllDrafts() {
    if (selectedDrafts.size === drafts.length) {
      setSelectedDrafts(new Set());
    } else {
      setSelectedDrafts(new Set(drafts.map((d) => d.id)));
    }
  }

  function updateDraftField(id: string, field: string, value: string) {
    setDraftEdits((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  }

  async function saveDraftEdit(id: string) {
    const edits = draftEdits[id];
    if (!edits) return;
    try {
      await updateInventoryDraft(id, {
        product_name: edits.product_name.trim() || undefined,
        description: edits.description.trim() || null,
        dimension: edits.dimension.trim() || null,
        category: edits.category.trim() || null,
        quantity: edits.quantity ? Number(edits.quantity) : undefined,
      });
      mutateDrafts();
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function handleApproveSelected() {
    if (selectedDrafts.size === 0) return;
    // Save edits first
    for (const id of selectedDrafts) {
      await saveDraftEdit(id);
    }
    setOtpModal({
      open: true,
      title: 'Approve Selected Drafts',
      description: `You are about to approve ${selectedDrafts.size} draft(s). Enter the OTP sent to your email to confirm.`,
      pendingAction: 'approve-selected',
    });
  }

  async function handleApproveSelectedVerified(actionToken: string) {
    setApproving(true);
    setDraftError('');
    try {
      for (const id of selectedDrafts) {
        await approveInventoryDraft(id, actionToken);
      }
      mutateDrafts();
      mutateItems();
      setSelectedDrafts(new Set());
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setApproving(false);
    }
  }

  async function handleApproveAll() {
    setOtpModal({
      open: true,
      title: 'Approve All Drafts',
      description: `You are about to approve all inventory drafts. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'approve-all',
    });
  }

  async function handleApproveAllVerified(actionToken: string) {
    setApproving(true);
    setDraftError('');
    try {
      await approveAllInventoryDrafts(actionToken);
      mutateDrafts();
      mutateItems();
      setSelectedDrafts(new Set());
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setApproving(false);
    }
  }

  function handleRejectDraft(id: string) {
    const edits = draftEdits[id];
    (window as any).__pendingRejectDraft = { id };
    setOtpModal({
      open: true,
      title: 'Reject Draft',
      description: `Confirm rejecting draft "${edits?.product_name.trim() || id}". This cannot be undone.`,
      pendingAction: 'reject-draft',
    });
  }

  async function handleRejectDraftVerified(actionToken: string) {
    const pending = (window as any).__pendingRejectDraft as { id: string } | undefined;
    if (!pending) return;
    try {
      await rejectInventoryDraft(pending.id, actionToken);
      mutateDrafts();
      setSelectedDrafts((prev) => {
        const next = new Set(prev);
        next.delete(pending.id);
        return next;
      });
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      (window as any).__pendingRejectDraft = null;
    }
  }

  // ── Inline Edit ──
  function startEdit(item: typeof items[0]) {
    setEditingId(item.id);
    setEditForm({
      product_name: item.product_name,
      description: item.description ?? '',
      dimension: item.dimension ?? '',
      category: item.category ?? '',
      quantity: String(item.quantity),
    });
  }

  function saveEdit(id: string) {
    const item = items.find((i) => i.id === id);
    (window as any).__pendingInventoryEdit = { id, form: { ...editForm } };
    setOtpModal({ open: true, title: 'Edit Inventory Item',
      description: `You are about to edit "${item?.product_name ?? id}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'edit' });
  }

  async function handleEditVerified(actionToken: string) {
    const pending = (window as any).__pendingInventoryEdit;
    if (!pending) return;
    try {
      await updateInventoryItem(pending.id, {
        product_name: pending.form.product_name.trim(),
        description: pending.form.description.trim() || null,
        dimension: pending.form.dimension.trim() || null,
        category: pending.form.category.trim() || null,
        quantity: Number(pending.form.quantity) || 0,
        action_token: actionToken,
      });
      mutateItems();
      setEditingId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    } finally {
      (window as any).__pendingInventoryEdit = null;
    }
  }

  function handleDelete(id: string) {
    const item = items.find((i) => i.id === id);
    (window as any).__pendingInventoryDelete = id;
    setOtpModal({ open: true, title: 'Delete Inventory Item',
      description: `You are about to delete "${item?.product_name ?? id}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'delete' });
  }

  async function handleDeleteVerified(actionToken: string) {
    const id = (window as any).__pendingInventoryDelete;
    if (!id) return;
    try {
      await deleteInventoryItem(id, actionToken);
      mutateItems();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      (window as any).__pendingInventoryDelete = null;
    }
  }

  function handleOtpVerified(actionToken: string) {
    if (otpModal.pendingAction === 'add') handleAddVerified(actionToken);
    else if (otpModal.pendingAction === 'edit') handleEditVerified(actionToken);
    else if (otpModal.pendingAction === 'delete') handleDeleteVerified(actionToken);
    else if (otpModal.pendingAction === 'bulk-upload') handleBulkUploadVerified(actionToken);
    else if (otpModal.pendingAction === 'approve-selected') handleApproveSelectedVerified(actionToken);
    else if (otpModal.pendingAction === 'approve-all') handleApproveAllVerified(actionToken);
    else if (otpModal.pendingAction === 'reject-draft') handleRejectDraftVerified(actionToken);
    else if (otpModal.pendingAction === 'clear-drafts') handleClearDraftsVerified(actionToken);

  }

  async function handleClearDraftsVerified(actionToken: string) {
    try {
      await clearProcessedDrafts(actionToken);
      mutateDrafts();
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Clear failed');
    }
  }

  function closeModal() {
    setModal('none');
    setAddError('');
    setBulkError('');
    setBulkSuccess('');
    setDraftError('');
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-teal-600 text-white">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Inventory</h1>
            <p className="text-xs text-gray-500">{items.length} item(s) in stock</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setModal('drafts')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              drafts.length > 0
                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Table className="h-4 w-4" />
            Drafts
            {drafts.length > 0 && (
              <span className="rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {drafts.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setModal('bulk')}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
          >
            <Upload className="h-4 w-4" />
            Bulk Upload
          </button>
          <button
            onClick={() => setModal('add')}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2490ef] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a7ad9]"
          >
            <Plus className="h-4 w-4" />
            Add Item
          </button>
        </div>
      </div>

      {/* Orders Awaiting Inventory Verification */}
      <InventoryVerificationSection />

      {/* Orders Awaiting Inventory Arrival */}
      <InventoryArrivalSection />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search inventory..."
          className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-4 text-sm outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
        />
      </div>

      {/* Inventory Table */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <Package className="h-4 w-4 text-cyan-500" />
          <h2 className="text-base font-semibold text-gray-800">Inventory Items</h2>
          <span className="ml-auto rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-700">
            {filteredItems.length}
          </span>
        </div>
        {itemsLoading && items.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-[#2490ef]" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            {searchQuery ? 'No items match your search' : 'No inventory items yet. Add your first item!'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs font-medium text-gray-500">
                <tr>
                  <th className="px-4 py-3">Image</th>
                  <th className="px-4 py-3">Product Name</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Dimension</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Quantity</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      {item.image_url ? (
                        <img
                          src={`${API_BASE}/inventory/${item.id}/image`}
                          alt={item.product_name}
                          className="h-10 w-10 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                          <ImageIcon className="h-4 w-4 text-gray-400" />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {editingId === item.id ? (
                        <input
                          value={editForm.product_name}
                          onChange={(e) => setEditForm((f) => ({ ...f, product_name: e.target.value }))}
                          className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                        />
                      ) : (
                        item.product_name
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {editingId === item.id ? (
                        <input
                          value={editForm.description}
                          onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                          className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                        />
                      ) : (
                        item.description ?? '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {editingId === item.id ? (
                        <input
                          value={editForm.dimension}
                          onChange={(e) => setEditForm((f) => ({ ...f, dimension: e.target.value }))}
                          className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                        />
                      ) : (
                        item.dimension ?? '—'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingId === item.id ? (
                        <input
                          value={editForm.category}
                          onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                          className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                          placeholder="e.g. Raw Material"
                        />
                      ) : item.category ? (
                        <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                          {item.category}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingId === item.id ? (
                        <input
                          type="number"
                          value={editForm.quantity}
                          onChange={(e) => setEditForm((f) => ({ ...f, quantity: e.target.value }))}
                          className="w-20 rounded border border-gray-200 px-2 py-1 text-sm"
                        />
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                          {item.quantity}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editingId === item.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => saveEdit(item.id)} className="rounded p-1 text-green-600 hover:bg-green-50">
                            <Save className="h-4 w-4" />
                          </button>
                          <button onClick={() => setEditingId(null)} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => startEdit(item)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button onClick={() => handleDelete(item.id)} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Add Item Modal ── */}
      {modal === 'add' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Add Inventory Item</h2>
              <button onClick={closeModal} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Image Upload */}
            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-gray-600">Product Image</label>
              <div
                onClick={() => addFileRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-8 transition-colors hover:border-[#2490ef] hover:bg-blue-50/50"
              >
                {addPreview ? (
                  <img src={addPreview} alt="Preview" className="max-h-32 rounded-lg object-contain" />
                ) : (
                  <>
                    <ImageIcon className="mb-2 h-8 w-8 text-gray-400" />
                    <p className="text-sm text-gray-600">Click to upload image</p>
                  </>
                )}
                <input ref={addFileRef} type="file" accept="image/*" onChange={handleAddFileSelect} className="hidden" />
              </div>
              {addPreview && (
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={handleExtractFromImage}
                    disabled={extracting}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50"
                  >
                    {extracting ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanEye className="h-3 w-3" />}
                    {extracting ? 'Extracting...' : 'Auto-fill from image'}
                  </button>
                  <span className="text-xs text-gray-400">{addFileName}</span>
                </div>
              )}
            </div>

            {/* Fields */}
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Product Name *</label>
                <input
                  value={addForm.product_name}
                  onChange={(e) => setAddForm((f) => ({ ...f, product_name: e.target.value }))}
                  placeholder="e.g. Ceramic Vase"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Description</label>
                <textarea
                  value={addForm.description}
                  onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Hand-painted blue ceramic vase"
                  rows={2}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Category</label>
                <input
                  value={addForm.category}
                  onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="e.g. Raw Material, Finished Good, Packaging"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Dimension</label>
                  <input
                    value={addForm.dimension}
                    onChange={(e) => setAddForm((f) => ({ ...f, dimension: e.target.value }))}
                    placeholder="e.g. 20x15 cm"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Quantity</label>
                  <input
                    type="number"
                    value={addForm.quantity}
                    onChange={(e) => setAddForm((f) => ({ ...f, quantity: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-1 focus:ring-[#2490ef]"
                  />
                </div>
              </div>
            </div>

            {addError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                <AlertCircle className="h-4 w-4" />
                {addError}
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <button
                onClick={handleCreateItem}
                disabled={saving}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#2490ef] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1a7ad9] disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                {saving ? 'Saving...' : 'Save Item'}
              </button>
              <button onClick={closeModal} className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Upload Modal ── */}
      {modal === 'bulk' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Bulk Upload</h2>
              <button onClick={closeModal} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div
              onClick={() => bulkFileRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-10 transition-colors hover:border-[#2490ef] hover:bg-blue-50/50"
            >
              {bulkPreview ? (
                <img src={bulkPreview} alt="Preview" className="max-h-40 rounded-lg object-contain" />
              ) : bulkFile ? (
                <div className="text-center">
                  <FileText className="mx-auto mb-2 h-10 w-10 text-gray-400" />
                  <p className="text-sm font-medium text-gray-700">{bulkFile.name}</p>
                  <p className="text-xs text-gray-400">Click to change file</p>
                </div>
              ) : (
                <>
                  <Upload className="mb-3 h-10 w-10 text-gray-400" />
                  <p className="text-sm font-medium text-gray-700">Click to upload CSV, PDF, or Image</p>
                  <p className="mt-1 text-xs text-gray-400">AI will auto-detect product details</p>
                </>
              )}
              <input ref={bulkFileRef} type="file" accept=".csv,application/pdf,image/*" onChange={handleBulkFileSelect} className="hidden" />
            </div>

            {bulkError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                <AlertCircle className="h-4 w-4" />
                {bulkError}
              </div>
            )}
            {bulkSuccess && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-600">
                <CheckCircle className="h-4 w-4" />
                {bulkSuccess}
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <button
                onClick={handleBulkUpload}
                disabled={!bulkFile || bulkUploading}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#2490ef] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1a7ad9] disabled:opacity-50"
              >
                {bulkUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanEye className="h-4 w-4" />}
                {bulkUploading ? 'Processing...' : 'Upload & Extract'}
              </button>
              <button
                onClick={() => {
                  if (bulkSuccess) {
                    setModal('drafts');
                  } else {
                    closeModal();
                  }
                }}
                className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                {bulkSuccess ? 'Review Drafts' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Draft Review Modal ── */}
      {modal === 'drafts' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Review Drafts</h2>
                <p className="text-xs text-gray-500">
                  {drafts.length} pending draft(s). Edit fields before approving.
                </p>
              </div>
              <button onClick={closeModal} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-6">
              {draftsLoading && drafts.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-[#2490ef]" />
                </div>
              ) : drafts.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-400">No pending drafts</div>
              ) : (
                <div className="space-y-4">
                  {/* Bulk Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={toggleAllDrafts}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                    >
                      {selectedDrafts.size === drafts.length ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                      Select All
                    </button>
                    <button
                      onClick={handleApproveSelected}
                      disabled={selectedDrafts.size === 0 || approving}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {approving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                      Approve Selected ({selectedDrafts.size})
                    </button>
                    <button
                      onClick={handleApproveAll}
                      disabled={approving}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#2490ef] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1a7ad9] disabled:opacity-50"
                    >
                      Approve All
                    </button>
                  </div>

                  {draftError && (
                    <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                      <AlertCircle className="h-4 w-4" />
                      {draftError}
                    </div>
                  )}

                  {/* Drafts Table */}
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-gray-50 text-xs font-medium text-gray-500">
                        <tr>
                          <th className="px-3 py-2 w-10"></th>
                          <th className="px-3 py-2">Product Name</th>
                          <th className="px-3 py-2">Description</th>
                          <th className="px-3 py-2">Dimension</th>
                          <th className="px-3 py-2">Category</th>
                          <th className="px-3 py-2 w-24">Quantity</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {drafts.map((draft) => {
                          const edits = draftEdits[draft.id] ?? {
                            product_name: draft.product_name ?? '',
                            description: draft.description ?? '',
                            dimension: draft.dimension ?? '',
                            category: draft.category ?? '',
                            quantity: draft.quantity !== null ? String(draft.quantity) : '',
                          };
                          return (
                            <tr key={draft.id} className="hover:bg-gray-50">
                              <td className="px-3 py-2">
                                <button onClick={() => toggleDraftSelect(draft.id)} className="text-gray-400 hover:text-gray-600">
                                  {selectedDrafts.has(draft.id) ? <CheckSquare className="h-5 w-5 text-[#2490ef]" /> : <Square className="h-5 w-5" />}
                                </button>
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  value={edits.product_name}
                                  onChange={(e) => updateDraftField(draft.id, 'product_name', e.target.value)}
                                  className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                                  placeholder="Product name"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  value={edits.description}
                                  onChange={(e) => updateDraftField(draft.id, 'description', e.target.value)}
                                  className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                                  placeholder="Description"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  value={edits.dimension}
                                  onChange={(e) => updateDraftField(draft.id, 'dimension', e.target.value)}
                                  className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                                  placeholder="Dimension"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  value={edits.category}
                                  onChange={(e) => updateDraftField(draft.id, 'category', e.target.value)}
                                  className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                                  placeholder="Category"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  value={edits.quantity}
                                  onChange={(e) => updateDraftField(draft.id, 'quantity', e.target.value)}
                                  className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                                  placeholder="Qty"
                                />
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    onClick={() => saveDraftEdit(draft.id)}
                                    className="rounded p-1 text-green-600 hover:bg-green-50"
                                    title="Save edit"
                                  >
                                    <Save className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => handleRejectDraft(draft.id)}
                                    className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600"
                                    title="Reject"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4">
              <button
                onClick={() => {
                  setOtpModal({
                    open: true,
                    title: 'Clear Processed Drafts',
                    description: 'Confirm clearing all approved and rejected drafts. This cannot be undone.',
                    pendingAction: 'clear-drafts',
                  });
                }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Clear processed drafts
              </button>
              <button
                onClick={closeModal}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <OtpModal
        open={otpModal.open}
        title={otpModal.title}
        description={otpModal.description}
        onVerified={handleOtpVerified}
        onClose={() => {
          setOtpModal({ ...otpModal, open: false });
          (window as any).__pendingInventoryEdit = null;
          (window as any).__pendingInventoryDelete = null;
          (window as any).__pendingRejectDraft = null;
        }}
      />
    </div>
  );
}

// ── Orders Awaiting Inventory Arrival Section ─────────────────────────────

function InventoryVerificationSection() {
  const inventoryVerification = useOrdersByStage('inventory_verification');
  const inventoryArrived = useOrdersByStage('inventory_arrived');
  const balanceDue = useOrdersByStage('balance_due');
  const balanceVerification = useOrdersByStage('balance_verification');
  const deliveryPending = useOrdersByStage('delivery_pending');
  const deliveryScheduled = useOrdersByStage('delivery_scheduled');
  const sourceOrders = [
    ...(inventoryVerification.data ?? []),
    ...(inventoryArrived.data ?? []),
    ...(balanceDue.data ?? []),
    ...(balanceVerification.data ?? []),
    ...(deliveryPending.data ?? []),
    ...(deliveryScheduled.data ?? []),
  ];
  const orders = Array.from(new Map(sourceOrders.map((order) => [order.id, order])).values());
  const isLoading = inventoryVerification.isLoading || inventoryArrived.isLoading || balanceDue.isLoading || balanceVerification.isLoading || deliveryPending.isLoading || deliveryScheduled.isLoading;
  const mutate = async () => {
    await Promise.all([
      inventoryVerification.mutate(),
      inventoryArrived.mutate(),
      balanceDue.mutate(),
      balanceVerification.mutate(),
      deliveryPending.mutate(),
      deliveryScheduled.mutate(),
    ]);
  };
  const { mutate: mutateInventoryItems } = useInventory();
  const [itemDetailsMap, setItemDetailsMap] = useState<Record<string, OrderItem[]>>({});
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [verifyingItemId, setVerifyingItemId] = useState<string | null>(null);

  const [itemOtp, setItemOtp] = useState<{
    open: boolean;
    orderId: string;
    quotationNumber: string;
    itemId: string;
    itemName: string;
    action: 'all' | 'partial' | 'not_yet';
    verifiedQty?: number;
  }>({ open: false, orderId: '', quotationNumber: '', itemId: '', itemName: '', action: 'all' });

  // OTP modal state for "Complete Verification" action
  const [verifyOtp, setVerifyOtp] = useState<{ open: boolean; orderId: string; quotationNumber: string }>({
    open: false, orderId: '', quotationNumber: '',
  });
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (orders.length === 0) {
      setItemDetailsMap({});
      return;
    }
    let cancelled = false;
    async function fetchItems() {
      setLoadingItems(true);
      const details: Record<string, OrderItem[]> = {};
      await Promise.all(orders.map(async (order) => {
        try {
          const res = await getOrderItems(order.id);
          details[order.id] = res.items ?? [];
        } catch {
          details[order.id] = [];
        }
      }));
      if (!cancelled) {
        setItemDetailsMap(details);
        setLoadingItems(false);
      }
    }
    fetchItems();
    return () => { cancelled = true; };
  }, [orders.map((o) => o.id).sort().join('|')]);

  async function refreshVerificationData() {
    await mutate();
    await mutateInventoryItems();
    const details: Record<string, OrderItem[]> = {};
    await Promise.all(orders.map(async (order) => {
      try {
        const res = await getOrderItems(order.id);
        details[order.id] = res.items ?? [];
      } catch {
        details[order.id] = itemDetailsMap[order.id] ?? [];
      }
    }));
    setItemDetailsMap(details);
  }

  function formatItemDate(value: string | null | undefined) {
    if (!value) return '?';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '?';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function openItemVerification(order: any, item: OrderItem, action: 'all' | 'partial' | 'not_yet') {
    let verifiedQty: number | undefined;
    if (action === 'partial') {
      const input = window.prompt(`Verified quantity for ${item.name}?`, String(item.verified_qty ?? 0));
      if (input == null) return;
      const qty = Number(input.replace(/[^0-9]/g, ''));
      if (!Number.isInteger(qty) || qty < 0 || qty > item.quantity) {
        alert(`Enter a quantity from 0 to ${item.quantity}.`);
        return;
      }
      verifiedQty = qty;
    }
    setItemOtp({
      open: true,
      orderId: order.id,
      quotationNumber: order.quotation_number ?? 'N/A',
      itemId: item.id,
      itemName: item.name,
      action,
      verifiedQty,
    });
  }

  async function handleItemVerified(actionToken: string) {
    if (!itemOtp.orderId || !itemOtp.itemId) return;
    setVerifyingItemId(itemOtp.itemId);
    try {
      await inventoryVerifyItem(itemOtp.orderId, {
        item_id: itemOtp.itemId,
        action: itemOtp.action,
        verified_qty: itemOtp.verifiedQty,
        action_token: actionToken,
      });
      await refreshVerificationData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to verify inventory item');
    } finally {
      setVerifyingItemId(null);
      setItemOtp({ open: false, orderId: '', quotationNumber: '', itemId: '', itemName: '', action: 'all' });
    }
  }

  async function handleCompleteVerification(actionToken: string) {
    if (!verifyOtp.orderId) return;
    setVerifying(true);
    try {
      await completeInventoryVerification(verifyOtp.orderId, actionToken);
      mutate();
      mutateInventoryItems();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to complete verification');
    } finally {
      setVerifying(false);
      setVerifyOtp({ open: false, orderId: '', quotationNumber: '' });
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-4">
        <div className="flex items-center gap-2 text-sm text-teal-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading orders awaiting inventory verification...
        </div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-4">
        <div className="flex items-center gap-2 text-sm text-teal-700">
          <Search className="h-4 w-4" />
          No orders awaiting inventory verification.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50">
      <div className="flex items-center gap-2 border-b border-teal-200 px-5 py-3">
        <Search className="h-4 w-4 text-teal-600" />
        <h3 className="text-sm font-semibold text-teal-800">Orders Awaiting Inventory Verification</h3>
        <span className="ml-auto rounded-full bg-teal-200 px-2 py-0.5 text-[10px] font-bold text-teal-800">
          {orders.length}
        </span>
        <Link href="/workflow" className="inline-flex items-center gap-1 rounded-md bg-white/80 px-2.5 py-1 text-[11px] font-medium text-teal-700 shadow-sm transition-colors hover:bg-white">
          <ExternalLink className="h-3 w-3" />
          Workflow
        </Link>
      </div>
      <div className="divide-y divide-teal-100 px-5 py-2">
        {orders.map((order) => {
          const orderItems = itemDetailsMap[order.id] ?? [];
          const verifiedItems = orderItems.filter((i) => (i.verified_qty ?? 0) >= i.quantity).length;
          const expanded = expandedOrderId === order.id;
          return (
            <div key={order.id} className="py-3">
              <button type="button" onClick={() => setExpandedOrderId(expanded ? null : order.id)} className="flex w-full items-center justify-between text-left">
                <div className="flex items-center gap-3">
                  <Package className="h-4 w-4 text-teal-500" />
                  <div>
                    <Link href={`/orders/${encodeURIComponent(order.quotation_number ?? '')}`} className="text-sm font-medium text-gray-900 hover:text-teal-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                      #{order.quotation_number ?? 'N/A'}
                    </Link>
                    <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown'}</p>
                    <div className="mt-1 flex items-center gap-1">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200">
                        <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${order.inventory_verification_pct ?? 0}%` }} />
                      </div>
                      <span className="text-[10px] font-medium text-teal-600">
                        {order.inventory_verification_pct ?? 0}% verified ? {verifiedItems}/{orderItems.length || 0} item(s) ? {order.current_stage.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {order.current_stage === 'inventory_verification' ? (
                    <button type="button" onClick={(e) => { e.stopPropagation(); setVerifyOtp({ open: true, orderId: order.id, quotationNumber: order.quotation_number ?? 'N/A' }); }} disabled={verifying} className="inline-flex items-center gap-1 rounded-md bg-teal-600 px-2.5 py-1 text-[10px] font-medium text-white shadow-sm transition-colors hover:bg-teal-700 disabled:opacity-50">
                      {verifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                      Complete Verification
                    </button>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-teal-700">Visible until delivered</span>
                  )}
                  <span className="inline-flex items-center rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-medium text-teal-700">Inventory Agent Active</span>
                  <ArrowRight className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                </div>
              </button>

              {expanded && (
                <div className="mt-3 overflow-x-auto rounded-lg border border-teal-100 bg-white">
                  {loadingItems && orderItems.length === 0 ? (
                    <div className="flex items-center gap-2 p-3 text-xs text-gray-500"><Loader2 className="h-3 w-3 animate-spin" /> Loading items...</div>
                  ) : orderItems.length === 0 ? (
                    <div className="p-3 text-xs text-gray-500">No item records found for this order.</div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="bg-teal-50 text-[10px] uppercase tracking-wide text-teal-700">
                        <tr>
                          <th className="px-3 py-2">Item Name</th>
                          <th className="px-3 py-2">Qty</th>
                          <th className="px-3 py-2">Verified Qty</th>
                          <th className="px-3 py-2">Arrival Verified Date</th>
                          <th className="px-3 py-2">Delivered</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {orderItems.map((item) => (
                          <tr key={item.id}>
                            <td className="px-3 py-2 font-medium text-gray-800">{item.name}</td>
                            <td className="px-3 py-2 text-gray-600">{item.quantity}</td>
                            <td className="px-3 py-2"><span className="rounded-full bg-teal-100 px-2 py-0.5 font-semibold text-teal-700">{item.verified_qty ?? 0}/{item.quantity}</span></td>
                            <td className="px-3 py-2 text-gray-600">{formatItemDate(item.inventory_verified_at)}</td>
                            <td className="px-3 py-2 text-gray-600">{item.delivered_qty ?? 0}{item.delivered_at ? ` - ${formatItemDate(item.delivered_at)}` : ''}</td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex justify-end gap-1">
                                {order.current_stage === 'inventory_verification' ? (
                                  <>
                                    <button onClick={() => openItemVerification(order, item, 'all')} disabled={verifyingItemId === item.id} className="rounded bg-green-50 px-2 py-1 text-[10px] font-medium text-green-700 hover:bg-green-100 disabled:opacity-50">Verify All</button>
                                    <button onClick={() => openItemVerification(order, item, 'partial')} disabled={verifyingItemId === item.id} className="rounded bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50">Partial</button>
                                    <button onClick={() => openItemVerification(order, item, 'not_yet')} disabled={verifyingItemId === item.id} className="rounded bg-gray-50 px-2 py-1 text-[10px] font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50">Not Yet</button>
                                  </>
                                ) : (
                                  <span className="text-[10px] text-gray-400">Tracked until delivered</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <OtpModal
        open={itemOtp.open}
        title="Verify Inventory Item"
        description={`You are about to update inventory verification for ${itemOtp.itemName} in order #${itemOtp.quotationNumber}. This will update on-hand inventory and create an accountability movement log.`}
        onVerified={handleItemVerified}
        onClose={() => setItemOtp({ open: false, orderId: '', quotationNumber: '', itemId: '', itemName: '', action: 'all' })}
      />
      <OtpModal
        open={verifyOtp.open}
        title="Complete Inventory Verification"
        description={`You are about to complete inventory verification for order #${verifyOtp.quotationNumber}. Enter the OTP sent to your email to confirm.`}
        onVerified={handleCompleteVerification}
        onClose={() => setVerifyOtp({ open: false, orderId: '', quotationNumber: '' })}
      />
    </div>
  );
}

function InventoryArrivalSection() {
  const { data: orders = [], isLoading, mutate } = useOrdersByStage('inventory_arrived');

  // Fetch completion data for each order to get inventory_completion_pct
  const [completionMap, setCompletionMap] = useState<Record<string, number>>({});
  const [itemCountMap, setItemCountMap] = useState<Record<string, { arrived: number; total: number }>>({});
  const [itemDetailsMap, setItemDetailsMap] = useState<Record<string, OrderItem[]>>({});
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [selectedArrivalItems, setSelectedArrivalItems] = useState<Record<string, string[]>>({});
  const [updatingArrival, setUpdatingArrival] = useState<string | null>(null);

  // OTP modal state for "Confirm All Arrived" action
  const [arrivalOtp, setArrivalOtp] = useState<{ open: boolean; orderId: string; quotationNumber: string }>({
    open: false, orderId: '', quotationNumber: '',
  });
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (orders.length === 0) return;
    let cancelled = false;

    async function fetchData() {
      const compMap: Record<string, number> = {};
      const itemMap: Record<string, { arrived: number; total: number }> = {};
      const detailMap: Record<string, OrderItem[]> = {};

      await Promise.all(
        orders.map(async (order) => {
          try {
            const [compRes, itemsRes] = await Promise.all([
              getItemCompletion(order.id),
              getOrderItems(order.id),
            ]);
            if (!cancelled) {
              compMap[order.id] = compRes.inventory_completion_pct ?? 0;
              const items = itemsRes.items ?? [];
              const arrived = items.filter((i) => i.en_route_status === 'arrived').length;
              itemMap[order.id] = { arrived, total: items.length };
              detailMap[order.id] = items;
            }
          } catch {
            // Silently fail — progress bars just won't show
          }
        })
      );

      if (!cancelled) {
        setCompletionMap(compMap);
        setItemCountMap(itemMap);
        setItemDetailsMap(detailMap);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [orders]);

  async function handleConfirmAllArrived(actionToken: string) {
    if (!arrivalOtp.orderId) return;
    setConfirming(true);
    try {
      await confirmInventoryArrived(arrivalOtp.orderId, actionToken);
      mutate();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to confirm arrival');
    } finally {
      setConfirming(false);
      setArrivalOtp({ open: false, orderId: '', quotationNumber: '' });
    }
  }

  async function refreshArrivalData() {
    mutate();
    const refreshedEntries = await Promise.all(
      orders.map(async (order) => {
        const [completion, itemsRes] = await Promise.all([
          getItemCompletion(order.id),
          getOrderItems(order.id),
        ]);
        const items = itemsRes.items ?? [];
        return {
          orderId: order.id,
          completionPct: completion.inventory_completion_pct ?? 0,
          items,
        };
      })
    );

    setCompletionMap((prev) => {
      const next = { ...prev };
      for (const entry of refreshedEntries) next[entry.orderId] = entry.completionPct;
      return next;
    });
    setItemDetailsMap((prev) => {
      const next = { ...prev };
      for (const entry of refreshedEntries) next[entry.orderId] = entry.items;
      return next;
    });
    setItemCountMap((prev) => {
      const next = { ...prev };
      for (const entry of refreshedEntries) {
        next[entry.orderId] = {
          arrived: entry.items.filter((item) => item.en_route_status === 'arrived').length,
          total: entry.items.length,
        };
      }
      return next;
    });
  }

  function toggleSelectedArrivalItem(orderId: string, itemId: string) {
    setSelectedArrivalItems((prev) => {
      const selected = new Set(prev[orderId] ?? []);
      if (selected.has(itemId)) selected.delete(itemId);
      else selected.add(itemId);
      return { ...prev, [orderId]: Array.from(selected) };
    });
  }

  async function markArrivalItems(orderId: string, itemIds: string[]) {
    if (itemIds.length === 0) {
      alert('Select at least one item that arrived.');
      return;
    }

    setUpdatingArrival(orderId);
    try {
      await Promise.all(
        itemIds.map((itemId) => updateOrderItem(orderId, itemId, { en_route_status: 'arrived' }))
      );
      setSelectedArrivalItems((prev) => ({ ...prev, [orderId]: [] }));
      await refreshArrivalData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update inventory arrival items');
    } finally {
      setUpdatingArrival(null);
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-cyan-200 bg-cyan-50/50 p-4">
        <div className="flex items-center gap-2 text-sm text-cyan-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading orders awaiting inventory...
        </div>
      </div>
    );
  }

  if (orders.length === 0) {
    return null; // Don't show section when no orders are waiting
  }

  return (
    <div className="rounded-xl border border-cyan-200 bg-cyan-50">
      <div className="flex items-center gap-2 border-b border-cyan-200 px-5 py-3">
        <Clock className="h-4 w-4 text-cyan-600" />
        <h3 className="text-sm font-semibold text-cyan-800">Orders Awaiting Inventory Arrival</h3>
        <span className="ml-auto rounded-full bg-cyan-200 px-2 py-0.5 text-[10px] font-bold text-cyan-800">
          {orders.length}
        </span>
        <Link
          href="/workflow"
          className="inline-flex items-center gap-1 rounded-md bg-white/80 px-2.5 py-1 text-[11px] font-medium text-cyan-700 shadow-sm transition-colors hover:bg-white"
        >
          <ExternalLink className="h-3 w-3" />
          Workflow
        </Link>
      </div>
      <div className="divide-y divide-cyan-100 px-5 py-2">
        {orders.map((order) => {
          const arrivalPct = completionMap[order.id] ?? 0;
          const itemCount = itemCountMap[order.id];
          const arrivalItems = itemDetailsMap[order.id] ?? [];
          const notArrivedItems = arrivalItems.filter((item) => item.en_route_status !== 'arrived');
          const selectedItems = selectedArrivalItems[order.id] ?? [];
          const arrivalSelectorOpen = expandedOrderId === order.id;
          const hasArrivalData = arrivalPct > 0 || (itemCount && itemCount.total > 0);

          // Determine agent status: actively processing vs awaiting response
          const isProcessing = arrivalPct > 0 && arrivalPct < 100;
          const isComplete = arrivalPct >= 100;
          const isAwaiting = arrivalPct === 0;

          return (
            <div key={order.id} className="py-2">
              <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Package className="h-4 w-4 text-cyan-500" />
                <div>
                  <Link
                    href={`/orders/${encodeURIComponent(order.quotation_number ?? '')}`}
                    className="text-sm font-medium text-gray-900 hover:text-cyan-700 hover:underline"
                  >
                    #{order.quotation_number ?? 'N/A'}
                  </Link>
                  <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown'}</p>
                  {/* Gap 3: Progress bar for arrival % */}
                  {hasArrivalData && (
                    <div className="mt-1 flex items-center gap-1">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-200">
                        <div
                          className={`h-full rounded-full transition-all ${
                            isComplete ? 'bg-green-500' : 'bg-cyan-500'
                          }`}
                          style={{ width: `${arrivalPct}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-medium text-cyan-600">
                        {arrivalPct}% arrived
                      </span>
                      {itemCount && itemCount.total > 0 && (
                        <span className="text-[10px] text-gray-400">
                          ({itemCount.arrived}/{itemCount.total} items)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {arrivalItems.length > 0 && notArrivedItems.length > 0 && (
                  <>
                    <button
                      onClick={() => markArrivalItems(order.id, notArrivedItems.map((item) => item.id))}
                      disabled={updatingArrival === order.id}
                      className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-2.5 py-1 text-[10px] font-medium text-white shadow-sm transition-colors hover:bg-cyan-700 disabled:opacity-50"
                    >
                      {updatingArrival === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                      Inventory Arrived
                    </button>
                    <button
                      onClick={() => setExpandedOrderId(arrivalSelectorOpen ? null : order.id)}
                      disabled={updatingArrival === order.id}
                      className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 text-[10px] font-medium text-white shadow-sm transition-colors hover:bg-amber-600 disabled:opacity-50"
                    >
                      <CheckSquare className="h-3 w-3" />
                      Partial Arrived
                    </button>
                  </>
                )}
                {/* Gap 3: Quick-action "Confirm All Arrived" button */}
                {isComplete && (
                  <button
                    onClick={() =>
                      setArrivalOtp({
                        open: true,
                        orderId: order.id,
                        quotationNumber: order.quotation_number ?? 'N/A',
                      })
                    }
                    disabled={confirming}
                    className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1 text-[10px] font-medium text-white shadow-sm transition-colors hover:bg-green-700 disabled:opacity-50"
                  >
                    {confirming ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                    Confirm All Arrived
                  </button>
                )}
                {/* Gap 4: Agent status distinction */}
                {isProcessing && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-medium text-cyan-700">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-500" />
                    Agent Processing
                  </span>
                )}
                {isAwaiting && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    Awaiting Response
                  </span>
                )}
                {isComplete && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                    <CheckCircle className="h-3 w-3" />
                    All Arrived
                  </span>
                )}
                {/* Gap 7: View Items quick link */}
                <Link
                  href={`/orders/${encodeURIComponent(order.quotation_number ?? '')}`}
                  className="inline-flex items-center gap-1 rounded-md bg-white/80 px-2 py-1 text-[10px] font-medium text-cyan-700 shadow-sm transition-colors hover:bg-white"
                  title="View Items"
                >
                  <Eye className="h-3 w-3" />
                  Items
                </Link>
                <Link
                  href={`/orders/${encodeURIComponent(order.quotation_number ?? '')}`}
                  className="rounded p-1 text-gray-400 transition-colors hover:bg-cyan-100 hover:text-cyan-700"
                >
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
              </div>

              {arrivalSelectorOpen && (
                <div className="mt-3 rounded-lg border border-cyan-200 bg-white/80 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-cyan-900">Select item(s) that arrived</p>
                    <button
                      onClick={() => markArrivalItems(order.id, selectedItems)}
                      disabled={updatingArrival === order.id || selectedItems.length === 0}
                      className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1 text-[10px] font-medium text-white shadow-sm transition-colors hover:bg-green-700 disabled:opacity-50"
                    >
                      {updatingArrival === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                      Mark Selected Arrived
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {notArrivedItems.map((item) => {
                      const checked = selectedItems.includes(item.id);
                      return (
                        <label
                          key={item.id}
                          className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-xs transition-colors ${
                            checked ? 'border-green-300 bg-green-50 text-green-800' : 'border-gray-200 bg-white text-gray-700 hover:border-cyan-200'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSelectedArrivalItem(order.id, item.id)}
                            className="h-3.5 w-3.5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                          />
                          <span className="min-w-0 flex-1 truncate">{item.name}</span>
                          <span className="text-[10px] text-gray-400">x{item.quantity}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[10px] text-gray-500">
                    Items marked arrived are removed from future item-by-item reminders. Remaining items stay in the reminder queue.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* OTP Modal for Confirm All Arrived */}
      <OtpModal
        open={arrivalOtp.open}
        title="Confirm Inventory Arrival"
        description={`You are about to confirm all inventory has arrived for order #${arrivalOtp.quotationNumber}. Enter the OTP sent to your email to confirm.`}
        onVerified={handleConfirmAllArrived}
        onClose={() => setArrivalOtp({ open: false, orderId: '', quotationNumber: '' })}
      />
    </div>
  );
}
