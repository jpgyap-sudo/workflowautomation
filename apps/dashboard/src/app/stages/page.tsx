'use client';

import { useOrders } from '@/lib/useApi';
import { STAGE_CONFIG, STAGE_ORDER } from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import { ArrowRight } from 'lucide-react';

export default function StagesPage() {
  const { data: orders = [], isLoading } = useOrders();

  if (isLoading && orders.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
      </div>
    );
  }

  // Group orders by stage
  const stageGroups: Record<string, typeof orders> = {};
  STAGE_ORDER.forEach((stage) => {
    stageGroups[stage] = orders.filter((o) => o.current_stage === stage);
  });

  return (
    <div className="space-y-6">
      {/* Pipeline visualization */}
      <div className="overflow-x-auto">
        <div className="flex gap-3" style={{ minWidth: '900px' }}>
          {STAGE_ORDER.map((stage, index) => {
            const config = STAGE_CONFIG[stage];
            const stageOrders = stageGroups[stage] ?? [];
            return (
              <div key={stage} className="flex-1">
                <div className="flex items-center gap-1">
                  <div
                    className={`flex-1 rounded-lg px-3 py-2 text-center text-xs font-medium ${
                      config?.color ?? 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    <span className="mr-1">{config?.icon}</span>
                    {config?.label ?? stage}
                    <span className="ml-1.5 rounded-full bg-white/60 px-1.5 py-0.5 text-xs">
                      {stageOrders.length}
                    </span>
                  </div>
                  {index < STAGE_ORDER.length - 1 && (
                    <ArrowRight className="h-4 w-4 shrink-0 text-gray-300" />
                  )}
                </div>
                <div className="mt-2 space-y-2">
                  {stageOrders.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-200 p-3 text-center text-xs text-gray-400">
                      No orders
                    </div>
                  ) : (
                    stageOrders.map((order) => (
                      <div
                        key={order.id}
                        className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
                      >
                        <p className="text-xs font-medium text-gray-900">
                          {order.quotation_number ?? '—'}
                        </p>
                        <p className="mt-0.5 text-[10px] text-gray-500">
                          {order.client_name ?? 'Unknown'}
                        </p>
                        {order.total_amount != null && (
                          <p className="mt-0.5 text-[10px] font-medium text-gray-600">
                            ₱{Number(order.total_amount).toLocaleString()}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend / Summary */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold text-gray-800">Stage Summary</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {STAGE_ORDER.map((stage) => {
            const config = STAGE_CONFIG[stage];
            const count = stageGroups[stage]?.length ?? 0;
            return (
              <div key={stage} className="rounded-lg border border-gray-100 p-3">
                <div className="flex items-center gap-2">
                  <span>{config?.icon}</span>
                  <span className="text-xs font-medium text-gray-700">{config?.label ?? stage}</span>
                </div>
                <p className="mt-1 text-lg font-bold text-gray-900">{count}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
