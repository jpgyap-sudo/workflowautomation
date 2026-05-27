'use client';

/* eslint-disable react-hooks/set-state-in-effect */
import { Fragment, useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useOrder } from '@/lib/useApi';
import { useAuth } from '@/lib/auth';
import { STAGE_CONFIG, STAGE_ORDER, getItemCompletion, getOrderItems, getProductionLogs, extractOrderItems, inventoryVerifyItem, bulkInventoryVerify, completeInventoryVerification, confirmInventoryArrived, createOrderItem, updateOrderItem, uploadOrderFile, postAgentNote, recordDepositWithFile, recordStageUpdate, visionExtract, verifyDeposit, getOrderPayments, type OrderItem, type ItemCompletion, type ProductionUpdateLog, type Payment } from '@/lib/api';
import StageBadge from '@/components/StageBadge';
import Timestamp from '@/components/Timestamp';
import OtpModal from '@/components/OtpModal';
import { ArrowLeft, FileText, User, DollarSign, CheckCircle2, CreditCard, Scale, MapPin, Phone, UserCheck, Truck, Clock, AlertTriangle, MessageSquare, Send, Bot, Package, Factory, List, Sparkles, CheckCircle, Upload, Sparkles as SparklesIcon, Loader2, Shield, Plus, Pencil, X } from 'lucide-react';
import Link from 'next/link';
import { FileViewerModal, useOrderFileViewer } from '@/components/OrderFileViewer';

function DaysInStage({ updatedAt }: { updatedAt: string }) {
  const days = Math.floor((new Date().getTime() - new Date(updatedAt).getTime()) / 86_400_000);
  if (days <= 0) return null;
  const cls = days >= 7 ? 'text-red-600 font-semibold' : days >= 3 ? 'text-amber-500' : 'text-gray-400';
  return <span className={`text-xs ${cls}`}>{days}d in stage</span>;
}

