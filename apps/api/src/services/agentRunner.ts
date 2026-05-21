import { query } from '../db.js';
import { completeOrderReminders } from './reminderScheduler.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface AgentResult {
  status: 'ok' | 'needs_review' | 'blocked' | 'complete';
  message: string;
  next_stage: string | null;
  reminder_needed: boolean;
  escalation_level: number;
}

export interface OrderRow {
  id: string;
  quotation_number: string | null;
  client_name: string | null;
  sales_agent: string | null;
  total_amount: string | null;
  computed_amount: string | null;
  math_status: string | null;
  current_stage: string;
  status: string;
  deposit_paid: boolean;
  deposit_amount: string | null;
  balance_paid: boolean;
  balance_paid_at: string | null;
  production_started: boolean | null;
  production_started_at: string | null;
  estimated_production_days: number | null;
  production_delayed: boolean | null;
  production_delay_days: number | null;
  production_finished: boolean | null;
  production_finished_at: string | null;
  delivery_estimated_days: number | null;
  en_route_confirmed: boolean | null;
  en_route_confirmed_at: string | null;
  estimated_arrival_days: number | null;
  created_at: string;
  updated_at: string;
}

export interface ReminderRow {
  id: string;
  order_id: string;
  stage: string;
  group_chat_id: string;
  message: string;
  frequency: string;
  next_run_at: string;
  status: string;
  escalation_level: number;
}

// ── Stage Labels ───────────────────────────────────────────────────────

export const STAGE_LABELS: Record<string, string> = {
  order_confirmation_received: '📄 Order Confirmation Received',
  math_verified: '✅ Math Verified',
  purchasing_pending: '🛒 Purchasing Pending',
  production_pending: '🏗️ Production Pending',
  production_confirmed: '🏭 Production Confirmed',
  deposit_pending: '💳 Downpayment Pending',
  en_route: '🚚 En Route',
  inventory_arrived: '📦 Inventory Arrived',
  balance_due: '⚖️ Balance Due',
  delivery_scheduled: '🚚 Delivery Scheduled',
  delivered: '✅ Delivered',
  countered: '🔄 Countered',
  payment_received: '💰 Payment Received',
  payment_confirmed: '💵 Payment Confirmed',
};

// ── Group Chat IDs (from env vars) ─────────────────────────────────────

export function getGroupChatId(agentName: string): string | null {
  const envMap: Record<string, string> = {
    'quotation-checker': 'QUOTATION_GROUP_CHAT_ID',
    'purchasing-agent': 'PURCHASING_GROUP_CHAT_ID',
    'production-agent': 'PRODUCTION_GROUP_CHAT_ID',
    'inventory-agent': 'INVENTORY_GROUP_CHAT_ID',
    'delivery-agent': 'DELIVERY_GROUP_CHAT_ID',
    'collection-agent': 'COLLECTION_GROUP_CHAT_ID',
    'escalation-agent': 'ESCALATION_GROUP_CHAT_ID',
  };
  const envKey = envMap[agentName];
  if (!envKey) return null;
  return process.env[envKey] ?? null;
}

// ── Date Helpers ───────────────────────────────────────────────────────

export function daysSince(dateStr: string): number {
  const date = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

// ── Agent Logging ──────────────────────────────────────────────────────

export async function logAgentAction(
  agentName: string,
  input: unknown,
  output: unknown,
  status: string,
  orderId?: string,
  error?: string,
): Promise<void> {
  await query(
    `INSERT INTO agent_logs (agent_name, order_id, input, output, status, error)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [agentName, orderId ?? null, input ?? null, output ?? null, status, error ?? null],
  );
}

/**
 * Add a free-form note from an agent to an order.
 * Unlike logAgentAction (structured input/output), agent_notes are
 * human-readable messages for cross-agent communication and updates.
 */
export async function addAgentNote(
  orderId: string,
  agentName: string,
  note: string,
): Promise<void> {
  await query(
    `INSERT INTO agent_notes (order_id, agent_name, note) VALUES ($1, $2, $3)`,
    [orderId, agentName, note],
  );
}

// ── Telegram Message Sender ────────────────────────────────────────────

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

export function inlineKeyboard(
  rows: { text: string; callback_data: string }[][]
): Record<string, unknown> {
  return { inline_keyboard: rows };
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  replyMarkup?: Record<string, unknown>,
): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('[sendTelegramMessage] TELEGRAM_BOT_TOKEN is not set');
    return false;
  }
  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[sendTelegramMessage] Failed for chat ${chatId}: ${res.status} ${res.statusText} — ${body}`);
    }
    return res.ok;
  } catch (err) {
    console.error(`[sendTelegramMessage] Error sending to chat ${chatId}:`, err);
    return false;
  }
}

