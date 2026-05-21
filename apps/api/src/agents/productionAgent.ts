import {
  type AgentResult,
  type OrderRow,
  logAgentAction,
  sendTelegramMessage,
  buildAgentMessage,
  getActiveOrdersByStage,
  getActiveOrdersByStages,
  getEscalationLevel,
  daysSince,
  getGroupChatId,
} from '../services/agentRunner.js';
import { query } from '../db.js';
import {
  analyzeProductionOrder,
  type HermesProductionContext,
  isHermesAvailable,
} from '../services/hermesClaw.js';

/**
 * production-agent  (Hermes Claw)
 *
 * "Hermes Claw" = adaptive-frequency messenger with AI-powered analysis.
 * Uses Gemini API to analyze production context, detect patterns, recall past
 * notes, and generate smarter, context-aware messages.
 *
 * Falls back to rule-based logic when Gemini is unavailable.
 *
 * Frequency bands:
 *   > 50% time remaining  → 24h (daily)
 *   20–50% remaining      → 12h (twice daily)
 *   < 20% remaining       → 4h  (urgent)
 *   overdue               → 2h  (critical, escalating)
 *
 * Monitors:
 *   1. production_confirmed — tracks timeline, sends adaptive reminders
 *   2. en_route             — daily check until inventory arrives
 *   3. partial_production   — daily check for pending items (purchasing_pending with items)
 */

const AGENT_NAME = 'production-agent';

// ── Adaptive next-run delay based on urgency ──────────────────────────

function adaptiveNextRunMs(pctElapsed: number, isOverdue: boolean): number {
  if (isOverdue) return 2 * 60 * 60 * 1000;          // 2h — critical
  if (pctElapsed >= 80) return 4 * 60 * 60 * 1000;   // 4h — urgent
  if (pctElapsed >= 50) return 12 * 60 * 60 * 1000;  // 12h — due soon
  return 24 * 60 * 60 * 1000;                         // 24h — normal
}

function adaptiveLabel(pctElapsed: number, isOverdue: boolean): string {
  if (isOverdue) return '🔴 OVERDUE';
  if (pctElapsed >= 80) return '🟠 URGENT';
  if (pctElapsed >= 50) return '🟡 DUE SOON';
  return '🟢 ON TRACK';
}

// ── Build Hermes context from order row ───────────────────────────────

function buildHermesContext(
  order: OrderRow,
  daysInStage: number,
  pctElapsed: number,
  isOverdue: boolean,
  escalationLevel: number,
): HermesProductionContext {
  return {
    quotation_number: order.quotation_number,
    client_name: order.client_name,
    sales_agent: order.sales_agent,
    stage: order.current_stage,
    production_started: order.production_started,
    production_started_at: order.production_started_at,
    estimated_production_days: order.estimated_production_days,
    production_delayed: order.production_delayed,
    production_finished: order.production_finished,
    production_finished_at: order.production_finished_at,
    en_route_confirmed: order.en_route_confirmed,
    quotation_text: null,
    estimated_arrival_days: order.estimated_arrival_days,
    days_in_stage: daysInStage,
    pct_elapsed: pctElapsed,
    is_overdue: isOverdue,
    escalation_level: escalationLevel,
  };
}

// ── Upsert reminder with adaptive next_run_at ─────────────────────────

async function upsertProductionReminder(
  orderId: string,
  stage: string,
  groupChatId: string,
  message: string,
  nextRunMs: number,
): Promise<void> {
  const nextRun = new Date(Date.now() + nextRunMs);
  await query(
    `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
     VALUES ($1, $2, $3, $4, 'daily', $5, 'active')
     ON CONFLICT (order_id, stage) DO UPDATE SET
       group_chat_id = EXCLUDED.group_chat_id,
       message       = EXCLUDED.message,
       next_run_at   = CASE
                         WHEN reminders.next_run_at <= NOW() THEN EXCLUDED.next_run_at
                         ELSE LEAST(reminders.next_run_at, EXCLUDED.next_run_at)
                       END,
       updated_at    = NOW()`,
    [orderId, stage, groupChatId, message, nextRun.toISOString()],
  );
}

// ── 1. Check production_confirmed orders ──────────────────────────────

