'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useClients } from '@/lib/useApi';
import type { Client } from '@/lib/api';
import { createClient, updateClient, deleteClient, bulkDeleteClients, searchClients, getClientOrders, generateActionToken } from '@/lib/api';
import { Users, Plus, Pencil, Trash2, X, Check, Search, MapPin, Phone, UserCheck, ChevronDown, ChevronRight, FileText, ExternalLink } from 'lucide-react';
import { useEffect } from 'react';
import OtpModal from '@/components/OtpModal';
import ConfirmModal from '@/components/ConfirmModal';

interface ClientFormProps {
  client?: Client | null;
  onSave: (data: {
    client_name: string;
    delivery_address?: string | null;
    contact_number?: string | null;
    authorized_receiver_name?: string | null;
    authorized_receiver_contact?: string | null;
    notes?: string | null;
    propagate_to_orders?: boolean;
  }) => void;
  onCancel: () => void;
  saving: boolean;
}

function ClientForm({ client, onSave, onCancel, saving }: ClientFormProps) {
  const [clientName, setClientName] = useState(client?.client_name ?? '');
  const [deliveryAddress, setDeliveryAddress] = useState(client?.delivery_address ?? '');
  const [contactNumber, setContactNumber] = useState(client?.contact_number ?? '');
  const [authReceiverName, setAuthReceiverName] = useState(client?.authorized_receiver_name ?? '');
  const [authReceiverContact, setAuthReceiverContact] = useState(client?.authorized_receiver_contact ?? '');
  const [notes, setNotes] = useState(client?.notes ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const optional = (value: string) => {
      const trimmed = value.trim();
      return client ? (trimmed || null) : (trimmed || undefined);
    };
    onSave({
      client_name: clientName.trim(),
      delivery_address: optional(deliveryAddress),
      contact_number: optional(contactNumber),
      authorized_receiver_name: optional(authReceiverName),
      authorized_receiver_contact: optional(authReceiverContact),
      notes: optional(notes),
      propagate_to_orders: true,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-base font-semibold text-gray-800">
        {client ? 'Edit Client' : 'Add New Client'}
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-gray-600">Client Name *</label>
          <input
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="e.g. ABC Corporation"
            required
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-gray-600">Delivery Address</label>
          <input
            value={deliveryAddress}
            onChange={(e) => setDeliveryAddress(e.target.value)}
            placeholder="Full delivery address"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Contact Number</label>
          <input
            value={contactNumber}
            onChange={(e) => setContactNumber(e.target.value)}
            placeholder="e.g. 0917-123-4567"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Authorized Receiver Name</label>
          <input
            value={authReceiverName}
            onChange={(e) => setAuthReceiverName(e.target.value)}
            placeholder="If different from client"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Authorized Receiver Contact</label>
          <input
            value={authReceiverContact}
            onChange={(e) => setAuthReceiverContact(e.target.value)}
            placeholder="Receiver's contact number"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-gray-600">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any special delivery instructions..."
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
          />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <X className="h-4 w-4" />
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !clientName.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-[#2490ef] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a7ad9] disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
          {saving ? 'Saving...' : client ? 'Update Client' : 'Add Client'}
        </button>
      </div>
    </form>
  );
}

export default function ClientsPage() {
  const { data: clients = [], isLoading, mutate } = useClients();
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Client[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkForceDelete, setBulkForceDelete] = useState(false);
  const [forceDelete, setForceDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);
  const [clientOrders, setClientOrders] = useState<Record<string, any[]>>({});
  const [loadingOrders, setLoadingOrders] = useState<Record<string, boolean>>({});
  const [otpModal, setOtpModal] = useState<{
    open: boolean; title: string; description: string; pendingAction: 'edit' | 'delete' | 'bulk-delete';
  }>({ open: false, title: '', description: '', pendingAction: 'edit' });
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean; title: string; description: string;
  }>({ open: false, title: '', description: '' });

  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setSearchResults(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        setSearchResults(await searchClients(q));
      } catch (err: any) {
        console.error('Client search failed:', err);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [search]);

  const filtered = searchResults ?? clients;
  const visibleIds = filtered.map((client) => client.id);
  const selectedClients = clients.filter((client) => selectedIds.has(client.id));
  const selectedVisibleClients = filtered.filter((client) => selectedIds.has(client.id));
  const selectedActiveOrderCount = selectedClients.reduce((sum, client) => sum + Number(client.active_order_count ?? 0), 0);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = visibleIds.some((id) => selectedIds.has(id)) && !allSelected;

  function handleSelectClient(id: string, selected: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleSelectAll(selected: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function toggleExpanded(client: Client) {
    const next = expandedClientId === client.id ? null : client.id;
    setExpandedClientId(next);
    if (next && !clientOrders[client.id]) {
      setLoadingOrders((prev) => ({ ...prev, [client.id]: true }));
      try {
        const orders = await getClientOrders(client.id);
        setClientOrders((prev) => ({ ...prev, [client.id]: orders }));
      } catch (err: any) {
        alert('Failed to load linked orders: ' + (err.message ?? 'Unknown error'));
      } finally {
        setLoadingOrders((prev) => ({ ...prev, [client.id]: false }));
      }
    }
  }

  function handleAdd(data: {
    client_name: string;
    delivery_address?: string | null;
    contact_number?: string | null;
    authorized_receiver_name?: string | null;
    authorized_receiver_contact?: string | null;
    notes?: string | null;
    propagate_to_orders?: boolean;
  }) {
    (window as any).__pendingClientAdd = data;
    setConfirmModal({ open: true, title: 'Add Client',
      description: `You are about to add a new client "${data.client_name}".` });
  }

  async function handleAddVerified(actionToken: string) {
    const pending = (window as any).__pendingClientAdd;
    if (!pending) return;
    setSaving(true);
    try {
      await createClient({ ...pending, action_token: actionToken });
      setShowForm(false);
      mutate();
      setSearchResults(null);
      setSearch('');
    } catch (err: any) {
      alert('Failed to add client: ' + (err.message ?? 'Unknown error'));
    } finally {
      setSaving(false);
      (window as any).__pendingClientAdd = null;
    }
  }

  function handleEditSave(data: {
    client_name: string;
    delivery_address?: string | null;
    contact_number?: string | null;
    authorized_receiver_name?: string | null;
    authorized_receiver_contact?: string | null;
    notes?: string | null;
    propagate_to_orders?: boolean;
  }) {
    if (!editingClient) return;
    (window as any).__pendingClientEdit = { clientId: editingClient.id, data };
    setOtpModal({ open: true, title: 'Edit Client',
      description: `You are about to edit client "${editingClient.client_name}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'edit' });
  }

  async function handleEditVerified(actionToken: string) {
    const pending = (window as any).__pendingClientEdit;
    if (!pending) return;
    setSaving(true);
    try {
      await updateClient(pending.clientId, { ...pending.data, action_token: actionToken });
      setEditingClient(null);
      mutate();
      if (search.trim()) setSearchResults(await searchClients(search.trim()));
      setClientOrders((prev) => { const next = { ...prev }; delete next[pending.clientId]; return next; });
    } catch (err: any) {
      alert('Failed to update client: ' + (err.message ?? 'Unknown error'));
    } finally {
      setSaving(false);
      (window as any).__pendingClientEdit = null;
    }
  }

  function handleDeleteClick() {
    if (!deletingClient) return;
    setOtpModal({ open: true, title: 'Delete Client',
      description: `You are about to permanently delete client "${deletingClient.client_name}". Enter the OTP sent to your email to confirm.`,
      pendingAction: 'delete' });
  }

  async function handleDeleteVerified(actionToken: string) {
    if (!deletingClient) return;
    setSaving(true);
    try {
      await deleteClient(deletingClient.id, forceDelete, actionToken);
      setDeletingClient(null);
      setForceDelete(false);
      mutate();
      if (search.trim()) setSearchResults(await searchClients(search.trim()));
    } catch (err: any) {
      alert('Failed to delete client: ' + (err.message ?? 'Unknown error'));
    } finally {
      setSaving(false);
    }
  }

  function handleBulkDeleteClick() {
    if (selectedIds.size === 0) return;
    setBulkForceDelete(false);
    setBulkDeleteOpen(true);
  }

  function handleBulkDeleteConfirm() {
    const names = selectedClients.map((client) => client.client_name).slice(0, 5).join(', ');
    const more = selectedIds.size > 5 ? ` and ${selectedIds.size - 5} more` : '';
    setOtpModal({
      open: true,
      title: 'Bulk Delete Clients',
      description: `You are about to permanently delete ${selectedIds.size} client(s): ${names}${more}. Enter the OTP sent to your email to confirm.`,
      pendingAction: 'bulk-delete',
    });
  }

  async function handleBulkDeleteVerified(actionToken: string) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkDeleting(true);
    try {
      await bulkDeleteClients(ids, bulkForceDelete, actionToken);
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      setBulkForceDelete(false);
      setExpandedClientId(null);
      setClientOrders({});
      mutate();
      if (search.trim()) setSearchResults(await searchClients(search.trim()));
    } catch (err: any) {
      alert('Failed to delete selected clients: ' + (err.message ?? 'Unknown error'));
    } finally {
      setBulkDeleting(false);
    }
  }

  function handleOtpVerified(actionToken: string) {
    if (otpModal.pendingAction === 'edit') handleEditVerified(actionToken);
    else if (otpModal.pendingAction === 'bulk-delete') handleBulkDeleteVerified(actionToken);
    else handleDeleteVerified(actionToken);
  }

  async function handleConfirmVerified() {
    try {
      const result = await generateActionToken('dashboard_auto', 'dashboard');
      if (!result.ok || !result.actionToken) {
        alert('Failed to generate action token. Please try again.');
        return;
      }
      await handleAddVerified(result.actionToken);
      setConfirmModal((prev) => ({ ...prev, open: false }));
    } catch (err: any) {
      alert('Action failed: ' + (err.message ?? 'Unknown error'));
    }
  }

  if (isLoading && clients.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-[#2490ef]" />
          <h1 className="text-lg font-semibold text-gray-900">Client Database</h1>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {searchResults ? filtered.length : clients.length}
          </span>
          {searching && <span className="text-xs text-gray-400">Searching...</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients..."
              className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20 sm:w-64"
            />
          </div>
          <button
            onClick={() => {
              setEditingClient(null);
              setShowForm(true);
            }}
            className="flex items-center gap-1.5 rounded-lg bg-[#2490ef] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a7ad9]"
          >
            <Plus className="h-4 w-4" />
            Add Client
          </button>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showForm && !editingClient && (
        <ClientForm onSave={handleAdd} onCancel={() => setShowForm(false)} saving={saving} />
      )}
      {editingClient && (
        <ClientForm
          client={editingClient}
          onSave={handleEditSave}
          onCancel={() => setEditingClient(null)}
          saving={saving}
        />
      )}

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <span className="text-sm font-medium text-red-700">
            {selectedIds.size} client{selectedIds.size > 1 ? 's' : ''} selected
            {selectedActiveOrderCount > 0 && (
              <span className="ml-2 font-normal text-amber-700">
                ({selectedActiveOrderCount} active linked order{selectedActiveOrderCount > 1 ? 's' : ''})
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              Clear Selection
            </button>
            <button
              onClick={handleBulkDeleteClick}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Selected
            </button>
          </div>
        </div>
      )}

      {/* Clients Table */}
      <div className="rounded-xl border border-gray-200 bg-white">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Users className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm text-gray-500">
              {search ? 'No clients match your search.' : 'No clients yet. Add your first client above.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-[#2490ef] focus:ring-[#2490ef]"
                      aria-label="Select all visible clients"
                    />
                  </th>
                  <th className="px-6 py-3 font-medium text-gray-600">Client Name</th>
                  <th className="px-6 py-3 font-medium text-gray-600">Delivery Address</th>
                  <th className="px-6 py-3 font-medium text-gray-600">Contact</th>
                  <th className="px-6 py-3 font-medium text-gray-600">Authorized Receiver</th>
                  <th className="px-6 py-3 font-medium text-gray-600">Receiver Contact</th>
                  <th className="px-6 py-3 font-medium text-gray-600">Orders</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((client) => (
                  <Fragment key={client.id}>
                    <tr className={selectedIds.has(client.id) ? 'bg-blue-50/40 hover:bg-blue-50' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(client.id)}
                          onChange={(e) => handleSelectClient(client.id, e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-[#2490ef] focus:ring-[#2490ef]"
                          aria-label={`Select ${client.client_name}`}
                        />
                      </td>
                      <td className="px-6 py-4 font-medium text-gray-900">
                        <button
                          onClick={() => toggleExpanded(client)}
                          className="mr-2 inline-flex rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                          title="Show details and linked orders"
                        >
                          {expandedClientId === client.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                        {client.client_name}
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        <div className="flex items-start gap-1.5">
                          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                          <span className="max-w-xs truncate">{client.delivery_address ?? '-'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        <div className="flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5 text-gray-400" />
                          <span>{client.contact_number ?? '-'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        <div className="flex items-center gap-1.5">
                          <UserCheck className="h-3.5 w-3.5 text-gray-400" />
                          <span>{client.authorized_receiver_name ?? '-'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {client.authorized_receiver_contact ?? '-'}
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        <div className="text-xs">
                          <span className="font-medium text-gray-800">{client.order_count ?? 0}</span>
                          <span className="text-gray-400"> total</span>
                          {(client.active_order_count ?? 0) > 0 && (
                            <span className="ml-1 rounded-full bg-green-50 px-1.5 py-0.5 text-green-700">
                              {client.active_order_count} active
                            </span>
                          )}
                          {client.latest_order_at && (
                            <div className="mt-0.5 text-gray-400">
                              Last {new Date(client.latest_order_at).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => {
                              setShowForm(false);
                              setEditingClient(client);
                            }}
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#2490ef]"
                            title="Edit client"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => {
                              setForceDelete(false);
                              setDeletingClient(client);
                            }}
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                            title="Delete client"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedClientId === client.id && (
                      <tr className="bg-gray-50/60">
                        <td colSpan={8} className="px-6 py-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</h4>
                              <p className="rounded-lg bg-white p-3 text-sm text-gray-600">
                                {client.notes || 'No notes recorded.'}
                              </p>
                            </div>
                            <div>
                              <h4 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                <FileText className="h-3.5 w-3.5" />
                                Linked Orders
                              </h4>
                              {loadingOrders[client.id] ? (
                                <p className="rounded-lg bg-white p-3 text-sm text-gray-400">Loading orders...</p>
                              ) : (clientOrders[client.id]?.length ?? 0) === 0 ? (
                                <p className="rounded-lg bg-white p-3 text-sm text-gray-400">No linked orders found.</p>
                              ) : (
                                <div className="max-h-48 overflow-auto rounded-lg bg-white">
                                  {clientOrders[client.id].map((order) => (
                                    <Link
                                      key={order.id}
                                      href={`/orders/${encodeURIComponent(order.quotation_number ?? order.id)}`}
                                      className="flex items-center justify-between border-b border-gray-100 px-3 py-2 text-xs last:border-0 hover:bg-blue-50/40 transition-colors"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <p className="flex items-center gap-1 font-medium text-[#2490ef] hover:underline">
                                          {order.quotation_number ?? '-'}
                                          <ExternalLink className="h-3 w-3 shrink-0" />
                                        </p>
                                        <p className="text-gray-400">{order.current_stage}</p>
                                      </div>
                                      <div className="ml-3 shrink-0 text-right">
                                        <p className="text-gray-600">{order.status}</p>
                                        {order.total_amount != null && (
                                          <p className="text-gray-400">PHP {Number(order.total_amount).toLocaleString()}</p>
                                        )}
                                      </div>
                                    </Link>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deletingClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">Delete Client</h3>
            <p className="mt-2 text-sm text-gray-600">
              Are you sure you want to delete <strong>{deletingClient.client_name}</strong>? This cannot be undone.
            </p>
            {(deletingClient.active_order_count ?? 0) > 0 && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                This client has <strong>{deletingClient.active_order_count}</strong> active linked order(s).
                Deleting will unlink the client profile from those orders, while preserving the copied delivery details on each order.
                <label className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={forceDelete}
                    onChange={(e) => setForceDelete(e.target.checked)}
                  />
                  I understand — unlink active orders and delete this client.
                </label>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setForceDelete(false);
                  setDeletingClient(null);
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteClick}
                disabled={saving || ((deletingClient.active_order_count ?? 0) > 0 && !forceDelete)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">Bulk Delete Clients</h3>
            <p className="mt-2 text-sm text-gray-600">
              Delete <strong>{selectedIds.size}</strong> selected client{selectedIds.size > 1 ? 's' : ''}? This cannot be undone.
            </p>
            <div className="mt-3 max-h-36 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
              {(selectedClients.length ? selectedClients : selectedVisibleClients).slice(0, 20).map((client) => (
                <div key={client.id} className="flex justify-between gap-3 py-0.5">
                  <span className="truncate">{client.client_name}</span>
                  {(client.active_order_count ?? 0) > 0 && <span className="shrink-0 text-amber-700">{client.active_order_count} active</span>}
                </div>
              ))}
              {selectedIds.size > 20 && <div className="pt-1 text-gray-400">and {selectedIds.size - 20} more...</div>}
            </div>
            {selectedActiveOrderCount > 0 && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                Selected clients have <strong>{selectedActiveOrderCount}</strong> active linked order(s).
                Deleting will unlink the client profiles from those orders, while preserving copied delivery details on each order.
                <label className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={bulkForceDelete}
                    onChange={(e) => setBulkForceDelete(e.target.checked)}
                  />
                  I understand — unlink active orders and delete these clients.
                </label>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setBulkDeleteOpen(false);
                  setBulkForceDelete(false);
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                disabled={bulkDeleting}
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDeleteConfirm}
                disabled={bulkDeleting || (selectedActiveOrderCount > 0 && !bulkForceDelete)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {bulkDeleting ? 'Deleting...' : 'Delete Selected'}
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
        onClose={() => { setOtpModal({ ...otpModal, open: false }); (window as any).__pendingClientEdit = null; }}
      />

      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        description={confirmModal.description}
        onVerified={handleConfirmVerified}
        onClose={() => { setConfirmModal({ ...confirmModal, open: false }); (window as any).__pendingClientAdd = null; }}
      />
    </div>
  );
}
