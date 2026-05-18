'use client';

import { useState } from 'react';
import { useOrders } from '@/lib/useApi';
import { STAGE_CONFIG } from '@/lib/api';
import OrderTable from '@/components/OrderTable';

export default function OrdersPage() {
  const { data: orders = [], error, isLoading } = useOrders();
  const [filter, setFilter] = useState<string>('all');

  const filtered = filter === 'all' ? orders : orders.filter((o) => o.current_stage === filter);

  if (isLoading && orders.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            filter === 'all' ? 'bg-[#2490ef] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
          }`}
        >
          All ({orders.length})
        </button>
        <button
          onClick={() => setFilter('active')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            filter === 'active' ? 'bg-[#2490ef] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
          }`}
        >
          Active ({orders.filter((o) => o.status === 'active').length})
        </button>
        <button
          onClick={() => setFilter('completed')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            filter === 'completed' ? 'bg-[#2490ef] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
          }`}
        >
          Completed ({orders.filter((o) => o.current_stage === 'completed').length})
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-800">All Orders</h2>
          <span className="text-xs text-gray-400">{filtered.length} orders</span>
        </div>
        <OrderTable orders={filtered} />
      </div>
    </div>
  );
}
