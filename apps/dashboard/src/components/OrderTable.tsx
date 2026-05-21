import Link from 'next/link';
import type { ReactNode } from 'react';
import { Order } from '@/lib/api';
import StageBadge from './StageBadge';
import { Pencil, Trash2 } from 'lucide-react';

interface OrderTableProps {
  orders: Order[];
  showClient?: boolean;
  showAgent?: boolean;
  showAmount?: boolean;
  showDeposit?: boolean;
  showBalance?: boolean;
  showOrderDate?: boolean;
  showDepositDate?: boolean;
  onEdit?: (order: Order) => void;
  onDelete?: (order: Order) => void;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (id: string, selected: boolean) => void;
  onSelectAll?: (selected: boolean) => void;
}

function money(value: unknown) {
  return value != null ? `₱${Number(value).toLocaleString()}` : '—';
}

function StatusPill({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
}

export default function OrderTable({
  orders,
  showClient = true,
  showAgent = true,
  showAmount = true,
  showDeposit = true,
  showBalance = true,
  showOrderDate = true,
  showDepositDate = true,
  onEdit,
  onDelete,
  selectable = false,
  selectedIds = new Set(),
  onSelect,
  onSelectAll,
}: OrderTableProps) {
  const allSelected = orders.length > 0 && orders.every((o) => selectedIds.has(o.id));
  const someSelected = orders.some((o) => selectedIds.has(o.id)) && !allSelected;

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-12 text-center text-gray-400">
        <p className="text-lg">No orders found</p>
        <p className="text-sm">Orders will appear here once they are created via Telegram</p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile cards */}
      <div className="divide-y divide-gray-100 sm:hidden">
        {orders.map((order) => {
          const detailHref = `/orders/${order.quotation_number ?? order.id}`;
          const isSelected = selectedIds.has(order.id);
          return (
            <article key={order.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  {selectable && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => onSelect?.(order.id, e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-[#2490ef] focus:ring-[#2490ef]"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">{order.quotation_number ?? '—'}</p>
                    {showClient && <p className="truncate text-xs text-gray-500">{order.client_name ?? 'No client'}</p>}
                  </div>
                </div>
                <StageBadge stage={order.current_stage} />
              </div>

              <dl className="grid grid-cols-2 gap-3 text-xs">
                {showAgent && (
                  <div>
                    <dt className="text-gray-400">Sales Agent</dt>
                    <dd className="truncate font-medium text-gray-700">{order.sales_agent ?? '—'}</dd>
                  </div>
                )}
                {showAmount && (
                  <div>
                    <dt className="text-gray-400">Amount</dt>
                    <dd className="font-medium text-gray-700">{money(order.total_amount)}</dd>
                  </div>
                )}
                {showDeposit && (
                  <div>
                    <dt className="text-gray-400">Downpayment</dt>
                    <dd className="mt-1">
                      <StatusPill className={order.deposit_paid ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}>
                        {order.deposit_paid ? `Paid ${money(order.deposit_amount)}` : 'Pending'}
                      </StatusPill>
                    </dd>
                  </div>
                )}
                {showBalance && (
                  <div>
                    <dt className="text-gray-400">Balance</dt>
                    <dd className="mt-1">
                      <StatusPill
                        className={
                          order.balance_paid
                            ? 'bg-green-100 text-green-700'
                            : order.deposit_paid && order.total_amount != null
                              ? 'bg-violet-100 text-violet-700'
                              : 'bg-gray-100 text-gray-500'
                        }
                      >
                        {order.balance_paid
                          ? 'Paid'
                          : order.deposit_paid && order.total_amount != null
                            ? money(Number(order.total_amount) - Number(order.deposit_amount ?? 0))
                            : '—'}
                      </StatusPill>
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-gray-400">Math</dt>
                  <dd className="mt-1">
                    <StatusPill
                      className={
                        order.math_status === 'verified'
                          ? 'bg-green-100 text-green-700'
                          : order.math_status === 'failed'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-yellow-100 text-yellow-700'
                      }
                    >
                      {order.math_status}
                    </StatusPill>
                  </dd>
                </div>
                {showOrderDate && (
                  <div>
                    <dt className="text-gray-400">Order Date</dt>
                    <dd className="font-medium text-gray-700">{formatDate(order.order_confirmed_at)}</dd>
                  </div>
                )}
                {showDepositDate && (
                  <div>
                    <dt className="text-gray-400">Downpayment Date</dt>
                    <dd className="font-medium text-gray-700">{formatDate(order.deposit_paid_at)}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-gray-400">Created</dt>
                  <dd className="font-medium text-gray-700">{new Date(order.created_at).toLocaleDateString()}</dd>
                </div>
              </dl>

              <div className="flex items-center gap-2">
                <Link
                  href={detailHref}
                  className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-[#2490ef] px-3 py-2 text-sm font-medium text-[#2490ef]"
                >
                  View details
                </Link>
                {onEdit && (
                  <button
                    onClick={() => onEdit(order)}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 hover:text-[#2490ef]"
                    title="Edit order"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={() => onDelete(order)}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 hover:bg-red-50 hover:text-red-500"
                    title="Delete order"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs font-medium uppercase tracking-wider text-gray-500">
              {selectable && (
                <th className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={(e) => onSelectAll?.(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-[#2490ef] focus:ring-[#2490ef]"
                  />
                </th>
              )}
              <th className="px-4 py-3">Quotation #</th>
              {showClient && <th className="px-4 py-3">Client</th>}
              {showAgent && <th className="px-4 py-3">Sales Agent</th>}
              <th className="px-4 py-3">Current Stage</th>
              {showAmount && <th className="px-4 py-3 text-right">Amount</th>}
              {showDeposit && <th className="px-4 py-3">Downpayment</th>}
              {showBalance && <th className="px-4 py-3">Balance</th>}
              {showOrderDate && <th className="px-4 py-3">Order Date</th>}
              {showDepositDate && <th className="px-4 py-3">Downpayment Date</th>}
              <th className="px-4 py-3">Math</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {orders.map((order) => {
              const isSelected = selectedIds.has(order.id);
              return (
                <tr key={order.id} className={`hover:bg-gray-50 ${isSelected ? 'bg-blue-50/40' : ''}`}>
                  {selectable && (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => onSelect?.(order.id, e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-[#2490ef] focus:ring-[#2490ef]"
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 font-medium">
                    <span className="text-gray-900">{order.quotation_number ?? '—'}</span>
                  </td>
                  {showClient && <td className="px-4 py-3 text-gray-600">{order.client_name ?? '—'}</td>}
                  {showAgent && <td className="px-4 py-3 text-gray-600">{order.sales_agent ?? '—'}</td>}
                  <td className="px-4 py-3"><StageBadge stage={order.current_stage} /></td>
                  {showAmount && <td className="px-4 py-3 text-right text-gray-600">{money(order.total_amount)}</td>}
                  {showDeposit && (
                    <td className="px-4 py-3">
                      <StatusPill className={order.deposit_paid ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}>
                        {order.deposit_paid ? `Paid ${money(order.deposit_amount)}` : 'Pending'}
                      </StatusPill>
                    </td>
                  )}
                  {showBalance && (
                    <td className="px-4 py-3">
                      <StatusPill
                        className={
                          order.balance_paid
                            ? 'bg-green-100 text-green-700'
                            : order.deposit_paid && order.total_amount != null
                              ? 'bg-violet-100 text-violet-700'
                              : 'bg-gray-100 text-gray-500'
                        }
                      >
                        {order.balance_paid
                          ? 'Paid'
                          : order.deposit_paid && order.total_amount != null
                            ? money(Number(order.total_amount) - Number(order.deposit_amount ?? 0))
                            : '—'}
                      </StatusPill>
                    </td>
                  )}
                  {showOrderDate && (
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(order.order_confirmed_at)}</td>
                  )}
                  {showDepositDate && (
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(order.deposit_paid_at)}</td>
                  )}
                  <td className="px-4 py-3">
                    <StatusPill
                      className={
                        order.math_status === 'verified'
                          ? 'bg-green-100 text-green-700'
                          : order.math_status === 'failed'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-yellow-100 text-yellow-700'
                      }
                    >
                      {order.math_status}
                    </StatusPill>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{new Date(order.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Link href={`/orders/${order.quotation_number ?? order.id}`} className="text-xs font-medium text-[#2490ef] hover:underline">
                        View
                      </Link>
                      {onEdit && (
                        <button
                          onClick={() => onEdit(order)}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#2490ef]"
                          title="Edit order"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => onDelete(order)}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                          title="Delete order"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
