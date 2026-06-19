'use client';

import { STAGE_ORDER, STAGE_CONFIG, type OrderDetail } from '@/lib/api';
import { AlertTriangle, Clock, Calendar, Banknote } from 'lucide-react';

interface GanttChartProps {
  order: OrderDetail;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateShort(d: Date): string {
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

/**
 * GanttChart — Visual timeline showing stage progress vs projected lead time.
 *
 * - Timeline starts from the **balance deposit date** (`deposit_paid_at`)
 *   because production only begins after payment is confirmed.
 * - Falls back to `order_confirmed_at` then `created_at` if no deposit date.
 * - Each stage is rendered as a horizontal bar with approximate date labels.
 * - A "Today" marker shows current position relative to the deadline.
 * - If the order is projected to be delayed, a warning banner appears.
 */
export default function GanttChart({ order }: GanttChartProps) {
  const projectedLeadTime = order.projected_lead_time;
  // Base the Gantt start on the balance deposit date — production starts after payment
  const startedAt = order.deposit_paid_at ?? order.order_confirmed_at ?? order.created_at;
  const startDate = new Date(startedAt);
  const now = new Date();

  // If no projected lead time, show a compact placeholder
  if (!projectedLeadTime || projectedLeadTime <= 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Calendar className="h-4 w-4" />
          Timeline / Gantt Chart
        </div>
        <p className="mt-2 text-xs text-gray-400">
          No projected lead time set. Edit the order or set it when creating a new order to enable timeline tracking.
        </p>
      </div>
    );
  }

  const deadlineMs = projectedLeadTime * 86_400_000;
  const deadlineDate = new Date(startDate.getTime() + deadlineMs);
  const elapsedMs = now.getTime() - startDate.getTime();
  const totalPct = Math.min(elapsedMs / deadlineMs, 1); // 0..1, capped at 1
  const remainingMs = Math.max(deadlineMs - elapsedMs, 0);
  const remainingDays = Math.ceil(remainingMs / 86_400_000);
  const isDelayed = elapsedMs > deadlineMs;
  const delayDays = isDelayed ? Math.ceil((elapsedMs - deadlineMs) / 86_400_000) : 0;

  // Compute current stage index
  const currentStageIndex = STAGE_ORDER.indexOf(order.current_stage);
  const totalStages = STAGE_ORDER.length;

  // Duration per stage in ms (equal distribution)
  const stageDurationMs = deadlineMs / totalStages;

  // Build stage timeline data with approximate dates
  // We map each stage to a segment of the total timeline.
  // Completed stages get filled bars; the current stage gets a partial fill.
  const stageSegments = STAGE_ORDER.map((stage, index) => {
    const config = STAGE_CONFIG[stage];
    const isCompleted = index < currentStageIndex;
    const isCurrent = index === currentStageIndex;
    const stageUpdate = order.stage_updates?.find((u) => u.stage === stage);

    // Estimate the time proportion for this stage (equal distribution)
    const stageStartPct = index / totalStages;
    const stageEndPct = (index + 1) / totalStages;

    // Approximate date range for this stage
    const segmentStartMs = index * stageDurationMs;
    const segmentEndMs = (index + 1) * stageDurationMs;
    const approxStart = new Date(startDate.getTime() + segmentStartMs);
    const approxEnd = new Date(startDate.getTime() + segmentEndMs);

    return {
      stage,
      label: config?.label ?? stage,
      icon: config?.icon ?? '•',
      color: config?.color ?? 'bg-gray-100',
      isCompleted,
      isCurrent,
      stageUpdate,
      stageStartPct,
      stageEndPct,
      approxStart,
      approxEnd,
    };
  });

  // Determine delay warning severity
  let warningLevel: 'none' | 'warning' | 'delayed' = 'none';
  let warningMessage = '';
  if (isDelayed) {
    warningLevel = 'delayed';
    warningMessage = `⚠️ Order is behind schedule by ${delayDays} day${delayDays !== 1 ? 's' : ''}. Expected delivery was ${fmtDate(deadlineDate)}.`;
  } else if (remainingDays <= Math.ceil(projectedLeadTime * 0.15)) {
    warningLevel = 'warning';
    warningMessage = `⚠️ Only ${remainingDays} day${remainingDays !== 1 ? 's' : ''} remaining before the projected deadline of ${fmtDate(deadlineDate)}.`;
  }

  // Determine the start-date label based on which date is used
  const startLabel = order.deposit_paid_at
    ? 'Deposit paid'
    : order.order_confirmed_at
      ? 'Order confirmed'
      : 'Created';

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Calendar className="h-4 w-4" />
          Timeline / Gantt Chart
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Banknote className="h-3 w-3" />
            {startLabel}: {fmtDateShort(startDate)}
          </span>
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            Due: {fmtDate(deadlineDate)}
          </span>
        </div>
      </div>

      {/* Delay / Warning Banner */}
      {warningLevel !== 'none' && (
        <div
          className={`mb-4 flex items-start gap-2 rounded-lg p-3 text-xs ${
            warningLevel === 'delayed'
              ? 'bg-red-50 text-red-700 ring-1 ring-red-200'
              : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
          }`}
        >
          <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${warningLevel === 'delayed' ? 'text-red-500' : 'text-amber-500'}`} />
          <span>{warningMessage}</span>
        </div>
      )}

      {/* Overall progress bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>Progress</span>
          <span>{Math.round(totalPct * 100)}%</span>
        </div>
        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isDelayed ? 'bg-red-500' : totalPct > 0.75 ? 'bg-amber-500' : 'bg-[var(--primary)]'
            }`}
            style={{ width: `${Math.min(totalPct * 100, 100)}%` }}
          />
          {/* "Today" marker */}
          <div
            className="absolute top-0 h-full w-0.5 bg-gray-800"
            style={{ left: `${Math.min(totalPct * 100, 100)}%` }}
            title="Today"
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-gray-400">
          <span>{fmtDateShort(startDate)}</span>
          <span className="font-medium text-gray-500">
            {isDelayed
              ? `Overdue by ${delayDays}d`
              : `${remainingDays}d remaining`}
          </span>
          <span>{fmtDateShort(deadlineDate)}</span>
        </div>
      </div>

      {/* Stage-by-stage Gantt bars */}
      <div className="space-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Stage Timeline</p>
        {stageSegments.map((seg) => {
          const leftPct = seg.stageStartPct * 100;
          const widthPct = (seg.stageEndPct - seg.stageStartPct) * 100;

          return (
            <div key={seg.stage} className="flex items-center gap-2">
              {/* Stage label + date range */}
              <div className="w-40 shrink-0 text-right">
                <span
                  className={`text-[10px] leading-tight ${
                    seg.isCompleted || seg.isCurrent ? 'text-gray-700 font-medium' : 'text-gray-400'
                  }`}
                >
                  {seg.icon} {seg.label}
                </span>
                <div className="text-[9px] text-gray-300 leading-tight">
                  {fmtDateShort(seg.approxStart)} – {fmtDateShort(seg.approxEnd)}
                </div>
              </div>

              {/* Bar track */}
              <div className="relative flex-1 h-6">
                {/* Background track */}
                <div className="absolute inset-0 rounded bg-gray-50 ring-1 ring-inset ring-gray-100" />

                {/* Filled portion (completed) */}
                {seg.isCompleted && (
                  <div
                    className="absolute inset-y-0 left-0 rounded bg-green-400"
                    style={{ width: `${widthPct}%`, left: `${leftPct}%` }}
                  />
                )}

                {/* Current stage highlight */}
                {seg.isCurrent && (
                  <div
                    className="absolute inset-y-0 rounded bg-[var(--primary)] opacity-60"
                    style={{ width: `${widthPct}%`, left: `${leftPct}%` }}
                  />
                )}

                {/* "Today" marker line on each row */}
                <div
                  className="absolute top-0 h-full w-0.5 bg-gray-800 z-10"
                  style={{ left: `${Math.min(totalPct * 100, 100)}%` }}
                />
              </div>

              {/* Status indicator */}
              <div className="w-16 shrink-0 text-[10px] text-gray-400">
                {seg.isCompleted && <span className="text-green-600">✅ Done</span>}
                {seg.isCurrent && <span className="text-emerald-600 font-medium">◉ Now</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-4 text-[10px] text-gray-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-green-400" /> Completed
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-[var(--primary)] opacity-60" /> Current
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-0.5 bg-gray-800" /> Today
        </span>
      </div>
    </div>
  );
}
