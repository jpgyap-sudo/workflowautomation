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
  advanceStage,
  addAgentNote,
  inlineKeyboard,
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
 *   1. production_confirmed + production_in_progress — tracks timeline, sends adaptive reminders
 *   2. en_route              — daily check until inventory arrives
 *   3. partial_production    — item-level: asks about pending items one-by-one;
 *                              auto-advances to production_in_progress when all started
 *   4. item-level tracking   — item-by-item production tracking with process of elimination
 *      (production_confirmed + production_in_progress orders that have order_items)
 *   5. en_route + en_route_verification — item-level dispatch & arrival monitoring
 */

// ── Item-level tracking types ─────────────────────────────────────────

interface OrderItemRow {
  id: string;
  order_id: string;
  name: string;
  quantity: number;
  production_status: 'pending' | 'in_progress' | 'finished';
  en_route_status: 'not_yet' | 'en_route' | 'arrived';
  estimated_arrival_days: number | null;
  estimated_production_days: number | null;
  updated_at: string;
}

interface CompletionRow {
  get_production_completion_pct: number;
  get_en_route_completion_pct: number;
  get_inventory_completion_pct: number;
}

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
     ON CONFLICT (order_id, stage) WHERE item_id IS NULL DO UPDATE SET
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
// ── 1. Check production_confirmed / production_in_progress orders ─────


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
    const escalationLevel = await getEscalationLevel(order.id, order.current_stage);

    // ⛔ Guard: Do NOT auto-advance if deposit has not been verified
    // Exception: production_exception allows production to proceed without verified downpayment
    // Exception: stock_replenishment orders have no deposit requirement
    if (!order.deposit_verified && !order.production_exception && order.order_type !== 'stock_replenishment') {
      const result: AgentResult = {
        status: 'blocked',
        message: `⏸️ Deposit not yet verified for #${order.quotation_number ?? 'unknown'}. Production cannot proceed until downpayment is verified on the dashboard.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };
      await logAgentAction(AGENT_NAME, input, result, 'blocked', order.id);
      return result;
    }

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
      await upsertProductionReminder(order.id, order.current_stage, groupChatId, message, nextRunMs);
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
      // Send immediate message so the team is prompted now, not just via reminder
      await sendTelegramMessage(groupChatId, message);
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
//
// Two paths:
//   a) Item-level (preferred): order has order_items — process of elimination
//      asking about each pending item; auto-advance to production_in_progress when all started.
//   b) Legacy JSONB: purchasing_pending orders with partial_production_items array.

interface PartialOrder extends OrderRow {
  partial_production_items: string[];
}

/**
 * Item-level partial production check.
 *
 * Runs for orders at `partial_production` stage that have order_items.
 * - Finds the next pending item and asks the production team about it.
 * - If all items are in_progress or finished → auto-advance to production_in_progress.
 */
async function checkItemLevelPartialProduction(order: OrderRow): Promise<AgentResult | null> {
  const input = { quotation_number: order.quotation_number, stage: order.current_stage };

  try {
    if (order.current_stage !== 'partial_production') return null;

    const items = await getOrderItems(order.id);
    if (items.length === 0) return null; // Legacy JSONB path handles this order

    const completion = await getCompletionPct(order.id);
    const prodPct = completion?.get_production_completion_pct ?? 0;
    const escalationLevel = await getEscalationLevel(order.id, 'partial_production');

    const allFinished = items.every((i) => i.production_status === 'finished');
    const pendingItem = items.find((i) => i.production_status === 'pending');
    const startedCount = items.filter((i) => i.production_status !== 'pending').length;
    const totalCount = items.length;
    const qn = order.quotation_number ?? 'unknown';
    const client = order.client_name ?? 'Unknown';

    if (allFinished) {
      await addProductionLog(null, order.id, `All partial-production items are finished (${prodPct}% complete). Auto-finishing production.`, 'agent', AGENT_NAME);
      await addAgentNote(order.id, AGENT_NAME, `All ${items.length} partial-production item(s) finished. Auto-advancing to en_route.`);
      await finalizeFinishedProductionItems(order, items, prodPct, AGENT_NAME);

      const groupChatId = getGroupChatId(AGENT_NAME);
      if (groupChatId) {
        const msg = `<b>All Items Production Finished</b>

Order #${qn} (${client})
All ${items.length} item(s) completed (${prodPct}%).
Order auto-advanced to En Route. Please verify dispatch item-by-item.`;
        await sendTelegramMessage(groupChatId, msg);
      }

      const result: AgentResult = {
        status: 'complete',
        message: `All partial-production items finished for #${qn}. Auto-advanced to en_route.`,
        next_stage: 'en_route',
        reminder_needed: false,
        escalation_level: escalationLevel,
      };
      await logAgentAction(AGENT_NAME, input, result, 'complete', order.id);
      return result;
    }

    // All items started — advance to production_in_progress
    if (!pendingItem) {
      await addProductionLog(null, order.id, `✅ All items started production (${prodPct}% complete). Auto-advancing to production_in_progress.`, 'agent', AGENT_NAME);
      await addAgentNote(order.id, AGENT_NAME, `All ${items.length} item(s) started. Auto-advancing to production_in_progress.`);

      const lastHuman = await findLastHumanTrigger(order.id);
      await advanceStage(order.id, 'production_in_progress', qn, `All items started production (${prodPct}% complete)`, lastHuman);

      const groupChatId = getGroupChatId(AGENT_NAME);
      if (groupChatId) {
        const msg = `🏭 <b>All Items Started Production</b>\n\nOrder #${qn} (${client})\nAll ${items.length} item(s) have started.\nOrder auto-advanced to 🏭 Production In Progress.`;
        await sendTelegramMessage(groupChatId, msg);
      }

      const result: AgentResult = {
        status: 'complete',
        message: `✅ All items started for #${qn}. Auto-advanced to production_in_progress.`,
        next_stage: 'production_in_progress',
        reminder_needed: false,
        escalation_level: escalationLevel,
      };
      await logAgentAction(AGENT_NAME, input, result, 'complete', order.id);
      return result;
    }

    // Ask about the next pending item (process of elimination)
    const progressBar = buildProgressBar(prodPct);
    const dashboardUrl = `https://track.abcx124.xyz/orders/${qn}`;

    let message = `⏳ <b>Partial Production Check</b>\n`;
    message += `Order: #${qn} (${client})\n`;
    message += `📊 <a href="${dashboardUrl}">View on Dashboard</a>\n`;
    message += `Progress: ${startedCount}/${totalCount} items started ${progressBar}\n\n`;
    message += `<b>Next pending item:</b>\n`;
    message += `<b>${pendingItem.name}</b> ×${pendingItem.quantity}\n\n`;
    message += `Has <b>${pendingItem.name}</b> started production yet?`;

    // Context-aware keyboard: pending items can only be started or deferred
    const keyboard = inlineKeyboard([
      [{ text: `🚀 ${pendingItem.name} — Started`, callback_data: `item_prod:in_progress:${pendingItem.id.slice(0, 8)}:${qn}` }],
      [{ text: `⏳ ${pendingItem.name} — Not Yet`, callback_data: `item_prod:pending:${pendingItem.id.slice(0, 8)}:${qn}` }],
    ]);

    const groupChatId = getGroupChatId(AGENT_NAME);
    if (groupChatId) {
      await sendTelegramMessage(groupChatId, message, keyboard);
      const reminderMsg = `⏳ Partial Production: #${qn} — ${startedCount}/${totalCount} items started. Next: ${pendingItem.name}`;
      await upsertProductionReminder(order.id, 'partial_production', groupChatId, reminderMsg, 24 * 60 * 60 * 1000);
    }

    const result: AgentResult = {
      status: 'needs_review',
      message: `Partial production check for #${qn}: ${startedCount}/${totalCount} items started. Asking about "${pendingItem.name}".`,
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
      message: `❌ Error checking partial production for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
      next_stage: null,
      reminder_needed: false,
      escalation_level: 0,
    };
    await logAgentAction(AGENT_NAME, input, result, 'error', order.id, errorMsg);
    return result;
  }
}

/**
 * Legacy partial production check — for purchasing_pending orders with JSONB items list.
 * Kept for backward compat with the old purchasing flow only.
 */
async function checkLegacyPartialProduction(order: PartialOrder): Promise<AgentResult> {
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

    const hermesCtx = buildHermesContext(order, daysPending, 0, daysPending >= 7, escalationLevel);
    const hermesAnalysis = await analyzeProductionOrder(hermesCtx, order.id);

    const itemList = items.map(i => `• ${i}`).join('\n');
    const message = hermesAnalysis
      ? `${urgency} — ${hermesAnalysis.message}\n\nItems not yet produced:\n${itemList}\n\nUpdate via Telegram: reply which items are now done.`
      : `${urgency} — Partial production for #${order.quotation_number ?? 'unknown'} (${daysPending}d pending).\n\nItems not yet produced:\n${itemList}\n\nUpdate via Telegram: reply which items are now done.`;

    const groupChatId = getGroupChatId(AGENT_NAME);
    if (groupChatId) {
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
      message: `❌ Error checking legacy partial production for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
      next_stage: null,
      reminder_needed: false,
      escalation_level: 0,
    };
    await logAgentAction(AGENT_NAME, input, result, 'error', order.id, errorMsg);
    return result;
  }
}

// ── 4. Item-level production tracking (process of elimination) ────────

/**
 * Fetch order_items for a given order.
 */
async function getOrderItems(orderId: string): Promise<OrderItemRow[]> {
  return query<OrderItemRow>(
    `SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
    [orderId],
  );
}

