'use client';

import { useOrdersByStage } from '@/lib/useApi';
import StageBadge from '@/components/StageBadge';
import { Package } from 'lucide-react';

export default function InventoryPage() {
  const { data: arrivedOrders = [], isLoading } = useOrdersByStage('inventory_arrived');

  if (isLoading && arrivedOrders.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Workflow info from Excel */}
      <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4">
        <div className="flex items-start gap-3">
          <Package className="mt-0.5 h-5 w-5 text-cyan-600" />
          <div>
            <h3 className="text-sm font-semibold text-cyan-800">Inventory Arrival Workflow</h3>
            <p className="mt-1 text-xs text-cyan-700">
              Inventory sends arrival photos/files → Bot asks which order it belongs to → 
              Team replies with order number and expected delivery date via{' '}
              <code className="rounded bg-cyan-100 px-1">/deliverydate QTN-2026-001 May 22 2026</code>
            </p>
          </div>
        </div>
      </div>

      {/* Arrived Inventory */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
          <Package className="h-4 w-4 text-cyan-500" />
          <h2 className="text-base font-semibold text-gray-800">Inventory Arrived</h2>
          <span className="ml-auto rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-700">
            {arrivedOrders.length}
          </span>
        </div>
        {arrivedOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No inventory arrivals recorded</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {arrivedOrders.map((order) => (
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

      {/* Info cards for the workflow fields from Excel */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Date of Arrival</p>
          <p className="mt-1 text-sm text-gray-800">—</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Description of Item</p>
          <p className="mt-1 text-sm text-gray-800">—</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">PO / Quotation #</p>
          <p className="mt-1 text-sm text-gray-800">—</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Damages Reported</p>
          <p className="mt-1 text-sm text-gray-800">—</p>
        </div>
      </div>
    </div>
  );
}
