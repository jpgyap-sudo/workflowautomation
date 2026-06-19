'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import OtpModal from '@/components/OtpModal';
import ConfirmModal from '@/components/ConfirmModal';
import { generateActionToken } from '@/lib/api';
import { useInventory, useInventoryDrafts, useOrdersByStage, usePartialDeliveryVerificationOrders } from '@/lib/useApi';
import {
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  extractInventoryImage,
  bulkUploadInventory,
  updateInventoryDraft,
  approveSelectedInventoryDrafts,
  approveAllInventoryDrafts,
  rejectInventoryDraft,
  clearProcessedDrafts,
  bulkDeleteInventoryDrafts,
  deleteAllInventoryDrafts,
  bulkDeleteInventoryItems,
  getInventoryImageUrl,
  getItemCompletion,
  getOrderItems,
  inventoryVerifyItem,
  completeInventoryVerification,
  confirmInventoryArrived,
  updateOrderItem,
  getInventoryMovements,
  type OrderItem,
  type Order,
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
  History,
  RefreshCw,
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

const FURNITURE_CATEGORIES = [
  'Sofa', 'Armchair', 'Lounge Chair', 'Accent Chair', 'Chaise Lounge',
  'Bench', 'Ottoman & Pouf', 'Bar Stool', 'Dining Chair', 'Modular Seating',
  'Collection Set', 'Coffee Table', 'Center Table', 'Side Table', 'Console Table',
  'Dining Table', 'Sideboard', 'TV Cabinet', 'TV Stand', 'Night Stand',
  'Bed', 'Bed Bench', 'Ceiling Fan', 'Table Lamp', 'Pendant Light',
  'Ceiling Light', 'Floor Lamp', 'Wall Light', 'Rug', 'Throw Pillow',
  'Decorative', 'Wall Panel', 'Sintered Stone', 'Natural Stone',
  'Finish Material', 'Unknown',
];

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
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  // History modal
  const [historyModal, setHistoryModal] = useState<{ open: boolean; itemId: string | null; movements: any[]; loading: boolean }>({
    open: false,
    itemId: null,
    movements: [],
    loading: false,
  });

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
  type OtpPendingAction = 'edit' | 'delete';

  const [otpModal, setOtpModal] = useState<{
    open: boolean; title: string; description: string; pendingAction: OtpPendingAction; targetEmail?: string;
  }>({ open: false, title: '', description: '', pendingAction: 'edit' });

  type ConfirmPendingAction =
    | 'add' | 'bulk-upload'
    | 'approve-selected' | 'approve-all' | 'reject-draft' | 'clear-drafts'
    | 'bulk-delete-drafts' | 'delete-all-drafts' | 'bulk-delete-items';

  const [confirmModal, setConfirmModal] = useState<{
    open: boolean; title: string; description: string; pendingAction: ConfirmPendingAction;
  }>({ open: false, title: '', description: '', pendingAction: 'add' });

  // Selected inventory items for bulk actions
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

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
    const matchesSearch =
      item.product_name.toLowerCase().includes(q) ||
      (item.description ?? '').toLowerCase().includes(q) ||
      (item.dimension ?? '').toLowerCase().includes(q) ||
      (item.category ?? '').toLowerCase().includes(q);
    const matchesCategory = !selectedCategory || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
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
    setConfirmModal({
      open: true,
      title: 'Add Inventory Item',
      description: `You are about to add "${addForm.product_name.trim()}" to inventory. Confirm to proceed.`,
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
      setConfirmModal({
        open: true,
        title: 'Bulk Upload Inventory',
        description: `You are about to upload "${bulkFile.name}" for bulk inventory creation. Confirm to proceed.`,
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
    setConfirmModal({
      open: true,
      title: 'Approve Selected Drafts',
      description: `You are about to approve ${selectedDrafts.size} draft(s). Confirm to proceed.`,
      pendingAction: 'approve-selected',
    });
  }

  async function handleApproveSelectedVerified(actionToken: string) {
    setApproving(true);
    setDraftError('');
    try {
      await approveSelectedInventoryDrafts(Array.from(selectedDrafts), actionToken);
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
    setConfirmModal({
      open: true,
      title: 'Approve All Drafts',
      description: `You are about to approve all inventory drafts. Confirm to proceed.`,
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
    setConfirmModal({
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
    if (otpModal.pendingAction === 'edit') handleEditVerified(actionToken);
    else if (otpModal.pendingAction === 'delete') handleDeleteVerified(actionToken);
  }

  async function handleConfirmVerified(actionToken: string) {
    const action = confirmModal.pendingAction;
    try {
      if (action === 'add') await handleAddVerified(actionToken);
      else if (action === 'bulk-upload') await handleBulkUploadVerified(actionToken);
      else if (action === 'approve-selected') await handleApproveSelectedVerified(actionToken);
      else if (action === 'approve-all') await handleApproveAllVerified(actionToken);
      else if (action === 'reject-draft') await handleRejectDraftVerified(actionToken);
      else if (action === 'clear-drafts') await handleClearDraftsVerified(actionToken);
      else if (action === 'bulk-delete-drafts') await handleBulkDeleteDraftsVerified(actionToken);
      else if (action === 'delete-all-drafts') await handleDeleteAllDraftsVerified(actionToken);
      else if (action === 'bulk-delete-items') await handleBulkDeleteItemsVerified(actionToken);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setConfirmModal((prev) => ({ ...prev, open: false }));
    }
  }

  async function handleClearDraftsVerified(actionToken: string) {
    try {
      await clearProcessedDrafts(actionToken);
      mutateDrafts();
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Clear failed');
    }
  }

  // ── Bulk Delete Drafts ──
  function handleBulkDeleteDrafts() {
    if (selectedDrafts.size === 0) return;
    setConfirmModal({
      open: true,
      title: 'Delete Selected Drafts',
      description: `You are about to permanently delete ${selectedDrafts.size} selected draft(s). This cannot be undone.`,
      pendingAction: 'bulk-delete-drafts',
    });
  }

  async function handleBulkDeleteDraftsVerified(actionToken: string) {
    setApproving(true);
    setDraftError('');
    try {
      await bulkDeleteInventoryDrafts(Array.from(selectedDrafts), actionToken);
      mutateDrafts();
      setSelectedDrafts(new Set());
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Bulk delete failed');
    } finally {
      setApproving(false);
    }
  }

  function handleDeleteAllDrafts() {
    setConfirmModal({
      open: true,
      title: 'Delete All Pending Drafts',
      description: `You are about to permanently delete ALL ${drafts.length} pending draft(s). This cannot be undone.`,
      pendingAction: 'delete-all-drafts',
    });
  }

  async function handleDeleteAllDraftsVerified(actionToken: string) {
    setApproving(true);
    setDraftError('');
    try {
      await deleteAllInventoryDrafts(actionToken);
      mutateDrafts();
      setSelectedDrafts(new Set());
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Delete all failed');
    } finally {
      setApproving(false);
    }
  }

  // ── Inventory Item Selection & Bulk Delete ──
  function toggleItemSelect(id: string) {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllItems() {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map((i) => i.id)));
    }
  }

  function handleBulkDeleteItems() {
    if (selectedItems.size === 0) return;
    const names = filteredItems
      .filter((i) => selectedItems.has(i.id))
      .map((i) => i.product_name)
      .slice(0, 3)
      .join(', ');
    const more = selectedItems.size > 3 ? ` and ${selectedItems.size - 3} more` : '';
    setConfirmModal({
      open: true,
      title: 'Delete Selected Items',
      description: `You are about to permanently delete ${selectedItems.size} inventory item(s) (${names}${more}). This cannot be undone.`,
      pendingAction: 'bulk-delete-items',
    });
  }

  async function handleBulkDeleteItemsVerified(actionToken: string) {
    try {
      await bulkDeleteInventoryItems(Array.from(selectedItems), actionToken);
      mutateItems();
      setSelectedItems(new Set());
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Bulk delete failed');
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
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-dark)]"
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

      {/* Search + Category Filter */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search inventory..."
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-4 text-sm outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
          />
        </div>
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
        >
          <option value="">All Categories</option>
          {FURNITURE_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
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
        {selectedItems.size > 0 && (
          <div className="flex items-center gap-2 border-b border-gray-100 bg-amber-50/50 px-6 py-2">
            <span className="text-xs font-medium text-gray-600">{selectedItems.size} selected</span>
            <button
              onClick={handleBulkDeleteItems}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            >
              <Trash2 className="h-3 w-3" />
              Delete Selected
            </button>
            <button
              onClick={() => setSelectedItems(new Set())}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Clear selection
            </button>
          </div>
        )}
        {itemsLoading && items.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" />
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
                  <th className="px-4 py-3 w-10">
                    <button onClick={toggleAllItems} className="text-gray-400 hover:text-gray-600">
                      {selectedItems.size === filteredItems.length && filteredItems.length > 0 ? (
                        <CheckSquare className="h-5 w-5 text-[var(--primary)]" />
                      ) : (
                        <Square className="h-5 w-5" />
                      )}
                    </button>
                  </th>
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
                      <button onClick={() => toggleItemSelect(item.id)} className="text-gray-400 hover:text-gray-600">
                        {selectedItems.has(item.id) ? <CheckSquare className="h-5 w-5 text-[var(--primary)]" /> : <Square className="h-5 w-5" />}
                      </button>
                    </td>
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
                          placeholder="e.g. Sofa, Dining Table"
                          list="furniture-categories"
                        />
                      ) : item.category ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
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
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          item.quantity === 0
                            ? 'bg-red-100 text-red-700'
                            : item.quantity <= 2
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-gray-100 text-gray-700'
                        }`}>
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
                          <button
                            onClick={async () => {
                              setHistoryModal({ open: true, itemId: item.id, movements: [], loading: true });
                              try {
                                const res = await getInventoryMovements(item.id);
                                setHistoryModal((prev) => ({ ...prev, movements: res.movements ?? [], loading: false }));
                              } catch {
                                setHistoryModal((prev) => ({ ...prev, movements: [], loading: false }));
                              }
                            }}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                            title="View history"
                          >
                            <History className="h-4 w-4" />
                          </button>
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
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-8 transition-colors hover:border-[var(--primary)] hover:bg-emerald-50/50"
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
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Description</label>
                <textarea
                  value={addForm.description}
                  onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Hand-painted blue ceramic vase"
                  rows={2}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Category</label>
                <input
                  value={addForm.category}
                  onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="e.g. Sofa, Dining Table, Armchair"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
                  list="furniture-categories"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Dimension</label>
                  <input
                    value={addForm.dimension}
                    onChange={(e) => setAddForm((f) => ({ ...f, dimension: e.target.value }))}
                    placeholder="e.g. 20x15 cm"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Quantity</label>
                  <input
                    type="number"
                    value={addForm.quantity}
                    onChange={(e) => setAddForm((f) => ({ ...f, quantity: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
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
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-dark)] disabled:opacity-50"
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
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-10 transition-colors hover:border-[var(--primary)] hover:bg-emerald-50/50"
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
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-dark)] disabled:opacity-50"
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
                  <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" />
                </div>
              ) : drafts.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-400">No pending drafts</div>
              ) : (
                <div className="space-y-4">
                  {/* Bulk Actions */}
                  <div className="flex flex-wrap items-center gap-2">
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
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
                    >
                      Approve All
                    </button>
                    <button
                      onClick={handleBulkDeleteDrafts}
                      disabled={selectedDrafts.size === 0 || approving}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete Selected ({selectedDrafts.size})
                    </button>
                    <button
                      onClick={handleDeleteAllDrafts}
                      disabled={approving || drafts.length === 0}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete All Pending
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
                                  {selectedDrafts.has(draft.id) ? <CheckSquare className="h-5 w-5 text-[var(--primary)]" /> : <Square className="h-5 w-5" />}
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
                                  list="furniture-categories"
                                />
                                <datalist id="furniture-categories">
                                  {FURNITURE_CATEGORIES.map((cat) => (
                                    <option key={cat} value={cat} />
                                  ))}
                                </datalist>
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
                  setConfirmModal({
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

      {/* ── History Modal ── */}
      {historyModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Inventory History</h2>
              <button
                onClick={() => setHistoryModal({ open: false, itemId: null, movements: [], loading: false })}
                className="rounded p-1 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {historyModal.loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : historyModal.movements.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">No history available</div>
            ) : (
              <div className="space-y-2">
                {historyModal.movements.map((m: any) => (
                  <div key={m.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-700 capitalize">{m.type ?? 'adjustment'}</span>
                      <span className="text-gray-400">{new Date(m.created_at).toLocaleString()}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-gray-600">
                      <span>Qty: {m.quantity}</span>
                      <span className="text-gray-300">|</span>
                      <span>Before: {m.previous_quantity}</span>
                      <span className="text-gray-300">|</span>
                      <span>After: {m.new_quantity}</span>
                    </div>
                    {m.reason && <p className="mt-1 text-gray-500">{m.reason}</p>}
                    {m.created_by && <p className="mt-0.5 text-[10px] text-gray-400">By: {m.created_by}</p>}
                  </div>
                ))}
              </div>
            )}
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
        targetEmail={otpModal.targetEmail}
      />
      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        description={confirmModal.description}
        onVerified={handleConfirmVerified}
        onClose={() => {
          setConfirmModal({ ...confirmModal, open: false });
          (window as any).__pendingInventoryAdd = null;
          (window as any).__pendingBulkUpload = null;
          (window as any).__pendingRejectDraft = null;
        }}
      />
    </div>
  );
}

// ── Orders Awaiting Inventory Arrival Section ─────────────────────────────

function InventoryVerificationSection() {
  const { data: invVerifOrders = [], isLoading: invLoading, mutate: invMutate } = useOrdersByStage('inventory_verification');
  const { data: enRouteVerifOrders = [], isLoading: enRouteLoading, mutate: enRouteMutate } = useOrdersByStage('en_route_verification');
  const { data: partialDeliveryOrders = [], isLoading: partialLoading, mutate: partialMutate } = usePartialDeliveryVerificationOrders();
  const { data: inProgressOrders = [], isLoading: inProgressLoading, mutate: mutateInProgress } = useOrdersByStage('production_in_progress');
  const [itemSummaryMap, setItemSummaryMap] = useState<Record<string, { verified: number; total: number; totalQty: number; verifiedQty: number }>>({});
  const [enRouteOrdersWithArrived, setEnRouteOrdersWithArrived] = useState<Order[]>([]);
  const [inProgressOrdersWithArrived, setInProgressOrdersWithArrived] = useState<Order[]>([]);
  const [loadingEnRouteItems, setLoadingEnRouteItems] = useState(false);
  const [loadingInProgressItems, setLoadingInProgressItems] = useState(false);
  const [verifyingOrderId, setVerifyingOrderId] = useState<string | null>(null);

  // Merge all orders: inventory_verification + en_route_verification orders that have arrived items
  // + production_in_progress orders that have arrived items
  // + partial-delivery orders at later stages that still need verification
  const orders = [...invVerifOrders, ...enRouteOrdersWithArrived, ...inProgressOrdersWithArrived, ...partialDeliveryOrders];
  const isLoading = invLoading || enRouteLoading || loadingEnRouteItems || loadingInProgressItems || partialLoading || inProgressLoading;

  // Listen for SSE events to revalidate data
  useEffect(() => {
    const eventSource = new EventSource(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/events`);
    const handleUpdate = () => {
      invMutate();
      enRouteMutate();
      partialMutate();
      mutateInProgress();
    };
    eventSource.addEventListener('order_updated', handleUpdate);
    eventSource.addEventListener('invalidate', handleUpdate);
    return () => {
      eventSource.removeEventListener('order_updated', handleUpdate);
      eventSource.removeEventListener('invalidate', handleUpdate);
      eventSource.close();
    };
  }, [invMutate, enRouteMutate, partialMutate, mutateInProgress]);

  // Filter en_route_verification orders to only those with arrived items
  useEffect(() => {
    if (enRouteVerifOrders.length === 0) {
      setEnRouteOrdersWithArrived([]);
      return;
    }
    let cancelled = false;
    setLoadingEnRouteItems(true);
    async function fetchEnRouteItems() {
      const result: Order[] = [];
      await Promise.all(enRouteVerifOrders.map(async (order) => {
        try {
          const res = await getOrderItems(order.id);
          const items = res.items ?? [];
          const hasArrivedItems = items.some((item) => item.en_route_status === 'arrived');
          if (hasArrivedItems) {
            result.push(order);
          }
        } catch {
          // Silently skip orders we can't fetch items for
        }
      }));
      if (!cancelled) {
        setEnRouteOrdersWithArrived(result);
        setLoadingEnRouteItems(false);
      }
    }
    fetchEnRouteItems();
    return () => { cancelled = true; };
  }, [enRouteVerifOrders]);

  // Filter production_in_progress orders to only those with arrived items
  useEffect(() => {
    if (inProgressOrders.length === 0) {
      setInProgressOrdersWithArrived([]);
      return;
    }
    let cancelled = false;
    setLoadingInProgressItems(true);
    async function fetchInProgressItems() {
      const result: Order[] = [];
      await Promise.all(inProgressOrders.map(async (order) => {
        try {
          const res = await getOrderItems(order.id);
          const items = res.items ?? [];
          const hasArrivedItems = items.some((item) => item.en_route_status === 'arrived');
          if (hasArrivedItems) {
            result.push(order);
          }
        } catch {
          // Silently skip orders we can't fetch items for
        }
      }));
      if (!cancelled) {
        setInProgressOrdersWithArrived(result);
        setLoadingInProgressItems(false);
      }
    }
    fetchInProgressItems();
    return () => { cancelled = true; };
  }, [inProgressOrders]);

  useEffect(() => {
    if (orders.length === 0) {
      setItemSummaryMap({});
      return;
    }
    let cancelled = false;
    async function fetchSummaries() {
      const summary: Record<string, { verified: number; total: number; totalQty: number; verifiedQty: number }> = {};
      await Promise.all(orders.map(async (order) => {
        try {
          const res = await getOrderItems(order.id);
          const items = res.items ?? [];
          summary[order.id] = {
            verified: items.filter((item) => (item.verified_qty ?? 0) >= item.quantity).length,
            total: items.length,
            totalQty: items.reduce((sum, item) => sum + item.quantity, 0),
            verifiedQty: items.reduce((sum, item) => sum + (item.verified_qty ?? 0), 0),
          };
        } catch {
          summary[order.id] = { verified: 0, total: 0, totalQty: 0, verifiedQty: 0 };
        }
      }));
      if (!cancelled) setItemSummaryMap(summary);
    }
    fetchSummaries();
    return () => { cancelled = true; };
  }, [orders.map((order) => order.id).sort().join('|')]);

  // Quick-verify all arrived items for a production_in_progress order (item-level, no stage change)
  async function handleQuickVerifyArrived(order: Order) {
    if (!order.quotation_number) { alert('Cannot verify: this order has no quotation number.'); return; }
    setVerifyingOrderId(order.id);
    try {
      // Fetch items to find which ones have arrived
      const res = await getOrderItems(order.id);
      const arrivedItems = (res.items ?? []).filter((item: OrderItem) => item.en_route_status === 'arrived');
      if (arrivedItems.length === 0) { alert('No arrived items to verify for this order.'); setVerifyingOrderId(null); return; }
      if (!window.confirm(`Quick-verify ${arrivedItems.length} arrived item(s) for order "${order.quotation_number}"? This marks items as inventory-verified without changing the order stage.`)) { setVerifyingOrderId(null); return; }
      const tokenResult = await generateActionToken('system', 'dashboard');
      if (!tokenResult.ok || !tokenResult.actionToken) { alert('Failed to generate action token.'); setVerifyingOrderId(null); return; }
      // Verify each arrived item individually
      for (const item of arrivedItems) {
        await inventoryVerifyItem(order.id, {
          item_id: item.id,
          action: 'all',
          action_token: tokenResult.actionToken,
        });
      }
      // Refresh data
      invMutate();
      enRouteMutate();
      partialMutate();
      mutateInProgress();
    } catch (err: any) {
      alert('Failed to verify arrived items: ' + (err.message ?? 'Unknown error'));
    } finally {
      setVerifyingOrderId(null);
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
        <span className="ml-auto rounded-full bg-teal-200 px-2 py-0.5 text-[10px] font-bold text-teal-800">{orders.length}</span>
        <Link href="/workflow" className="inline-flex items-center gap-1 rounded-md bg-white/80 px-2.5 py-1 text-[11px] font-medium text-teal-700 shadow-sm transition-colors hover:bg-white">
          <ExternalLink className="h-3 w-3" /> Workflow
        </Link>
      </div>
      <div className="divide-y divide-teal-100 px-5 py-2">
        {orders.map((order) => {
          const summary = itemSummaryMap[order.id] ?? { verified: 0, total: 0, totalQty: 0, verifiedQty: 0 };
          const verificationUrl = `/inventory/verification/${encodeURIComponent(order.quotation_number ?? order.id)}`;
          const isEarlyVerification = order.current_stage === 'en_route_verification';
          const isPartialDeliveryOrder = order.partial_delivery === true && !['inventory_verification', 'en_route_verification'].includes(order.current_stage);
          return (
            <div key={order.id} className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <Package className="h-4 w-4 text-teal-500" />
                <div>
                  <Link href={verificationUrl} className="text-sm font-medium text-gray-900 hover:text-teal-700 hover:underline">
                    #{order.quotation_number ?? 'N/A'}
                  </Link>
                  <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown'}</p>
                  <div className="mt-1 flex items-center gap-1">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200">
                      <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${order.inventory_verification_pct ?? 0}%` }} />
                    </div>
                    <span className="text-[10px] font-medium text-teal-600">
                      {order.inventory_verification_pct ?? 0}% verified ? {summary.verified}/{summary.total} item(s) ? {summary.verifiedQty}/{summary.totalQty} units
                    </span>
                  </div>
                  {isEarlyVerification && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                      <Clock className="h-3 w-3" /> Early verification — some items still in transit
                    </span>
                  )}
                  {isPartialDeliveryOrder && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700">
                      <RefreshCw className="h-3 w-3" /> Partial delivery — verifying remaining items
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {order.current_stage === 'production_in_progress' && (
                  <button
                    type="button"
                    disabled={verifyingOrderId === order.id}
                    onClick={() => handleQuickVerifyArrived(order)}
                    className="inline-flex items-center gap-1 rounded-md bg-teal-600 px-2.5 py-1 text-[10px] font-medium text-white shadow-sm transition-colors hover:bg-teal-700 disabled:opacity-50"
                  >
                    {verifyingOrderId === order.id ? (
                      <><Loader2 className="h-3 w-3 animate-spin" /> Verifying…</>
                    ) : (
                      <><CheckCircle className="h-3 w-3" /> Quick Verify All Arrived</>
                    )}
                  </button>
                )}
                <Link href={verificationUrl} className="inline-flex items-center gap-1 rounded-md bg-teal-600 px-2.5 py-1 text-[10px] font-medium text-white shadow-sm transition-colors hover:bg-teal-700">
                  <ExternalLink className="h-3 w-3" /> Open Verification Link
                </Link>
                <span className="inline-flex items-center rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-medium text-teal-700">Permanent Link</span>
              </div>
            </div>
          );
        })}
      </div>
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

  // Confirm modal state for "Confirm All Arrived" action
  const [arrivalConfirm, setArrivalConfirm] = useState<{ open: boolean; orderId: string; quotationNumber: string }>({
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
    if (!arrivalConfirm.orderId) return;
    setConfirming(true);
    try {
      await confirmInventoryArrived(arrivalConfirm.orderId, actionToken);
      mutate();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to confirm arrival');
    } finally {
      setConfirming(false);
      setArrivalConfirm({ open: false, orderId: '', quotationNumber: '' });
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
                      setArrivalConfirm({
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

      {/* Confirm Modal for Confirm All Arrived */}
      <ConfirmModal
        open={arrivalConfirm.open}
        title="Confirm Inventory Arrival"
        description={`You are about to confirm all inventory has arrived for order #${arrivalConfirm.quotationNumber}. Confirm to proceed.`}
        onVerified={handleConfirmAllArrived}
        onClose={() => setArrivalConfirm({ open: false, orderId: '', quotationNumber: '' })}
      />
    </div>
  );
}
