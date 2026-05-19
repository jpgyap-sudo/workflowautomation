'use client';

import { useMonthlySales } from '@/lib/useApi';
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

const MONTH_COLORS = [
  '#3b82f6', '#14b8a6', '#f59e0b', '#6366f1',
  '#06b6d4', '#a855f7', '#f97316', '#e11d48',
  '#10b981', '#22c55e', '#8b5cf6', '#ec4899',
];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(value);
}

export default function SalesPage() {
  const { data, error, isLoading } = useMonthlySales();

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-red-500">Failed to load sales data. Retrying...</p>
      </div>
    );
  }

  const monthly = data?.monthly ?? [];

  // Calculate totals
  const totalOrders = monthly.reduce((sum, r) => sum + r.order_count, 0);
  const totalSales = monthly.reduce((sum, r) => sum + Number(r.total_sales), 0);
  const totalComputed = monthly.reduce((sum, r) => sum + Number(r.computed_sales), 0);

  // Chart data
  const chartData = [...monthly].reverse().map((r, i) => ({
    month: r.month,
    total_sales: Number(r.total_sales),
    fill: MONTH_COLORS[i % MONTH_COLORS.length],
  }));

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Total Orders</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{totalOrders}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Total Sales (Amount)</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">{formatCurrency(totalSales)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Total Computed Amount</p>
          <p className="mt-1 text-2xl font-bold text-blue-600">{formatCurrency(totalComputed)}</p>
        </div>
      </div>

      {/* Bar Chart */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold text-gray-800">Monthly Sales Trend</h2>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) =>
                  v >= 1_000_000 ? `₱${(v / 1_000_000).toFixed(1)}M` : `₱${(v / 1_000).toFixed(0)}K`
                }
              />
              <Tooltip
                formatter={(value) => [formatCurrency(Number(value)), 'Total Sales']}
                contentStyle={{
                  borderRadius: '8px',
                  border: '1px solid #e2e4e7',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                }}
              />
              <Bar dataKey="total_sales" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <p>No sales data yet. Orders with amounts will appear here once created.</p>
          </div>
        )}
      </div>

      {/* Monthly Table */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-800">Monthly Breakdown</h2>
          <span className="text-xs text-gray-400">{monthly.length} months</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-6 py-3">Month</th>
                <th className="px-6 py-3 text-right">Orders</th>
                <th className="px-6 py-3 text-right">Total Amount</th>
                <th className="px-6 py-3 text-right">Computed Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {monthly.map((row) => (
                <tr key={row.month} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-gray-900">{row.month}</td>
                  <td className="px-6 py-3 text-right text-gray-700">{row.order_count}</td>
                  <td className="px-6 py-3 text-right font-medium text-emerald-600">
                    {formatCurrency(Number(row.total_sales))}
                  </td>
                  <td className="px-6 py-3 text-right text-blue-600">
                    {formatCurrency(Number(row.computed_sales))}
                  </td>
                </tr>
              ))}
              {monthly.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-400">
                    No sales data available yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
