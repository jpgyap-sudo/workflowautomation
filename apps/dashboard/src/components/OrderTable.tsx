'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Order } from '@/lib/api';
import StageBadge from './StageBadge';
import Timestamp from './Timestamp';
import { Pencil, Trash2, FileText, DollarSign } from 'lucide-react';

interface OrderTableProps {
  orders: Order[];
  showClient?: boolean;
  showAgent?: boolean;
  showAmount?: boolean;
  showDeposit?: boolean;
  showBalance?: boolean;
  showOrderDate?: boolean;
  showDepositDate?: boolean;
  showProjectedLeadTime?: boolean;
  onEdit?: (order: Order) => void;
  onDelete?: (order: Order) => void;
  onViewFiles?: (order: Order) => void;
  onRecordDeposit?: (order: Order) => void;
  onUpdateAmount?: (order: Order, amount: number, reason: string) => void;
  savingAmountOrderId?: string | null;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (id: string, selected: boolean) => void;
  onSelectAll?: (selected: boolean) => void;
  /** Quick-verify shortcut: only shown when payment recorded but not yet verified */
  onVerifyDeposit?: (order: Order) => void;
  onVerifyBalance?: (order: Order) => void;
}

function money(value: unknown) {
  return value != null ? `₱${Number(value).toLocaleString()}` : '—';
}


function parseAmount(value: string) {
  return Number(value.replace(/,/g, ''));
}

