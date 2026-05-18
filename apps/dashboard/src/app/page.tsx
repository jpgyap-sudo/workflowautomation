'use client';

import {
  FileText,
  ShoppingCart,
  DollarSign,
  TrendingUp,
} from 'lucide-react';
import { useDashboardStats, useRealtimeSubscription } from '@/lib/useApi';
import { STAGE_CONFIG, STAGE_ORDER } from '@/lib/api';
import StatCard from '@/components/StatCard';
import StageBadge from '@/components/StageBadge';
import OrderTable from '@/components/OrderTable';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

const STAGE_COLORS: Record<string, string> = {
  quotation_received: '#3b82f6',
  math_verified: '#14b8a6',
  purchasing_pending: '#f59e0b',
  production_confirmed: '#6366f1',
  inventory_arrived: '#06b6d4',
  delivery_scheduled: '#a855f7',
  delivered: '#f97316',
  countered: '#e11d48',
  payment_received: '#10b981',
  payment_confirmed: '#22c55e',
  completed: '#6b7280',
};

export default function DashboardPage() {
  // Subscribe to real-time updates
  useRealtimeSubscription();

  const { data: stats, error, isLoading } = useDashboardStats();

  if (isLoading && !stats) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-red-500">Failed to load dashboard data. Retrying...</p>
      </div>
    );
  }

  const stageBreakdown = stats?.stage_breakdown ?? [];
  const chartData = stageBreakdown.map((s) => ({
    name: STAGE_CONFIG[s.stage]?.label ?? s.stage,
    count: s.count,
    fill: STAGE_COLORS[s.stage] ?? '#6b7280',
  }));

  const recentOrders = stats?.recent_orders ?? [];

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Orders"
          value={stats?.total_orders ?? 0}
          icon={FileText}
          color="bg-blue-100 text-blue-600"
        />
        <StatCard
          title="Active Orders"
          value={stats?.active_orders ?? 0}
          icon={TrendingUp}
          color="bg-green-100 text-green-600"
        />
        <StatCard
          title="Pending Purchasing"
          value={stats?.pending_purchasing ?? 0}
          icon={ShoppingCart}
          color="bg-amber-100 text-amber-600"
        />
        <StatCard
          title="Pending Collection"
          value={stats?.pending_collection ?? 0}
          icon={DollarSign}
          color="bg-rose-100 text-rose-600"
        />
      </div>

      {/* Stage Pipeline Chart */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold text-gray-800">Order Stage Pipeline</h2>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
              <YAxis allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  borderRadius: '8px',
                  border: '1px solid #e2e4e7',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <p>No orders yet. Orders will appear here once created via Telegram.</p>
          </div>
        )}
      </div>

      {/* Recent Orders */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-800">Recent Orders</h2>
          <span className="text-xs text-gray-400">{recentOrders.length} orders</span>
        </div>
        <OrderTable orders={recentOrders} />
      </div>
    </div>
  );
}