// ── Reminder Helpers ───────────────────────────────────────────────────

/**
 * Returns the next reminder fire time: 10:00 AM or 4:00 PM PHT (UTC+8).
 * If the current PHT time is already past 4 PM, returns tomorrow 10 AM PHT.
 */
export function nextPhtReminderTime(): Date {
  const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
  const phtNow = new Date(Date.now() + PHT_OFFSET_MS);
  const phtHour = phtNow.getUTCHours();

  const target = new Date(phtNow.getTime());
  target.setUTCMinutes(0, 0, 0);

  if (phtHour < 10) {
    target.setUTCHours(10);
  } else if (phtHour < 16) {
    target.setUTCHours(16);
  } else {
    target.setUTCDate(target.getUTCDate() + 1);
    target.setUTCHours(10);
  }

  return new Date(target.getTime() - PHT_OFFSET_MS);
}

export async function createReminder(
  orderId: string,
  stage: string,
  groupChatId: string,
  message: string,
  frequency: string = 'daily',
): Promise<void> {
  const firstRun = nextPhtReminderTime();

  await query(
    `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')
     ON CONFLICT DO NOTHING`,
    [orderId, stage, groupChatId, message, frequency, firstRun.toISOString()],
  );
}

export async function completeRemindersForOrder(orderId: string, stage?: string): Promise<void> {
  if (stage) {
    await query(
      `UPDATE reminders SET status = 'completed', updated_at = NOW()
       WHERE order_id = $1 AND stage = $2 AND status = 'active'`,
      [orderId, stage],
    );
  } else {
    await query(
      `UPDATE reminders SET status = 'completed', updated_at = NOW()
       WHERE order_id = $1 AND status = 'active'`,
      [orderId],
    );
  }
}

// ── Active Orders by Stage ─────────────────────────────────────────────

export async function getActiveOrdersByStage(stage: string): Promise<OrderRow[]> {
  return query<OrderRow>(
    `SELECT * FROM orders WHERE current_stage = $1 AND status = 'active' ORDER BY created_at ASC`,
    [stage],
  );
}

export async function getActiveOrdersByStages(stages: string[]): Promise<OrderRow[]> {
  return query<OrderRow>(
    `SELECT * FROM orders WHERE current_stage = ANY($1) AND status = 'active' ORDER BY created_at ASC`,
    [stages],
  );
}

// ── Escalation Check ───────────────────────────────────────────────────

export async function getEscalationLevel(orderId: string, stage: string): Promise<number> {
  const rows = await query<{ escalation_level: number }>(
    `SELECT escalation_level FROM reminders
     WHERE order_id = $1 AND stage = $2 AND status = 'active'
     LIMIT 1`,
    [orderId, stage],
  );
  return rows[0]?.escalation_level ?? 0;
}

// ── Stage Update ───────────────────────────────────────────────────────

export async function advanceStage(
  orderId: string,
  newStage: string,
  quotationNumber: string,
  remarks?: string,
): Promise<void> {
  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, $2, 'auto_advanced', $3, 'agent')`,
    [orderId, newStage, remarks ?? `Auto-advanced to ${STAGE_LABELS[newStage] ?? newStage}`],
  );
  await query(
    `UPDATE orders SET current_stage = $1, updated_at = NOW() WHERE id = $2`,
    [newStage, orderId],
  );
  // Clear all active reminders for this order since it moved to a new stage
  await completeOrderReminders(orderId);
}

// ── Build Agent Message ────────────────────────────────────────────────

export function buildAgentMessage(
  agentName: string,
  order: OrderRow,
  text: string,
  escalationLevel: number = 0,
): string {
  const ref = order.quotation_number
    ? `<b>${escapeHtml(order.quotation_number)}</b>`
    : `Order #${order.id.slice(0, 8)}`;
  const client = order.client_name ? ` (${escapeHtml(order.client_name)})` : '';
  const stageLabel = STAGE_LABELS[order.current_stage] ?? order.current_stage;

  let msg = `🤖 <b>${escapeHtml(agentName)}</b> — ${ref}${client}\n`;
  msg += `Stage: ${stageLabel}\n`;
  msg += `${text}\n`;

  if (escalationLevel > 0) {
    const level = '🔴'.repeat(Math.min(escalationLevel, 3));
    msg += `\n${level} <b>Escalation Level ${escalationLevel}</b>`;
  }

  return msg;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
}