function StatusPill({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

function VerificationPill({
  verified,
  onClick,
}: {
  verified: boolean | null | undefined;
  onClick?: () => void;
}) {
  if (!verified && onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title="Click to verify payment"
        className="inline-flex cursor-pointer items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 ring-1 ring-yellow-300 hover:bg-yellow-200 hover:ring-yellow-400 transition-colors"
      >
        Pending ✓
      </button>
    );
  }
  return (
    <StatusPill className={verified ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}>
      {verified ? 'Verified' : 'Pending'}
    </StatusPill>
  );
}

// Stages that have already passed balance verification — use to infer balance_verified
// for orders that were manually advanced without going through the verify-balance step.
const BALANCE_VERIFIED_STAGES = new Set([
  'delivery_pending', 'delivery_scheduled', 'delivered',
  'countered', 'payment_received', 'payment_confirmed', 'completed',
]);

// When an order is at (or past) a stage that requires balance verification to reach,
// treat it as verified even if the DB flag is still FALSE (legacy/manual advancement gap).
function effectiveBalanceVerified(order: Order): boolean {
  if (order.balance_verified) return true;
  return !!(order.balance_paid && BALANCE_VERIFIED_STAGES.has(order.current_stage));
}

function formatDate(value: string | null | undefined) {
  if (!value) return '\u2014';
  return <Timestamp value={value} variant="compact" />;
}

interface AmountCellProps {
  order: Order;
  mobile?: boolean;
  isEditing: boolean;
  isSaving: boolean;
  amountDraft: string;
  reasonDraft: string;
  amountError: string | null;
  onStartEdit: (order: Order) => void;
  onCancel: () => void;
  onSubmit: (order: Order) => void;
  onAmountChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  canEdit: boolean;
}

function AmountCell({
  order,
  mobile = false,
  isEditing,
  isSaving,
  amountDraft,
  reasonDraft,
  amountError,
  onStartEdit,
  onCancel,
  onSubmit,
  onAmountChange,
  onReasonChange,
  canEdit,
}: AmountCellProps) {
  const changed = Boolean(order.total_amount_changed);
  if (isEditing) {
    return (
      <div className={`space-y-2 ${mobile ? '' : 'min-w-[220px] text-left'}`}>
        <input
          value={amountDraft}
          onChange={(e) => onAmountChange(e.target.value.replace(/[^0-9.,]/g, ''))}
          className="w-full rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-right text-sm font-semibold text-red-600 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
          placeholder="Amount"
          autoFocus
        />
        <textarea
          value={reasonDraft}
          onChange={(e) => onReasonChange(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-2 py-1 text-xs outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
          rows={2}
          placeholder="Reason required, e.g. due to change order of item"
        />
        {amountError && <p className="text-[11px] text-red-600">{amountError}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50"
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(order)}
            className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700 disabled:opacity-60"
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onStartEdit(order)}
      className={`inline-flex items-center justify-end gap-1 text-right ${canEdit ? 'cursor-pointer rounded px-1 py-0.5 hover:bg-red-50' : ''} ${
        changed ? 'font-semibold text-red-600' : 'text-gray-600'
      }`}
      title={
        changed
          ? `Amount changed${order.amount_change_reason ? `: ${order.amount_change_reason}` : ''}`
          : 'Click to edit amount'
      }
      disabled={!canEdit}
    >
      <span>{money(order.total_amount)}</span>
      {canEdit && (
        <Pencil className={`h-3.5 w-3.5 ${changed ? 'text-red-500' : 'text-gray-400'}`} aria-hidden="true" />
      )}
      {changed && <span className="ml-1 text-[10px] font-medium text-red-500">edited</span>}
    </button>
  );
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
  showProjectedLeadTime = false,
  onEdit,
  onDelete,
  onViewFiles,
  onRecordDeposit,
  onUpdateAmount,
  savingAmountOrderId = null,
  selectable = false,
  selectedIds = new Set(),
  onSelect,
  onSelectAll,
  onVerifyDeposit,
  onVerifyBalance,
}: OrderTableProps) {
  const allSelected = orders.length > 0 && orders.every((o) => selectedIds.has(o.id));
  const someSelected = orders.some((o) => selectedIds.has(o.id)) && !allSelected;
  const [editingAmountId, setEditingAmountId] = useState<string | null>(null);
  const [amountDraft, setAmountDraft] = useState('');
  const [reasonDraft, setReasonDraft] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);

  function startAmountEdit(order: Order) {
    if (!onUpdateAmount) return;
    setEditingAmountId(order.id);
    setAmountDraft(order.total_amount != null ? String(order.total_amount) : '');
    setReasonDraft('');
    setAmountError(null);
  }

  function cancelAmountEdit() {
    setEditingAmountId(null);
    setAmountDraft('');
    setReasonDraft('');
    setAmountError(null);
  }

  function submitAmountEdit(order: Order) {
    const amount = parseAmount(amountDraft);
    if (!Number.isFinite(amount) || amount <= 0) {
      setAmountError('Enter a valid amount.');
      return;
    }
    if (!reasonDraft.trim()) {
      setAmountError('Reason is required for amount changes.');
      return;
    }
    if (order.total_amount != null && Math.abs(Number(order.total_amount) - amount) <= 0.01) {
      cancelAmountEdit();
      return;
    }
    onUpdateAmount?.(order, amount, reasonDraft.trim());
  }

  function handleAmountChange(value: string) {
    setAmountDraft(value);
    setAmountError(null);
  }

  function handleReasonChange(value: string) {
    setReasonDraft(value);
    setAmountError(null);
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-12 text-center text-gray-400">
        <p className="text-lg">No orders found</p>
        <p className="text-sm">Create an order with the + New Order button or via Telegram</p>
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
                    <Link
                      href={detailHref}
                      className="truncate text-sm font-semibold text-[#2490ef] hover:underline"
                    >
                      {order.quotation_number ?? '—'}
                    </Link>
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
                    <dd className="font-medium"><AmountCell order={order} mobile isEditing={editingAmountId === order.id} isSaving={savingAmountOrderId === order.id} amountDraft={amountDraft} reasonDraft={reasonDraft} amountError={amountError} onStartEdit={startAmountEdit} onCancel={cancelAmountEdit} onSubmit={submitAmountEdit} onAmountChange={handleAmountChange} onReasonChange={handleReasonChange} canEdit={!!onUpdateAmount} /></dd>
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
                    {order.computed_amount == null ? (
                      <span className="text-xs text-gray-400">—</span>
                    ) : (
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
                    )}
                  </dd>
                </div>
                {showOrderDate && (
                  <div>
                    <dt className="text-gray-400">Order Date</dt>
                    <dd className="font-medium text-gray-700">{formatDate(order.order_confirmed_at || order.created_at)}</dd>
                  </div>
                )}
                {showDepositDate && (
                  <div>
                    <dt className="text-gray-400">Downpayment Date</dt>
                    <dd className="font-medium text-gray-700">{formatDate(order.deposit_paid_at)}</dd>
                  </div>
                )}
                {showDeposit && (
                  <div>
                    <dt className="text-gray-400">Downpayment Verified</dt>
                    <dd className="mt-1">
                      <VerificationPill
                        verified={order.deposit_verified}
                        onClick={onVerifyDeposit && order.deposit_paid && !order.deposit_verified
                          ? () => onVerifyDeposit(order)
                          : undefined}
                      />
                    </dd>
                    {order.deposit_verified_at && <dd className="mt-1 text-[11px] text-gray-400">{formatDate(order.deposit_verified_at)}</dd>}
                  </div>
                )}
                {showBalance && (
                  <div>
                    <dt className="text-gray-400">Balance Payment Date</dt>
                    <dd className="font-medium text-gray-700">{formatDate(order.balance_paid_at)}</dd>
                  </div>
                )}
                {showBalance && (
                  <div>
                    <dt className="text-gray-400">Balance Verified</dt>
                    <dd className="mt-1">
                      <VerificationPill
                        verified={effectiveBalanceVerified(order)}
                        onClick={onVerifyBalance && order.balance_paid && !effectiveBalanceVerified(order)
                          ? () => onVerifyBalance(order)
                          : undefined}
                      />
                    </dd>
                    {order.balance_verified_at && <dd className="mt-1 text-[11px] text-gray-400">{formatDate(order.balance_verified_at)}</dd>}
                  </div>
                )}
                <div>
                  <dt className="text-gray-400">Created</dt>
                  <dd className="font-medium text-gray-700"><Timestamp value={order.created_at} variant="compact" /></dd>
                </div>
                <div>
                  <dt className="text-gray-400">Updated</dt>
                  <dd className="font-medium text-gray-700"><Timestamp value={order.updated_at} variant="relative" /></dd>
                </div>
                {showProjectedLeadTime && (
                  <div>
                    <dt className="text-gray-400">Lead Time</dt>
                    <dd className="font-medium text-gray-700">
                      {order.projected_lead_time ? (
                        <span className={`text-xs ${(() => {
                          const startedAt = order.projected_lead_time_started_at ?? order.created_at;
                          const deadlineMs = order.projected_lead_time * 86_400_000;
                          const elapsedMs = Date.now() - new Date(startedAt).getTime();
                          const remainingMs = Math.max(deadlineMs - elapsedMs, 0);
                          const remainingDays = Math.ceil(remainingMs / 86_400_000);
                          const isDelayed = elapsedMs > deadlineMs;
                          if (isDelayed) return 'text-red-600 font-semibold';
                          if (remainingDays <= Math.ceil(order.projected_lead_time * 0.15)) return 'text-amber-600 font-semibold';
                          return 'text-green-600';
                        })()}`}>
                          {order.projected_lead_time}d
                          {(() => {
                            const startedAt = order.projected_lead_time_started_at ?? order.created_at;
                            const deadlineMs = order.projected_lead_time * 86_400_000;
                            const elapsedMs = Date.now() - new Date(startedAt).getTime();
                            const remainingMs = Math.max(deadlineMs - elapsedMs, 0);
                            const remainingDays = Math.ceil(remainingMs / 86_400_000);
                            const isDelayed = elapsedMs > deadlineMs;
                            if (isDelayed) return ` (overdue)`;
                            return ` (${remainingDays}d left)`;
                          })()}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </dd>
                  </div>
                )}
              </dl>

              <div className="flex items-center gap-2">
                {onViewFiles && (
                  <button
                    onClick={() => onViewFiles(order)}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 hover:text-[#2490ef]"
                    title="View order files"
                  >
                    <FileText className="h-4 w-4" />
                  </button>
                )}
                {onRecordDeposit && !order.deposit_paid && (
                  <button
                    onClick={() => onRecordDeposit(order)}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-green-300 px-3 py-2 text-sm text-green-700 hover:bg-green-50"
                    title="Record deposit"
                  >
                    <DollarSign className="h-4 w-4" />
                  </button>
                )}
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
        <table className="w-full min-w-[1180px] text-left text-sm">
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
              {showDeposit && <th className="px-4 py-3">Downpayment Verified</th>}
              {showBalance && <th className="px-4 py-3">Balance Payment Date</th>}
              {showBalance && <th className="px-4 py-3">Balance Verified</th>}
              <th className="px-4 py-3">Math</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Updated</th>
              {showProjectedLeadTime && <th className="px-4 py-3">Lead Time</th>}
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
                    <Link
                      href={`/orders/${order.quotation_number ?? order.id}`}
                      className="text-[#2490ef] hover:underline"
                    >
                      {order.quotation_number ?? '—'}
                    </Link>
                  </td>
                  {showClient && <td className="px-4 py-3 text-gray-600">{order.client_name ?? '—'}</td>}
                  {showAgent && <td className="px-4 py-3 text-gray-600">{order.sales_agent ?? '—'}</td>}
                  <td className="px-4 py-3"><StageBadge stage={order.current_stage} /></td>
                  {showAmount && (
                    <td className="px-4 py-3 text-right align-top">
                      <AmountCell order={order} isEditing={editingAmountId === order.id} isSaving={savingAmountOrderId === order.id} amountDraft={amountDraft} reasonDraft={reasonDraft} amountError={amountError} onStartEdit={startAmountEdit} onCancel={cancelAmountEdit} onSubmit={submitAmountEdit} onAmountChange={handleAmountChange} onReasonChange={handleReasonChange} canEdit={!!onUpdateAmount} />
                    </td>
                  )}
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
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(order.order_confirmed_at || order.created_at)}</td>
                  )}
                  {showDepositDate && (
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(order.deposit_paid_at)}</td>
                  )}
                  {showDeposit && (
                    <td className="px-4 py-3">
                      <VerificationPill
                        verified={order.deposit_verified}
                        onClick={onVerifyDeposit && order.deposit_paid && !order.deposit_verified
                          ? () => onVerifyDeposit(order)
                          : undefined}
                      />
                      {order.deposit_verified_at && <div className="mt-1 text-[11px] text-gray-400">{formatDate(order.deposit_verified_at)}</div>}
                    </td>
                  )}
                  {showBalance && (
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(order.balance_paid_at)}</td>
                  )}
                  {showBalance && (
                    <td className="px-4 py-3">
                      <VerificationPill
                        verified={effectiveBalanceVerified(order)}
                        onClick={onVerifyBalance && order.balance_paid && !effectiveBalanceVerified(order)
                          ? () => onVerifyBalance(order)
                          : undefined}
                      />
                      {order.balance_verified_at && <div className="mt-1 text-[11px] text-gray-400">{formatDate(order.balance_verified_at)}</div>}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    {order.computed_amount == null ? (
                      <span className="text-xs text-gray-400">—</span>
                    ) : (
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
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500"><Timestamp value={order.created_at} variant="compact" /></td>
                  <td className="px-4 py-3 text-xs text-gray-500"><Timestamp value={order.updated_at} variant="relative" /></td>
                  {showProjectedLeadTime && (
                    <td className="px-4 py-3 text-xs">
                      {order.projected_lead_time ? (
                        <span className={(() => {
                          const startedAt = order.projected_lead_time_started_at ?? order.created_at;
                          const deadlineMs = order.projected_lead_time * 86_400_000;
                          const elapsedMs = Date.now() - new Date(startedAt).getTime();
                          const remainingMs = Math.max(deadlineMs - elapsedMs, 0);
                          const remainingDays = Math.ceil(remainingMs / 86_400_000);
                          const isDelayed = elapsedMs > deadlineMs;
                          if (isDelayed) return 'text-red-600 font-semibold';
                          if (remainingDays <= Math.ceil(order.projected_lead_time * 0.15)) return 'text-amber-600 font-semibold';
                          return 'text-green-600';
                        })()}>
                          {order.projected_lead_time}d
                          {(() => {
                            const startedAt = order.projected_lead_time_started_at ?? order.created_at;
                            const deadlineMs = order.projected_lead_time * 86_400_000;
                            const elapsedMs = Date.now() - new Date(startedAt).getTime();
                            const remainingMs = Math.max(deadlineMs - elapsedMs, 0);
                            const remainingDays = Math.ceil(remainingMs / 86_400_000);
                            const isDelayed = elapsedMs > deadlineMs;
                            if (isDelayed) return ` 🔴 overdue`;
                            return ` (${remainingDays}d)`;
                          })()}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {onViewFiles && (
                        <button
                          onClick={() => onViewFiles(order)}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#2490ef]"
                          title="View order files"
                        >
                          <FileText className="h-4 w-4" />
                        </button>
                      )}
                      {onRecordDeposit && !order.deposit_paid && (
                        <button
                          onClick={() => onRecordDeposit(order)}
                          className="rounded-lg p-1.5 text-green-600 hover:bg-green-50"
                          title="Record deposit"
                        >
                          <DollarSign className="h-4 w-4" />
                        </button>
                      )}
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
