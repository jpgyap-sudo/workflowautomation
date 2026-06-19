'use client';

import { useMonthlySales, useSalesByAgent, useSalesByClient } from '@/lib/useApi';
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
import {
  TrendingUp,
  TrendingDown,
  Users,
  User,
  BarChart3,
  Loader2,
} from 'lucide-react';

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
  const { data: monthlyData, error: monthlyError, isLoading: monthlyLoading } = useMonthlySales();
  const { data: agentData = [], isLoading: agentLoading } = useSalesByAgent();
  const { data: clientData = [], isLoading: clientLoading } = useSalesByClient();

  const monthly = monthlyData?.monthly ?? [];

  // Calculate totals
  const totalOrders = monthly.reduce((sum, r) => sum + r.order_count, 0);
  const totalSales = monthly.reduce((sum, r) => sum + Number(r.total_sales), 0);
  const totalComputed = monthly.reduce((sum, r) => sum + Number(r.computed_sales), 0);

  // Chart data
  const chartData = [...monthly].reverse().map((r, i) => ({
    month: r.month,
    total_sales: Number(r.total_sales),
    computed_sales: Number(r.computed_sales),
    fill: MONTH_COLORS[i % MONTH_COLORS.length],
  }));

  // MoM growth calc
  const monthlyWithGrowth = monthly.map((row, idx) => {
    const prev = monthly[idx + 1];
    const growth = prev ? ((Number(row.total_sales) - Number(prev.total_sales)) / Number(prev.total_sales)) * 100 : null;
    return { ...row, growth };
  });

  if (monthlyLoading && !monthlyData) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" />
      </div>
    );
  }

  if (monthlyError && !monthlyData) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-red-500">Failed to load sales data. Retrying...</p>
      </div>
    );
  }

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
          <p className="mt-1 text-2xl font-bold text-emerald-600">{formatCurrency(totalComputed)}</p>
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
                formatter={(value, name) => [
                  formatCurrency(Number(value)),
                  name === 'total_sales' ? 'Total Sales' : 'Computed Sales',
                ]}
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

      {/* Monthly Table with Growth */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-800">Monthly Breakdown</h2>
          <span className="text-xs text-gray-400">{monthly.length} months</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-6 py-3">Month</th>
                <th className="px-6 py-3 text-right">Orders</th>
                <th className="px-6 py-3 text-right">Total Amount</th>
                <th className="px-6 py-3 text-right">Computed Amount</th>
                <th className="px-6 py-3 text-right">MoM Growth</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {monthlyWithGrowth.map((row) => (
                <tr key={row.month} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-gray-900">{row.month}</td>
                  <td className="px-6 py-3 text-right text-gray-700">{row.order_count}</td>
                  <td className="px-6 py-3 text-right font-medium text-emerald-600">
                    {formatCurrency(Number(row.total_sales))}
                  </td>
                  <td className="px-6 py-3 text-right text-emerald-600">
                    {formatCurrency(Number(row.computed_sales))}
                  </td>
                  <td className="px-6 py-3 text-right">
                    {row.growth !== null ? (
                      <span className={`inline-flex items-center gap-1 text-xs font-medium ${row.growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {row.growth >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {row.growth >= 0 ? '+' : ''}{row.growth.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {monthly.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                    No sales data available yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Agent + Client Leaderboards */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* By Agent */}
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
            <User className="h-4 w-4 text-purple-500" />
            <h2 className="text-base font-semibold text-gray-800">Sales by Agent</h2>
            <span className="ml-auto rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
              {agentData.length}
            </span>
          </div>
          {agentLoading && agentData.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : agentData.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">No agent data available</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs font-medium text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3 text-right">Orders</th>
                    <th className="px-4 py-3 text-right">Total Sales</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {agentData.map((row, idx) => (
                    <tr key={row.agent} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {idx === 0 && <span className="text-sm">🥇</span>}
                          {idx === 1 && <span className="text-sm">🥈</span>}
                          {idx === 2 && <span className="text-sm">🥉</span>}
                          <span className="font-medium text-gray-900">{row.agent}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{row.order_count}</td>
                      <td className="px-4 py-3 text-right font-medium text-emerald-600">
                        {formatCurrency(Number(row.total_sales))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* By Client */}
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-4">
            <Users className="h-4 w-4 text-emerald-500" />
            <h2 className="text-base font-semibold text-gray-800">Top Clients</h2>
            <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
              {clientData.length}
            </span>
          </div>
          {clientLoading && clientData.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : clientData.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">No client data available</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs font-medium text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3 text-right">Orders</th>
                    <th className="px-4 py-3 text-right">Total Sales</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {clientData.slice(0, 10).map((row, idx) => (
                    <tr key={row.client} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {idx === 0 && <span className="text-sm">🥇</span>}
                          {idx === 1 && <span className="text-sm">🥈</span>}
                          {idx === 2 && <span className="text-sm">🥉</span>}
                          <span className="font-medium text-gray-900">{row.client}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{row.order_count}</td>
                      <td className="px-4 py-3 text-right font-medium text-emerald-600">
                        {formatCurrency(Number(row.total_sales))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
