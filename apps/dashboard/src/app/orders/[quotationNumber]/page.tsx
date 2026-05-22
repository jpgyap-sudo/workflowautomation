'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useOrder } from '@/lib/useApi';
import { STAGE_CONFIG, STAGE_ORDER, getItemCompletion, getOrderItems, getProductionLogs, extractOrderItems, type OrderItem, type ItemCompletion, type ProductionUpdateLog } from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import { ArrowLeft, FileText, User, DollarSign, CheckCircle2, CreditCard, Scale, MapPin, Phone, UserCheck, Truck, Clock, AlertTriangle, MessageSquare, Send, Bot, Package, Factory, List, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { FileViewerModal, useOrderFileViewer } from '@/components/OrderFileViewer';

function DaysInStage({ updatedAt }: { updatedAt: string }) {
  const days = Math.floor((new Date().getTime() - new Date(updatedAt).getTime()) / 86_400_000);
  if (days <= 0) return null;
  const cls = days >= 7 ? 'text-red-600 font-semibold' : days >= 3 ? 'text-amber-500' : 'text-gray-400';
  return <span className={`text-xs ${cls}`}>{days}d in stage</span>;
}

export default function OrderDetailPage() {
  const params = useParams();
  const quotationNumber = params.quotationNumber as string;
  const { data: order, error, isLoading } = useOrder(quotationNumber);
  const { viewingFilesOrder, orderFiles, handleViewFiles, refreshFiles, closeViewer } = useOrderFileViewer();

  if (isLoading && !order) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
      </div>
    );
  }

  if (!order && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-lg text-gray-500">Order not found</p>
        <Link href="/orders" className="mt-2 text-sm text-[#2490ef] hover:underline">
          Back to orders
        </Link>
      </div>
    );
  }

  if (!order) return null;

  const currentStageIndex = STAGE_ORDER.indexOf(order.current_stage);
  const escalation = order.escalation_level ?? 0;

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Link
        href="/orders"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to orders
      </Link>

      {/* Order header */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">
                {order.quotation_number ?? 'Unnamed Order'}
              </h1>
              <div className="flex items-center gap-2">
                <StageBadge stage={order.current_stage} />
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <span className="text-sm text-gray-500">
                Created {new Date(order.created_at).toLocaleString()}
              </span>
              <span className="flex items-center gap-1 text-xs font-medium text-gray-400">
                <Clock className="h-3.5 w-3.5" />
                <DaysInStage updatedAt={order.updated_at} />
              </span>
              {escalation > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                  <AlertTriangle className="h-3 w-3" />
                  Escalation level {escalation}
                </span>
              )}
            </div>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              order.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {order.status}
          </span>
        </div>
      </div>

      {/* Order details grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
            <User className="h-4 w-4" />
            Client
          </div>
          <p className="mt-1 text-base text-gray-900">{order.client_name ?? '—'}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
            <User className="h-4 w-4" />
            Sales Agent
          </div>
          <p className="mt-1 text-base text-gray-900">{order.sales_agent ?? '—'}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
            <DollarSign className="h-4 w-4" />
            Total Amount
          </div>
          <p className="mt-1 text-base text-gray-900">
            {order.total_amount != null ? `₱${Number(order.total_amount).toLocaleString()}` : '—'}
          </p>
        </div>
      </div>

      {/* Delivery Info */}
      {(order.delivery_address || order.contact_number || order.authorized_receiver_name || order.authorized_receiver_contact) && (
        <div className="rounded-xl border border-purple-200 bg-purple-50 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-purple-800">
            <Truck className="h-4 w-4" />
            Delivery Information
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {order.delivery_address && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-purple-700">
                  <MapPin className="h-3 w-3" />
                  Address
                </div>
                <p className="mt-0.5 text-sm text-purple-900">{order.delivery_address}</p>
              </div>
            )}
            {order.contact_number && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-purple-700">
                  <Phone className="h-3 w-3" />
                  Contact
                </div>
                <p className="mt-0.5 text-sm text-purple-900">{order.contact_number}</p>
              </div>
            )}
            {order.authorized_receiver_name && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-purple-700">
                  <UserCheck className="h-3 w-3" />
                  Auth. Receiver
                </div>
                <p className="mt-0.5 text-sm text-purple-900">{order.authorized_receiver_name}</p>
              </div>
            )}
            {order.authorized_receiver_contact && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-purple-700">
                  <Phone className="h-3 w-3" />
                  Receiver Contact
                </div>
                <p className="mt-0.5 text-sm text-purple-900">{order.authorized_receiver_contact}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Math status */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
          <CheckCircle2 className="h-4 w-4" />
          Math Verification
        </div>
        <div className="mt-2 flex items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              order.math_status === 'verified'
                ? 'bg-green-100 text-green-700'
                : order.math_status === 'failed'
                ? 'bg-red-100 text-red-700'
                : 'bg-yellow-100 text-yellow-700'
            }`}
          >
            {order.math_status}
          </span>
          {order.computed_amount != null && (
            <span className="text-sm text-gray-600">
              Computed: ₱{Number(order.computed_amount).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Downpayment status */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
          <CreditCard className="h-4 w-4" />
          Downpayment
        </div>
        <div className="mt-2 flex items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              order.deposit_paid
                ? 'bg-green-100 text-green-700'
                : 'bg-yellow-100 text-yellow-700'
            }`}
          >
            {order.deposit_paid ? '✅ Paid' : '⏳ Pending'}
          </span>
          {order.deposit_amount != null && (
            <span className="text-sm text-gray-600">
              Amount: ₱{Number(order.deposit_amount).toLocaleString()}
            </span>
          )}
          {order.deposit_image_url && (
            <a
              href={order.deposit_image_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#2490ef] hover:underline"
            >
              View Deposit Slip
            </a>
          )}
        </div>
        {!order.deposit_paid && (
          <p className="mt-2 text-xs text-amber-600">
            Downpayment required before production can proceed. Use /deposit in Telegram to record payment.
          </p>
        )}
      </div>

      {/* Balance status */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
          <Scale className="h-4 w-4" />
          Balance Payment
        </div>
        <div className="mt-2 flex items-center gap-3">
          {order.total_amount != null && order.deposit_amount != null ? (
            <>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  order.balance_paid
                    ? 'bg-green-100 text-green-700'
                    : 'bg-violet-100 text-violet-700'
                }`}
              >
                {order.balance_paid ? '✅ Paid' : '⏳ Pending'}
              </span>
              <span className="text-sm text-gray-600">
                Balance: ₱{(Number(order.total_amount) - Number(order.deposit_amount)).toLocaleString()}
              </span>
              <span className="text-sm text-gray-400">
                (Total: ₱{Number(order.total_amount).toLocaleString()} − Downpayment: ₱{Number(order.deposit_amount).toLocaleString()})
              </span>
            </>
          ) : (
            <span className="text-sm text-gray-400">
              {order.total_amount == null ? 'Total amount not set yet' : 'Downpayment not recorded yet'}
            </span>
          )}
        </div>
        {!order.balance_paid && order.deposit_paid && order.total_amount != null && (
          <p className="mt-2 text-xs text-violet-600">
            Balance must be paid before delivery can be scheduled. Use /paybalance in Telegram to record payment.
          </p>
        )}
      </div>

      {/* Stage progress */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold text-gray-800">Stage Progress</h2>
        <div className="space-y-3">
          {STAGE_ORDER.map((stage, index) => {
            const config = STAGE_CONFIG[stage];
            const isCompleted = index <= currentStageIndex;
            const isCurrent = index === currentStageIndex;
            const stageUpdate = order.stage_updates?.find((u) => u.stage === stage);

            return (
              <div key={stage} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      isCompleted
                        ? isCurrent
                          ? 'bg-[#2490ef] text-white'
                          : 'bg-green-500 text-white'
                        : 'bg-gray-200 text-gray-400'
                    }`}
                  >
                    {isCompleted ? '✓' : index + 1}
                  </div>
                  {index < STAGE_ORDER.length - 1 && (
                    <div
                      className={`mt-1 h-6 w-0.5 ${
                        isCompleted && index < currentStageIndex ? 'bg-green-300' : 'bg-gray-200'
                      }`}
                    />
                  )}
                </div>
                <div className={`flex-1 pb-3 ${isCurrent ? '' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-medium ${
                        isCompleted ? 'text-gray-900' : 'text-gray-400'
                      }`}
                    >
                      {config?.icon} {config?.label ?? stage}
                    </span>
                    {isCurrent && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                        Current
                      </span>
                    )}
                  </div>
                  {stageUpdate && (
                    <div className="mt-1 rounded-lg bg-gray-50 p-2">
                      <p className="text-xs text-gray-600">
                        Status: <span className="font-medium">{stageUpdate.status}</span>
                        {stageUpdate.remarks && <> — {stageUpdate.remarks}</>}
                      </p>
                      <p className="mt-0.5 text-[10px] text-gray-400">
                        by {stageUpdate.updated_by ?? 'system'} on{' '}
                        {new Date(stageUpdate.created_at).toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Item-Level Tracking */}
      <ItemTrackingSection orderId={order.id} currentStage={order.current_stage} />

      {/* Agent Notes */}
      <AgentNotesSection orderId={order.id} quotationNumber={order.quotation_number ?? ''} />

      {/* Files */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">Files</h2>
          <button
            onClick={() => handleViewFiles(order)}
            className="rounded-lg bg-[#2490ef] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1a7ad9]"
          >
            View / Upload Files
          </button>
        </div>
        {order.files && order.files.length > 0 ? (
          <div className="space-y-2">
            {order.files.map((file) => (
              <div key={file.id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3">
                <FileText className="h-4 w-4 text-gray-400" />
                <div className="flex-1">
                  <p className="text-sm text-gray-900">{file.original_filename ?? 'Unnamed file'}</p>
                  <p className="text-xs text-gray-400">{file.file_type}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No files uploaded yet.</p>
        )}
      </div>

      {viewingFilesOrder && (
        <FileViewerModal
          order={viewingFilesOrder}
          files={orderFiles}
          onClose={closeViewer}
          onUploadComplete={refreshFiles}
        />
      )}
    </div>
  );
}

// ── Item-Level Tracking Section ────────────────────────────────────────

function ItemTrackingSection({ orderId, currentStage }: { orderId: string; currentStage: string }) {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [completion, setCompletion] = useState<ItemCompletion | null>(null);
  const [logs, setLogs] = useState<ProductionUpdateLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');

  const stagesWithItems = ['production_confirmed', 'en_route', 'inventory_arrived', 'balance_due', 'delivery_scheduled', 'production_pending', 'purchasing_pending'];

  useEffect(() => {
    if (!stagesWithItems.includes(currentStage)) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    Promise.all([
      getOrderItems(orderId),
      getItemCompletion(orderId),
      getProductionLogs(orderId),
    ]).then(([itemsRes, compRes, logsRes]) => {
      if (cancelled) return;
      if (itemsRes.ok) setItems(itemsRes.items);
      if (compRes.ok) setCompletion(compRes);
      if (logsRes.ok) setLogs(logsRes.logs);
      setLoading(false);
    }).catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [orderId, currentStage]);

  async function handleExtractItems() {
    setExtracting(true);
    setExtractError('');
    try {
      const res = await extractOrderItems(orderId);
      if (res.ok && res.items.length > 0) {
        setItems(res.items);
        // Also refresh completion
        const compRes = await getItemCompletion(orderId);
        if (compRes.ok) setCompletion(compRes);
      } else {
        setExtractError('No items could be extracted from the quotation');
      }
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  }

  if (!stagesWithItems.includes(currentStage)) return null;

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-[#2490ef]" />
        </div>
      </div>
    );
  }

  // If no items yet, show an "Extract Items" prompt
  if (items.length === 0 && logs.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center gap-2">
          <List className="h-4 w-4 text-gray-500" />
          <h2 className="text-base font-semibold text-gray-800">Item-Level Tracking</h2>
        </div>
        <p className="mt-3 text-sm text-gray-500">
          No items have been extracted for this order yet. You can extract items from the quotation image using AI vision.
        </p>
        {extractError && (
          <p className="mt-2 text-xs text-red-500">{extractError}</p>
        )}
        <button
          onClick={handleExtractItems}
          disabled={extracting}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-500 px-4 py-2 text-xs font-medium text-white shadow-sm hover:from-purple-600 hover:to-indigo-600 disabled:opacity-50"
        >
          {extracting ? (
            <>
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Extracting...
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              Extract Items from Quotation
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center gap-2">
        <List className="h-4 w-4 text-gray-500" />
        <h2 className="text-base font-semibold text-gray-800">Item-Level Tracking</h2>
        {completion && (
          <span className="ml-auto text-xs text-gray-500">
            {items.length} item{items.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Completion bars */}
      {completion && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-600">
              <Factory className="h-3 w-3" /> Production
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-indigo-200">
                <div className={`h-full rounded-full transition-all duration-500 ${completion.production_completion_pct >= 100 ? 'bg-green-500' : completion.production_completion_pct >= 50 ? 'bg-amber-500' : 'bg-indigo-400'}`}
                  style={{ width: `${Math.min(completion.production_completion_pct, 100)}%` }} />
              </div>
              <span className={`text-xs font-semibold ${completion.production_completion_pct >= 100 ? 'text-green-600' : completion.production_completion_pct >= 50 ? 'text-amber-600' : 'text-indigo-600'}`}>
                {completion.production_completion_pct}%
              </span>
            </div>
          </div>
          <div className="rounded-lg border border-sky-100 bg-sky-50/50 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sky-600">
              <Truck className="h-3 w-3" /> En Route
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-sky-200">
                <div className={`h-full rounded-full transition-all duration-500 ${completion.en_route_completion_pct >= 100 ? 'bg-green-500' : completion.en_route_completion_pct >= 50 ? 'bg-amber-500' : 'bg-sky-400'}`}
                  style={{ width: `${Math.min(completion.en_route_completion_pct, 100)}%` }} />
              </div>
              <span className={`text-xs font-semibold ${completion.en_route_completion_pct >= 100 ? 'text-green-600' : completion.en_route_completion_pct >= 50 ? 'text-amber-600' : 'text-sky-600'}`}>
                {completion.en_route_completion_pct}%
              </span>
            </div>
          </div>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
              <Package className="h-3 w-3" /> Inventory
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-emerald-200">
                <div className={`h-full rounded-full transition-all duration-500 ${completion.inventory_completion_pct >= 100 ? 'bg-green-500' : completion.inventory_completion_pct >= 50 ? 'bg-amber-500' : 'bg-emerald-400'}`}
                  style={{ width: `${Math.min(completion.inventory_completion_pct, 100)}%` }} />
              </div>
              <span className={`text-xs font-semibold ${completion.inventory_completion_pct >= 100 ? 'text-green-600' : completion.inventory_completion_pct >= 50 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {completion.inventory_completion_pct}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Items table */}
      {items.length > 0 && (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3">Qty</th>
                <th className="py-2 pr-3">Production</th>
                <th className="py-2 pr-3">En Route</th>
                <th className="py-2 pr-3">Arrival Est.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="py-2 pr-3 font-medium text-gray-800">{item.name}</td>
                  <td className="py-2 pr-3 text-gray-600">{item.quantity}</td>
                  <td className="py-2 pr-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      item.production_status === 'finished' ? 'bg-green-100 text-green-700'
                      : item.production_status === 'in_progress' ? 'bg-amber-100 text-amber-700'
                      : 'bg-gray-100 text-gray-600'
                    }`}>
                      {item.production_status === 'finished' ? '✓ Finished'
                        : item.production_status === 'in_progress' ? '⟳ In Progress'
                        : '○ Pending'}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      item.en_route_status === 'arrived' ? 'bg-green-100 text-green-700'
                      : item.en_route_status === 'en_route' ? 'bg-sky-100 text-sky-700'
                      : 'bg-gray-100 text-gray-600'
                    }`}>
                      {item.en_route_status === 'arrived' ? '✓ Arrived'
                        : item.en_route_status === 'en_route' ? '⟳ En Route'
                        : '○ Not Yet'}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-gray-600">
                    {item.estimated_arrival_days != null ? `${item.estimated_arrival_days}d` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Production update logs */}
      {logs.length > 0 && (
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Update Logs</h3>
          <div className="max-h-48 space-y-1.5 overflow-y-auto">
            {logs.map((log) => (
              <div key={log.id} className="rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2">
                <div className="flex items-center gap-2 text-[10px] text-gray-400">
                  <span className="font-medium text-gray-600">{log.created_by ?? 'system'}</span>
                  {log.item_name && <span className="text-gray-400">· {log.item_name}</span>}
                  <span className="ml-auto">{new Date(log.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-0.5 text-xs text-gray-800">{log.note}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Agent Notes Section ────────────────────────────────────────────────

interface AgentNote {
  id: string;
  order_id: string;
  agent_name: string;
  note: string;
  created_at: string;
}

function AgentNotesSection({ orderId, quotationNumber }: { orderId: string; quotationNumber: string }) {
  const [notes, setNotes] = useState<AgentNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [agentName, setAgentName] = useState('dashboard');
  const [posting, setPosting] = useState(false);
  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

  useEffect(() => {
    fetch(`${API_BASE}/orders/${orderId}/notes`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { setNotes(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [orderId, API_BASE]);

  async function handlePostNote() {
    if (!newNote.trim() || !agentName.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(`${API_BASE}/orders/${orderId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_name: agentName.trim(), note: newNote.trim() }),
      });
      if (res.ok) {
        const created = await res.json();
        setNotes((prev) => [created, ...prev]);
        setNewNote('');
      }
    } catch (err: any) {
      alert('Failed to post note: ' + (err.message ?? 'Unknown error'));
    } finally {
      setPosting(false);
    }
  }

  const AGENT_COLORS: Record<string, string> = {
    'hermes': 'border-purple-200 bg-purple-50',
    'collection-agent': 'border-emerald-200 bg-emerald-50',
    'delivery-agent': 'border-blue-200 bg-blue-50',
    'production-agent': 'border-amber-200 bg-amber-50',
    'inventory-agent': 'border-cyan-200 bg-cyan-50',
    'purchasing-agent': 'border-orange-200 bg-orange-50',
    'quotation-checker': 'border-indigo-200 bg-indigo-50',
    'escalation-agent': 'border-rose-200 bg-rose-50',
    'dashboard': 'border-gray-200 bg-gray-50',
  };

  function getAgentColor(name: string): string {
    return AGENT_COLORS[name] ?? 'border-gray-200 bg-gray-50';
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-gray-500" />
        <h2 className="text-base font-semibold text-gray-800">Agent Notes</h2>
        <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
          {notes.length}
        </span>
      </div>

      {/* Post a new note */}
      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Bot className="h-3.5 w-3.5 text-gray-400" />
          <select
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-xs outline-none focus:border-[#2490ef]"
          >
            <option value="dashboard">Dashboard</option>
            <option value="hermes">Hermes</option>
            <option value="collection-agent">Collection Agent</option>
            <option value="delivery-agent">Delivery Agent</option>
            <option value="production-agent">Production Agent</option>
            <option value="inventory-agent">Inventory Agent</option>
            <option value="purchasing-agent">Purchasing Agent</option>
            <option value="quotation-checker">Quotation Checker</option>
            <option value="escalation-agent">Escalation Agent</option>
          </select>
        </div>
        <div className="flex gap-2">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note for this order... Agents can read and write notes for cross-agent communication."
            rows={2}
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
          />
          <button
            onClick={handlePostNote}
            disabled={posting || !newNote.trim() || !agentName.trim()}
            className="inline-flex items-center gap-1 rounded-lg bg-[#2490ef] px-3 py-2 text-xs font-medium text-white hover:bg-[#1a7ad9] disabled:opacity-50"
          >
            {posting ? (
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Send className="h-3 w-3" />
            )}
            Post
          </button>
        </div>
      </div>

      {/* Notes list */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-[#2490ef]" />
        </div>
      ) : notes.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">
          No agent notes yet. Notes are used by agents for communication and updates.
        </div>
      ) : (
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {notes.map((note) => (
            <div
              key={note.id}
              className={`rounded-lg border p-3 ${getAgentColor(note.agent_name)}`}
            >
              <div className="mb-1 flex items-center gap-2">
                <Bot className="h-3 w-3 text-gray-400" />
                <span className="text-xs font-medium text-gray-700">
                  {note.agent_name}
                </span>
                <span className="text-[10px] text-gray-400">
                  {new Date(note.created_at).toLocaleString()}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-gray-800">{note.note}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
