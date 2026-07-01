'use client';

import { useState } from 'react';
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
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Calendar,
  Download,
} from 'lucide-react';

type SortKey = 'month' | 'order_count' | 'total_sales' | 'computed_sales';
type SortDir = 'asc' | 'desc';
type Preset = 'all' | 'today' | '7d' | '30d' | 'month' | 'custom';

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' },
];

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function presetToRange(preset: Preset, customFrom: string, customTo: string): { from?: string; to?: string } {
  const today = new Date();
  switch (preset) {
    case 'today':
      return { from: toISODate(today), to: toISODate(today) };
    case '7d': {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      return { from: toISODate(from), to: toISODate(today) };
    }
    case '30d': {
      const from = new Date(today);
      from.setDate(from.getDate() - 29);
      return { from: toISODate(from), to: toISODate(today) };
    }
    case 'month': {
      const from = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: toISODate(from), to: toISODate(today) };
    }
    case 'custom':
      return customFrom && customTo ? { from: customFrom, to: customTo } : {};
    default:
      return {};
  }
}

const MONTH_COLORS = [
  '#3b82f6', '#14b8a6', '#f59e0b', '#6366f1',
  '#06b6d4', '#a855f7', '#f97316', '#e11d48',
  '#10b981', '#22c55e', '#8b5cf6', '#ec4899',
];

function SortableHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onClick,
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onClick: (key: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const isActive = sortKey === activeKey;
  return (
    <th className={`px-6 py-3 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-gray-900 ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {label}
        {isActive ? (
          dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 text-gray-300" />
        )}
      </button>
    </th>
  );
}

function GrowthBadge({ growth }: { growth: number | null }) {
  if (growth === null) return null;
  return (
    <span className={`ml-2 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium ${growth >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
      {growth >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {growth >= 0 ? '+' : ''}{growth.toFixed(1)}%
    </span>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(value);
}

export default function SalesPage() {
  const [preset, setPreset] = useState<Preset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const range = presetToRange(preset, customFrom, customTo);

  const { data: monthlyData, error: monthlyError, isLoading: monthlyLoading } = useMonthlySales(
    range.from || range.to ? range : undefined
  );
  const { data: agentData = [], isLoading: agentLoading } = useSalesByAgent();
  const { data: clientData = [], isLoading: clientLoading } = useSalesByClient();
  const [sortKey, setSortKey] = useState<SortKey>('month');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const monthly = monthlyData?.monthly ?? [];

  // Calculate totals
  const totalOrders = monthly.reduce((sum, r) => sum + r.order_count, 0);
  const totalSales = monthly.reduce((sum, r) => sum + Number(r.total_sales), 0);
  const totalComputed = monthly.reduce((sum, r) => sum + Number(r.computed_sales), 0);
  const avgOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

  // Chart data
  const chartData = [...monthly].reverse().map((r, i) => ({
    month: r.month,
    total_sales: Number(r.total_sales),
    computed_sales: Number(r.computed_sales),
    fill: MONTH_COLORS[i % MONTH_COLORS.length],
  }));

  // MoM growth calc — must run on the original (newest-first) order before any table sorting
  const monthlyWithGrowth = monthly.map((row, idx) => {
    const prev = monthly[idx + 1];
    const growth = prev ? ((Number(row.total_sales) - Number(prev.total_sales)) / Number(prev.total_sales)) * 100 : null;
    const orderGrowth = prev && prev.order_count > 0 ? ((row.order_count - prev.order_count) / prev.order_count) * 100 : null;
    return { ...row, growth, orderGrowth };
  });

  // Latest-period-vs-prior-period deltas, shown as badges on the summary cards
  const latestSalesGrowth = monthlyWithGrowth[0]?.growth ?? null;
  const latestOrderGrowth = monthlyWithGrowth[0]?.orderGrowth ?? null;

  const sortedMonthly = [...monthlyWithGrowth].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'month') cmp = a.month.localeCompare(b.month);
    else cmp = Number(a[sortKey]) - Number(b[sortKey]);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  function exportCSV() {
    const header = ['Month', 'Orders', 'Total Amount', 'Computed Amount', 'MoM Growth %'];
    const lines = sortedMonthly.map((r) =>
      [
        r.month,
        r.order_count,
        Number(r.total_sales).toFixed(2),
        Number(r.computed_sales).toFixed(2),
        r.growth !== null ? r.growth.toFixed(1) : '',
      ].join(',')
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-monthly-breakdown-${toISODate(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
      {/* Date Range Picker */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3">
        <Calendar className="h-4 w-4 text-gray-400" />
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPreset(p.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              preset === p.key ? 'bg-[var(--primary)] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {p.label}
          </button>
        ))}
        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              max={customTo || undefined}
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700"
            />
            <span className="text-xs text-gray-400">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              min={customFrom || undefined}
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700"
            />
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Total Orders</p>
          <p className="mt-1 flex items-center text-2xl font-bold text-gray-900">
            {totalOrders}
            <GrowthBadge growth={latestOrderGrowth} />
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Total Sales (Amount)</p>
          <p className="mt-1 flex items-center text-2xl font-bold text-emerald-600">
            {formatCurrency(totalSales)}
            <GrowthBadge growth={latestSalesGrowth} />
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Total Computed Amount</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">{formatCurrency(totalComputed)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Avg. Order Value</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{formatCurrency(avgOrderValue)}</p>
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
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">{monthly.length} months</span>
            <button
              type="button"
              onClick={exportCSV}
              disabled={monthly.length === 0}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="h-3 w-3" />
              Export CSV
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <SortableHeader label="Month" sortKey="month" activeKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableHeader label="Orders" sortKey="order_count" activeKey={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <SortableHeader label="Total Amount" sortKey="total_sales" activeKey={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <SortableHeader label="Computed Amount" sortKey="computed_sales" activeKey={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <th className="px-6 py-3 text-right">MoM Growth</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedMonthly.map((row) => (
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
