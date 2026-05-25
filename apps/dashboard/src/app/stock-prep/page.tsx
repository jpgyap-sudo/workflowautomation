'use client';

import { useState, useEffect, useCallback } from 'react';
import { useOrdersByStage } from '@/lib/useApi';
import { STAGE_CONFIG } from '@/lib/api';
import type { Order, OrderItem, InventoryItem } from '@/lib/api';
import { markStockReady, setStockPrep, getOrderItems, searchInventory, matchInventoryItem, setOrderItemMatch } from '@/lib/api';
import OtpModal from '@/components/OtpModal';
import { PackageCheck, Clock, CheckCircle, AlertCircle, Loader2, Edit2, Save, X, Search, ChevronDown, ChevronRight, Check, Tag, Box, Filter } from 'lucide-react';

function formatDate(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function daysDiff(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return diff;
}

function ReadyBadge({ readyAt }: { readyAt: string | null | undefined }) {
  if (!readyAt) return <span className="text-xs text-gray-400">No date set</span>;
  const diff = daysDiff(readyAt);
  if (diff === null) return null;
  if (diff <= 0) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-lime-100 px-2 py-0.5 text-xs font-medium text-lime-800">
      <CheckCircle className="h-3 w-3" /> Ready
    </span>
  );
  if (diff <= 2) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
      <Clock className="h-3 w-3" /> {diff}d left
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
      <Clock className="h-3 w-3" /> {diff}d left
    </span>
  );
}