/**
 * Fetch completion percentages for a given order.
 */
async function getCompletionPct(orderId: string): Promise<CompletionRow | null> {
  const rows = await query<CompletionRow>(
    `SELECT
       get_production_completion_pct($1::uuid) AS get_production_completion_pct,
       get_en_route_completion_pct($1::uuid) AS get_en_route_completion_pct,
       get_inventory_completion_pct($1::uuid) AS get_inventory_completion_pct`,
    [orderId],
  );
  return rows[0] ?? null;
}

/**
 * Add a production update log entry.
 */
async function addProductionLog(
  orderItemId: string | null,
  orderId: string,
  note: string,
  logType: string = 'agent',
  createdBy: string = AGENT_NAME,
): Promise<void> {
  await query(
    `INSERT INTO production_update_logs (order_item_id, order_id, note, log_type, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [orderItemId, orderId, note, logType, createdBy],
  );
}

async function finalizeFinishedProductionItems(
  order: OrderRow,
  items: OrderItemRow[],
  prodPct: number,
  source: string,
): Promise<void> {
  const qn = order.quotation_number ?? 'unknown';
  const lastHuman = await findLastHumanTrigger(order.id);
  const remarks = `All ${items.length} item(s) production finished (${prodPct}% complete) - auto-advanced from ${order.current_stage}`;

  await query(
    `UPDATE orders
     SET production_started = TRUE,
         production_started_at = COALESCE(production_started_at, NOW()),
         production_finished = TRUE,
         production_finished_at = COALESCE(production_finished_at, NOW()),
         partial_production_items = '[]'::jsonb,
         current_stage = 'en_route',
         updated_at = NOW()
     WHERE id = $1`,
    [order.id],
  );

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'en_route', 'production_finished', $2, $3)`,
    [order.id, remarks, source],
  );

  await query(
    `UPDATE reminders
     SET status = 'completed', updated_at = NOW()
     WHERE order_id = $1
       AND status = 'active'
       AND stage IN ('partial_production', 'item_level_production', 'production_pending', 'production_midpoint', 'production_due')`,
    [order.id],
  );

  await advanceStage(order.id, 'en_route', qn, remarks, lastHuman);

  // Send/create the next item-level en-route Telegram question immediately in
  // the same agent run, instead of waiting for the next scheduler tick.
  await checkItemLevelEnRoute({
    ...order,
    current_stage: 'en_route',
    production_started: true,
    production_finished: true,
  } as OrderRow);
}

