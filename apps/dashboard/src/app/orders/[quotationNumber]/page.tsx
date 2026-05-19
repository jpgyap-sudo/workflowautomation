'use client';

import { useParams } from 'next/navigation';
import { useOrder } from '@/lib/useApi';
import { STAGE_CONFIG, STAGE_ORDER } from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import { ArrowLeft, FileText, User, DollarSign, CheckCircle2, CreditCard, Scale, ExternalLink } from 'lucide-react';
import Link from 'next/link';

export default function OrderDetailPage() {
  const params = useParams();
  const quotationNumber = params.quotationNumber as string;
  const { data: order, error, isLoading } = useOrder(quotationNumber);

  if (isLoading && !order) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
      </div>
    );
  }

  if (!order && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-lg text-gray-500">Order not found</p>
        <Link href="/orders" className="mt-2 text-sm text-[#2490ef] hover:underline">
          Back to orders
        </Link>
      </div>
    );
  }

  if (!order) return null;

  const currentStageIndex = STAGE_ORDER.indexOf(order.current_stage);

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Link
        href="/orders"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to orders
      </Link>

      {/* Order header */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">
                {order.quotation_number ?? 'Unnamed Order'}
              </h1>
              <div className="flex items-center gap-2">
                <StageBadge stage={order.current_stage} />
                {order.google_drive_folder_id && (
                  <a
                    href={`https://drive.google.com/drive/folders/${order.google_drive_folder_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:border-[#2490ef] hover:text-[#2490ef]"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Drive Folder
                  </a>
                )}
              </div>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Created {new Date(order.created_at).toLocaleString()}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              order.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {order.status}
          </span>
        </div>
      </div>

      {/* Order details grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
            <User className="h-4 w-4" />
            Client
          </div>
          <p className="mt-1 text-base text-gray-900">{order.client_name ?? '—'}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
            <User className="h-4 w-4" />
            Sales Agent
          </div>
          <p className="mt-1 text-base text-gray-900">{order.sales_agent ?? '—'}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
            <DollarSign className="h-4 w-4" />
            Total Amount
          </div>
          <p className="mt-1 text-base text-gray-900">
            {order.total_amount != null ? `₱${Number(order.total_amount).toLocaleString()}` : '—'}
          </p>
        </div>
      </div>

      {/* Math status */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
          <CheckCircle2 className="h-4 w-4" />
          Math Verification
        </div>
        <div className="mt-2 flex items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              order.math_status === 'verified'
                ? 'bg-green-100 text-green-700'
                : order.math_status === 'failed'
                ? 'bg-red-100 text-red-700'
                : 'bg-yellow-100 text-yellow-700'
            }`}
          >
            {order.math_status}
          </span>
          {order.computed_amount != null && (
            <span className="text-sm text-gray-600">
              Computed: ₱{Number(order.computed_amount).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Deposit status */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
          <CreditCard className="h-4 w-4" />
          Deposit Payment
        </div>
        <div className="mt-2 flex items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              order.deposit_paid
                ? 'bg-green-100 text-green-700'
                : 'bg-yellow-100 text-yellow-700'
            }`}
          >
            {order.deposit_paid ? '✅ Paid' : '⏳ Pending'}
          </span>
          {order.deposit_amount != null && (
            <span className="text-sm text-gray-600">
              Amount: ₱{Number(order.deposit_amount).toLocaleString()}
            </span>
          )}
          {order.deposit_image_url && (
            <a
              href={order.deposit_image_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#2490ef] hover:underline"
            >
              View Deposit Slip
            </a>
          )}
        </div>
        {!order.deposit_paid && (
          <p className="mt-2 text-xs text-amber-600">
            Deposit required before production can proceed. Use /deposit in Telegram to record payment.
          </p>
        )}
      </div>

      {/* Balance status */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
          <Scale className="h-4 w-4" />
          Balance Payment
        </div>
        <div className="mt-2 flex items-center gap-3">
          {order.total_amount != null && order.deposit_amount != null ? (
            <>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  order.balance_paid
                    ? 'bg-green-100 text-green-700'
                    : 'bg-violet-100 text-violet-700'
                }`}
              >
                {order.balance_paid ? '✅ Paid' : '⏳ Pending'}
              </span>
              <span className="text-sm text-gray-600">
                Balance: ₱{(Number(order.total_amount) - Number(order.deposit_amount)).toLocaleString()}
              </span>
              <span className="text-sm text-gray-400">
                (Total: ₱{Number(order.total_amount).toLocaleString()} − Deposit: ₱{Number(order.deposit_amount).toLocaleString()})
              </span>
            </>
          ) : (
            <span className="text-sm text-gray-400">
              {order.total_amount == null ? 'Total amount not set yet' : 'Deposit not recorded yet'}
            </span>
          )}
        </div>
        {!order.balance_paid && order.deposit_paid && order.total_amount != null && (
          <p className="mt-2 text-xs text-violet-600">
            Balance must be paid before delivery can be scheduled. Use /paybalance in Telegram to record payment.
          </p>
        )}
      </div>

      {/* Stage progress */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold text-gray-800">Stage Progress</h2>
        <div className="space-y-3">
          {STAGE_ORDER.map((stage, index) => {
            const config = STAGE_CONFIG[stage];
            const isCompleted = index <= currentStageIndex;
            const isCurrent = index === currentStageIndex;
            const stageUpdate = order.stage_updates?.find((u) => u.stage === stage);

            return (
              <div key={stage} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      isCompleted
                        ? isCurrent
                          ? 'bg-[#2490ef] text-white'
                          : 'bg-green-500 text-white'
                        : 'bg-gray-200 text-gray-400'
                    }`}
                  >
                    {isCompleted ? '✓' : index + 1}
                  </div>
                  {index < STAGE_ORDER.length - 1 && (
                    <div
                      className={`mt-1 h-6 w-0.5 ${
                        isCompleted && index < currentStageIndex ? 'bg-green-300' : 'bg-gray-200'
                      }`}
                    />
                  )}
                </div>
                <div className={`flex-1 pb-3 ${isCurrent ? '' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-medium ${
                        isCompleted ? 'text-gray-900' : 'text-gray-400'
                      }`}
                    >
                      {config?.icon} {config?.label ?? stage}
                    </span>
                    {isCurrent && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                        Current
                      </span>
                    )}
                  </div>
                  {stageUpdate && (
                    <div className="mt-1 rounded-lg bg-gray-50 p-2">
                      <p className="text-xs text-gray-600">
                        Status: <span className="font-medium">{stageUpdate.status}</span>
                        {stageUpdate.remarks && <> — {stageUpdate.remarks}</>}
                      </p>
                      <p className="mt-0.5 text-[10px] text-gray-400">
                        by {stageUpdate.updated_by ?? 'system'} on{' '}
                        {new Date(stageUpdate.created_at).toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Files */}
      {order.files && order.files.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-base font-semibold text-gray-800">Files</h2>
          <div className="space-y-2">
            {order.files.map((file) => (
              <div key={file.id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3">
                <FileText className="h-4 w-4 text-gray-400" />
                <div className="flex-1">
                  <p className="text-sm text-gray-900">{file.original_filename ?? 'Unnamed file'}</p>
                  <p className="text-xs text-gray-400">{file.file_type}</p>
                </div>
                {file.google_drive_file_id && (
                  <a
                    href={`https://drive.google.com/file/d/${file.google_drive_file_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#2490ef] hover:underline"
                  >
                    Open in Drive
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
