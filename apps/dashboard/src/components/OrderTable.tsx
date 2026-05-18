import Link from 'next/link';
import { Order, STAGE_CONFIG } from '@/lib/api';
import StageBadge from './StageBadge';

interface OrderTableProps {
  orders: Order[];
  showClient?: boolean;
  showAgent?: boolean;
  showAmount?: boolean;
}

export default function OrderTable({ orders, showClient = true, showAgent = true, showAmount = true }: OrderTableProps) {
  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <p className="text-lg">No orders found</p>
        <p className="text-sm">Orders will appear here once they are created via Telegram</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-xs font-medium uppercase tracking-wider text-gray-500">
            <th className="px-4 py-3">Quotation #</th>
            {showClient && <th className="px-4 py-3">Client</th>}
            {showAgent && <th className="px-4 py-3">Sales Agent</th>}
            <th className="px-4 py-3">Current Stage</th>
            {showAmount && <th className="px-4 py-3 text-right">Amount</th>}
            <th className="px-4 py-3">Math</th>
            <th className="px-4 py-3">Created</th>
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {orders.map((order) => (
            <tr key={order.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-gray-900">
                {order.quotation_number ?? '—'}
              </td>
              {showClient && <td className="px-4 py-3 text-gray-600">{order.client_name ?? '—'}</td>}
              {showAgent && <td className="px-4 py-3 text-gray-600">{order.sales_agent ?? '—'}</td>}
              <td className="px-4 py-3">
                <StageBadge stage={order.current_stage} />
              </td>
              {showAmount && (
                <td className="px-4 py-3 text-right text-gray-600">
                  {order.total_amount != null ? `₱${Number(order.total_amount).toLocaleString()}` : '—'}
                </td>
              )}
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    order.math_status === 'verified'
                      ? 'bg-green-100 text-green-700'
                      : order.math_status === 'failed'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}
                >
                  {order.math_status}
                </span>
              </td>
              <td className="px-4 py-3 text-xs text-gray-500">
                {new Date(order.created_at).toLocaleDateString()}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/orders/${order.quotation_number ?? order.id}`}
                  className="text-xs font-medium text-[#2490ef] hover:underline"
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