/**
 * Find the most recent human who triggered a production-related update
 * for this order (from production logs or stage updates).
 * Returns null if no human action found.
 */
async function findLastHumanTrigger(orderId: string): Promise<string | null> {
  try {
    // Check production_update_logs for the most recent human entry
    const logRows = await query<{ created_by: string }>(
      `SELECT created_by FROM production_update_logs
       WHERE order_id = $1 AND log_type = 'user'
       ORDER BY created_at DESC LIMIT 1`,
      [orderId]
    );
    if (logRows[0]?.created_by) {
      return logRows[0].created_by;
    }

    // Fall back to stage_updates where updated_by is not 'agent' or 'system'
    const stageRows = await query<{ updated_by: string }>(
      `SELECT updated_by FROM stage_updates
       WHERE order_id = $1 AND updated_by IS NOT NULL
         AND updated_by NOT IN ('agent', 'system', 'inventory-agent', 'production-agent', 'delivery-agent', 'collection-agent', 'escalation-agent', 'purchasing-agent', 'quotation-checker')
       ORDER BY created_at DESC LIMIT 1`,
      [orderId]
    );
    return stageRows[0]?.updated_by ?? null;
  } catch {
    return null;
  }
}

/**
 * Check item-level production tracking with process of elimination.
 *
 * Strategy:
 * 1. Fetch all order_items for the order
 * 2. Calculate overall completion %
 * 3. Find the first unfinished item (pending or in_progress)
 * 4. Ask about that specific item (process of elimination)
 * 5. If all items finished → advance order to next stage
 * 6. If no items exist → skip (no item-level tracking needed)
 */