function StockPrepCard({ order, onUpdated }: { order: Order; onUpdated: () => void }) {
  const [showOtp, setShowOtp] = useState(false);
  const [pendingAction, setPendingAction] = useState<'ready' | null>(null);
  const [deductInventory, setDeductInventory] = useState(true);
  const [marking, setMarking] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Prep days edit
  const [editingDays, setEditingDays] = useState(false);
  const [daysInput, setDaysInput] = useState(String(order.stock_prep_days ?? 0));
  const [savingDays, setSavingDays] = useState(false);

  function handleMarkReady() {
    setPendingAction('ready');
    setShowOtp(true);
  }

  async function handleVerified(actionToken: string) {
    if (pendingAction !== 'ready') return;
    setMarking(true);
    setMsg(null);
    try {
      await markStockReady(order.id, { deduct_inventory: deductInventory, updated_by: 'dashboard' });
      setMsg({ ok: true, text: '✅ Stock marked ready — order advanced to Balance Due' });
      setTimeout(() => onUpdated(), 800);
    } catch (err: any) {
      setMsg({ ok: false, text: err.message ?? 'Failed to mark stock ready' });
    } finally {
      setMarking(false);
    }
  }

  async function handleSaveDays() {
    const days = parseInt(daysInput, 10);
    if (isNaN(days) || days < 0) return;
    setSavingDays(true);
    try {
      await setStockPrep(order.id, days);
      setEditingDays(false);
      onUpdated();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message ?? 'Failed to update prep days' });
    } finally {
      setSavingDays(false);
    }
  }

  const readyDate = order.stock_prep_ready_at;
  const isImmediate = (order.stock_prep_days ?? 0) === 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">{order.quotation_number ?? `#${order.id.slice(0, 8)}`}</p>
          <p className="text-xs text-gray-500">{order.client_name ?? 'No client'}</p>
          {order.sales_agent && <p className="text-[10px] text-gray-400">Agent: {order.sales_agent}</p>}
        </div>
        <ReadyBadge readyAt={readyDate} />
      </div>

      {/* Preparation timeline */}
      <div className="rounded-lg bg-lime-50 border border-lime-200 px-3 py-2 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-medium text-lime-700 uppercase tracking-wide">Preparation</p>
            {editingDays ? (
              <div className="flex items-center gap-1 mt-0.5">
                <input
                  type="number" min={0} max={365}
                  value={daysInput}
                  onChange={e => setDaysInput(e.target.value)}
                  className="w-20 rounded border border-lime-400 px-2 py-1 text-xs"
                  autoFocus
                />
                <span className="text-xs text-gray-500">days</span>
                <button onClick={handleSaveDays} disabled={savingDays} className="rounded px-2 py-1 bg-lime-600 text-white text-xs hover:bg-lime-700 disabled:opacity-50">
                  {savingDays ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                </button>
                <button onClick={() => setEditingDays(false)} className="rounded px-2 py-1 bg-gray-100 text-gray-600 text-xs hover:bg-gray-200">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1 mt-0.5">
                <p className="text-sm font-medium text-lime-800">
                  {isImmediate ? '⚡ Immediate' : `${order.stock_prep_days} day(s)`}
                </p>
                <button onClick={() => { setEditingDays(true); setDaysInput(String(order.stock_prep_days ?? 0)); }} className="rounded p-0.5 text-lime-600 hover:bg-lime-100" title="Edit prep days">
                  <Edit2 className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
          {readyDate && !editingDays && (
            <div className="text-right">
              <p className="text-[10px] text-lime-600">Ready by</p>
              <p className="text-xs font-medium text-lime-800">{formatDate(readyDate)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Amount */}
      {order.total_amount != null && (
        <p className="text-xs text-gray-600">
          Total: <span className="font-medium">₱{Number(order.total_amount).toLocaleString()}</span>
          {order.deposit_amount != null && (
            <span className="ml-2 text-gray-400">Deposit: ₱{Number(order.deposit_amount).toLocaleString()}</span>
          )}
        </p>
      )}

      {/* Inventory deduction toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={deductInventory} onChange={e => setDeductInventory(e.target.checked)} className="h-3.5 w-3.5 rounded accent-lime-600" />
        <span className="text-xs text-gray-600">Deduct quantities from inventory when marking ready</span>
      </label>

      {/* Status message */}
      {msg && (
        <p className={`rounded-lg px-3 py-2 text-xs ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {msg.text}
        </p>
      )}

      {/* Mark Ready button */}
      <button
        onClick={handleMarkReady}
        disabled={marking}
        className="w-full rounded-lg bg-lime-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-lime-700 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {marking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
        Mark Stock Ready → Balance Due
      </button>

      <OtpModal
        open={showOtp}
        title="Confirm: Mark Stock Ready"
        description={`Marking stock ready for ${order.quotation_number ?? 'this order'}${deductInventory ? ' and deducting from inventory' : ''}. This will advance the order to Balance Due.`}
        onVerified={handleVerified}
        onClose={() => { setShowOtp(false); setPendingAction(null); }}
      />
    </div>
  );
}

// ── Matching Verification Section ────────────────────────────────────────

interface MatchCardProps {
  order: Order;
  item: OrderItem;
  suggestedMatch: InventoryItem | null;
  suggestedScore: number;
  onConfirm: (inventoryItemId: string | null) => Promise<void>;
  confirming: boolean;
}

function StockIndicator({ item, inventoryItem }: { item: OrderItem; inventoryItem: InventoryItem | null }) {
  if (!inventoryItem) return null;
  const sufficient = inventoryItem.quantity >= item.quantity;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
      sufficient ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
    }`}>
      <Box className="h-2.5 w-2.5" />
      {inventoryItem.quantity} in stock{sufficient ? '' : ` (need ${item.quantity})`}
    </span>
  );
}

function MatchCard({ order, item, suggestedMatch, suggestedScore, onConfirm, confirming }: MatchCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<InventoryItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<InventoryItem | null>(suggestedMatch);
  const [searchTab, setSearchTab] = useState<'all' | 'name' | 'description'>('all');

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim() || !expanded) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchInventory(searchQuery, 20);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, expanded]);

  const handleConfirm = useCallback(async () => {
    if (!selectedMatch) return;
    await onConfirm(selectedMatch.id);
  }, [selectedMatch, onConfirm]);

  const handleClear = useCallback(async () => {
    await onConfirm(null);
    setSelectedMatch(null);
  }, [onConfirm]);

  const sufficient = selectedMatch ? selectedMatch.quantity >= item.quantity : false;

  return (
    <div className={`rounded-lg border p-3 transition-colors ${
      selectedMatch
        ? sufficient
          ? 'border-green-200 bg-green-50/30'
          : 'border-red-200 bg-red-50/30'
        : 'border-gray-200 bg-white'
    }`}>
      {/* Header row: order item name + suggested match */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Tag className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
            <span className="text-sm font-medium text-gray-900 truncate">{item.name}</span>
            <span className="text-xs text-gray-400">x{item.quantity}</span>
          </div>
          {suggestedMatch && !selectedMatch && (
            <p className="text-[10px] text-gray-400 mt-0.5 ml-5">
              Suggested: <span className="text-indigo-600 font-medium">{suggestedMatch.product_name}</span>
              {' '}({suggestedScore}% match)
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {selectedMatch && <StockIndicator item={item} inventoryItem={selectedMatch} />}
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title="Search inventory"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Selected match info */}
      {selectedMatch && (
        <div className="mt-2 ml-5 flex items-center gap-2">
          <CheckCircle className="h-3 w-3 text-green-500" />
          <span className="text-xs text-gray-600 truncate">{selectedMatch.product_name}</span>
          {selectedMatch.dimension && (
            <span className="text-[10px] text-gray-400">{selectedMatch.dimension}</span>
          )}
          {selectedMatch.category && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{selectedMatch.category}</span>
          )}
          <button onClick={handleClear} disabled={confirming} className="ml-auto rounded p-0.5 text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-50">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Confirm button (when suggested match is shown but not yet confirmed) */}
      {suggestedMatch && !selectedMatch && (
        <div className="mt-2 ml-5">
          <button
            onClick={() => { setSelectedMatch(suggestedMatch); }}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
          >
            <Check className="h-3 w-3" />
            Accept Suggestion
          </button>
        </div>
      )}

      {/* Expanded search panel */}
      {expanded && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          {/* Search tabs */}
          <div className="flex items-center gap-1 mb-2">
            {(['all', 'name', 'description'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setSearchTab(tab)}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  searchTab === tab
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {tab === 'all' ? 'All' : tab === 'name' ? 'By Name' : 'By Description'}
              </button>
            ))}
          </div>

          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search inventory items..."
              className="w-full rounded-lg border border-gray-200 pl-8 pr-3 py-1.5 text-xs focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 outline-none"
              autoFocus
            />
            {searching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-gray-400" />}
          </div>

          {/* Search results */}
          {searchResults.length > 0 && (
            <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
              {searchResults.map((invItem) => {
                const isSelected = selectedMatch?.id === invItem.id;
                const itemSufficient = invItem.quantity >= item.quantity;
                return (
                  <button
                    key={invItem.id}
                    onClick={() => { setSelectedMatch(invItem); setExpanded(false); }}
                    className={`w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                      isSelected
                        ? 'border-indigo-300 bg-indigo-50'
                        : 'border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/50'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{invItem.product_name}</p>
                      {invItem.description && (
                        <p className="text-[10px] text-gray-400 truncate">{invItem.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-0.5">
                        {invItem.dimension && <span className="text-[10px] text-gray-400">{invItem.dimension}</span>}
                        {invItem.category && <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-500">{invItem.category}</span>}
                      </div>
                    </div>
                    <StockIndicator item={item} inventoryItem={invItem} />
                    {isSelected && <Check className="h-3.5 w-3.5 text-indigo-600 flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
          {searchQuery && !searching && searchResults.length === 0 && (
            <p className="text-[10px] text-gray-400 mt-2 text-center">No matching inventory items found</p>
          )}
        </div>
      )}

      {/* Confirm match button */}
      {selectedMatch && selectedMatch.id !== suggestedMatch?.id && (
        <div className="mt-2 ml-5">
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {confirming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Confirm Match
          </button>
        </div>
      )}
    </div>
  );
}

function MatchingVerificationSection({ onUpdated }: { onUpdated: () => void }) {
  const { data: allOrders, isLoading, mutate } = useOrdersByStage('stock_preparation');
  // Only show from-stock orders in Matching Verification
  const orders = allOrders?.filter((o: Order) => o.order_type === 'from_stock') ?? [];
  const [itemsByOrder, setItemsByOrder] = useState<Record<string, OrderItem[]>>({});
  const [suggestedMatches, setSuggestedMatches] = useState<Record<string, { item: InventoryItem; score: number } | null>>({});
  const [loadingItems, setLoadingItems] = useState<Record<string, boolean>>({});
  const [confirmingItems, setConfirmingItems] = useState<Record<string, boolean>>({});
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});

  // Track which orders we've already loaded items for (prevents re-fetch on every render)
  const [loadedOrderIds, setLoadedOrderIds] = useState<Set<string>>(new Set());

  // Load items for each order and auto-suggest matches
  useEffect(() => {
    if (!orders || orders.length === 0) return;
    const newOrderIds = orders.filter(o => !loadedOrderIds.has(o.id)).map(o => o.id);
    if (newOrderIds.length === 0) return; // already loaded all orders
    setLoadedOrderIds(prev => new Set([...prev, ...newOrderIds]));

    newOrderIds.forEach(async (orderId) => {
      const order = orders.find(o => o.id === orderId)!;
      setLoadingItems(prev => ({ ...prev, [order.id]: true }));
      try {
        const res = await getOrderItems(order.id);
        const items = res.items ?? [];
        setItemsByOrder(prev => ({ ...prev, [order.id]: items }));

        // Auto-suggest matches for unmatched items
        for (const item of items) {
          if (item.matched_inventory_item_id) continue; // already matched
          const matchKey = `${order.id}:${item.id}`;
          try {
            const matchRes = await matchInventoryItem(item.name);
            if (matchRes.matches && matchRes.matches.length > 0) {
              setSuggestedMatches(prev => ({
                ...prev,
                [matchKey]: { item: matchRes.matches[0].item, score: matchRes.matches[0].score },
              }));
            }
          } catch {
            // silently fail — user can search manually
          }
        }
      } catch {
        // silently fail
      } finally {
        setLoadingItems(prev => ({ ...prev, [order.id]: false }));
      }
    });
  }, [orders]);

  const handleConfirmMatch = useCallback(async (orderId: string, itemId: string, inventoryItemId: string | null) => {
    const matchKey = `${orderId}:${itemId}`;
    setConfirmingItems(prev => ({ ...prev, [matchKey]: true }));
    try {
      await setOrderItemMatch(orderId, itemId, inventoryItemId);
      // Update local state
      setItemsByOrder(prev => {
        const items = [...(prev[orderId] ?? [])];
        const idx = items.findIndex(i => i.id === itemId);
        if (idx >= 0) {
          items[idx] = { ...items[idx], matched_inventory_item_id: inventoryItemId, inventory_match_verified: true };
        }
        return { ...prev, [orderId]: items };
      });
      if (inventoryItemId) {
        setSuggestedMatches(prev => {
          const next = { ...prev };
          delete next[matchKey];
          return next;
        });
      }
      // Refresh parent
      onUpdated();
    } catch {
      // silently fail
    } finally {
      setConfirmingItems(prev => ({ ...prev, [matchKey]: false }));
    }
  }, [onUpdated]);

  const toggleOrder = useCallback((orderId: string) => {
    setExpandedOrders(prev => ({ ...prev, [orderId]: !prev[orderId] }));
  }, []);

  // Count unmatched items across all orders
  const unmatchedCount = Object.entries(itemsByOrder).reduce((sum, [, items]) => {
    return sum + items.filter(i => !i.matched_inventory_item_id).length;
  }, 0);

  const matchedCount = Object.entries(itemsByOrder).reduce((sum, [, items]) => {
    return sum + items.filter(i => i.matched_inventory_item_id).length;
  }, 0);

  const totalItems = Object.values(itemsByOrder).reduce((sum, items) => sum + items.length, 0);

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100">
            <Filter className="h-5 w-5 text-indigo-700" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Matching Verification</h2>
            <p className="text-sm text-gray-500">Match order items to inventory items for stock deduction</p>
          </div>
        </div>
        {totalItems > 0 && (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
              {matchedCount} matched
            </span>
            {unmatchedCount > 0 && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                {unmatchedCount} to verify
              </span>
            )}
          </div>
        )}
      </div>

      {/* Explanation */}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
        <h3 className="text-sm font-medium text-indigo-800 mb-1">🔗 How Matching Works</h3>
        <p className="text-xs text-indigo-700">
          Each order item is automatically matched to the closest inventory item by name/description.
          Review the suggestions below and confirm matches. You can also search manually.
          All items must be matched before the order can be marked as stock ready.
        </p>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          <span className="ml-2 text-sm text-gray-500">Loading orders...</span>
        </div>
      ) : !orders || orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-12 text-center">
          <Filter className="h-8 w-8 text-gray-300 mb-2" />
          <p className="text-sm font-medium text-gray-500">No orders to verify</p>
          <p className="text-xs text-gray-400 mt-1">Orders will appear here when they enter Stock Preparation</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const items = itemsByOrder[order.id] ?? [];
            const unmatchedItems = items.filter(i => !i.matched_inventory_item_id);
            const matchedItems = items.filter(i => i.matched_inventory_item_id);
            const isLoadingOrderItems = loadingItems[order.id];
            const isExpanded = expandedOrders[order.id] ?? true; // default expanded

            if (items.length === 0 && !isLoadingOrderItems) return null;

            return (
              <div key={order.id} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                {/* Order header */}
                <button
                  onClick={() => toggleOrder(order.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                    <div className="text-left">
                      <p className="text-sm font-semibold text-gray-900">{order.quotation_number ?? `#${order.id.slice(0, 8)}`}</p>
                      <p className="text-xs text-gray-500">{order.client_name ?? 'No client'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {matchedItems.length > 0 && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                        {matchedItems.length} matched
                      </span>
                    )}
                    {unmatchedItems.length > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        {unmatchedItems.length} pending
                      </span>
                    )}
                  </div>
                </button>

                {/* Items */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-4 py-3 space-y-2">
                    {isLoadingOrderItems ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                        <span className="ml-2 text-xs text-gray-500">Loading items...</span>
                      </div>
                    ) : items.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-2">No items found for this order</p>
                    ) : (
                      items.map((item) => {
                        const matchKey = `${order.id}:${item.id}`;
                        const suggested = suggestedMatches[matchKey];
                        const isAlreadyMatched = !!item.matched_inventory_item_id;

                        if (isAlreadyMatched) {
                          return (
                            <div key={item.id} className="flex items-center gap-2 rounded-lg border border-green-100 bg-green-50/50 px-3 py-2">
                              <CheckCircle className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                              <span className="text-xs font-medium text-gray-700 flex-1">{item.name}</span>
                              <span className="text-[10px] text-green-600">✓ Verified</span>
                            </div>
                          );
                        }

                        return (
                          <MatchCard
                            key={item.id}
                            order={order}
                            item={item}
                            suggestedMatch={suggested?.item ?? null}
                            suggestedScore={suggested?.score ?? 0}
                            onConfirm={(invId) => handleConfirmMatch(order.id, item.id, invId)}
                            confirming={confirmingItems[matchKey] ?? false}
                          />
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────

export default function StockPrepPage() {
  const { data: orders, isLoading, mutate } = useOrdersByStage('stock_preparation');

  const stageConfig = STAGE_CONFIG['stock_preparation'];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime-100">
            <PackageCheck className="h-5 w-5 text-lime-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Existing Stock Preparation</h1>
            <p className="text-sm text-gray-500">Orders fulfilled from existing inventory — no production needed</p>
          </div>
        </div>
        {orders && orders.length > 0 && (
          <span className="rounded-full bg-lime-100 px-3 py-1 text-sm font-medium text-lime-800">
            {orders.length} order{orders.length !== 1 ? 's' : ''} pending
          </span>
        )}
      </div>

      {/* Stage explanation */}
      <div className="rounded-xl border border-lime-200 bg-lime-50 p-4">
        <h3 className="text-sm font-medium text-lime-800 mb-1">📦 What is Stock Preparation?</h3>
        <p className="text-xs text-lime-700">
          These orders have items available in existing inventory. They skip the full production/purchasing/en-route flow.
          Once the deposit is verified, stock is gathered and prepared for delivery.
          Mark an order as ready when the stock is physically prepared — this advances it to <b>Balance Due</b> for payment collection.
        </p>
      </div>

      {/* Matching Verification Section */}
      <MatchingVerificationSection onUpdated={() => mutate()} />

      {/* Separator */}
      <div className="border-t border-gray-200" />

      {/* Orders */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <PackageCheck className="h-5 w-5 text-lime-600" />
          Stock Preparation Cards
        </h2>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            <span className="ml-2 text-sm text-gray-500">Loading orders...</span>
          </div>
        ) : !orders || orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-16 text-center">
            <PackageCheck className="h-10 w-10 text-gray-300 mb-3" />
            <p className="text-sm font-medium text-gray-500">No orders in Stock Preparation</p>
            <p className="text-xs text-gray-400 mt-1">From-stock orders will appear here after deposit is verified</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {orders.map(order => (
              <StockPrepCard key={order.id} order={order} onUpdated={() => mutate()} />
            ))}
          </div>
        )}
      </div>

      {/* Manual input section */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-500" />
          Manual Order Entry
        </h3>
        <p className="text-xs text-gray-500">
          To add an order to Stock Preparation, create it from the <b>Orders</b> page and toggle <b>"Item is from existing stock"</b> before saving.
          After the deposit is verified, the order will automatically appear here.
        </p>
      </div>
    </div>
  );
}
