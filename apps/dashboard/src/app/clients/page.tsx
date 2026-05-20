'use client';

import { useState } from 'react';
import { useClients } from '@/lib/useApi';
import type { Client } from '@/lib/api';
import { createClient, updateClient, deleteClient } from '@/lib/api';
import { Users, Plus, Pencil, Trash2, X, Check, Search, MapPin, Phone, UserCheck } from 'lucide-react';

interface ClientFormProps {
  client?: Client | null;
  onSave: (data: {
    client_name: string;
    delivery_address?: string;
    contact_number?: string;
    authorized_receiver_name?: string;
    authorized_receiver_contact?: string;
    notes?: string;
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
    onSave({
      client_name: clientName.trim(),
      delivery_address: deliveryAddress.trim() || undefined,
      contact_number: contactNumber.trim() || undefined,
      authorized_receiver_name: authReceiverName.trim() || undefined,
      authorized_receiver_contact: authReceiverContact.trim() || undefined,
      notes: notes.trim() || undefined,
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
  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = clients.filter((c) =>
    c.client_name.toLowerCase().includes(search.toLowerCase()) ||
    (c.delivery_address ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (c.contact_number ?? '').toLowerCase().includes(search.toLowerCase())
  );

  async function handleAdd(data: Parameters<typeof createClient>[0]) {
    setSaving(true);
    try {
      await createClient(data);
      setShowForm(false);
      mutate();
    } catch (err: any) {
      alert('Failed to add client: ' + (err.message ?? 'Unknown error'));
    } finally {
      setSaving(false);
    }
  }

  async function handleEditSave(data: Parameters<typeof updateClient>[1]) {
    if (!editingClient) return;
    setSaving(true);
    try {
      await updateClient(editingClient.id, data);
      setEditingClient(null);
      mutate();
    } catch (err: any) {
      alert('Failed to update client: ' + (err.message ?? 'Unknown error'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deletingClient) return;
    setSaving(true);
    try {
      await deleteClient(deletingClient.id);
      setDeletingClient(null);
      mutate();
    } catch (err: any) {
      alert('Failed to delete client: ' + (err.message ?? 'Unknown error'));
    } finally {
      setSaving(false);
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
            {clients.length}
          </span>
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
                  <th className="px-6 py-3 font-medium text-gray-600">Client Name</th>
                  <th className="px-6 py-3 font-medium text-gray-600">Delivery Address</th>
                  <th className="px-6 py-3 font-medium text-gray-600">Contact</th>
                  <th className="px-6 py-3 font-medium text-gray-600">Authorized Receiver</th>
                  <th className="px-6 py-3 font-medium text-gray-600">Receiver Contact</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{client.client_name}</td>
                    <td className="px-6 py-4 text-gray-600">
                      <div className="flex items-start gap-1.5">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                        <span className="max-w-xs truncate">{client.delivery_address ?? '—'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      <div className="flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 text-gray-400" />
                        <span>{client.contact_number ?? '—'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      <div className="flex items-center gap-1.5">
                        <UserCheck className="h-3.5 w-3.5 text-gray-400" />
                        <span>{client.authorized_receiver_name ?? '—'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {client.authorized_receiver_contact ?? '—'}
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
                          onClick={() => setDeletingClient(client)}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                          title="Delete client"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
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
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDeletingClient(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={saving}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