async function checkItemLevelProduction(order: OrderRow): Promise<AgentResult | null> {
  const input = {
    quotation_number: order.quotation_number,
    stage: order.current_stage,
  };

  try {
    // Only run for production_confirmed (legacy) or production_in_progress orders that have started production
    if (order.current_stage !== 'production_confirmed' && order.current_stage !== 'production_in_progress') return null;
    if (!order.production_started) return null;

    // Fetch items and completion
    const items = await getOrderItems(order.id);
    if (items.length === 0) return null; // No items to track — skip

    const completion = await getCompletionPct(order.id);
    const prodPct = completion?.get_production_completion_pct ?? 0;
    const escalationLevel = await getEscalationLevel(order.id, 'item_level_production');

    // Find the first unfinished item (process of elimination)
    const unfinishedItem = items.find(
      (item) => item.production_status !== 'finished',
    );

    // If all items are finished - advance the order
    if (!unfinishedItem) {
      const qn = order.quotation_number ?? 'unknown';
      const client = order.client_name ?? 'Unknown';

      // Log the completion and finalize the order flags/stage/reminders.
      await addProductionLog(null, order.id, `All items production finished (${prodPct}% complete). Auto-advancing order.`, 'agent', AGENT_NAME);
      await addAgentNote(order.id, AGENT_NAME, `All ${items.length} item(s) production finished. Auto-advancing to en_route.`);
      await finalizeFinishedProductionItems(order, items, prodPct, AGENT_NAME);

      // Send notification to production group
      const groupChatId = getGroupChatId(AGENT_NAME);
      if (groupChatId) {
        const msg = `<b>All Items Production Finished</b>

Order #${qn} (${client})
All ${items.length} item(s) completed (${prodPct}%).
Order auto-advanced to En Route. Please verify en route status for each item.`;
        await sendTelegramMessage(groupChatId, msg);
      }

      const result: AgentResult = {
        status: 'complete',
        message: `All items production finished for #${qn}. Auto-advanced to en_route.`,
        next_stage: 'en_route',
        reminder_needed: false,
        escalation_level: escalationLevel,
      };
      await logAgentAction(AGENT_NAME, input, result, 'complete', order.id);
      return result;
    }

    
    // ── Process of elimination: ask about the next unfinished item ──
    const finishedCount = items.filter((i) => i.production_status === 'finished').length;
    const totalCount = items.length;

    // Build the message with completion indicator
    const qn = order.quotation_number ?? 'unknown';
    const client = order.client_name ?? 'Unknown';
    const progressBar = buildProgressBar(prodPct);
    const dashboardUrl = `https://track.abcx124.xyz/orders/${qn}`;

    let message = `🏗️ <b>Item-Level Production Check</b>\n`;
    message += `Order: #${qn} (${client})\n`;
    message += `📊 <a href="${dashboardUrl}">View on Dashboard</a>\n`;
    message += `Progress: ${prodPct}% complete ${progressBar}\n`;
    message += `Items: ${finishedCount}/${totalCount} finished\n\n`;
    message += `<b>Process of Elimination:</b>\n`;
    message += `Next item: <b>${unfinishedItem.name}</b> x${unfinishedItem.quantity}\n\n`;
    message += `Has <b>${unfinishedItem.name}</b> started or finished production?`;

    // Build context-aware inline keyboard based on item production_status
    // Pending → only "Started" / "Not Yet"
    // In Progress → "Finished" / "On Time" / "Delayed"
    let keyboard;
    if (unfinishedItem.production_status === 'pending') {
      keyboard = inlineKeyboard([
        [{ text: `🚀 ${unfinishedItem.name} — Started`, callback_data: `item_prod:in_progress:${unfinishedItem.id.slice(0, 8)}:${qn}` }],
        [{ text: `⏳ ${unfinishedItem.name} — Not Yet`, callback_data: `item_prod:pending:${unfinishedItem.id.slice(0, 8)}:${qn}` }],
      ]);
    } else {
      keyboard = inlineKeyboard([
        [{ text: `✅ ${unfinishedItem.name} — Finished`, callback_data: `item_prod:finished:${unfinishedItem.id.slice(0, 8)}:${qn}` }],
        [{ text: `🟢 ${unfinishedItem.name} — On Time`, callback_data: `item_prod:ontime:${unfinishedItem.id.slice(0, 8)}:${qn}` }],
        [{ text: `🔴 ${unfinishedItem.name} — Delayed`, callback_data: `item_prod:delayed:${unfinishedItem.id.slice(0, 8)}:${qn}` }],
      ]);
    }

    // Send the message to the production group chat
    const groupChatId = getGroupChatId(AGENT_NAME);
    if (groupChatId) {
      await sendTelegramMessage(groupChatId, message, keyboard);
    }

    // Upsert a reminder for the next check (24h default for item-level)
    if (groupChatId) {
      const reminderMsg = `🏗️ Item-Level Production: #${qn} — ${finishedCount}/${totalCount} items finished (${prodPct}%). Next item: ${unfinishedItem.name}`;
      await upsertProductionReminder(order.id, 'item_level_production', groupChatId, reminderMsg, 24 * 60 * 60 * 1000);
    }

    const result: AgentResult = {
      status: 'needs_review',
      message: `Item-level production check for #${qn}: ${finishedCount}/${totalCount} finished (${prodPct}%). Asking about "${unfinishedItem.name}".`,
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
      message: `❌ Error checking item-level production for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
      next_stage: null,
      reminder_needed: false,
      escalation_level: 0,
    };
    await logAgentAction(AGENT_NAME, input, result, 'error', order.id, errorMsg);
    return result;
  }
}

/**
 * Calculate en-route completion percentage based on quantity.
 * Returns the percentage of total quantity that is en_route.
 */
function calculateEnRoutePct(items: OrderItemRow[]): number {
  const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
  if (totalQty === 0) return 0;
  const enRouteQty = items
    .filter((i) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived')
    .reduce((sum, i) => sum + i.quantity, 0);
  return Math.round((enRouteQty / totalQty) * 100);
}

/**
 * Check item-level en-route tracking with process of elimination.
 *
 * Handles two stages:
 *
 * en_route — Items being verified as dispatched one by one (process of elimination).
 *   • All items en_route or arrived → auto-advance to en_route_verification
 *   • Some items still not_yet → ask about next unconfirmed item
 *
 * en_route_verification — All items dispatched, monitoring arrival.
 *   • All items arrived → auto-advance to inventory_verification
 *   • Some items still en_route → checkEnRouteItemProgress handles arrival reminders
 */
async function checkItemLevelEnRoute(order: OrderRow): Promise<AgentResult | null> {
  const input = {
    quotation_number: order.quotation_number,
    stage: order.current_stage,
  };

  const isEnRoute = order.current_stage === 'en_route';
  const isEnRouteVerif = order.current_stage === 'en_route_verification';
  if (!isEnRoute && !isEnRouteVerif) return null;

  try {
    const items = await getOrderItems(order.id);
    if (items.length === 0) return null;

    const enRoutePct = calculateEnRoutePct(items);
    const escalationLevel = await getEscalationLevel(order.id, 'item_level_en_route');

    const notEnRouteItem = items.find((item) => item.en_route_status === 'not_yet');
    const notArrivedItem = items.find((item) => item.en_route_status !== 'arrived');
    const enRouteCount = items.filter(
      (i) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived',
    ).length;
    const totalCount = items.length;
    const qn = order.quotation_number ?? 'unknown';
    const client = order.client_name ?? 'Unknown';

    // ── en_route_verification: all items dispatched — check if all have arrived ──
    if (isEnRouteVerif) {
      if (!notArrivedItem) {
        // All items arrived → advance to inventory_verification
        await addProductionLog(null, order.id, `✅ All items arrived (${enRoutePct}% of qty). Auto-advancing to inventory_verification.`, 'agent', AGENT_NAME);
        await addAgentNote(order.id, AGENT_NAME, `All ${items.length} item(s) arrived. Auto-advancing to inventory_verification.`);

        const lastHuman = await findLastHumanTrigger(order.id);
        await advanceStage(order.id, 'inventory_verification', qn, `All items arrived (${enRoutePct}% of qty)`, lastHuman);

        const groupChatId = getGroupChatId(AGENT_NAME);
        if (groupChatId) {
          const msg = `📦 <b>All Items Arrived</b>\n\nOrder #${qn} (${client})\nAll ${items.length} item(s) confirmed arrived.\nOrder auto-advanced to 🔍 Inventory Verification.`;
          await sendTelegramMessage(groupChatId, msg);
        }

        const result: AgentResult = {
          status: 'complete',
          message: `✅ All items arrived for #${qn}. Auto-advanced to inventory_verification.`,
          next_stage: 'inventory_verification',
          reminder_needed: false,
          escalation_level: escalationLevel,
        };
        await logAgentAction(AGENT_NAME, input, result, 'complete', order.id);
        return result;
      }

      // Still waiting for some items to arrive — create a persistent reminder
      const groupChatId = getGroupChatId(AGENT_NAME);
      if (groupChatId) {
        const reminderMsg = `🔎 En Route Verification: #${qn} — ${enRouteCount}/${totalCount} items arrived. Waiting for ${items.length - enRouteCount} more item(s) to arrive at inventory.`;
        await upsertProductionReminder(order.id, 'en_route_verification', groupChatId, reminderMsg, 24 * 60 * 60 * 1000);
      }

      const result: AgentResult = {
        status: 'needs_review',
        message: `⏳ En route verification for #${qn}: ${enRouteCount}/${totalCount} items dispatched, waiting for all to arrive.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };
      await logAgentAction(AGENT_NAME, input, result, 'needs_review', order.id);
      return result;
    }

    // ── en_route: process of elimination — ask about each unconfirmed item ──

    // All items are en_route or arrived → advance to en_route_verification
    if (!notEnRouteItem) {
      await addProductionLog(null, order.id, `✅ All items confirmed en route (${enRoutePct}% of qty). Auto-advancing to en_route_verification.`, 'agent', AGENT_NAME);
      await addAgentNote(order.id, AGENT_NAME, `All ${items.length} item(s) confirmed dispatched. Auto-advancing to en_route_verification.`);

      const lastHuman = await findLastHumanTrigger(order.id);
      await advanceStage(order.id, 'en_route_verification', qn, `All items confirmed dispatched (${enRoutePct}% of qty)`, lastHuman);

      const groupChatId = getGroupChatId(AGENT_NAME);
      if (groupChatId) {
        const msg = `🚚 <b>All Items Dispatched</b>\n\nOrder #${qn} (${client})\nAll ${items.length} item(s) confirmed en route.\nMonitoring arrival — order at 🔎 En Route Verification.`;
        await sendTelegramMessage(groupChatId, msg);
      }

      const result: AgentResult = {
        status: 'complete',
        message: `✅ All items dispatched for #${qn}. Auto-advanced to en_route_verification.`,
        next_stage: 'en_route_verification',
        reminder_needed: false,
        escalation_level: escalationLevel,
      };
      await logAgentAction(AGENT_NAME, input, result, 'complete', order.id);
      return result;
    }

    // Ask about the next unconfirmed item
    const progressBar = buildProgressBar(enRoutePct);
    const dashboardUrl = `https://track.abcx124.xyz/production`;
    const thresholdMet = enRoutePct > 50;

    let message = `🚚 <b>Item-Level En Route Check</b>\n`;
    message += `Order: #${qn} (${client})\n`;
    message += `📊 <a href="${dashboardUrl}">Update in Dashboard</a>\n`;
    message += `En Route: ${enRoutePct}% of qty ${progressBar}\n`;
    message += `Items: ${enRouteCount}/${totalCount} en route\n`;
    if (thresholdMet) {
      message += `✅ <b>>50% threshold met</b> — order can progress once all items confirmed\n`;
    }
    message += `\n<b>Process of Elimination:</b>\n`;
    message += `Next item: <b>${notEnRouteItem.name}</b> x${notEnRouteItem.quantity}\n\n`;
    message += `Is <b>${notEnRouteItem.name}</b> en route yet?`;

    const keyboard = inlineKeyboard([
      [{ text: `🚚 ${notEnRouteItem.name} — Yes, En Route`, callback_data: `item_en_route:yes:${notEnRouteItem.id.slice(0, 8)}:${qn}` }],
      [{ text: `❌ ${notEnRouteItem.name} — Not Yet`, callback_data: `item_en_route:no:${notEnRouteItem.id.slice(0, 8)}:${qn}` }],
    ]);

    const groupChatId = getGroupChatId(AGENT_NAME);
    if (groupChatId) {
      await sendTelegramMessage(groupChatId, message, keyboard);
    }

    if (groupChatId) {
      const reminderMsg = `🚚 Item-Level En Route: #${qn} — ${enRouteCount}/${totalCount} items en route (${enRoutePct}% of qty). Next item: ${notEnRouteItem.name}`;
      await upsertProductionReminder(order.id, 'item_level_en_route', groupChatId, reminderMsg, 24 * 60 * 60 * 1000);
    }

    const result: AgentResult = {
      status: 'needs_review',
      message: `Item-level en-route check for #${qn}: ${enRouteCount}/${totalCount} en route (${enRoutePct}% of qty). Asking about "${notEnRouteItem.name}".`,
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
      message: `❌ Error checking item-level en-route for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
      next_stage: null,
      reminder_needed: false,
      escalation_level: 0,
    };
    await logAgentAction(AGENT_NAME, input, result, 'error', order.id, errorMsg);
    return result;
  }
}

/**
 * Check items that are already confirmed en_route and ask:
 *   — At halfway point: "On time or delayed?"
 *   — At/past arrival date: "Has X arrived yet?"
 *
 * This runs daily for every en_route order alongside checkItemLevelEnRoute.
 */
async function checkEnRouteItemProgress(order: OrderRow): Promise<void> {
  if (order.current_stage !== 'en_route' && order.current_stage !== 'en_route_verification') return;

  const items = await getOrderItems(order.id);
  const enRouteItems = items.filter((i) => i.en_route_status === 'en_route');
  if (enRouteItems.length === 0) return;

  const groupChatId = getGroupChatId(AGENT_NAME);
  if (!groupChatId) return;

  const qn = order.quotation_number ?? 'unknown';
  const now = Date.now();

  for (const item of enRouteItems) {
    if (!item.estimated_arrival_days) continue;

    const confirmedAt = new Date(item.updated_at).getTime();
    const daysElapsed = Math.floor((now - confirmedAt) / 86_400_000);
    const halfway = Math.floor(item.estimated_arrival_days / 2);

    // ── Arrival date reached → ask "Has it arrived?" ──────────────────
    if (daysElapsed >= item.estimated_arrival_days) {
      const msg =
        `📦 <b>Arrival Check</b>\n\n` +
        `Order: #${qn} (${order.client_name ?? 'Unknown'})\n` +
        `Item: <b>${item.name}</b> ×${item.quantity}\n` +
        `Estimated arrival was <b>${item.estimated_arrival_days} day(s)</b> ago.\n\n` +
        `Has <b>${item.name}</b> arrived at the inventory?`;

      const keyboard = inlineKeyboard([
        [{ text: `📦 ${item.name} — Yes, Arrived`, callback_data: `item_en_route:arrived:${item.id.slice(0, 8)}:${qn}` }],
        [{ text: `⏳ ${item.name} — Not Yet`, callback_data: `item_en_route:not_arrived:${item.id.slice(0, 8)}:${qn}` }],
      ]);
      await sendTelegramMessage(groupChatId, msg, keyboard);
      continue;
    }

    // ── Halfway point → ask "On time or delayed?" (once) ─────────────
    if (daysElapsed === halfway) {
      const msg =
        `⏱ <b>Halfway Check</b>\n\n` +
        `Order: #${qn} (${order.client_name ?? 'Unknown'})\n` +
        `Item: <b>${item.name}</b> ×${item.quantity}\n` +
        `${daysElapsed} day(s) elapsed of ${item.estimated_arrival_days} estimated.\n\n` +
        `Will <b>${item.name}</b> arrive on time?`;

      const keyboard = inlineKeyboard([
        [{ text: `✅ On Time`, callback_data: `item_arr_check:ontime:${item.id.slice(0, 8)}:${qn}` }],
        [{ text: `⚠️ Delayed — update days`, callback_data: `item_arr_check:delayed:${item.id.slice(0, 8)}:${qn}` }],
      ]);
      await sendTelegramMessage(groupChatId, msg, keyboard);
    }
  }
}

