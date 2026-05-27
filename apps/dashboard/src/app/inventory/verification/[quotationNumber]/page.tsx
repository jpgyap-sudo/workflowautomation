'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import OtpModal from '@/components/OtpModal';
import StageBadge from '@/components/StageBadge';
import {
  getOrder,
  getOrderItems,
  inventoryVerifyItem,
  completeInventoryVerification,
  bulkInventoryVerify,
  bulkInventoryUnverify,
  type OrderDetail,
  type OrderItem,
} from '@/lib/api';
import { ArrowLeft, CheckCircle, Loader2, Package, Search, Undo2, Warehouse } from 'lucide-react';

function formatDate(value: string | null | undefined) {
  if (!value) return '?';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '?';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function InventoryVerificationDetailPage() {
  const params = useParams<{ quotationNumber: string }>();
  const quotationNumber = decodeURIComponent(params.quotationNumber ?? '');
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [itemOtp, setItemOtp] = useState<{
    open: boolean;
    itemId: string;
    itemName: string;
    action: 'all' | 'partial' | 'not_yet';
    verifiedQty?: number;
    arrivedQty?: number;
  }>({ open: false, itemId: '', itemName: '', action: 'all' });
  const [completeOtpOpen, setCompleteOtpOpen] = useState(false);

  // Multi-select state for bulk verify
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [bulkVerifyOtpOpen, setBulkVerifyOtpOpen] = useState(false);
  const [bulkVerifying, setBulkVerifying] = useState(false);
  const [bulkAction, setBulkAction] = useState<'verify_all' | 'partial' | 'not_yet' | 'unverify' | 'arrived'>('verify_all');
  const [bulkPartialQty, setBulkPartialQty] = useState<number>(0);
  const [showBulkPartialInput, setShowBulkPartialInput] = useState(false);

  // Arrived Qty state — per-item input for actual arrived quantity
  const [arrivedQtyInputs, setArrivedQtyInputs] = useState<Record<string, string>>({});
  const [bulkArrivedQty, setBulkArrivedQty] = useState<string>('');

  const canVerify = order?.current_stage === 'inventory_verification';
  const totalQty = items.reduce((sum, item) => sum + item.quantity, 0);
  const verifiedQty = items.reduce((sum, item) => sum + (item.verified_qty ?? 0), 0);
  const fullyVerified = items.filter((item) => (item.verified_qty ?? 0) >= item.quantity).length;
  const pct = totalQty > 0 ? Math.round((verifiedQty / totalQty) * 100) : 0;

  // Items that can be selected for bulk verify (not yet fully verified)
  const selectableItems = items.filter((item) => (item.verified_qty ?? 0) < item.quantity);
  const allSelected = selectableItems.length > 0 && selectableItems.every((i) => selectedItemIds.has(i.id));
  const someSelected = selectedItemIds.size > 0 && !allSelected;

  async function load() {
    if (!quotationNumber) return;
    setLoading(true);
    setError('');
    try {
      const orderData = await getOrder(quotationNumber);
      const itemData = await getOrderItems(orderData.id);
      setOrder(orderData);
      setItems(itemData.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inventory verification data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [quotationNumber]);

  function toggleSelectItem(itemId: string) {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedItemIds((prev) => {
      if (allSelected) return new Set();
      return new Set(selectableItems.map((i) => i.id));
    });
  }

  function openItemOtp(item: OrderItem, action: 'all' | 'partial' | 'not_yet') {
    if (!canVerify) return;
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
    setItemOtp({ open: true, itemId: item.id, itemName: item.name, action, verifiedQty });
  }

  /** Open OTP for recording arrived quantity on a single item */
  function openArrivedQtyOtp(item: OrderItem) {
    if (!canVerify) return;
    const input = arrivedQtyInputs[item.id];
    const qty = Number(input?.replace(/[^0-9]/g, '') ?? item.quantity);
    if (!Number.isInteger(qty) || qty < 0) {
      alert('Enter a valid non-negative integer for arrived quantity.');
      return;
    }
    setItemOtp({ open: true, itemId: item.id, itemName: item.name, action: 'partial', arrivedQty: qty });
  }

  async function handleItemOtp(actionToken: string) {
    if (!order || !itemOtp.itemId) return;
    setBusyItemId(itemOtp.itemId);
    try {
      if (itemOtp.arrivedQty !== undefined) {
        // Use arrived_qty mode — passes arrived_qty to server
        await inventoryVerifyItem(order.id, {
          item_id: itemOtp.itemId,
          action: 'partial',
          arrived_qty: itemOtp.arrivedQty,
          action_token: actionToken,
        });
      } else {
        await inventoryVerifyItem(order.id, {
          item_id: itemOtp.itemId,
          action: itemOtp.action,
          verified_qty: itemOtp.verifiedQty,
          action_token: actionToken,
        });
      }
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to verify item');
    } finally {
      setBusyItemId(null);
      setItemOtp({ open: false, itemId: '', itemName: '', action: 'all' });
    }
  }

  async function handleCompleteOtp(actionToken: string) {
    if (!order) return;
    setCompleting(true);
    try {
      await completeInventoryVerification(order.id, actionToken);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to complete verification');
    } finally {
      setCompleting(false);
      setCompleteOtpOpen(false);
    }
  }

  function handleBulkVerifyClick(action: 'verify_all' | 'partial' | 'not_yet' | 'unverify' | 'arrived') {
    if (selectedItemIds.size === 0) return;

    if (action === 'partial') {
      // Prompt for partial quantity before opening OTP
      const input = window.prompt(`Set verified quantity for ${selectedItemIds.size} selected item(s)?`, '0');
      if (input == null) return;
      const qty = Number(input.replace(/[^0-9]/g, ''));
      if (!Number.isInteger(qty) || qty < 0) {
        alert('Enter a valid non-negative integer.');
        return;
      }
      setBulkPartialQty(qty);
    }

    setBulkAction(action);
    setBulkVerifyOtpOpen(true);
  }

  async function handleBulkVerifyOtp(actionToken: string) {
    if (!order || selectedItemIds.size === 0) return;
    setBulkVerifying(true);
    try {
      if (bulkAction === 'unverify') {
        const result = await bulkInventoryUnverify(order.id, {
          item_ids: Array.from(selectedItemIds),
          action_token: actionToken,
        });
        if (result.warning) {
          alert(result.warning);
        }
      } else if (bulkAction === 'arrived') {
        // Bulk arrived_qty — use the bulk endpoint with arrived_qty
        const arrivedQty = Number(bulkArrivedQty.replace(/[^0-9]/g, ''));
        if (!Number.isInteger(arrivedQty) || arrivedQty < 0) {
          alert('Enter a valid non-negative integer for arrived quantity.');
          return;
        }
        const result = await bulkInventoryVerify(order.id, {
          item_ids: Array.from(selectedItemIds),
          action_token: actionToken,
          action: 'partial',
          arrived_qty: arrivedQty,
        });
        if (result.warning) {
          alert(result.warning);
        }
      } else if (bulkAction === 'not_yet') {
        const result = await bulkInventoryVerify(order.id, {
          item_ids: Array.from(selectedItemIds),
          action_token: actionToken,
          action: 'not_yet',
        });
        if (result.warning) {
          alert(result.warning);
        }
      } else if (bulkAction === 'partial') {
        const result = await bulkInventoryVerify(order.id, {
          item_ids: Array.from(selectedItemIds),
          action_token: actionToken,
          action: 'partial',
          verified_qty: bulkPartialQty,
        });
        if (result.warning) {
          alert(result.warning);
        }
      } else {
        // verify_all
        const result = await bulkInventoryVerify(order.id, {
          item_ids: Array.from(selectedItemIds),
          action_token: actionToken,
          action: 'all',
        });
        if (result.warning) {
          alert(result.warning);
        }
      }
      setSelectedItemIds(new Set());
      setBulkArrivedQty('');
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to verify selected items');
    } finally {
      setBulkVerifying(false);
      setBulkVerifyOtpOpen(false);
      setShowBulkPartialInput(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-500"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading inventory verification...</div>;
  }

  if (error || !order) {
    return <div className="p-6 text-sm text-red-600">{error || 'Order not found'}</div>;
  }

  return (
    <div className="space-y-5 p-6">
      <Link href="/inventory" className="inline-flex items-center gap-2 text-sm font-medium text-teal-700 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Inventory
      </Link>

      <div className="rounded-xl border border-teal-200 bg-teal-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Search className="h-5 w-5 text-teal-600" />
              <h1 className="text-xl font-semibold text-gray-900">Inventory Verification #{order.quotation_number}</h1>
              <StageBadge stage={order.current_stage} />
            </div>
            <p className="mt-1 text-sm text-gray-600">Client: {order.client_name ?? 'Unknown'}</p>
            <p className="mt-2 text-xs text-teal-700">
              Permanent verification record • {fullyVerified}/{items.length} item(s) fully verified • {verifiedQty}/{totalQty} units ({pct}%)
            </p>
          </div>
          {canVerify ? (
            <button
              onClick={() => setCompleteOtpOpen(true)}
              disabled={completing || items.some((item) => (item.verified_qty ?? 0) < item.quantity)}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {completing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              Complete Verification
            </button>
          ) : (
            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-600">Read-only after leaving inventory verification</span>
          )}
        </div>
      </div>

      {canVerify && selectableItems.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {selectedItemIds.size > 0 && (
            <>
              {/* Arrived Qty bulk input */}
              <div className="flex items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5">
                <Warehouse className="h-3.5 w-3.5 text-orange-600" />
                <input
                  type="number"
                  min={0}
                  value={bulkArrivedQty}
                  onChange={(e) => setBulkArrivedQty(e.target.value)}
                  placeholder="Arrived qty"
                  className="w-20 rounded border border-orange-300 px-2 py-1 text-xs"
                />
                <button
                  onClick={() => handleBulkVerifyClick('arrived')}
                  disabled={bulkVerifying || !bulkArrivedQty}
                  className="rounded bg-orange-600 px-2 py-1 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50"
                >
                  {bulkVerifying ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Set Arrived'}
                </button>
              </div>
              <button
                onClick={() => handleBulkVerifyClick('unverify')}
                disabled={bulkVerifying}
                className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-600 disabled:opacity-50"
              >
                {bulkVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                Unverify ({selectedItemIds.size})
              </button>
              <button
                onClick={() => handleBulkVerifyClick('not_yet')}
                disabled={bulkVerifying}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-600 disabled:opacity-50"
              >
                {bulkVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                Not Yet ({selectedItemIds.size})
              </button>
              <button
                onClick={() => handleBulkVerifyClick('partial')}
                disabled={bulkVerifying}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-amber-600 disabled:opacity-50"
              >
                {bulkVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                Partial ({selectedItemIds.size})
              </button>
              <button
                onClick={() => handleBulkVerifyClick('verify_all')}
                disabled={bulkVerifying}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-700 disabled:opacity-50"
              >
                {bulkVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                Verify All ({selectedItemIds.size})
              </button>
            </>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              {canVerify && (
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    title="Select all"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleSelectAll}
                    disabled={selectableItems.length === 0}
                    className="rounded border-gray-300 accent-teal-600 disabled:opacity-30"
                  />
                </th>
              )}
              <th className="px-4 py-3">Item Name</th>
              <th className="px-4 py-3">Ordered Qty</th>
              <th className="px-4 py-3">Arrived Qty</th>
              <th className="px-4 py-3">Verified Qty</th>
              <th className="px-4 py-3">Arrival Verified Date</th>
              <th className="px-4 py-3">Delivered</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((item) => {
              const isSelectable = (item.verified_qty ?? 0) < item.quantity;
              const isChecked = selectedItemIds.has(item.id);
              const itemArrivedQty = item.arrived_qty;
              const hasExcess = itemArrivedQty != null && itemArrivedQty > item.quantity;
              return (
                <tr key={item.id} className={isChecked ? 'bg-teal-50/40' : ''}>
                  {canVerify && (
                    <td className="px-4 py-3">
                      {isSelectable && (
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectItem(item.id)}
                          className="rounded border-gray-300 accent-teal-600"
                        />
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 font-medium text-gray-900"><Package className="mr-2 inline h-4 w-4 text-teal-500" />{item.name}</td>
                  <td className="px-4 py-3 text-gray-600">{item.quantity}</td>
                  <td className="px-4 py-3">
                    {canVerify ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          value={arrivedQtyInputs[item.id] ?? itemArrivedQty ?? ''}
                          onChange={(e) => setArrivedQtyInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder={String(itemArrivedQty ?? item.quantity)}
                          className="w-16 rounded border border-gray-300 px-1.5 py-1 text-xs"
                        />
                        <button
                          onClick={() => openArrivedQtyOtp(item)}
                          disabled={busyItemId === item.id || !arrivedQtyInputs[item.id]}
                          className="rounded bg-orange-50 px-1.5 py-1 text-[10px] font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50"
                          title="Record arrived quantity (excess goes to inventory stock)"
                        >
                          <Warehouse className="h-3 w-3" />
                        </button>
                        {hasExcess && (
                          <span className="text-[10px] font-medium text-green-600" title="Excess added to inventory stock">
                            +{itemArrivedQty - item.quantity}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-600">
                        {itemArrivedQty ?? '—'}
                        {hasExcess && <span className="ml-1 text-[10px] text-green-600">(+{itemArrivedQty - item.quantity} excess → stock)</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${hasExcess ? 'bg-green-100 text-green-700' : 'bg-teal-100 text-teal-700'}`}>
                      {item.verified_qty ?? 0}/{item.quantity}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(item.inventory_verified_at)}</td>
                  <td className="px-4 py-3 text-gray-600">{item.delivered_qty ?? 0}{item.delivered_at ? ` • ${formatDate(item.delivered_at)}` : ''}</td>
                  <td className="px-4 py-3 text-right">
                    {canVerify ? (
                      <div className="flex justify-end gap-1">
                        <button onClick={() => openItemOtp(item, 'all')} disabled={busyItemId === item.id} className="rounded bg-green-50 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50">Verify All</button>
                        <button onClick={() => openItemOtp(item, 'partial')} disabled={busyItemId === item.id} className="rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50">Partial</button>
                        <button onClick={() => openItemOtp(item, 'not_yet')} disabled={busyItemId === item.id} className="rounded bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50">Not Yet</button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">Permanent record</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <OtpModal
        open={itemOtp.open}
        title={itemOtp.arrivedQty !== undefined ? 'Record Arrived Quantity' : 'Verify Inventory Item'}
        description={itemOtp.arrivedQty !== undefined
          ? `Record arrived quantity ${itemOtp.arrivedQty} for ${itemOtp.itemName}. Excess over ordered quantity will be added to inventory stock.`
          : `Update verification for ${itemOtp.itemName}. This will update inventory and accountability logs.`
        }
        onVerified={handleItemOtp}
        onClose={() => setItemOtp({ open: false, itemId: '', itemName: '', action: 'all' })}
      />
      <OtpModal
        open={completeOtpOpen}
        title="Complete Inventory Verification"
        description={`Complete inventory verification for #${order.quotation_number}.`}
        onVerified={handleCompleteOtp}
        onClose={() => setCompleteOtpOpen(false)}
      />
      <OtpModal
        open={bulkVerifyOtpOpen}
        title={bulkAction === 'not_yet' ? 'Bulk Mark as Not Yet' : bulkAction === 'arrived' ? 'Bulk Set Arrived Quantity' : 'Bulk Verify Inventory Items'}
        description={bulkAction === 'not_yet'
          ? `Mark ${selectedItemIds.size} selected item(s) as "not yet verified" for #${order.quotation_number}. This will reset their verified quantity to 0.`
          : bulkAction === 'arrived'
            ? `Set arrived quantity to ${bulkArrivedQty} for ${selectedItemIds.size} selected item(s) for #${order.quotation_number}. Excess over ordered quantity will be added to inventory stock.`
            : `Verify ${selectedItemIds.size} selected item(s) as fully verified for #${order.quotation_number}.`
        }
        onVerified={handleBulkVerifyOtp}
        onClose={() => setBulkVerifyOtpOpen(false)}
      />
    </div>
  );
}
