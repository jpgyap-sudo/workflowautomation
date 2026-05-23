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
    open: boolean; title: string; description: string; pendingAction: 'edit' | 'delete';
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

  async function handleCreateItem() {
    if (!addForm.product_name.trim()) {
      setAddError('Product name is required');
      return;
    }
    setSaving(true);
    try {
      await createInventoryItem({
        product_name: addForm.product_name.trim(),
        description: addForm.description.trim() || null,
        dimension: addForm.dimension.trim() || null,
        category: addForm.category.trim() || null,
        quantity: Number(addForm.quantity) || 0,
        image_url: addForm.image_url || null,
      });
      mutateItems();
      setModal('none');
      setAddForm({ product_name: '', description: '', dimension: '', category: '', quantity: '0', image_url: '' });
      setAddPreview(null);
      setAddFileName('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to create item');
    } finally {
      setSaving(false);
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
    setBulkUploading(true);
    setBulkError('');
    try {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          resolve(dataUrl.split(',')[1]);
        };
        reader.readAsDataURL(bulkFile);
      });
      const result = await bulkUploadInventory(base64, bulkFile.type || 'application/octet-stream', bulkFile.name);
      mutateDrafts();
      setBulkSuccess(`${result.drafts_created} draft(s) created. Review them before approval.`);
      setBulkFile(null);
      setBulkPreview(null);
      if (bulkFileRef.current) bulkFileRef.current.value = '';
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBulkUploading(false);
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
    setApproving(true);
    setDraftError('');
    try {
      for (const id of selectedDrafts) {
        await saveDraftEdit(id);
        await approveInventoryDraft(id);
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
    setApproving(true);
    setDraftError('');
    try {
      await approveAllInventoryDrafts();
      mutateDrafts();
      mutateItems();
      setSelectedDrafts(new Set());
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setApproving(false);
    }
  }

  async function handleRejectDraft(id: string) {
    try {
      await rejectInventoryDraft(id);
      mutateDrafts();
      setSelectedDrafts((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Reject failed');
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
    if (otpModal.pendingAction === 'edit') handleEditVerified(actionToken);
    else handleDeleteVerified(actionToken);
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
                onClick={async () => {
                  try {
                    await clearProcessedDrafts();
                    mutateDrafts();
                  } catch (err) {
                    setDraftError(err instanceof Error ? err.message : 'Failed to clear drafts');
                  }
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
        }}
      />
    </div>
  );
}

// ── Orders Awaiting Inventory Arrival Section ─────────────────────────────

function InventoryVerificationSection() {
  const { data: orders = [], isLoading } = useOrdersByStage('inventory_verification');

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
        <Link
          href="/workflow"
          className="inline-flex items-center gap-1 rounded-md bg-white/80 px-2.5 py-1 text-[11px] font-medium text-teal-700 shadow-sm transition-colors hover:bg-white"
        >
          <ExternalLink className="h-3 w-3" />
          Workflow
        </Link>
      </div>
      <div className="divide-y divide-teal-100 px-5 py-2">
        {orders.map((order) => (
          <div key={order.id} className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <Package className="h-4 w-4 text-teal-500" />
              <div>
                <Link
                  href={`/orders/${encodeURIComponent(order.quotation_number ?? '')}`}
                  className="text-sm font-medium text-gray-900 hover:text-teal-700 hover:underline"
                >
                  #{order.quotation_number ?? 'N/A'}
                </Link>
                <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown'}</p>
                {order.inventory_verification_pct != null && (
                  <div className="mt-1 flex items-center gap-1">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-teal-500 transition-all"
                        style={{ width: `${order.inventory_verification_pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-medium text-teal-600">
                      {order.inventory_verification_pct}% verified
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-medium text-teal-700">
                Inventory Agent Active
              </span>
              <Link
                href={`/orders/${encodeURIComponent(order.quotation_number ?? '')}`}
                className="rounded p-1 text-gray-400 transition-colors hover:bg-teal-100 hover:text-teal-700"
              >
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InventoryArrivalSection() {
  const { data: orders = [], isLoading } = useOrdersByStage('inventory_arrived');

  // Fetch completion data for each order to get inventory_completion_pct
  const [completionMap, setCompletionMap] = useState<Record<string, number>>({});
  const [itemCountMap, setItemCountMap] = useState<Record<string, { arrived: number; total: number }>>({});

  useEffect(() => {
    if (orders.length === 0) return;
    let cancelled = false;

    async function fetchData() {
      const compMap: Record<string, number> = {};
      const itemMap: Record<string, { arrived: number; total: number }> = {};

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
            }
          } catch {
            // Silently fail — progress bars just won't show
          }
        })
      );

      if (!cancelled) {
        setCompletionMap(compMap);
        setItemCountMap(itemMap);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [orders]);

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
          const hasArrivalData = arrivalPct > 0 || (itemCount && itemCount.total > 0);

          // Determine agent status: actively processing vs awaiting response
          const isProcessing = arrivalPct > 0 && arrivalPct < 100;
          const isComplete = arrivalPct >= 100;
          const isAwaiting = arrivalPct === 0;

          return (
            <div key={order.id} className="flex items-center justify-between py-2">
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
              <div className="flex items-center gap-2">
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
          );
        })}
      </div>
    </div>
  );
}