/**
 * Build a simple text-based progress bar.
 */
function buildProgressBar(pct: number, width: number = 10): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
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

  // -1. Purchasing pending — ask if we should start the production workflow.
  //     Only handles orders WITHOUT JSONB partial_production_items (those are section 3b).
  //     Upserts reminder with next_run_at = now so the scheduler fires it within 1 minute.
  //     Guard: only when deposit_verified = true (otherwise deposit flow is still in progress).
  const purchasingPendingOrders = await query<OrderRow>(
    `SELECT * FROM orders
     WHERE current_stage = 'purchasing_pending'
       AND status = 'active'
       AND deposit_verified = TRUE
       AND (partial_production_items IS NULL OR partial_production_items = '[]'::jsonb)
     ORDER BY created_at ASC`,
  );
  for (const order of purchasingPendingOrders) {
    const groupChatId = process.env.PRODUCTION_GROUP_CHAT_ID;
    if (!groupChatId) continue;

    const qn = order.quotation_number ?? 'unknown';
    const client = order.client_name ?? 'Unknown';
    const daysWaiting = daysSince(order.created_at);

    const message =
      `💰 Order <b>#${qn}</b> (${client}) is in Purchasing Pending — deposit verified.\n\n` +
      `Waiting ${daysWaiting} day${daysWaiting === 1 ? '' : 's'}. Do we proceed to start the production workflow?`;

    // next_run_at = now (nextRunMs = 0) so the scheduler fires this reminder immediately
    await upsertProductionReminder(order.id, 'purchasing_pending', groupChatId, message, 0);

    const result: AgentResult = {
      status: 'needs_review',
      message,
      next_stage: 'production_pending',
      reminder_needed: true,
      escalation_level: 0,
    };
    await logAgentAction(AGENT_NAME, { quotation_number: order.quotation_number, current_stage: order.current_stage }, result, 'needs_review', order.id);
    results.push(result);
  }

  // 0. Production pending — ask if production has started (moved from purchasing agent)
  const pendingOrders = await getActiveOrdersByStage('production_pending');
  for (const order of pendingOrders) {
    const escalationLevel = await getEscalationLevel(order.id, 'production_pending');
    const daysWaiting = daysSince(order.created_at);

    // If production is finished → stop reminding
    if (order.production_finished === true) {
      const result: AgentResult = {
        status: 'complete',
        message: `✅ Production for #${order.quotation_number ?? 'unknown'} is finished. No further production pending reminders needed.`,
        next_stage: null,
        reminder_needed: false,
        escalation_level: escalationLevel,
      };
      await logAgentAction('production-agent', order, result, 'complete', order.id);
      results.push(result);
      continue;
    }

    // If production was reported as delayed → log it and keep reminding
    if (order.production_delayed === true) {
      const delayMsg = order.production_delay_days
        ? ` (${order.production_delay_days} days delay reported)`
        : '';
      const result: AgentResult = {
        status: 'needs_review',
        message: `⚠️ Production for #${order.quotation_number ?? 'unknown'} is delayed${delayMsg}. Estimated ${order.estimated_production_days ?? '?'} days total.`,
        next_stage: null,
        reminder_needed: false,
        escalation_level: escalationLevel,
      };
      await logAgentAction('production-agent', order, result, 'needs_review', order.id);
      results.push(result);
      continue;
    }

    // If production_started is true and estimated_production_days is set → fully tracked, stop reminding
    if (order.production_started === true && order.estimated_production_days != null) {
      const result: AgentResult = {
        status: 'complete',
        message: `✅ Production for #${order.quotation_number ?? 'unknown'} has started and estimated at ${order.estimated_production_days} days. Midpoint and due reminders are active.`,
        next_stage: null,
        reminder_needed: false,
        escalation_level: escalationLevel,
      };
      await logAgentAction('production-agent', order, result, 'complete', order.id);
      results.push(result);
      continue;
    }

    // If production_started is true but estimated_production_days is not set → ask about duration
    if (order.production_started === true && order.estimated_production_days == null) {
      const result: AgentResult = {
        status: 'needs_review',
        message: `🏭 Production has started for this order. How long is the estimated production time? (Standard: 4 weeks, or enter custom days)`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };
      await logAgentAction('production-agent', order, result, 'needs_review', order.id);
      results.push(result);
      continue;
    }

    // If escalated 3+ times, flag for manager attention
    if (escalationLevel >= 3) {
      const result: AgentResult = {
        status: 'blocked',
        message: `🔴 Order stuck at production pending for ${daysWaiting} days with ${escalationLevel} reminders sent. Manager intervention required.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };
      await logAgentAction('production-agent', order, result, 'blocked', order.id);
      results.push(result);
      continue;
    }

    // production_started is false or null → keep reminding daily
    const result: AgentResult = {
      status: 'needs_review',
      message: `Has production started for this order? It's been ${daysWaiting} days since creation. Please confirm Yes or No.`,
      next_stage: null,
      reminder_needed: true,
      escalation_level: escalationLevel,
    };
    await logAgentAction('production-agent', order, result, 'needs_review', order.id);
    results.push(result);
  }

  // 1. Production confirmed + Production in progress — adaptive frequency
  const productionOrders = await getActiveOrdersByStages(['production_confirmed', 'production_in_progress']);
  for (const order of productionOrders) {
    // Check if order has item-level tracking items
    const items = await getOrderItems(order.id);
    if (items.length > 0) {
      // Skip legacy check — item-level tracking handles this order
      console.log(`[ProductionAgent] Skipping legacy check for #${order.quotation_number} (${order.current_stage}) — using item-level tracking`);
    } else {
      // No items — use legacy check
      results.push(await checkProductionConfirmed(order));
    }
  }

  // 2. En route + En Route Verification — adaptive frequency
  // Both stages are monitored: en_route (dispatching items) and en_route_verification (awaiting arrival)
  const enRouteOrders = await getActiveOrdersByStages(['en_route', 'en_route_verification']);
  for (const order of enRouteOrders) {
    const items = await getOrderItems(order.id);
    if (items.length > 0) {
      // Item-level tracking handles this order (handled in section 5 below)
      console.log(`[ProductionAgent] Skipping legacy en-route check for #${order.quotation_number} (${order.current_stage}) — using item-level tracking`);
    } else {
      // No items — use legacy check
      results.push(await checkEnRoute(order));
    }
  }

  // 3a. Partial production (item-level) — partial_production stage orders with order_items
  //     Asks about each pending item one-by-one; auto-advances to production_in_progress when all started
  const partialProductionOrders = await getActiveOrdersByStage('partial_production');
  for (const order of partialProductionOrders) {
    const items = await getOrderItems(order.id);
    if (items.length > 0) {
      const itemResult = await checkItemLevelPartialProduction(order);
      if (itemResult) results.push(itemResult);
    } else {
      // No order_items — fall back to legacy JSONB check
      const legacyOrder = order as PartialOrder;
      legacyOrder.partial_production_items = (order as any).partial_production_items ?? [];
      results.push(await checkLegacyPartialProduction(legacyOrder));
    }
  }

  // 3b. Legacy partial production — purchasing_pending with JSONB pending items
  const legacyPartialRows = await query<PartialOrder>(
    `SELECT *, partial_production_items
     FROM orders
     WHERE current_stage = 'purchasing_pending'
       AND status = 'active'
       AND partial_production_items IS NOT NULL
       AND partial_production_items != '[]'::jsonb
     ORDER BY created_at ASC`,
  );
  for (const order of legacyPartialRows) {
    results.push(await checkLegacyPartialProduction(order));
  }

  // 4. Item-level production tracking — production_confirmed and production_in_progress orders with order_items
  for (const order of productionOrders) {
    const itemResult = await checkItemLevelProduction(order);
    if (itemResult) {
      results.push(itemResult);
    }
  }

  // 5. Item-level en-route tracking — en_route and en_route_verification orders with items
  // en_route: process of elimination (which items dispatched?)
  // en_route_verification: arrival monitoring (which items arrived?)
  for (const order of enRouteOrders) {
    const itemResult = await checkItemLevelEnRoute(order);
    if (itemResult) {
      results.push(itemResult);
    }
    // Check halfway / arrival progress for items already confirmed en_route
    await checkEnRouteItemProgress(order);
  }

  return results;
}

export async function notifyProduction(
  groupChatId: string,
  order: OrderRow,
  result: AgentResult,
): Promise<void> {
  const msg = buildAgentMessage(AGENT_NAME, order, result.message, result.escalation_level);
  const qn = order.quotation_number;

  // Show Yes / Partial / No buttons when asking about production start (production_pending)
  const keyboard =
    qn && result.status === 'needs_review' && !order.production_started
      ? inlineKeyboard([
          [
            { text: '✅ Yes, started', callback_data: `produce:yes:${qn}` },
            { text: '⚠️ Partial', callback_data: `produce:partial:${qn}` },
          ],
          [{ text: '⏳ Not yet', callback_data: `produce:no:${qn}` }],
        ])
      : undefined;

  await sendTelegramMessage(groupChatId, msg, keyboard);
}
