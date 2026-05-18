'use client';

import { useEffect, useState } from 'react';
import { Order, getOrdersByStage, STAGE_CONFIG } from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import { ShoppingCart, Factory, Calendar, CheckCircle2, Clock } from 'lucide-react';

export default function PurchasingPage() {
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [productionOrders, setProductionOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getOrdersByStage('purchasing_pending').catch(() => []),
      getOrdersByStage('production_confirmed').catch(() => []),
    ])
      .then(([pending, production]) => {
        setPendingOrders(pending);
        setProductionOrders(production);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Workflow info from Excel */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <ShoppingCart className="mt-0.5 h-5 w-5 text-amber-600" />
          <div>
            <h3 className="text-sm font-semibold text-amber-800">Purchasing / Production Workflow</h3>
            <p className="mt-1 text-xs text-amber-700">
              Sales forwards approved quotation → Bot uploads to Google Drive → Quotation math checked →
              Daily reminders ask if production/purchasing has started → Team replies with <code className="rounded bg-amber-100 px-1">/produce QTN-2026-001 yes 10 days</code>
            </p>
          </div>
        </div>
      </div>

      {/* Pending Purchasing */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <Clock className="h-4 w-4 text-amber-500" />
          <h2 className="text-base font-semibold text-gray-800">Pending Purchasing</h2>
          <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            {pendingOrders.length}
          </span>
        </div>
        {pendingOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No pending purchasing orders</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {pendingOrders.map((order) => (
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

      {/* Production Confirmed */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <Factory className="h-4 w-4 text-indigo-500" />
          <h2 className="text-base font-semibold text-gray-800">Production Confirmed</h2>
          <span className="ml-auto rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
            {productionOrders.length}
          </span>
        </div>
        {productionOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No production confirmed orders</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {productionOrders.map((order) => (
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
    </div>
  );
}
