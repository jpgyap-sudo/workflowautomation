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
 *   1. production_confirmed — tracks timeline, sends adaptive reminders
 *   2. en_route             — daily check until inventory arrives
 *   3. partial_production   — daily check for pending items (purchasing_pending with items)
 *   4. item-level tracking  — item-by-item production tracking with process of elimination
 *      (production_confirmed orders that have order_items)
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

    // ⛔ Guard: Do NOT auto-advance if deposit has not been verified
    // Exception: production_exception allows production to proceed without verified downpayment
    if (!order.deposit_verified && !order.production_exception) {
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
    // Only run for production_confirmed orders that have started production
    if (order.current_stage !== 'production_confirmed') return null;
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

    // If all items are finished — advance the order
    if (!unfinishedItem) {
      const qn = order.quotation_number ?? 'unknown';
      const client = order.client_name ?? 'Unknown';

      // Log the completion
      await addProductionLog(null, order.id, `✅ All items production finished (${prodPct}% complete). Auto-advancing order.`, 'agent', AGENT_NAME);
      await addAgentNote(order.id, AGENT_NAME, `All ${items.length} item(s) production finished. Auto-advancing to en_route.`);

      // Advance to en_route (attribute to last human who updated production)
      const lastHuman = await findLastHumanTrigger(order.id);
      await advanceStage(order.id, 'en_route', qn, `All items production finished (${prodPct}% complete)`, lastHuman);

      // Send notification to production group
      const groupChatId = getGroupChatId(AGENT_NAME);
      if (groupChatId) {
        const msg = `✅ <b>All Items Production Finished</b>\n\nOrder #${qn} (${client})\nAll ${items.length} item(s) completed (${prodPct}%).\nOrder auto-advanced to 🚚 En Route.`;
        await sendTelegramMessage(groupChatId, msg);
      }

      const result: AgentResult = {
        status: 'complete',
        message: `✅ All items production finished for #${qn}. Auto-advanced to en_route.`,
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

    // Build inline keyboard for this specific item
    // NOTE: callback_data uses first 8 chars of item UUID + quotation_number (short)
    // to stay within Telegram's 64-byte limit for callback_data.
    const keyboard = inlineKeyboard([
      [
        { text: `✅ ${unfinishedItem.name} — Finished`, callback_data: `item_prod:finished:${unfinishedItem.id.slice(0, 8)}:${qn}` },
      ],
      [
        { text: `🔄 ${unfinishedItem.name} — In Progress`, callback_data: `item_prod:in_progress:${unfinishedItem.id.slice(0, 8)}:${qn}` },
      ],
      [
        { text: `⏳ ${unfinishedItem.name} — Not Yet`, callback_data: `item_prod:pending:${unfinishedItem.id.slice(0, 8)}:${qn}` },
      ],
    ]);

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
 * Strategy:
 * 1. Fetch all order_items for the order
 * 2. Calculate en-route completion % based on quantity
 * 3. Find the first item not yet en_route (process of elimination)
 * 4. Ask about that specific item
 * 5. If >50% of quantity is en_route → progress the order but log % en-route
 * 6. If all items en_route → advance to inventory_arrived
 * 7. If no items exist → skip
 */
async function checkItemLevelEnRoute(order: OrderRow): Promise<AgentResult | null> {
  const input = {
    quotation_number: order.quotation_number,
    stage: order.current_stage,
  };

  try {
    // Only run for en_route stage orders
    if (order.current_stage !== 'en_route') return null;

    // Fetch items and completion
    const items = await getOrderItems(order.id);
    if (items.length === 0) return null; // No items to track — skip

    const enRoutePct = calculateEnRoutePct(items);
    const escalationLevel = await getEscalationLevel(order.id, 'item_level_en_route');

    // Find the first item not yet en_route (process of elimination)
    const notEnRouteItem = items.find(
      (item) => item.en_route_status === 'not_yet',
    );

    const enRouteCount = items.filter(
      (i) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived',
    ).length;
    const totalCount = items.length;

    // If all items are en_route or arrived — advance the order
    if (!notEnRouteItem) {
      const qn = order.quotation_number ?? 'unknown';
      const client = order.client_name ?? 'Unknown';

      // Log the completion
      await addProductionLog(null, order.id, `✅ All items en route (${enRoutePct}% of qty). Auto-advancing to inventory_arrived.`, 'agent', AGENT_NAME);
      await addAgentNote(order.id, AGENT_NAME, `All ${items.length} item(s) en route. Auto-advancing to inventory_arrived.`);

      // Advance to inventory_arrived (attribute to last human who updated en-route status)
      const lastHuman = await findLastHumanTrigger(order.id);
      await advanceStage(order.id, 'inventory_arrived', qn, `All items en route (${enRoutePct}% of qty)`, lastHuman);

      // Send notification to production group
      const groupChatId = getGroupChatId(AGENT_NAME);
      if (groupChatId) {
        const msg = `🚚 <b>All Items En Route</b>\n\nOrder #${qn} (${client})\nAll ${items.length} item(s) en route (${enRoutePct}% of qty).\nOrder auto-advanced to 📦 Inventory Arrived.`;
        await sendTelegramMessage(groupChatId, msg);
      }

      const result: AgentResult = {
        status: 'complete',
        message: `✅ All items en route for #${qn}. Auto-advanced to inventory_arrived.`,
        next_stage: 'inventory_arrived',
        reminder_needed: false,
        escalation_level: escalationLevel,
      };
      await logAgentAction(AGENT_NAME, input, result, 'complete', order.id);
      return result;
    }

    // ── Process of elimination: ask about the next not-en-route item ──
    const qn = order.quotation_number ?? 'unknown';
    const client = order.client_name ?? 'Unknown';
    const progressBar = buildProgressBar(enRoutePct);
    const dashboardUrl = `https://track.abcx124.xyz/orders/${qn}`;

    // Determine if >50% threshold is met
    const thresholdMet = enRoutePct > 50;

    let message = `🚚 <b>Item-Level En Route Check</b>\n`;
    message += `Order: #${qn} (${client})\n`;
    message += `📊 <a href="${dashboardUrl}">View on Dashboard</a>\n`;
    message += `En Route: ${enRoutePct}% of qty ${progressBar}\n`;
    message += `Items: ${enRouteCount}/${totalCount} en route\n`;
    if (thresholdMet) {
      message += `✅ <b>>50% threshold met</b> — order can progress once all items confirmed\n`;
    }
    message += `\n<b>Process of Elimination:</b>\n`;
    message += `Next item: <b>${notEnRouteItem.name}</b> x${notEnRouteItem.quantity}\n\n`;
    message += `Is <b>${notEnRouteItem.name}</b> en route yet?`;

    // Build inline keyboard for this specific item
    // NOTE: callback_data uses first 8 chars of item UUID + quotation_number (short)
    // to stay within Telegram's 64-byte limit for callback_data.
    const keyboard = inlineKeyboard([
      [
        { text: `🚚 ${notEnRouteItem.name} — Yes, En Route`, callback_data: `item_en_route:yes:${notEnRouteItem.id.slice(0, 8)}:${qn}` },
      ],
      [
        { text: `❌ ${notEnRouteItem.name} — Not Yet`, callback_data: `item_en_route:no:${notEnRouteItem.id.slice(0, 8)}:${qn}` },
      ],
      [
        { text: `📦 ${notEnRouteItem.name} — Arrived`, callback_data: `item_en_route:arrived:${notEnRouteItem.id.slice(0, 8)}:${qn}` },
      ],
    ]);

    // Send the message to the production group chat
    const groupChatId = getGroupChatId(AGENT_NAME);
    if (groupChatId) {
      await sendTelegramMessage(groupChatId, message, keyboard);
    }

    // Upsert a reminder for the next check (24h default for item-level en-route)
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

  // 1. Production confirmed — adaptive frequency
  const confirmedOrders = await getActiveOrdersByStage('production_confirmed');
  for (const order of confirmedOrders) {
    // Check if order has item-level tracking items
    const items = await getOrderItems(order.id);
    if (items.length > 0) {
      // Skip legacy check — item-level tracking handles this order
      console.log(`[ProductionAgent] Skipping legacy check for #${order.quotation_number} — using item-level tracking`);
    } else {
      // No items — use legacy check
      results.push(await checkProductionConfirmed(order));
    }
  }

  // 2. En route — adaptive frequency
  const enRouteOrders = await getActiveOrdersByStage('en_route');
  for (const order of enRouteOrders) {
    // Check if order has item-level tracking items
    const items = await getOrderItems(order.id);
    if (items.length > 0) {
      // Skip legacy check — item-level tracking handles this order
      console.log(`[ProductionAgent] Skipping legacy en-route check for #${order.quotation_number} — using item-level tracking`);
    } else {
      // No items — use legacy check
      results.push(await checkEnRoute(order));
    }
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

  // 4. Item-level production tracking — production_confirmed orders with order_items
  for (const order of confirmedOrders) {
    const itemResult = await checkItemLevelProduction(order);
    if (itemResult) {
      results.push(itemResult);
    }
  }

  // 5. Item-level en-route tracking — en_route orders with order_items
  for (const order of enRouteOrders) {
    const itemResult = await checkItemLevelEnRoute(order);
    if (itemResult) {
      results.push(itemResult);
    }
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
