'use client';

import { useOrdersByStage } from '@/lib/useApi';
import StageBadge from '@/components/StageBadge';
import { Truck, Calendar, CheckCircle2, Scale, AlertTriangle } from 'lucide-react';

export default function DeliveryPage() {
  const {
    data: balanceDueOrders = [],
    isLoading: loadingBalanceDue,
  } = useOrdersByStage('balance_due');

  const {
    data: scheduledOrders = [],
    isLoading: loadingScheduled,
  } = useOrdersByStage('delivery_scheduled');

  const {
    data: deliveredOrders = [],
    isLoading: loadingDelivered,
  } = useOrdersByStage('delivered');

  const loading = loadingBalanceDue && loadingScheduled && loadingDelivered;

  if (loading && balanceDueOrders.length === 0 && scheduledOrders.length === 0 && deliveredOrders.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Workflow info from Excel */}
      <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
        <div className="flex items-start gap-3">
          <Truck className="mt-0.5 h-5 w-5 text-purple-600" />
          <div>
            <h3 className="text-sm font-semibold text-purple-800">Delivery Workflow</h3>
            <p className="mt-1 text-xs text-purple-700">
              Balance must be paid before delivery can be scheduled → Team records payment via{' '}
              <code className="rounded bg-purple-100 px-1">/paybalance QTN-2026-001 15000</code>
              {' '}→ Then schedules delivery via{' '}
              <code className="rounded bg-purple-100 px-1">/deliverydate QTN-2026-001 May 22 2026</code>
              {' '}→ Delivery team sends photos/DR → Updates via{' '}
              <code className="rounded bg-purple-100 px-1">/delivered QTN-2026-001 yes countered</code>
            </p>
          </div>
        </div>
      </div>

      {/* Balance Due (blocked until paid) */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <Scale className="h-4 w-4 text-violet-500" />
          <h2 className="text-base font-semibold text-gray-800">Balance Due (Awaiting Payment)</h2>
          <span className="ml-auto rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
            {balanceDueOrders.length}
          </span>
        </div>
        {balanceDueOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No orders awaiting balance payment</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {balanceDueOrders.map((order) => {
              const totalAmount = Number(order.total_amount ?? 0);
              const depositAmount = Number(order.deposit_amount ?? 0);
              const balance = totalAmount - depositAmount;
              return (
                <div key={order.id} className="flex items-center justify-between px-6 py-4">
                  <div>
                    <p className="font-medium text-gray-900">{order.quotation_number ?? '—'}</p>
                    <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-violet-600">
                      ₱{balance.toLocaleString()} due
                    </span>
                    <StageBadge stage={order.current_stage} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Scheduled Deliveries */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <Calendar className="h-4 w-4 text-purple-500" />
          <h2 className="text-base font-semibold text-gray-800">Scheduled Deliveries</h2>
          <span className="ml-auto rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
            {scheduledOrders.length}
          </span>
        </div>
        {scheduledOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No scheduled deliveries</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {scheduledOrders.map((order) => {
              const totalAmount = Number(order.total_amount ?? 0);
              const depositAmount = Number(order.deposit_amount ?? 0);
              const balance = totalAmount - depositAmount;
              return (
                <div key={order.id} className="flex items-center justify-between px-6 py-4">
                  <div>
                    <p className="font-medium text-gray-900">{order.quotation_number ?? '—'}</p>
                    <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                    {order.total_amount != null && (
                      <p className="mt-0.5 text-xs text-gray-400">
                        Total: ₱{totalAmount.toLocaleString()} | Balance: {order.balance_paid ? '✅ Paid' : `₱${balance.toLocaleString()}`}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">
                      {new Date(order.created_at).toLocaleDateString()}
                    </span>
                    <StageBadge stage={order.current_stage} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delivered */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <CheckCircle2 className="h-4 w-4 text-orange-500" />
          <h2 className="text-base font-semibold text-gray-800">Delivered</h2>
          <span className="ml-auto rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
            {deliveredOrders.length}
          </span>
        </div>
        {deliveredOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No delivered orders</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {deliveredOrders.map((order) => (
              <div key={order.id} className="flex items-center justify-between px-6 py-4">
                <div>
                  <p className="font-medium text-gray-900">{order.quotation_number ?? '—'}</p>
                  <p className="text-xs text-gray-500">{order.client_name ?? 'Unknown client'}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">
                    {new Date(order.created_at).toLocaleDateString()}
                  </span>
                  <StageBadge stage={order.current_stage} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Workflow fields from Excel */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Estimated Delivery Date</p>
          <p className="mt-1 text-sm text-gray-800">—</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Actual Delivery Date</p>
          <p className="mt-1 text-sm text-gray-800">—</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">PO / Quotation #</p>
          <p className="mt-1 text-sm text-gray-800">—</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Delivery Issues</p>
          <p className="mt-1 text-sm text-gray-800">—</p>
        </div>
      </div>
    </div>
  );
}