async function checkProductionConfirmed(order: OrderRow): Promise<AgentResult> {
  const input = {
    quotation_number: order.quotation_number,
    production_started: order.production_started,
    estimated_production_days: order.estimated_production_days,
    production_delayed: order.production_delayed,
    production_finished: order.production_finished,
    production_started_at: order.production_started_at,
  };

  try {
    const escalationLevel = await getEscalationLevel(order.id, 'production_confirmed');

    if (order.production_finished) {
      const result: AgentResult = {
        status: 'complete',
        message: `✅ Production finished for #${order.quotation_number ?? 'unknown'}. Order should be en route.`,
        next_stage: 'en_route',
        reminder_needed: false,
        escalation_level: escalationLevel,
      };
      await logAgentAction(AGENT_NAME, input, result, 'complete', order.id);
      return result;
    }

    if (!order.production_started || !order.estimated_production_days) {
      const result: AgentResult = {
        status: 'needs_review',
        message: `Production confirmed but no timeline set for #${order.quotation_number ?? 'unknown'}.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };
      await logAgentAction(AGENT_NAME, input, result, 'needs_review', order.id);
      return result;
    }

    const startDate = order.production_started_at
      ? new Date(order.production_started_at)
      : new Date(order.created_at);
    const elapsedMs = Date.now() - startDate.getTime();
    const totalMs = order.estimated_production_days * 86_400_000;
    const pctElapsed = Math.min(100, Math.round((elapsedMs / totalMs) * 100));
    const isOverdue = elapsedMs > totalMs;
    const daysElapsed = Math.floor(elapsedMs / 86_400_000);
    const daysRemaining = Math.max(0, order.estimated_production_days - daysElapsed);

    const statusLabel = adaptiveLabel(pctElapsed, isOverdue);
    const nextRunMs = adaptiveNextRunMs(pctElapsed, isOverdue);

    // ── Hermes Claw AI analysis ──────────────────────────────────────
    const hermesCtx = buildHermesContext(
      order,
      daysElapsed,
      pctElapsed,
      isOverdue,
      escalationLevel,
    );
    const hermesAnalysis = await analyzeProductionOrder(hermesCtx, order.id);

    // Use Hermes message if available, otherwise fall back to rule-based
    const message = hermesAnalysis
      ? `${statusLabel} — ${hermesAnalysis.message}`
      : isOverdue
        ? `${statusLabel} — Production for #${order.quotation_number ?? 'unknown'} is ${daysElapsed - order.estimated_production_days} day(s) overdue (${order.estimated_production_days} days estimated). Is it finished yet?`
        : `${statusLabel} — Production for #${order.quotation_number ?? 'unknown'}: ${pctElapsed}% elapsed, ~${daysRemaining} day(s) remaining. Still on track?`;

    const groupChatId = getGroupChatId(AGENT_NAME);
    if (groupChatId) {
      await upsertProductionReminder(order.id, 'production_confirmed', groupChatId, message, nextRunMs);
    }

    const result: AgentResult = {
      status: isOverdue ? 'blocked' : 'needs_review',
      message,
      next_stage: null,
      reminder_needed: true,
      escalation_level: escalationLevel,
    };
    await logAgentAction(AGENT_NAME, input, result, result.status, order.id);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const result: AgentResult = {
      status: 'blocked',
      message: `❌ Error checking production for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
      next_stage: null,
      reminder_needed: false,
      escalation_level: 0,
    };
    await logAgentAction(AGENT_NAME, input, result, 'error', order.id, errorMsg);
    return result;
  }
}

// ── 2. Check en_route orders ──────────────────────────────────────────

async function checkEnRoute(order: OrderRow): Promise<AgentResult> {
  const input = {
    quotation_number: order.quotation_number,
    current_stage: order.current_stage,
    estimated_arrival_days: order.estimated_arrival_days,
    production_finished_at: order.production_finished_at,
  };

  try {
    const escalationLevel = await getEscalationLevel(order.id, 'en_route');
    const daysWaiting = order.production_finished_at
      ? daysSince(order.production_finished_at)
      : daysSince(order.updated_at);

    const estimatedDays = order.estimated_arrival_days ?? 28;
    const pctElapsed = Math.min(100, Math.round((daysWaiting / estimatedDays) * 100));
    const isOverdue = daysWaiting > estimatedDays;
    const daysRemaining = Math.max(0, estimatedDays - daysWaiting);
    const nextRunMs = adaptiveNextRunMs(pctElapsed, isOverdue);
    const statusLabel = adaptiveLabel(pctElapsed, isOverdue);

    // ── Hermes Claw AI analysis ──────────────────────────────────────
    const hermesCtx = buildHermesContext(
      order,
      daysWaiting,
      pctElapsed,
      isOverdue,
      escalationLevel,
    );
    const hermesAnalysis = await analyzeProductionOrder(hermesCtx, order.id);

    // Use Hermes message if available, otherwise fall back to rule-based
    const message = hermesAnalysis
      ? `${statusLabel} — ${hermesAnalysis.message}`
      : isOverdue
        ? `${statusLabel} — Order #${order.quotation_number ?? 'unknown'} is ${daysWaiting - estimatedDays}d past estimated arrival. Has inventory arrived yet?`
        : `${statusLabel} — Order #${order.quotation_number ?? 'unknown'} is en route. ~${daysRemaining} day(s) until estimated arrival. Confirm when inventory arrives.`;

    const groupChatId = getGroupChatId(AGENT_NAME);
    if (groupChatId) {
      await upsertProductionReminder(order.id, 'en_route_reminder', groupChatId, message, nextRunMs);
    }

    const result: AgentResult = {
      status: 'needs_review',
      message,
      next_stage: null,
      reminder_needed: true,
      escalation_level: escalationLevel,
    };
    await logAgentAction(AGENT_NAME, input, result, 'needs_review', order.id);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const result: AgentResult = {
      status: 'blocked',
      message: `❌ Error checking en_route for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
      next_stage: null,
      reminder_needed: false,
      escalation_level: 0,
    };
    await logAgentAction(AGENT_NAME, input, result, 'error', order.id, errorMsg);
    return result;
  }
}

// ── 3. Check partial_production orders ───────────────────────────────

interface PartialOrder extends OrderRow {
  partial_production_items: string[];
}

async function checkPartialProduction(order: PartialOrder): Promise<AgentResult> {
  const input = {
    quotation_number: order.quotation_number,
    partial_production_items: order.partial_production_items,
  };

  try {
    const escalationLevel = await getEscalationLevel(order.id, 'partial_production');
    const items = order.partial_production_items ?? [];
    const daysPending = daysSince(order.updated_at);

    const urgency = daysPending >= 7
      ? '🔴 OVERDUE'
      : daysPending >= 3
        ? '🟠 NEEDS ATTENTION'
        : '🟡 PENDING';

    // ── Hermes Claw AI analysis for partial production ───────────────
    const hermesCtx = buildHermesContext(
      order,
      daysPending,
      0, // No timeline pct for partial
      daysPending >= 7,
      escalationLevel,
    );
    const hermesAnalysis = await analyzeProductionOrder(hermesCtx, order.id);

    const itemList = items.map(i => `• ${i}`).join('\n');

    // Use Hermes message if available, otherwise fall back to rule-based
    const message = hermesAnalysis
      ? `${urgency} — ${hermesAnalysis.message}\n\nItems not yet produced:\n${itemList}\n\nUpdate via Telegram: reply which items are now done.`
      : `${urgency} — Partial production for #${order.quotation_number ?? 'unknown'} (${daysPending}d pending).\n\nItems not yet produced:\n${itemList}\n\nUpdate via Telegram: reply which items are now done.`;

    const groupChatId = getGroupChatId(AGENT_NAME);
    if (groupChatId) {
      // Partial production uses fixed 24h — the reminder scheduler owns this stage
      await upsertProductionReminder(order.id, 'partial_production', groupChatId, message, 24 * 60 * 60 * 1000);
    }

    const result: AgentResult = {
      status: daysPending >= 7 ? 'blocked' : 'needs_review',
      message,
      next_stage: null,
      reminder_needed: true,
      escalation_level: escalationLevel,
    };
    await logAgentAction(AGENT_NAME, input, result, result.status, order.id);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const result: AgentResult = {
      status: 'blocked',
      message: `❌ Error checking partial production for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
      next_stage: null,
      reminder_needed: false,
      escalation_level: 0,
    };
    await logAgentAction(AGENT_NAME, input, result, 'error', order.id, errorMsg);
    return result;
  }
}

// ── Main Runner ───────────────────────────────────────────────────────

export async function runProductionAgent(): Promise<AgentResult[]> {
  const results: AgentResult[] = [];

  const hermesAvailable = isHermesAvailable();
  if (hermesAvailable) {
    console.log('[ProductionAgent] 🧠 Hermes Claw AI is active — using Gemini for smarter analysis');
  } else {
    console.log('[ProductionAgent] Hermes Claw AI unavailable — using rule-based fallback');
  }

  // 1. Production confirmed — adaptive frequency
  const confirmedOrders = await getActiveOrdersByStage('production_confirmed');
  for (const order of confirmedOrders) {
    results.push(await checkProductionConfirmed(order));
  }

  // 2. En route — adaptive frequency
  const enRouteOrders = await getActiveOrdersByStage('en_route');
  for (const order of enRouteOrders) {
    results.push(await checkEnRoute(order));
  }

  // 3. Partial production — purchasing_pending with pending items
  const partialRows = await query<PartialOrder>(
    `SELECT *, partial_production_items
     FROM orders
     WHERE current_stage = 'purchasing_pending'
       AND status = 'active'
       AND partial_production_items IS NOT NULL
       AND partial_production_items != '[]'::jsonb
     ORDER BY created_at ASC`,
  );
  for (const order of partialRows) {
    results.push(await checkPartialProduction(order));
  }

  return results;
}

export async function notifyProduction(
  groupChatId: string,
  order: OrderRow,
  result: AgentResult,
): Promise<void> {
  const msg = buildAgentMessage(AGENT_NAME, order, result.message, result.escalation_level);
  await sendTelegramMessage(groupChatId, msg);
}