export default function OrderDetailPage() {
  const params = useParams();
  const quotationNumber = params.quotationNumber as string;
  const { data: order, error, isLoading } = useOrder(quotationNumber);
  const { user } = useAuth();
  const { viewingFilesOrder, orderFiles, handleViewFiles, refreshFiles, closeViewer } = useOrderFileViewer();
  const [showVerifyDepositOtp, setShowVerifyDepositOtp] = useState(false);
  const [verifyingDeposit, setVerifyingDeposit] = useState(false);
  const [verifyDepositResult, setVerifyDepositResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentTotals, setPaymentTotals] = useState<{ deposit: number; balance: number; expected_balance: number | null; remaining_balance: number | null } | null>(null);

  const [showStageAdvanceOtp, setShowStageAdvanceOtp] = useState(false);
  const [targetAdvanceStage, setTargetAdvanceStage] = useState<string | null>(null);
  const [advancingStage, setAdvancingStage] = useState(false);
  const [advanceResult, setAdvanceResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleVerifyDepositVerified(actionToken: string) {
    if (!order) return;
    setVerifyingDeposit(true);
    setVerifyDepositResult(null);
    try {
      const res = await verifyDeposit(order.id, {
        verified_by: 'dashboard',
        action_token: actionToken,
      });
      if (res.ok) {
        setVerifyDepositResult({ ok: true, message: `✅ Deposit verified! Advancing to ${res.next_stage?.replace(/_/g, ' ') ?? 'next stage'}.` });
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setVerifyDepositResult({ ok: false, message: 'Failed to verify deposit.' });
      }
    } catch (err: any) {
      setVerifyDepositResult({ ok: false, message: err.message ?? 'Failed to verify deposit.' });
    } finally {
      setVerifyingDeposit(false);
    }
  }

  async function handleStageAdvanceVerified(actionToken: string) {
    if (!order || !targetAdvanceStage) return;
    setAdvancingStage(true);
    setAdvanceResult(null);
    try {
      const res = await recordStageUpdate({
        quotation_number: order.quotation_number ?? '',
        stage: targetAdvanceStage,
        status: 'pending',
        remarks: `Advanced from ${order.current_stage} via dashboard`,
        action_token: actionToken,
      });
      if (res.ok) {
        setAdvanceResult({ ok: true, message: `✅ Advanced to ${targetAdvanceStage.replace(/_/g, ' ')}!` });
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setAdvanceResult({ ok: false, message: 'Failed to advance stage.' });
      }
    } catch (err: any) {
      setAdvanceResult({ ok: false, message: err.message ?? 'Failed to advance stage.' });
    } finally {
      setAdvancingStage(false);
    }
  }

  // Fetch payment history (MUST be before conditional returns — React hooks rule)
  useEffect(() => {
    if (!order) return;
    let cancelled = false;
    getOrderPayments(order.id)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setPayments(res.payments);
          setPaymentTotals(res.totals);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [order?.id]);

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
  const escalation = order.escalation_level ?? 0;
  const lifecycleTimestamps = [
    ['Created', order.created_at],
    ['Last updated', order.updated_at],
    ['Order confirmed', order.order_confirmed_at],
    ['Deposit paid', order.deposit_paid_at],
    ['Deposit verified', order.deposit_verified_at],
    ['Balance paid', order.balance_paid_at],
    ['Balance verified', order.balance_verified_at],
    ['Production started', order.production_started_at],
    ['Production finished', order.production_finished_at],
    ['En route confirmed', order.en_route_confirmed_at],
    ['Inventory verified', order.inventory_verified_at],
    ['Delivery scheduled', order.delivery_date],
    ['Delivery exception granted', order.delivery_exception_granted_at],
    ['Production exception granted', order.production_exception_granted_at],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

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
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <span className="text-sm text-gray-500">
                Created <Timestamp value={order.created_at} variant="compact" />
              </span>
              <span className="flex items-center gap-1 text-xs font-medium text-gray-400">
                <Clock className="h-3.5 w-3.5" />
                <DaysInStage updatedAt={order.updated_at} />
              </span>
              {escalation > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                  <AlertTriangle className="h-3 w-3" />
                  Escalation level {escalation}
                </span>
              )}
            </div>
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

      {/* Timestamp audit trail */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Clock className="h-4 w-4" />
          Timestamps
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lifecycleTimestamps.map(([label, value]) => (
            <div key={label} className="rounded-lg bg-gray-50 px-3 py-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</dt>
              <dd className="mt-0.5 text-xs font-medium text-gray-700">
                <Timestamp value={value} variant="compact" />
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Delivery Info */}
      {(order.delivery_address || order.contact_number || order.authorized_receiver_name || order.authorized_receiver_contact) && (
        <div className="rounded-xl border border-purple-200 bg-purple-50 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-purple-800">
            <Truck className="h-4 w-4" />
            Delivery Information
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {order.delivery_address && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-purple-700">
                  <MapPin className="h-3 w-3" />
                  Address
                </div>
                <p className="mt-0.5 text-sm text-purple-900">{order.delivery_address}</p>
              </div>
            )}
            {order.contact_number && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-purple-700">
                  <Phone className="h-3 w-3" />
                  Contact
                </div>
                <p className="mt-0.5 text-sm text-purple-900">{order.contact_number}</p>
              </div>
            )}
            {order.authorized_receiver_name && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-purple-700">
                  <UserCheck className="h-3 w-3" />
                  Auth. Receiver
                </div>
                <p className="mt-0.5 text-sm text-purple-900">{order.authorized_receiver_name}</p>
              </div>
            )}
            {order.authorized_receiver_contact && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-purple-700">
                  <Phone className="h-3 w-3" />
                  Receiver Contact
                </div>
                <p className="mt-0.5 text-sm text-purple-900">{order.authorized_receiver_contact}</p>
              </div>
            )}
          </div>
        </div>
      )}

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

      {/* Downpayment status */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
            <CreditCard className="h-4 w-4" />
            Downpayment
          </div>
          {paymentTotals && paymentTotals.expected_balance != null && (
            <span className="text-xs text-gray-400">
              {paymentTotals.deposit > 0 ? `₱${paymentTotals.deposit.toLocaleString()} recorded` : 'No deposits yet'}
            </span>
          )}
        </div>

        {/* Payment history */}
        {payments.filter((p) => p.type === 'deposit').length > 0 ? (
          <div className="mt-3 space-y-2">
            {payments
              .filter((p) => p.type === 'deposit')
              .map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">
                        ₱{Number(payment.amount).toLocaleString()}
                      </span>
                      {payment.verified ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                          ✅ Verified
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          ⏳ Pending verification
                        </span>
                      )}
                    </div>
                    {payment.payment_date && (
                      <p className="text-xs text-gray-400">
                        {new Date(payment.payment_date).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  {payment.image_url && (
                    <a
                      href={payment.image_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-xs text-[#2490ef] hover:underline"
                    >
                      View slip
                    </a>
                  )}
                </div>
              ))}
          </div>
        ) : (
          <div className="mt-2">
            <span className="text-sm text-gray-400">No deposit payments recorded yet.</span>
          </div>
        )}

        {/* Deposit upload — always available for additional deposits */}
        <div className="mt-3">
          <DepositUploadSection
            quotationNumber={order.quotation_number ?? ''}
            orderId={order.id}
            onDepositRecorded={() => window.location.reload()}
          />
        </div>

        {/* Verification banner */}
        {order.deposit_paid && !order.deposit_verified && (
          <div className="mt-3 space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-4">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-rose-600" />
              <p className="text-xs font-semibold text-rose-800">Deposit Verification Required</p>
            </div>
            <p className="text-xs text-rose-700">
              Deposits have been recorded but not yet verified. Verify them to advance to purchasing.
            </p>
            {verifyDepositResult ? (
              <p className={`text-xs font-medium ${verifyDepositResult.ok ? 'text-green-700' : 'text-red-600'}`}>
                {verifyDepositResult.message}
              </p>
            ) : (
              <button
                onClick={() => setShowVerifyDepositOtp(true)}
                disabled={verifyingDeposit}
                className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {verifyingDeposit ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <CheckCircle className="h-3 w-3" />
                )}
                {verifyingDeposit ? 'Verifying...' : 'Verify All Deposits'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Balance status */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
            <Scale className="h-4 w-4" />
            Balance Payment
          </div>
          {paymentTotals && paymentTotals.expected_balance != null && (
            <span className="text-xs text-gray-400">
              {paymentTotals.remaining_balance != null && paymentTotals.remaining_balance > 0
                ? `₱${paymentTotals.remaining_balance.toLocaleString()} remaining`
                : paymentTotals.balance > 0
                  ? 'Fully paid'
                  : 'No payments yet'}
            </span>
          )}
        </div>

        {/* Payment history */}
        {payments.filter((p) => p.type === 'balance').length > 0 ? (
          <div className="mt-3 space-y-2">
            {payments
              .filter((p) => p.type === 'balance')
              .map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">
                        ₱{Number(payment.amount).toLocaleString()}
                      </span>
                      {payment.verified ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                          ✅ Verified
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          ⏳ Pending verification
                        </span>
                      )}
                    </div>
                    {payment.payment_date && (
                      <p className="text-xs text-gray-400">
                        {new Date(payment.payment_date).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <div className="mt-2">
            <span className="text-sm text-gray-400">No balance payments recorded yet.</span>
          </div>
        )}

        {/* Summary */}
        {order.total_amount != null && order.deposit_amount != null && (
          <div className="mt-2 text-xs text-gray-500">
            {paymentTotals && paymentTotals.remaining_balance != null && paymentTotals.remaining_balance === 0 ? (
              <span className="text-green-600">
                Full payment recorded — no balance due
                {paymentTotals.balance > 0 && order.deposit_amount >= order.total_amount && (
                  <span className="ml-2 text-gray-400">(paid upfront)</span>
                )}
              </span>
            ) : (
              <>
                Expected balance: ₱{(Number(order.total_amount) - Number(order.deposit_amount)).toLocaleString()}
                {paymentTotals && paymentTotals.balance > 0 && (
                  <span className="ml-2 text-gray-400">
                    (paid so far: ₱{paymentTotals.balance.toLocaleString()})
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {/* Balance upload — available when deposit is paid */}
        {order.deposit_paid && order.total_amount != null && (
          <div className="mt-3">
            <BalanceUploadSection
              quotationNumber={order.quotation_number ?? ''}
              orderId={order.id}
              expectedBalance={paymentTotals?.remaining_balance ?? (Number(order.total_amount) - Number(order.deposit_amount))}
              onBalanceRecorded={() => window.location.reload()}
            />
          </div>
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
                        <Timestamp value={stageUpdate.created_at} variant="compact" />
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stage Advancement (admin only) — manual advancement when Telegram is down */}
      {user?.role === 'admin' && (() => {
        const VALID_TRANSITIONS: Record<string, string[]> = {
          quotation_received:        ['order_confirmation_received', 'math_verified', 'deposit_pending'],
          order_confirmation_received: ['math_verified', 'deposit_pending'],
          math_verified:             ['deposit_pending'],
          deposit_pending:           ['deposit_verification'],
          deposit_verification:      ['purchasing_pending'],
          purchasing_pending:        ['production_pending'],
          production_pending:        ['production_in_progress', 'partial_production'],
          production_in_progress:      ['en_route', 'partial_production'],
          partial_production:        ['production_in_progress', 'en_route'],
          en_route:                  ['en_route_verification', 'inventory_verification', 'inventory_arrived'],
          inventory_verification:    ['inventory_arrived'],
          inventory_arrived:         ['balance_due'],
          balance_due:               ['balance_verification', 'delivery_scheduled', 'delivered', 'countered'],
          balance_verification:      ['delivery_pending', 'delivery_scheduled', 'delivered', 'countered'],
          delivery_pending:          ['delivery_scheduled', 'delivered', 'countered'],
          delivery_scheduled:        ['delivered', 'countered'],
          delivered:                 ['payment_received', 'payment_confirmed', 'completed'],
          countered:                 ['payment_received', 'payment_confirmed', 'completed'],
          payment_received:          ['payment_confirmed', 'completed'],
          payment_confirmed:         ['completed'],
        };
        const allowedStages = VALID_TRANSITIONS[order.current_stage] ?? [];
        if (allowedStages.length === 0) return null;
        return (
          <div className="rounded-xl border border-2 border-dashed border-amber-300 bg-amber-50 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
              <ArrowLeft className="h-4 w-4 rotate-90" />
              Manual Stage Advancement
            </div>
            <p className="mt-1 text-xs text-amber-700">
              Use this when Telegram is unavailable. Each advancement triggers notifications and reminders automatically.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {allowedStages.map((stage) => {
                const config = STAGE_CONFIG[stage];
                return (
                  <button
                    key={stage}
                    onClick={() => {
                      setTargetAdvanceStage(stage);
                      setShowStageAdvanceOtp(true);
                    }}
                    disabled={advancingStage}
                    className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-amber-700 shadow-sm ring-1 ring-amber-300 hover:bg-amber-100 disabled:opacity-50"
                  >
                    {config?.icon} {config?.label ?? stage}
                  </button>
                );
              })}
            </div>
            {advanceResult && (
              <p className={`mt-2 text-xs font-medium ${advanceResult.ok ? 'text-green-700' : 'text-red-600'}`}>
                {advanceResult.message}
              </p>
            )}
          </div>
        );
      })()}

      {/* Item-Level Tracking (admin only) */}
      {user?.role === 'admin' && (
        <ItemTrackingSection
          orderId={order.id}
          quotationNumber={order.quotation_number}
          currentStage={order.current_stage}
        />
      )}

      {/* Agent Notes */}
      <AgentNotesSection orderId={order.id} quotationNumber={order.quotation_number ?? ''} />

      {/* Files */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">Files</h2>
          <button
            onClick={() => handleViewFiles(order)}
            className="rounded-lg bg-[#2490ef] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1a7ad9]"
          >
            View / Upload Files
          </button>
        </div>
        {order.files && order.files.length > 0 ? (
          <div className="space-y-2">
            {(() => {
              const quotations = order.files.filter((f: any) => f.file_type === 'quotation');
              const deposits = order.files.filter((f: any) => f.file_type === 'deposit');
              const others = order.files.filter((f: any) => f.file_type !== 'quotation' && f.file_type !== 'deposit');
              const sections: { label: string; icon: string; color: string; files: any[] }[] = [];
              if (quotations.length > 0) sections.push({ label: 'Quotations', icon: '📄', color: 'border-l-blue-400', files: quotations });
              if (deposits.length > 0) sections.push({ label: 'Deposit Slips', icon: '💰', color: 'border-l-green-400', files: deposits });
              if (others.length > 0) sections.push({ label: 'Other Files', icon: '📎', color: 'border-l-gray-400', files: others });
              return sections.map((section) => (
                <div key={section.label}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    {section.icon} {section.label}
                  </p>
                  {section.files.map((file) => (
                    <div key={file.id} className={`flex items-center gap-3 rounded-lg border border-gray-100 border-l-4 p-3 ${section.color}`}>
                      <FileText className="h-4 w-4 text-gray-400" />
                      <div className="flex-1">
                        <p className="text-sm text-gray-900">{file.original_filename ?? 'Unnamed file'}</p>
                        <p className="text-xs text-gray-400">{file.file_type}</p>
                        {file.created_at && (
                          <p className="text-[10px] text-gray-400">Uploaded <Timestamp value={file.created_at} variant="compact" /></p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ));
            })()}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No files uploaded yet.</p>
        )}
      </div>

      {viewingFilesOrder && (
        <FileViewerModal
          order={viewingFilesOrder}
          files={orderFiles}
          onClose={closeViewer}
          onUploadComplete={refreshFiles}
        />
      )}

      <OtpModal
        open={showVerifyDepositOtp}
        title="Verify Deposit"
        description="Please confirm to verify the downpayment for this order. This will advance the order to Purchasing Pending."
        onVerified={handleVerifyDepositVerified}
        onClose={() => {
          setShowVerifyDepositOtp(false);
          setVerifyDepositResult(null);
        }}
      />

      <OtpModal
        open={showStageAdvanceOtp}
        title="Advance Stage"
        description={
          targetAdvanceStage
            ? `Advance this order from "${order.current_stage.replace(/_/g, ' ')}" to "${targetAdvanceStage.replace(/_/g, ' ')}"? This will trigger notifications and reminders.`
            : 'Advance this order to the next stage?'
        }
        onVerified={handleStageAdvanceVerified}
        onClose={() => {
          setShowStageAdvanceOtp(false);
          setTargetAdvanceStage(null);
          setAdvanceResult(null);
        }}
      />
    </div>
  );
}

// ── Item-Level Tracking Section ────────────────────────────────────────

function ItemTrackingSection({
  orderId,
  quotationNumber,
  currentStage,
}: {
  orderId: string;
  quotationNumber: string | null;
  currentStage: string;
}) {
  type ItemTrackingForm = {
    name: string;
    quantity: string;
    production_status: OrderItem['production_status'];
    en_route_status: OrderItem['en_route_status'];
    estimated_arrival_days: string;
    estimated_production_days: string;
    reason: string;
  };

  const emptyItemForm: ItemTrackingForm = {
    name: '',
    quantity: '1',
    production_status: 'pending',
    en_route_status: 'not_yet',
    estimated_arrival_days: '',
    estimated_production_days: '',
    reason: '',
  };

  const [items, setItems] = useState<OrderItem[]>([]);
  const [completion, setCompletion] = useState<ItemCompletion | null>(null);
  const [logs, setLogs] = useState<ProductionUpdateLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [uploadingQuotation, setUploadingQuotation] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [verifyingItemId, setVerifyingItemId] = useState<string | null>(null);
  const [completingVerification, setCompletingVerification] = useState(false);
  const [arrivingItemId, setArrivingItemId] = useState<string | null>(null);
  const [confirmingArrival, setConfirmingArrival] = useState(false);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [updatingEnRouteItemId, setUpdatingEnRouteItemId] = useState<string | null>(null);
  const [showManualItemForm, setShowManualItemForm] = useState(false);
  const [manualItemForm, setManualItemForm] = useState<ItemTrackingForm>(emptyItemForm);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItemForm, setEditItemForm] = useState<ItemTrackingForm>(emptyItemForm);
  const [savingManualItem, setSavingManualItem] = useState(false);
  const [savingEditItem, setSavingEditItem] = useState(false);
  const [showOtp, setShowOtp] = useState<'complete_verification' | 'confirm_arrival' | 'extract_items' | 'upload_extract' | null>(null);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [pendingVerifyItem, setPendingVerifyItem] = useState<{
    itemId: string;
    action: 'all' | 'partial' | 'not_yet';
    verifiedQty?: number;
  } | null>(null);
  const [pendingBulkVerifyItemIds, setPendingBulkVerifyItemIds] = useState<string[] | null>(null);
  const [selectedVerifyItemIds, setSelectedVerifyItemIds] = useState<Set<string>>(new Set());
  const [pendingMarkArrived, setPendingMarkArrived] = useState<{ itemId: string } | null>(null);
  const [pendingEditItem, setPendingEditItem] = useState<boolean>(false);
  const [pendingProdStatus, setPendingProdStatus] = useState<{ itemId: string; status: 'pending' | 'in_progress' | 'finished' } | null>(null);
  const [pendingEnRouteStatus, setPendingEnRouteStatus] = useState<{ itemId: string; status: 'not_yet' | 'en_route' | 'arrived'; estimatedArrivalDays?: number | null } | null>(null);
  const [pendingManualItem, setPendingManualItem] = useState<boolean>(false);
  const [otpModal, setOtpModal] = useState<{
    open: boolean;
    title: string;
    description: string;
    pendingAction: 'verify_item' | 'bulk_verify_items' | 'mark_arrived' | 'edit_item' | 'production_status' | 'en_route_status' | 'manual_item';
  }>({ open: false, title: '', description: '', pendingAction: 'verify_item' });

  // Show item tracking for all stages — items can be extracted at any point in the workflow
  const stageShowsInventoryCols = currentStage === 'inventory_verification';
  const stageShowsArrivalCols = ['en_route', 'en_route_verification', 'inventory_arrived', 'inventory_verification'].includes(currentStage);
  const selectableVerifyItems = stageShowsInventoryCols ? items.filter((i) => (i.verified_qty ?? 0) < i.quantity) : [];
  const stageAllowsProdEdit = ['production_in_progress', 'partial_production', 'en_route'].includes(currentStage);
  // Allow en-route dispatch edits at en_route, and arrival edits at en_route_verification too
  const stageAllowsEnRouteEdit = ['en_route', 'en_route_verification'].includes(currentStage);

  async function refreshItemTracking() {
    const [itemsRes, compRes, logsRes] = await Promise.all([
      getOrderItems(orderId),
      getItemCompletion(orderId),
      getProductionLogs(orderId),
    ]);
    if (itemsRes.ok) setItems(itemsRes.items);
    if (compRes.ok) setCompletion(compRes);
    if (logsRes.ok) setLogs(logsRes.logs);
  }

  function normalizeItemForm(form: ItemTrackingForm) {
    const quantity = Number.parseInt(form.quantity, 10);
    const estimatedArrivalDays = form.estimated_arrival_days.trim()
      ? Number.parseInt(form.estimated_arrival_days, 10)
      : null;
    const estimatedProductionDays = form.estimated_production_days.trim()
      ? Number.parseInt(form.estimated_production_days, 10)
      : null;

    if (!form.name.trim()) throw new Error('Item name is required.');
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantity must be greater than 0.');
    if (estimatedArrivalDays !== null && (!Number.isFinite(estimatedArrivalDays) || estimatedArrivalDays <= 0)) {
      throw new Error('Arrival estimate must be a positive number of days.');
    }
    if (estimatedProductionDays !== null && (!Number.isFinite(estimatedProductionDays) || estimatedProductionDays <= 0)) {
      throw new Error('Production estimate must be a positive number of days.');
    }
    if (form.reason.trim().length < 3) {
      throw new Error('Please state a reason for the item tracking change.');
    }

    return {
      name: form.name.trim(),
      quantity,
      production_status: form.production_status,
      en_route_status: form.en_route_status,
      estimated_arrival_days: estimatedArrivalDays,
      estimated_production_days: estimatedProductionDays,
      edit_reason: form.reason.trim(),
      updated_by: 'dashboard',
    };
  }

  function startEditItem(item: OrderItem) {
    setEditingItemId(item.id);
    setEditItemForm({
      name: item.name,
      quantity: String(item.quantity),
      production_status: item.production_status,
      en_route_status: item.en_route_status,
      estimated_arrival_days: item.estimated_arrival_days != null ? String(item.estimated_arrival_days) : '',
      estimated_production_days: item.estimated_production_days != null ? String(item.estimated_production_days) : '',
      reason: '',
    });
  }

  function handleCreateManualItem() {
    const reason = manualItemForm.reason?.trim();
    if (!reason) {
      alert('A reason is required when manually adding item tracking.');
      return;
    }
    setPendingManualItem(true);
    setOtpModal({
      open: true,
      title: 'Add Manual Item',
      description: `Add "${manualItemForm.name}" x${manualItemForm.quantity} to item tracking? Verify your identity to proceed.`,
      pendingAction: 'manual_item',
    });
  }

  async function executeCreateManualItem(actionToken: string) {
    setSavingManualItem(true);
    try {
      const payload = normalizeItemForm(manualItemForm);
      await createOrderItem(orderId, { ...payload, action_token: actionToken });
      setManualItemForm(emptyItemForm);
      setShowManualItemForm(false);
      await refreshItemTracking();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to add item tracking');
    } finally {
      setSavingManualItem(false);
      setPendingManualItem(false);
    }
  }

  function handleSaveEditItem() {
    if (!editingItemId) return;
    const reason = editItemForm.reason?.trim();
    if (!reason) {
      alert('A reason is required when editing item tracking.');
      return;
    }
    setPendingEditItem(true);
    setOtpModal({
      open: true,
      title: 'Edit Item Tracking',
      description: `Save changes to "${editItemForm.name}"? Verify your identity to proceed.`,
      pendingAction: 'edit_item',
    });
  }

  async function executeSaveEditItem(actionToken: string) {
    if (!editingItemId) return;
    setSavingEditItem(true);
    try {
      const payload = normalizeItemForm(editItemForm);
      await updateOrderItem(orderId, editingItemId, { ...payload, require_reason: true, action_token: actionToken });
      setEditingItemId(null);
      setEditItemForm(emptyItemForm);
      await refreshItemTracking();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to edit item tracking');
    } finally {
      setSavingEditItem(false);
      setPendingEditItem(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getOrderItems(orderId),
      getItemCompletion(orderId),
      getProductionLogs(orderId),
    ]).then(([itemsRes, compRes, logsRes]) => {
      if (cancelled) return;
      if (itemsRes.ok) setItems(itemsRes.items);
      if (compRes.ok) setCompletion(compRes);
      if (logsRes.ok) setLogs(logsRes.logs);
      setLoading(false);
    }).catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [orderId, currentStage]);

  function handleExtractItems() {
    setExtractError('');
    setShowOtp('extract_items');
  }

  async function doExtractItems(actionToken: string) {
    setShowOtp(null);
    setExtracting(true);
    setExtractError('');
    try {
      const res = await extractOrderItems(orderId, actionToken);
      if (res.ok && res.items.length > 0) {
        setItems(res.items);
        const compRes = await getItemCompletion(orderId);
        if (compRes.ok) setCompletion(compRes);
      } else {
        setExtractError('No items could be extracted from the quotation');
      }
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  }

  async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? '');
        const commaIndex = result.indexOf(',');
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = () => reject(new Error('Failed to read quotation file'));
      reader.readAsDataURL(file);
    });
  }

  function handleQuotationUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const isSupported = file.type.startsWith('image/') || file.type === 'application/pdf';
    if (!isSupported) {
      setExtractError('Please upload a quotation image or PDF.');
      return;
    }
    if (!quotationNumber) {
      setExtractError('This order has no quotation number, so the uploaded quotation cannot be linked for extraction.');
      return;
    }

    setPendingUploadFile(file);
    setExtractError('');
    setShowOtp('upload_extract');
  }

  async function doUploadAndExtract(actionToken: string) {
    setShowOtp(null);
    const file = pendingUploadFile;
    setPendingUploadFile(null);
    if (!file) return;

    setUploadingQuotation(true);
    setExtracting(true);
    setExtractError('');
    setUploadMessage('Uploading quotation file...');
    try {
      const file_data = await fileToBase64(file);
      await uploadOrderFile({
        order_id: orderId,
        quotation_number: quotationNumber ?? undefined,
        file_type: 'quotation',
        original_filename: file.name,
        mime_type: file.type,
        file_data,
      });

      setUploadMessage('Quotation uploaded. Extracting items...');
      const res = await extractOrderItems(orderId, actionToken);
      await refreshItemTracking();

      if (!res.ok || res.items.length === 0) {
        setExtractError(res.ok ? 'Quotation uploaded, but no items could be extracted.' : 'Quotation uploaded, but extraction failed.');
      } else {
        setUploadMessage(`Extracted ${res.items.length} item${res.items.length === 1 ? '' : 's'} from uploaded quotation.`);
      }
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'Failed to upload quotation and extract items');
    } finally {
      setUploadingQuotation(false);
      setExtracting(false);
    }
  }

  function handleVerifyItem(itemId: string, action: 'all' | 'partial' | 'not_yet', verifiedQty?: number) {
    const item = items.find((i) => i.id === itemId);
    setPendingVerifyItem({ itemId, action, verifiedQty });
    setOtpModal({
      open: true,
      title: 'Verify Inventory Item',
      description: `Confirm ${action === 'all' ? 'full' : action === 'partial' ? 'partial' : 'no'} verification for "${item?.name ?? itemId}".`,
      pendingAction: 'verify_item',
    });
  }

  async function executeVerifyItem(actionToken: string) {
    if (!pendingVerifyItem) return;
    setOtpModal((prev) => ({ ...prev, open: false }));
    setVerifyingItemId(pendingVerifyItem.itemId);
    try {
      await inventoryVerifyItem(orderId, {
        item_id: pendingVerifyItem.itemId,
        action: pendingVerifyItem.action,
        verified_qty: pendingVerifyItem.verifiedQty,
        action_token: actionToken,
      });
      const res = await getOrderItems(orderId);
      if (res.ok) setItems(res.items);
      const compRes = await getItemCompletion(orderId);
      if (compRes.ok) setCompletion(compRes);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setVerifyingItemId(null);
      setPendingVerifyItem(null);
    }
  }

  function handleBulkVerifyItems(itemIds: string[]) {
    if (itemIds.length === 0) return;
    setPendingBulkVerifyItemIds(itemIds);
    setOtpModal({
      open: true,
      title: 'Bulk Verify Inventory Items',
      description: `Confirm verifying ${itemIds.length} selected item(s) as fully verified.`,
      pendingAction: 'bulk_verify_items',
    });
  }

  async function executeBulkVerifyItems(actionToken: string) {
    if (!pendingBulkVerifyItemIds || pendingBulkVerifyItemIds.length === 0) return;
    setOtpModal((prev) => ({ ...prev, open: false }));
    setVerifyingItemId('bulk');
    try {
      await bulkInventoryVerify(orderId, {
        item_ids: pendingBulkVerifyItemIds,
        action_token: actionToken,
      });
      await refreshItemTracking();
      setSelectedVerifyItemIds(new Set());
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Bulk verification failed');
    } finally {
      setVerifyingItemId(null);
      setPendingBulkVerifyItemIds(null);
    }
  }

  async function handleCompleteVerification(actionToken: string) {
    setCompletingVerification(true);
    setShowOtp(null);
    try {
      await completeInventoryVerification(orderId, actionToken);
      window.location.reload();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to complete verification');
    } finally {
      setCompletingVerification(false);
    }
  }

  function handleMarkItemArrived(itemId: string) {
    const item = items.find((i) => i.id === itemId);
    setPendingMarkArrived({ itemId });
    setOtpModal({
      open: true,
      title: 'Mark Item Arrived',
      description: `Confirm marking "${item?.name ?? itemId}" as arrived.`,
      pendingAction: 'mark_arrived',
    });
  }

  async function executeMarkItemArrived(actionToken: string) {
    if (!pendingMarkArrived) return;
    setOtpModal((prev) => ({ ...prev, open: false }));
    setArrivingItemId(pendingMarkArrived.itemId);
    try {
      await updateOrderItem(orderId, pendingMarkArrived.itemId, { en_route_status: 'arrived', action_token: actionToken });
      const res = await getOrderItems(orderId);
      if (res.ok) setItems(res.items);
      const compRes = await getItemCompletion(orderId);
      if (compRes.ok) setCompletion(compRes);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to mark item as arrived');
    } finally {
      setArrivingItemId(null);
      setPendingMarkArrived(null);
    }
  }

  function handleItemProductionStatus(itemId: string, status: 'pending' | 'in_progress' | 'finished') {
    setPendingProdStatus({ itemId, status });
    const statusLabel = status === 'in_progress' ? 'Start Production' : status === 'finished' ? 'Finish Production' : 'Reset to Pending';
    setOtpModal({
      open: true,
      title: statusLabel,
      description: `Change production status of this item to "${status}"? Verify your identity to proceed.`,
      pendingAction: 'production_status',
    });
  }

  async function executeItemProductionStatus(actionToken: string) {
    if (!pendingProdStatus) return;
    const { itemId, status } = pendingProdStatus;
    setUpdatingItemId(itemId);
    try {
      await updateOrderItem(orderId, itemId, { production_status: status, action_token: actionToken });
      const res = await getOrderItems(orderId);
      if (res.ok) setItems(res.items);
      const compRes = await getItemCompletion(orderId);
      if (compRes.ok) setCompletion(compRes);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update production status');
    } finally {
      setUpdatingItemId(null);
      setPendingProdStatus(null);
    }
  }

  function handleItemEnRouteStatus(itemId: string, status: 'not_yet' | 'en_route' | 'arrived') {
    let estimatedArrivalDays: number | null = null;
    const item = items.find((i) => i.id === itemId);
    if (status === 'en_route' && !item?.estimated_arrival_days) {
      const input = window.prompt(`Estimated arrival days for "${item?.name ?? 'Item'}"?`, '28');
      if (input === null) return;
      const days = parseInt(input.replace(/[^0-9]/g, ''), 10);
      if (!days || days <= 0) { alert('Please enter a valid number of days.'); return; }
      estimatedArrivalDays = days;
    }
    setPendingEnRouteStatus({ itemId, status, estimatedArrivalDays });
    const statusLabel = status === 'en_route' ? 'Mark En Route' : status === 'arrived' ? 'Mark Arrived' : 'Reset to Not Yet';
    setOtpModal({
      open: true,
      title: statusLabel,
      description: `Change en route status of this item to "${status}"? Verify your identity to proceed.`,
      pendingAction: 'en_route_status',
    });
  }

  async function executeItemEnRouteStatus(actionToken: string) {
    if (!pendingEnRouteStatus) return;
    const { itemId, status, estimatedArrivalDays } = pendingEnRouteStatus;
    setUpdatingEnRouteItemId(itemId);
    try {
      await updateOrderItem(orderId, itemId, {
        en_route_status: status,
        ...(estimatedArrivalDays != null ? { estimated_arrival_days: estimatedArrivalDays } : {}),
        action_token: actionToken,
      });
      const res = await getOrderItems(orderId);
      if (res.ok) setItems(res.items);
      const compRes = await getItemCompletion(orderId);
      if (compRes.ok) setCompletion(compRes);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update en route status');
    } finally {
      setUpdatingEnRouteItemId(null);
      setPendingEnRouteStatus(null);
    }
  }

  async function handleConfirmAllArrived(actionToken: string) {
    setConfirmingArrival(true);
    setShowOtp(null);
    try {
      await confirmInventoryArrived(orderId, actionToken);
      window.location.reload();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to confirm arrival');
    } finally {
      setConfirmingArrival(false);
    }
  }

  function renderOtpModals() {
    return (
      <>
        {showOtp === 'complete_verification' && (
          <OtpModal
            open={true}
            title="Complete Inventory Verification"
            description="Verify your identity to mark inventory verification as complete and advance the order to Inventory Arrived."
            onVerified={handleCompleteVerification}
            onClose={() => setShowOtp(null)}
          />
        )}
        {showOtp === 'confirm_arrival' && (
          <OtpModal
            open={true}
            title="Confirm All Inventory Arrived"
            description="Verify your identity to confirm all inventory has arrived and advance the order to Balance Due. The inventory group chat will be notified."
            onVerified={handleConfirmAllArrived}
            onClose={() => setShowOtp(null)}
          />
        )}
        {showOtp === 'extract_items' && (
          <OtpModal
            open={true}
            title="Extract Items from Quotation"
            description="Verify your identity to extract line items from this order's quotation using AI vision."
            onVerified={doExtractItems}
            onClose={() => setShowOtp(null)}
          />
        )}
        {showOtp === 'upload_extract' && (
          <OtpModal
            open={true}
            title="Upload Quotation & Extract Items"
            description="Verify your identity to upload the quotation file and extract line items using AI vision."
            onVerified={doUploadAndExtract}
            onClose={() => { setShowOtp(null); setPendingUploadFile(null); }}
          />
        )}

        <OtpModal
          open={otpModal.open}
          title={otpModal.title}
          description={otpModal.description}
          onVerified={(token) => {
            if (otpModal.pendingAction === 'verify_item') executeVerifyItem(token);
            else if (otpModal.pendingAction === 'bulk_verify_items') executeBulkVerifyItems(token);
            else if (otpModal.pendingAction === 'mark_arrived') executeMarkItemArrived(token);
            else if (otpModal.pendingAction === 'edit_item') executeSaveEditItem(token);
            else if (otpModal.pendingAction === 'production_status') executeItemProductionStatus(token);
            else if (otpModal.pendingAction === 'en_route_status') executeItemEnRouteStatus(token);
            else if (otpModal.pendingAction === 'manual_item') executeCreateManualItem(token);
          }}
          onClose={() => {
            setOtpModal((prev) => ({ ...prev, open: false }));
            setPendingVerifyItem(null);
            setPendingMarkArrived(null);
            setPendingEditItem(false);
            setPendingProdStatus(null);
            setPendingEnRouteStatus(null);
            setPendingManualItem(false);
          }}
        />
      </>
    );
  }

  function renderItemTrackingForm({
    form,
    setForm,
    onCancel,
    onSave,
    saving,
    mode,
  }: {
    form: ItemTrackingForm;
    setForm: (value: ItemTrackingForm) => void;
    onCancel: () => void;
    onSave: () => void;
    saving: boolean;
    mode: 'add' | 'edit';
  }) {
    return (
      <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold text-blue-900">
            {mode === 'add' ? 'Manual Item Tracking' : 'Edit Item Tracking'}
          </p>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-blue-500 hover:bg-blue-100"
            aria-label="Cancel item tracking form"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <label className="md:col-span-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-700">Item</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs text-gray-800 outline-none focus:border-blue-300"
              placeholder="Item name"
            />
          </label>
          <label>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-700">Qty</span>
            <input
              type="number"
              min="1"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs text-gray-800 outline-none focus:border-blue-300"
            />
          </label>
          <label>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-700">Production</span>
            <select
              value={form.production_status}
              onChange={(e) => setForm({ ...form, production_status: e.target.value as OrderItem['production_status'] })}
              className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs text-gray-800 outline-none focus:border-blue-300"
            >
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="finished">Finished</option>
            </select>
          </label>
          <label>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-700">En Route</span>
            <select
              value={form.en_route_status}
              onChange={(e) => setForm({ ...form, en_route_status: e.target.value as OrderItem['en_route_status'] })}
              className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs text-gray-800 outline-none focus:border-blue-300"
            >
              <option value="not_yet">Not Yet</option>
              <option value="en_route">En Route</option>
              <option value="arrived">Arrived</option>
            </select>
          </label>
          <label>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-700">Arrival Est.</span>
            <input
              type="number"
              min="1"
              value={form.estimated_arrival_days}
              onChange={(e) => setForm({ ...form, estimated_arrival_days: e.target.value })}
              className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs text-gray-800 outline-none focus:border-blue-300"
              placeholder="days"
            />
          </label>
          <label>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-700">Prod. Est.</span>
            <input
              type="number"
              min="1"
              value={form.estimated_production_days}
              onChange={(e) => setForm({ ...form, estimated_production_days: e.target.value })}
              className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs text-gray-800 outline-none focus:border-blue-300"
              placeholder="days"
            />
          </label>
          <label className="md:col-span-5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-700">
              Reason {mode === 'edit' ? 'for edit' : 'for manual addition'}
            </span>
            <input
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs text-gray-800 outline-none focus:border-blue-300"
              placeholder={mode === 'edit' ? 'Example: client changed item quantity' : 'Example: missing item from quotation extraction'}
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={onSave}
              disabled={saving || !form.name.trim() || !form.reason.trim()}
              className="w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : mode === 'add' ? 'Add Item' : 'Save Edit'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-[#2490ef]" />
        </div>
      </div>
    );
  }

  // If no items yet, show an "Extract Items" prompt
  if (items.length === 0 && logs.length === 0) {
    return (
      <>
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="flex items-center gap-2">
            <List className="h-4 w-4 text-gray-500" />
            <h2 className="text-base font-semibold text-gray-800">Item-Level Tracking</h2>
          </div>
          <p className="mt-3 text-sm text-gray-500">
            No items have been extracted for this order yet. You can extract items from the quotation image using AI vision or manually create item tracking.
          </p>
          {extractError && (
            <p className="mt-2 text-xs text-red-500">{extractError}</p>
          )}
          {uploadMessage && !extractError && (
            <p className="mt-2 text-xs text-green-600">{uploadMessage}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={handleExtractItems}
              disabled={extracting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-500 px-4 py-2 text-xs font-medium text-white shadow-sm hover:from-purple-600 hover:to-indigo-600 disabled:opacity-50"
            >
              {extracting && !uploadingQuotation ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Extracting...
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Extract Items from Quotation
                </>
              )}
            </button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-purple-200 bg-white px-4 py-2 text-xs font-medium text-purple-700 shadow-sm hover:bg-purple-50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
              {uploadingQuotation ? (
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-purple-300 border-t-purple-700" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              {uploadingQuotation ? 'Uploading...' : 'Upload Quotation & Extract'}
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={handleQuotationUpload}
                disabled={extracting || uploadingQuotation}
                className="sr-only"
              />
            </label>
            <button
              onClick={() => setShowManualItemForm((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-4 py-2 text-xs font-medium text-blue-700 shadow-sm hover:bg-blue-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Item Manually
            </button>
          </div>
          {showManualItemForm && renderItemTrackingForm({
            form: manualItemForm,
            setForm: setManualItemForm,
            onCancel: () => { setShowManualItemForm(false); setManualItemForm(emptyItemForm); },
            onSave: handleCreateManualItem,
            saving: savingManualItem,
            mode: 'add',
          })}
        </div>
        {renderOtpModals()}
      </>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <List className="h-4 w-4 text-gray-500" />
        <h2 className="text-base font-semibold text-gray-800">Item-Level Tracking</h2>
        {completion && (
          <span className="ml-auto text-xs text-gray-500">
            {items.length} item{items.length !== 1 ? 's' : ''}
          </span>
        )}
        <button
          onClick={() => setShowManualItemForm((prev) => !prev)}
          className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Item
        </button>
      </div>

      {showManualItemForm && renderItemTrackingForm({
        form: manualItemForm,
        setForm: setManualItemForm,
        onCancel: () => { setShowManualItemForm(false); setManualItemForm(emptyItemForm); },
        onSave: handleCreateManualItem,
        saving: savingManualItem,
        mode: 'add',
      })}

      {/* Completion bars */}
      {completion && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-600">
              <Factory className="h-3 w-3" /> Production
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-indigo-200">
                <div className={`h-full rounded-full transition-all duration-500 ${completion.production_completion_pct >= 100 ? 'bg-green-500' : completion.production_completion_pct >= 50 ? 'bg-amber-500' : 'bg-indigo-400'}`}
                  style={{ width: `${Math.min(completion.production_completion_pct, 100)}%` }} />
              </div>
              <span className={`text-xs font-semibold ${completion.production_completion_pct >= 100 ? 'text-green-600' : completion.production_completion_pct >= 50 ? 'text-amber-600' : 'text-indigo-600'}`}>
                {completion.production_completion_pct}%
              </span>
            </div>
          </div>
          <div className="rounded-lg border border-sky-100 bg-sky-50/50 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sky-600">
              <Truck className="h-3 w-3" /> En Route
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-sky-200">
                <div className={`h-full rounded-full transition-all duration-500 ${completion.en_route_completion_pct >= 100 ? 'bg-green-500' : completion.en_route_completion_pct >= 50 ? 'bg-amber-500' : 'bg-sky-400'}`}
                  style={{ width: `${Math.min(completion.en_route_completion_pct, 100)}%` }} />
              </div>
              <span className={`text-xs font-semibold ${completion.en_route_completion_pct >= 100 ? 'text-green-600' : completion.en_route_completion_pct >= 50 ? 'text-amber-600' : 'text-sky-600'}`}>
                {completion.en_route_completion_pct}%
              </span>
            </div>
          </div>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
              <Package className="h-3 w-3" /> Inventory
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-emerald-200">
                <div className={`h-full rounded-full transition-all duration-500 ${completion.inventory_completion_pct >= 100 ? 'bg-green-500' : completion.inventory_completion_pct >= 50 ? 'bg-amber-500' : 'bg-emerald-400'}`}
                  style={{ width: `${Math.min(completion.inventory_completion_pct, 100)}%` }} />
              </div>
              <span className={`text-xs font-semibold ${completion.inventory_completion_pct >= 100 ? 'text-green-600' : completion.inventory_completion_pct >= 50 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {completion.inventory_completion_pct}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Production Pending guidance banner */}
      {currentStage === 'production_pending' && items.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-800">🏭 Starting Production</p>
          <p className="mt-1 text-[11px] text-amber-700">
            Mark each item below as <strong>In Progress</strong> or <strong>Finished</strong> to begin tracking.
            Starting at least one item moves this order to <strong>Partial Production</strong>.
            Starting all items advances directly to <strong>Production Confirmed</strong>.
          </p>
        </div>
      )}

      {/* Partial Production guidance banner */}
      {currentStage === 'partial_production' && items.length > 0 && (() => {
        const pendingCount = items.filter(i => i.production_status === 'pending').length;
        return pendingCount > 0 ? (
          <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-3">
            <p className="text-xs font-semibold text-orange-800">⏳ Partial Production — {pendingCount} item{pendingCount !== 1 ? 's' : ''} not yet started</p>
            <p className="mt-1 text-[11px] text-orange-700">
              Mark remaining items as <strong>In Progress</strong> or <strong>Finished</strong>.
              Once all items have started, the order will auto-advance to <strong>Production Confirmed</strong>.
            </p>
          </div>
        ) : null;
      })()}

      {/* Arrival Verification guidance banner */}
      {currentStage === 'en_route_verification' && items.length > 0 && (() => {
        const notArrivedCount = items.filter(i => i.en_route_status !== 'arrived').length;
        return notArrivedCount > 0 ? (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
            <p className="text-xs font-semibold text-blue-800">🔎 Arrival Verification — {notArrivedCount} item{notArrivedCount !== 1 ? 's' : ''} not yet arrived</p>
            <p className="mt-1 text-[11px] text-blue-700">
              Mark items as <strong>Arrived</strong> (✓ button in the En Route column) as they come in.
              Once all items arrive, the order advances to <strong>Inventory Verification</strong> automatically.
            </p>
          </div>
        ) : null;
      })()}

      {/* Items table */}
      {items.length > 0 && (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                {stageShowsInventoryCols && (
                  <th className="w-8 py-2 pr-3">
                    <input
                      type="checkbox"
                      title="Select all"
                      checked={selectableVerifyItems.length > 0 && selectableVerifyItems.every((i) => selectedVerifyItemIds.has(i.id))}
                      ref={(el) => { if (el) el.indeterminate = selectedVerifyItemIds.size > 0 && !selectableVerifyItems.every((i) => selectedVerifyItemIds.has(i.id)); }}
                      onChange={() => {
                        if (selectableVerifyItems.every((i) => selectedVerifyItemIds.has(i.id))) {
                          setSelectedVerifyItemIds(new Set());
                        } else {
                          setSelectedVerifyItemIds(new Set(selectableVerifyItems.map((i) => i.id)));
                        }
                      }}
                      disabled={selectableVerifyItems.length === 0}
                      className="rounded border-gray-300 accent-teal-600 disabled:opacity-30"
                    />
                  </th>
                )}
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3">Qty</th>
                <th className="py-2 pr-3">Production</th>
                <th className="py-2 pr-3">En Route</th>
                {stageShowsInventoryCols && <th className="py-2 pr-3">Verification</th>}
                {stageShowsArrivalCols && <th className="py-2 pr-3">Arrival</th>}
                <th className="py-2 pr-3">Arrival Est.</th>
                <th className="py-2 pr-3">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <Fragment key={item.id}>
                <tr className={`hover:bg-gray-50 ${selectedVerifyItemIds.has(item.id) ? 'bg-teal-50/40' : ''}`}>
                  {stageShowsInventoryCols && (
                    <td className="py-2 pr-3">
                      {(item.verified_qty ?? 0) < item.quantity && (
                        <input
                          type="checkbox"
                          checked={selectedVerifyItemIds.has(item.id)}
                          onChange={() => {
                            setSelectedVerifyItemIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                              return next;
                            });
                          }}
                          className="rounded border-gray-300 accent-teal-600"
                        />
                      )}
                    </td>
                  )}
                  <td className="py-2 pr-3 font-medium text-gray-800">{item.name}</td>
                  <td className="py-2 pr-3 text-gray-600">{item.quantity}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        item.production_status === 'finished' ? 'bg-green-100 text-green-700'
                        : item.production_status === 'in_progress' ? 'bg-amber-100 text-amber-700'
                        : 'bg-gray-100 text-gray-600'
                      }`}>
                        {item.production_status === 'finished' ? '✓ Finished'
                          : item.production_status === 'in_progress' ? '⟳ In Progress'
                          : '○ Pending'}
                      </span>
                      {stageAllowsProdEdit && item.production_status !== 'finished' && (
                        <div className="flex gap-1">
                          {item.production_status !== 'pending' && (
                            <button
                              onClick={() => handleItemProductionStatus(item.id, 'pending')}
                              disabled={updatingItemId === item.id}
                              className="rounded bg-gray-50 px-1 py-0.5 text-[9px] font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50"
                            >
                              ○
                            </button>
                          )}
                          {item.production_status !== 'in_progress' && (
                            <button
                              onClick={() => handleItemProductionStatus(item.id, 'in_progress')}
                              disabled={updatingItemId === item.id}
                              className="rounded bg-amber-50 px-1 py-0.5 text-[9px] font-medium text-amber-600 hover:bg-amber-100 disabled:opacity-50"
                            >
                              ⟳
                            </button>
                          )}
                          <button
                            onClick={() => handleItemProductionStatus(item.id, 'finished')}
                            disabled={updatingItemId === item.id}
                            className="rounded bg-green-50 px-1 py-0.5 text-[9px] font-medium text-green-600 hover:bg-green-100 disabled:opacity-50"
                          >
                            ✓
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        item.en_route_status === 'arrived' ? 'bg-green-100 text-green-700'
                        : item.en_route_status === 'en_route' ? 'bg-sky-100 text-sky-700'
                        : 'bg-gray-100 text-gray-600'
                      }`}>
                        {item.en_route_status === 'arrived' ? '✓ Arrived'
                          : item.en_route_status === 'en_route' ? '⟳ En Route'
                          : '○ Not Yet'}
                      </span>
                      {(stageAllowsEnRouteEdit || item.production_status === 'finished') && (
                        <div className="flex gap-1">
                          {item.en_route_status !== 'not_yet' && (
                            <button
                              onClick={() => handleItemEnRouteStatus(item.id, 'not_yet')}
                              disabled={updatingEnRouteItemId === item.id}
                              className="rounded bg-gray-50 px-1 py-0.5 text-[9px] font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50"
                            >
                              ○
                            </button>
                          )}
                          {item.en_route_status !== 'en_route' && (
                            <button
                              onClick={() => handleItemEnRouteStatus(item.id, 'en_route')}
                              disabled={updatingEnRouteItemId === item.id}
                              className="rounded bg-sky-50 px-1 py-0.5 text-[9px] font-medium text-sky-600 hover:bg-sky-100 disabled:opacity-50"
                            >
                              🚚
                            </button>
                          )}
                          {item.en_route_status !== 'arrived' && (
                            <button
                              onClick={() => handleItemEnRouteStatus(item.id, 'arrived')}
                              disabled={updatingEnRouteItemId === item.id}
                              className="rounded bg-green-50 px-1 py-0.5 text-[9px] font-medium text-green-600 hover:bg-green-100 disabled:opacity-50"
                            >
                              ✓
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                  {stageShowsInventoryCols && (
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200">
                          <div
                            className="h-full rounded-full bg-teal-500"
                            style={{ width: `${Math.min(((item.verified_qty ?? 0) / item.quantity) * 100, 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-gray-600">{item.verified_qty ?? 0}/{item.quantity}</span>
                        {(item.verified_qty ?? 0) < item.quantity ? (
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleVerifyItem(item.id, 'all')}
                              disabled={verifyingItemId === item.id}
                              className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 hover:bg-teal-100 disabled:opacity-50"
                            >
                              {verifyingItemId === item.id ? '...' : '✓ All'}
                            </button>
                            <button
                              onClick={() => {
                                const qty = window.prompt(`Enter verified quantity for ${item.name} (max ${item.quantity}):`);
                                if (qty) handleVerifyItem(item.id, 'partial', Number(qty));
                              }}
                              disabled={verifyingItemId === item.id}
                              className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                            >
                              Partial
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] font-medium text-green-600">✓ Verified</span>
                        )}
                      </div>
                    </td>
                  )}
                  {stageShowsArrivalCols && (
                    <td className="py-2 pr-3">
                      {item.en_route_status === 'arrived' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-600">
                          <CheckCircle className="h-3 w-3" />
                          Arrived
                        </span>
                      ) : (
                        <button
                          onClick={() => handleMarkItemArrived(item.id)}
                          disabled={arrivingItemId === item.id}
                          className="rounded bg-cyan-50 px-1.5 py-0.5 text-[10px] font-medium text-cyan-700 hover:bg-cyan-100 disabled:opacity-50"
                        >
                          {arrivingItemId === item.id ? '...' : '✓ Mark Arrived'}
                        </button>
                      )}
                    </td>
                  )}
                  <td className="py-2 pr-3 text-gray-600">
                    {item.estimated_arrival_days != null ? `${item.estimated_arrival_days}d` : '—'}
                  </td>
                  <td className="py-2 pr-3 text-gray-500">
                    <div className="flex items-center gap-2">
                      <Timestamp value={item.updated_at} variant="relative" />
                      <button
                        type="button"
                        onClick={() => startEditItem(item)}
                        className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100"
                        title="Edit item tracking"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
                {editingItemId === item.id && (
                  <tr key={`${item.id}-edit`}>
                    <td colSpan={8} className="bg-blue-50/40 px-2 py-3">
                      {renderItemTrackingForm({
                        form: editItemForm,
                        setForm: setEditItemForm,
                        onCancel: () => { setEditingItemId(null); setEditItemForm(emptyItemForm); },
                        onSave: handleSaveEditItem,
                        saving: savingEditItem,
                        mode: 'edit',
                      })}
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Complete Verification button (with OTP) */}
      {stageShowsInventoryCols && items.length > 0 && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-teal-200 bg-teal-50/50 p-3">
          <div>
            <p className="text-xs font-medium text-teal-800">Inventory Verification</p>
            <p className="text-[10px] text-teal-600">
              {items.filter(i => (i.verified_qty ?? 0) >= i.quantity).length}/{items.length} items fully verified
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectedVerifyItemIds.size > 0 && (
              <button
                onClick={() => handleBulkVerifyItems(Array.from(selectedVerifyItemIds))}
                disabled={verifyingItemId === 'bulk'}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {verifyingItemId === 'bulk' ? 'Verifying...' : `✓ Verify Selected (${selectedVerifyItemIds.size})`}
              </button>
            )}
            <button
              onClick={() => setShowOtp('complete_verification')}
              disabled={completingVerification || items.some(i => (i.verified_qty ?? 0) < i.quantity)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {completingVerification ? 'Completing...' : '✓ Complete Verification'}
            </button>
          </div>
        </div>
      )}

      {/* Confirm All Arrived button (with OTP) */}
      {stageShowsArrivalCols && items.length > 0 && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-cyan-200 bg-cyan-50/50 p-3">
          <div>
            <p className="text-xs font-medium text-cyan-800">Inventory Arrival</p>
            <p className="text-[10px] text-cyan-600">
              {items.filter(i => i.en_route_status === 'arrived').length}/{items.length} items arrived
            </p>
          </div>
          <button
            onClick={() => setShowOtp('confirm_arrival')}
            disabled={confirmingArrival || items.some(i => i.en_route_status !== 'arrived')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
          >
            {confirmingArrival ? 'Confirming...' : '✓ Confirm All Arrived'}
          </button>
        </div>
      )}

      {renderOtpModals()}

      {/* Production update logs */}
      {logs.length > 0 && (
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Update Logs</h3>
          <div className="max-h-48 space-y-1.5 overflow-y-auto">
            {logs.map((log) => (
              <div key={log.id} className="rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2">
                <div className="flex items-center gap-2 text-[10px] text-gray-400">
                  <span className="font-medium text-gray-600">{log.created_by ?? 'system'}</span>
                  {log.item_name && <span className="text-gray-400">· {log.item_name}</span>}
                  <span className="ml-auto"><Timestamp value={log.created_at} variant="compact" /></span>
                </div>
                <p className="mt-0.5 text-xs text-gray-800">{log.note}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Agent Notes Section ────────────────────────────────────────────────

interface AgentNote {
  id: string;
  order_id: string;
  agent_name: string;
  note: string;
  created_at: string;
}

function AgentNotesSection({ orderId, quotationNumber }: { orderId: string; quotationNumber: string }) {
  const [notes, setNotes] = useState<AgentNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [agentName, setAgentName] = useState('dashboard');
  const [posting, setPosting] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

  useEffect(() => {
    fetch(`${API_BASE}/orders/${orderId}/notes`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { setNotes(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [orderId, API_BASE]);

  function handlePostNote() {
    if (!newNote.trim() || !agentName.trim()) return;
    setShowOtp(true);
  }

  async function executePostNote(actionToken: string) {
    setShowOtp(false);
    setPosting(true);
    try {
      const created = await postAgentNote(orderId, {
        agent_name: agentName.trim(),
        note: newNote.trim(),
        action_token: actionToken,
      });
      setNotes((prev) => [created, ...prev]);
      setNewNote('');
    } catch (err: unknown) {
      alert('Failed to post note: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setPosting(false);
    }
  }

  const AGENT_COLORS: Record<string, string> = {
    'hermes': 'border-purple-200 bg-purple-50',
    'collection-agent': 'border-emerald-200 bg-emerald-50',
    'delivery-agent': 'border-blue-200 bg-blue-50',
    'production-agent': 'border-amber-200 bg-amber-50',
    'inventory-agent': 'border-cyan-200 bg-cyan-50',
    'purchasing-agent': 'border-orange-200 bg-orange-50',
    'quotation-checker': 'border-indigo-200 bg-indigo-50',
    'escalation-agent': 'border-rose-200 bg-rose-50',
    'dashboard': 'border-gray-200 bg-gray-50',
  };

  function getAgentColor(name: string): string {
    return AGENT_COLORS[name] ?? 'border-gray-200 bg-gray-50';
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-gray-500" />
        <h2 className="text-base font-semibold text-gray-800">Agent Notes</h2>
        <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
          {notes.length}
        </span>
      </div>

      {/* Post a new note */}
      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Bot className="h-3.5 w-3.5 text-gray-400" />
          <select
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-xs outline-none focus:border-[#2490ef]"
          >
            <option value="dashboard">Dashboard</option>
            <option value="hermes">Hermes</option>
            <option value="collection-agent">Collection Agent</option>
            <option value="delivery-agent">Delivery Agent</option>
            <option value="production-agent">Production Agent</option>
            <option value="inventory-agent">Inventory Agent</option>
            <option value="purchasing-agent">Purchasing Agent</option>
            <option value="quotation-checker">Quotation Checker</option>
            <option value="escalation-agent">Escalation Agent</option>
          </select>
        </div>
        <div className="flex gap-2">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note for this order... Agents can read and write notes for cross-agent communication."
            rows={2}
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs outline-none focus:border-[#2490ef] focus:ring-2 focus:ring-[#2490ef]/20"
          />
          <button
            onClick={handlePostNote}
            disabled={posting || !newNote.trim() || !agentName.trim()}
            className="inline-flex items-center gap-1 rounded-lg bg-[#2490ef] px-3 py-2 text-xs font-medium text-white hover:bg-[#1a7ad9] disabled:opacity-50"
          >
            {posting ? (
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Send className="h-3 w-3" />
            )}
            Post
          </button>
        </div>
      </div>

      {/* Notes list */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-[#2490ef]" />
        </div>
      ) : notes.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">
          No agent notes yet. Notes are used by agents for communication and updates.
        </div>
      ) : (
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {notes.map((note) => (
            <div
              key={note.id}
              className={`rounded-lg border p-3 ${getAgentColor(note.agent_name)}`}
            >
              <div className="mb-1 flex items-center gap-2">
                <Bot className="h-3 w-3 text-gray-400" />
                <span className="text-xs font-medium text-gray-700">
                  {note.agent_name}
                </span>
                <span className="text-[10px] text-gray-400">
                  <Timestamp value={note.created_at} variant="compact" />
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-gray-800">{note.note}</p>
            </div>
          ))}
        </div>
      )}

      <OtpModal
        open={showOtp}
        title="Post Agent Note"
        description="Verify your identity to post this agent note."
        onVerified={executePostNote}
        onClose={() => setShowOtp(false)}
      />
    </div>
  );
}

// ── Deposit Upload Section ──────────────────────────────────────────────

function DepositUploadSection({
  quotationNumber,
  orderId,
  onDepositRecorded,
}: {
  quotationNumber: string;
  orderId: string;
  onDepositRecorded: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showOtp, setShowOtp] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function fileToBase64(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? '');
        const commaIndex = result.indexOf(',');
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(f);
    });
  }

  async function handleExtractWithAI() {
    if (!file) return;
    setExtracting(true);
    setResult(null);
    try {
      const base64 = await fileToBase64(file);
      const res = await visionExtract({
        image_base64: base64,
        mime_type: file.type,
        mode: 'payment',
      });
      if (res.ok && res.payment?.amount) {
        setAmount(String(res.payment.amount));
        if (res.payment.payment_date) {
          setPaymentDate(res.payment.payment_date);
        }
        setResult({ ok: true, message: `AI extracted amount: ₱${res.payment.amount.toLocaleString()}` });
      } else {
        setResult({ ok: false, message: 'AI could not extract an amount. Please enter it manually.' });
      }
    } catch (err: any) {
      setResult({ ok: false, message: err.message ?? 'AI extraction failed' });
    } finally {
      setExtracting(false);
    }
  }

  function handleRecordDepositClick() {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setResult({ ok: false, message: 'Please enter a valid deposit amount.' });
      return;
    }
    if (!quotationNumber) {
      setResult({ ok: false, message: 'This order has no quotation number.' });
      return;
    }
    // Open OTP modal to verify action before recording deposit
    setShowOtp(true);
  }

  async function handleRecordDepositWithToken(actionToken: string) {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setResult({ ok: false, message: 'Please enter a valid deposit amount.' });
      return;
    }

    setRecording(true);
    setResult(null);
    try {
      let imageBase64: string | undefined;
      let mimeType: string | undefined;
      let originalFilename: string | undefined;

      if (file) {
        imageBase64 = await fileToBase64(file);
        mimeType = file.type;
        originalFilename = file.name;
      }

      await recordDepositWithFile({
        quotation_number: quotationNumber,
        amount: parsedAmount,
        deposit_paid_at: paymentDate || undefined,
        updated_by: 'dashboard_quick_action',
        image_base64: imageBase64,
        mime_type: mimeType,
        original_filename: originalFilename,
        action_token: actionToken,
      });

      setResult({ ok: true, message: `✅ Deposit of ₱${parsedAmount.toLocaleString()} recorded successfully!` });
      setTimeout(onDepositRecorded, 1500);
    } catch (err: any) {
      setResult({ ok: false, message: err.message ?? 'Failed to record deposit' });
    } finally {
      setRecording(false);
    }
  }

  return (
    <>
      <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-xs font-semibold text-blue-800">📥 Record Downpayment</p>

        {/* File upload */}
        <div>
          <label className="text-xs font-medium text-blue-700">Deposit Slip (JPEG/PDF) — optional</label>
          <div className="mt-1 flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-gray-600 file:mr-2 file:rounded file:border-0 file:bg-blue-100 file:px-2 file:py-1 file:text-xs file:font-medium file:text-blue-700 hover:file:bg-blue-200"
            />
            {file && (
              <button
                onClick={handleExtractWithAI}
                disabled={extracting}
                className="flex items-center gap-1 rounded bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-200 disabled:opacity-50"
              >
                {extracting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <SparklesIcon className="h-3 w-3" />
                )}
                AI Extract
              </button>
            )}
          </div>
        </div>

        {/* Amount */}
        <div>
          <label className="text-xs font-medium text-blue-700">Amount (₱)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 5000"
            className="mt-1 block w-full rounded border border-blue-200 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        {/* Payment date */}
        <div>
          <label className="text-xs font-medium text-blue-700">Payment Date (optional)</label>
          <input
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            className="mt-1 block w-full rounded border border-blue-200 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        {/* Submit */}
        <button
          onClick={handleRecordDepositClick}
          disabled={recording || !amount}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2490ef] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a7ad9] disabled:opacity-50"
        >
          {recording ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {recording ? 'Recording...' : 'Record Deposit'}
        </button>

        {/* Result message */}
        {result && (
          <p className={`text-xs font-medium ${result.ok ? 'text-green-700' : 'text-red-600'}`}>
            {result.message}
          </p>
        )}
      </div>

      {/* OTP Modal for deposit action verification */}
      <OtpModal
        open={showOtp}
        title="Verify Deposit Recording"
        description={`You are about to record a downpayment of ₱${parseFloat(amount || '0').toLocaleString()} for order "${quotationNumber}". Enter the code sent to your Telegram or email to confirm.`}
        onVerified={(token) => {
          setShowOtp(false);
          handleRecordDepositWithToken(token);
        }}
        onClose={() => setShowOtp(false)}
      />
    </>
  );
}

// ── Balance Upload Section ──────────────────────────────────────────────

function BalanceUploadSection({
  quotationNumber,
  orderId,
  expectedBalance,
  onBalanceRecorded,
}: {
  quotationNumber: string;
  orderId: string;
  expectedBalance: number;
  onBalanceRecorded: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [recording, setRecording] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showOtp, setShowOtp] = useState(false);

  function handleRecordBalanceClick() {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setResult({ ok: false, message: 'Please enter a valid payment amount.' });
      return;
    }
    if (!quotationNumber) {
      setResult({ ok: false, message: 'This order has no quotation number.' });
      return;
    }
    setShowOtp(true);
  }

  async function handleRecordBalanceWithToken(actionToken: string) {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setResult({ ok: false, message: 'Please enter a valid payment amount.' });
      return;
    }

    setRecording(true);
    setResult(null);
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
      const res = await fetch(`${API_BASE}/pay-balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quotation_number: quotationNumber,
          amount: parsedAmount,
          payment_date: paymentDate || undefined,
          updated_by: 'dashboard_quick_action',
          action_token: actionToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record balance payment');

      const msg = data.is_fully_paid
        ? `✅ Balance of ₱${parsedAmount.toLocaleString()} recorded. Balance fully paid!`
        : `✅ Balance of ₱${parsedAmount.toLocaleString()} recorded. Remaining: ₱${data.remaining_balance.toLocaleString()}`;
      setResult({ ok: true, message: msg });
      setTimeout(onBalanceRecorded, 1500);
    } catch (err: any) {
      setResult({ ok: false, message: err.message ?? 'Failed to record balance payment' });
    } finally {
      setRecording(false);
    }
  }

  return (
    <>
      <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50 p-4">
        <p className="text-xs font-semibold text-violet-800">
          📥 Record Balance Payment {expectedBalance > 0 ? `(expected: ₱${expectedBalance.toLocaleString()})` : ''}
        </p>

        {/* Amount */}
        <div>
          <label className="text-xs font-medium text-violet-700">Amount (₱)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 5000"
            className="mt-1 block w-full rounded border border-violet-200 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none"
          />
        </div>

        {/* Payment date */}
        <div>
          <label className="text-xs font-medium text-violet-700">Payment Date (optional)</label>
          <input
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            className="mt-1 block w-full rounded border border-violet-200 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none"
          />
        </div>

        {/* Submit */}
        <button
          onClick={handleRecordBalanceClick}
          disabled={recording || !amount}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {recording ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {recording ? 'Recording...' : 'Record Balance Payment'}
        </button>

        {/* Result message */}
        {result && (
          <p className={`text-xs font-medium ${result.ok ? 'text-green-700' : 'text-red-600'}`}>
            {result.message}
          </p>
        )}
      </div>

      {/* OTP Modal */}
      <OtpModal
        open={showOtp}
        title="Verify Balance Recording"
        description={`You are about to record a balance payment of ₱${parseFloat(amount || '0').toLocaleString()} for order "${quotationNumber}". Enter the code sent to your Telegram or email to confirm.`}
        onVerified={(token) => {
          setShowOtp(false);
          handleRecordBalanceWithToken(token);
        }}
        onClose={() => setShowOtp(false)}
      />
    </>
  );
}
