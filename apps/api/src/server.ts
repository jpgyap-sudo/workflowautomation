import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { query } from './db.js';
import { cacheClient, cacheGet, cacheSet, cacheDeletePattern } from './cache.js';
import { randomUUID, randomInt } from 'crypto';
import * as http from 'http';
import nodemailer from 'nodemailer';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  autoExtract,
  extractQuotation,
  extractPayment,
  extractInventory,
} from './services/geminiVision.js';
import {
  processDueReminders,
  createStageReminder,
  upsertStageReminder,
  completeOrderReminders,
  startReminderScheduler,
  stopReminderScheduler,
  waitForReminders,
} from './services/reminderScheduler.js';
import { checkQuotation } from './agents/quotationChecker.js';
import { checkPurchasing } from './agents/purchasingAgent.js';
import { checkInventory } from './agents/inventoryAgent.js';
import { checkScheduledDelivery } from './agents/deliveryAgent.js';
import { checkCollection } from './agents/collectionAgent.js';
import { checkEscalation } from './agents/escalationAgent.js';
import {
  startAgentScheduler,
  stopAgentScheduler,
  waitForAgents,
  runAgentByName,
  listAgents,
  getAgentHealth,
} from './services/agentScheduler.js';
import { STAGE_LABELS } from './services/agentRunner.js';
import { handleProductionChat } from './services/productionAssistant.js';
import { addSSEClient, broadcastSSE } from './sse.js';

const ORDER_LIST_SELECT = `
  o.id, o.quotation_number, o.client_name, o.sales_agent,
  o.total_amount, o.computed_amount, o.math_status, o.current_stage, o.status,
  o.deposit_paid, o.deposit_amount, o.deposit_image_url, o.deposit_paid_at,
  o.deposit_verified, o.deposit_verified_at, o.deposit_verified_by,
  o.balance_paid, o.balance_paid_at,
  o.balance_verified, o.balance_verified_at, o.balance_verified_by,
  o.order_confirmed_at,
  o.production_started, o.production_started_at, o.estimated_production_days,
  o.production_delayed, o.production_delay_days,
  o.production_finished, o.production_finished_at, o.delivery_estimated_days,
  o.en_route_confirmed, o.en_route_confirmed_at, o.estimated_arrival_days,
  o.inventory_en_route_at, o.estimated_inventory_arrival_days,
  o.client_id, o.delivery_address, o.contact_number,
  o.authorized_receiver_name, o.authorized_receiver_contact,
  o.partial_production_items,
  o.delivery_date,
  o.delivery_exception, o.delivery_exception_notes,
  o.delivery_exception_granted_at, o.delivery_exception_granted_by,
  o.production_exception, o.production_exception_notes,
  o.production_exception_granted_at, o.production_exception_granted_by,
  o.inventory_verified_at, o.inventory_verification_pct,
  o.total_amount_changed, o.previous_total_amount, o.amount_change_reason,
  o.amount_changed_at, o.amount_changed_by,
  o.order_type, o.stock_prep_days, o.stock_prep_ready_at,
  o.created_at, o.updated_at
`;

const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });
await app.register(cors, { origin: true });

// ── Cache Invalidation Helper ───────────────────────────────────────
async function invalidateCache(patterns: string[]): Promise<void> {
  for (const pattern of patterns) {
    await cacheDeletePattern(pattern);
  }

  // Also notify SSE clients so they can revalidate SWR caches
  broadcastSSE('invalidate', { keys: patterns });
}

// ── Telegram: Manual Change Notifications ──────────────────────────
const _TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ESCALATION_CHAT_ID = process.env.ESCALATION_GROUP_CHAT_ID ?? null;
const COLLECTION_CHAT_ID = process.env.COLLECTION_GROUP_CHAT_ID ?? null;
const DELIVERY_CHAT_ID = process.env.DELIVERY_GROUP_CHAT_ID ?? null;
const SCHEDULE_GROUP_CHAT_ID = process.env.SCHEDULE_GROUP_CHAT_ID ?? null;

/**
 * Detect if an order is progressing earlier than its estimated schedule
 * and send a Telegram notification to the production group.
 *
 * "Early" means:
 *   - Production finished before estimated_production_days elapsed
 *   - Items marked en_route before estimated_arrival_days elapsed
 *   - Delivery scheduled before estimated delivery date
 */
async function notifyEarlyProgress(
  order: any,
  action: string,
  details: string,
  actor?: string | null,
): Promise<void> {
  if (!_TELEGRAM_BOT_TOKEN || !PRODUCTION_CHAT_ID) return;

  const earlyReasons: string[] = [];
  const ref = order.quotation_number ?? `Order #${(order.id ?? '').slice(0, 8)}`;
  const client = order.client_name ?? 'Unknown';

  // Check production finished early
  if (action.includes('production') || action.includes('finish')) {
    if (order.estimated_production_days && order.production_started_at) {
      const startedAt = new Date(order.production_started_at).getTime();
      const finishedAt = order.production_finished_at
        ? new Date(order.production_finished_at).getTime()
        : Date.now();
      const elapsedDays = (finishedAt - startedAt) / 86_400_000;
      if (elapsedDays < order.estimated_production_days) {
        const earlyDays = Math.round(order.estimated_production_days - elapsedDays);
        earlyReasons.push(`🏁 Finished ${earlyDays} day(s) early (estimated ${order.estimated_production_days}d, actual ${Math.round(elapsedDays)}d)`);
      }
    }
  }

  // Check en route early
  if (action.includes('en_route') || action.includes('en-route') || action.includes('En route')) {
    if (order.estimated_arrival_days) {
      // Items are going en route — if estimated arrival days are set, note it
      earlyReasons.push(`🚚 Marked en route — estimated arrival in ${order.estimated_arrival_days} day(s)`);
    }
    if (order.delivery_estimated_days) {
      earlyReasons.push(`📦 Delivery estimated in ${order.delivery_estimated_days} day(s) from production finish`);
    }
  }

  // Check delivery scheduled early
  if (action.includes('delivery') || action.includes('schedule')) {
    if (order.delivery_date) {
      earlyReasons.push(`📅 Delivery scheduled for ${order.delivery_date}`);
    }
  }

  if (earlyReasons.length === 0) return;

  const byLine = actor ? `\n👤 By: <b>${actor}</b>` : '';
  const msg =
    `⚡ <b>Early Progress Notification</b>\n\n` +
    `Quotation: <b>${ref}</b>\n` +
    `Client: ${client}\n` +
    `Action: ${action}\n\n` +
    `${details}\n\n` +
    `<b>Schedule Status:</b>\n${earlyReasons.join('\n')}${byLine}`;

  setImmediate(() => {
    notifyGroupChat(PRODUCTION_CHAT_ID, msg);
  });
}
const PRODUCTION_CHAT_ID = process.env.PRODUCTION_GROUP_CHAT_ID ?? null;
const PURCHASING_CHAT_ID = process.env.PURCHASING_GROUP_CHAT_ID ?? null;

async function notifyManualChange(action: string, details: string, actor?: string | null): Promise<void> {
  if (!_TELEGRAM_BOT_TOKEN || !ESCALATION_CHAT_ID) return;
  const ts = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
  const byLine = actor ? `\n👤 By: <b>${actor}</b>` : '';
  const msg = `🔔 <b>Dashboard Activity</b>\n\n${action}\n\n${details}${byLine}\n🕐 ${ts}`;
  try {
    await fetch(`https://api.telegram.org/bot${_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: ESCALATION_CHAT_ID, text: msg, parse_mode: 'HTML' }),
    });
  } catch { /* non-fatal */ }
}

/**
 * Send an immediate Telegram notification to a specific functional group chat.
 * This bridges the gap between website manual confirmations and Telegram group notifications.
 * Unlike notifyManualChange (which goes to escalation group) and triggerAgentsForStage
 * (which goes to the general progress group), this sends directly to the group that
 * needs to act on the confirmation (collection, delivery, production, etc.).
 */
async function notifyGroupChat(chatId: string | null, message: string): Promise<void> {
  if (!_TELEGRAM_BOT_TOKEN || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
  } catch { /* non-fatal */ }
}

async function notifyGroupChatWithButtons(
  chatId: string | null,
  message: string,
  buttons: { text: string; callback_data: string }[][],
): Promise<void> {
  if (!_TELEGRAM_BOT_TOKEN || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      }),
    });
  } catch { /* non-fatal */ }
}

async function verifyActionTokenOrReply(actionToken: string | undefined, reply: any): Promise<boolean> {
  if (!actionToken) {
    reply.status(401).send({ error: 'Action token required. Please verify OTP first.' });
    return false;
  }
  if (!cacheClient?.isOpen) {
    reply.status(503).send({ error: 'Action verification unavailable' });
    return false;
  }
  const tokenKey = `action_token:${actionToken}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    return false;
  }
  await cacheClient.del(tokenKey);
  return true;
}

function isDashboardOrigin(updatedBy?: string | null): boolean {
  return updatedBy === 'dashboard_quick_action' || updatedBy === 'dashboard';
}

// ── Instant Agent Triggers ─────────────────────────────────────────────
// When an order moves to a new stage, fire the relevant agent(s) immediately
// so Telegram group chats get notified now, not on the next hourly scheduler tick.

const AGENT_TRIGGER_MAP: Record<string, string[]> = {
  // New Order → Quotation Checker + Collection Agent (for deposit notification)
  order_confirmation_received: ['quotation-checker', 'collection-agent'],
  // Math Verified → Purchasing + Collection Agent
  math_verified:         ['collection-agent'],
  // Purchasing → Production + Collection Agent
  purchasing_pending:    ['production-agent', 'collection-agent'],
  production_pending:    ['production-agent', 'collection-agent'],
  production_in_progress: ['production-agent'],
  // Partial Production → production agent monitors item-level progress
  partial_production:    ['production-agent'],
  // Production → En Route
  en_route:              ['production-agent', 'inventory-agent'],
  // En Route → En Route Verification (all items dispatched, waiting for arrival)
  en_route_verification: ['production-agent'],
  // En Route Verification → Inventory Verification (all items arrived)
  inventory_verification: ['inventory-agent'],
  // Inventory Verification → Inventory Arrived
  inventory_arrived:     ['inventory-agent'],
  // Inventory → Balance Due
  balance_due:           ['collection-agent', 'delivery-agent'],
  // Deposit / Payment Verification
  deposit_pending:       ['collection-agent'],
  deposit_verification:  ['collection-agent'],
  balance_verification:  ['collection-agent'],
  // From-stock orders — skip production/en_route/inventory; notify inventory/delivery/collection groups
  stock_preparation:     ['delivery-agent', 'collection-agent'],
  // Delivery
  delivery_pending:      ['delivery-agent'],
  delivery_scheduled:    ['delivery-agent'],
  delivered:             ['collection-agent'],
  countered:             ['collection-agent'],
  // Payment
  payment_received:      ['collection-agent'],
  payment_confirmed:     ['collection-agent'],
  // Completed
  completed:             ['collection-agent'],
};

function triggerAgentsForStage(stage: string, orderRef?: string, clientName?: string, updatedBy?: string | null): void {
  // 1. Fire the relevant agent(s) for this stage
  const agentsToFire = AGENT_TRIGGER_MAP[stage];
  if (agentsToFire) {
    setImmediate(() => {
      for (const agentName of agentsToFire) {
        runAgentByName(agentName).catch((err) => {
          console.warn(`[triggerAgents] Failed to run ${agentName} for stage ${stage}:`, err);
        });
      }
    });
  }

  // 2. Notify the stage transition (general progress) group
  if (orderRef) {
    setImmediate(() => {
      const stageLabel = STAGE_LABELS[stage] ?? stage;
      const client = clientName ? ` (${clientName})` : '';
      const actor = updatedBy ? `\n👤 <i>By: ${updatedBy}</i>` : '';
      const msg = `📋 <b>Stage Update</b> — ${orderRef}${client}\n➡️ ${stageLabel}${actor}`;
      const chatId = process.env['STAGE_TRANSITION_GROUP_CHAT_ID'];
      if (chatId && _TELEGRAM_BOT_TOKEN) {
        fetch(`https://api.telegram.org/bot${_TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' }),
        }).catch(() => {});
      }
    });
  }
}

type ProductionFinalizationSource = 'production_board' | 'item_update' | 'production_agent' | 'system';

async function finalizeProductionIfAllItemsFinished(
  orderId: string,
  source: ProductionFinalizationSource,
  remarks: string,
): Promise<{ finalized: boolean; order: any | null; itemCount: number }> {
  const items = await query<{ production_status: string }>(
    `SELECT production_status FROM order_items WHERE order_id = $1`,
    [orderId],
  );
  const allFinished = items.length > 0 && items.every((item) => item.production_status === 'finished');
  if (!allFinished) return { finalized: false, order: null, itemCount: items.length };

  const beforeRows = await query<{ current_stage: string; production_finished: boolean | null }>(
    `SELECT current_stage, production_finished FROM orders WHERE id = $1`,
    [orderId],
  );
  const before = beforeRows[0];

  const rows = await query(
    `UPDATE orders
     SET production_started = TRUE,
         production_started_at = COALESCE(production_started_at, NOW()),
         production_finished = TRUE,
         production_finished_at = COALESCE(production_finished_at, NOW()),
         partial_production_items = '[]'::jsonb,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [orderId],
  );
  const order = rows[0] ?? null;
  if (!order) return { finalized: false, order: null, itemCount: items.length };

  if (!before?.production_finished) {
    await query(
      `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
       VALUES ($1, $2, 'production_finished', $3, $4)`,
      [orderId, before?.current_stage ?? order.current_stage, remarks, source],
    );
  }

  await query(
    `UPDATE reminders
     SET status = 'completed', updated_at = NOW()
     WHERE order_id = $1
       AND status = 'active'
       AND stage IN ('partial_production', 'item_level_production', 'production_pending', 'production_midpoint', 'production_due')`,
    [orderId],
  );

  triggerAgentsForStage(order.current_stage, order.quotation_number, order.client_name);
  return { finalized: true, order, itemCount: items.length };
}

async function advanceToEnRouteIfAllDispatched(
  orderId: string,
  source: string,
  remarks: string,
): Promise<{ advanced: boolean; order: any | null }> {
  const items = await query<{ en_route_status: string; production_status: string }>(
    `SELECT en_route_status, production_status FROM order_items WHERE order_id = $1`,
    [orderId],
  );
  // Only check that all items are dispatched (en_route or arrived).
  // Production completion is a separate concern — items can be en route
  // even if some are still in production (partial dispatch workflow).
  const allDispatched = items.length > 0 && items.every((item) => item.en_route_status === 'en_route' || item.en_route_status === 'arrived');
  if (!allDispatched) return { advanced: false, order: null };

  const beforeRows = await query<{ current_stage: string }>(
    `SELECT current_stage FROM orders WHERE id = $1`,
    [orderId],
  );
  const beforeStage = beforeRows[0]?.current_stage;

  if (!beforeStage || beforeStage === 'en_route') {
    return { advanced: false, order: null };
  }

  const rows = await query(
    `UPDATE orders
     SET current_stage = 'en_route',
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [orderId],
  );
  const order = rows[0] ?? null;
  if (!order) return { advanced: false, order: null };

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'en_route', 'all_dispatched', $2, $3)`,
    [orderId, remarks, source],
  );

  triggerAgentsForStage('en_route', order.quotation_number, order.client_name);
  return { advanced: true, order };
}

// Advances an order from 'en_route' → 'en_route_verification' once all items are dispatched.
// This is the counterpart to advanceToEnRouteIfAllDispatched, which only advances TO en_route.
async function advanceFromEnRouteToVerificationIfAllDispatched(
  orderId: string,
  source: string,
  defaultArrivalDays?: number | null,
): Promise<{ advanced: boolean; order: any | null }> {
  const items = await query<{ en_route_status: string; production_status: string; estimated_arrival_days: number | null }>(
    `SELECT en_route_status, production_status, estimated_arrival_days FROM order_items WHERE order_id = $1`,
    [orderId],
  );
  if (items.length === 0) return { advanced: false, order: null };
  // Only check that all items are dispatched (en_route or arrived).
  // Production completion is a separate concern — items can be en route
  // even if some are still in production (partial dispatch workflow).
  const allDispatched = items.every((i) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived');
  if (!allDispatched) return { advanced: false, order: null };

  const orderRows = await query<{ current_stage: string; estimated_arrival_days: number | null }>(
    `SELECT current_stage, estimated_arrival_days FROM orders WHERE id = $1`,
    [orderId],
  );
  const order = orderRows[0];
  if (!order || order.current_stage !== 'en_route') return { advanced: false, order: null };

  // Derive arrival days: prefer caller-provided default → max of item days → existing order days → 28
  const itemDays = items.map((i) => i.estimated_arrival_days ?? 0).filter((d) => d > 0);
  const arrivalDays = defaultArrivalDays
    ?? (itemDays.length > 0 ? Math.max(...itemDays) : null)
    ?? order.estimated_arrival_days
    ?? 28;

  const rows = await query(
    `UPDATE orders
     SET en_route_confirmed = TRUE, en_route_confirmed_at = NOW(),
         estimated_arrival_days = $1,
         current_stage = 'en_route_verification',
         updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [arrivalDays, orderId],
  );
  const updatedOrder = rows[0] ?? null;
  if (!updatedOrder) return { advanced: false, order: null };

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'en_route_verification', 'all_dispatched', $2, $3)`,
    [orderId, `All items dispatched — advancing to en_route_verification (est. ${arrivalDays}d)`, source],
  );

  triggerAgentsForStage('en_route_verification', updatedOrder.quotation_number, updatedOrder.client_name);
  return { advanced: true, order: updatedOrder };
}

// Advances an order from 'en_route_verification' → 'inventory_verification'
// once ALL items have en_route_status = 'arrived'.
async function advanceToInventoryVerificationIfAllArrived(
  orderId: string,
  source: string,
): Promise<{ advanced: boolean; order: any | null }> {
  const items = await query<{ en_route_status: string }>(
    `SELECT en_route_status FROM order_items WHERE order_id = $1`,
    [orderId],
  );
  if (items.length === 0) return { advanced: false, order: null };
  const allArrived = items.every((i) => i.en_route_status === 'arrived');
  if (!allArrived) return { advanced: false, order: null };

  const orderRows = await query<{ current_stage: string }>(
    `SELECT current_stage FROM orders WHERE id = $1`, [orderId],
  );
  const order = orderRows[0];
  if (!order || order.current_stage !== 'en_route_verification') return { advanced: false, order: null };

  const rows = await query(
    `UPDATE orders SET current_stage = 'inventory_verification', updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [orderId],
  );
  const updatedOrder = rows[0] ?? null;
  if (!updatedOrder) return { advanced: false, order: null };

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'inventory_verification', 'all_arrived', $2, $3)`,
    [orderId, `All items arrived — auto-advancing to inventory_verification`, source],
  );

  triggerAgentsForStage('inventory_verification', updatedOrder.quotation_number, updatedOrder.client_name);
  return { advanced: true, order: updatedOrder };
}

// ── Email (OTP) ──────────────────────────────────────────────────────
const smtpTransporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  tls: {
    rejectUnauthorized: false,
  },
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verify SMTP connection on startup
smtpTransporter.verify((err) => {
  if (err) {
    console.error('[smtp] Connection failed:', err.message);
    console.error('[smtp] Check that SMTP_USER and SMTP_PASS are set correctly.');
    console.error('[smtp] For Gmail, SMTP_PASS must be a 16-char App Password (not your regular password).');
  } else {
    console.log('[smtp] Connected and ready to send emails');
  }
});

const OTP_TTL = 300; // 5 minutes
const OTP_MAX_ATTEMPTS = 5;

app.post('/auth/send-otp', async (request, reply) => {
  const { email } = z.object({ email: z.string().email() }).parse(request.body);
  const otp = String(randomInt(100000, 999999));
  const key = `otp:${email.toLowerCase()}`;
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'OTP service unavailable' });
  }
  await cacheClient.setEx(key, OTP_TTL, JSON.stringify({ otp, attempts: 0 }));

  // If SMTP is not configured, log OTP to console for dev testing
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn(`[otp] SMTP not configured. OTP for ${email}: ${otp}`);
    return reply.status(503).send({ error: 'Email service not configured. Contact admin.' });
  }

  try {
    await smtpTransporter.sendMail({
      from: `"Quotation System" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Your verification code',
      text: `Your one-time verification code is: ${otp}\n\nIt expires in 5 minutes.`,
      html: `<p>Your one-time verification code is:</p><h2 style="letter-spacing:4px">${otp}</h2><p>It expires in 5 minutes.</p>`,
    });
  } catch (err: any) {
    console.error('[otp] Failed to send email:', err);
    const isAuthError = err?.code === 'EAUTH' || err?.response?.includes('535') || err?.message?.includes('Authentication');
    const isNetworkError = err?.code === 'ECONNECTION' || err?.code === 'ETIMEDOUT';
    if (isAuthError) {
      return reply.status(500).send({ error: 'Email authentication failed. Check SMTP credentials.' });
    }
    if (isNetworkError) {
      return reply.status(500).send({ error: 'Email service unreachable. Check network or firewall.' });
    }
    return reply.status(500).send({ error: 'Failed to send OTP email' });
  }
  return reply.send({ ok: true });
});

app.post('/auth/verify-otp', async (request, reply) => {
  const { email, otp } = z.object({ email: z.string().email(), otp: z.string() }).parse(request.body);
  const key = `otp:${email.toLowerCase()}`;
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'OTP service unavailable' });
  }
  const raw = await cacheClient.get(key);
  if (!raw) {
    return reply.status(400).send({ error: 'OTP expired or not found' });
  }
  const stored = JSON.parse(raw) as { otp: string; attempts: number };
  if (stored.attempts >= OTP_MAX_ATTEMPTS) {
    await cacheClient.del(key);
    return reply.status(400).send({ error: 'Too many attempts. Request a new OTP.' });
  }
  if (stored.otp !== otp.trim()) {
    stored.attempts += 1;
    const ttl = await cacheClient.ttl(key);
    await cacheClient.setEx(key, ttl > 0 ? ttl : 1, JSON.stringify(stored));
    return reply.status(400).send({ error: 'Invalid OTP' });
  }
  await cacheClient.del(key);
  return reply.send({ ok: true });
});

// ── OTP for destructive actions (edit/delete) ───────────────────────
// Verifies OTP and returns a short-lived action token
app.post('/auth/verify-otp-for-action', async (request, reply) => {
  const { email, otp, name } = z.object({ email: z.string().email(), otp: z.string(), name: z.string().optional() }).parse(request.body);
  const key = `otp:${email.toLowerCase()}`;
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'OTP service unavailable' });
  }
  const raw = await cacheClient.get(key);
  if (!raw) {
    return reply.status(400).send({ error: 'OTP expired or not found' });
  }
  const stored = JSON.parse(raw) as { otp: string; attempts: number };
  if (stored.attempts >= OTP_MAX_ATTEMPTS) {
    await cacheClient.del(key);
    return reply.status(400).send({ error: 'Too many attempts. Request a new OTP.' });
  }
  if (stored.otp !== otp.trim()) {
    stored.attempts += 1;
    const ttl = await cacheClient.ttl(key);
    await cacheClient.setEx(key, ttl > 0 ? ttl : 1, JSON.stringify(stored));
    return reply.status(400).send({ error: 'Invalid OTP' });
  }
  await cacheClient.del(key);
  // Generate a short-lived action token (valid for 2 minutes)
  const actionToken = randomUUID();
  await cacheClient.setEx(`action_token:${actionToken}`, 120, JSON.stringify({ email: email.toLowerCase(), name: name ?? null, verified: true }));
  return reply.send({ ok: true, actionToken });
});

// ── Telegram 4-digit action verification ────────────────────────────
// When a dashboard user clicks a guarded button, we generate a 4-digit code,
// push it to Telegram, and require the user to type it back in the GUI.
const ACTION_CODE_TTL = 300; // 5 minutes
const ACTION_CODE_MAX_ATTEMPTS = 5;
// Fallback chain: dedicated env → escalation group → production group → collection group
const ACTION_VERIFY_CHAT_ID =
  process.env.ACTION_VERIFY_TELEGRAM_CHAT_ID ??
  ESCALATION_CHAT_ID ??
  PRODUCTION_CHAT_ID ??
  COLLECTION_CHAT_ID ??
  null;

app.post('/auth/send-action-code', async (request, reply) => {
  const { email, name } = z.object({ email: z.string().email(), name: z.string().optional() }).parse(request.body);

  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Verification service unavailable' });
  }

  const code = String(randomInt(1000, 10000)); // 4-digit: 1000–9999
  const key = `action_code:${email.toLowerCase()}`;
  await cacheClient.setEx(key, ACTION_CODE_TTL, JSON.stringify({ code, attempts: 0 }));

  if (!_TELEGRAM_BOT_TOKEN || !ACTION_VERIFY_CHAT_ID) {
    console.warn(`[action-code] Telegram not configured — falling back to email for ${email}`);
    return reply.status(503).send({ error: 'Telegram not configured' });
  }

  const requester = name ?? email;
  const msg = `🔐 <b>Dashboard Action Verification</b>\n\nA dashboard action requires confirmation.\n\n👤 Requested by: <b>${requester}</b>\n\nYour 4-digit code:\n\n<code>${code}</code>\n\n<i>Expires in 5 minutes. Do not share this code.</i>`;
  try {
    const res = await fetch(`https://api.telegram.org/bot${_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: ACTION_VERIFY_CHAT_ID, text: msg, parse_mode: 'HTML' }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[action-code] Telegram send failed:', body);
      return reply.status(503).send({ error: 'Telegram unavailable' });
    }
  } catch (err) {
    console.error('[action-code] Telegram send error:', err);
    return reply.status(503).send({ error: 'Telegram unavailable' });
  }

  return reply.send({ ok: true });
});

app.post('/auth/verify-action-code', async (request, reply) => {
  const { email, code, name } = z.object({ email: z.string().email(), code: z.string(), name: z.string().optional() }).parse(request.body);
  const key = `action_code:${email.toLowerCase()}`;

  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Verification service unavailable' });
  }

  const raw = await cacheClient.get(key);
  if (!raw) {
    return reply.status(400).send({ error: 'Code expired or not found. Request a new one.' });
  }

  const stored = JSON.parse(raw) as { code: string; attempts: number };
  if (stored.attempts >= ACTION_CODE_MAX_ATTEMPTS) {
    await cacheClient.del(key);
    return reply.status(400).send({ error: 'Too many attempts. Request a new code.' });
  }

  if (stored.code !== code.trim()) {
    stored.attempts += 1;
    const ttl = await cacheClient.ttl(key);
    await cacheClient.setEx(key, ttl > 0 ? ttl : 1, JSON.stringify(stored));
    return reply.status(400).send({ error: `Invalid code (${ACTION_CODE_MAX_ATTEMPTS - stored.attempts} attempts left)` });
  }

  await cacheClient.del(key);
  const actionToken = randomUUID();
  await cacheClient.setEx(`action_token:${actionToken}`, 120, JSON.stringify({ email: email.toLowerCase(), name: name ?? null, verified: true }));
  return reply.send({ ok: true, actionToken });
});

// ── Dashboard Accounts (server-side tab access + sub-users) ────────

function parseDashboardJsonArray(value: unknown): unknown {
  if (Array.isArray(value) || value == null) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parseDashboardJsonArray(parsed);
    } catch {
      return value;
    }
  }
  return value;
}

function serializeDashboardAccount(r: any) {
  return {
    email: r.email,
    name: r.name,
    role: r.role,
    allowedTabs: parseDashboardJsonArray(r.allowed_tabs),
    subUsers: parseDashboardJsonArray(r.sub_users),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

app.get('/dashboard-accounts', async () => {
  const rows = await query(`SELECT email, name, role, allowed_tabs, sub_users, created_at, updated_at FROM dashboard_accounts ORDER BY created_at DESC`);
  return rows.map(serializeDashboardAccount);
});

app.post('/dashboard-accounts', async (request, reply) => {
  const body = z.object({
    email: z.string().email(),
    name: z.string().optional(),
    role: z.enum(['admin', 'editor', 'viewer']).optional(),
    allowedTabs: z.array(z.string()).optional(),
    subUsers: z.array(z.object({ code: z.string(), name: z.string() })).optional(),
  }).parse(request.body);

  try {
    await query(
      `INSERT INTO dashboard_accounts (email, name, role, allowed_tabs, sub_users)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       ON CONFLICT (email) DO UPDATE SET
         name=COALESCE(EXCLUDED.name, dashboard_accounts.name),
         role=COALESCE(EXCLUDED.role, dashboard_accounts.role),
         allowed_tabs=COALESCE(EXCLUDED.allowed_tabs, dashboard_accounts.allowed_tabs),
         sub_users=COALESCE(EXCLUDED.sub_users, dashboard_accounts.sub_users),
         updated_at=NOW()`,
      [
        body.email,
        body.name ?? null,
        body.role ?? 'editor',
        body.allowedTabs !== undefined ? JSON.stringify(body.allowedTabs) : null,
        body.subUsers !== undefined ? JSON.stringify(body.subUsers) : null,
      ]
    );
    return reply.send({ ok: true });
  } catch (err: any) {
    return reply.status(500).send({ error: err.message ?? 'Failed to save account' });
  }
});

app.patch('/dashboard-accounts/:email', async (request, reply) => {
  const params = z.object({ email: z.string().email() }).parse(request.params);
  const body = z.object({
    name: z.string().optional(),
    role: z.enum(['admin', 'editor', 'viewer']).optional(),
    allowedTabs: z.array(z.string()).nullable().optional(),
    subUsers: z.array(z.object({ code: z.string(), name: z.string() })).nullable().optional(),
  }).parse(request.body);

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (body.name !== undefined) { fields.push(`name=$${idx++}`); values.push(body.name); }
  if (body.role !== undefined) { fields.push(`role=$${idx++}`); values.push(body.role); }
  if (body.allowedTabs !== undefined) { fields.push(`allowed_tabs=$${idx++}::jsonb`); values.push(body.allowedTabs === null ? null : JSON.stringify(body.allowedTabs)); }
  if (body.subUsers !== undefined) { fields.push(`sub_users=$${idx++}::jsonb`); values.push(body.subUsers === null ? null : JSON.stringify(body.subUsers)); }

  if (fields.length === 0) {
    return reply.status(400).send({ error: 'No fields to update' });
  }

  fields.push('updated_at=NOW()');
  values.push(params.email);

  const updatedRows = await query(
    `UPDATE dashboard_accounts SET ${fields.join(', ')} WHERE email=$${idx}
     RETURNING email, name, role, allowed_tabs, sub_users, created_at, updated_at`,
    values
  );

  if (!updatedRows[0]) {
    return reply.status(404).send({ error: 'Dashboard account not found' });
  }

  return reply.send({ ok: true, account: serializeDashboardAccount(updatedRows[0]) });
});

app.delete('/dashboard-accounts/:email', async (request, reply) => {
  const params = z.object({ email: z.string().email() }).parse(request.params);
  await query(`DELETE FROM dashboard_accounts WHERE email=$1`, [params.email]);
  return reply.send({ ok: true });
});

// ── Health ──────────────────────────────────────────────────────────
app.get('/health', async () => {
  const agentHealth = getAgentHealth();
  const allHealthy = agentHealth.every((a) => a.healthy);
  return {
    ok: allHealthy,
    service: 'quotation-automation-api',
    agents: agentHealth,
  };
});

// ── Telegram Webhook Proxy ─────────────────────────────────────────
// Proxies incoming Telegram webhook updates to the telegram-bot container.
// The bot runs an internal HTTP server on port WEBHOOK_PORT (default 8443).
// Nginx routes POST /api/telegram-webhook -> this route -> http://telegram-bot:8443/

const TELEGRAM_BOT_WEBHOOK_HOST = process.env.TELEGRAM_BOT_WEBHOOK_HOST ?? 'telegram-bot';
const TELEGRAM_BOT_WEBHOOK_PORT = Number(process.env.TELEGRAM_BOT_WEBHOOK_PORT ?? 8443);

app.post('/telegram-webhook', async (request, reply) => {
  // Forward the raw request body to the telegram-bot container
  const body = JSON.stringify(request.body);
  const secretToken = (request.headers as any)['x-telegram-bot-api-secret-token'] ?? '';

  try {
    const result = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const options = {
        hostname: TELEGRAM_BOT_WEBHOOK_HOST,
        port: TELEGRAM_BOT_WEBHOOK_PORT,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(secretToken ? { 'X-Telegram-Bot-Api-Secret-Token': secretToken } : {}),
        },
        timeout: 10_000,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 200, body: data });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(body);
      req.end();
    });

    reply.code(result.statusCode);
    return result.body;
  } catch (err: any) {
    console.error('[webhook-proxy] Failed to forward to telegram-bot:', err.message);
    reply.code(502);
    return { ok: false, error: 'Failed to forward webhook to bot' };
  }
});

/**
 * POST /telegram/notify
 * Send a custom notification to the escalation group from the dashboard (e.g., calendar).
 * Requires an action token for verification.
 */
app.post('/telegram/notify', async (request, reply) => {
  const body = z
    .object({
      message: z.string().min(1).max(2000),
      action_token: z.string().optional(),
    })
    .parse(request.body);

  let actor: string | null = null;
  if (body.action_token && cacheClient?.isOpen) {
    const tokenKey = `action_token:${body.action_token}`;
    const tokenData = await cacheClient.get(tokenKey);
    if (tokenData) {
      await cacheClient.del(tokenKey);
      try {
        const tokenPayload = JSON.parse(tokenData);
        actor = tokenPayload.name ?? tokenPayload.email ?? null;
      } catch { /* non-fatal */ }
    }
  }

  await notifyManualChange('📅 Calendar Notification', body.message, actor);
  return reply.send({ ok: true });
});

// ── Orders ──────────────────────────────────────────────────────────

const createOrderSchema = z.object({
  quotation_number: z.string().optional(),
  client_name: z.string().optional(),
  sales_agent: z.string().optional(),
  total_amount: z.number().optional(),
  order_confirmed_at: z.string().optional(),
  items: z.array(z.object({
    name: z.string().min(1),
    quantity: z.number().int().positive(),
  })).optional(),
  action_token: z.string(),
  // From-stock orders skip purchasing/production/en_route/inventory stages
  order_type: z.enum(['from_stock']).optional(),
  stock_prep_days: z.number().int().min(0).optional(), // 0 = immediate
});

app.post('/orders', async (request, reply) => {
  const body = createOrderSchema.parse(request.body);

  // Verify action token and extract email
  let userEmail: string | null = null;
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  try {
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  } catch { /* non-fatal */ }

  const stockPrepDays = body.order_type === 'from_stock' ? (body.stock_prep_days ?? 0) : null;
  const stockPrepReadyAt = stockPrepDays !== null
    ? (stockPrepDays === 0 ? new Date() : new Date(Date.now() + stockPrepDays * 86_400_000))
    : null;

  const rows = await query(
    `INSERT INTO orders (quotation_number, client_name, sales_agent, total_amount, order_confirmed_at, order_type, stock_prep_days, stock_prep_ready_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (quotation_number) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [
      body.quotation_number ?? null,
      body.client_name ?? null,
      body.sales_agent ?? null,
      body.total_amount ?? null,
      body.order_confirmed_at ?? new Date().toISOString().slice(0, 10),
      body.order_type ?? null,
      stockPrepDays,
      stockPrepReadyAt?.toISOString() ?? null,
    ]
  );
  // Auto-link client by name
  if (body.client_name) {
    await autoLinkClientToOrder(rows[0].id, body.client_name);
  }

  // ── Save extracted items if provided ──────────────────────────────────
  if (body.items && body.items.length > 0) {
    for (const item of body.items) {
      await query(
        `INSERT INTO order_items (order_id, name, quantity, production_status, en_route_status)
         VALUES ($1, $2, $3, 'pending', 'not_yet')`,
        [rows[0].id, item.name, item.quantity]
      );
    }
    // Log the extraction
    await query(
      `INSERT INTO production_update_logs (order_id, note, log_type, created_by)
       VALUES ($1, $2, 'agent', 'Vision AI')`,
      [rows[0].id, `📋 Vision AI extracted ${body.items.length} item(s) from quotation: ${body.items.map(i => `${i.name} x${i.quantity}`).join(', ')}`]
    );
  }

  // Invalidate caches after write
  await invalidateCache(['dashboard:*', 'orders:*', 'calendar:*', 'sales:*']);

  // ── Fire agent + notify stage transition group for new orders ──────────
  // New orders start at 'order_confirmation_received' (DB default).
  // Trigger the quotation-checker agent immediately and notify the
  // stage transition group so the team knows a new order has arrived.
  const newOrder = rows[0];
  triggerAgentsForStage('order_confirmation_received', newOrder.quotation_number, newOrder.client_name);

  // Notify escalation group about new order created from dashboard
  await notifyManualChange(
    '📝 New order created',
    `Quotation: *${newOrder.quotation_number ?? 'N/A'}*\nClient: *${newOrder.client_name ?? 'Unknown'}*\nSales Agent: ${newOrder.sales_agent ?? '—'}\nAmount: ${newOrder.total_amount != null ? `PHP ${Number(newOrder.total_amount).toLocaleString()}` : '—'}`,
    userEmail,
  );

  // Notify production group about new order
  if (PRODUCTION_CHAT_ID) {
    const itemCount = body.items?.length ?? 0;
    setImmediate(() => {
      notifyGroupChat(
        PRODUCTION_CHAT_ID,
        `📋 <b>New Order Created (Dashboard)</b>\n\n` +
        `Quotation: <b>${newOrder.quotation_number ?? 'N/A'}</b>\n` +
        `Client: ${newOrder.client_name ?? 'Unknown'}\n` +
        `Sales Agent: ${newOrder.sales_agent ?? '—'}\n` +
        `Amount: ${newOrder.total_amount != null ? `PHP ${Number(newOrder.total_amount).toLocaleString()}` : '—'}\n` +
        `Items: ${itemCount > 0 ? `${itemCount} item(s) extracted` : 'No items yet'}\n\n` +
        `Status: <b>Order Confirmation Received</b>`
      );
    });
  }

  return reply.send(newOrder);
});

// ── Stock Replenishment Orders ───────────────────────────────────────
// Creates an order that skips purchasing/deposit and goes directly to production.
// Uses the same AI extraction as inventory bulk upload.
app.post('/orders/stock-replenishment', async (request, reply) => {
  const body = z.object({
    file_data: z.string(), // base64
    mime_type: z.string(),
    original_filename: z.string(),
    label: z.string().optional(),
    action_token: z.string(),
  }).parse(request.body);

  // Verify action token
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  let userEmail: string | null = null;
  try {
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  } catch { /* non-fatal */ }

  // Extract items from file
  const mimeType = body.mime_type.toLowerCase();
  const items: Array<{ name: string; quantity: number }> = [];

  if (mimeType === 'text/csv' || mimeType === 'application/vnd.ms-excel' || body.original_filename.toLowerCase().endsWith('.csv')) {
    const text = Buffer.from(body.file_data, 'base64').toString('utf-8');
    const { headers, rows } = parseCSV(text);
    if (headers.length === 0 || rows.length === 0) {
      return reply.status(400).send({ error: 'CSV file is empty or invalid' });
    }
    const colMap = mapCSVHeaders(headers);
    for (const row of rows) {
      const productName = colMap.product_name >= 0 ? row[colMap.product_name] : '';
      if (!productName) continue;
      const quantityRaw = colMap.quantity >= 0 ? row[colMap.quantity] : undefined;
      const qty = quantityRaw ? parseInt(quantityRaw.replace(/[^0-9]/g, ''), 10) : 1;
      items.push({ name: productName, quantity: isNaN(qty) ? 1 : qty });
    }
  } else if (mimeType.startsWith('image/') || mimeType === 'application/pdf') {
    try {
      const result = await extractInventory(body.file_data, mimeType);
      if (result.type === 'inventory' && result.inventory && result.inventory.length > 0) {
        for (const item of result.inventory) {
          const name = item.product_name ?? item.description ?? '';
          if (!name) continue;
          items.push({ name, quantity: item.quantity ?? 1 });
        }
      } else {
        return reply.status(422).send({ error: 'Could not extract items from file', raw: (result as any).raw_text });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  } else {
    return reply.status(400).send({ error: 'Unsupported file type. Please upload CSV, PDF, or image.' });
  }

  if (items.length === 0) {
    return reply.status(422).send({ error: 'No items could be extracted from the file.' });
  }

  // Generate REPL reference number: REPL-YYYYMMDD-XXXX
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randSuffix = Math.random().toString(36).toUpperCase().slice(2, 6);
  const replRef = body.label
    ? `REPL-${dateStr}-${randSuffix} — ${body.label.trim()}`
    : `REPL-${dateStr}-${randSuffix}`;

  // Create order directly at production_pending — no deposit, no purchasing needed
  const orderRows = await query(
    `INSERT INTO orders (quotation_number, order_type, current_stage, status, production_started, order_confirmed_at)
     VALUES ($1, 'stock_replenishment', 'production_pending', 'active', FALSE, NOW())
     RETURNING *`,
    [replRef]
  );
  const newOrder = orderRows[0];

  // Insert extracted items
  for (const item of items) {
    await query(
      `INSERT INTO order_items (order_id, name, quantity, production_status, en_route_status)
       VALUES ($1, $2, $3, 'pending', 'not_yet')`,
      [newOrder.id, item.name, item.quantity]
    );
  }

  // Log creation
  await query(
    `INSERT INTO production_update_logs (order_id, note, log_type, created_by)
     VALUES ($1, $2, 'agent', $3)`,
    [newOrder.id,
      `📦 Stock replenishment order created with ${items.length} item(s): ${items.map((i) => `${i.name} ×${i.quantity}`).join(', ')}`,
      userEmail ?? 'Dashboard']
  );

  // Trigger only production agent (no collection/deposit flow for replenishment)
  setImmediate(() => {
    runAgentByName('production-agent').catch(() => {});
  });

  await notifyManualChange(
    '📦 Stock replenishment order created',
    `Reference: *${replRef}*\nItems: ${items.length}\nFile: ${body.original_filename}`,
    userEmail,
  );

  if (PRODUCTION_CHAT_ID) {
    setImmediate(() => {
      notifyGroupChat(
        PRODUCTION_CHAT_ID,
        `📦 <b>Stock Replenishment Order Created</b>\n\nRef: <b>${replRef}</b>\n` +
        `Items: ${items.length}\n` +
        items.map((i) => `• ${i.name} ×${i.quantity}`).join('\n')
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', 'calendar:*']);
  broadcastSSE('order_updated', { id: newOrder.id });

  return reply.send({ ok: true, order: newOrder, items_created: items.length, items });
});

app.get('/orders', async () => {
  const cached = await cacheGet<object[]>('orders:all');
  if (cached) return cached;
  const rows = await query(
    `SELECT ${ORDER_LIST_SELECT},
            COALESCE(MAX(r.escalation_level), 0) AS escalation_level
     FROM orders o
     LEFT JOIN reminders r ON r.order_id = o.id AND r.stage = o.current_stage AND r.status = 'active'
     GROUP BY o.id
     ORDER BY o.created_at DESC LIMIT 100`
  );
  await cacheSet('orders:all', rows);
  return rows;
});

app.get('/orders/pending', async () => {
  const cached = await cacheGet<object[]>('orders:pending');
  if (cached) return cached;
  const rows = await query(
    `SELECT ${ORDER_LIST_SELECT},
            COALESCE(MAX(r.escalation_level), 0) AS escalation_level
     FROM orders o
     LEFT JOIN reminders r ON r.order_id = o.id AND r.stage = o.current_stage AND r.status = 'active'
     WHERE o.status = 'active'
     GROUP BY o.id
     ORDER BY o.created_at DESC LIMIT 50`
  );
  await cacheSet('orders:pending', rows);
  return rows;
});

app.get('/orders/partial-production', async (request, reply) => {
  const cacheKey = 'orders:partial_production';
  const cached = await cacheGet<object[]>(cacheKey);
  if (cached) return cached;
  const rows = await query(
    `SELECT ${ORDER_LIST_SELECT},
            COALESCE(MAX(r.escalation_level), 0) AS escalation_level
     FROM orders o
     LEFT JOIN reminders r ON r.order_id = o.id AND r.stage = o.current_stage AND r.status = 'active'
     WHERE o.status = 'active'
       AND (
         -- New item-level partial production (order_items table)
         o.current_stage = 'partial_production'
         -- Legacy JSONB partial production (purchasing_pending with partial_production_items)
         OR (
           o.current_stage = 'purchasing_pending'
           AND o.partial_production_items IS NOT NULL
           AND o.partial_production_items != '[]'::jsonb
         )
       )
     GROUP BY o.id
     ORDER BY o.created_at ASC`
  );
  await cacheSet(cacheKey, rows);
  return rows;
});

app.get('/orders/stage/:stage', async (request, reply) => {
  const params = z.object({ stage: z.string() }).parse(request.params);
  const cacheKey = `orders:stage:${params.stage}`;
  const cached = await cacheGet<object[]>(cacheKey);
  if (cached) return cached;
  const rows = await query(
    `SELECT ${ORDER_LIST_SELECT},
            COALESCE(MAX(r.escalation_level), 0) AS escalation_level
     FROM orders o
     LEFT JOIN reminders r ON r.order_id = o.id AND r.stage = o.current_stage AND r.status = 'active'
     WHERE o.current_stage = $1
     GROUP BY o.id
     ORDER BY o.created_at DESC`, [params.stage]
  );
  await cacheSet(cacheKey, rows);
  return rows;
});

// ── Unsynced Payments: orders where balance_paid=TRUE but stage is still balance_due ──
// This catches the gap for orders that were paid before the auto-sync fix was deployed.
app.get('/orders/unsynced-payments', async (request, reply) => {
  const rows = await query(
    `SELECT ${ORDER_LIST_SELECT},
            COALESCE(MAX(r.escalation_level), 0) AS escalation_level
     FROM orders o
     LEFT JOIN reminders r ON r.order_id = o.id AND r.stage = o.current_stage AND r.status = 'active'
     WHERE o.balance_paid = TRUE
       AND o.current_stage = 'balance_due'
       AND o.status = 'active'
     GROUP BY o.id
     ORDER BY o.balance_paid_at DESC`, []
  );
  return rows;
});

// Sync a single unsynced order — update current_stage to payment_received
app.post('/orders/unsynced-payments/sync', async (request, reply) => {
  const { order_id } = z.object({ order_id: z.string() }).parse(request.body);
  const orders = await query(
    `SELECT quotation_number, client_name FROM orders WHERE id=$1`,
    [order_id]
  );
  await query(
    `UPDATE orders SET current_stage='payment_received', updated_at=NOW() WHERE id=$1 AND balance_paid=TRUE AND current_stage='balance_due'`,
    [order_id]
  );
  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by) VALUES ($1, 'payment_received', 'balance_paid', 'Synced from legacy — balance was already paid but stage was not updated', 'dashboard')`,
    [order_id]
  );
  // Notify collection agent immediately that payment is received
  const orderRef = orders[0]?.quotation_number ?? null;
  const clientName = orders[0]?.client_name ?? null;
  triggerAgentsForStage('payment_received', orderRef, clientName);

  await invalidateCache(['dashboard:*', 'orders:*', 'calendar:*', 'sales:*']);
  return { ok: true };
});

// GET /orders/awaiting-downpayment
// Returns all active orders in early stages (quotation_received → deposit_pending)
// where the deposit has NOT been paid yet AND no production exception has been granted.
// This fills the gap where quotation_received orders don't appear in Downpayment Pending.
app.get('/orders/awaiting-downpayment', async (request, reply) => {
  const cacheKey = 'orders:awaiting-downpayment';
  const cached = await cacheGet<object[]>(cacheKey);
  if (cached) return cached;
  const rows = await query(
    `SELECT ${ORDER_LIST_SELECT},
            COALESCE(MAX(r.escalation_level), 0) AS escalation_level
     FROM orders o
     LEFT JOIN reminders r ON r.order_id = o.id AND r.stage = o.current_stage AND r.status = 'active'
     WHERE o.current_stage IN ('quotation_received', 'order_confirmation_received', 'math_verified', 'deposit_pending')
       AND o.deposit_paid = FALSE
       AND (o.production_exception IS NULL OR o.production_exception = FALSE)
       AND o.status = 'active'
     GROUP BY o.id
     ORDER BY o.created_at DESC`, []
  );
  await cacheSet(cacheKey, rows);
  return rows;
});

// GET /orders/production-exception-unpaid (legacy alias — redirects to new endpoint)
app.get('/orders/production-exception-unpaid', async (request, reply) => {
  return reply.redirect('/orders/production-exception-active');
});

// GET /orders/production-exception-active
// Returns ALL orders where a production exception was granted.
// Shown in the Production Exception section until 60 days after delivery is complete.
// Includes full payment/delivery tracking (downpayment, balance, delivery date).
app.get('/orders/production-exception-active', async (request, reply) => {
  const cacheKey = 'orders:production-exception-active';
  const cached = await cacheGet<object[]>(cacheKey);
  if (cached) return cached;
  const rows = await query(
    `SELECT ${ORDER_LIST_SELECT},
            COALESCE(MAX(r.escalation_level), 0) AS escalation_level
     FROM orders o
     LEFT JOIN reminders r ON r.order_id = o.id AND r.stage = o.current_stage AND r.status = 'active'
     WHERE o.production_exception = TRUE
       AND (
         -- Still active in any stage
         o.status = 'active'
         OR
         -- Completed within the last 60 days
         (o.status = 'completed' AND o.updated_at >= NOW() - INTERVAL '60 days')
       )
     GROUP BY o.id
     ORDER BY o.created_at DESC`, []
  );
  await cacheSet(cacheKey, rows);
  return rows;
});

app.get('/orders/picker', async (request, reply) => {
  const { action } = z.object({ action: z.string() }).parse(request.query);

  const whereMap: Record<string, string> = {
    status:       `o.status = 'active'`,
    produce:      `o.status = 'active' AND o.deposit_paid = true AND (o.production_finished IS NULL OR o.production_finished = false)`,
    deposit:      `o.status = 'active' AND (o.deposit_paid IS NULL OR o.deposit_paid = false)`,
    paybalance:   `o.status = 'active' AND o.deposit_paid = true AND (o.balance_paid IS NULL OR o.balance_paid = false)`,
    deliverydate: `o.status = 'active' AND (o.balance_paid = true OR o.delivery_exception = true) AND o.current_stage NOT IN ('delivery_scheduled','delivered','payment_received','payment_confirmed')`,
    delivered:    `o.status = 'active' AND o.current_stage = 'delivery_scheduled'`,
    payment:      `o.status = 'active' AND o.current_stage IN ('delivered','payment_received')`,
    link:         `o.status = 'active'`,
  };

  const where = whereMap[action] ?? `o.status = 'active'`;
  try {
    const rows = await query(
      `SELECT o.id, o.quotation_number, o.client_name, o.current_stage
       FROM orders o
       WHERE ${where}
       ORDER BY o.updated_at DESC LIMIT 10`
    );
    return rows;
  } catch (err: any) {
    reply.status(500).send({ error: err.message });
  }
});

app.get('/orders/:quotation_number', async (request, reply) => {
  const params = z.object({ quotation_number: z.string() }).parse(request.params);
  const cacheKey = `order:detail:${params.quotation_number}`;
  const cached = await cacheGet<object>(cacheKey);
  if (cached) return cached;
  const rows = await query(
    `SELECT o.*, COALESCE(MAX(r.escalation_level), 0) AS escalation_level
     FROM orders o
     LEFT JOIN reminders r ON r.order_id = o.id AND r.stage = o.current_stage AND r.status = 'active'
     WHERE o.quotation_number = $1
     GROUP BY o.id`,
    [params.quotation_number]
  );
  if (!rows[0]) return reply.code(404).send({ error: 'Order not found' });

  const order = rows[0];

  // Fetch files and stage updates in parallel
  const [files, stageUpdates] = await Promise.all([
    query(
      `SELECT id, order_id, file_type, original_filename, storage_backend, local_file_path, mime_type, extracted_text, created_at
       FROM files WHERE order_id = $1 ORDER BY created_at DESC`,
      [order.id]
    ),
    query(
      `SELECT id, order_id, stage, status, remarks, updated_by, created_at
       FROM stage_updates WHERE order_id = $1 ORDER BY created_at DESC`,
      [order.id]
    ),
  ]);

  const result = { ...order, files: files ?? [], stage_updates: stageUpdates ?? [] };
  await cacheSet(cacheKey, result);
  return result;
});

// ── Update Order (requires action token) ────────────────────────────
const updateOrderSchema = z.object({
  client_name: z.string().optional(),
  sales_agent: z.string().optional(),
  total_amount: z.number().optional(),
  quotation_number: z.string().optional(),
  delivery_date: z.string().nullable().optional(),
  delivery_exception: z.boolean().optional(),
  delivery_exception_notes: z.string().nullable().optional(),
  delivery_address: z.string().nullable().optional(),
  contact_number: z.string().nullable().optional(),
  authorized_receiver_name: z.string().nullable().optional(),
  authorized_receiver_contact: z.string().nullable().optional(),
  deposit_paid_at: z.string().nullable().optional(),
  balance_paid_at: z.string().nullable().optional(),
  total_amount_change_reason: z.string().trim().min(3).optional(),
  action_token: z.string(),
});

app.patch('/orders/:id', async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = updateOrderSchema.parse(request.body);

  // Verify action token and extract email (dashboard only; bot calls may omit)
  let userEmail: string | null = null;
  if (body.action_token) {
    if (!cacheClient?.isOpen) {
      return reply.status(503).send({ error: 'Action verification unavailable' });
    }
    const tokenKey = `action_token:${body.action_token}`;
    const tokenData = await cacheClient.get(tokenKey);
    if (!tokenData) {
      return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    }
    await cacheClient.del(tokenKey);
    try {
      const tokenPayload = JSON.parse(tokenData);
      userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
    } catch { /* non-fatal */ }
  }

  const existingRows = await query(
    `SELECT id, quotation_number, client_name, total_amount, computed_amount
     FROM orders WHERE id = $1`,
    [params.id],
  );
  if (!existingRows[0]) return reply.code(404).send({ error: 'Order not found' });
  const existingOrder = existingRows[0];
  const amountIsChanging =
    body.total_amount !== undefined &&
    Number(existingOrder.total_amount ?? 0) !== Number(body.total_amount);
  if (amountIsChanging && !body.total_amount_change_reason?.trim()) {
    return reply.status(400).send({ error: 'Reason is required when changing the order total amount.' });
  }

  const recomputedMathStatus = (() => {
    if (body.total_amount === undefined) return null;
    const total = Number(body.total_amount);
    const computed = existingOrder.computed_amount != null ? Number(existingOrder.computed_amount) : null;
    if (computed === null || Number.isNaN(computed)) return 'pending';
    return Math.abs(total - computed) <= 0.01 ? 'verified' : 'failed';
  })();

  // Build SET clause dynamically
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;
  if (body.client_name !== undefined) { fields.push(`client_name=$${idx++}`); values.push(body.client_name); }
  if (body.sales_agent !== undefined) { fields.push(`sales_agent=$${idx++}`); values.push(body.sales_agent); }
  if (body.total_amount !== undefined) {
    fields.push(`total_amount=$${idx++}`); values.push(body.total_amount);
    if (recomputedMathStatus) {
      fields.push(`math_status=$${idx++}`); values.push(recomputedMathStatus);
    }
    if (amountIsChanging) {
      fields.push(`total_amount_changed=TRUE`);
      fields.push(`previous_total_amount=$${idx++}`); values.push(existingOrder.total_amount);
      fields.push(`amount_change_reason=$${idx++}`); values.push(body.total_amount_change_reason?.trim());
      fields.push(`amount_changed_at=NOW()`);
      fields.push(`amount_changed_by=$${idx++}`); values.push(userEmail ?? 'dashboard');
    }
  }
  if (body.quotation_number !== undefined) { fields.push(`quotation_number=$${idx++}`); values.push(body.quotation_number); }
  if (body.delivery_date !== undefined) { fields.push(`delivery_date=$${idx++}`); values.push(body.delivery_date); }
  if (body.delivery_exception !== undefined) { fields.push(`delivery_exception=$${idx++}`); values.push(body.delivery_exception); }
  if (body.delivery_exception_notes !== undefined) { fields.push(`delivery_exception_notes=$${idx++}`); values.push(body.delivery_exception_notes); }
  if (body.delivery_address !== undefined) { fields.push(`delivery_address=$${idx++}`); values.push(nullableText(body.delivery_address)); }
  if (body.contact_number !== undefined) { fields.push(`contact_number=$${idx++}`); values.push(nullableText(body.contact_number)); }
  if (body.authorized_receiver_name !== undefined) { fields.push(`authorized_receiver_name=$${idx++}`); values.push(nullableText(body.authorized_receiver_name)); }
  if (body.authorized_receiver_contact !== undefined) { fields.push(`authorized_receiver_contact=$${idx++}`); values.push(nullableText(body.authorized_receiver_contact)); }
  if (body.deposit_paid_at !== undefined) { fields.push(`deposit_paid_at=$${idx++}`); values.push(body.deposit_paid_at); }
  if (body.balance_paid_at !== undefined) { fields.push(`balance_paid_at=$${idx++}`); values.push(body.balance_paid_at); }

  if (fields.length === 0) {
    return reply.status(400).send({ error: 'No fields to update' });
  }

  fields.push(`updated_at=NOW()`);
  values.push(params.id);

  const rows = await query(
    `UPDATE orders SET ${fields.join(', ')} WHERE id=$${idx} RETURNING *`,
    values
  );

  if (!rows[0]) return reply.code(404).send({ error: 'Order not found' });

  if (amountIsChanging) {
    const oldAmount = existingOrder.total_amount != null ? Number(existingOrder.total_amount) : null;
    const newAmount = Number(body.total_amount);
    const computedAmount = existingOrder.computed_amount != null ? Number(existingOrder.computed_amount) : null;
    const mathDetail = computedAmount == null
      ? 'No computed quotation amount is available yet; math status is pending.'
      : `Computed amount: PHP ${computedAmount.toLocaleString()}. Math status: ${recomputedMathStatus}.`;
    await query(
      `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
       VALUES ($1, 'amount_adjustment', 'amount_changed', $2, $3)`,
      [
        params.id,
        `Total amount changed from ${oldAmount == null ? 'N/A' : `PHP ${oldAmount.toLocaleString()}`} to PHP ${newAmount.toLocaleString()}. Reason: ${body.total_amount_change_reason?.trim()}. ${mathDetail}`,
        userEmail ?? 'dashboard',
      ],
    );
    await query(
      `INSERT INTO agent_logs (order_id, agent_name, input, output, status)
       VALUES ($1, 'quotation-checker', $2::jsonb, $3::jsonb, $4)`,
      [
        params.id,
        JSON.stringify({
          source: 'dashboard_amount_edit',
          quotation_number: rows[0].quotation_number,
          previous_total_amount: oldAmount,
          total_amount: newAmount,
          computed_amount: computedAmount,
          reason: body.total_amount_change_reason?.trim(),
        }),
        JSON.stringify({
          math_status: recomputedMathStatus,
          message: mathDetail,
        }),
        recomputedMathStatus === 'verified' ? 'success' : 'needs_review',
      ],
    );
  }

  // Auto-link client if client_name was updated
  if (body.client_name) {
    await autoLinkClientToOrder(params.id, body.client_name);
  }

  // Reverse sync: if delivery_address or contact_number was updated on the order,
  // propagate the changes back to the linked client record
  const hasDeliveryInfoUpdate =
    body.delivery_address !== undefined ||
    body.contact_number !== undefined ||
    body.authorized_receiver_name !== undefined ||
    body.authorized_receiver_contact !== undefined;
  if (hasDeliveryInfoUpdate && rows[0].client_id) {
    const clientUpdateFields: string[] = [];
    const clientUpdateValues: any[] = [];
    let ci = 1;
    if (body.delivery_address !== undefined) { clientUpdateFields.push(`delivery_address=$${ci++}`); clientUpdateValues.push(nullableText(body.delivery_address)); }
    if (body.contact_number !== undefined) { clientUpdateFields.push(`contact_number=$${ci++}`); clientUpdateValues.push(nullableText(body.contact_number)); }
    if (body.authorized_receiver_name !== undefined) { clientUpdateFields.push(`authorized_receiver_name=$${ci++}`); clientUpdateValues.push(nullableText(body.authorized_receiver_name)); }
    if (body.authorized_receiver_contact !== undefined) { clientUpdateFields.push(`authorized_receiver_contact=$${ci++}`); clientUpdateValues.push(nullableText(body.authorized_receiver_contact)); }
    if (clientUpdateFields.length > 0) {
      clientUpdateFields.push(`updated_at=NOW()`);
      clientUpdateValues.push(rows[0].client_id);
      await query(
        `UPDATE clients SET ${clientUpdateFields.join(', ')} WHERE id=$${ci}`,
        clientUpdateValues
      );
    }
  }

  // If delivery_date was updated, also record a stage update audit trail
  if (body.delivery_date !== undefined) {
    const orderRecord = rows[0];
    const wasAlreadyScheduled = orderRecord.current_stage === 'delivery_scheduled';
    const status = wasAlreadyScheduled ? 'rescheduled' : 'scheduled';
    const formattedDate = body.delivery_date;
    const auditRemarks = [
      `${wasAlreadyScheduled ? 'Delivery rescheduled' : 'Delivery scheduled'} for ${formattedDate}`,
    ].filter(Boolean).join(' | ');
    await query(
      `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        params.id,
        'delivery_scheduled',
        status,
        auditRemarks,
        userEmail ?? 'dashboard',
      ]
    );
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id: params.id });

  const updatedFields = Object.keys(body).filter((k) => k !== 'action_token' && k !== 'total_amount_change_reason').join(', ');
  const amountChangeLine = amountIsChanging
    ? `
Previous amount: ${existingOrder.total_amount != null ? `PHP ${Number(existingOrder.total_amount).toLocaleString()}` : 'N/A'}
New amount: PHP ${Number(body.total_amount).toLocaleString()}
Reason: ${body.total_amount_change_reason?.trim()}
Math status: ${recomputedMathStatus}`
    : '';
  await notifyManualChange(
    `Order edited via dashboard`,
    `Quotation: *${rows[0].quotation_number ?? params.id}*
Client: ${rows[0].client_name ?? 'N/A'}
Fields changed: ${updatedFields}${amountChangeLine}`,
    userEmail,
  );

  return reply.send(rows[0]);
});

// ── Sync Extracted Data to Existing Order (smart fill-in, no duplicates) ──
// Used by the AI Vision fallback flow: when a user uploads a file to an
// existing order and extracts data, this endpoint merges the extracted fields
// into the order without overwriting existing data.
const syncExtractedSchema = z.object({
  quotation_number: z.string().optional(),
  client_name: z.string().optional(),
  sales_agent: z.string().optional(),
  total_amount: z.number().optional(),
  order_date: z.string().optional(),
  items: z.array(z.object({
    name: z.string().min(1),
    quantity: z.number().int().positive(),
  })).optional(),
  payment: z.object({
    amount: z.number().positive(),
    type: z.enum(['deposit', 'balance', 'full']),
    reference_number: z.string().optional(),
    paid_by: z.string().optional(),
    payment_date: z.string().optional(),
  }).optional(),
  action_token: z.string(),
});

app.post('/orders/:id/sync-extracted', async (request, reply) => {
  try {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = syncExtractedSchema.parse(request.body);

    // Verify action token and extract email
    let userEmail: string | null = null;
    if (!cacheClient?.isOpen) {
      return reply.status(503).send({ error: 'Action verification unavailable' });
    }
    const tokenKey = `action_token:${body.action_token}`;
    const tokenData = await cacheClient.get(tokenKey);
    if (!tokenData) {
      return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    }
    await cacheClient.del(tokenKey);
    try {
      const tokenPayload = JSON.parse(tokenData);
      userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
    } catch { /* non-fatal */ }

    // Fetch existing order
    const orderRows = await query(
      `SELECT id, quotation_number, client_name, sales_agent, total_amount, order_confirmed_at,
              deposit_paid, deposit_amount, balance_paid, balance_paid_at, current_stage
       FROM orders WHERE id=$1`,
      [params.id]
    );
    if (!orderRows[0]) {
      return reply.code(404).send({ error: 'Order not found' });
    }
    const order = orderRows[0];

    const syncReport: {
      order_fields: string[];
      items_added: { name: string; quantity: number }[];
      items_skipped: { name: string; reason: string }[];
      payment_recorded?: { type: string; amount: number };
      payment_skipped?: { type: string; reason: string };
      full_payment?: { depositPortion: number; balancePortion: number; overpayment: number };
    } = {
      order_fields: [],
      items_added: [],
      items_skipped: [],
    };

    // ── 1. Sync scalar fields (only if currently null/empty) ──────────
    const updateFields: string[] = [];
    const updateValues: (string | number | null)[] = [];
    let idx = 1;

    if (body.quotation_number && !order.quotation_number) {
      updateFields.push(`quotation_number=$${idx++}`);
      updateValues.push(body.quotation_number);
      syncReport.order_fields.push('quotation_number');
    }
    if (body.client_name && !order.client_name) {
      updateFields.push(`client_name=$${idx++}`);
      updateValues.push(body.client_name);
      syncReport.order_fields.push('client_name');
      // Auto-link client
      await autoLinkClientToOrder(params.id, body.client_name);
    }
    if (body.sales_agent && !order.sales_agent) {
      updateFields.push(`sales_agent=$${idx++}`);
      updateValues.push(body.sales_agent);
      syncReport.order_fields.push('sales_agent');
    }
    if (body.total_amount != null && order.total_amount == null) {
      updateFields.push(`total_amount=$${idx++}`);
      updateValues.push(body.total_amount);
      syncReport.order_fields.push('total_amount');
    }
    if (body.order_date && !order.order_confirmed_at) {
      updateFields.push(`order_confirmed_at=$${idx++}`);
      updateValues.push(body.order_date);
      syncReport.order_fields.push('order_confirmed_at');
    }

    if (updateFields.length > 0) {
      updateFields.push(`updated_at=NOW()`);
      updateValues.push(params.id);
      await query(
        `UPDATE orders SET ${updateFields.join(', ')} WHERE id=$${idx}`,
        updateValues
      );
    }

    // ── 2. Sync items (merge by name, no duplicates) ──────────────────
    if (body.items && body.items.length > 0) {
      const existingItems = await query(
        `SELECT name, quantity FROM order_items WHERE order_id=$1`,
        [params.id]
      );
      const existingNames = new Set(
        (existingItems as { name: string }[]).map((i) => i.name.toLowerCase().trim())
      );

      for (const item of body.items) {
        const normalizedName = item.name.toLowerCase().trim();
        if (existingNames.has(normalizedName)) {
          syncReport.items_skipped.push({ name: item.name, reason: 'Item already exists' });
          continue;
        }
        await query(
          `INSERT INTO order_items (order_id, name, quantity, production_status, en_route_status)
           VALUES ($1, $2, $3, 'pending', 'not_yet')`,
          [params.id, item.name, item.quantity]
        );
        syncReport.items_added.push({ name: item.name, quantity: item.quantity });
        existingNames.add(normalizedName);
      }

      if (syncReport.items_added.length > 0) {
        await query(
          `INSERT INTO production_update_logs (order_id, note, log_type, created_by)
           VALUES ($1, $2, 'agent', 'Vision AI Sync')`,
          [params.id, `📋 Vision AI sync added ${syncReport.items_added.length} item(s): ${syncReport.items_added.map(i => `${i.name} x${i.quantity}`).join(', ')}`]
        );
      }
    }

    // ── 3. Sync payment (insert into payments table, supports multiples) ──
    if (body.payment) {
      if (body.payment.type === 'deposit') {
        // Insert payment record
        await query(
          `INSERT INTO payments (order_id, type, amount, payment_date, source)
           VALUES ($1, 'deposit', $2, $3, 'ai_sync')`,
          [params.id, body.payment.amount, body.payment.payment_date ?? null]
        );

        const { depositTotal } = await getPaymentTotals(params.id);

        await query(
          `UPDATE orders SET
             deposit_paid=TRUE,
             deposit_verified=FALSE,
             deposit_amount=$1,
             deposit_paid_at=COALESCE($2, deposit_paid_at),
             current_stage=CASE
               WHEN current_stage IN ('quotation_received', 'order_confirmation_received', 'math_verified', 'deposit_pending', 'purchasing_pending', 'production_pending')
               THEN 'deposit_verification'
               ELSE current_stage
             END,
             updated_at=NOW()
           WHERE id=$3`,
          [depositTotal, body.payment.payment_date ?? null, params.id]
        );
        syncReport.payment_recorded = { type: 'deposit', amount: body.payment.amount };

        // Stage updates
        await query(
          `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
           VALUES ($1, 'deposit_pending', 'deposit_paid', $2, $3)`,
          [params.id, `Downpayment of ₱${body.payment.amount} recorded via AI sync (total deposits: ₱${depositTotal.toLocaleString()})`, userEmail ?? 'dashboard']
        );
        await query(
          `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
           VALUES ($1, 'deposit_verification', 'pending', 'Downpayment recorded via AI sync; awaiting verification', $2)`,
          [params.id, userEmail ?? 'dashboard']
        );

        // Complete deposit reminders
        await query(
          `UPDATE reminders SET status='completed', updated_at=NOW()
           WHERE order_id=$1 AND stage='deposit_pending' AND status='active'`,
          [params.id]
        );

        // Notify
        triggerAgentsForStage('deposit_verification', order.quotation_number, order.client_name, userEmail ?? 'dashboard');
      } else if (body.payment.type === 'full') {
        const effectiveTotal = body.total_amount ?? order.total_amount;
        if (effectiveTotal == null) {
          syncReport.payment_skipped = { type: 'full', reason: 'Total amount is required before recording a full payment' };
        } else {
          const full = await recordFullPaymentForOrder({
            orderId: params.id,
            quotationNumber: body.quotation_number ?? order.quotation_number,
            clientName: body.client_name ?? order.client_name,
            totalAmount: Number(effectiveTotal),
            amount: body.payment.amount,
            paymentDate: body.payment.payment_date ?? null,
            referenceNumber: body.payment.reference_number ?? null,
            paidBy: body.payment.paid_by ?? null,
            source: 'ai_sync_full_payment',
            updatedBy: userEmail ?? 'dashboard',
          });
          syncReport.payment_recorded = { type: 'full', amount: body.payment.amount };
          syncReport.full_payment = full;
        }
      } else if (body.payment.type === 'balance') {
        if (!order.deposit_paid) {
          syncReport.payment_skipped = { type: 'balance', reason: 'Deposit must be paid first' };
        } else {
          // Insert payment record
          await query(
            `INSERT INTO payments (order_id, type, amount, payment_date, source)
             VALUES ($1, 'balance', $2, $3, 'ai_sync')`,
            [params.id, body.payment.amount, body.payment.payment_date ?? null]
          );

          const { depositTotal, balanceTotal } = await getPaymentTotals(params.id);
          const expectedBalance = (order.total_amount ?? 0) - depositTotal;
          const isFullyPaid = balanceTotal >= expectedBalance;

          await query(
            `UPDATE orders SET
               balance_paid=$1,
               balance_verified=FALSE,
               balance_paid_at=COALESCE($3, NOW()),
               current_stage=CASE
                 WHEN current_stage IN ('balance_due', 'inventory_arrived', 'delivery_scheduled')
                 THEN 'balance_verification'
                 ELSE current_stage
               END,
               updated_at=NOW()
             WHERE id=$2`,
            [isFullyPaid, params.id, body.payment.payment_date ?? null]
          );
          syncReport.payment_recorded = { type: 'balance', amount: body.payment.amount };

          // Stage updates
          const remarks = isFullyPaid
            ? `Balance of PHP ${body.payment.amount} recorded via AI sync (total: PHP ${balanceTotal.toLocaleString()})`
            : `Partial balance of PHP ${body.payment.amount} recorded via AI sync. Remaining: PHP ${(expectedBalance - balanceTotal).toLocaleString()}`;
          await query(
            `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
             VALUES ($1, 'balance_verification', 'balance_paid', $2, $3)`,
            [params.id, remarks, userEmail ?? 'dashboard']
          );

          if (isFullyPaid) {
            await query(
              `UPDATE reminders SET status='completed', updated_at=NOW()
               WHERE order_id=$1 AND stage IN ('balance_due', 'inventory_arrived') AND status='active'`,
              [params.id]
            );
          }

          // Notify
          triggerAgentsForStage('balance_verification', order.quotation_number, order.client_name, userEmail ?? 'dashboard');
        }
      }
    }

    // Invalidate caches
    await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
    broadcastSSE('order_updated', { id: params.id });

    // Notify
    const changedParts = [
      syncReport.order_fields.length > 0 ? `fields: ${syncReport.order_fields.join(', ')}` : '',
      syncReport.items_added.length > 0 ? `items: +${syncReport.items_added.length}` : '',
      syncReport.payment_recorded ? `payment: ${syncReport.payment_recorded.type} ₱${syncReport.payment_recorded.amount.toLocaleString()}` : '',
    ].filter(Boolean).join('; ');

    if (changedParts) {
      await notifyManualChange(
        `🔄 AI sync: extracted data merged`,
        `Quotation: *${order.quotation_number ?? params.id}*\nClient: ${order.client_name ?? '—'}\nSynced: ${changedParts}`,
        userEmail,
      );
    }

    return reply.send({ ok: true, synced: syncReport });
  } catch (err: any) {
    console.error('[sync-extracted] Error:', err);
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: `Validation error: ${err.errors.map(e => e.message).join(', ')}` });
    }
    return reply.status(500).send({ error: err?.message ?? 'Sync failed' });
  }
});

// ── Delete Order (requires action token) ────────────────────────────
app.delete('/orders/:id', async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = z.object({ action_token: z.string() }).parse(request.body);

  // Verify action token and extract email
  let userEmail: string | null = null;
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  try {
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  } catch { /* non-fatal */ }

  // Delete related records first
  await query(`DELETE FROM stage_updates WHERE order_id=$1`, [params.id]);
  await query(`DELETE FROM files WHERE order_id=$1`, [params.id]);
  await query(`DELETE FROM reminders WHERE order_id=$1`, [params.id]);
  const rows = await query(`DELETE FROM orders WHERE id=$1 RETURNING *`, [params.id]);

  if (!rows[0]) return reply.code(404).send({ error: 'Order not found' });

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_deleted', { id: params.id });

  await notifyManualChange(
    `🗑️ Order deleted via dashboard`,
    `Quotation: *${rows[0].quotation_number ?? params.id}*\nClient: ${rows[0].client_name ?? '—'}`,
    userEmail,
  );

  return reply.send({ ok: true, deleted: rows[0] });
});

// ── Bulk Delete Orders (requires action token) ──────────────────────
app.post('/orders/bulk-delete', async (request, reply) => {
  const body = z.object({
    ids: z.array(z.string()).min(1).max(100),
    action_token: z.string(),
  }).parse(request.body);

  // Verify action token and extract email
  let userEmail: string | null = null;
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  try {
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  } catch { /* non-fatal */ }

  const ids = body.ids;

  // Delete related records using ANY
  await query(`DELETE FROM stage_updates WHERE order_id = ANY($1)`, [ids]);
  await query(`DELETE FROM files WHERE order_id = ANY($1)`, [ids]);
  await query(`DELETE FROM reminders WHERE order_id = ANY($1)`, [ids]);
  const rows = await query<{ id: string; quotation_number: string | null; client_name: string | null }>(
    `DELETE FROM orders WHERE id = ANY($1) RETURNING id, quotation_number, client_name`,
    [ids]
  );

  await invalidateCache(['dashboard:*', 'orders:*', 'order:detail:*', 'calendar:*', 'sales:*']);
  for (const row of rows) {
    broadcastSSE('order_deleted', { id: row.id });
  }

  const names = rows
    .map((r) => r.quotation_number ?? r.id)
    .slice(0, 5)
    .join(', ');
  const more = rows.length > 5 ? ` and ${rows.length - 5} more` : '';

  await notifyManualChange(
    `🗑️ ${rows.length} order(s) deleted via dashboard (bulk)`,
    `Deleted: ${names}${more}`,
    userEmail,
  );

  return reply.send({ ok: true, deleted: rows.length });
});

// ── Production Tracking ─────────────────────────────────────────────

const setProductionSchema = z.object({
  production_started: z.boolean(),
  estimated_production_days: z.number().int().positive().optional(),
  action_token: z.string().optional(),
});

app.post('/orders/:id/set-production', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = setProductionSchema.parse(request.body);

  // Dashboard calls provide an action token. Telegram bot callbacks run server-to-server and may not.
  let userEmail: string | null = null;
  if (body.action_token) {
    if (!cacheClient?.isOpen) {
      return reply.status(503).send({ error: 'Action verification unavailable' });
    }
    const tokenKey = `action_token:${body.action_token}`;
    const tokenData = await cacheClient.get(tokenKey);
    if (!tokenData) {
      return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    }
    await cacheClient.del(tokenKey);
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  }

  const existingRows = await query(
    `SELECT id, quotation_number, current_stage, deposit_verified, production_exception, order_type FROM orders WHERE id = $1`,
    [id]
  );
  if (!existingRows[0]) return reply.code(404).send({ error: 'Order not found' });
  const previousStage = existingRows[0].current_stage;

  // Stock replenishment orders have no deposit — skip the deposit guard entirely
  const isReplenishmentOrder = existingRows[0].order_type === 'stock_replenishment';

  if (body.production_started && !isReplenishmentOrder && !existingRows[0].deposit_verified && !existingRows[0].production_exception) {
    return reply.code(400).send({
      error: 'Cannot start production: downpayment must be verified first, unless a production special-case exception is granted.',
      current_stage: previousStage,
      deposit_verified: existingRows[0].deposit_verified,
      production_exception: existingRows[0].production_exception,
    });
  }

  const setClauses: string[] = ['production_started = $1'];
  const values: any[] = [body.production_started];
  let idx = 2;

  if (body.production_started) {
    setClauses.push(`production_started_at = COALESCE(production_started_at, NOW())`);
    setClauses.push(`current_stage = 'production_in_progress'`);
  }

  if (body.estimated_production_days != null) {
    setClauses.push(`estimated_production_days = $${idx++}`);
    values.push(body.estimated_production_days);
  }

  setClauses.push('updated_at = NOW()');
  values.push(id);

  const rows = await query(
    `UPDATE orders SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  const updatedOrder = rows[0] as any;

  if (body.production_started) {
    // Bulk-update any pending items to in_progress so they appear in production sections
    await query(
      `UPDATE order_items
       SET production_status = 'in_progress',
           updated_at = NOW()
       WHERE order_id = $1 AND production_status = 'pending'`,
      [id]
    );

    await query(
      `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
       VALUES ($1, 'production_in_progress', 'started', $2, 'system')`,
      [id, body.estimated_production_days
        ? `Production started; estimated ${body.estimated_production_days} day(s)`
        : 'Production started']
    );

    if (previousStage && previousStage !== 'production_in_progress') {
      await query(
        `UPDATE reminders SET status='completed', updated_at=NOW()
         WHERE order_id=$1 AND stage=$2 AND status='active'`,
        [id, previousStage]
      );
    }
  }

  if (body.production_started && body.estimated_production_days) {
    const groupChatId = process.env.PRODUCTION_GROUP_CHAT_ID;
    if (groupChatId) {
      const ref = updatedOrder.quotation_number ?? `Order #${id.slice(0, 8)}`;
      const client = updatedOrder.client_name ?? 'Unknown';
      const productionStart = updatedOrder.production_started_at
        ? new Date(updatedOrder.production_started_at)
        : new Date();
      const finishDate = new Date(productionStart);
      finishDate.setDate(finishDate.getDate() + body.estimated_production_days);
      const midpointDays = Math.max(1, Math.floor(body.estimated_production_days / 2));
      const midpointDate = new Date(productionStart);
      midpointDate.setDate(midpointDate.getDate() + midpointDays);

      await query(
        `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
         VALUES ($1, 'production_midpoint', $2, $3, 'once', $4, 'active')
         ON CONFLICT (order_id, stage) WHERE item_id IS NULL DO UPDATE SET
           group_chat_id=EXCLUDED.group_chat_id,
           message=EXCLUDED.message,
           frequency=EXCLUDED.frequency,
           next_run_at=EXCLUDED.next_run_at,
           status='active',
           escalation_level=0,
           updated_at=NOW()`,
        [id, groupChatId,
         `*Midpoint Check* - ${ref} (${client})\nProduction is estimated at ${body.estimated_production_days} days.\nIs this order on time or delayed?`,
         midpointDate.toISOString()]
      );

      await query(
        `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
         VALUES ($1, 'production_due', $2, $3, 'once', $4, 'active')
         ON CONFLICT (order_id, stage) WHERE item_id IS NULL DO UPDATE SET
           group_chat_id=EXCLUDED.group_chat_id,
           message=EXCLUDED.message,
           frequency=EXCLUDED.frequency,
           next_run_at=EXCLUDED.next_run_at,
           status='active',
           escalation_level=0,
           updated_at=NOW()`,
        [id, groupChatId,
         `*Production Due* - ${ref} (${client})\nThe ${body.estimated_production_days}-day production window is now complete.\nDownpayment deposit has been confirmed and verified. Has the production started?`,
         finishDate.toISOString()]
      );
    }
  }

  // Notify production agent immediately that production has started
  if (body.production_started) {
    triggerAgentsForStage('production_in_progress', updatedOrder.quotation_number, updatedOrder.client_name);
  }

  // Notify escalation group about production being started from dashboard
  if (body.production_started) {
    await notifyManualChange(
      'Production started',
      `Quotation: *${updatedOrder.quotation_number ?? 'N/A'}*\nClient: *${updatedOrder.client_name ?? 'Unknown'}*\nEstimated: ${body.estimated_production_days ?? 'N/A'} day(s)`,
      userEmail,
    );
  }

  // Notify production group directly
  if (body.production_started && PRODUCTION_CHAT_ID) {
    const ref = updatedOrder.quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = updatedOrder.client_name ?? 'Unknown';
    setImmediate(() => {
      notifyGroupChat(
        PRODUCTION_CHAT_ID,
        `🏭 <b>Production Started (Dashboard)</b>\n\n` +
        `Quotation: <b>${ref}</b>\n` +
        `Client: ${client}\n` +
        `Estimated: ${body.estimated_production_days ?? 'N/A'} day(s)\n\n` +
        `Production has been started via dashboard. Please proceed.`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${updatedOrder.quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });
  return reply.send({ ok: true, order: updatedOrder });
});

// ── Partial Production ───────────────────────────────────────────────

const partialProductionSchema = z.object({
  missing_items: z.array(z.string().min(1)).min(1),
  action_token: z.string().optional(),
});

app.post('/orders/:id/partial-production', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = partialProductionSchema.parse(request.body);

  // Dashboard calls provide an action token. Telegram item-level callbacks may call this without one.
  let userEmail: string | null = null;
  if (body.action_token) {
    if (!cacheClient?.isOpen) {
      return reply.status(503).send({ error: 'Action verification unavailable' });
    }
    const tokenKey = `action_token:${body.action_token}`;
    const tokenData = await cacheClient.get(tokenKey);
    if (!tokenData) {
      return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    }
    await cacheClient.del(tokenKey);
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  }

  const existingRows = await query(
    `SELECT id, quotation_number, client_name, current_stage FROM orders WHERE id = $1`,
    [id]
  );
  if (!existingRows[0]) return reply.code(404).send({ error: 'Order not found' });
  const order = existingRows[0];

  // If called from production_pending, advance current_stage to partial_production.
  // If already at partial_production (or purchasing_pending legacy path), just update JSONB.
  const advanceToPartial = order.current_stage === 'production_pending';

  await query(
    `UPDATE orders
     SET partial_production_items = $1,
         current_stage = CASE WHEN current_stage = 'production_pending' THEN 'partial_production' ELSE current_stage END,
         updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(body.missing_items), id]
  );

  const stageForLog = advanceToPartial ? 'partial_production' : (order.current_stage as string);
  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, $2, 'partial', $3, 'system')`,
    [id, stageForLog, `Partial production: items pending — ${body.missing_items.join(', ')}`]
  );

  if (advanceToPartial) {
    triggerAgentsForStage('partial_production', order.quotation_number, order.client_name);
  }

  const groupChatId = process.env.PURCHASING_GROUP_ID;
  if (groupChatId) {
    const ref = order.quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = order.client_name ?? 'Unknown';
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    await query(
      `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
       VALUES ($1, 'partial_production', $2, $3, 'daily', $4, 'active')
       ON CONFLICT (order_id, stage) WHERE item_id IS NULL DO UPDATE SET
         group_chat_id=EXCLUDED.group_chat_id,
         message=EXCLUDED.message,
         frequency=EXCLUDED.frequency,
         next_run_at=EXCLUDED.next_run_at,
         status='active',
         escalation_level=0,
         updated_at=NOW()`,
      [id, groupChatId,
       `Partial production check for ${ref} (${client}). Some items are still pending production.`,
       tomorrow.toISOString()]
    );
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });
  return reply.send({ ok: true });
});

const updatePartialItemsSchema = z.object({
  remaining_items: z.array(z.string()),
  action_token: z.string(),
});

app.post('/orders/:id/partial-production-items', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = updatePartialItemsSchema.parse(request.body);

  // Verify action token and extract email
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  const rows = await query(
    `UPDATE orders SET partial_production_items = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [JSON.stringify(body.remaining_items), id]
  );
  if (!rows[0]) return reply.code(404).send({ error: 'Order not found' });
  const order = rows[0];

  if (body.remaining_items.length === 0) {
    await query(
      `UPDATE reminders SET status='completed', updated_at=NOW()
       WHERE order_id=$1 AND stage='partial_production' AND status='active'`,
      [id]
    );
    await query(
      `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
       VALUES ($1, 'purchasing_pending', 'partial_complete', 'All partial production items confirmed produced', 'system')`,
      [id]
    );
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });
  return reply.send({ ok: true, remaining_items: body.remaining_items });
});

// ────────────────────────────────────────────────────────────────────────

const reportProductionStatusSchema = z.object({
  on_time: z.boolean(),
  delay_days: z.number().int().min(0).optional(),
  updated_by: z.string().optional(),
  action_token: z.string(),
});

app.post('/orders/:id/report-production-status', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = reportProductionStatusSchema.parse(request.body);

  // Verify action token and extract email
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  const rows = await query(
    `UPDATE orders SET production_delayed = $1, production_delay_days = $2, updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [!body.on_time, body.delay_days ?? 0, id]
  );

  if (!rows[0]) return reply.code(404).send({ error: 'Order not found' });

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'production_in_progress', $2, $3, 'system')`,
    [id, body.on_time ? 'on_time' : 'delayed',
     body.on_time ? 'Production reported on time' : `Production delayed by ${body.delay_days ?? 0} day(s)`]
  );

  // Notify production agent immediately about the production status update
  triggerAgentsForStage('production_in_progress', rows[0].quotation_number, rows[0].client_name);

  // Notify escalation group about production status report (dashboard only)
  await notifyManualChange(
    body.on_time ? 'Production reported on time' : 'Production reported delayed',
    `Quotation: *${rows[0].quotation_number ?? 'N/A'}*\nClient: *${rows[0].client_name ?? 'Unknown'}*\nStatus: ${body.on_time ? '✅ On time' : '⚠️ Delayed'}${body.delay_days ? `\nDelay: ${body.delay_days} day(s)` : ''}`,
    userEmail,
  );

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${rows[0].quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });
  return reply.send({ ok: true, order: rows[0] });
});

// ── Production Board (GUI for bot) ───────────────────────────────────────
// Returns all active production orders with their items in one call.
// Used by the bot's tap-based production board — no typing needed.

app.get('/production/board', async (_request, reply) => {
  const orders = await query<{
    id: string; quotation_number: string | null; client_name: string | null;
    current_stage: string; production_started: boolean | null; production_finished: boolean | null;
    en_route_confirmed: boolean | null;
    estimated_production_days: number | null; production_started_at: string | null;
  }>(
    `SELECT id, quotation_number, client_name, current_stage,
            production_started, production_finished, en_route_confirmed,
            estimated_production_days, production_started_at
     FROM orders
     WHERE current_stage IN ('production_pending', 'purchasing_pending', 'partial_production', 'production_in_progress', 'en_route')
       AND status = 'active'
     ORDER BY updated_at DESC
     LIMIT 30`,
  );

  const items = orders.length > 0
    ? await query<{
        id: string; order_id: string; name: string; quantity: number;
        production_status: string; en_route_status: string;
      }>(
        `SELECT id, order_id, name, quantity, production_status, en_route_status
         FROM order_items
         WHERE order_id = ANY($1::uuid[])
         ORDER BY created_at ASC`,
        [orders.map((o) => o.id)],
      )
    : [];

  const itemsByOrder = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrder.set(item.order_id, list);
  }

  return reply.send({
    ok: true,
    orders: orders.map((o) => ({
      ...o,
      items: itemsByOrder.get(o.id) ?? [],
    })),
  });
});

// Update item status by 8-char ID prefix (for bot callback data < 64 bytes)
const boardItemUpdateSchema = z.object({
  order_id_prefix: z.string().min(8),
  item_id_prefix: z.string().min(8),
  area: z.enum(['production', 'en_route']).optional().default('production'),
  status: z.enum(['pending', 'in_progress', 'finished']),
});

app.post('/production/board/item', async (request, reply) => {
  const body = boardItemUpdateSchema.parse(request.body);

  const orderRow = await query<{ id: string }>(
    `SELECT id FROM orders WHERE id::text LIKE $1 LIMIT 1`,
    [`${body.order_id_prefix}%`],
  );
  if (!orderRow[0]) return reply.status(404).send({ error: 'Order not found' });
  const orderId = orderRow[0].id;

  const itemRow = await query<{ id: string; name: string; production_status: string; en_route_status: string }>(
    `SELECT id, name, production_status, en_route_status FROM order_items WHERE id::text LIKE $1 AND order_id = $2 LIMIT 1`,
    [`${body.item_id_prefix}%`, orderId],
  );
  if (!itemRow[0]) return reply.status(404).send({ error: 'Item not found' });

  if (body.area === 'en_route') {
    const enRouteStatus = body.status === 'finished' ? 'en_route' : 'not_yet';
    await query(
      `UPDATE order_items SET en_route_status = $1, updated_at = NOW() WHERE id = $2`,
      [enRouteStatus, itemRow[0].id],
    );
  } else {
    await query(
      `UPDATE order_items
       SET production_status = $1,
           production_finished_at = CASE WHEN $1 = 'finished' THEN COALESCE(production_finished_at, NOW()) ELSE NULL END,
           updated_at = NOW()
       WHERE id = $2`,
      [body.status, itemRow[0].id],
    );
  }

  // Recompute completion and maybe advance stage
  const allItems = await query<{ production_status: string; en_route_status: string }>(
    `SELECT production_status, en_route_status FROM order_items WHERE order_id = $1`,
    [orderId],
  );
  const allDone = allItems.length > 0 && allItems.every((i) => i.production_status === 'finished');
  const allEnRoute = allItems.length > 0 && allItems.every((i) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived');

  if (body.area === 'production' && allDone) {
    await finalizeProductionIfAllItemsFinished(
      orderId,
      'production_board',
      'All production board items marked finished; ready for delivery / dispatch.',
    );
  } else if (body.area === 'production' && body.status === 'in_progress') {
    await query(
      `UPDATE orders
       SET production_started = TRUE,
           production_started_at = COALESCE(production_started_at, NOW()),
           current_stage = CASE WHEN current_stage IN ('purchasing_pending', 'production_pending') THEN 'production_in_progress' ELSE current_stage END,
           updated_at = NOW()
       WHERE id = $1`,
      [orderId],
    );
  }

  await invalidateCache(['orders:*', `orders:stage:*`, 'dashboard:*']);
  broadcastSSE('order_updated', { id: orderId });

  return reply.send({ ok: true, item: itemRow[0].name, status: body.status, all_done: allDone, all_en_route: allEnRoute, order_id: orderId });
});

// ── Production Assistant (NLU chat endpoint) ─────────────────────────────
// Called by the bot when a free-text message arrives in the production chat.

const productionChatSchema = z.object({
  text: z.string().min(1).max(2000),
  username: z.string().nullable().optional(),
});

app.post('/production/chat', async (request, reply) => {
  const body = productionChatSchema.parse(request.body);
  const result = await handleProductionChat(body.text, body.username ?? null);
  return reply.send(result);
});

const finishProductionSchema = z.object({
  delivery_estimated_days: z.number().int().positive(),
  updated_by: z.string().optional(),
  action_token: z.string().optional(),
});

app.post('/orders/:id/finish-production', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = finishProductionSchema.parse(request.body);

  // Verify action token and extract email
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  // Check if order has item-level tracking items
  const itemRows = await query(
    `SELECT COUNT(*)::int AS cnt FROM order_items WHERE order_id = $1`,
    [id]
  );
  const hasItems = itemRows[0]?.cnt > 0;

  // For item-level orders, advance to en_route so the en-route dispatch flow
  // (process of elimination) can begin. The stage will advance further to
  // en_route_verification via advanceFromEnRouteToVerificationIfAllDispatched
  // (called from start-en-route-tracking) once all items are confirmed dispatched.
  // For legacy orders (no items), advance to en_route immediately as well.
  const rows = await query(
    `UPDATE orders SET production_finished = TRUE, production_finished_at = NOW(),
     delivery_estimated_days = $1,
     current_stage = 'en_route',
     updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [body.delivery_estimated_days, id]
  );

  if (!rows[0]) return reply.code(404).send({ error: 'Order not found' });

  const nextStage = hasItems ? rows[0].current_stage : 'en_route';
  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, $2, 'production_finished', $3, 'system')`,
    [id, nextStage, `Production finished; delivery availability estimated in ${body.delivery_estimated_days} day(s)`]
  );

  // Complete item-level production reminder if it exists
  await query(
    `UPDATE reminders SET status = 'completed', updated_at = NOW()
     WHERE order_id = $1 AND status = 'active' AND stage = 'item_level_production'`,
    [id]
  );

  // For legacy orders (no items), create an en_route reminder immediately.
  // For item-level orders, skip this — the production agent's checkItemLevelEnRoute
  // will send an immediate question and upsert its own reminder.
  if (!hasItems) {
    const groupChatId = process.env.PRODUCTION_GROUP_CHAT_ID;
    if (groupChatId) {
      const ref = rows[0].quotation_number ?? `Order #${id.slice(0, 8)}`;
      const client = rows[0].client_name ?? 'Unknown';
      const nextRun = new Date();
      nextRun.setHours(nextRun.getHours() + 2); // Remind in 2 hours, not tomorrow
      await query(
        `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
         VALUES ($1, 'en_route_reminder', $2, $3, 'daily', $4, 'active')
         ON CONFLICT (order_id, stage) WHERE item_id IS NULL DO UPDATE SET
           group_chat_id=EXCLUDED.group_chat_id,
           message=EXCLUDED.message,
           frequency=EXCLUDED.frequency,
           next_run_at=EXCLUDED.next_run_at,
           status='active',
           escalation_level=0,
           updated_at=NOW()`,
        [id, groupChatId,
         `🚚 *En Route Check* — ${ref} (${client})\nProduction is finished. Is the order en route to the client?`,
         nextRun.toISOString()]
      );
    }
  }

  // Notify production + inventory agents immediately that production is finished (order is en route)
  triggerAgentsForStage('en_route', rows[0].quotation_number, rows[0].client_name);

  // Notify escalation group about production finished (dashboard only)
  await notifyManualChange(
    'Production finished',
    `Quotation: *${rows[0].quotation_number ?? 'N/A'}*\nClient: *${rows[0].client_name ?? 'Unknown'}*\nDelivery estimated: ${body.delivery_estimated_days} day(s)`,
    userEmail,
  );

  // Notify production group directly (legacy order-level buttons; skip for item-level orders)
  const productionGroupChatId = process.env.PRODUCTION_GROUP_CHAT_ID;
  if (productionGroupChatId && _TELEGRAM_BOT_TOKEN && !hasItems) {
    const ref = rows[0].quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = rows[0].client_name ?? 'Unknown';
    setImmediate(() => {
      fetch(`https://api.telegram.org/bot${_TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: productionGroupChatId,
          text:
            `✅ <b>Production Finished (Dashboard)</b>\n\n` +
            `Quotation: <b>${ref}</b>\n` +
            `Client: ${client}\n` +
            `Delivery estimated: ${body.delivery_estimated_days} day(s)\n\n` +
            `Production has been marked as finished. Order is now in <b>En Route</b> stage awaiting dispatch confirmation.`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Yes, it\'s en route', callback_data: `en_route:yes:${id.slice(0, 8)}:${ref}` },
                { text: '❌ Not yet', callback_data: `en_route:no:${id.slice(0, 8)}:${ref}` },
              ],
            ],
          },
        }),
      }).catch(() => {});
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${rows[0].quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  // Notify early progress if production finished ahead of schedule
  setImmediate(() => {
    notifyEarlyProgress(
      rows[0],
      'finish-production',
      `Production finished via dashboard`,
      userEmail,
    );
  });

  return reply.send({ ok: true, order: rows[0] });
});

const finishAllItemsSchema = z.object({
  action_token: z.string(),
});

// POST /orders/:id/finish-all-items — Bulk finish all items for an order
app.post('/orders/:id/finish-all-items', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = finishAllItemsSchema.parse(request.body);

  // Verify action token
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  // Mark all non-finished items as finished
  await query(
    `UPDATE order_items
     SET production_status = 'finished',
         production_finished_at = COALESCE(production_finished_at, NOW()),
         updated_at = NOW()
     WHERE order_id = $1 AND production_status != 'finished'`,
    [id]
  );

  // Fetch updated items
  const updatedItems = await query(
    `SELECT id, order_id, name, quantity, production_status, en_route_status,
            estimated_arrival_days, estimated_production_days, production_finished_at,
            inventory_verified_at, delivered_qty, delivered_at, created_at, updated_at
     FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
    [id]
  );

  // Finalize order production if all items are finished
  const finalizeResult = await finalizeProductionIfAllItemsFinished(
    id,
    'item_update',
    'Bulk finish all items via dashboard'
  );

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${finalizeResult.order?.quotation_number ?? ''}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  await notifyManualChange(
    'Production finished (bulk)',
    `Quotation: *${finalizeResult.order?.quotation_number ?? 'N/A'}*\nClient: *${finalizeResult.order?.client_name ?? 'Unknown'}*\nAll ${updatedItems.length} item(s) marked finished`,
    userEmail,
  );

  // Notify early progress if production finished ahead of schedule
  if (finalizeResult.order) {
    setImmediate(() => {
      notifyEarlyProgress(
        finalizeResult.order,
        'finish-all-items',
        `All ${updatedItems.length} item(s) marked finished via dashboard`,
        userEmail,
      );
    });
  }

  return reply.send({ ok: true, items: updatedItems, order: finalizeResult.order });
});

const finishSelectedItemsSchema = z.object({
  action_token: z.string(),
  item_ids: z.array(z.string()).min(1),
});

// POST /orders/:id/finish-selected-items — Bulk finish selected items
app.post('/orders/:id/finish-selected-items', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = finishSelectedItemsSchema.parse(request.body);

  // Verify action token (single verification for all items)
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  // Mark only the selected items as finished
  await query(
    `UPDATE order_items
     SET production_status = 'finished',
         production_finished_at = COALESCE(production_finished_at, NOW()),
         updated_at = NOW()
     WHERE order_id = $1 AND id = ANY($2::uuid[]) AND production_status != 'finished'`,
    [id, body.item_ids]
  );

  // Fetch updated items
  const updatedItems = await query(
    `SELECT id, order_id, name, quantity, production_status, en_route_status,
            estimated_arrival_days, estimated_production_days, production_finished_at,
            inventory_verified_at, delivered_qty, delivered_at, created_at, updated_at
     FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
    [id]
  );

  // Finalize order production if all items are now finished
  const finalizeResult = await finalizeProductionIfAllItemsFinished(
    id,
    'item_update',
    `Bulk finish selected items (${body.item_ids.length}) via dashboard`
  );

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${finalizeResult.order?.quotation_number ?? ''}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  await notifyManualChange(
    'Production finished (selected)',
    `Quotation: *${finalizeResult.order?.quotation_number ?? 'N/A'}*\nClient: *${finalizeResult.order?.client_name ?? 'Unknown'}*\n${body.item_ids.length} selected item(s) marked finished${finalizeResult.finalized ? ' — all items done' : ''}`,
    userEmail,
  );

  // Notify early progress if production finished ahead of schedule
  if (finalizeResult.order) {
    setImmediate(() => {
      notifyEarlyProgress(
        finalizeResult.order,
        'finish-selected-items',
        `${body.item_ids.length} selected item(s) marked finished via dashboard`,
        userEmail,
      );
    });
  }

  return reply.send({ ok: true, items: updatedItems, order: finalizeResult.order });
});

const bulkEnRouteSchema = z.object({
  action_token: z.string(),
  default_arrival_days: z.number().int().positive().optional(),
});

const bulkEnRouteSelectedSchema = z.object({
  action_token: z.string(),
  item_ids: z.array(z.string()).min(1),
  default_arrival_days: z.number().int().positive().optional(),
});

// POST /orders/:id/bulk-en-route — Bulk mark all not-yet items as en_route
app.post('/orders/:id/bulk-en-route', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = bulkEnRouteSchema.parse(request.body);

  // Verify action token
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  // Mark all not-yet items as en_route, applying default arrival days if missing
  await query(
    `UPDATE order_items
     SET en_route_status = 'en_route',
         estimated_arrival_days = COALESCE(estimated_arrival_days, $2),
         updated_at = NOW()
     WHERE order_id = $1 AND en_route_status = 'not_yet'`,
    [id, body.default_arrival_days ?? null]
  );

  // Fetch updated items
  const updatedItems = await query(
    `SELECT id, order_id, name, quantity, production_status, en_route_status,
            estimated_arrival_days, estimated_production_days, production_finished_at,
            inventory_verified_at, delivered_qty, delivered_at, created_at, updated_at
     FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
    [id]
  );

  // Check if all items are now dispatched and advance stage if so
  // advanceToEnRouteIfAllDispatched handles stages before en_route (e.g. partial_production → en_route)
  // advanceFromEnRouteToVerificationIfAllDispatched handles en_route → en_route_verification
  const advanceResult = await advanceToEnRouteIfAllDispatched(
    id,
    'item_update',
    'Bulk mark all items en route via dashboard'
  );
  const verificationAdvance = !advanceResult.advanced
    ? await advanceFromEnRouteToVerificationIfAllDispatched(id, 'bulk_en_route', body.default_arrival_days)
    : { advanced: false, order: null };
  const effectiveOrder = advanceResult.order ?? verificationAdvance.order;

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${effectiveOrder?.quotation_number ?? ''}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  await notifyManualChange(
    'En route (bulk)',
    `Quotation: *${effectiveOrder?.quotation_number ?? 'N/A'}*\nClient: *${effectiveOrder?.client_name ?? 'Unknown'}*\nAll items marked en route${verificationAdvance.advanced ? ' — advanced to En Route Verification' : ''}`,
    userEmail,
  );

  // Notify early progress if items are going en route ahead of schedule
  if (effectiveOrder) {
    setImmediate(() => {
      notifyEarlyProgress(
        effectiveOrder,
        'bulk-en-route',
        `All items marked en route via dashboard`,
        userEmail,
      );
    });
  }

  return reply.send({ ok: true, items: updatedItems, order: effectiveOrder });
});

// POST /orders/:id/bulk-en-route-selected — Bulk mark selected items as en_route
app.post('/orders/:id/bulk-en-route-selected', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = bulkEnRouteSelectedSchema.parse(request.body);

  // Verify action token
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  // Mark only the selected items as en_route, applying default arrival days if missing
  await query(
    `UPDATE order_items
     SET en_route_status = 'en_route',
         estimated_arrival_days = COALESCE(estimated_arrival_days, $2),
         updated_at = NOW()
     WHERE order_id = $1 AND id = ANY($3::uuid[]) AND en_route_status = 'not_yet'`,
    [id, body.default_arrival_days ?? null, body.item_ids]
  );

  // Fetch updated items
  const updatedItems = await query(
    `SELECT id, order_id, name, quantity, production_status, en_route_status,
            estimated_arrival_days, estimated_production_days, production_finished_at,
            inventory_verified_at, delivered_qty, delivered_at, created_at, updated_at
     FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
    [id]
  );

  // Check if all items are now dispatched and advance stage if so
  const advanceResult = await advanceToEnRouteIfAllDispatched(
    id,
    'item_update',
    'Bulk mark selected items en route via dashboard'
  );
  const verificationAdvance = !advanceResult.advanced
    ? await advanceFromEnRouteToVerificationIfAllDispatched(id, 'bulk_en_route_selected', body.default_arrival_days)
    : { advanced: false, order: null };
  const effectiveOrder = advanceResult.order ?? verificationAdvance.order;

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${effectiveOrder?.quotation_number ?? ''}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  await notifyManualChange(
    'En route (bulk selected)',
    `Quotation: *${effectiveOrder?.quotation_number ?? 'N/A'}*\nClient: *${effectiveOrder?.client_name ?? 'Unknown'}*\nSelected items marked en route${verificationAdvance.advanced ? ' — advanced to En Route Verification' : ''}`,
    userEmail,
  );

  // Notify early progress if items are going en route ahead of schedule
  if (effectiveOrder) {
    setImmediate(() => {
      notifyEarlyProgress(
        effectiveOrder,
        'bulk-en-route-selected',
        `Selected items marked en route via dashboard`,
        userEmail,
      );
    });
  }

  return reply.send({ ok: true, items: updatedItems, order: effectiveOrder });
});

// POST /orders/:id/bulk-arrive-all — Bulk mark all en_route items as arrived
const bulkArriveAllSchema = z.object({
  action_token: z.string(),
});

app.post('/orders/:id/bulk-arrive-all', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = bulkArriveAllSchema.parse(request.body);

  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  // Mark all non-arrived items as arrived
  await query(
    `UPDATE order_items
     SET en_route_status = 'arrived', updated_at = NOW()
     WHERE order_id = $1 AND en_route_status != 'arrived'`,
    [id]
  );

  const updatedItems = await query(
    `SELECT id, order_id, name, quantity, production_status, en_route_status,
            estimated_arrival_days, estimated_production_days, production_finished_at,
            inventory_verified_at, delivered_qty, delivered_at, created_at, updated_at
     FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
    [id]
  );

  const orderRows = await query(`SELECT * FROM orders WHERE id = $1`, [id]);
  const effectiveOrder = orderRows[0] ?? null;

  // Auto-advance to inventory_verification if all items arrived
  const advanceResult = await advanceToInventoryVerificationIfAllArrived(id, 'bulk_arrive_all');

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${effectiveOrder?.quotation_number ?? ''}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  await notifyManualChange(
    'Arrive All (bulk)',
    `Quotation: *${effectiveOrder?.quotation_number ?? 'N/A'}*\nClient: *${effectiveOrder?.client_name ?? 'Unknown'}*\nAll items marked arrived${advanceResult.advanced ? ' — advanced to Inventory Verification' : ''}`,
    userEmail,
  );

  return reply.send({ ok: true, items: updatedItems, order: advanceResult.order ?? effectiveOrder });
});

// POST /orders/:id/bulk-arrive-selected — Bulk mark selected items as arrived
const bulkArriveSelectedSchema = z.object({
  action_token: z.string(),
  item_ids: z.array(z.string()).min(1),
});

app.post('/orders/:id/bulk-arrive-selected', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = bulkArriveSelectedSchema.parse(request.body);

  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  // Mark only selected items as arrived
  await query(
    `UPDATE order_items
     SET en_route_status = 'arrived', updated_at = NOW()
     WHERE order_id = $1 AND id = ANY($2::uuid[]) AND en_route_status != 'arrived'`,
    [id, body.item_ids]
  );

  const updatedItems = await query(
    `SELECT id, order_id, name, quantity, production_status, en_route_status,
            estimated_arrival_days, estimated_production_days, production_finished_at,
            inventory_verified_at, delivered_qty, delivered_at, created_at, updated_at
     FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
    [id]
  );

  const orderRows = await query(`SELECT * FROM orders WHERE id = $1`, [id]);
  const effectiveOrder = orderRows[0] ?? null;

  // Auto-advance to inventory_verification if all items are now arrived
  const advanceResult = await advanceToInventoryVerificationIfAllArrived(id, 'bulk_arrive_selected');

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${effectiveOrder?.quotation_number ?? ''}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  const names = body.item_ids.length === 1 ? '1 item' : `${body.item_ids.length} items`;
  await notifyManualChange(
    'Arrived (bulk selected)',
    `Quotation: *${effectiveOrder?.quotation_number ?? 'N/A'}*\nClient: *${effectiveOrder?.client_name ?? 'Unknown'}*\n${names} marked arrived${advanceResult.advanced ? ' — advanced to Inventory Verification' : ''}`,
    userEmail,
  );

  return reply.send({ ok: true, items: updatedItems, order: advanceResult.order ?? effectiveOrder });
});

// ── Confirm En Route ──────────────────────────────────────────────────
// After production is finished, the order is in 'en_route' stage awaiting
// dispatch confirmation. When confirmed, this endpoint is called with
// estimated arrival days. The order moves from 'en_route' → 'en_route_verification'
// (all items dispatched, waiting for arrival). The production agent then advances
// to 'inventory_verification' once all items are confirmed arrived.
const confirmEnRouteSchema = z.object({
  estimated_arrival_days: z.number().int().positive(),
  updated_by: z.string().optional(),
  action_token: z.string().optional(),
});

app.post('/orders/:id/confirm-en-route', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = confirmEnRouteSchema.parse(request.body);

  // Verify action token and extract email
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  const rows = await query(
    `UPDATE orders SET en_route_confirmed = TRUE, en_route_confirmed_at = NOW(),
     estimated_arrival_days = $1, current_stage = 'en_route_verification', updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [body.estimated_arrival_days, id]
  );

  if (!rows[0]) return reply.code(404).send({ error: 'Order not found' });

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'en_route_verification', 'en_route_confirmed', $2, 'system')`,
    [id, `En route confirmed; estimated arrival in ${body.estimated_arrival_days} day(s). Verifying all items are dispatched.`]
  );

  // Complete legacy en-route reminders — item-level tracking reminders stay active
  // so the production agent can continue monitoring item arrival progress
  await query(
    `UPDATE reminders SET status = 'completed', updated_at = NOW()
     WHERE order_id = $1 AND status = 'active' AND stage = 'en_route_reminder'`,
    [id]
  );

  // Notify production agent immediately to monitor arrival of dispatched items
  triggerAgentsForStage('en_route_verification', rows[0].quotation_number, rows[0].client_name);

  // Notify escalation group about en route confirmation (dashboard only)
  await notifyManualChange(
    'En route confirmed',
    `Quotation: *${rows[0].quotation_number ?? 'N/A'}*\nClient: *${rows[0].client_name ?? 'Unknown'}*\nEstimated arrival: ${body.estimated_arrival_days} day(s)`,
    userEmail,
  );

  // Notify production group directly
  const prodChatId = process.env.PRODUCTION_CHAT_ID;
  if (prodChatId) {
    const ref = rows[0].quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = rows[0].client_name ?? 'Unknown';
    setImmediate(() => {
      notifyGroupChat(
        prodChatId,
        `🚚 <b>En Route Confirmed (Dashboard)</b>\n\n` +
        `Quotation: <b>${ref}</b>\n` +
        `Client: ${client}\n` +
        `Estimated arrival: ${body.estimated_arrival_days} day(s)\n\n` +
        `Order is en route. Verifying all items are dispatched before inventory check.`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${rows[0].quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  // Notify early progress if en route confirmed ahead of schedule
  setImmediate(() => {
    notifyEarlyProgress(
      rows[0],
      'confirm-en-route',
      `En route confirmed with estimated arrival in ${body.estimated_arrival_days} day(s)`,
      userEmail,
    );
  });

  return reply.send({ ok: true, order: rows[0] });
});

// ── Complete Production (Partial) ──────────────────────────────────────
// Allows advancing from production stages to 'en_route' even when some
// items are not yet finished. Sets partial_production_items for tracking.
const completeProductionPartialSchema = z.object({
  action_token: z.string(),
  delivery_estimated_days: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

app.post('/orders/:id/complete-production-partial', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = completeProductionPartialSchema.parse(request.body);

  // Verify action token
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  let tokenData: string | null;
  try {
    tokenData = await cacheClient.get(tokenKey);
  } catch (err) {
    console.error('[complete-production-partial] Redis get error:', err);
    return reply.status(503).send({ error: 'Action verification service error' });
  }
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey).catch(() => {});
  let tokenPayload: Record<string, unknown>;
  try {
    tokenPayload = JSON.parse(tokenData);
  } catch {
    return reply.status(401).send({ error: 'Invalid action token data. Please verify OTP again.' });
  }
  const userEmail: string | null = (tokenPayload.name ?? tokenPayload.email ?? null) as string | null;

  const orderRows = await query(
    `SELECT id, current_stage, quotation_number, client_name, production_started, production_finished
     FROM orders WHERE id = $1`,
    [id]
  );
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });
  const order = orderRows[0];

  // Only allow from production stages (not yet en_route)
  const allowedStages = ['production_in_progress', 'partial_production', 'production_pending'];
  if (!allowedStages.includes(order.current_stage)) {
    return reply.code(400).send({
      error: `Cannot complete production partial in stage '${order.current_stage}'. Allowed stages: ${allowedStages.join(', ')}.`,
    });
  }

  // Check that at least SOME items are finished
  const itemCheck = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE production_status = 'finished')::int AS finished
     FROM order_items WHERE order_id = $1`,
    [id]
  );

  if (itemCheck[0] && itemCheck[0].total > 0 && itemCheck[0].finished === 0) {
    return reply.code(400).send({
      error: 'Cannot complete production partial: no items have been finished yet. Finish at least some items first.',
      total_items: itemCheck[0].total,
      finished_items: 0,
    });
  }

  // Get unfinished item names for tracking
  const unfinishedItems = await query<{ name: string }>(
    `SELECT name FROM order_items
     WHERE order_id = $1 AND (production_status IS NULL OR production_status != 'finished')`,
    [id]
  );
  const unfinishedNames = unfinishedItems.map((i) => i.name);

  // Mark order as production finished and advance to en_route
  const deliveryDays = body.delivery_estimated_days ?? 28;
  const rows = await query(
    `UPDATE orders SET
      production_started = TRUE,
      production_started_at = COALESCE(production_started_at, NOW()),
      production_finished = TRUE,
      production_finished_at = COALESCE(production_finished_at, NOW()),
      delivery_estimated_days = $1,
      partial_production_items = $2::jsonb,
      current_stage = 'en_route',
      updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [deliveryDays, JSON.stringify(unfinishedNames), id]
  );
  if (!rows[0]) return reply.code(500).send({ error: 'Failed to update order' });

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'en_route', 'production_finished_partial', $2, 'system')`,
    [id, `Partial production completion: ${itemCheck[0].finished}/${itemCheck[0].total} items finished. ${unfinishedNames.length} item(s) pending: ${unfinishedNames.join(', ') || 'none'}. Notes: ${body.notes ?? 'N/A'}`]
  );

  // Complete production reminders
  await query(
    `UPDATE reminders SET status = 'completed', updated_at = NOW()
     WHERE order_id = $1 AND status = 'active'
       AND stage IN ('partial_production', 'item_level_production', 'production_pending', 'production_midpoint', 'production_due')`,
    [id]
  );

  // Fire agents for en_route stage
  triggerAgentsForStage('en_route', order.quotation_number, order.client_name);

  // Notify escalation group
  await notifyManualChange(
    'Production finished (partial)',
    `Quotation: *${order.quotation_number ?? 'N/A'}*\nClient: *${order.client_name ?? 'Unknown'}*\nAdvanced to: En Route (Partial)\nFinished: ${itemCheck[0].finished}/${itemCheck[0].total} items\nPending: ${unfinishedNames.join(', ') || 'None'}`,
    userEmail,
  );

  // Notify production group
  const PRODUCTION_CHAT_ID = process.env.PRODUCTION_CHAT_ID;
  if (PRODUCTION_CHAT_ID) {
    const ref = order.quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = order.client_name ?? 'Unknown';
    setImmediate(() => {
      notifyGroupChat(
        PRODUCTION_CHAT_ID,
        `⚠️ <b>Partial Production Complete (Dashboard)</b>\n\n` +
        `Order: <b>#${ref}</b>\n` +
        `Client: ${client}\n\n` +
        `<b>Production Status</b>\n` +
        `- Finished: ${itemCheck[0].finished}/${itemCheck[0].total} items\n` +
        `- Pending: ${unfinishedNames.join(', ') || 'None'}\n\n` +
        `⚠️ Order advanced to En Route with partial production.\n` +
        `Pending items will be tracked for later completion.`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  return reply.send({
    ok: true,
    message: `Partial production completed. Advanced to en_route with ${itemCheck[0].finished}/${itemCheck[0].total} items finished.`,
    finished_items: itemCheck[0].finished,
    total_items: itemCheck[0].total,
    pending_items: unfinishedNames,
  });
});

// ── Complete Dispatch (Partial) ────────────────────────────────────────
// Allows advancing from 'en_route' to 'en_route_verification' even when
// some items are not yet dispatched.
const completeDispatchPartialSchema = z.object({
  action_token: z.string(),
  estimated_arrival_days: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

app.post('/orders/:id/complete-dispatch-partial', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = completeDispatchPartialSchema.parse(request.body);

  // Verify action token
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  let tokenData: string | null;
  try {
    tokenData = await cacheClient.get(tokenKey);
  } catch (err) {
    console.error('[complete-dispatch-partial] Redis get error:', err);
    return reply.status(503).send({ error: 'Action verification service error' });
  }
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey).catch(() => {});
  let tokenPayload: Record<string, unknown>;
  try {
    tokenPayload = JSON.parse(tokenData);
  } catch {
    return reply.status(401).send({ error: 'Invalid action token data. Please verify OTP again.' });
  }
  const userEmail: string | null = (tokenPayload.name ?? tokenPayload.email ?? null) as string | null;

  const orderRows = await query(
    `SELECT id, current_stage, quotation_number, client_name, estimated_arrival_days
     FROM orders WHERE id = $1`,
    [id]
  );
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });
  const order = orderRows[0];

  if (order.current_stage !== 'en_route') {
    return reply.code(400).send({
      error: `Cannot complete dispatch partial in stage '${order.current_stage}'. Order must be in 'en_route' stage.`,
    });
  }

  // Check that at least SOME items are dispatched
  const itemCheck = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE en_route_status = 'en_route' OR en_route_status = 'arrived')::int AS dispatched
     FROM order_items WHERE order_id = $1`,
    [id]
  );

  if (itemCheck[0] && itemCheck[0].total > 0 && itemCheck[0].dispatched === 0) {
    return reply.code(400).send({
      error: 'Cannot complete dispatch partial: no items have been dispatched yet. Dispatch at least some items first.',
      total_items: itemCheck[0].total,
      dispatched_items: 0,
    });
  }

  // Get undelivered item names for tracking
  const undeliveredItems = await query<{ name: string }>(
    `SELECT name FROM order_items
     WHERE order_id = $1 AND (en_route_status IS NULL OR en_route_status = 'not_yet')`,
    [id]
  );
  const undeliveredNames = undeliveredItems.map((i) => i.name);

  // Derive arrival days
  const itemDays = await query<{ estimated_arrival_days: number | null }>(
    `SELECT estimated_arrival_days FROM order_items
     WHERE order_id = $1 AND estimated_arrival_days IS NOT NULL
     ORDER BY estimated_arrival_days DESC LIMIT 1`,
    [id]
  );
  const arrivalDays = body.estimated_arrival_days
    ?? (itemDays[0]?.estimated_arrival_days)
    ?? order.estimated_arrival_days
    ?? 28;

  // Advance to en_route_verification
  const rows = await query(
    `UPDATE orders SET
      en_route_confirmed = TRUE,
      en_route_confirmed_at = NOW(),
      estimated_arrival_days = $1,
      current_stage = 'en_route_verification',
      updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [arrivalDays, id]
  );
  if (!rows[0]) return reply.code(500).send({ error: 'Failed to update order' });

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'en_route_verification', 'dispatch_partial', $2, 'system')`,
    [id, `Partial dispatch completion: ${itemCheck[0].dispatched}/${itemCheck[0].total} items dispatched. ${undeliveredNames.length} item(s) pending: ${undeliveredNames.join(', ') || 'none'}. Est. arrival: ${arrivalDays}d. Notes: ${body.notes ?? 'N/A'}`]
  );

  // Complete en_route reminders
  await query(
    `UPDATE reminders SET status = 'completed', updated_at = NOW()
     WHERE order_id = $1 AND status = 'active' AND stage = 'en_route_reminder'`,
    [id]
  );

  // Fire agents for en_route_verification
  triggerAgentsForStage('en_route_verification', order.quotation_number, order.client_name);

  // Notify escalation group
  await notifyManualChange(
    'Dispatch confirmed (partial)',
    `Quotation: *${order.quotation_number ?? 'N/A'}*\nClient: *${order.client_name ?? 'Unknown'}*\nAdvanced to: En Route Verification (Partial)\nDispatched: ${itemCheck[0].dispatched}/${itemCheck[0].total} items\nPending: ${undeliveredNames.join(', ') || 'None'}`,
    userEmail,
  );

  // Notify production group
  const PRODUCTION_CHAT_ID = process.env.PRODUCTION_CHAT_ID;
  if (PRODUCTION_CHAT_ID) {
    const ref = order.quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = order.client_name ?? 'Unknown';
    setImmediate(() => {
      notifyGroupChat(
        PRODUCTION_CHAT_ID,
        `⚠️ <b>Partial Dispatch Complete (Dashboard)</b>\n\n` +
        `Order: <b>#${ref}</b>\n` +
        `Client: ${client}\n\n` +
        `<b>Dispatch Status</b>\n` +
        `- Dispatched: ${itemCheck[0].dispatched}/${itemCheck[0].total} items\n` +
        `- Pending: ${undeliveredNames.join(', ') || 'None'}\n` +
        `- Est. arrival: ${arrivalDays} day(s)\n\n` +
        `⚠️ Order advanced to En Route Verification with partial dispatch.\n` +
        `Pending items will be tracked for later dispatch.`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  return reply.send({
    ok: true,
    message: `Partial dispatch completed. Advanced to en_route_verification with ${itemCheck[0].dispatched}/${itemCheck[0].total} items dispatched.`,
    dispatched_items: itemCheck[0].dispatched,
    total_items: itemCheck[0].total,
    pending_items: undeliveredNames,
  });
});

// ── Complete Arrival (Partial) ─────────────────────────────────────────
// Allows advancing from 'en_route_verification' to 'inventory_verification'
// even when some items have not yet arrived.
const completeArrivalPartialSchema = z.object({
  action_token: z.string(),
  notes: z.string().optional(),
});

app.post('/orders/:id/complete-arrival-partial', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = completeArrivalPartialSchema.parse(request.body);

  // Verify action token
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  let tokenData: string | null;
  try {
    tokenData = await cacheClient.get(tokenKey);
  } catch (err) {
    console.error('[complete-arrival-partial] Redis get error:', err);
    return reply.status(503).send({ error: 'Action verification service error' });
  }
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey).catch(() => {});
  let tokenPayload: Record<string, unknown>;
  try {
    tokenPayload = JSON.parse(tokenData);
  } catch {
    return reply.status(401).send({ error: 'Invalid action token data. Please verify OTP again.' });
  }
  const userEmail: string | null = (tokenPayload.name ?? tokenPayload.email ?? null) as string | null;

  const orderRows = await query(
    `SELECT id, current_stage, quotation_number, client_name
     FROM orders WHERE id = $1`,
    [id]
  );
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });
  const order = orderRows[0];

  if (order.current_stage !== 'en_route_verification') {
    return reply.code(400).send({
      error: `Cannot complete arrival partial in stage '${order.current_stage}'. Order must be in 'en_route_verification' stage.`,
    });
  }

  // Check that at least SOME items have arrived
  const itemCheck = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE en_route_status = 'arrived')::int AS arrived
     FROM order_items WHERE order_id = $1`,
    [id]
  );

  if (itemCheck[0] && itemCheck[0].total > 0 && itemCheck[0].arrived === 0) {
    return reply.code(400).send({
      error: 'Cannot complete arrival partial: no items have arrived yet. Mark at least some items as arrived first.',
      total_items: itemCheck[0].total,
      arrived_items: 0,
    });
  }

  // Get not-yet-arrived item names for tracking
  const notArrivedItems = await query<{ name: string }>(
    `SELECT name FROM order_items
     WHERE order_id = $1 AND (en_route_status IS NULL OR en_route_status != 'arrived')`,
    [id]
  );
  const notArrivedNames = notArrivedItems.map((i) => i.name);

  // Advance to inventory_verification
  const rows = await query(
    `UPDATE orders SET
      current_stage = 'inventory_verification',
      updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id]
  );
  if (!rows[0]) return reply.code(500).send({ error: 'Failed to update order' });

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'inventory_verification', 'arrival_partial', $2, 'system')`,
    [id, `Partial arrival completion: ${itemCheck[0].arrived}/${itemCheck[0].total} items arrived. ${notArrivedNames.length} item(s) pending: ${notArrivedNames.join(', ') || 'none'}. Notes: ${body.notes ?? 'N/A'}`]
  );

  // Complete en_route arrival reminders
  await query(
    `UPDATE reminders SET status = 'completed', updated_at = NOW()
     WHERE order_id = $1 AND status = 'active' AND stage IN ('en_route_arrival', 'en_route_midpoint')`,
    [id]
  );

  // Fire agents for inventory_verification
  triggerAgentsForStage('inventory_verification', order.quotation_number, order.client_name);

  // Notify escalation group
  await notifyManualChange(
    'Arrival confirmed (partial)',
    `Quotation: *${order.quotation_number ?? 'N/A'}*\nClient: *${order.client_name ?? 'Unknown'}*\nAdvanced to: Inventory Verification (Partial)\nArrived: ${itemCheck[0].arrived}/${itemCheck[0].total} items\nPending: ${notArrivedNames.join(', ') || 'None'}`,
    userEmail,
  );

  // Notify inventory group
  const INVENTORY_GROUP_CHAT_ID = process.env.INVENTORY_GROUP_CHAT_ID;
  if (INVENTORY_GROUP_CHAT_ID) {
    const ref = order.quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = order.client_name ?? 'Unknown';
    setImmediate(() => {
      notifyGroupChat(
        INVENTORY_GROUP_CHAT_ID,
        `⚠️ <b>Partial Arrival Complete (Dashboard)</b>\n\n` +
        `Order: <b>#${ref}</b>\n` +
        `Client: ${client}\n\n` +
        `<b>Arrival Status</b>\n` +
        `- Arrived: ${itemCheck[0].arrived}/${itemCheck[0].total} items\n` +
        `- Pending: ${notArrivedNames.join(', ') || 'None'}\n\n` +
        `⚠️ Order advanced to Inventory Verification with partial arrival.\n` +
        `Pending items will be tracked for later arrival.`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  return reply.send({
    ok: true,
    message: `Partial arrival completed. Advanced to inventory_verification with ${itemCheck[0].arrived}/${itemCheck[0].total} items arrived.`,
    arrived_items: itemCheck[0].arrived,
    total_items: itemCheck[0].total,
    pending_items: notArrivedNames,
  });
});

// ── Start En Route Tracking ────────────────────────────────────────────
// Called by the bot when all items are confirmed en route with a days estimate.
// Does NOT advance the order stage — stays at 'en_route'.
// Creates two timed reminders:
//   • en_route_midpoint — fires at NOW() + floor(days/2), asks if still on track
//   • en_route_arrival  — fires at NOW() + days, asks in inventory group if arrived

/**
 * Compute a UTC timestamp for the next 10:00 AM or 4:00 PM PHT (UTC+8)
 * at or after `NOW() + days days`.
 */
function nextPhtReminderTimeAfterDays(days: number): Date {
  const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
  const targetDate = new Date(Date.now() + days * 86_400_000);
  const phtTarget = new Date(targetDate.getTime() + PHT_OFFSET_MS);
  phtTarget.setUTCMinutes(0, 0, 0);
  const phtHour = phtTarget.getUTCHours();
  if (phtHour < 10) {
    phtTarget.setUTCHours(10);
  } else if (phtHour < 16) {
    phtTarget.setUTCHours(16);
  } else {
    phtTarget.setUTCDate(phtTarget.getUTCDate() + 1);
    phtTarget.setUTCHours(10);
  }
  return new Date(phtTarget.getTime() - PHT_OFFSET_MS);
}

const startEnRouteTrackingSchema = z.object({
  estimated_inventory_arrival_days: z.number().int().positive(),
});

app.post('/orders/:id/start-en-route-tracking', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = startEnRouteTrackingSchema.parse(request.body);
  const days = body.estimated_inventory_arrival_days;

  const orderRows = await query(
    `UPDATE orders
     SET inventory_en_route_at = COALESCE(inventory_en_route_at, NOW()),
         estimated_inventory_arrival_days = $1,
         updated_at = NOW()
     WHERE id = $2
     RETURNING id, quotation_number, client_name, inventory_en_route_at`,
    [days, id]
  );
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });
  const order = orderRows[0];

  const midpointDays = Math.max(1, Math.floor(days / 2));
  const midpointAt = nextPhtReminderTimeAfterDays(midpointDays);
  const arrivalAt = nextPhtReminderTimeAfterDays(days);

  const prodGroupChatId = process.env.PRODUCTION_GROUP_CHAT_ID;
  const deliveryChatId = process.env.DELIVERY_GROUP_CHAT_ID;

  if (prodGroupChatId) {
    await query(
      `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
       VALUES ($1, 'en_route_midpoint', $2, $3, 'once', $4, 'active')
       ON CONFLICT (order_id, stage) WHERE item_id IS NULL DO UPDATE SET
         group_chat_id = EXCLUDED.group_chat_id,
         message       = EXCLUDED.message,
         next_run_at   = EXCLUDED.next_run_at,
         status        = 'active',
         updated_at    = NOW()`,
      [
        id, prodGroupChatId,
        `✅ En Route Midpoint — #${order.quotation_number} (${order.client_name ?? 'Unknown'}). Halfway through the estimated arrival window. Is the shipment still on track?`,
        midpointAt.toISOString(),
      ]
    );
  }

  if (deliveryChatId) {
    await query(
      `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
       VALUES ($1, 'en_route_arrival', $2, $3, 'once', $4, 'active')
       ON CONFLICT (order_id, stage) WHERE item_id IS NULL DO UPDATE SET
         group_chat_id = EXCLUDED.group_chat_id,
         message       = EXCLUDED.message,
         next_run_at   = EXCLUDED.next_run_at,
         status        = 'active',
         updated_at    = NOW()`,
      [
        id, deliveryChatId,
        `📦 En Route Arrival — #${order.quotation_number} (${order.client_name ?? 'Unknown'}). Estimated arrival today. Has it arrived at inventory?`,
        arrivalAt.toISOString(),
      ]
    );
  }

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'en_route', 'tracking_started', $2, 'system')`,
    [id, `En route tracking started — midpoint in ${midpointDays} day(s), arrival check in ${days} day(s)`]
  );

  // ── Auto-advance to en_route_verification if all items are dispatched ──
  // This ensures the order stage progresses from en_route → en_route_verification
  // so that the production agent and inventory agent can pick it up for
  // arrival monitoring and inventory verification.
  await advanceFromEnRouteToVerificationIfAllDispatched(
    id,
    'system',
    days,
  );

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`]);
  return reply.send({ ok: true, midpoint_at: midpointAt.toISOString(), arrival_at: arrivalAt.toISOString() });
});

// ── Reschedule a Timed Reminder ────────────────────────────────────────
// Used when: midpoint reports delay → push out arrival reminder.
//            arrival check says "not yet" → reschedule arrival reminder.

const rescheduleReminderSchema = z.object({
  stage: z.string(),
  new_days: z.number().int().positive(),
});

app.patch('/orders/:id/reschedule-reminder', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = rescheduleReminderSchema.parse(request.body);
  const newRunAt = nextPhtReminderTimeAfterDays(body.new_days);

  const result = await query(
    `UPDATE reminders
     SET next_run_at = $1,
         status      = 'active',
         escalation_level = 0,
         updated_at  = NOW()
     WHERE order_id = $2 AND stage = $3 AND item_id IS NULL
     RETURNING id`,
    [newRunAt.toISOString(), id, body.stage]
  );

  if (!result[0]) {
    // Reminder may have been completed — re-insert it
    const orderRow = await query(
      `SELECT quotation_number, client_name,
              COALESCE(DELIVERY_GROUP_CHAT_ID_placeholder, '') AS group_chat_id
       FROM orders WHERE id = $1`,
      [id]
    );
    // Use the DELIVERY_GROUP_CHAT_ID env var for arrival stage
    const chatId = body.stage === 'en_route_arrival'
      ? (process.env.DELIVERY_GROUP_CHAT_ID ?? '')
      : (process.env.PRODUCTION_GROUP_CHAT_ID ?? '');
    if (chatId && orderRow[0]) {
      let reminderMessage: string;
      if (body.stage === 'en_route_arrival') {
        reminderMessage = `📦 En Route Arrival — #${orderRow[0].quotation_number}`;
      } else if (body.stage === 'en_route_verification') {
        reminderMessage = `🔎 En Route Verification — #${orderRow[0].quotation_number}`;
      } else {
        reminderMessage = `📦 En Route Midpoint — #${orderRow[0].quotation_number}`;
      }
      await query(
        `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
         VALUES ($1, $2, $3, $4, 'once', $5, 'active')
         ON CONFLICT (order_id, stage) WHERE item_id IS NULL DO UPDATE SET
           next_run_at = EXCLUDED.next_run_at,
           status = 'active',
           updated_at = NOW()`,
        [id, body.stage, chatId, reminderMessage, newRunAt.toISOString()]
      );
    }
  }

  return reply.send({ ok: true, next_run_at: newRunAt.toISOString() });
});

// ── Inventory Verification Endpoints ──────────────────────────────────

/**
 * POST /orders/:id/inventory-verify-item
 * Mark an order_item as verified (all, partial, or not yet) during inventory_verification stage.
 * Body: { item_id: string, action: 'all' | 'partial' | 'not_yet', verified_qty?: number }
 */

async function adjustInventoryForOrderItem(
  orderId: string,
  orderItemId: string,
  itemName: string,
  quantityDelta: number,
  movementType: 'inventory_verified' | 'inventory_unverified' | 'delivery_deduct' | 'stock_prep_deduct' | 'excess_arrival',
  note: string,
  createdBy: string,
) {
  if (quantityDelta === 0) return;

  const existing = await query<{ id: string; quantity: number }>(
    `SELECT id, quantity FROM inventory_items WHERE lower(product_name) = lower($1) ORDER BY created_at ASC LIMIT 1`,
    [itemName],
  );

  let inventoryItemId: string | null = null;
  let quantityAfter: number | null = null;

  if (existing[0]) {
    inventoryItemId = existing[0].id;
    const updated = await query<{ quantity: number }>(
      `UPDATE inventory_items
       SET quantity = GREATEST(0, quantity + $1), updated_at = NOW()
       WHERE id = $2
       RETURNING quantity`,
      [quantityDelta, inventoryItemId],
    );
    quantityAfter = Number(updated[0]?.quantity ?? 0);
  } else if (quantityDelta > 0) {
    const inserted = await query<{ id: string; quantity: number }>(
      `INSERT INTO inventory_items (product_name, quantity, category)
       VALUES ($1, $2, 'Verified Order Item')
       RETURNING id, quantity`,
      [itemName, quantityDelta],
    );
    inventoryItemId = inserted[0]?.id ?? null;
    quantityAfter = Number(inserted[0]?.quantity ?? quantityDelta);
  }

  // Only insert movement record if we have a valid inventory item to reference.
  // If inventoryItemId is null (no existing item and delta <= 0), skip the movement
  // since there's nothing to trace back to.
  if (inventoryItemId) {
    await query(
      `INSERT INTO inventory_movements
         (inventory_item_id, order_id, order_item_id, item_name, movement_type, quantity_change, quantity_after, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [inventoryItemId, orderId, orderItemId, itemName, movementType, quantityDelta, quantityAfter, note, createdBy],
    );
  }
}

async function deductInventoryForDeliveredOrder(orderId: string, createdBy: string) {
  const items = await query<{ id: string; name: string; quantity: number; delivered_qty: number | null }>(
    `SELECT id, name, quantity, delivered_qty FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
    [orderId],
  );

  for (const item of items) {
    const alreadyDelivered = Number(item.delivered_qty ?? 0);
    const targetDelivered = Number(item.quantity ?? 0);
    // If already partially delivered, only deduct the remaining delta
    const deltaToDeduct = Math.max(0, targetDelivered - alreadyDelivered);
    if (deltaToDeduct <= 0) continue;

    await adjustInventoryForOrderItem(
      orderId,
      item.id,
      item.name,
      -deltaToDeduct,
      'delivery_deduct',
      `Delivered order item deducted from inventory (${deltaToDeduct}/${targetDelivered}).`,
      createdBy,
    );

    await query(
      `UPDATE order_items
       SET delivered_qty = LEAST(quantity, COALESCE(delivered_qty, 0) + $1),
           remaining_qty = GREATEST(0, quantity - LEAST(quantity, COALESCE(delivered_qty, 0) + $1)),
           delivered_at = COALESCE(delivered_at, NOW()),
           updated_at = NOW()
       WHERE id = $2`,
      [deltaToDeduct, item.id],
    );
  }
}

const inventoryVerifyItemSchema = z.object({
  item_id: z.string(),
  action: z.enum(['all', 'partial', 'not_yet']),
  verified_qty: z.number().int().min(0).optional(),
  action_token: z.string().optional(),
  arrived_qty: z.number().int().min(0).optional(),
});

app.post('/orders/:id/inventory-verify-item', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = inventoryVerifyItemSchema.parse(request.body);

  console.log(`[inventory-verify-item] order=${id} item=${body.item_id} action=${body.action} verified_qty=${body.verified_qty} arrived_qty=${body.arrived_qty}`);

  // Verify the order is in inventory_verification or en_route_verification stage
  const orderRows = await query(`SELECT current_stage, quotation_number, client_name FROM orders WHERE id = $1`, [id]);
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });
  if (!['inventory_verification', 'en_route_verification'].includes(orderRows[0].current_stage)) {
    return reply.code(400).send({ error: 'Order is not in inventory verification or en route verification stage' });
  }

  // Get the item
  const itemRows = await query(`SELECT id, name, quantity, verified_qty, arrived_qty, inventory_verified_at FROM order_items WHERE id = $1 AND order_id = $2`, [body.item_id, id]);
  if (!itemRows[0]) return reply.code(404).send({ error: 'Item not found' });

  const item = itemRows[0];
  let newVerifiedQty = item.verified_qty ?? 0;
  console.log(`[inventory-verify-item] item=${item.name} qty=${item.quantity} current_verified=${item.verified_qty}`);

  // If arrived_qty is provided, use it to determine verified_qty and handle excess
  if (body.arrived_qty !== undefined) {
    newVerifiedQty = Math.min(body.arrived_qty, item.quantity);
    if (newVerifiedQty < 0) newVerifiedQty = 0;
  } else {
    switch (body.action) {
      case 'all':
        newVerifiedQty = item.quantity;
        break;
      case 'partial':
        newVerifiedQty = body.verified_qty ?? newVerifiedQty;
        if (newVerifiedQty > item.quantity) newVerifiedQty = item.quantity;
        if (newVerifiedQty < 0) newVerifiedQty = 0;
        break;
      case 'not_yet':
        newVerifiedQty = 0;
        break;
    }
  }

  const previousVerifiedQty = Number(item.verified_qty ?? 0);
  const inventoryDelta = newVerifiedQty - previousVerifiedQty;

  // Update verified_qty and arrived_qty on the item.
  let updateSQL: string;
  let updateParams: any[];

  if (body.arrived_qty !== undefined) {
    updateSQL = `UPDATE order_items
     SET verified_qty = $1,
         arrived_qty = $2,
         inventory_verified_at = CASE WHEN $1 > 0 THEN COALESCE(inventory_verified_at, NOW()) ELSE NULL END,
         updated_at = NOW()
     WHERE id = $3
     RETURNING verified_qty, arrived_qty`;
    updateParams = [newVerifiedQty, body.arrived_qty, body.item_id];
  } else {
    updateSQL = `UPDATE order_items
     SET verified_qty = $1,
         inventory_verified_at = CASE WHEN $1 > 0 THEN COALESCE(inventory_verified_at, NOW()) ELSE NULL END,
         updated_at = NOW()
     WHERE id = $2
     RETURNING verified_qty`;
    updateParams = [newVerifiedQty, body.item_id];
  }

  const updateResult = await query(updateSQL, updateParams);
  console.log(`[inventory-verify-item] updated verified_qty=${updateResult[0]?.verified_qty} delta=${inventoryDelta}`);

  if (inventoryDelta !== 0) {
    await adjustInventoryForOrderItem(
      id,
      body.item_id,
      item.name,
      inventoryDelta,
      inventoryDelta > 0 ? 'inventory_verified' : 'inventory_unverified',
      `Inventory verification adjusted ${item.name}: ${previousVerifiedQty} -> ${newVerifiedQty}.`,
      'inventory-agent',
    );
  }

  // If arrived_qty exceeds item.quantity, add the excess to inventory stock
  if (body.arrived_qty !== undefined && body.arrived_qty > item.quantity) {
    const excessQty = body.arrived_qty - item.quantity;
    await adjustInventoryForOrderItem(
      id,
      body.item_id,
      item.name,
      excessQty,
      'excess_arrival',
      `Excess arrival: ${item.name} — arrived ${body.arrived_qty}, ordered ${item.quantity}. Excess ${excessQty} added to inventory stock.`,
      'inventory-agent',
    );
  }

  // Recalculate overall verification %
  const allItems = await query(
    `SELECT SUM(quantity) as total_qty, SUM(verified_qty) as verified_qty FROM order_items WHERE order_id = $1`,
    [id]
  );
  const totalQty = Number(allItems[0]?.total_qty ?? 0);
  const totalVerified = Number(allItems[0]?.verified_qty ?? 0);
  const verificationPct = totalQty > 0 ? Math.round((totalVerified / totalQty) * 100) : 0;

  // Update order's inventory_verification_pct
  await query(
    `UPDATE orders SET inventory_verification_pct = $1, updated_at = NOW() WHERE id = $2`,
    [verificationPct, id]
  );

  // Log the action
  const actionLabel = body.arrived_qty !== undefined
    ? `arrived ${body.arrived_qty}, verified ${newVerifiedQty}/${item.quantity}${body.arrived_qty > item.quantity ? `, excess ${body.arrived_qty - item.quantity} → stock` : ''}`
    : body.action === 'all' ? 'all verified' : body.action === 'partial' ? `partial (${newVerifiedQty}/${item.quantity})` : 'not yet';
  await query(
    `INSERT INTO production_update_logs (order_id, order_item_id, note, log_type, created_by)
     VALUES ($1, $2, $3, 'agent', 'inventory-agent')`,
    [id, body.item_id, `Inventory verification: ${item.name} — ${actionLabel}`]
  );

  // Notify inventory group chat about manual verification
  const INVENTORY_GROUP_CHAT_ID = process.env.INVENTORY_GROUP_CHAT_ID;
  if (INVENTORY_GROUP_CHAT_ID) {
    const ref = orderRows[0].quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = orderRows[0].client_name ?? 'Unknown';
    const verificationUrl = `https://track.abcx124.xyz/inventory/verification/${encodeURIComponent(orderRows[0].quotation_number ?? id.slice(0, 8))}`;
    const displayLabel = body.arrived_qty !== undefined
      ? `Arrived ${body.arrived_qty}, Verified ${newVerifiedQty}/${item.quantity}${body.arrived_qty > item.quantity ? ` (excess ${body.arrived_qty - item.quantity} → stock)` : ''}`
      : body.action === 'all' ? 'All verified' : body.action === 'partial' ? `Partial (${newVerifiedQty}/${item.quantity})` : 'Not yet';
    setImmediate(() => {
      notifyGroupChat(
        INVENTORY_GROUP_CHAT_ID,
        `<b>Inventory Verification Updated</b>

` +
        `Order: <b>#${ref}</b>
` +
        `Client: ${client}
` +
        `Item: ${item.name}
` +
        `Status: ${displayLabel}
` +
        `Verified Qty: ${newVerifiedQty}/${item.quantity}
` +
        `Link: <a href="${verificationUrl}">Permanent Verification Link</a>`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${orderRows[0].quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  return reply.send({
    ok: true,
    item_id: body.item_id,
    verified_qty: newVerifiedQty,
    verification_pct: verificationPct,
  });
});

// POST /orders/:id/bulk-inventory-verify — Bulk verify selected items
// Supports actions: 'all' (default, full qty), 'partial' (set specific qty), 'not_yet' (set to 0)
// When arrived_qty is provided and exceeds item.quantity, the excess is auto-added to inventory stock.
const bulkInventoryVerifySchema = z.object({
  item_ids: z.array(z.string()).min(1, 'At least one item must be selected'),
  action_token: z.string(),
  action: z.enum(['all', 'partial', 'not_yet']).optional().default('all'),
  verified_qty: z.number().int().min(0).optional(),
  arrived_qty: z.number().int().min(0).optional(),
});

app.post('/orders/:id/bulk-inventory-verify', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = bulkInventoryVerifySchema.parse(request.body);

  // Verify action token
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  let tokenData: string | null;
  try {
    tokenData = await cacheClient.get(tokenKey);
  } catch (err) {
    console.error('[bulk-inventory-verify] Redis get error:', err);
    return reply.status(503).send({ error: 'Action verification service error' });
  }
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey).catch(() => {});

  // Parse token payload safely
  let tokenPayload: Record<string, unknown>;
  try {
    tokenPayload = JSON.parse(tokenData);
  } catch {
    return reply.status(401).send({ error: 'Invalid action token data. Please verify OTP again.' });
  }
  const userEmail: string | null = (tokenPayload.name ?? tokenPayload.email ?? null) as string | null;

  // Verify the order is in inventory_verification or en_route_verification stage
  const orderRows = await query<{ current_stage: string; quotation_number: string | null; client_name: string | null }>(
    `SELECT current_stage, quotation_number, client_name FROM orders WHERE id = $1`, [id]
  );
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });
  if (!['inventory_verification', 'en_route_verification'].includes(orderRows[0].current_stage)) {
    return reply.code(400).send({ error: 'Order is not in inventory verification or en route verification stage' });
  }

  // Fetch selected items (also fetch arrived_qty if it exists)
  const selectedItems = await query<{ id: string; name: string; quantity: number; verified_qty: number | null; arrived_qty: number | null }>(
    `SELECT id, name, quantity, verified_qty, arrived_qty FROM order_items WHERE order_id = $1 AND id = ANY($2::uuid[]) ORDER BY created_at ASC`,
    [id, body.item_ids]
  );

  if (selectedItems.length === 0) {
    return reply.code(400).send({ error: 'None of the selected items were found for this order.' });
  }

  const action = body.action ?? 'all';
  const verifiedNames: string[] = [];
  const alreadyVerifiedNames: string[] = [];
  const skippedNames: string[] = [];
  const excessNames: string[] = [];

  for (const item of selectedItems) {
    const previousVerifiedQty = Number(item.verified_qty ?? 0);
    const previousArrivedQty = Number(item.arrived_qty ?? 0);

    // Determine target verified_qty based on action
    let newVerifiedQty: number;
    let arrivedQty: number | null = null;

    // If arrived_qty is provided at the body level, use it for all items
    // Otherwise fall back to the existing action logic
    if (body.arrived_qty !== undefined) {
      // arrived_qty is the actual quantity that arrived (can exceed item.quantity)
      arrivedQty = body.arrived_qty;
      // verified_qty is capped at item.quantity (what's needed for the order)
      newVerifiedQty = Math.min(arrivedQty, item.quantity);
      if (newVerifiedQty < 0) newVerifiedQty = 0;
    } else {
      switch (action) {
        case 'all':
          newVerifiedQty = item.quantity;
          break;
        case 'partial':
          newVerifiedQty = body.verified_qty ?? previousVerifiedQty;
          if (newVerifiedQty > item.quantity) newVerifiedQty = item.quantity;
          if (newVerifiedQty < 0) newVerifiedQty = 0;
          break;
        case 'not_yet':
          newVerifiedQty = 0;
          break;
        default:
          newVerifiedQty = item.quantity;
      }
    }

    const inventoryDelta = newVerifiedQty - previousVerifiedQty;

    if (inventoryDelta === 0 && arrivedQty === null) {
      alreadyVerifiedNames.push(item.name);
      continue;
    }

    try {
      // Build the UPDATE query dynamically — include arrived_qty if provided
      let updateSQL: string;
      let updateParams: any[];

      if (arrivedQty !== null) {
        updateSQL = `UPDATE order_items
         SET verified_qty = $1,
             arrived_qty = $2,
             inventory_verified_at = CASE WHEN $1 > 0 THEN COALESCE(inventory_verified_at, NOW()) ELSE NULL END,
             updated_at = NOW()
         WHERE id = $3`;
        updateParams = [newVerifiedQty, arrivedQty, item.id];
      } else {
        updateSQL = `UPDATE order_items
         SET verified_qty = $1,
             inventory_verified_at = CASE WHEN $1 > 0 THEN COALESCE(inventory_verified_at, NOW()) ELSE NULL END,
             updated_at = NOW()
         WHERE id = $2`;
        updateParams = [newVerifiedQty, item.id];
      }

      await query(updateSQL, updateParams);

      // Adjust inventory for the verified quantity delta
      if (inventoryDelta !== 0) {
        await adjustInventoryForOrderItem(
          id,
          item.id,
          item.name,
          inventoryDelta,
          inventoryDelta > 0 ? 'inventory_verified' : 'inventory_unverified',
          `Bulk inventory verification: ${item.name} — ${previousVerifiedQty} -> ${newVerifiedQty} (${action}).`,
          'inventory-agent',
        );
      }

      // If arrived_qty exceeds item.quantity, add the excess to inventory stock
      if (arrivedQty !== null && arrivedQty > item.quantity) {
        const excessQty = arrivedQty - item.quantity;
        await adjustInventoryForOrderItem(
          id,
          item.id,
          item.name,
          excessQty,
          'excess_arrival',
          `Excess arrival: ${item.name} — arrived ${arrivedQty}, ordered ${item.quantity}. Excess ${excessQty} added to inventory stock.`,
          'inventory-agent',
        );
        excessNames.push(`${item.name} (+${excessQty} excess → stock)`);
      }

      const actionLabel = arrivedQty !== null
        ? `arrived ${arrivedQty}, verified ${newVerifiedQty}/${item.quantity}${arrivedQty > item.quantity ? `, excess ${arrivedQty - item.quantity} → stock` : ''}`
        : action === 'all' ? 'all verified' : action === 'partial' ? `partial (${newVerifiedQty}/${item.quantity})` : 'not yet';
      await query(
        `INSERT INTO production_update_logs (order_id, order_item_id, note, log_type, created_by)
         VALUES ($1, $2, $3, 'agent', 'inventory-agent')`,
        [id, item.id, `Bulk inventory verification: ${item.name} — ${actionLabel}`]
      );

      verifiedNames.push(`${item.name} (${newVerifiedQty}/${item.quantity})`);
    } catch (err) {
      console.error(`[bulk-inventory-verify] Failed to verify item ${item.id} (${item.name}):`, err);
      skippedNames.push(item.name);
    }
  }

  // Recalculate overall verification %
  const allItems = await query(
    `SELECT SUM(quantity) as total_qty, SUM(verified_qty) as verified_qty FROM order_items WHERE order_id = $1`,
    [id]
  );
  const totalQty = Number(allItems[0]?.total_qty ?? 0);
  const totalVerified = Number(allItems[0]?.verified_qty ?? 0);
  const verificationPct = totalQty > 0 ? Math.round((totalVerified / totalQty) * 100) : 0;

  await query(
    `UPDATE orders SET inventory_verification_pct = $1, updated_at = NOW() WHERE id = $2`,
    [verificationPct, id]
  );

  // Notify inventory group chat about bulk verification
  const INVENTORY_GROUP_CHAT_ID = process.env.INVENTORY_GROUP_CHAT_ID;
  if (INVENTORY_GROUP_CHAT_ID && verifiedNames.length > 0) {
    const ref = orderRows[0].quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = orderRows[0].client_name ?? 'Unknown';
    const verificationUrl = `https://track.abcx124.xyz/inventory/verification/${encodeURIComponent(orderRows[0].quotation_number ?? id.slice(0, 8))}`;
    setImmediate(() => {
      notifyGroupChat(
        INVENTORY_GROUP_CHAT_ID,
        `<b>Inventory Verification Updated (Bulk)</b>\n\n` +
        `Order: <b>#${ref}</b>\n` +
        `Client: ${client}\n\n` +
        `<b>Verified Items</b>\n${verifiedNames.join('\n')}\n\n` +
        `Link: <a href="${verificationUrl}">Permanent Verification Link</a>`
      );
    });
  }

  await notifyManualChange(
    `Inventory verified (bulk ${action})`,
    `Quotation: *${orderRows[0].quotation_number ?? 'N/A'}*\nClient: *${orderRows[0].client_name ?? 'Unknown'}*\n${verifiedNames.length} item(s) updated (${action})`,
    userEmail,
  );

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${orderRows[0].quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  // Build response with feedback
  const response: Record<string, unknown> = { ok: true, verification_pct: verificationPct };
  if (verifiedNames.length > 0) {
    response.verified_count = verifiedNames.length;
  }
  if (alreadyVerifiedNames.length > 0) {
    response.already_verified = alreadyVerifiedNames;
    response.warning = `${alreadyVerifiedNames.length} item(s) were already at the target state and were skipped.`;
  }
  if (verifiedNames.length === 0 && alreadyVerifiedNames.length > 0) {
    response.warning = 'All selected items were already at the target state. No changes were made.';
  }
  if (skippedNames.length > 0) {
    response.skipped = skippedNames;
  }

  return reply.send(response);
});

// POST /orders/:id/bulk-inventory-unverify — Bulk unverify (undo) selected items, resetting verified_qty to 0
const bulkInventoryUnverifySchema = z.object({
  item_ids: z.array(z.string()).min(1, 'At least one item must be selected'),
  action_token: z.string(),
});

app.post('/orders/:id/bulk-inventory-unverify', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = bulkInventoryUnverifySchema.parse(request.body);

  // Verify action token
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  let tokenData: string | null;
  try {
    tokenData = await cacheClient.get(tokenKey);
  } catch (err) {
    console.error('[bulk-inventory-unverify] Redis get error:', err);
    return reply.status(503).send({ error: 'Action verification service error' });
  }
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey).catch(() => {});

  // Parse token payload safely
  let tokenPayload: Record<string, unknown>;
  try {
    tokenPayload = JSON.parse(tokenData);
  } catch {
    return reply.status(401).send({ error: 'Invalid action token data. Please verify OTP again.' });
  }
  const userEmail: string | null = (tokenPayload.name ?? tokenPayload.email ?? null) as string | null;

  // Verify the order is in inventory_verification or en_route_verification stage
  const orderRows = await query<{ current_stage: string; quotation_number: string | null; client_name: string | null }>(
    `SELECT current_stage, quotation_number, client_name FROM orders WHERE id = $1`, [id]
  );
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });
  if (!['inventory_verification', 'en_route_verification'].includes(orderRows[0].current_stage)) {
    return reply.code(400).send({ error: 'Order is not in inventory verification or en route verification stage' });
  }

  // Fetch selected items that have verified_qty > 0
  const selectedItems = await query<{ id: string; name: string; quantity: number; verified_qty: number | null }>(
    `SELECT id, name, quantity, verified_qty FROM order_items WHERE order_id = $1 AND id = ANY($2::uuid[]) AND COALESCE(verified_qty, 0) > 0 ORDER BY created_at ASC`,
    [id, body.item_ids]
  );

  if (selectedItems.length === 0) {
    return reply.code(400).send({ error: 'None of the selected items have any verified quantity to undo.' });
  }

  const unverifiedNames: string[] = [];
  const skippedNames: string[] = [];

  for (const item of selectedItems) {
    const previousVerifiedQty = Number(item.verified_qty ?? 0);
    const inventoryDelta = -previousVerifiedQty; // negative delta to deduct from inventory

    try {
      await query(
        `UPDATE order_items
         SET verified_qty = 0,
             inventory_verified_at = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [item.id]
      );

      await adjustInventoryForOrderItem(
        id,
        item.id,
        item.name,
        inventoryDelta,
        'inventory_unverified',
        `Bulk inventory unverify: ${item.name} — ${previousVerifiedQty} -> 0.`,
        'inventory-agent',
      );

      await query(
        `INSERT INTO production_update_logs (order_id, order_item_id, note, log_type, created_by)
         VALUES ($1, $2, $3, 'agent', 'inventory-agent')`,
        [id, item.id, `Bulk inventory unverify: ${item.name} — reset from ${previousVerifiedQty} to 0`]
      );

      unverifiedNames.push(`${item.name} (was ${previousVerifiedQty}/${item.quantity})`);
    } catch (err) {
      console.error(`[bulk-inventory-unverify] Failed to unverify item ${item.id} (${item.name}):`, err);
      skippedNames.push(item.name);
    }
  }

  // Recalculate overall verification %
  const allItems = await query(
    `SELECT SUM(quantity) as total_qty, SUM(verified_qty) as verified_qty FROM order_items WHERE order_id = $1`,
    [id]
  );
  const totalQty = Number(allItems[0]?.total_qty ?? 0);
  const totalVerified = Number(allItems[0]?.verified_qty ?? 0);
  const verificationPct = totalQty > 0 ? Math.round((totalVerified / totalQty) * 100) : 0;

  await query(
    `UPDATE orders SET inventory_verification_pct = $1, updated_at = NOW() WHERE id = $2`,
    [verificationPct, id]
  );

  // Notify inventory group chat about bulk unverify
  const INVENTORY_GROUP_CHAT_ID = process.env.INVENTORY_GROUP_CHAT_ID;
  if (INVENTORY_GROUP_CHAT_ID && unverifiedNames.length > 0) {
    const ref = orderRows[0].quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = orderRows[0].client_name ?? 'Unknown';
    const verificationUrl = `https://track.abcx124.xyz/inventory/verification/${encodeURIComponent(orderRows[0].quotation_number ?? id.slice(0, 8))}`;
    setImmediate(() => {
      notifyGroupChat(
        INVENTORY_GROUP_CHAT_ID,
        `<b>Inventory Verification Undone (Bulk)</b>\n\n` +
        `Order: <b>#${ref}</b>\n` +
        `Client: ${client}\n\n` +
        `<b>Unverified Items</b>\n${unverifiedNames.join('\n')}\n\n` +
        `Link: <a href="${verificationUrl}">Permanent Verification Link</a>`
      );
    });
  }

  await notifyManualChange(
    'Inventory unverified (bulk)',
    `Quotation: *${orderRows[0].quotation_number ?? 'N/A'}*\nClient: *${orderRows[0].client_name ?? 'Unknown'}*\n${unverifiedNames.length} item(s) unverified`,
    userEmail,
  );

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${orderRows[0].quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  const response: Record<string, unknown> = { ok: true, verification_pct: verificationPct };
  if (unverifiedNames.length > 0) {
    response.unverified_count = unverifiedNames.length;
  }
  if (skippedNames.length > 0) {
    response.skipped = skippedNames;
  }

  return reply.send(response);
});

/**
 * POST /orders/:id/complete-inventory-verification
 * Manually mark inventory verification as complete and advance to inventory_arrived.
 */
const completeInventoryVerificationSchema = z.object({
  updated_by: z.string().optional(),
  action_token: z.string(),
});

app.post('/orders/:id/complete-inventory-verification', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = completeInventoryVerificationSchema.parse(request.body);

  // Verify action token and extract email
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  let tokenData: string | null;
  try {
    tokenData = await cacheClient.get(tokenKey);
  } catch (err) {
    console.error('[complete-inventory-verification] Redis get error:', err);
    return reply.status(503).send({ error: 'Action verification service error' });
  }
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey).catch(() => {});

  let tokenPayload: Record<string, unknown>;
  try {
    tokenPayload = JSON.parse(tokenData);
  } catch {
    return reply.status(401).send({ error: 'Invalid action token data. Please verify OTP again.' });
  }
  const userEmail: string | null = (tokenPayload.name ?? tokenPayload.email ?? null) as string | null;

  const orderRows = await query(`SELECT current_stage, quotation_number, client_name FROM orders WHERE id = $1`, [id]);
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });
  if (!['inventory_verification', 'en_route_verification'].includes(orderRows[0].current_stage)) {
    return reply.code(400).send({ error: 'Order is not in inventory verification or en route verification stage' });
  }

  // Safety check: verify all items are verified before advancing
  const itemCheck = await query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE verified_qty >= quantity)::int AS verified
     FROM order_items WHERE order_id = $1`,
    [id]
  );
  if (itemCheck[0] && itemCheck[0].total > 0 && itemCheck[0].verified < itemCheck[0].total) {
    return reply.code(400).send({
      error: `Cannot complete verification: only ${itemCheck[0].verified}/${itemCheck[0].total} items are fully verified. Verify all items first.`,
      total_items: itemCheck[0].total,
      verified_items: itemCheck[0].verified,
    });
  }

  const verifiedItemRows = await query<{ name: string; quantity: number; verified_qty: number }>(
    `SELECT name, quantity, COALESCE(verified_qty, 0) AS verified_qty
     FROM order_items
     WHERE order_id = $1
     ORDER BY created_at ASC`,
    [id]
  );
  const verifiedItemList = verifiedItemRows.length
    ? verifiedItemRows.map((item) => `- ${item.name}: ${Number(item.verified_qty ?? 0)}/${Number(item.quantity ?? 0)} verified`).join('\n')
    : '- No item quantities recorded';
  const verificationRef = orderRows[0].quotation_number ?? id.slice(0, 8);
  const verificationUrl = `https://track.abcx124.xyz/inventory/verification/${encodeURIComponent(verificationRef)}`;

  // Advance to inventory_arrived
  await query(
    `UPDATE orders SET inventory_verified_at = NOW(), inventory_verification_pct = 100,
     current_stage = 'inventory_arrived', updated_at = NOW()
     WHERE id = $1`,
    [id]
  );

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'inventory_arrived', 'auto_advanced', 'Inventory verification completed. Proceeding to inventory arrival.', 'inventory-agent')`,
    [id]
  );

  // Complete reminders for inventory_verification
  await query(
    `UPDATE reminders SET status = 'completed', updated_at = NOW()
     WHERE order_id = $1 AND status = 'active' AND stage = 'inventory_verification'`,
    [id]
  );

  // Fire inventory agent for the new stage
  triggerAgentsForStage('inventory_arrived', orderRows[0].quotation_number, orderRows[0].client_name);

  // Notify escalation group about inventory verification completion (dashboard only)
  await notifyManualChange(
    'Inventory verification completed',
    `Quotation: *${orderRows[0].quotation_number ?? 'N/A'}*\nClient: *${orderRows[0].client_name ?? 'Unknown'}*\nAdvanced to: Inventory Arrived`,
    userEmail,
  );

  // Notify delivery group directly
  if (DELIVERY_CHAT_ID) {
    const ref = orderRows[0].quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = orderRows[0].client_name ?? 'Unknown';
    setImmediate(() => {
      notifyGroupChat(
        DELIVERY_CHAT_ID,
        `<b>Inventory Verification Complete (Dashboard)</b>\n\n` +
        `Order: <b>#${ref}</b>\n` +
        `Client: ${client}\n` +
        `Link: <a href="${verificationUrl}">Permanent Verification Link</a>\n\n` +
        `<b>Verified Items</b>\n${verifiedItemList}\n\n` +
        `Order is now in Inventory Arrived stage.`
      );
    });
  }

  // Notify inventory group chat
  const INVENTORY_GROUP_CHAT_ID = process.env.INVENTORY_GROUP_CHAT_ID;
  if (INVENTORY_GROUP_CHAT_ID) {
    const ref = orderRows[0].quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = orderRows[0].client_name ?? 'Unknown';
    setImmediate(() => {
      notifyGroupChat(
        INVENTORY_GROUP_CHAT_ID,
        `📦 <b>Inventory Verification Complete (Dashboard)</b>\n\n` +
        `Quotation: <b>${ref}</b>\n` +
        `Client: ${client}\n\n` +
        `All items have been verified via dashboard. Order moved to Inventory Arrived stage.`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${orderRows[0].quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  return reply.send({ ok: true, message: 'Inventory verification completed. Advanced to inventory_arrived.' });
});

/**
 * POST /orders/:id/complete-inventory-verification-partial
 * Complete inventory verification even when some items are not yet fully verified.
 * This enables partial delivery — items that have arrived can be delivered,
 * while pending items remain tracked.
 */
const completeInventoryVerificationPartialSchema = z.object({
  action_token: z.string(),
  notes: z.string().optional(),
});

app.post('/orders/:id/complete-inventory-verification-partial', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = completeInventoryVerificationPartialSchema.parse(request.body);

  // Verify action token and extract email
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  let tokenData: string | null;
  try {
    tokenData = await cacheClient.get(tokenKey);
  } catch (err) {
    console.error('[complete-inventory-verification-partial] Redis get error:', err);
    return reply.status(503).send({ error: 'Action verification service error' });
  }
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey).catch(() => {});

  let tokenPayload: Record<string, unknown>;
  try {
    tokenPayload = JSON.parse(tokenData);
  } catch {
    return reply.status(401).send({ error: 'Invalid action token data. Please verify OTP again.' });
  }
  const userEmail: string | null = (tokenPayload.name ?? tokenPayload.email ?? null) as string | null;

  const orderRows = await query(`SELECT current_stage, quotation_number, client_name FROM orders WHERE id = $1`, [id]);
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });
  if (!['inventory_verification', 'en_route_verification'].includes(orderRows[0].current_stage)) {
    return reply.code(400).send({ error: 'Order is not in inventory verification or en route verification stage' });
  }

  // Check that at least SOME items have been verified (not all zero)
  const itemCheck = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE verified_qty > 0)::int AS any_verified,
            COUNT(*) FILTER (WHERE verified_qty >= quantity)::int AS fully_verified
     FROM order_items WHERE order_id = $1`,
    [id]
  );

  if (itemCheck[0] && itemCheck[0].total > 0 && itemCheck[0].any_verified === 0) {
    return reply.code(400).send({
      error: 'Cannot complete partial verification: no items have been verified yet. Verify at least some items first.',
      total_items: itemCheck[0].total,
      verified_items: 0,
    });
  }

  // Get verification summary for notifications
  const verifiedItemRows = await query<{ name: string; quantity: number; verified_qty: number; arrived_qty: number | null }>(
    `SELECT name, quantity, COALESCE(verified_qty, 0) AS verified_qty, arrived_qty
     FROM order_items
     WHERE order_id = $1
     ORDER BY created_at ASC`,
    [id]
  );

  // Calculate verification percentage based on what's actually verified
  const totalQty = verifiedItemRows.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
  const totalVerified = verifiedItemRows.reduce((sum, item) => sum + Number(item.verified_qty ?? 0), 0);
  const pct = totalQty > 0 ? Math.round((totalVerified / totalQty) * 100) : 0;

  // Set remaining_qty for ALL items — fully-verified items get 0, partially-verified items get the difference
  for (const item of verifiedItemRows) {
    const verified = Number(item.verified_qty ?? 0);
    const ordered = Number(item.quantity ?? 0);
    const remaining = Math.max(0, ordered - verified);
    await query(
      `UPDATE order_items SET remaining_qty = $1, updated_at = NOW() WHERE order_id = $2 AND name = $3`,
      [remaining, id, item.name]
    );
  }

  const verifiedItemList = verifiedItemRows.length
    ? verifiedItemRows.map((item) => {
        const v = Number(item.verified_qty ?? 0);
        const q = Number(item.quantity ?? 0);
        const a = item.arrived_qty != null ? Number(item.arrived_qty) : null;
        const arrivedStr = a != null ? ` (arrived: ${a})` : '';
        return `- ${item.name}: ${v}/${q} verified${arrivedStr}${v < q ? ' ⏳ PENDING' : ' ✅'}`;
      }).join('\n')
    : '- No item quantities recorded';

  const verificationRef = orderRows[0].quotation_number ?? id.slice(0, 8);
  const verificationUrl = `https://track.abcx124.xyz/inventory/verification/${encodeURIComponent(verificationRef)}`;

  // Mark order as partial delivery and advance to inventory_arrived
  await query(
    `UPDATE orders SET
      inventory_verified_at = NOW(),
      inventory_verification_pct = $1,
      partial_delivery = TRUE,
      partial_delivery_notes = $2,
      current_stage = 'inventory_arrived',
      updated_at = NOW()
     WHERE id = $3`,
    [pct, body.notes ?? `Partial verification: ${itemCheck[0].fully_verified}/${itemCheck[0].total} items fully verified (${pct}%)`, id]
  );

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'inventory_arrived', 'auto_advanced', $2, 'inventory-agent')`,
    [id, `Partial inventory verification completed. ${itemCheck[0].fully_verified}/${itemCheck[0].total} items fully verified. Pending items tracked for later delivery.`]
  );

  // Complete reminders for inventory_verification
  await query(
    `UPDATE reminders SET status = 'completed', updated_at = NOW()
     WHERE order_id = $1 AND status = 'active' AND stage = 'inventory_verification'`,
    [id]
  );

  // Fire inventory agent for the new stage
  triggerAgentsForStage('inventory_arrived', orderRows[0].quotation_number, orderRows[0].client_name);

  // Notify escalation group
  await notifyManualChange(
    'Partial inventory verification completed',
    `Quotation: *${orderRows[0].quotation_number ?? 'N/A'}*\nClient: *${orderRows[0].client_name ?? 'Unknown'}*\nAdvanced to: Inventory Arrived (Partial)\nVerified: ${itemCheck[0].fully_verified}/${itemCheck[0].total} items\nNotes: ${body.notes ?? 'None'}`,
    userEmail,
  );

  // Notify delivery group
  if (DELIVERY_CHAT_ID) {
    const ref = orderRows[0].quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = orderRows[0].client_name ?? 'Unknown';
    setImmediate(() => {
      notifyGroupChat(
        DELIVERY_CHAT_ID,
        `<b>⚠️ Partial Inventory Verification Complete (Dashboard)</b>\n\n` +
        `Order: <b>#${ref}</b>\n` +
        `Client: ${client}\n` +
        `Link: <a href="${verificationUrl}">Permanent Verification Link</a>\n\n` +
        `<b>Verified Items</b>\n${verifiedItemList}\n\n` +
        `⚠️ Only ${itemCheck[0].fully_verified}/${itemCheck[0].total} items are fully verified.\n` +
        `Order is now in Inventory Arrived stage with partial delivery enabled.\n` +
        `Pending items will be tracked for later delivery.`
      );
    });
  }

  // Notify inventory group chat
  const INVENTORY_GROUP_CHAT_ID = process.env.INVENTORY_GROUP_CHAT_ID;
  if (INVENTORY_GROUP_CHAT_ID) {
    const ref = orderRows[0].quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = orderRows[0].client_name ?? 'Unknown';
    setImmediate(() => {
      notifyGroupChat(
        INVENTORY_GROUP_CHAT_ID,
        `📦 <b>⚠️ Partial Inventory Verification Complete (Dashboard)</b>\n\n` +
        `Quotation: <b>${ref}</b>\n` +
        `Client: ${client}\n\n` +
        `⚠️ Only ${itemCheck[0].fully_verified}/${itemCheck[0].total} items fully verified.\n` +
        `Partial delivery enabled. Pending items will be tracked.`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${orderRows[0].quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  return reply.send({
    ok: true,
    message: `Partial inventory verification completed. Advanced to inventory_arrived with ${itemCheck[0].fully_verified}/${itemCheck[0].total} items verified.`,
    fully_verified: itemCheck[0].fully_verified,
    total_items: itemCheck[0].total,
    verification_pct: pct,
  });
});

/**
 * POST /orders/:id/partial-delivery
 * Record delivery of specific items that have arrived, while tracking
 * which items remain to be delivered later.
 */
const partialDeliverySchema = z.object({
  item_ids: z.array(z.string()).min(1, 'At least one item must be selected for delivery'),
  action_token: z.string(),
  delivery_note: z.string().optional(),
});

app.post('/orders/:id/partial-delivery', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = partialDeliverySchema.parse(request.body);

  // Verify action token and extract email
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  let tokenData: string | null;
  try {
    tokenData = await cacheClient.get(tokenKey);
  } catch (err) {
    console.error('[partial-delivery] Redis get error:', err);
    return reply.status(503).send({ error: 'Action verification service error' });
  }
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey).catch(() => {});

  let tokenPayload: Record<string, unknown>;
  try {
    tokenPayload = JSON.parse(tokenData);
  } catch {
    return reply.status(401).send({ error: 'Invalid action token data. Please verify OTP again.' });
  }
  const userEmail: string | null = (tokenPayload.name ?? tokenPayload.email ?? null) as string | null;

  const orderRows = await query(
    `SELECT id, current_stage, quotation_number, client_name, partial_delivery
     FROM orders WHERE id = $1`,
    [id]
  );
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });

  const order = orderRows[0];

  // Allow partial delivery from: inventory_arrived, en_route_verification, balance_due, balance_verification, delivery_pending, delivery_scheduled
  const allowedStages = ['inventory_arrived', 'en_route_verification', 'balance_due', 'balance_verification', 'delivery_pending', 'delivery_scheduled'];
  if (!allowedStages.includes(order.current_stage)) {
    return reply.code(400).send({
      error: `Cannot record partial delivery in stage '${order.current_stage}'. Allowed stages: ${allowedStages.join(', ')}.`,
    });
  }

  // Fetch the selected items
  const items = await query<{
    id: string; name: string; quantity: number;
    verified_qty: number; delivered_qty: number; arrived_qty: number | null;
  }>(
    `SELECT id, name, quantity, COALESCE(verified_qty, 0) AS verified_qty,
            COALESCE(delivered_qty, 0) AS delivered_qty, arrived_qty
     FROM order_items WHERE order_id = $1 AND id = ANY($2::uuid[])`,
    [id, body.item_ids]
  );

  if (items.length === 0) {
    return reply.code(400).send({ error: 'No valid items found for delivery.' });
  }

  const deliveryResults: {
    item_id: string;
    item_name: string;
    quantity_delivered: number;
    quantity_remaining: number;
    fully_delivered: boolean;
  }[] = [];

  for (const item of items) {
    const verified = Number(item.verified_qty ?? 0);
    const alreadyDelivered = Number(item.delivered_qty ?? 0);
    const maxDeliverable = Math.max(0, verified - alreadyDelivered);

    if (maxDeliverable <= 0) {
      deliveryResults.push({
        item_id: item.id,
        item_name: item.name,
        quantity_delivered: 0,
        quantity_remaining: Math.max(0, Number(item.quantity ?? 0) - alreadyDelivered),
        fully_delivered: alreadyDelivered >= Number(item.quantity ?? 0),
      });
      continue;
    }

    // Deliver all verified-but-not-yet-delivered quantity
    const deltaToDeduct = maxDeliverable;
    const newDeliveredQty = alreadyDelivered + deltaToDeduct;
    const remaining = Math.max(0, Number(item.quantity ?? 0) - newDeliveredQty);

    // Deduct from inventory
    await adjustInventoryForOrderItem(
      id,
      item.id,
      item.name,
      -deltaToDeduct,
      'delivery_deduct',
      `Partial delivery: ${deltaToDeduct} units delivered (${newDeliveredQty}/${item.quantity} total delivered).`,
      userEmail ?? 'delivery-agent',
    );

    // Update order_items
    await query(
      `UPDATE order_items
       SET delivered_qty = LEAST(quantity, COALESCE(delivered_qty, 0) + $1),
           remaining_qty = GREATEST(0, quantity - LEAST(quantity, COALESCE(delivered_qty, 0) + $1)),
           partial_delivery_count = COALESCE(partial_delivery_count, 0) + 1,
           delivered_at = CASE WHEN $2 = 0 THEN delivered_at ELSE COALESCE(delivered_at, NOW()) END,
           last_partial_delivery_at = NOW(),
           updated_at = NOW()
       WHERE id = $3`,
      [deltaToDeduct, remaining, item.id]
    );

    // Log the partial delivery
    await query(
      `INSERT INTO partial_delivery_logs
         (order_id, item_id, item_name, quantity_delivered, quantity_remaining, delivery_note, delivered_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, item.id, item.name, deltaToDeduct, remaining, body.delivery_note ?? null, userEmail ?? 'delivery-agent']
    );

    deliveryResults.push({
      item_id: item.id,
      item_name: item.name,
      quantity_delivered: deltaToDeduct,
      quantity_remaining: remaining,
      fully_delivered: remaining === 0,
    });
  }

  // Check if all items are now fully delivered
  const allItemsCheck = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE COALESCE(delivered_qty, 0) >= quantity)::int AS fully_delivered
     FROM order_items WHERE order_id = $1`,
    [id]
  );

  const allFullyDelivered = allItemsCheck[0] && allItemsCheck[0].total > 0 &&
    allItemsCheck[0].fully_delivered >= allItemsCheck[0].total;

  // If all items are delivered, advance to 'delivered' stage
  if (allFullyDelivered) {
    await query(
      `UPDATE orders SET current_stage = 'delivered', delivered_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id]
    );
    await query(
      `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
       VALUES ($1, 'delivered', 'auto_advanced', 'All items delivered via partial delivery completion.', 'delivery-agent')`,
      [id]
    );
    triggerAgentsForStage('delivered', order.quotation_number, order.client_name);
  } else {
    // Update order to reflect partial delivery
    await query(
      `UPDATE orders SET partial_delivery = TRUE, updated_at = NOW() WHERE id = $1`,
      [id]
    );
  }

  // Notify delivery group
  if (DELIVERY_CHAT_ID) {
    const ref = order.quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = order.client_name ?? 'Unknown';
    const deliverySummary = deliveryResults
      .map((r) => `- ${r.item_name}: ${r.quantity_delivered} delivered (${r.quantity_remaining} remaining)${r.fully_delivered ? ' ✅' : ' ⏳'}`)
      .join('\n');

    setImmediate(() => {
      notifyGroupChat(
        DELIVERY_CHAT_ID,
        allFullyDelivered
          ? `✅ <b>Delivery Complete (Partial Delivery)</b>\n\n` +
            `Order: <b>#${ref}</b>\n` +
            `Client: ${client}\n\n` +
            `<b>Delivered Items</b>\n${deliverySummary}\n\n` +
            `All items have been delivered. Order advanced to Delivered stage.`
          : `🚚 <b>Partial Delivery Recorded</b>\n\n` +
            `Order: <b>#${ref}</b>\n` +
            `Client: ${client}\n\n` +
            `<b>Delivered Items</b>\n${deliverySummary}\n\n` +
            `⚠️ Some items remain undelivered. They will be tracked for later delivery.`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  return reply.send({
    ok: true,
    message: allFullyDelivered
      ? 'All items delivered. Order advanced to Delivered stage.'
      : `Partial delivery recorded. ${deliveryResults.filter(r => r.fully_delivered).length}/${deliveryResults.length} items fully delivered.`,
    items: deliveryResults,
    all_delivered: allFullyDelivered,
  });
});

/**
 * GET /orders/:id/delivery-progress
 * Get delivery progress for all items in an order.
 * Returns per-item delivery status and overall progress.
 */
app.get('/orders/:id/delivery-progress', async (request, reply) => {
  const { id } = request.params as { id: string };

  const orderRows = await query(
    `SELECT id, quotation_number, client_name, current_stage, partial_delivery
     FROM orders WHERE id = $1`,
    [id]
  );
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });

  const items = await query<{
    id: string; name: string; quantity: number;
    verified_qty: number; delivered_qty: number;
    arrived_qty: number | null; remaining_qty: number | null;
    partial_delivery_count: number;
    delivered_at: string | null; last_partial_delivery_at: string | null;
  }>(
    `SELECT id, name, quantity,
            COALESCE(verified_qty, 0) AS verified_qty,
            COALESCE(delivered_qty, 0) AS delivered_qty,
            arrived_qty,
            remaining_qty,
            COALESCE(partial_delivery_count, 0) AS partial_delivery_count,
            delivered_at,
            last_partial_delivery_at
     FROM order_items
     WHERE order_id = $1
     ORDER BY created_at ASC`,
    [id]
  );

  const totalQty = items.reduce((sum, i) => sum + Number(i.quantity ?? 0), 0);
  const totalDelivered = items.reduce((sum, i) => sum + Number(i.delivered_qty ?? 0), 0);
  const deliveryPct = totalQty > 0 ? Math.round((totalDelivered / totalQty) * 100) : 0;

  // Get partial delivery logs
  const logs = await query<{
    id: string; item_name: string; quantity_delivered: number;
    quantity_remaining: number; delivery_note: string | null;
    delivered_by: string | null; created_at: string;
  }>(
    `SELECT id, item_name, quantity_delivered, quantity_remaining,
            delivery_note, delivered_by, created_at
     FROM partial_delivery_logs
     WHERE order_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [id]
  );

  return reply.send({
    ok: true,
    order: {
      id: orderRows[0].id,
      quotation_number: orderRows[0].quotation_number,
      client_name: orderRows[0].client_name,
      current_stage: orderRows[0].current_stage,
      partial_delivery: orderRows[0].partial_delivery,
    },
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: Number(item.quantity),
      verified_qty: Number(item.verified_qty),
      delivered_qty: Number(item.delivered_qty),
      arrived_qty: item.arrived_qty,
      remaining_qty: item.remaining_qty ?? Math.max(0, Number(item.quantity) - Number(item.delivered_qty)),
      partial_delivery_count: Number(item.partial_delivery_count),
      delivered_at: item.delivered_at,
      last_partial_delivery_at: item.last_partial_delivery_at,
      fully_delivered: Number(item.delivered_qty) >= Number(item.quantity),
    })),
    summary: {
      total_items: items.length,
      total_quantity: totalQty,
      total_delivered: totalDelivered,
      delivery_pct: deliveryPct,
      fully_delivered_items: items.filter((i) => Number(i.delivered_qty ?? 0) >= Number(i.quantity ?? 0)).length,
      partially_delivered_items: items.filter((i) => Number(i.delivered_qty ?? 0) > 0 && Number(i.delivered_qty ?? 0) < Number(i.quantity ?? 0)).length,
      pending_items: items.filter((i) => Number(i.delivered_qty ?? 0) === 0).length,
    },
    logs,
  });
});

/**
 * POST /orders/:id/confirm-inventory-arrived
 * Manually confirm all inventory has arrived and advance to balance_due.
 * Notifies the inventory group chat.
 */
app.post('/orders/:id/confirm-inventory-arrived', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = completeInventoryVerificationSchema.parse(request.body);

  // Verify action token and extract email
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  const orderRows = await query(`SELECT current_stage, quotation_number, client_name, order_type, balance_verified, partial_delivery FROM orders WHERE id = $1`, [id]);
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });
  if (orderRows[0].current_stage !== 'inventory_arrived') {
    return reply.code(400).send({ error: 'Order is not in inventory arrival stage' });
  }

  // Stock replenishment orders complete at inventory_arrived - no balance/delivery needed.
  // Fully paid + balance-verified orders skip balance_due and move straight to delivery scheduling.
  const isReplenishment = orderRows[0].order_type === 'stock_replenishment';
  const isBalanceAlreadyVerified = orderRows[0].balance_verified === true;
  const isPartialDelivery = orderRows[0].partial_delivery === true;
  const nextStage = isReplenishment ? 'completed' : (isBalanceAlreadyVerified ? 'delivery_pending' : 'balance_due');
  const stageRemark = isReplenishment
    ? 'Inventory arrived and confirmed. Stock replenishment complete.'
    : isBalanceAlreadyVerified
      ? 'Inventory arrival confirmed. Full payment/balance already verified; proceeding to delivery pending.'
      : 'Inventory arrival confirmed. Proceeding to balance due.';


  // Preserve existing inventory_verification_pct for partial delivery orders
  // so the partial verification percentage is not overwritten
  await query(
    `UPDATE orders SET current_stage = $1, inventory_verified_at = NOW(),
     inventory_verification_pct = CASE WHEN $3 = TRUE THEN inventory_verification_pct ELSE 100 END,
     updated_at = NOW()
     WHERE id = $2`,
    [nextStage, id, isPartialDelivery]
  );

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, $2, 'auto_advanced', $3, 'inventory-agent')`,
    [id, nextStage, stageRemark]
  );

  // Complete reminders for inventory_arrived
  await query(
    `UPDATE reminders SET status = 'completed', updated_at = NOW()
     WHERE order_id = $1 AND status = 'active' AND stage = 'inventory_arrived'`,
    [id]
  );

  // Fire agents for the new stage
  triggerAgentsForStage(nextStage, orderRows[0].quotation_number, orderRows[0].client_name);

  // Notify escalation group
  await notifyManualChange(
    'Inventory arrival confirmed',
    `Quotation: *${orderRows[0].quotation_number ?? 'N/A'}*\nClient: *${orderRows[0].client_name ?? 'Unknown'}*\nAdvanced to: ${isReplenishment ? 'Completed (stock replenishment)' : (isBalanceAlreadyVerified ? 'Delivery Pending' : 'Balance Due')}`,
    userEmail,
  );

  // Notify inventory group chat
  const INVENTORY_GROUP_CHAT_ID = process.env.INVENTORY_GROUP_CHAT_ID;
  if (INVENTORY_GROUP_CHAT_ID) {
    const ref = orderRows[0].quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = orderRows[0].client_name ?? (isReplenishment ? 'Stock Replenishment' : 'Unknown');
    setImmediate(() => {
      notifyGroupChat(
        INVENTORY_GROUP_CHAT_ID,
        isReplenishment
          ? `✅ <b>Stock Replenishment Complete</b>\n\nRef: <b>${ref}</b>\n\nAll inventory has arrived and been confirmed. Order is now Completed.`
          : `✅ <b>Inventory Arrival Confirmed (Dashboard)</b>\n\nQuotation: <b>${ref}</b>\nClient: ${client}\n\nAll inventory has been confirmed as arrived via dashboard. Order is now in ${isBalanceAlreadyVerified ? 'Delivery Pending stage because full payment is verified' : 'Balance Due stage'}.`
      );
    });
  }

  // Notify collection group when entering balance_due
  if (nextStage === 'balance_due' && COLLECTION_CHAT_ID) {
    const ref = orderRows[0].quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = orderRows[0].client_name ?? 'Unknown';
    setImmediate(() => {
      notifyGroupChat(
        COLLECTION_CHAT_ID,
        `💰 <b>Balance Collection Needed</b>\n\nQuotation: <b>${ref}</b>\nClient: ${client}\n\nInventory arrival confirmed. Please collect the balance payment from the client.`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${orderRows[0].quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  return reply.send({ ok: true, message: isReplenishment ? 'Inventory arrived. Stock replenishment marked as completed.' : (isBalanceAlreadyVerified ? 'Inventory arrival confirmed. Advanced to delivery_pending.' : 'Inventory arrival confirmed. Advanced to balance_due.') });
});

// ── Order Items (Item-Level Production Tracking) ─────────────────────
// Phase 2: API endpoints for item-level production tracking
// These endpoints manage order_items and production_update_logs tables.

const orderItemSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  production_status: z.enum(['pending', 'in_progress', 'finished']).optional(),
  en_route_status: z.enum(['not_yet', 'en_route', 'arrived']).optional(),
  estimated_arrival_days: z.number().int().positive().nullable().optional(),
  estimated_production_days: z.number().int().positive().nullable().optional(),
});

const bulkUpsertItemsSchema = z.object({
  items: z.array(orderItemSchema).min(1),
});

const updateItemSchema = z.object({
  name: z.string().min(1).optional(),
  quantity: z.number().int().positive().optional(),
  production_status: z.enum(['pending', 'in_progress', 'finished']).optional(),
  en_route_status: z.enum(['not_yet', 'en_route', 'arrived']).optional(),
  estimated_arrival_days: z.number().int().positive().nullable().optional(),
  estimated_production_days: z.number().int().positive().nullable().optional(),
  action_token: z.string().optional(),
  edit_reason: z.string().trim().min(3).optional(),
  require_reason: z.boolean().optional(),
  updated_by: z.string().trim().min(1).optional(),
});

const addProductionLogSchema = z.object({
  order_item_id: z.string().uuid().nullable().optional(),
  note: z.string().min(1),
  log_type: z.enum(['user', 'agent', 'system']).optional(),
  created_by: z.string().optional(),
});

// GET /orders/:id/items — Get all items for an order
app.get('/orders/:id/items', async (request, reply) => {
  const { id } = request.params as { id: string };

  const rows = await query(
    `SELECT oi.id, oi.order_id, oi.name, oi.quantity,
            COALESCE(oi.verified_qty, 0) AS verified_qty,
            oi.production_status, oi.en_route_status,
            oi.estimated_arrival_days, oi.estimated_production_days,
            oi.production_finished_at, oi.inventory_verified_at, oi.delivered_qty, oi.delivered_at, oi.created_at, oi.updated_at
     FROM order_items oi
     WHERE oi.order_id = $1
     ORDER BY oi.created_at ASC`,
    [id]
  );

  return reply.send({ ok: true, items: rows });
});

// GET /orders/:id/payments — Get all payment records for an order
app.get('/orders/:id/payments', async (request, reply) => {
  const { id } = request.params as { id: string };

  const payments = await query(
    `SELECT id, type, amount, reference_number, paid_by, payment_date,
            image_url, source, verified, verified_at, verified_by, created_at
     FROM payments
     WHERE order_id = $1
     ORDER BY created_at ASC`,
    [id]
  );

  const orderRows = await query(
    `SELECT total_amount FROM orders WHERE id = $1`,
    [id]
  );
  const totalAmount = orderRows[0]?.total_amount ? Number(orderRows[0].total_amount) : null;

  const depositTotal = payments
    .filter((p: any) => p.type === 'deposit')
    .reduce((sum: number, p: any) => sum + Number(p.amount), 0);
  const balanceTotal = payments
    .filter((p: any) => p.type === 'balance')
    .reduce((sum: number, p: any) => sum + Number(p.amount), 0);
  const expectedBalance = totalAmount != null ? totalAmount - depositTotal : null;

  return reply.send({
    ok: true,
    payments,
    totals: {
      deposit: depositTotal,
      balance: balanceTotal,
      expected_balance: expectedBalance,
      remaining_balance: expectedBalance != null ? Math.max(0, expectedBalance - balanceTotal) : null,
    },
  });
});

type ReceiptPaymentRow = {
  id: string;
  order_id: string;
  type: 'deposit' | 'balance';
  amount: number | string;
  reference_number: string | null;
  paid_by: string | null;
  payment_date: string | null;
  image_url: string | null;
  source: string | null;
  verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  quotation_number: string | null;
  client_name: string | null;
  sales_agent: string | null;
  total_amount: number | string | null;
  /** TRUE when the deposit amount covers the entire order total (full payment via deposit flow) */
  deposit_is_full_payment?: boolean | null;
  /** TRUE when the order's balance has been fully settled */
  balance_paid?: boolean | null;
};

function formatReceiptDate(value: string | Date | null | undefined): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleDateString('en-PH');
  return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

function receiptNumberForPayment(payment: { id: string; created_at?: string | null; source?: string | null }): string {
  const date = payment.created_at ? new Date(payment.created_at) : new Date();
  const year = Number.isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear();
  return `AR-${year}-${payment.id.slice(0, 8).toUpperCase()}`;
}

function paymentKindLabel(payment: { type: string; source?: string | null; deposit_is_full_payment?: boolean | null; balance_paid?: boolean | null }): string {
  if (payment.source === 'full_payment') return 'Full Payment';
  if (payment.type === 'deposit' && payment.deposit_is_full_payment) return 'Full Payment';
  // When the order has been fully settled (balance paid via a separate payment),
  // label the deposit receipt as "Full Payment" so it reflects the order's settled status.
  if (payment.type === 'deposit' && payment.balance_paid) return 'Full Payment';
  return payment.type === 'deposit' ? 'Downpayment' : 'Balance Payment';
}

// ── Logo for PDF receipts ────────────────────────────────────────────
const __filename_pdf = fileURLToPath(import.meta.url);
const __dirname_pdf = dirname(__filename_pdf);

function parseJpegDimensions(buf: Buffer): { width: number; height: number; components: number } {
  let i = 2; // skip SOI marker FF D8
  while (i < buf.length - 9) {
    if (buf[i] !== 0xFF) break;
    const marker = buf[i + 1];
    if (
      (marker >= 0xC0 && marker <= 0xC3) ||
      (marker >= 0xC5 && marker <= 0xC7) ||
      (marker >= 0xC9 && marker <= 0xCB) ||
      (marker >= 0xCD && marker <= 0xCF)
    ) {
      return {
        height: buf.readUInt16BE(i + 5),
        width: buf.readUInt16BE(i + 7),
        components: buf[i + 9],
      };
    }
    if (marker === 0xD9 || marker === 0xDA) break;
    const segLen = buf.readUInt16BE(i + 2);
    i += 2 + segLen;
  }
  throw new Error('Could not parse JPEG dimensions');
}

let LOGO_JPEG: Buffer | null = null;
let LOGO_DIMS: { width: number; height: number; components: number } | null = null;

try {
  const logoPath = join(__dirname_pdf, 'assets', 'logo.jpg');
  if (existsSync(logoPath)) {
    LOGO_JPEG = readFileSync(logoPath);
    LOGO_DIMS = parseJpegDimensions(LOGO_JPEG);
    console.log(`[logo] Loaded receipt logo: ${LOGO_DIMS.width}x${LOGO_DIMS.height} (${LOGO_JPEG.length} bytes)`);
  } else {
    console.log('[logo] No logo found at src/assets/logo.jpg — receipts will render without logo');
  }
} catch (err) {
  console.warn('[logo] Failed to load receipt logo:', err);
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\r\n]+/g, ' ');
}

function wrapText(value: string, maxChars = 78): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > maxChars) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function buildAcknowledgementReceiptPdf(data: {
  receiptNumber: string;
  receiptDate: string;
  orderNumber: string;
  clientName: string;
  paymentType: string;
  amount: number;
  salesAgent?: string | null;
  totalAmount?: number | null;
  verified: boolean;
  verifiedBy?: string | null;
  items?: { name: string; quantity: number }[];
  /** When TRUE, suppresses the "balance must be settled before delivery" notice */
  balancePaid?: boolean | null;
}): Buffer {
  const width = 595;
  const height = 842;
  const hasLogo = LOGO_JPEG !== null && LOGO_DIMS !== null;
  // Shift all content down when logo occupies the top area
  const S = hasLogo ? 80 : 0;

  const lines: string[] = [];
  const text = (x: number, y: number, size: number, value: string, font = 'F1') => {
    lines.push(`BT /${font} ${size} Tf ${x} ${y} Td (${escapePdfText(value)}) Tj ET`);
  };
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    lines.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  };
  const rect = (x: number, y: number, w: number, h: number) => {
    lines.push(`${x} ${y} ${w} ${h} re S`);
  };

  lines.push('0.8 w');
  rect(42, 48, width - 84, height - 96);

  // Logo — centered at top inside border
  if (hasLogo) {
    const logoW = 75;
    const logoH = 75;
    const logoX = Math.round((width - logoW) / 2);
    const logoY = 712; // bottom edge of logo image
    lines.push(`q ${logoW} 0 0 ${logoH} ${logoX} ${logoY} cm /Logo Do Q`);
  }

  text(60, 775 - S, 18, 'ACKNOWLEDGEMENT RECEIPT', 'F2');
  text(60, 752 - S, 10, 'This document acknowledges receipt of payment for the order stated below.');
  line(60, 735 - S, 535, 735 - S);

  // Header: receipt number + date
  text(60, 706 - S, 10, 'Receipt No.', 'F2');
  text(160, 706 - S, 10, data.receiptNumber);
  text(340, 706 - S, 10, 'Date', 'F2');
  text(405, 706 - S, 10, data.receiptDate);

  // Order info
  text(60, 682 - S, 10, 'Order / Quotation No.', 'F2');
  text(200, 682 - S, 10, data.orderNumber);
  text(60, 658 - S, 10, 'Client', 'F2');
  text(200, 658 - S, 10, data.clientName);
  text(60, 634 - S, 10, 'Payment Type', 'F2');
  text(200, 634 - S, 10, data.paymentType);

  // Amount box
  rect(60, 555 - S, 475, 55);
  text(80, 588 - S, 11, 'Amount Received', 'F2');
  text(80, 566 - S, 22, `PHP ${data.amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'F2');

  // Details
  text(60, 520 - S, 10, 'Sales Agent', 'F2');
  text(200, 520 - S, 10, data.salesAgent || 'N/A');
  text(60, 496 - S, 10, 'Order Total', 'F2');
  text(200, 496 - S, 10, data.totalAmount != null ? `PHP ${data.totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'N/A');
  text(60, 472 - S, 10, 'Verification Status', 'F2');
  text(200, 472 - S, 10, data.verified ? 'Verified' : 'Pending Verification');

  // Order items summary
  let itemsBottomY = 430 - S;
  const orderItems = data.items ?? [];
  if (orderItems.length > 0) {
    text(60, 448 - S, 10, 'Order Summary', 'F2');
    line(60, 444 - S, 535, 444 - S);
    text(60, 430 - S, 9, 'Product / Item', 'F2');
    text(460, 430 - S, 9, 'Qty', 'F2');
    line(60, 426 - S, 535, 426 - S);
    let rowY = 412 - S;
    for (const item of orderItems.slice(0, 8)) {
      const itemName = item.name.length > 55 ? item.name.slice(0, 52) + '...' : item.name;
      text(60, rowY, 9, itemName);
      text(460, rowY, 9, String(item.quantity));
      rowY -= 16;
    }
    if (orderItems.length > 8) {
      text(60, rowY, 9, `... and ${orderItems.length - 8} more item(s)`);
      rowY -= 16;
    }
    line(60, rowY + 4, 535, rowY + 4);
    itemsBottomY = rowY - 8;
  }

  // Acknowledgement text
  const acknowledgement = `Received from ${data.clientName} the amount of PHP ${data.amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} as ${data.paymentType.toLowerCase()} for order ${data.orderNumber}.`;
  text(60, itemsBottomY - 8, 10, 'Acknowledgement', 'F2');
  const ackLines = wrapText(acknowledgement, 80);
  ackLines.forEach((wrapped, index) => text(60, itemsBottomY - 28 - index * 16, 10, wrapped));

  // Track where content ends so Prepared By always renders below everything
  let contentBottomY = itemsBottomY - 28 - (ackLines.length - 1) * 16;

  // Balance notice: only for partial downpayments where balance has NOT yet been settled.
  // Suppressed when:
  //   • paymentType is 'Full Payment' (entire amount paid at once — nothing more owed), OR
  //   • balancePaid = TRUE (balance has since been fully settled via a separate payment)
  if (data.paymentType === 'Downpayment' && !data.balancePaid) {
    const noticeY = contentBottomY - 20;
    text(60, noticeY, 9, 'Important: Balance payment must be settled in full before delivery can be arranged.', 'F2');
    contentBottomY = noticeY;
  }

  // Prepared By — always below all content, centered, blank for handwriting
  const preparedByY = contentBottomY - 40;
  text(248, preparedByY, 10, 'Prepared By:', 'F2');
  line(180, preparedByY - 36, 415, preparedByY - 36);
  text(248, preparedByY - 51, 9, 'Name / Signature');

  const content = lines.join('\n');

  // Build PDF objects — object 7 is the logo XObject (if logo present)
  const xobjResources = hasLogo ? ' /XObject << /Logo 7 0 R >>' : '';
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >>${xobjResources} >> /Contents 6 0 R >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  objects.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);

  // Build PDF string (latin1 is bijective — binary JPEG bytes survive round-trip)
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });

  // Append image XObject inline if logo available
  if (hasLogo) {
    const colorSpace = LOGO_DIMS!.components === 1 ? '/DeviceGray' : '/DeviceRGB';
    const logoStr = LOGO_JPEG!.toString('latin1');
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `7 0 obj\n<< /Type /XObject /Subtype /Image /Width ${LOGO_DIMS!.width} /Height ${LOGO_DIMS!.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${LOGO_JPEG!.length} >>\nstream\n${logoStr}\nendstream\nendobj\n`;
  }

  const totalObjs = objects.length + (hasLogo ? 1 : 0);
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

async function getReceiptPaymentById(paymentId: string): Promise<ReceiptPaymentRow | null> {
  const rows = await query<ReceiptPaymentRow>(
    `SELECT p.id, p.order_id, p.type, p.amount, p.reference_number, p.paid_by, p.payment_date,
            p.image_url, p.source, p.verified, p.verified_at, p.verified_by, p.created_at,
            o.quotation_number, o.client_name, o.sales_agent, o.total_amount, o.balance_paid,
            (p.type = 'deposit' AND o.total_amount IS NOT NULL
             AND CAST(p.amount AS NUMERIC) >= CAST(o.total_amount AS NUMERIC)) AS deposit_is_full_payment
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     WHERE p.id = $1`,
    [paymentId]
  );
  return rows[0] ?? null;
}

async function getReceiptAmount(payment: ReceiptPaymentRow): Promise<number> {
  // Case 1: The payment itself is a full_payment record — sum all payments for this order
  // (handles both source='full_payment' and source=<user-email> from dashboard full-payment flow)
  if (payment.source === 'full_payment') {
    const rows = await query<{ total: string | number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM payments
       WHERE order_id = $1
         AND source = 'full_payment'
         AND COALESCE(reference_number, '') = COALESCE($2, '')
         AND COALESCE(payment_date::text, '') = COALESCE($3::text, '')
         AND ABS(EXTRACT(EPOCH FROM (created_at - $4::timestamptz))) < 5`,
      [payment.order_id, payment.reference_number ?? '', payment.payment_date ?? '', payment.created_at]
    );
    return Number(rows[0]?.total ?? payment.amount);
  }

  // Case 2: Deposit covers the full order total (deposit_is_full_payment) — show total_amount
  if (payment.deposit_is_full_payment && payment.total_amount != null) {
    return Number(payment.total_amount);
  }

  // Case 3: Order is fully settled (balance_paid) — show total_amount
  if (payment.balance_paid && payment.total_amount != null) {
    return Number(payment.total_amount);
  }

  // Case 4: Regular individual payment — show just this payment's amount
  return Number(payment.amount);
}

// GET /payments/acknowledgement-receipts — List downloadable acknowledgement receipts for recorded payments
app.get('/payments/acknowledgement-receipts', async (request, reply) => {
  const limit = Math.min(Math.max(Number((request.query as any)?.limit ?? 50), 1), 200);
  const rows = await query<ReceiptPaymentRow & { full_group_total?: string | number; has_full_deposit_pair?: boolean }>(
    `WITH full_groups AS (
       SELECT order_id, COALESCE(reference_number, '') AS ref_key, COALESCE(payment_date::text, '') AS date_key,
              SUM(amount) AS full_group_total,
              BOOL_OR(type = 'deposit') AS has_deposit
       FROM payments
       WHERE source = 'full_payment'
       GROUP BY order_id, COALESCE(reference_number, ''), COALESCE(payment_date::text, '')
     )
     SELECT p.id, p.order_id, p.type, p.amount, p.reference_number, p.paid_by, p.payment_date,
            p.image_url, p.source, p.verified, p.verified_at, p.verified_by, p.created_at,
            o.quotation_number, o.client_name, o.sales_agent, o.total_amount, o.balance_paid,
            (p.type = 'deposit' AND o.total_amount IS NOT NULL
             AND CAST(p.amount AS NUMERIC) >= CAST(o.total_amount AS NUMERIC)) AS deposit_is_full_payment,
            fg.full_group_total,
            COALESCE(fg.has_deposit, FALSE) AS has_full_deposit_pair
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     LEFT JOIN full_groups fg ON fg.order_id = p.order_id
       AND fg.ref_key = COALESCE(p.reference_number, '')
       AND fg.date_key = COALESCE(p.payment_date::text, '')
     WHERE NOT (p.source = 'full_payment' AND p.type = 'balance' AND COALESCE(fg.has_deposit, FALSE))
       AND (p.type != 'balance' OR p.verified = TRUE)
     ORDER BY p.created_at DESC
     LIMIT $1`,
    [limit]
  );

  const receipts = rows.map((p) => {
    // Determine the display amount for the receipt list
    let displayAmount: number;
    if (p.source === 'full_payment') {
      // Full-payment source: use the grouped total (deposit + balance portions)
      displayAmount = Number(p.full_group_total ?? p.amount);
    } else if (p.deposit_is_full_payment && p.total_amount != null) {
      // Deposit covers full order total: show total_amount
      displayAmount = Number(p.total_amount);
    } else if (p.balance_paid && p.total_amount != null) {
      // Order fully settled: show total_amount
      displayAmount = Number(p.total_amount);
    } else {
      // Regular individual payment
      displayAmount = Number(p.amount);
    }

    return {
      payment_id: p.id,
      receipt_number: receiptNumberForPayment(p),
      order_id: p.order_id,
      quotation_number: p.quotation_number,
      client_name: p.client_name,
      payment_type: paymentKindLabel(p),
      amount: displayAmount,
      payment_date: p.payment_date,
      reference_number: p.reference_number,
      source: p.source,
      verified: p.verified,
      created_at: p.created_at,
      download_url: `/payments/${p.id}/acknowledgement-receipt.pdf`,
    };
  });

  return reply.send({ ok: true, receipts });
});

// GET /payments/:id/acknowledgement-receipt.pdf — Download a PDF acknowledgement receipt for a payment
app.get('/payments/:id/acknowledgement-receipt.pdf', async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const payment = await getReceiptPaymentById(id);
  if (!payment) return reply.code(404).send({ error: 'Payment not found' });

  // Only allow PDF download for verified balance payments
  if (payment.type === 'balance' && !payment.verified) {
    return reply.code(403).send({ error: 'Acknowledgement receipt is only available after balance payment has been verified.' });
  }

  const amount = await getReceiptAmount(payment);
  const receiptNumber = receiptNumberForPayment(payment);
  const orderNumber = payment.quotation_number ?? `Order ${payment.order_id.slice(0, 8)}`;

  // Fetch order items for the summary section
  const itemRows = await query<{ name: string; quantity: number }>(
    `SELECT name, quantity FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
    [payment.order_id]
  );

  const pdf = buildAcknowledgementReceiptPdf({
    receiptNumber,
    receiptDate: formatReceiptDate(payment.payment_date ?? payment.created_at),
    orderNumber,
    clientName: payment.client_name ?? 'Unknown Client',
    paymentType: paymentKindLabel(payment),
    amount,
    salesAgent: payment.sales_agent,
    totalAmount: payment.total_amount != null ? Number(payment.total_amount) : null,
    verified: payment.verified,
    verifiedBy: payment.verified_by,
    items: itemRows,
    balancePaid: payment.balance_paid ?? false,
  });

  return reply
    .header('Content-Type', 'application/pdf')
    .header('Content-Disposition', `attachment; filename="${receiptNumber}-${orderNumber.replace(/[^a-zA-Z0-9_-]+/g, '_')}.pdf"`)
    .send(pdf);
});

// PATCH /payments/:id/verify — Verify a specific payment record
app.patch('/payments/:id/verify', async (request, reply) => {
  try {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      verified_by: z.string(),
      action_token: z.string(),
    }).parse(request.body);

    // Verify action token
    let userEmail: string | null = null;
    if (!cacheClient?.isOpen) {
      return reply.status(503).send({ error: 'Action verification unavailable' });
    }
    const tokenKey = `action_token:${body.action_token}`;
    const tokenData = await cacheClient.get(tokenKey);
    if (!tokenData) {
      return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    }
    await cacheClient.del(tokenKey);
    try {
      const tokenPayload = JSON.parse(tokenData);
      userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
    } catch { /* non-fatal */ }

    // Get payment and order info
    const paymentRows = await query(
      `SELECT p.*, o.quotation_number, o.client_name
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.id = $1`,
      [params.id]
    );
    if (!paymentRows[0]) {
      return reply.code(404).send({ error: 'Payment not found' });
    }
    const payment = paymentRows[0];
    const orderId = payment.order_id;
    const verifier = userEmail ?? body.verified_by;

    // Verify this payment
    await query(
      `UPDATE payments SET verified=TRUE, verified_at=NOW(), verified_by=$2, updated_at=NOW() WHERE id=$1`,
      [params.id, verifier]
    );

    // Check if ALL payments of this type are now verified
    const unverifiedCount = await query(
      `SELECT COUNT(*) as count FROM payments WHERE order_id=$1 AND type=$2 AND verified=FALSE`,
      [orderId, payment.type]
    );
    const allVerified = Number(unverifiedCount[0].count) === 0;

    // Update order-level verification flag if all payments of this type are verified
    if (allVerified) {
      // Also fetch the order's current stage to determine the correct next stage
      const orderRows = await query(
        `SELECT current_stage, balance_paid, order_type FROM orders WHERE id = $1`,
        [orderId]
      );
      const orderStage = orderRows[0]?.current_stage ?? '';
      const orderBalancePaid = !!orderRows[0]?.balance_paid;
      const isFromStock = orderRows[0]?.order_type === 'from_stock';

      if (payment.type === 'deposit') {
        // Determine next stage: if balance is also paid, go to balance_verification
        const nextStage = orderBalancePaid
          ? 'balance_verification'
          : isFromStock
            ? 'stock_preparation'
            : 'purchasing_pending';
        await query(
          `UPDATE orders SET deposit_verified=TRUE, deposit_verified_at=NOW(), deposit_verified_by=$2, current_stage=$3, updated_at=NOW() WHERE id=$1`,
          [orderId, verifier, nextStage]
        );
        await query(
          `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
           VALUES ($1, 'deposit_verification', 'deposit_verified', $2, $3)`,
          [orderId, `Deposit verified via payment record. Advancing to ${nextStage}.`, verifier]
        );
      } else if (payment.type === 'balance') {
        // Determine next stage based on current stage
        const nextStage = (orderStage === 'delivered' || orderStage === 'countered')
          ? 'payment_received'
          : (orderStage === 'balance_due' || orderStage === 'inventory_arrived' || orderStage === 'delivery_scheduled' || orderStage === 'balance_verification')
            ? 'delivery_pending'
            : orderStage;
        await query(
          `UPDATE orders SET balance_verified=TRUE, balance_verified_at=NOW(), balance_verified_by=$2, current_stage=$3, updated_at=NOW() WHERE id=$1`,
          [orderId, verifier, nextStage]
        );
        await query(
          `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
           VALUES ($1, $2, 'balance_verified', $3, $4)`,
          [orderId, nextStage, `Balance verified via payment record. Advancing to ${nextStage}.`, verifier]
        );
      }
    }

    await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
    broadcastSSE('order_updated', { id: orderId });

    await notifyManualChange(
      `✅ Payment verified`,
      `Quotation: *${payment.quotation_number ?? orderId}*\nClient: ${payment.client_name ?? '—'}\nType: ${payment.type}\nAmount: ₱${Number(payment.amount).toLocaleString()}\nVerified by: ${verifier}`,
      userEmail,
    );

    return reply.send({ ok: true, payment: { ...payment, verified: true, verified_at: new Date().toISOString(), verified_by: verifier } });
  } catch (err: any) {
    console.error('[payments/verify] Error:', err);
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: `Validation error: ${err.errors.map(e => e.message).join(', ')}` });
    }
    return reply.status(500).send({ error: err?.message ?? 'Verification failed' });
  }
});

// POST /orders/:id/items — Bulk upsert items (from Hermes extraction or manual)
app.post('/orders/:id/items', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = bulkUpsertItemsSchema.parse(request.body);

  // Verify order exists
  const orderRows = await query(
    `SELECT id, quotation_number FROM orders WHERE id = $1`,
    [id]
  );
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });

  // Delete existing items and re-insert (bulk replace)
  await query(`DELETE FROM order_items WHERE order_id = $1`, [id]);

  for (const item of body.items) {
    await query(
      `INSERT INTO order_items (order_id, name, quantity, production_status, en_route_status, estimated_arrival_days, production_finished_at)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $4 = 'finished' THEN NOW() ELSE NULL END)`,
      [id, item.name, item.quantity,
       item.production_status ?? 'pending',
       item.en_route_status ?? 'not_yet',
       item.estimated_arrival_days ?? null]
    );
  }

  // Log the action
  await query(
    `INSERT INTO production_update_logs (order_id, note, log_type, created_by)
     VALUES ($1, $2, 'system', 'api')`,
    [id, `Items updated: ${body.items.map(i => `${i.name} x${i.quantity}`).join(', ')}`]
  );

  // Fetch and return the new items
  const items = await query(
    `SELECT id, order_id, name, quantity, production_status, en_route_status,
            estimated_arrival_days, estimated_production_days, production_finished_at, inventory_verified_at, delivered_qty, delivered_at, created_at, updated_at
     FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
    [id]
  );

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });
  return reply.send({ ok: true, items });
});

// POST /orders/:id/items/manual — Add one manually-created tracking item without replacing existing items
app.post('/orders/:id/items/manual', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = orderItemSchema.extend({
    edit_reason: z.string().trim().min(3).optional(),
    updated_by: z.string().trim().min(1).optional(),
  }).parse(request.body);

  const reason = body.edit_reason?.trim();
  if (!reason) {
    return reply.code(400).send({ error: 'A reason is required when manually adding item tracking.' });
  }

  const orderRows = await query(
    `SELECT id, quotation_number FROM orders WHERE id = $1`,
    [id]
  );
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });

  const rows = await query(
    `INSERT INTO order_items (
       order_id, name, quantity, production_status, en_route_status,
       estimated_arrival_days, estimated_production_days, production_finished_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $4 = 'finished' THEN NOW() ELSE NULL END)
     RETURNING id, order_id, name, quantity, production_status, en_route_status,
               estimated_arrival_days, estimated_production_days, production_finished_at,
               inventory_verified_at, delivered_qty, delivered_at, created_at, updated_at`,
    [
      id,
      body.name,
      body.quantity,
      body.production_status ?? 'pending',
      body.en_route_status ?? 'not_yet',
      body.estimated_arrival_days ?? null,
      body.estimated_production_days ?? null,
    ]
  );

  const item = rows[0] as any;
  const actor = body.updated_by ?? 'dashboard';
  await query(
    `INSERT INTO production_update_logs (order_id, order_item_id, note, log_type, created_by)
     VALUES ($1, $2, $3, 'user', $4)`,
    [id, item.id, `Manual item tracking added: ${item.name} x${item.quantity}. Reason: ${reason}`, actor]
  );

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });
  return reply.send({ ok: true, item });
});

// PATCH /orders/:order_id/items/:item_id — Update a single item
app.patch('/orders/:order_id/items/:item_id', async (request, reply) => {
  const { order_id, item_id } = request.params as { order_id: string; item_id: string };
  const body = updateItemSchema.parse(request.body);

  // If action_token is provided, verify it (optional — Telegram bot calls without token)
  let userEmail: string | null = null;
  if (body.action_token) {
    if (!cacheClient?.isOpen) {
      return reply.status(503).send({ error: 'Action verification unavailable' });
    }
    const tokenKey = `action_token:${body.action_token}`;
    const tokenData = await cacheClient.get(tokenKey);
    if (!tokenData) {
      return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    }
    await cacheClient.del(tokenKey);
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  }

  const oldRows = await query(
    `SELECT id, order_id, name, quantity, production_status, en_route_status,
            estimated_arrival_days, estimated_production_days
     FROM order_items
     WHERE id = $1 AND order_id = $2`,
    [item_id, order_id]
  );
  const oldItem = oldRows[0] as any;
  if (!oldItem) return reply.code(404).send({ error: 'Item not found' });

  const editFields = [
    'name',
    'quantity',
    'production_status',
    'en_route_status',
    'estimated_arrival_days',
    'estimated_production_days',
  ] as const;
  const hasTrackedEdit = editFields.some((field) => body[field] !== undefined);
  if ((body.require_reason || body.name !== undefined || body.quantity !== undefined) && hasTrackedEdit && !body.edit_reason?.trim()) {
    return reply.code(400).send({ error: 'A reason is required when editing item tracking.' });
  }

  // Build dynamic SET clause
  const setClauses: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (body.name !== undefined) {
    setClauses.push(`name = $${idx++}`);
    values.push(body.name);
  }
  if (body.quantity !== undefined) {
    setClauses.push(`quantity = $${idx++}`);
    values.push(body.quantity);
  }
  if (body.production_status !== undefined) {
    setClauses.push(`production_status = $${idx++}`);
    values.push(body.production_status);
    if (body.production_status === 'finished') {
      setClauses.push(`production_finished_at = COALESCE(production_finished_at, NOW())`);
    } else {
      setClauses.push(`production_finished_at = NULL`);
    }
  }
  if (body.en_route_status !== undefined) {
    setClauses.push(`en_route_status = $${idx++}`);
    values.push(body.en_route_status);
  }
  if (body.estimated_arrival_days !== undefined) {
    setClauses.push(`estimated_arrival_days = $${idx++}`);
    values.push(body.estimated_arrival_days);
  }
  if (body.estimated_production_days !== undefined) {
    setClauses.push(`estimated_production_days = $${idx++}`);
    values.push(body.estimated_production_days);
  }

  if (setClauses.length === 0) {
    return reply.code(400).send({ error: 'No fields to update' });
  }

  setClauses.push(`updated_at = NOW()`);
  values.push(item_id);
  values.push(order_id);

  const rows = await query(
    `UPDATE order_items SET ${setClauses.join(', ')}
     WHERE id = $${idx++} AND order_id = $${idx}
     RETURNING id, order_id, name, quantity, production_status, en_route_status,
               estimated_arrival_days, estimated_production_days, production_finished_at, inventory_verified_at, delivered_qty, delivered_at, created_at, updated_at`,
    values
  );

  if (!rows[0]) return reply.code(404).send({ error: 'Item not found' });

  const updatedItem = rows[0] as any;

  if (body.edit_reason?.trim()) {
    const changes = editFields
      .filter((field) => body[field] !== undefined && String(oldItem[field] ?? '') !== String((body as any)[field] ?? ''))
      .map((field) => `${field}: ${oldItem[field] ?? '—'} → ${(body as any)[field] ?? '—'}`);
    if (changes.length > 0) {
      await query(
        `INSERT INTO production_update_logs (order_id, order_item_id, note, log_type, created_by)
         VALUES ($1, $2, $3, 'user', $4)`,
        [
          order_id,
          item_id,
          `Item tracking edited (${changes.join('; ')}). Reason: ${body.edit_reason.trim()}`,
          body.updated_by ?? userEmail ?? 'dashboard',
        ]
      );
    }
  }

  // ── Item-Level Reminder Management ──────────────────────────────────
  // When production_status or en_route_status changes, create or complete
  // item-level reminders so the bot keeps reminding until resolved.
  const PURCHASING_GROUP_CHAT_ID = process.env.PURCHASING_GROUP_CHAT_ID;
  if (PURCHASING_GROUP_CHAT_ID && (body.production_status !== undefined || body.en_route_status !== undefined)) {
    // Fetch order details for the reminder message
    const orderRows = await query(
      `SELECT quotation_number, client_name FROM orders WHERE id = $1`,
      [order_id]
    );
    const orderRef = orderRows[0]?.quotation_number ?? `Order #${order_id.slice(0, 8)}`;
    const client = orderRows[0]?.client_name ?? 'Unknown';

    // Production status changes
    if (body.production_status !== undefined) {
      if (body.production_status === 'pending') {
        // Item marked as not yet produced — create a reminder
        await query(
          `SELECT create_item_reminder($1, $2, 'item_level_production', $3, $4)`,
          [
            order_id,
            item_id,
            PURCHASING_GROUP_CHAT_ID,
            `🏗️ *Item Production Pending* — ${orderRef} (${client})\nItem: *${updatedItem.name}* x${updatedItem.quantity}\nThis item has not yet started production. Please update when production begins.`,
          ]
        );
      } else if (body.production_status === 'finished') {
        // Item finished — complete the reminder
        await query(
          `SELECT complete_item_reminder($1, $2, 'item_level_production')`,
          [order_id, item_id]
        );
      }
    }

    // En route status changes
    if (body.en_route_status !== undefined) {
      if (body.en_route_status === 'not_yet') {
        // Item not yet en route — create a reminder
        await query(
          `SELECT create_item_reminder($1, $2, 'item_level_en_route', $3, $4)`,
          [
            order_id,
            item_id,
            PURCHASING_GROUP_CHAT_ID,
            `🚚 *Item En Route Pending* — ${orderRef} (${client})\nItem: *${updatedItem.name}* x${updatedItem.quantity}\nThis item has not yet been sent en route. Please update when it ships.`,
          ]
        );
      } else if (body.en_route_status === 'arrived') {
        // Item arrived — complete the reminder
        await query(
          `SELECT complete_item_reminder($1, $2, 'item_level_en_route')`,
          [order_id, item_id]
        );
        // Notify inventory group chat that an item has arrived
        const INVENTORY_GROUP_CHAT_ID = process.env.INVENTORY_GROUP_CHAT_ID;
        if (INVENTORY_GROUP_CHAT_ID) {
          setImmediate(() => {
            notifyGroupChat(
              INVENTORY_GROUP_CHAT_ID,
              `📦 <b>Item Arrived (Dashboard)</b>\n\n` +
              `Quotation: <b>${orderRef}</b>\n` +
              `Client: ${client}\n\n` +
              `Item: <b>${updatedItem.name}</b> x${updatedItem.quantity}\n` +
              `Status: Arrived at inventory`
            );
          });
        }
      }
    }
  }

  // ── Auto-advance when all items are dispatched ──────────────────────
  if (body.en_route_status !== undefined) {
    await advanceToEnRouteIfAllDispatched(
      order_id,
      'item_update',
      `Item en_route_status updated to ${body.en_route_status} — checking if all items dispatched`,
    );
    // Also advance from en_route → en_route_verification when order is already in en_route
    // and all items are now dispatched (advanceToEnRouteIfAllDispatched skips this case)
    await advanceFromEnRouteToVerificationIfAllDispatched(
      order_id,
      'item_update',
    );
    // Advance en_route_verification → inventory_verification when all items are marked arrived
    if (body.en_route_status === 'arrived') {
      await advanceToInventoryVerificationIfAllArrived(order_id, 'item_update');
    }
  }

  // ── Item-Level Production Timeline Reminders ────────────────────────
  // When an item starts production with estimated days, create midpoint
  // and due reminders. When finished, complete them. When days updated,
  // recalculate the due reminder.
  const PRODUCTION_CHAT_ID = process.env.PRODUCTION_GROUP_CHAT_ID ?? process.env.PURCHASING_GROUP_CHAT_ID;
  if (PRODUCTION_CHAT_ID && (body.production_status !== undefined || body.estimated_production_days !== undefined)) {
    const days = body.estimated_production_days ?? updatedItem.estimated_production_days ?? null;
    const status = body.production_status ?? updatedItem.production_status ?? null;

    if (status === 'in_progress' && days && days > 0) {
      const orderRows = await query(
        `SELECT quotation_number, client_name FROM orders WHERE id = $1`,
        [order_id]
      );
      const orderRef = orderRows[0]?.quotation_number ?? `Order #${order_id.slice(0, 8)}`;
      const client = orderRows[0]?.client_name ?? 'Unknown';

      const midpointDays = Math.max(1, Math.floor(days / 2));
      const midpointDate = new Date();
      midpointDate.setDate(midpointDate.getDate() + midpointDays);
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + days);

      // Midpoint reminder
      await query(
        `INSERT INTO reminders (order_id, item_id, stage, group_chat_id, message, frequency, next_run_at, status)
         VALUES ($1, $2, 'item_prod_midpoint', $3, $4, 'once', $5, 'active')
         ON CONFLICT (order_id, stage, item_id) WHERE item_id IS NOT NULL
         DO UPDATE SET
           group_chat_id = EXCLUDED.group_chat_id,
           message = EXCLUDED.message,
           next_run_at = EXCLUDED.next_run_at,
           status = 'active',
           updated_at = NOW()`,
        [
          order_id, item_id, PRODUCTION_CHAT_ID,
          `🏭 *Item Production Midpoint* — ${orderRef} (${client})\nItem: *${updatedItem.name}* x${updatedItem.quantity}\n${days}d timeline — halfway check. Is this item on track?`,
          midpointDate.toISOString(),
        ]
      );

      // Due reminder
      await query(
        `INSERT INTO reminders (order_id, item_id, stage, group_chat_id, message, frequency, next_run_at, status)
         VALUES ($1, $2, 'item_prod_due', $3, $4, 'once', $5, 'active')
         ON CONFLICT (order_id, stage, item_id) WHERE item_id IS NOT NULL
         DO UPDATE SET
           group_chat_id = EXCLUDED.group_chat_id,
           message = EXCLUDED.message,
           next_run_at = EXCLUDED.next_run_at,
           status = 'active',
           updated_at = NOW()`,
        [
          order_id, item_id, PRODUCTION_CHAT_ID,
          `🏭 *Item Production Due* — ${orderRef} (${client})\nItem: *${updatedItem.name}* x${updatedItem.quantity}\n${days}d timeline — due date reached. Is this item finished?`,
          dueDate.toISOString(),
        ]
      );
    } else if (status === 'finished') {
      // Complete timeline reminders when item is finished
      await query(
        `UPDATE reminders SET status = 'completed', updated_at = NOW()
         WHERE order_id = $1 AND item_id = $2 AND stage IN ('item_prod_midpoint', 'item_prod_due') AND status = 'active'`,
        [order_id, item_id]
      );
    }
  }

  // Auto-advance order stage based on item production_status changes
  // production_pending: any item starts -> partial_production
  //                     all items start -> production_in_progress (skip partial)
  // partial_production: all items start -> production_in_progress
  // NOTE: Auto-advance to production_finished is REMOVED — finish is manual only
  if (body.production_status !== undefined) {
    const stageRows = await query<{ id: string; current_stage: string; quotation_number: string | null; client_name: string | null }>(
      `SELECT id, current_stage, quotation_number, client_name FROM orders WHERE id = $1`,
      [order_id]
    );
    const currentOrder = stageRows[0];

    if (currentOrder && ['production_pending', 'partial_production', 'production_in_progress'].includes(currentOrder.current_stage)) {
      const allItemStatuses = await query<{ production_status: string; name: string }>(
        `SELECT production_status, name FROM order_items WHERE order_id = $1`,
        [order_id]
      );

      if (allItemStatuses.length > 0) {
        const allStarted = allItemStatuses.every((i) => i.production_status !== 'pending');
        const anyStarted = allItemStatuses.some((i) => i.production_status !== 'pending');
        const pendingNames = allItemStatuses.filter((i) => i.production_status === 'pending').map((i) => i.name);

        if (allStarted && currentOrder.current_stage !== 'production_in_progress') {
          // All items in progress - advance to production_in_progress
          await query(
            `UPDATE orders SET current_stage = 'production_in_progress', production_started = TRUE,
             production_started_at = COALESCE(production_started_at, NOW()), partial_production_items = '[]'::jsonb, updated_at = NOW()
             WHERE id = $1`,
            [order_id]
          );
          await query(
            `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
             VALUES ($1, 'production_in_progress', 'auto', $2, 'system')`,
            [order_id, `All items started production - auto-advanced from ${currentOrder.current_stage}`]
          );
          triggerAgentsForStage('production_in_progress', currentOrder.quotation_number ?? undefined, currentOrder.client_name ?? undefined);
        } else if (anyStarted && currentOrder.current_stage === 'production_pending') {
          // Some items started - advance to partial_production
          await query(
            `UPDATE orders
             SET current_stage = 'partial_production',
                 partial_production_items = $1,
                 updated_at = NOW()
             WHERE id = $2`,
            [JSON.stringify(pendingNames), order_id]
          );
          await query(
            `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
             VALUES ($1, 'partial_production', 'auto', $2, 'system')`,
            [order_id, `Partial production started ? pending: ${pendingNames.join(', ')}`]
          );
          triggerAgentsForStage('partial_production', currentOrder.quotation_number ?? undefined, currentOrder.client_name ?? undefined);
        }
      }
    }
  }

  // Touch orders.updated_at so SWR-fetched order objects reflect the item change.
  // This lets components that depend on order.updated_at (e.g. ProductionInfoCards)
  // detect the change and re-fetch their own item lists without a full stage change.
  await query(`UPDATE orders SET updated_at = NOW() WHERE id = $1`, [order_id]);

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { order_id });
  return reply.send({ ok: true, item: updatedItem });
});

// GET /orders/:id/items/completion — Get completion percentages
app.get('/orders/:id/items/completion', async (request, reply) => {
  const { id } = request.params as { id: string };

  const rows = await query(
    `SELECT
       get_production_completion_pct($1) AS production_pct,
       get_en_route_completion_pct($1) AS en_route_pct,
       get_inventory_completion_pct($1) AS inventory_pct`,
    [id]
  );

  return reply.send({
    ok: true,
    order_id: id,
    production_completion_pct: rows[0]?.production_pct ?? 0,
    en_route_completion_pct: rows[0]?.en_route_pct ?? 0,
    inventory_completion_pct: rows[0]?.inventory_pct ?? 0,
  });
});

// GET /orders/:id/production-logs — Get production update logs
app.get('/orders/:id/production-logs', async (request, reply) => {
  const { id } = request.params as { id: string };

  const rows = await query(
    `SELECT pl.id, pl.order_item_id, pl.order_id, pl.note, pl.log_type,
            pl.created_by, pl.created_at,
            oi.name AS item_name
     FROM production_update_logs pl
     LEFT JOIN order_items oi ON oi.id = pl.order_item_id
     WHERE pl.order_id = $1
     ORDER BY pl.created_at DESC
     LIMIT 100`,
    [id]
  );

  return reply.send({ ok: true, logs: rows });
});

// POST /orders/:id/production-logs — Add a production update log
app.post('/orders/:id/production-logs', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = addProductionLogSchema.parse(request.body);

  // Verify order exists
  const orderRows = await query(
    `SELECT id FROM orders WHERE id = $1`,
    [id]
  );
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });

  // If order_item_id provided, verify it belongs to this order
  if (body.order_item_id) {
    const itemRows = await query(
      `SELECT id FROM order_items WHERE id = $1 AND order_id = $2`,
      [body.order_item_id, id]
    );
    if (!itemRows[0]) return reply.code(404).send({ error: 'Item not found for this order' });
  }

  const rows = await query(
    `INSERT INTO production_update_logs (order_item_id, order_id, note, log_type, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, order_item_id, order_id, note, log_type, created_by, created_at`,
    [body.order_item_id ?? null, id, body.note, body.log_type ?? 'user', body.created_by ?? null]
  );

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });
  return reply.send({ ok: true, log: rows[0] });
});

// ── Item Extraction from Quotation ────────────────────────────────────
// Phase 3: Hermes Claw extracts items from quotation using Gemini Vision

app.post('/orders/:id/extract-items', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = z.object({ action_token: z.string() }).parse(request.body);

  // Verify action token
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);

  // Get the order's quotation number
  const orderRows = await query(
    `SELECT id, quotation_number, client_name FROM orders WHERE id = $1`,
    [id]
  );
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });
  const order = orderRows[0] as any;

  if (!order.quotation_number) {
    return reply.code(400).send({ error: 'Order has no quotation number — cannot extract items' });
  }

  // Dynamically import to avoid circular dependency at module level
  const { extractItemsFromQuotation } = await import('./services/hermesClaw.js');

  const result = await extractItemsFromQuotation(order.quotation_number);

  if (!result.ok) {
    return reply.send({
      ok: false,
      items: [],
      error: result.error ?? 'Failed to extract items from quotation',
      raw_text: result.raw_text,
    });
  }

  // Auto-upsert extracted items into order_items table
  if (result.items.length > 0) {
    // Delete existing items and re-insert
    await query(`DELETE FROM order_items WHERE order_id = $1`, [id]);

    for (const item of result.items) {
      await query(
        `INSERT INTO order_items (order_id, name, quantity, production_status, en_route_status)
         VALUES ($1, $2, $3, 'pending', 'not_yet')`,
        [id, item.name, item.quantity]
      );
    }

    // Log the extraction
    await query(
      `INSERT INTO production_update_logs (order_id, note, log_type, created_by)
       VALUES ($1, $2, 'agent', 'Hermes Claw')`,
      [id, `🧠 Hermes Claw extracted ${result.items.length} item(s) from quotation: ${result.items.map(i => `${i.name} x${i.quantity}`).join(', ')}`]
    );
  }

  // Fetch the saved items
  const items = await query(
    `SELECT id, order_id, name, quantity, production_status, en_route_status,
            estimated_arrival_days, estimated_production_days, production_finished_at, inventory_verified_at, delivered_qty, delivered_at, created_at, updated_at
     FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
    [id]
  );

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });
  return reply.send({ ok: true, items, extracted: result.items, raw_text: result.raw_text });
});

// ── Recalculate Production Reminders ─────────────────────────────────
// When estimated_production_days changes, recalculate midpoint and due reminders
// Also accepts remaining_production_days (from midpoint check) to schedule a due reminder from NOW
const recalcProductionRemindersSchema = z.object({
  estimated_production_days: z.number().int().positive().optional(),
  remaining_production_days: z.number().int().positive().optional(),
  action_token: z.string().optional(),
});

app.post('/orders/:id/recalc-production-reminders', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = recalcProductionRemindersSchema.parse(request.body);

  // Verify action token and extract email (optional — bot calls may not provide it)
  let userEmail: string | null = null;
  if (body.action_token && cacheClient?.isOpen) {
    const tokenKey = `action_token:${body.action_token}`;
    const tokenData = await cacheClient.get(tokenKey);
    if (!tokenData) {
      return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    }
    await cacheClient.del(tokenKey);
    try {
      const tokenPayload = JSON.parse(tokenData);
      userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
    } catch { /* non-fatal */ }
  }

  const rows = await query(
    `SELECT id, quotation_number, client_name, production_started_at, estimated_production_days
     FROM orders WHERE id = $1`,
    [id]
  );
  if (!rows[0]) return reply.code(404).send({ error: 'Order not found' });
  const order = rows[0] as any;

  if (!order.production_started_at) {
    return reply.status(400).send({ error: 'Production has not started yet. No reminders to recalculate.' });
  }

  const groupChatId = process.env.PRODUCTION_GROUP_CHAT_ID;
  if (!groupChatId) {
    return reply.status(500).send({ error: 'PRODUCTION_GROUP_CHAT_ID not configured' });
  }

  const ref = order.quotation_number ?? `Order #${id.slice(0, 8)}`;
  const client = order.client_name ?? 'Unknown';
  const productionStart = new Date(order.production_started_at);

  // Determine effective days and finish date
  let effectiveDays: number;
  let finishDate: Date;
  let midpointDays: number;
  let midpointDate: Date;

  if (body.remaining_production_days) {
    // Called from midpoint check — schedule due reminder from NOW + remaining days
    effectiveDays = body.remaining_production_days;
    finishDate = new Date(Date.now() + effectiveDays * 24 * 60 * 60 * 1000);
    // Keep existing midpoint reminder as-is (already fired)
    midpointDays = 0;
    midpointDate = new Date(0); // placeholder, won't be upserted
  } else if (body.estimated_production_days) {
    // Called from production start — schedule midpoint and due from production_started_at
    effectiveDays = body.estimated_production_days;
    finishDate = new Date(productionStart);
    finishDate.setDate(finishDate.getDate() + effectiveDays);
    midpointDays = Math.max(1, Math.floor(effectiveDays / 2));
    midpointDate = new Date(productionStart);
    midpointDate.setDate(midpointDate.getDate() + midpointDays);
  } else {
    return reply.status(400).send({ error: 'Either estimated_production_days or remaining_production_days is required' });
  }

  // Upsert midpoint reminder (only when estimated_production_days is provided)
  if (body.estimated_production_days) {
    await query(
      `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
       VALUES ($1, 'production_midpoint', $2, $3, 'once', $4, 'active')
       ON CONFLICT (order_id, stage) WHERE item_id IS NULL DO UPDATE SET
         group_chat_id=EXCLUDED.group_chat_id,
         message=EXCLUDED.message,
         frequency=EXCLUDED.frequency,
         next_run_at=EXCLUDED.next_run_at,
         status='active',
         escalation_level=0,
         updated_at=NOW()`,
      [id, groupChatId,
       `*Midpoint Check* - ${ref} (${client})\nProduction is estimated at ${body.estimated_production_days} days.\nIs this order on time or delayed?`,
       midpointDate.toISOString()]
    );
  }

  // Upsert due reminder
  await query(
    `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
     VALUES ($1, 'production_due', $2, $3, 'once', $4, 'active')
     ON CONFLICT (order_id, stage) WHERE item_id IS NULL DO UPDATE SET
       group_chat_id=EXCLUDED.group_chat_id,
       message=EXCLUDED.message,
       frequency=EXCLUDED.frequency,
       next_run_at=EXCLUDED.next_run_at,
       status='active',
       escalation_level=0,
       updated_at=NOW()`,
    [id, groupChatId,
     `*Production Due* - ${ref} (${client})\nThe production window is now complete.\nHas production finished?`,
     finishDate.toISOString()]
  );

  // Update estimated_production_days on the order if provided
  if (body.estimated_production_days) {
    await query(
      `UPDATE orders SET estimated_production_days = $1, updated_at = NOW() WHERE id = $2`,
      [body.estimated_production_days, id]
    );
  }

  await notifyManualChange(
    'Production reminders recalculated',
    `Quotation: *${ref}*\nClient: *${client}*\nDays: ${effectiveDays}\nFinish: ${finishDate.toISOString().split('T')[0]}`,
    userEmail,
  );

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });
  return reply.send({
    ok: true,
    message: `Production reminders recalculated for ${effectiveDays} days`,
    midpoint_date: body.estimated_production_days ? midpointDate.toISOString() : null,
    finish_date: finishDate.toISOString(),
  });
});

// Stage Updates
const stageUpdateSchema = z.object({
  quotation_number: z.string(),
  stage: z.string(),
  status: z.string(),
  remarks: z.string().optional(),
  delivery_date: z.string().nullable().optional(),
  updated_by: z.string().optional(),
  action_token: z.string().optional(),
});

app.post('/stage-updates', async (request, reply) => {
  const body = stageUpdateSchema.parse(request.body);

  // Verify action token and extract email for dashboard-originated requests
  let userEmail: string | null = null;
  if (isDashboardOrigin(body.updated_by)) {
    if (!body.action_token) {
      return reply.status(401).send({ error: 'Action token required for dashboard actions' });
    }
    if (!cacheClient?.isOpen) {
      return reply.status(503).send({ error: 'Action verification unavailable' });
    }
    const tokenKey = `action_token:${body.action_token}`;
    const tokenData = await cacheClient.get(tokenKey);
    if (!tokenData) {
      return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    }
    await cacheClient.del(tokenKey);
    try {
      const tokenPayload = JSON.parse(tokenData);
      userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
    } catch { /* non-fatal */ }
  }
  const orders = await query(
    `SELECT id, quotation_number, client_name, total_amount, deposit_amount, balance_paid, current_stage, deposit_verified, production_exception, delivery_exception, special_case
     FROM orders WHERE quotation_number=$1`,
    [body.quotation_number]
  );
  if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });

  const order = orders[0];

  // ── Workflow Guard: Valid Stage Transitions ──────────────────────────
  // Prevent invalid jumps (e.g., balance_due → payment_confirmed without delivery)
  const VALID_TRANSITIONS: Record<string, string[]> = {
    quotation_received:        ['order_confirmation_received', 'math_verified', 'deposit_pending'],
    order_confirmation_received: ['math_verified', 'deposit_pending'],
    math_verified:             ['deposit_pending'],
    deposit_pending:           ['deposit_verification'],
    deposit_verification:      ['purchasing_pending', 'stock_preparation'],
    purchasing_pending:        ['production_pending'],
    production_pending:        ['production_in_progress', 'partial_production'],
    production_in_progress:    ['en_route', 'partial_production'],
    partial_production:        ['production_in_progress', 'en_route'],
    stock_preparation:         ['balance_due'],
    en_route:                  ['en_route_verification', 'inventory_verification', 'inventory_arrived'],
    inventory_verification:    ['inventory_arrived'],
    inventory_arrived:         ['balance_due', 'delivered'],
    balance_due:               ['balance_verification', 'delivery_pending', 'delivery_scheduled', 'delivered', 'countered'],
    balance_verification:      ['delivery_pending', 'delivery_scheduled', 'delivered', 'countered'],
    delivery_pending:          ['delivery_scheduled', 'delivered', 'countered'],
    delivery_scheduled:        ['delivery_pending', 'delivered', 'countered'],
    delivered:                 ['payment_received', 'payment_confirmed', 'completed', 'countered'],
    countered:                 ['payment_received', 'payment_confirmed', 'completed'],
    payment_received:          ['payment_confirmed', 'completed'],
    payment_confirmed:         ['completed'],
  };

  const previousStage = order.current_stage;
  const targetStage = body.stage;
  const productionGatedStages = new Set(['production_pending', 'partial_production', 'production_in_progress', 'en_route']);
  const hasProductionClearance = Boolean(order.deposit_verified || order.production_exception);

  // Allow transitions that are in the valid map, or if the stage hasn't changed
  if (previousStage !== targetStage) {
    const allowedNext = VALID_TRANSITIONS[previousStage];
    const allowedByProductionException = productionGatedStages.has(targetStage) && Boolean(order.production_exception);
    if (allowedNext && !allowedNext.includes(targetStage) && !allowedByProductionException) {
      return reply.code(400).send({
        error: `Invalid stage transition: cannot move from '${previousStage}' to '${targetStage}'. Allowed transitions: ${allowedNext.join(', ')}.`,
        current_stage: previousStage,
        allowed_stages: allowedNext,
      });
    }
  }

  if (productionGatedStages.has(targetStage) && !hasProductionClearance) {
    return reply.code(400).send({
      error: 'Cannot move to production: downpayment must be verified first, unless a production special-case exception is granted.',
      current_stage: previousStage,
      deposit_verified: order.deposit_verified,
      production_exception: order.production_exception,
    });
  }

  // Guard: Block delivery_scheduled if total amount is not set
  if (body.stage === 'delivery_scheduled' && order.total_amount == null) {
    return reply.code(400).send({
      error: 'Cannot schedule delivery: total amount not set for this order. Please set the total amount first.',
    });
  }

  // Guard: Block balance_due → delivery_scheduled unless balance is paid or delivery exception is granted
  if (previousStage === 'balance_due' && body.stage === 'delivery_scheduled' && !(order.balance_paid || order.delivery_exception)) {
    return reply.code(400).send({
      error: 'Cannot schedule delivery: balance must be paid first, unless a delivery exception is granted.',
      current_stage: previousStage,
      balance_paid: order.balance_paid,
      delivery_exception: order.delivery_exception,
    });
  }

  // Guard: Block balance_due → countered unless special case is granted
  if (previousStage === 'balance_due' && body.stage === 'countered' && !(order.special_case || order.delivery_exception)) {
    return reply.code(400).send({
      error: 'Cannot mark as countered: balance must be paid first, unless a special case or delivery exception is granted.',
      current_stage: previousStage,
      balance_paid: order.balance_paid,
      special_case: order.special_case,
      delivery_exception: order.delivery_exception,
    });
  }

  const orderId = order.id;
  const clientName = order?.client_name ?? null;
  const actorName = userEmail ?? body.updated_by ?? null;

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by, client_name, actor_name) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [orderId, body.stage, body.status, body.remarks ?? null, body.updated_by ?? null, clientName, actorName]
  );
  await query(`UPDATE orders SET current_stage=$1, updated_at=NOW() WHERE id=$2`, [body.stage, orderId]);

  // Capture delivery date explicitly when scheduling/rescheduling delivery.
  // Fallback to remarks preserves the existing Telegram /deliverydate behaviour.
  if (body.stage === 'delivery_scheduled' && body.delivery_date !== undefined) {
    await query(`UPDATE orders SET delivery_date=$1 WHERE id=$2`, [body.delivery_date, orderId]);
  } else if (body.stage === 'delivery_scheduled' && body.status === 'scheduled' && body.remarks) {
    await query(`UPDATE orders SET delivery_date=$1 WHERE id=$2`, [body.remarks, orderId]);
  }

  // Track delivery completion — set delivered_at when order reaches 'delivered' stage
  if (body.stage === 'delivered') {
    await query(`UPDATE orders SET delivered_at=NOW(), updated_at=NOW() WHERE id=$1`, [orderId]);
    await deductInventoryForDeliveredOrder(orderId, body.updated_by ?? 'delivery-agent');

    // Schedule file-store cleanup: delete quotation text after 3 months
    // The file-store container handles the actual deletion based on file age.
    // We set retention_until on the files table for tracking.
    const retentionUntil = new Date();
    retentionUntil.setDate(retentionUntil.getDate() + 90); // 3 months
    await query(
      `UPDATE files SET retention_until=$1 WHERE order_id=$2 AND storage_backend='local'`,
      [retentionUntil.toISOString(), orderId]
    );

    // ── Immediate collection reminder if balance is still unpaid ──────────
    if (!order.balance_paid) {
      const collectionChatId = process.env.COLLECTION_GROUP_CHAT_ID;
      if (collectionChatId) {
        try {
          await query(
            `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
             VALUES ($1, 'delivered', $2, $3, 'daily', NOW() + INTERVAL '5 minutes', 'active')
             ON CONFLICT DO NOTHING`,
            [orderId, collectionChatId, `Order #${body.quotation_number ?? orderId.slice(0, 8)} has been delivered but balance is still unpaid. Please collect payment.`]
          );
        } catch {
          console.warn(`[recordStageUpdate] Failed to create immediate collection reminder for order ${orderId}`);
        }
      }
    }

    // ── Auto-complete if balance was already paid before delivery ──────────
    // If balance_paid is already true, steps 14-16 (countered → payment_received → payment_confirmed)
    // are N/A. The order can go directly to 'completed'.
    if (order.balance_paid && order.balance_verified) {
      await query(
        `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by, client_name, actor_name)
         VALUES ($1, 'completed', 'auto_completed', 'Balance already paid and verified — auto-completed on delivery (steps 14-16 N/A)', $2, $3, $4)`,
        [orderId, body.updated_by ?? null, clientName, actorName]
      );
      await query(`UPDATE orders SET current_stage='completed', updated_at=NOW() WHERE id=$1`, [orderId]);

      // Auto-complete reminders for delivered stage
      await query(
        `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage='delivered' AND status='active'`,
        [orderId]
      );

      // Fire notification for 'completed' stage so the transition group gets notified
      triggerAgentsForStage('completed', body.quotation_number, order?.client_name ?? null, actorName);
    }
  }

  // Auto-complete reminders for the previous stage when moving forward
  if (previousStage && previousStage !== body.stage) {
    await query(
      `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage=$2 AND status='active'`,
      [orderId, previousStage]
    );
  }

  // When the deposit is verified and the order moves to purchasing_pending,
  // notify the production group and create a persistent reminder asking
  // whether to start the production workflow.
  // This covers cases where the deposit was verified outside the verify-deposit
  // endpoint (e.g., manual SQL update or dashboard stage transition).
  if (body.stage === 'purchasing_pending' && order.deposit_verified && PRODUCTION_CHAT_ID) {
    const ref = body.quotation_number;
    const client = order?.client_name ?? 'Unknown';
    const reminderMessage =
      `💰 Deposit verified for #${ref} (${client}). Do we proceed to start the production workflow?`;

    await upsertStageReminder(orderId, 'purchasing_pending', PRODUCTION_CHAT_ID, reminderMessage);

    setImmediate(() => {
      notifyGroupChatWithButtons(
        PRODUCTION_CHAT_ID,
        `💰 <b>Downpayment Verified</b>\n\n` +
        `Quotation: <b>${ref}</b>\n` +
        `Client: ${client}\n\n` +
        `The client has made the downpayment and the deposit is now verified.\n\n` +
        `❓ <b>Do we proceed to start the production workflow?</b>`,
        [
          [
            { text: '✅ Yes, proceed', callback_data: `deposit:start_production:yes:${orderId}:${ref}` },
            { text: '⏳ Not yet', callback_data: `deposit:start_production:no:${orderId}:${ref}` },
          ],
        ]
      );
    });
  }

  // When the team only starts the production workflow, create the separate reminder
  // that asks whether actual/physical production has started.
  if (body.stage === 'production_pending' && PRODUCTION_CHAT_ID) {
    const ref = body.quotation_number;
    const client = order?.client_name ?? 'Unknown';
    const reminderMessage = `Production workflow has started for #${ref} (${client}). Has actual production started?`;

    await upsertStageReminder(orderId, 'production_pending', PRODUCTION_CHAT_ID, reminderMessage);

    setImmediate(() => {
      notifyGroupChatWithButtons(
        PRODUCTION_CHAT_ID,
        `<b>Production Workflow Started</b>

` +
        `Quotation: <b>${ref}</b>
` +
        `Client: ${client}

` +
        `This is only the workflow acknowledgement. Has <b>actual production</b> started?`,
        [
          [
            { text: 'Yes, production started', callback_data: `produce:yes:${ref}` },
            { text: 'Partial', callback_data: `produce:partial:${ref}` },
          ],
          [{ text: 'Not yet', callback_data: `produce:no:${ref}` }],
        ],
      );
    });
  }

  // When advancing to en_route_verification, create a persistent reminder
  // asking the team to confirm whether all items have arrived.
  if (body.stage === 'en_route_verification' && PRODUCTION_CHAT_ID) {
    const ref = body.quotation_number;
    const client = order?.client_name ?? 'Unknown';
    const reminderMessage = `Items are en route for #${ref} (${client}). Have all items arrived?`;

    await upsertStageReminder(orderId, 'en_route_verification', PRODUCTION_CHAT_ID, reminderMessage);

    setImmediate(() => {
      notifyGroupChatWithButtons(
        PRODUCTION_CHAT_ID,
        `🚚 <b>En Route Verification (Dashboard)</b>\n\n` +
        `Quotation: <b>${ref}</b>\n` +
        `Client: ${client}\n\n` +
        `The order has been marked as en route. Have all items arrived?`,
        [
          [
            { text: '✅ All arrived', callback_data: `en_route_verif:yes:${ref}` },
            { text: '⏳ Not yet', callback_data: `en_route_verif:no:${ref}` },
          ],
          [{ text: '📋 Check items', callback_data: `en_route_verif:check:${ref}` }],
        ]
      );
    });
  }

  // When advancing to inventory_verification, create a persistent reminder
  // asking the team to verify inventory items.
  const INVENTORY_GROUP_CHAT_ID = process.env.INVENTORY_GROUP_CHAT_ID;
  if (body.stage === 'inventory_verification' && INVENTORY_GROUP_CHAT_ID) {
    const ref = body.quotation_number;
    const client = order?.client_name ?? 'Unknown';
    const reminderMessage = `Items have arrived for #${ref} (${client}). Please verify inventory.`;

    await upsertStageReminder(orderId, 'inventory_verification', INVENTORY_GROUP_CHAT_ID, reminderMessage);

    setImmediate(() => {
      notifyGroupChat(
        INVENTORY_GROUP_CHAT_ID,
        `📦 <b>Inventory Verification (Dashboard)</b>\n\n` +
        `Quotation: <b>${ref}</b>\n` +
        `Client: ${client}\n\n` +
        `Items have arrived and need inventory verification. Please check and verify.`
      );
    });
  }

  // When advancing to inventory_arrived, create a persistent reminder
  // asking the team to confirm inventory arrival.
  if (body.stage === 'inventory_arrived' && INVENTORY_GROUP_CHAT_ID) {
    const ref = body.quotation_number;
    const client = order?.client_name ?? 'Unknown';
    const reminderMessage = `Inventory has arrived for #${ref} (${client}). Please confirm.`;

    await upsertStageReminder(orderId, 'inventory_arrived', INVENTORY_GROUP_CHAT_ID, reminderMessage);

    setImmediate(() => {
      notifyGroupChat(
        INVENTORY_GROUP_CHAT_ID,
        `📦 <b>Inventory Arrived (Dashboard)</b>\n\n` +
        `Quotation: <b>${ref}</b>\n` +
        `Client: ${client}\n\n` +
        `Inventory has been marked as arrived. Please confirm and proceed.`
      );
    });
  }

  // When advancing to balance_due, create a persistent reminder
  // asking the collection team to collect the balance.
  if (body.stage === 'balance_due' && COLLECTION_CHAT_ID) {
    const ref = body.quotation_number;
    const client = order?.client_name ?? 'Unknown';
    const reminderMessage = `Balance is now due for #${ref} (${client}). Please collect payment.`;

    await upsertStageReminder(orderId, 'balance_due', COLLECTION_CHAT_ID, reminderMessage);

    setImmediate(() => {
      notifyGroupChat(
        COLLECTION_CHAT_ID,
        `⚖️ <b>Balance Due (Dashboard)</b>\n\n` +
        `Quotation: <b>${ref}</b>\n` +
        `Client: ${client}\n\n` +
        `The order has reached the balance due stage. Please collect the remaining payment.`
      );
    });
  }

  // When advancing to countered, create a persistent reminder
  // asking the collection team to collect payment and update invoice status.
  if (body.stage === 'countered' && COLLECTION_CHAT_ID) {
    const ref = body.quotation_number;
    const client = order?.client_name ?? 'Unknown';
    const reminderMessage = `Order #${ref} (${client}) is countered — awaiting payment collection and invoice status update.`;

    await upsertStageReminder(orderId, 'countered', COLLECTION_CHAT_ID, reminderMessage);

    setImmediate(() => {
      notifyGroupChat(
        COLLECTION_CHAT_ID,
        `🔄 <b>Countered (Dashboard)</b>\n\n` +
        `Quotation: <b>${ref}</b>\n` +
        `Client: ${client}\n\n` +
        `The order has been marked as countered. Please collect payment and update the invoice status (sales invoice & delivery invoice).`
      );
    });
  }

  // When advancing to delivery_scheduled, create a persistent reminder
  // asking the delivery team to prepare for delivery.
  if (body.stage === 'delivery_scheduled' && DELIVERY_CHAT_ID) {
    const ref = body.quotation_number;
    const client = order?.client_name ?? 'Unknown';
    const deliveryDateStr = body.delivery_date
      ? `\nScheduled Delivery: <b>${body.delivery_date}</b>`
      : '';
    const reminderMessage = `Delivery has been scheduled for #${ref} (${client}). Please prepare.`;

    await upsertStageReminder(orderId, 'delivery_scheduled', DELIVERY_CHAT_ID, reminderMessage);

    setImmediate(() => {
      notifyGroupChat(
        DELIVERY_CHAT_ID,
        `🚚 <b>Delivery Scheduled (Dashboard)</b>\n\n` +
        `Quotation: <b>${ref}</b>\n` +
        `Client: ${client}` +
        deliveryDateStr +
        `\n\nDelivery has been scheduled. Please prepare for dispatch.`
      );
    });
  }

  // Invalidate caches after stage update
  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${body.quotation_number}`, 'calendar:*', 'sales:*']);

  if (isDashboardOrigin(body.updated_by)) {
    await notifyManualChange(
      'Quick Action: Stage updated',
      `Quotation: *${body.quotation_number}*\nClient: ${clientName ?? 'N/A'}\nStage: ${body.stage}\nStatus: ${body.status}\nRemarks: ${body.remarks ?? '-'}\nActor: ${actorName ?? 'dashboard'}`,
      userEmail,
    );
  }

  // Immediately fire the relevant agent so group chats are notified now, not on the next hourly tick
  triggerAgentsForStage(body.stage, body.quotation_number, order?.client_name ?? null, actorName);

  // Also notify the specific functional group directly based on the target stage
  // This ensures the group that needs to act gets an immediate notification,
  // not just the general progress group (STAGE_TRANSITION_GROUP_CHAT_ID)
  if (isDashboardOrigin(body.updated_by)) {
    const stageToGroup: Record<string, string | null> = {
      deposit_pending: COLLECTION_CHAT_ID,
      deposit_verification: COLLECTION_CHAT_ID,
      purchasing_pending: PURCHASING_CHAT_ID,
      production_pending: PRODUCTION_CHAT_ID,
      production_in_progress: PRODUCTION_CHAT_ID,
      partial_production: PRODUCTION_CHAT_ID,
      stock_preparation: DELIVERY_CHAT_ID,
      en_route: PRODUCTION_CHAT_ID,
      en_route_verification: PRODUCTION_CHAT_ID,
      inventory_verification: DELIVERY_CHAT_ID,
      inventory_arrived: DELIVERY_CHAT_ID,
      balance_due: COLLECTION_CHAT_ID,
      balance_verification: COLLECTION_CHAT_ID,
      delivery_pending: DELIVERY_CHAT_ID,
      delivery_scheduled: DELIVERY_CHAT_ID,
      delivered: DELIVERY_CHAT_ID,
      countered: DELIVERY_CHAT_ID,
      payment_received: COLLECTION_CHAT_ID,
      payment_confirmed: COLLECTION_CHAT_ID,
      completed: COLLECTION_CHAT_ID,
    };
    const targetChatId = stageToGroup[body.stage];
    if (targetChatId) {
      const stageLabel = body.stage.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const deliveryDateLine = body.stage === 'delivery_scheduled' && body.delivery_date
        ? `\nScheduled Delivery: <b>${body.delivery_date}</b>`
        : '';
      setImmediate(() => {
        notifyGroupChat(
          targetChatId,
          `📋 <b>Stage Update (Dashboard)</b>\n\n` +
          `Quotation: <b>${body.quotation_number}</b>\n` +
          `Client: ${order?.client_name ?? 'N/A'}\n` +
          `Stage: <b>${stageLabel}</b>\n` +
          `Status: ${body.status}\n` +
          `Remarks: ${body.remarks ?? '-'}` +
          deliveryDateLine +
          `\nUpdated by: ${actorName ?? 'dashboard'}\n\n` +
          `Please check and take necessary action.`
        );
      });
    }
  }

  return { ok: true };
});

// ── Schedule Delivery for Specific Items (Itemized Progression) ───────
// Allows scheduling delivery for selected items only, rather than the
// entire order. Sets delivery_date on the order and marks the selected
// items with a scheduled delivery status.

app.post('/orders/:id/schedule-items', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as {
    item_ids: string[];
    delivery_date: string;
    action_token?: string;
    remarks?: string;
  };

  if (!body.item_ids || !Array.isArray(body.item_ids) || body.item_ids.length === 0) {
    return reply.status(400).send({ error: 'item_ids must be a non-empty array' });
  }
  if (!body.delivery_date) {
    return reply.status(400).send({ error: 'delivery_date is required' });
  }

  // Verify action token
  let userEmail: string | null = null;
  if (body.action_token) {
    if (!cacheClient?.isOpen) {
      return reply.status(503).send({ error: 'Action verification unavailable' });
    }
    const tokenKey = `action_token:${body.action_token}`;
    const tokenData = await cacheClient.get(tokenKey);
    if (!tokenData) {
      return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    }
    await cacheClient.del(tokenKey);
    try {
      const tokenPayload = JSON.parse(tokenData);
      userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
    } catch { /* non-fatal */ }
  }

  const orders = await query(
    `SELECT id, quotation_number, client_name, current_stage FROM orders WHERE id=$1`,
    [id]
  );
  if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });

  const order = orders[0];

  // Verify the items belong to this order
  const itemRows = await query(
    `SELECT id, name FROM order_items WHERE id = ANY($1::uuid[]) AND order_id = $2`,
    [body.item_ids, id]
  );
  if (itemRows.length === 0) {
    return reply.status(400).send({ error: 'None of the specified items belong to this order' });
  }

  // Set delivery_date on the order
  await query(`UPDATE orders SET delivery_date=$1, updated_at=NOW() WHERE id=$2`, [body.delivery_date, id]);

  // Record stage update for the order
  const actorName = userEmail ?? 'dashboard';
  const clientName = order?.client_name ?? null;
  const itemNames = itemRows.map((r: any) => r.name).join(', ');
  const remarks = body.remarks
    ? `Scheduled delivery for items: ${itemNames}. ${body.remarks}`
    : `Scheduled delivery for items: ${itemNames}`;

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by, client_name, actor_name)
     VALUES ($1, 'delivery_scheduled', 'scheduled', $2, $3, $4, $5)`,
    [id, remarks, 'dashboard', clientName, actorName]
  );

  // If order is not yet in delivery_scheduled stage, advance it
  if (order.current_stage !== 'delivery_scheduled') {
    await query(`UPDATE orders SET current_stage='delivery_scheduled', updated_at=NOW() WHERE id=$1`, [id]);
  }

  // Notify group chat
  const targetChatId = process.env.DELIVERY_GROUP_CHAT_ID || process.env.GROUP_CHAT_ID;
  if (targetChatId) {
    setImmediate(() => {
      notifyGroupChat(
        targetChatId,
        `📅 <b>Itemized Delivery Scheduled</b>\n\n` +
        `Quotation: <b>${order.quotation_number}</b>\n` +
        `Client: ${clientName ?? 'N/A'}\n` +
        `Items: <b>${itemNames}</b>\n` +
        `Delivery Date: <b>${body.delivery_date}</b>\n` +
        `Updated by: ${actorName}\n\n` +
        `Please check and prepare for delivery.`
      );
    });
  }

  return { ok: true, message: `Delivery scheduled for ${itemRows.length} item(s) on ${body.delivery_date}` };
});

// ── Payment Helpers ───────────────────────────────────────────────────
// With the payments table (migration 030), orders can have multiple
// deposit and balance payment records. These helpers compute running totals.

async function getPaymentTotals(orderId: string): Promise<{ depositTotal: number; balanceTotal: number }> {
  const depositRows = await query(
    `SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE order_id=$1 AND type='deposit'`,
    [orderId]
  );
  const balanceRows = await query(
    `SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE order_id=$1 AND type='balance'`,
    [orderId]
  );
  return {
    depositTotal: Number(depositRows[0]?.total ?? 0),
    balanceTotal: Number(balanceRows[0]?.total ?? 0),
  };
}


async function recordFullPaymentForOrder(args: {
  orderId: string;
  quotationNumber: string | null;
  clientName: string | null;
  totalAmount: number;
  amount: number;
  paymentDate?: string | null;
  referenceNumber?: string | null;
  paidBy?: string | null;
  source?: string | null;
  updatedBy?: string | null;
}): Promise<{ depositPortion: number; balancePortion: number; overpayment: number }> {
  const fullAmount = Number(args.amount);
  const totalAmount = Number(args.totalAmount);
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error('Total amount is required before recording a full payment.');
  }
  if (fullAmount < totalAmount) {
    throw new Error(`Full payment amount must be at least the total amount (PHP ${totalAmount.toLocaleString()}).`);
  }

  const existingTotals = await getPaymentTotals(args.orderId);
  const existingPaid = existingTotals.depositTotal + existingTotals.balanceTotal;
  const remainingToAllocate = Math.max(0, totalAmount - existingPaid);
  const amountToAllocate = Math.min(fullAmount, remainingToAllocate);
  const depositTarget = totalAmount * 0.5;
  const depositNeeded = Math.max(0, depositTarget - existingTotals.depositTotal);
  const depositPortion = Math.min(amountToAllocate, depositNeeded);
  const balancePortion = Math.max(0, amountToAllocate - depositPortion);
  const overpayment = Math.max(0, fullAmount - remainingToAllocate);

  if (depositPortion > 0) {
    await query(
      `INSERT INTO payments (order_id, type, amount, reference_number, paid_by, payment_date, source)
       VALUES ($1, 'deposit', $2, $3, $4, $5, $6)`,
      [args.orderId, depositPortion, args.referenceNumber ?? null, args.paidBy ?? null, args.paymentDate ?? null, args.source ?? 'full_payment']
    );
  }

  if (balancePortion > 0 || existingTotals.balanceTotal === 0) {
    await query(
      `INSERT INTO payments (order_id, type, amount, reference_number, paid_by, payment_date, source)
       VALUES ($1, 'balance', $2, $3, $4, $5, $6)`,
      [args.orderId, balancePortion, args.referenceNumber ?? null, args.paidBy ?? null, args.paymentDate ?? null, args.source ?? 'full_payment']
    );
  }

  const totals = await getPaymentTotals(args.orderId);
  const isFullyPaid = totals.depositTotal + totals.balanceTotal >= totalAmount;

  // For full payments (no previous payments), store deposit_amount as the full total
  // so the order displays correctly (expected balance = 0).
  const isFirstFullPayment = isFullyPaid && existingPaid === 0;
  const depositAmountToStore = isFirstFullPayment ? totalAmount : totals.depositTotal;

  await query(
    `UPDATE orders SET
       deposit_paid=TRUE,
       deposit_verified=FALSE,
       deposit_amount=$1,
       deposit_paid_at=COALESCE($4, deposit_paid_at, NOW()),
       balance_paid=$2,
       balance_verified=FALSE,
       balance_paid_at=CASE WHEN $2 THEN COALESCE($4, balance_paid_at, NOW()) ELSE balance_paid_at END,
       current_stage=CASE
         WHEN current_stage IN ('quotation_received', 'order_confirmation_received', 'math_verified', 'deposit_pending', 'purchasing_pending', 'production_pending', 'deposit_verification')
         THEN 'deposit_verification'
         WHEN $2 AND current_stage IN ('balance_due', 'inventory_arrived', 'delivery_scheduled')
         THEN 'balance_verification'
         ELSE current_stage
       END,
       updated_at=NOW()
     WHERE id=$3`,
    [depositAmountToStore, isFullyPaid, args.orderId, args.paymentDate ?? null]
  );

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES
       ($1, 'deposit_verification', 'full_payment_recorded', $2, $4),
       ($1, 'balance_verification', 'full_payment_recorded', $3, $4)`,
    [
      args.orderId,
      isFirstFullPayment
        ? `Full payment of PHP ${fullAmount.toLocaleString()} recorded upfront. Awaiting verification.`
        : `Full payment recorded. Deposit portion: PHP ${depositPortion.toLocaleString()}. Awaiting deposit verification.`,
      isFirstFullPayment
        ? `Full payment covers entire order. No balance due.`
        : `Full payment recorded. Balance portion: PHP ${balancePortion.toLocaleString()}${overpayment > 0 ? `; overpayment: PHP ${overpayment.toLocaleString()}` : ''}. Awaiting balance verification.`,
      args.updatedBy ?? null,
    ]
  );

  await query(
    `UPDATE reminders SET status='completed', updated_at=NOW()
     WHERE order_id=$1 AND status='active' AND stage IN ('deposit_pending', 'balance_due', 'inventory_arrived')`,
    [args.orderId]
  );

  triggerAgentsForStage('deposit_verification', args.quotationNumber ?? undefined, args.clientName ?? undefined, args.updatedBy ?? undefined);
  triggerAgentsForStage('balance_verification', args.quotationNumber ?? undefined, args.clientName ?? undefined, args.updatedBy ?? undefined);

  setImmediate(() => {
    notifyGroupChat(
      COLLECTION_CHAT_ID,
      `Full Payment Recorded - Needs Verification\n\n` +
      `Quotation: <b>${args.quotationNumber ?? args.orderId}</b>\n` +
      `Client: ${args.clientName ?? 'N/A'}\n` +
      `Amount received: PHP ${fullAmount.toLocaleString()}\n` +
      `Deposit portion: PHP ${depositPortion.toLocaleString()}\n` +
      `Balance portion: PHP ${balancePortion.toLocaleString()}\n` +
      (overpayment > 0 ? `Overpayment: PHP ${overpayment.toLocaleString()}\n` : '') +
      `Date: ${args.paymentDate ?? 'now'}\n\n` +
      `Please verify both deposit and balance payment records on the dashboard.`
    );
  });

  if (PRODUCTION_CHAT_ID) {
    setImmediate(() => {
      notifyGroupChat(
        PRODUCTION_CHAT_ID,
        `Full Payment Recorded Before Production\n\n` +
        `Quotation: <b>${args.quotationNumber ?? args.orderId}</b>\n` +
        `Client: ${args.clientName ?? 'N/A'}\n` +
        `Amount: PHP ${fullAmount.toLocaleString()}\n\n` +
        `Collection must verify the payment first. Once verified, the production deposit gate is cleared.`
      );
    });
  }

  return { depositPortion, balancePortion, overpayment };
}

// ── Deposits ──────────────────────────────────────────────────────────

const depositSchema = z.object({
  quotation_number: z.string(),
  amount: z.number().positive(),
  image_url: z.string().optional().nullable(),
  updated_by: z.string().optional(),
  deposit_paid_at: z.string().optional(),
  action_token: z.string().optional(),
});

/**
 * POST /deposits
 * Record a deposit payment for an order.
 * Updates deposit_paid, deposit_amount, deposit_image_url on the order
 * and creates a stage update for deposit_pending → deposit_paid.
 */
app.post('/deposits', async (request, reply) => {
  try {
    const body = depositSchema.parse(request.body);

    // Extract user email from action token if provided (for audit logging)
    // NOTE: action_token is OPTIONAL for deposits. The Telegram bot records deposits
    // without any token, and the file upload endpoint also has no auth requirement.
    // The token is used only for audit trail when available.
    let userEmail: string | null = null;
    if (body.action_token && cacheClient?.isOpen) {
      const tokenKey = `action_token:${body.action_token}`;
      const tokenData = await cacheClient.get(tokenKey);
      if (tokenData) {
        await cacheClient.del(tokenKey);
        const tokenPayload = JSON.parse(tokenData);
        userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
      }
    }

    const orders = await query(`SELECT id, current_stage, quotation_number, client_name, sales_agent, total_amount FROM orders WHERE quotation_number=$1`, [body.quotation_number]);
    if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });

    const orderId = orders[0].id;
    const quotationNumber = orders[0].quotation_number;
    const clientName = orders[0].client_name;
    const salesAgent = orders[0].sales_agent;
    const totalAmount = orders[0].total_amount;

    // Insert payment record into payments table (supports multiple deposits)
    await query(
      `INSERT INTO payments (order_id, type, amount, payment_date, image_url, source)
       VALUES ($1, 'deposit', $2, $3, $4, $5)`,
      [orderId, body.amount, body.deposit_paid_at ?? null, body.image_url ?? null, body.updated_by ?? 'api']
    );

    // Recompute deposit total from payments table
    const { depositTotal } = await getPaymentTotals(orderId);

    // Detect whether this deposit covers the full order amount (full payment via deposit flow)
    const orderTotalForDeposit = totalAmount != null ? Number(totalAmount) : null;
    const depositCoversFullAmount =
      orderTotalForDeposit != null && orderTotalForDeposit > 0 && depositTotal >= orderTotalForDeposit;

    // Update order summary fields (backward-compatible)
    // When the deposit covers the full order total, also mark balance_paid so that
    // verify-deposit will route the order through balance_verification (or auto-skip)
    // instead of leaving it stranded as a "balance due" order with ₱0 balance.
    await query(
      `UPDATE orders SET
         deposit_paid=TRUE,
         deposit_verified=FALSE,
         deposit_amount=$1,
         deposit_image_url=COALESCE($2, deposit_image_url),
         deposit_paid_at=COALESCE($4, deposit_paid_at),
         balance_paid=CASE WHEN $5 THEN TRUE ELSE balance_paid END,
         balance_paid_at=CASE WHEN $5 AND balance_paid_at IS NULL THEN COALESCE($4, NOW()) ELSE balance_paid_at END,
         current_stage=CASE
           WHEN current_stage IN ('quotation_received', 'order_confirmation_received', 'math_verified', 'deposit_pending', 'purchasing_pending', 'production_pending')
           THEN 'deposit_verification'
           ELSE current_stage
         END,
         updated_at=NOW()
       WHERE id=$3`,
      [depositTotal, body.image_url ?? null, orderId, body.deposit_paid_at ?? null, depositCoversFullAmount]
    );

    const paymentLabel = depositCoversFullAmount ? 'Full payment' : 'Downpayment';

    // Record stage update for deposit_pending → deposit_paid
    await query(
      `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by) VALUES ($1, $2, $3, $4, $5)`,
      [orderId, 'deposit_pending', 'deposit_paid', `${paymentLabel} of ₱${body.amount} recorded`, body.updated_by ?? null]
    );
    await query(
      `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by) VALUES ($1, $2, $3, $4, $5)`,
      [orderId, 'deposit_verification', 'pending', `${paymentLabel} recorded; awaiting payment verification`, body.updated_by ?? null]
    );

    // Complete any deposit reminders for this order
    await query(
      `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage='deposit_pending' AND status='active'`,
      [orderId]
    );

    // Create a deposit_verification reminder — collection agent will remind team to verify the deposit
    try {
      await query(
        `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
         SELECT $1, 'deposit_verification', r.group_chat_id,
                'Deposit has been submitted but not yet verified. Please check if the payment went through and verify.',
                'daily', NOW() + INTERVAL '5 minutes', 'active'
         FROM reminders r
         WHERE r.order_id = $1 AND r.stage = 'deposit_pending' AND r.status = 'completed'
         LIMIT 1
         ON CONFLICT DO NOTHING`,
        [orderId]
      );
    } catch {
      // Non-fatal: reminder creation is best-effort
      console.warn(`[deposits] Failed to create deposit_verification reminder for order ${orderId}`);
    }

    // Notify collection agent immediately that a deposit needs verification
    triggerAgentsForStage('deposit_verification', quotationNumber, clientName, body.updated_by ?? undefined);

    // Notify collection group immediately — deposit recorded, needs verification
    setImmediate(() => {
      notifyGroupChat(
        COLLECTION_CHAT_ID,
        `💰 <b>Deposit Recorded — Needs Verification</b>\n\n` +
        `Quotation: <b>${quotationNumber ?? body.quotation_number}</b>\n` +
        `Client: ${clientName ?? 'N/A'}\n` +
        `Amount: PHP ${body.amount.toLocaleString()}\n` +
        `Date: ${body.deposit_paid_at ?? 'now'}\n\n` +
        `Please verify the deposit on the dashboard.`
      );
    });

    // Notify production group directly — downpayment has been paid, production may proceed
    if (PRODUCTION_CHAT_ID) {
      setImmediate(() => {
        notifyGroupChat(
          PRODUCTION_CHAT_ID,
          `📋 <b>New Order Created (Dashboard)</b>\n\n` +
          `Quotation: <b>${quotationNumber ?? body.quotation_number}</b>\n` +
          `Client: ${clientName ?? 'N/A'}\n` +
          `Sales Agent: ${salesAgent ?? '—'}\n` +
          `Amount: ${totalAmount != null ? `PHP ${Number(totalAmount).toLocaleString()}` : '—'}\n\n` +
          `Status: <b>Downpayment Paid</b>\n` +
          `Production may proceed.`
        );
      });
    }

    // Invalidate caches
    try {
      await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${body.quotation_number}`, 'calendar:*', 'sales:*']);
    } catch {
      // Non-fatal: cache invalidation is best-effort
      console.warn(`[deposits] Cache invalidation failed for ${body.quotation_number}`);
    }

    if (isDashboardOrigin(body.updated_by)) {
      await notifyManualChange(
        'Quick Action: Downpayment recorded',
        `Quotation: *${quotationNumber ?? body.quotation_number}*\nAmount: PHP ${body.amount.toLocaleString()}\nDate: ${body.deposit_paid_at ?? 'now'}`,
        userEmail,
      );
    }

    return reply.send({ ok: true, quotation_number: body.quotation_number, amount: body.amount });
  } catch (err: any) {
    console.error('[deposits] Error recording deposit:', err);
    // Handle Zod validation errors
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: `Validation error: ${err.errors.map(e => e.message).join(', ')}` });
    }
    // Handle DB / unexpected errors
    const message = err?.message ?? 'Unknown error';
    return reply.status(500).send({ error: `Failed to record deposit: ${message}` });
  }
});

// ── Deposit Slip Matching ────────────────────────────────────────────

/**
 * POST /deposits/match-and-record
 *
 * Called when a deposit slip image is sent to the Telegram bot.
 * 1. Extracts the deposit amount from the image (already done by vision)
 * 2. Finds all orders that have NO deposit yet (deposit_paid = FALSE)
 * 3. For each order, computes expected deposit = 50% of total_amount
 * 4. Matches the extracted amount against expected deposits with 20-30% tolerance
 * 5. Returns the best matching candidate(s) so the bot can ask for confirmation
 *
 * If a client_name is provided (user typed it after saying No), it looks up
 * the order by client name and records the deposit directly.
 */
const matchDepositSchema = z.object({
  amount: z.number().positive(),
  client_name: z.string().optional(),
  quotation_number: z.string().optional(),
  image_url: z.string().optional().nullable(),
  deposit_paid_at: z.string().optional(),
});

app.post('/deposits/match-and-record', async (request, reply) => {
  try {
    const body = matchDepositSchema.parse(request.body);

    // If quotation_number is provided (bot already knows the order), record directly
    if (body.quotation_number) {
      const orders = await query(
        `SELECT id, quotation_number, client_name, total_amount, current_stage
         FROM orders
         WHERE quotation_number = $1 AND status = 'active'
         LIMIT 1`,
        [body.quotation_number]
      );

      if (orders.length === 0) {
        return reply.code(404).send({
          ok: false,
          error: `No active order found for quotation "${body.quotation_number}".`,
        });
      }

      const order = orders[0];
      const expectedDeposit = order.total_amount != null
        ? Number(order.total_amount) / 2
        : null;

      // Insert payment record into payments table (supports multiple deposits)
      await query(
        `INSERT INTO payments (order_id, type, amount, payment_date, image_url, source)
         VALUES ($1, 'deposit', $2, $3, $4, 'telegram_bot')`,
        [order.id, body.amount, body.deposit_paid_at ?? null, body.image_url ?? null]
      );

      const { depositTotal } = await getPaymentTotals(order.id);

      // Update order summary fields
      await query(
        `UPDATE orders SET
           deposit_paid=TRUE,
           deposit_verified=FALSE,
           deposit_amount=$1,
           deposit_image_url=COALESCE($2, deposit_image_url),
           deposit_paid_at=COALESCE($4, deposit_paid_at),
           current_stage=CASE
             WHEN current_stage IN ('quotation_received', 'order_confirmation_received', 'math_verified', 'deposit_pending', 'purchasing_pending', 'production_pending')
             THEN 'deposit_verification'
             ELSE current_stage
           END,
           updated_at=NOW()
         WHERE id=$3`,
        [depositTotal, body.image_url ?? null, order.id, body.deposit_paid_at ?? null]
      );

      await query(
        `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
         VALUES ($1, 'deposit_pending', 'deposit_paid', $2, 'telegram_bot')`,
        [order.id, `Downpayment of ₱${body.amount.toLocaleString()} recorded via deposit slip matching (total deposits: ₱${depositTotal.toLocaleString()})`]
      );
      await query(
        `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
         VALUES ($1, 'deposit_verification', 'pending', 'Downpayment recorded; awaiting payment verification', 'telegram_bot')`,
        [order.id]
      );

      // Complete any deposit reminders
      await query(
        `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage='deposit_pending' AND status='active'`,
        [order.id]
      );

      // Create a deposit_verification reminder (best-effort)
      try {
        await query(
          `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
           SELECT $1, 'deposit_verification', r.group_chat_id,
                  'Deposit has been submitted but not yet verified. Please check if the payment went through and verify.',
                  'daily', NOW() + INTERVAL '5 minutes', 'active'
           FROM reminders r
           WHERE r.order_id = $1 AND r.stage = 'deposit_pending' AND r.status = 'completed'
           LIMIT 1
           ON CONFLICT DO NOTHING`,
          [order.id]
        );
      } catch {
        console.warn(`[match-and-record] Failed to create deposit_verification reminder for order ${order.id}`);
      }

      // Notify collection agent immediately that a deposit needs verification
      triggerAgentsForStage('deposit_verification', order.quotation_number, order.client_name, 'telegram_bot');

      try {
        await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`, 'calendar:*', 'sales:*']);
      } catch {
        console.warn(`[match-and-record] Cache invalidation failed for ${order.quotation_number}`);
      }

      return reply.send({
        ok: true,
        matched: true,
        quotation_number: order.quotation_number,
        client_name: order.client_name,
        amount: body.amount,
        expected_deposit: expectedDeposit,
      });
    }

    // If client_name is provided, find order by client name and record deposit
    if (body.client_name) {
      const orders = await query<any>(
        `SELECT id, quotation_number, client_name, total_amount, current_stage
         FROM orders
         WHERE client_name ILIKE $1 AND deposit_paid = FALSE AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 1`,
        [`%${body.client_name}%`]
      );

      if (orders.length === 0) {
        return reply.code(404).send({
          ok: false,
          error: `No active order found for client "${body.client_name}" without a deposit.`,
        });
      }

      const order = orders[0];
      const expectedDeposit = order.total_amount != null
        ? Number(order.total_amount) / 2
        : null;

      // Insert payment record into payments table (supports multiple deposits)
      await query(
        `INSERT INTO payments (order_id, type, amount, payment_date, image_url, source)
         VALUES ($1, 'deposit', $2, $3, $4, 'telegram_bot')`,
        [order.id, body.amount, body.deposit_paid_at ?? null, body.image_url ?? null]
      );

      const { depositTotal } = await getPaymentTotals(order.id);

      // Update order summary fields
      await query(
        `UPDATE orders SET
           deposit_paid=TRUE,
           deposit_verified=FALSE,
           deposit_amount=$1,
           deposit_image_url=COALESCE($2, deposit_image_url),
           deposit_paid_at=COALESCE($4, deposit_paid_at),
           current_stage=CASE
             WHEN current_stage IN ('quotation_received', 'order_confirmation_received', 'math_verified', 'deposit_pending', 'purchasing_pending', 'production_pending')
             THEN 'deposit_verification'
             ELSE current_stage
           END,
           updated_at=NOW()
         WHERE id=$3`,
        [depositTotal, body.image_url ?? null, order.id, body.deposit_paid_at ?? null]
      );

      await query(
        `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
         VALUES ($1, 'deposit_pending', 'deposit_paid', $2, 'telegram_bot')`,
        [order.id, `Downpayment of ₱${body.amount.toLocaleString()} recorded via deposit slip matching (total deposits: ₱${depositTotal.toLocaleString()})`]
      );
      await query(
        `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
         VALUES ($1, 'deposit_verification', 'pending', 'Downpayment recorded; awaiting payment verification', 'telegram_bot')`,
        [order.id]
      );

      // Complete any deposit reminders
      await query(
        `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage='deposit_pending' AND status='active'`,
        [order.id]
      );

      // Create a deposit_verification reminder — collection agent will remind team to verify (best-effort)
      try {
        await query(
          `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
           SELECT $1, 'deposit_verification', r.group_chat_id,
                  'Deposit has been submitted but not yet verified. Please check if the payment went through and verify.',
                  'daily', NOW() + INTERVAL '5 minutes', 'active'
           FROM reminders r
           WHERE r.order_id = $1 AND r.stage = 'deposit_pending' AND r.status = 'completed'
           LIMIT 1
           ON CONFLICT DO NOTHING`,
          [order.id]
        );
      } catch {
        console.warn(`[match-and-record] Failed to create deposit_verification reminder for order ${order.id}`);
      }

      // Notify collection agent immediately that a deposit needs verification
      triggerAgentsForStage('deposit_verification', order.quotation_number, order.client_name, 'telegram_bot');

      try {
        await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`, 'calendar:*', 'sales:*']);
      } catch {
        console.warn(`[match-and-record] Cache invalidation failed for ${order.quotation_number}`);
      }

      return reply.send({
        ok: true,
        matched: true,
        quotation_number: order.quotation_number,
        client_name: order.client_name,
        amount: body.amount,
        expected_deposit: expectedDeposit,
      });
    }

    // No client_name — find candidate orders without deposit
    const candidates = await query<any>(
      `SELECT id, quotation_number, client_name, total_amount, current_stage
       FROM orders
       WHERE deposit_paid = FALSE AND status = 'active' AND total_amount IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 50`
    );

    if (candidates.length === 0) {
      return reply.send({
        ok: true,
        matched: false,
        candidates: [],
        message: 'No active orders found without a deposit.',
      });
    }

    // Compute expected deposit (50% of total) and check match with 20-30% tolerance
    const DISCREPANCY_RANGE = 0.30; // 30% tolerance
    const depositAmount = body.amount;

    const scored = candidates
      .map((o: any) => {
        const total = Number(o.total_amount);
        const expectedDeposit = total / 2;
        const diff = Math.abs(depositAmount - expectedDeposit);
        const discrepancy = diff / expectedDeposit; // 0.0 = perfect, 1.0 = 100% off

        return {
          id: o.id,
          quotation_number: o.quotation_number,
          client_name: o.client_name,
          total_amount: total,
          expected_deposit: expectedDeposit,
          discrepancy,
          within_range: discrepancy <= DISCREPANCY_RANGE,
        };
      })
      .filter((o: any) => o.within_range)
      .sort((a: any, b: any) => a.discrepancy - b.discrepancy); // best match first

    if (scored.length === 0) {
      // No close match found — return top candidates anyway so user can pick
      const topCandidates = candidates.slice(0, 5).map((o: any) => ({
        quotation_number: o.quotation_number,
        client_name: o.client_name,
        total_amount: Number(o.total_amount),
        expected_deposit: Number(o.total_amount) / 2,
      }));

      return reply.send({
        ok: true,
        matched: false,
        candidates: topCandidates,
        message: `Deposit amount ₱${depositAmount.toLocaleString()} does not closely match any order. Please specify the client name.`,
      });
    }

    // Return best match(es) — top 3 within range
    const matches = scored.slice(0, 3).map((o: any) => ({
      quotation_number: o.quotation_number,
      client_name: o.client_name,
      total_amount: o.total_amount,
      expected_deposit: o.expected_deposit,
      discrepancy: Math.round(o.discrepancy * 100),
    }));

    return reply.send({
      ok: true,
      matched: true,
      candidates: matches,
      deposit_amount: depositAmount,
      message: `Found ${matches.length} order(s) matching deposit of ₱${depositAmount.toLocaleString()}.`,
    });
  } catch (err: any) {
    console.error('[match-and-record] Error:', err);
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ ok: false, error: `Validation error: ${err.errors.map(e => e.message).join(', ')}` });
    }
    const message = err?.message ?? 'Unknown error';
    return reply.status(500).send({ ok: false, error: `Failed to match and record deposit: ${message}` });
  }
});

// ── Balance Payment Matching ─────────────────────────────────────────

/**
 * POST /deposits/match-balance
 *
 * Called when a deposit slip image is sent but the deposit is already paid.
 * Detects if this is a BALANCE payment instead.
 * 1. Finds all orders where deposit IS paid but balance is NOT paid
 * 2. Computes expected balance = total_amount - deposit_amount
 * 3. Matches the extracted amount against expected balance with 20-30% tolerance
 * 4. Returns the best matching candidate(s)
 */
const matchBalanceSchema = z.object({
  amount: z.number().positive(),
  client_name: z.string().optional(),
});

app.post('/deposits/match-balance', async (request, reply) => {
  try {
    const body = matchBalanceSchema.parse(request.body);

    // If client_name is provided, find order by client name and record balance
    if (body.client_name) {
      const orders = await query<any>(
        `SELECT id, quotation_number, client_name, total_amount, deposit_amount, current_stage
         FROM orders
         WHERE client_name ILIKE $1 AND deposit_paid = TRUE AND balance_paid = FALSE AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 1`,
        [`%${body.client_name}%`]
      );

      if (orders.length === 0) {
        return reply.code(404).send({
          ok: false,
          error: `No active order found for client "${body.client_name}" with deposit paid but balance pending.`,
        });
      }

      const order = orders[0];
      const totalAmount = Number(order.total_amount ?? 0);
      const depositAmount = Number(order.deposit_amount ?? 0);
      const expectedBalance = totalAmount - depositAmount;

      return reply.send({
        ok: true,
        matched: true,
        quotation_number: order.quotation_number,
        client_name: order.client_name,
        amount: body.amount,
        expected_balance: expectedBalance,
        payment_type: 'balance',
      });
    }

    // No client_name — find candidate orders with deposit paid but balance NOT paid
    const candidates = await query<any>(
      `SELECT id, quotation_number, client_name, total_amount, deposit_amount, current_stage
       FROM orders
       WHERE deposit_paid = TRUE AND balance_paid = FALSE AND status = 'active' AND total_amount IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 50`
    );

    if (candidates.length === 0) {
      return reply.send({
        ok: true,
        matched: false,
        candidates: [],
        message: 'No active orders found with deposit paid but balance pending.',
      });
    }

    // Compute expected balance and check match with 30% tolerance
    const DISCREPANCY_RANGE = 0.30;
    const paymentAmount = body.amount;

    const scored = candidates
      .map((o: any) => {
        const total = Number(o.total_amount);
        const deposit = Number(o.deposit_amount ?? 0);
        const expectedBalance = total - deposit;
        const diff = Math.abs(paymentAmount - expectedBalance);
        const discrepancy = expectedBalance > 0 ? diff / expectedBalance : 999;

        return {
          id: o.id,
          quotation_number: o.quotation_number,
          client_name: o.client_name,
          total_amount: total,
          deposit_amount: deposit,
          expected_balance: expectedBalance,
          discrepancy,
          within_range: discrepancy <= DISCREPANCY_RANGE,
        };
      })
      .filter((o: any) => o.within_range)
      .sort((a: any, b: any) => a.discrepancy - b.discrepancy);

    if (scored.length === 0) {
      // No close match found — return top candidates anyway
      const topCandidates = candidates.slice(0, 5).map((o: any) => {
        const total = Number(o.total_amount);
        const deposit = Number(o.deposit_amount ?? 0);
        return {
          quotation_number: o.quotation_number,
          client_name: o.client_name,
          total_amount: total,
          deposit_amount: deposit,
          expected_balance: total - deposit,
        };
      });

      return reply.send({
        ok: true,
        matched: false,
        candidates: topCandidates,
        message: `Payment amount ₱${paymentAmount.toLocaleString()} does not closely match any balance due. Please specify the client name.`,
      });
    }

    // Return best match(es) — top 3 within range
    const matches = scored.slice(0, 3).map((o: any) => ({
      quotation_number: o.quotation_number,
      client_name: o.client_name,
      total_amount: o.total_amount,
      deposit_amount: o.deposit_amount,
      expected_balance: o.expected_balance,
      discrepancy: Math.round(o.discrepancy * 100),
    }));

    return reply.send({
      ok: true,
      matched: true,
      candidates: matches,
      payment_amount: paymentAmount,
      payment_type: 'balance',
      message: `Found ${matches.length} order(s) matching balance payment of ₱${paymentAmount.toLocaleString()}.`,
    });
  } catch (err: any) {
    console.error('[match-balance] Error:', err);
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ ok: false, error: `Validation error: ${err.errors.map(e => e.message).join(', ')}` });
    }
    const message = err?.message ?? 'Unknown error';
    return reply.status(500).send({ ok: false, error: `Failed to match balance: ${message}` });
  }
});

// ── Pay Balance ──────────────────────────────────────────────────────

const payBalanceSchema = z.object({
  quotation_number: z.string(),
  amount: z.number().positive(),
  payment_date: z.string().optional(),
  reference_number: z.string().optional(),
  updated_by: z.string().optional(),
  action_token: z.string().optional(),
});

app.post('/pay-balance', async (request, reply) => {
  try {
    const body = payBalanceSchema.parse(request.body);

    // Verify action token and extract email
    let userEmail: string | null = null;
    if (isDashboardOrigin(body.updated_by)) {
      if (!cacheClient?.isOpen) {
        return reply.status(503).send({ error: 'Action verification unavailable' });
      }
      const tokenKey = `action_token:${body.action_token}`;
      const tokenData = await cacheClient.get(tokenKey);
      if (!tokenData) {
        return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
      }
      await cacheClient.del(tokenKey);
      const tokenPayload = JSON.parse(tokenData);
      userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
    }

    const orders = await query(
      `SELECT id, total_amount, deposit_amount, deposit_paid, balance_paid, client_name FROM orders WHERE quotation_number=$1`,
      [body.quotation_number]
    );
    if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });

    const order = orders[0];
    if (!order.deposit_paid) {
      return reply.code(400).send({ error: 'Deposit must be paid before balance payment can be processed. Please record the deposit first using /deposit.' });
    }

    if (order.total_amount == null) {
      return reply.code(400).send({ error: 'Total amount not set for this order. Cannot compute balance.' });
    }

    const orderId = order.id;
    const totalAmount = Number(order.total_amount);

    // Insert payment record into payments table (supports multiple balance payments)
    await query(
      `INSERT INTO payments (order_id, type, amount, reference_number, payment_date, source)
       VALUES ($1, 'balance', $2, $3, $4, $5)`,
      [orderId, body.amount, body.reference_number ?? null, body.payment_date ?? null, body.updated_by ?? 'api']
    );

    // Recompute totals from payments table
    const { depositTotal, balanceTotal } = await getPaymentTotals(orderId);
    const expectedBalance = totalAmount - depositTotal;
    const remainingBalance = Math.max(0, expectedBalance - balanceTotal);
    const isFullyPaid = balanceTotal >= expectedBalance;
    const overpayment = isFullyPaid ? balanceTotal - expectedBalance : 0;

    // Update order summary fields (backward-compatible)
    // Only advance to balance_verification and set balance_paid_at when FULLY paid.
    // Partial payments keep the current stage so more payments can be recorded.
    await query(
      `UPDATE orders SET
         balance_paid=$1,
         balance_verified=FALSE,
         balance_paid_at=CASE WHEN $1 THEN COALESCE($3, NOW()) ELSE balance_paid_at END,
         current_stage=CASE
           WHEN $1 AND current_stage IN ('balance_due', 'inventory_arrived')
           THEN 'balance_verification'
           ELSE current_stage
         END,
         updated_at=NOW()
       WHERE id=$2`,
      [isFullyPaid, orderId, body.payment_date ?? null]
    );

    // Record stage update
    const remarks = isFullyPaid
      ? (overpayment > 0
          ? `Balance of ₱${body.amount.toLocaleString()} paid (total balance: ₱${balanceTotal.toLocaleString()}, overpayment: ₱${overpayment.toLocaleString()})`
          : `Balance of ₱${body.amount.toLocaleString()} paid (total balance: ₱${balanceTotal.toLocaleString()})`)
      : `Partial balance of ₱${body.amount.toLocaleString()} recorded. Remaining: ₱${remainingBalance.toLocaleString()}`;
    await query(
      `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by) VALUES ($1, $2, $3, $4, $5)`,
      [orderId, isFullyPaid ? 'balance_verification' : 'balance_due', 'balance_paid', remarks, body.updated_by ?? null]
    );

    // Only complete balance_due reminders when balance is FULLY paid
    if (isFullyPaid) {
      await query(
        `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage IN ('balance_due', 'inventory_arrived') AND status='active'`,
        [orderId]
      );
    }

    // Create a balance_verification reminder only when FULLY paid (best-effort)
    if (isFullyPaid) {
      try {
        await query(
          `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
           SELECT $1, 'balance_verification', r.group_chat_id,
                  'Balance payment has been submitted but not yet verified. Please check if the payment went through and verify.',
                  'daily', NOW() + INTERVAL '5 minutes', 'active'
           FROM reminders r
           WHERE r.order_id = $1 AND r.stage = 'balance_due' AND r.status = 'completed'
           LIMIT 1
           ON CONFLICT DO NOTHING`,
          [orderId]
        );
      } catch {
        console.warn(`[pay-balance] Failed to create balance_verification reminder for order ${orderId}`);
      }

      // Notify collection agent immediately that balance needs verification
      triggerAgentsForStage('balance_verification', body.quotation_number, order.client_name, body.updated_by ?? undefined);
    } else {
      // Partial payment: update the balance_due reminder message to reflect remaining amount
      try {
        await query(
          `UPDATE reminders SET
             message = 'Balance is partially paid. Remaining: ₱' || $2 || '. Has the client paid the rest?',
             next_run_at = NOW() + INTERVAL '1 day',
             updated_at = NOW()
           WHERE order_id = $1 AND stage = 'balance_due' AND status = 'active'`,
          [orderId, remainingBalance.toString()]
        );
      } catch {
        console.warn(`[pay-balance] Failed to update balance_due reminder for order ${orderId}`);
      }
    }

    // Notify collection group
    setImmediate(() => {
      notifyGroupChat(
        COLLECTION_CHAT_ID,
        `💳 <b>Balance Payment Recorded — Needs Verification</b>\n\n` +
        `Quotation: <b>${body.quotation_number}</b>\n` +
        `Client: ${order.client_name ?? 'N/A'}\n` +
        `This payment: PHP ${body.amount.toLocaleString()}\n` +
        `Total balance paid: PHP ${balanceTotal.toLocaleString()}\n` +
        `Expected balance: PHP ${expectedBalance.toLocaleString()}\n` +
        (isFullyPaid
          ? (overpayment > 0 ? `Overpayment: PHP ${overpayment.toLocaleString()}\n` : 'Balance fully paid ✅\n')
          : `Remaining balance: PHP ${remainingBalance.toLocaleString()}\n`) +
        `Recorded by: ${body.updated_by ?? 'dashboard'}\n\n` +
        `Please verify the balance payment on the dashboard.`
      );
    });

    // Invalidate caches
    try {
      await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${body.quotation_number}`, 'calendar:*', 'sales:*']);
    } catch {
      console.warn(`[pay-balance] Cache invalidation failed for ${body.quotation_number}`);
    }

    if (isDashboardOrigin(body.updated_by)) {
      await notifyManualChange(
        'Quick Action: Balance payment recorded',
        `Quotation: *${body.quotation_number}*\n` +
        `This payment: PHP ${body.amount.toLocaleString()}\n` +
        `Total balance: PHP ${balanceTotal.toLocaleString()} / PHP ${expectedBalance.toLocaleString()}\n` +
        (isFullyPaid ? 'Status: Fully paid' : `Remaining: PHP ${remainingBalance.toLocaleString()}`),
        userEmail,
      );
    }

    return reply.send({
      ok: true,
      quotation_number: body.quotation_number,
      amount: body.amount,
      expected_balance: expectedBalance,
      balance_total: balanceTotal,
      remaining_balance: remainingBalance,
      is_fully_paid: isFullyPaid,
      overpayment: overpayment,
    });
  } catch (err: any) {
    console.error('[pay-balance] Error recording balance payment:', err);
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: `Validation error: ${err.errors.map(e => e.message).join(', ')}` });
    }
    const message = err?.message ?? 'Unknown error';
    return reply.status(500).send({ error: `Failed to record balance payment: ${message}` });
  }
});

// ── Pay Balance Bulk ─────────────────────────────────────────────────
// Accepts multiple payment slips in one authenticated call.
// Validates action_token once, inserts all valid slips, recomputes totals.

const payBalanceBulkSchema = z.object({
  quotation_number: z.string(),
  slips: z.array(z.object({
    amount: z.number().positive(),
    payment_date: z.string().optional(),
    reference_number: z.string().optional(),
  })).min(1),
  updated_by: z.string().optional(),
  action_token: z.string().optional(),
});

app.post('/pay-balance-bulk', async (request, reply) => {
  try {
    const body = payBalanceBulkSchema.parse(request.body);

    // Validate action token once
    let userEmail: string | null = null;
    if (isDashboardOrigin(body.updated_by)) {
      if (!cacheClient?.isOpen) {
        return reply.status(503).send({ error: 'Action verification unavailable' });
      }
      const tokenKey = `action_token:${body.action_token}`;
      const tokenData = await cacheClient.get(tokenKey);
      if (!tokenData) {
        return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
      }
      await cacheClient.del(tokenKey);
      const tokenPayload = JSON.parse(tokenData);
      userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
    }

    const orders = await query(
      `SELECT id, total_amount, deposit_amount, deposit_paid, balance_paid, client_name FROM orders WHERE quotation_number=$1`,
      [body.quotation_number]
    );
    if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });
    const order = orders[0];

    if (!order.deposit_paid) {
      return reply.code(400).send({ error: 'Deposit must be paid before balance payment can be processed.' });
    }
    if (order.total_amount == null) {
      return reply.code(400).send({ error: 'Total amount not set for this order.' });
    }

    const orderId = order.id;
    const totalAmount = Number(order.total_amount);

    // Server-side duplicate check: reject slips with same amount+date within this batch
    const seen = new Set<string>();
    for (const slip of body.slips) {
      const key = `${slip.amount}|${slip.payment_date ?? 'nodate'}`;
      if (seen.has(key)) {
        return reply.status(400).send({ error: `Duplicate slip detected: amount ${slip.amount} on ${slip.payment_date ?? 'no date'}. Each slip must have a unique amount+date combination.` });
      }
      seen.add(key);
    }

    // Insert all slip records
    for (const slip of body.slips) {
      await query(
        `INSERT INTO payments (order_id, type, amount, reference_number, payment_date, source)
         VALUES ($1, 'balance', $2, $3, $4, $5)`,
        [orderId, slip.amount, slip.reference_number ?? null, slip.payment_date ?? null, body.updated_by ?? 'api']
      );
    }

    // Recompute totals from payments table
    const { depositTotal, balanceTotal } = await getPaymentTotals(orderId);
    const expectedBalance = totalAmount - depositTotal;
    const remainingBalance = Math.max(0, expectedBalance - balanceTotal);
    const isFullyPaid = balanceTotal >= expectedBalance;
    const overpayment = isFullyPaid ? balanceTotal - expectedBalance : 0;
    const totalThisSubmission = body.slips.reduce((s, sl) => s + sl.amount, 0);

    // Update order
    const latestDate = body.slips
      .map(s => s.payment_date)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

    await query(
      `UPDATE orders SET
         balance_paid=$1,
         balance_verified=FALSE,
         balance_paid_at=CASE WHEN $1 THEN COALESCE($3, NOW()) ELSE balance_paid_at END,
         current_stage=CASE
           WHEN $1 AND current_stage IN ('balance_due', 'inventory_arrived')
           THEN 'balance_verification'
           ELSE current_stage
         END,
         updated_at=NOW()
       WHERE id=$2`,
      [isFullyPaid, orderId, latestDate]
    );

    // Stage update
    const slipCount = body.slips.length;
    const remarks = isFullyPaid
      ? (overpayment > 0
          ? `${slipCount} balance slip(s) recorded totalling ₱${totalThisSubmission.toLocaleString()} (total balance: ₱${balanceTotal.toLocaleString()}, overpayment: ₱${overpayment.toLocaleString()})`
          : `${slipCount} balance slip(s) recorded totalling ₱${totalThisSubmission.toLocaleString()} (total balance: ₱${balanceTotal.toLocaleString()})`)
      : `${slipCount} balance slip(s) recorded totalling ₱${totalThisSubmission.toLocaleString()}. Remaining: ₱${remainingBalance.toLocaleString()}`;

    await query(
      `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by) VALUES ($1, $2, $3, $4, $5)`,
      [orderId, isFullyPaid ? 'balance_verification' : 'balance_due', 'balance_paid', remarks, body.updated_by ?? null]
    );

    if (isFullyPaid) {
      await query(
        `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage IN ('balance_due', 'inventory_arrived') AND status='active'`,
        [orderId]
      );
      try {
        await query(
          `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
           SELECT $1, 'balance_verification', r.group_chat_id,
                  'Balance payment has been submitted but not yet verified. Please check if the payment went through and verify.',
                  'daily', NOW() + INTERVAL '5 minutes', 'active'
           FROM reminders r
           WHERE r.order_id = $1 AND r.stage = 'balance_due' AND r.status = 'completed'
           LIMIT 1
           ON CONFLICT DO NOTHING`,
          [orderId]
        );
      } catch {
        console.warn(`[pay-balance-bulk] Failed to create balance_verification reminder for order ${orderId}`);
      }
      triggerAgentsForStage('balance_verification', body.quotation_number, order.client_name, body.updated_by ?? undefined);
    } else {
      try {
        await query(
          `UPDATE reminders SET
             message = 'Balance is partially paid. Remaining: ₱' || $2 || '. Has the client paid the rest?',
             next_run_at = NOW() + INTERVAL '1 day',
             updated_at = NOW()
           WHERE order_id = $1 AND stage = 'balance_due' AND status = 'active'`,
          [orderId, remainingBalance.toString()]
        );
      } catch {
        console.warn(`[pay-balance-bulk] Failed to update balance_due reminder for order ${orderId}`);
      }
    }

    setImmediate(() => {
      notifyGroupChat(
        COLLECTION_CHAT_ID,
        `💳 <b>Balance Payment Recorded — Needs Verification</b>\n\n` +
        `Quotation: <b>${body.quotation_number}</b>\n` +
        `Client: ${order.client_name ?? 'N/A'}\n` +
        `Slips submitted: ${slipCount}\n` +
        `This submission: PHP ${totalThisSubmission.toLocaleString()}\n` +
        `Total balance paid: PHP ${balanceTotal.toLocaleString()}\n` +
        `Expected balance: PHP ${expectedBalance.toLocaleString()}\n` +
        (isFullyPaid
          ? (overpayment > 0 ? `Overpayment: PHP ${overpayment.toLocaleString()}\n` : 'Balance fully paid ✅\n')
          : `Remaining balance: PHP ${remainingBalance.toLocaleString()}\n`) +
        `Recorded by: ${body.updated_by ?? 'dashboard'}\n\n` +
        `Please verify the balance payment on the dashboard.`
      );
    });

    try {
      await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${body.quotation_number}`, 'calendar:*', 'sales:*']);
    } catch {
      console.warn(`[pay-balance-bulk] Cache invalidation failed for ${body.quotation_number}`);
    }

    if (isDashboardOrigin(body.updated_by)) {
      await notifyManualChange(
        `Quick Action: ${slipCount} balance slip(s) recorded`,
        `Quotation: *${body.quotation_number}*\n` +
        `Slips submitted: ${slipCount}\n` +
        `This submission: PHP ${totalThisSubmission.toLocaleString()}\n` +
        `Total balance: PHP ${balanceTotal.toLocaleString()} / PHP ${expectedBalance.toLocaleString()}\n` +
        (isFullyPaid ? 'Status: Fully paid' : `Remaining: PHP ${remainingBalance.toLocaleString()}`),
        userEmail,
      );
    }

    return reply.send({
      ok: true,
      quotation_number: body.quotation_number,
      slips_recorded: slipCount,
      total_this_submission: totalThisSubmission,
      expected_balance: expectedBalance,
      balance_total: balanceTotal,
      remaining_balance: remainingBalance,
      is_fully_paid: isFullyPaid,
      overpayment: overpayment,
    });
  } catch (err: any) {
    console.error('[pay-balance-bulk] Error:', err);
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: `Validation error: ${err.errors.map(e => e.message).join(', ')}` });
    }
    return reply.status(500).send({ error: `Failed to record balance payments: ${err?.message ?? 'Unknown error'}` });
  }
});

const fullPaymentSchema = z.object({
  quotation_number: z.string(),
  amount: z.number().positive(),
  payment_date: z.string().optional(),
  reference_number: z.string().optional(),
  paid_by: z.string().optional(),
  updated_by: z.string().optional(),
  action_token: z.string().optional(),
});

app.post('/full-payment', async (request, reply) => {
  try {
    const body = fullPaymentSchema.parse(request.body);

    let userEmail: string | null = null;
    if (isDashboardOrigin(body.updated_by)) {
      if (!cacheClient?.isOpen) {
        return reply.status(503).send({ error: 'Action verification unavailable' });
      }
      const tokenKey = `action_token:${body.action_token}`;
      const tokenData = await cacheClient.get(tokenKey);
      if (!tokenData) {
        return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
      }
      await cacheClient.del(tokenKey);
      const tokenPayload = JSON.parse(tokenData);
      userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
    }

    const orders = await query(
      `SELECT id, quotation_number, client_name, total_amount FROM orders WHERE quotation_number=$1 AND status='active'`,
      [body.quotation_number]
    );
    if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });
    if (orders[0].total_amount == null) {
      return reply.code(400).send({ error: 'Total amount is required before recording a full payment.' });
    }

    const full = await recordFullPaymentForOrder({
      orderId: orders[0].id,
      quotationNumber: orders[0].quotation_number,
      clientName: orders[0].client_name,
      totalAmount: Number(orders[0].total_amount),
      amount: body.amount,
      paymentDate: body.payment_date ?? null,
      referenceNumber: body.reference_number ?? null,
      paidBy: body.paid_by ?? null,
      source: body.updated_by ?? 'full_payment',
      updatedBy: userEmail ?? body.updated_by ?? null,
    });

    await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${body.quotation_number}`, 'calendar:*', 'sales:*']);
    broadcastSSE('order_updated', { id: orders[0].id });

    if (isDashboardOrigin(body.updated_by)) {
      await notifyManualChange(
        'Quick Action: Full payment recorded',
        `Quotation: *${body.quotation_number}*\nAmount: PHP ${body.amount.toLocaleString()}\nDeposit portion: PHP ${full.depositPortion.toLocaleString()}\nBalance portion: PHP ${full.balancePortion.toLocaleString()}${full.overpayment > 0 ? `\nOverpayment: PHP ${full.overpayment.toLocaleString()}` : ''}`,
        userEmail,
      );
    }

    return reply.send({
      ok: true,
      quotation_number: body.quotation_number,
      amount: body.amount,
      is_fully_paid: true,
      ...full,
    });
  } catch (err: any) {
    console.error('[full-payment] Error recording full payment:', err);
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: `Validation error: ${err.errors.map(e => e.message).join(', ')}` });
    }
    return reply.status(500).send({ error: err?.message ?? 'Failed to record full payment' });
  }
});

// ── Verify Deposit ──────────────────────────────────────────────────────

/**
 * POST /orders/:id/verify-deposit
 *
 * Called by the team (via dashboard or API) to verify that a deposit payment
 * has gone through. Sets deposit_verified=TRUE and advances the stage:
 *   deposit_pending → production_pending (or purchasing_pending)
 * Production remains blocked until this verification is complete, unless a production exception is granted.
 */
const verifyDepositSchema = z.object({
  verified_by: z.string().optional(),
  action_token: z.string().optional(),
});

app.post('/orders/:id/verify-deposit', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = verifyDepositSchema.parse(request.body);

  // Verify action token and extract email (dashboard only)
  let userEmail: string | null = null;
  if (isDashboardOrigin(body.verified_by)) {
    if (!cacheClient?.isOpen) {
      return reply.status(503).send({ error: 'Action verification unavailable' });
    }
    const tokenKey = `action_token:${body.action_token}`;
    const tokenData = await cacheClient.get(tokenKey);
    if (!tokenData) {
      return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    }
    await cacheClient.del(tokenKey);
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  }

  const orders = await query(
    `SELECT id, quotation_number, client_name, current_stage, deposit_paid, deposit_verified, balance_paid, order_type, stock_prep_days, stock_prep_ready_at
     FROM orders WHERE id = $1 AND status = 'active'`,
    [id],
  );
  if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });

  const order = orders[0];
  if (!order.deposit_paid) {
    return reply.code(400).send({ error: 'Deposit has not been paid yet. Cannot verify.' });
  }
  if (order.deposit_verified) {
    return reply.code(400).send({ error: 'Deposit is already verified.' });
  }

  // Stage check: normally only allowed from deposit_pending/deposit_verification.
  // Exception: production_exception orders may have advanced past these stages while deposit
  // was still unverified (e.g. delivery_pending). Allow verification in that case — we will
  // keep the current_stage unchanged instead of regressing it.
  const isEarlyVerificationStage = ['deposit_pending', 'deposit_verification'].includes(order.current_stage);
  const alreadyAdvanced = !isEarlyVerificationStage;
  if (alreadyAdvanced && !order.production_exception) {
    return reply.code(400).send({
      error: `Deposit can only be verified from deposit_pending or deposit_verification. Current stage: ${order.current_stage}.`,
      current_stage: order.current_stage,
    });
  }

  // Determine next stage:
  // - From-stock orders → stock_preparation (or balance_verification if full payment).
  // - Production exception orders already past verification stages → keep current_stage (no regression).
  // - Otherwise → purchasing_pending.
  const isFromStock = order.order_type === 'from_stock';
  const balanceAlsoPaid = !!order.balance_paid;
  const nextStage = isFromStock
    ? (balanceAlsoPaid ? 'balance_verification' : 'stock_preparation')
    : alreadyAdvanced
      ? order.current_stage
      : 'purchasing_pending';

  // Mark all deposit payment records as verified
  await query(
    `UPDATE payments SET verified=TRUE, verified_at=NOW(), verified_by=$2, updated_at=NOW()
     WHERE order_id=$1 AND type='deposit' AND verified=FALSE`,
    [id, body.verified_by ?? null]
  );

  // For from_stock orders, also (re)calculate stock_prep_ready_at in case it wasn't set at creation
  const prepDays = Number(order.stock_prep_days ?? 0);
  const readyAt = isFromStock
    ? (prepDays === 0 ? new Date() : new Date(Date.now() + prepDays * 86_400_000))
    : null;

  // For non-from-stock orders where balance is also paid (full payment deposit),
  // auto-verify the balance so that when inventory arrives later,
  // confirm-inventory-arrived sees balance_verified=TRUE and skips to delivery_pending
  // instead of getting stuck at balance_due with no one to verify the balance.
  const autoVerifyBalance = balanceAlsoPaid && !isFromStock;

  await query(
    `UPDATE orders SET
       deposit_verified = TRUE,
       deposit_verified_at = NOW(),
       deposit_verified_by = $2,
       balance_verified = CASE WHEN $5 THEN TRUE ELSE balance_verified END,
       balance_verified_at = CASE WHEN $5 THEN NOW() ELSE balance_verified_at END,
       balance_verified_by = CASE WHEN $5 THEN $2 ELSE balance_verified_by END,
       current_stage = $3,
       stock_prep_ready_at = COALESCE(stock_prep_ready_at, $4),
       updated_at = NOW()
     WHERE id = $1`,
    [id, body.verified_by ?? null, nextStage, readyAt?.toISOString() ?? null, autoVerifyBalance],
  );

  // Record stage updates
  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'deposit_verification', 'deposit_verified', $2, $3)`,
    [id, `Deposit verified by ${body.verified_by ?? 'team'}. Advancing to ${nextStage}.`, body.verified_by ?? null],
  );
  if (balanceAlsoPaid && isFromStock) {
    // From-stock full-payment order: deposit verified, now awaiting balance verification
    await query(
      `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
       VALUES ($1, 'balance_verification', 'awaiting_verification', $2, $3)`,
      [id, `Deposit verified — balance payment also recorded and awaiting verification.`, body.verified_by ?? null],
    );
  } else {
    await query(
      `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
       VALUES ($1, $2, 'ready', $3, $4)`,
      [id, nextStage,
        isFromStock
          ? `From-stock order — skipping production/en_route. Preparing from existing inventory.`
          : balanceAlsoPaid
            ? 'Downpayment verified. Full payment recorded — balance auto-verified. Order proceeds through production workflow and will skip to delivery_pending after inventory arrival.'
            : 'Downpayment verified; ready for purchasing/production preparation.',
        body.verified_by ?? null],
    );
  }

  // Complete deposit_verification reminders
  await query(
    `UPDATE reminders SET status='completed', updated_at=NOW()
     WHERE order_id = $1 AND stage = 'deposit_verification' AND status = 'active'`,
    [id],
  );

  // Trigger agents and send notifications based on order type
  triggerAgentsForStage(nextStage, order.quotation_number, order.client_name, userEmail ?? body.verified_by ?? undefined);

  if (balanceAlsoPaid && isFromStock) {
    // From-stock full-payment order: notify collection group that deposit is verified, balance still needs verification
    setImmediate(() => {
      notifyGroupChat(
        COLLECTION_CHAT_ID,
        `✅ <b>Deposit Verified (Full Payment — From Stock)</b>\n\n` +
        `Quotation: <b>${order.quotation_number}</b>\n` +
        `Client: ${order.client_name ?? 'N/A'}\n` +
        `Verified by: ${body.verified_by ?? 'team'}\n\n` +
        `Deposit has been verified. The balance payment also needs verification before the order can advance.\n` +
        `Please verify the balance on the <b>Collection</b> page.`
      );
    });
  } else if (isFromStock) {
    // From-stock: notify inventory/delivery group about stock preparation
    const inventoryGroupChatId = process.env.INVENTORY_GROUP_CHAT_ID;
    const prepLabel = prepDays === 0
      ? 'Immediate — stock is ready'
      : `${prepDays} day(s) — ready by ${readyAt!.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })}`;
    setImmediate(() => {
      notifyGroupChatWithButtons(
        inventoryGroupChatId ?? DELIVERY_CHAT_ID,
        `📦 <b>From-Stock Order Ready for Preparation</b>\n\n` +
        `Quotation: <b>${order.quotation_number}</b>\n` +
        `Client: ${order.client_name ?? 'N/A'}\n` +
        `Deposit verified by: ${body.verified_by ?? 'team'}\n` +
        `Preparation time: <b>${prepLabel}</b>\n\n` +
        `Please prepare the stock for delivery.`,
        [
          [
            { text: '✅ Stock Ready', callback_data: `stock_prep:ready:${order.quotation_number}` },
            { text: '⏳ Not Yet', callback_data: `stock_prep:delay:${order.quotation_number}` },
          ],
        ]
      );
    });

    // Create stock_preparation reminder
    setImmediate(async () => {
      try {
        const groupId = process.env.INVENTORY_GROUP_CHAT_ID ?? process.env.DELIVERY_GROUP_CHAT_ID ?? '';
        if (groupId) {
          await upsertStageReminder(
            id,
            'stock_preparation',
            groupId,
            `📦 From-stock order #${order.quotation_number} (${order.client_name ?? 'Unknown'}) is awaiting stock preparation. ${prepDays === 0 ? 'Immediate preparation requested.' : `Ready by: ${readyAt!.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })}`}`,
          );
        }
      } catch (err) {
        console.warn('[verify-deposit] Failed to upsert stock_preparation reminder:', err);
      }
    });

    // Notify collection group
    setImmediate(() => {
      notifyGroupChat(
        COLLECTION_CHAT_ID,
        `✅ <b>Deposit Verified (From-Stock Order)</b>\n\n` +
        `Quotation: <b>${order.quotation_number}</b>\n` +
        `Client: ${order.client_name ?? 'N/A'}\n` +
        `Verified by: ${body.verified_by ?? 'team'}\n` +
        `Next stage: <b>Stock Preparation</b>\n\n` +
        `No production needed — stock will be prepared from existing inventory.`
      );
    });
  } else {
    // Standard order (or production exception already past verification): notify collection group
    setImmediate(() => {
      const paymentLabel = balanceAlsoPaid ? 'Full Payment' : 'Downpayment';
      const stageNote = alreadyAdvanced
        ? `Current stage kept: <b>${order.current_stage.replace(/_/g, ' ')}</b> (order was already past deposit verification).`
        : `Next stage: <b>Purchasing Pending</b>`;
      notifyGroupChat(
        COLLECTION_CHAT_ID,
        `✅ <b>Deposit Verified${balanceAlsoPaid ? ' (Full Payment)' : ''}${alreadyAdvanced ? ' (Production Exception)' : ''}</b>\n\n` +
        `Quotation: <b>${order.quotation_number}</b>\n` +
        `Client: ${order.client_name ?? 'N/A'}\n` +
        `Verified by: ${body.verified_by ?? 'team'}\n` +
        `${stageNote}\n\n` +
        `${paymentLabel} has been verified on the dashboard.${balanceAlsoPaid && !alreadyAdvanced ? '\nBalance auto-verified — order will skip to delivery_pending after inventory arrival.' : ''}`
      );
    });

    // Only ask production group to start workflow if the order is not already past purchasing
    if (!alreadyAdvanced) {
      setImmediate(() => {
        const prodGroupChatId = process.env.PRODUCTION_GROUP_CHAT_ID;
        if (prodGroupChatId && _TELEGRAM_BOT_TOKEN) {
          const paymentLabel = balanceAlsoPaid ? 'Full Payment' : 'Downpayment';
          notifyGroupChatWithButtons(
            prodGroupChatId,
            `💰 <b>${paymentLabel} Verified</b>\n\n` +
            `Quotation: <b>${order.quotation_number}</b>\n` +
            `Client: ${order.client_name ?? 'N/A'}\n\n` +
            `The client has made the ${paymentLabel.toLowerCase()} and the deposit is now verified.\n\n` +
            `❓ <b>Do we proceed to start the production workflow?</b>`,
            [
              [
                { text: '✅ Yes, proceed', callback_data: `deposit:start_production:yes:${id}:${order.quotation_number}` },
                { text: '⏳ Not yet', callback_data: `deposit:start_production:no:${id}:${order.quotation_number}` },
              ],
            ]
          );
        }
      });

      setImmediate(async () => {
        try {
          const prodGroupChatId = process.env.PRODUCTION_GROUP_CHAT_ID;
          if (prodGroupChatId) {
            await upsertStageReminder(
              id,
              'purchasing_pending',
              prodGroupChatId,
              `💰 Deposit verified for #${order.quotation_number} (${order.client_name ?? 'Unknown'}). Do we proceed to start the production workflow?`,
            );
          }
        } catch (err) {
          console.warn('[verify-deposit] Failed to upsert purchasing_pending reminder:', err);
        }
      });
    }
  }

  // Notify escalation group (dashboard only)
  if (isDashboardOrigin(body.verified_by)) {
    const escalationStageLabel = alreadyAdvanced
      ? `${order.current_stage.replace(/_/g, ' ')} (production exception — stage unchanged)`
      : isFromStock
        ? (balanceAlsoPaid ? 'Balance Verification (full payment)' : 'Stock Preparation')
        : (balanceAlsoPaid ? 'Purchasing Pending (full payment, balance auto-verified)' : 'Purchasing Pending');
    await notifyManualChange(
      'Deposit verified',
      `Quotation: *${order.quotation_number ?? 'N/A'}*\nClient: *${order.client_name ?? 'Unknown'}*\nVerified by: ${body.verified_by ?? 'team'}\nNext stage: ${escalationStageLabel}`,
      userEmail,
    );
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`, 'calendar:*', 'sales:*']);

  return reply.send({ ok: true, quotation_number: order.quotation_number, next_stage: nextStage });
});

// ── Stock Preparation (from_stock orders) ──────────────────────────────

/**
 * POST /orders/:id/stock-ready
 * Marks a from_stock order's stock as ready and advances to balance_due.
 * Optionally deducts item quantities from inventory_items by name match.
 */
app.post('/orders/:id/stock-ready', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = z.object({
    deduct_inventory: z.boolean().default(true),
    updated_by: z.string().optional(),
    action_token: z.string().optional(),
  }).parse(request.body);

  // Verify action token for dashboard-originated requests
  let userEmail: string | null = null;
  if (isDashboardOrigin(body.updated_by)) {
    if (!body.action_token) {
      return reply.status(401).send({ error: 'Action token required for dashboard actions' });
    }
    if (!cacheClient?.isOpen) {
      return reply.status(503).send({ error: 'Action verification unavailable' });
    }
    const tokenKey = `action_token:${body.action_token}`;
    const tokenData = await cacheClient.get(tokenKey);
    if (!tokenData) {
      return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    }
    await cacheClient.del(tokenKey);
    try {
      const tokenPayload = JSON.parse(tokenData);
      userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
    } catch { /* non-fatal */ }
  }

  const rows = await query(
    `SELECT id, quotation_number, client_name, current_stage, order_type FROM orders WHERE id = $1 AND status = 'active'`,
    [id],
  );
  if (!rows[0]) return reply.code(404).send({ error: 'Order not found' });
  const order = rows[0];
  if (order.current_stage !== 'stock_preparation') {
    return reply.code(400).send({ error: `Order is not in stock_preparation stage (current: ${order.current_stage})` });
  }

  // Enforce all items are matched before advancing
  const unmatchedItems = await query(
    `SELECT id, name FROM order_items WHERE order_id = $1 AND (matched_inventory_item_id IS NULL OR inventory_match_verified = FALSE)`,
    [id],
  );
  if (unmatchedItems.length > 0) {
    return reply.code(400).send({
      error: `Cannot mark stock ready: ${unmatchedItems.length} item(s) are not matched to inventory.`,
      unmatched_items: unmatchedItems.map((i) => i.name),
    });
  }

  // Advance to balance_due
  await query(
    `UPDATE orders SET current_stage = 'balance_due', updated_at = NOW() WHERE id = $1`,
    [id],
  );
  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'stock_preparation', 'completed', 'Stock prepared and ready for delivery.', $2)`,
    [id, body.updated_by ?? 'system'],
  );
  await query(
    `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage='stock_preparation' AND status='active'`,
    [id],
  );

  // Deduct inventory quantities — use adjustInventoryForOrderItem for audit trail
  const deductions: { item_name: string; quantity: number }[] = [];
  if (body.deduct_inventory) {
    const items = await query<{ id: string; name: string; quantity: number; matched_inventory_item_id: string | null }>(
      `SELECT id, name, quantity, matched_inventory_item_id FROM order_items WHERE order_id = $1`,
      [id],
    );
    for (const item of items) {
      if (item.matched_inventory_item_id) {
        await adjustInventoryForOrderItem(
          id,
          item.id,
          item.name,
          -item.quantity,
          'stock_prep_deduct',
          `Stock prep deduction for order item: ${item.name} (${item.quantity} units).`,
          body.updated_by ?? 'system',
        );
        deductions.push({ item_name: item.name, quantity: item.quantity });
      }
    }
  }

  triggerAgentsForStage('balance_due', order.quotation_number, order.client_name, body.updated_by ?? undefined);

  // Notify collection and inventory groups
  setImmediate(() => {
    notifyGroupChat(
      COLLECTION_CHAT_ID,
      `📦 <b>Stock Ready — Balance Collection Needed</b>\n\n` +
      `Quotation: <b>${order.quotation_number}</b>\n` +
      `Client: ${order.client_name ?? 'N/A'}\n` +
      `Marked ready by: ${body.updated_by ?? 'system'}\n\n` +
      `Stock is prepared. Please collect the balance payment from the client.`
    );
  });

  const INVENTORY_GROUP_CHAT_ID = process.env.INVENTORY_GROUP_CHAT_ID;
  if (INVENTORY_GROUP_CHAT_ID) {
    setImmediate(() => {
      notifyGroupChat(
        INVENTORY_GROUP_CHAT_ID,
        `📦 <b>Stock Deducted — From-Stock Order Ready</b>\n\n` +
        `Quotation: <b>${order.quotation_number}</b>\n` +
        `Client: ${order.client_name ?? 'N/A'}\n\n` +
        `Stock has been deducted from inventory and order is ready for delivery.`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`, 'calendar:*', 'sales:*']);
  return reply.send({ ok: true, quotation_number: order.quotation_number, next_stage: 'balance_due', deductions });
});

/**
 * POST /orders/:id/set-stock-prep
 * Update prep days and ready date for a from_stock order.
 */
app.post('/orders/:id/set-stock-prep', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = z.object({
    stock_prep_days: z.number().int().min(0),
    updated_by: z.string().optional(),
  }).parse(request.body);

  const readyAt = body.stock_prep_days === 0
    ? new Date()
    : new Date(Date.now() + body.stock_prep_days * 86_400_000);

  await query(
    `UPDATE orders SET stock_prep_days = $1, stock_prep_ready_at = $2, updated_at = NOW() WHERE id = $3`,
    [body.stock_prep_days, readyAt.toISOString(), id],
  );

  // Reschedule the stock_preparation reminder to reflect the new ready date
  const orderRows = await query<{ quotation_number: string | null; client_name: string | null }>(
    `SELECT quotation_number, client_name FROM orders WHERE id = $1`,
    [id],
  );
  if (orderRows[0] && COLLECTION_CHAT_ID) {
    const ref = orderRows[0].quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = orderRows[0].client_name ?? 'Unknown';
    const reminderMessage = `Stock preparation for #${ref} (${client}). Ready in ${body.stock_prep_days} day(s).`;
    await upsertStageReminder(id, 'stock_preparation', COLLECTION_CHAT_ID, reminderMessage);
  }

  await invalidateCache(['dashboard:*', 'orders:*', 'calendar:*']);
  return reply.send({ ok: true, stock_prep_days: body.stock_prep_days, stock_prep_ready_at: readyAt.toISOString() });
});

/**
 * PATCH /orders/:order_id/items/:item_id/match-inventory
 * Save or update the matched inventory item for a given order item.
 * Also marks inventory_match_verified = TRUE.
 *
 * Request body: { inventory_item_id: string | null }
 *   - Pass a valid UUID to set the match
 *   - Pass null to clear the match
 */
app.patch('/orders/:order_id/items/:item_id/match-inventory', async (request, reply) => {
  const { order_id, item_id } = request.params as { order_id: string; item_id: string };
  const body = z.object({
    inventory_item_id: z.string().uuid().nullable(),
  }).parse(request.body);

  // Verify the order item exists
  const itemRows = await query(
    `SELECT id, name, order_id FROM order_items WHERE id = $1 AND order_id = $2`,
    [item_id, order_id]
  );
  if (!itemRows[0]) return reply.code(404).send({ error: 'Order item not found' });

  // If setting a match, verify the inventory item exists
  if (body.inventory_item_id) {
    const invRows = await query(
      `SELECT id FROM inventory_items WHERE id = $1`,
      [body.inventory_item_id]
    );
    if (!invRows[0]) return reply.code(404).send({ error: 'Inventory item not found' });
  }

  await query(
    `UPDATE order_items
     SET matched_inventory_item_id = $1,
         inventory_match_verified = TRUE,
         updated_at = NOW()
     WHERE id = $2 AND order_id = $3`,
    [body.inventory_item_id, item_id, order_id]
  );

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`]);
  return reply.send({ ok: true, matched_inventory_item_id: body.inventory_item_id });
});

// ── Verify Balance ──────────────────────────────────────────────────────

/**
 * POST /orders/:id/verify-balance
 *
 * Called by the team to verify that a balance payment has gone through.
 * Sets balance_verified=TRUE and advances the stage:
 *   balance_verification → payment_received
 * Completes the balance_verification reminder.
 */
const verifyBalanceSchema = z.object({
  verified_by: z.string().optional(),
  action_token: z.string().optional(),
});

app.post('/orders/:id/verify-balance', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = verifyBalanceSchema.parse(request.body);

  // Verify action token and extract email (dashboard only)
  let userEmail: string | null = null;
  if (isDashboardOrigin(body.verified_by)) {
    if (!cacheClient?.isOpen) {
      return reply.status(503).send({ error: 'Action verification unavailable' });
    }
    const tokenKey = `action_token:${body.action_token}`;
    const tokenData = await cacheClient.get(tokenKey);
    if (!tokenData) {
      return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    }
    await cacheClient.del(tokenKey);
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  }

  const orders = await query(
    `SELECT id, quotation_number, client_name, current_stage, balance_paid, balance_verified
     FROM orders WHERE id = $1 AND status = 'active'`,
    [id],
  );
  if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });

  const order = orders[0];
  if (!order.balance_paid) {
    return reply.code(400).send({ error: 'Balance has not been paid yet. Cannot verify.' });
  }
  if (order.balance_verified) {
    return reply.code(400).send({ error: 'Balance is already verified.' });
  }

  // Determine the next stage based on current stage:
  // - If order is at balance_due (not yet delivered) → advance to delivery_pending
  //   (delivery_pending means balance is verified but delivery date has NOT been set yet.
  //    The delivery agent will ask the team to input the delivery date.)
  // - If order is at delivered/countered (already delivered) → advance to payment_received
  const currentStage = order.current_stage;
  const nextStage = (currentStage === 'delivered' || currentStage === 'countered')
    ? 'payment_received'
    : (currentStage === 'balance_due' || currentStage === 'inventory_arrived' || currentStage === 'delivery_scheduled' || currentStage === 'balance_verification')
      ? 'delivery_pending'
      : currentStage;

  const stageLabel = nextStage === 'payment_received'
    ? 'Payment Received'
    : nextStage === 'delivery_pending'
      ? 'Delivery Pending'
      : `Current workflow stage (${nextStage})`;

  // Mark all balance payment records as verified
  await query(
    `UPDATE payments SET verified=TRUE, verified_at=NOW(), verified_by=$2, updated_at=NOW()
     WHERE order_id=$1 AND type='balance' AND verified=FALSE`,
    [id, body.verified_by ?? null]
  );

  await query(
    `UPDATE orders SET
       balance_verified = TRUE,
       balance_verified_at = NOW(),
       balance_verified_by = $2,
       current_stage = $3,
       updated_at = NOW()
     WHERE id = $1`,
    [id, body.verified_by ?? null, nextStage],
  );

  // Record stage update
  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, $2, 'balance_verified', $3, $4)`,
    [id, nextStage, `Balance verified by ${body.verified_by ?? 'team'}. Advancing to ${stageLabel}.`, body.verified_by ?? null],
  );

  // Complete balance_verification reminders
  await query(
    `UPDATE reminders SET status='completed', updated_at=NOW()
     WHERE order_id = $1 AND stage = 'balance_verification' AND status = 'active'`,
    [id],
  );

  // Notify the relevant agent immediately. If full payment is verified before production,
  // keep the order in its production workflow and let inventory arrival advance to delivery later.
  triggerAgentsForStage(nextStage === currentStage ? 'balance_verification' : nextStage, order.quotation_number, order.client_name, body.verified_by ?? undefined);

  // Notify collection group immediately — balance verified
  setImmediate(() => {
    notifyGroupChat(
      COLLECTION_CHAT_ID,
      `✅ <b>Balance Verified</b>\n\n` +
      `Quotation: <b>${order.quotation_number}</b>\n` +
      `Client: ${order.client_name ?? 'N/A'}\n` +
      `Verified by: ${body.verified_by ?? 'team'}\n` +
      `Next stage: <b>${stageLabel}</b>\n\n` +
      `Balance payment has been verified on the dashboard.`
    );
  });

  // Notify delivery group immediately — balance verified, needs delivery date
  if (nextStage === 'delivery_pending') {
    setImmediate(() => {
      notifyGroupChatWithButtons(
        DELIVERY_CHAT_ID,
        `📅 <b>Balance Verified — Delivery Date Needed</b>\n\n` +
        `Quotation: <b>${order.quotation_number}</b>\n` +
        `Client: ${order.client_name ?? 'N/A'}\n` +
        `Balance verified by: ${body.verified_by ?? 'team'}\n\n` +
        `Order is now in <b>Delivery Pending</b> stage.\n` +
        `Tap the button below to set the delivery date.`,
        [
          [{ text: '📅 Schedule Delivery', callback_data: `delivery:schedule:${order.id.slice(0, 8)}:${order.quotation_number}` }],
        ],
      );
    });
  }

  // Notify escalation group about balance verification (dashboard only)
  if (isDashboardOrigin(body.verified_by)) {
    await notifyManualChange(
      'Balance verified',
      `Quotation: *${order.quotation_number ?? 'N/A'}*\nClient: *${order.client_name ?? 'Unknown'}*\nVerified by: ${body.verified_by ?? 'team'}\nNext stage: ${stageLabel}`,
      userEmail,
    );
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`, 'calendar:*', 'sales:*']);

  return reply.send({ ok: true, quotation_number: order.quotation_number, next_stage: nextStage });
});

// ── Confirm Payment (Payment Received → Payment Confirmed) ──────────────
/**
 * Mirrors verify-balance behavior for the Payment Confirmed stage.
 * Called when an order at payment_received stage is advanced to payment_confirmed.
 * Sets balance_verified=TRUE, creates stage_updates, completes reminders,
 * triggers agents, and notifies Telegram groups.
 */
const confirmPaymentSchema = z.object({
  confirmed_by: z.string().optional(),
  action_token: z.string().optional(),
});

app.post('/orders/:id/confirm-payment', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = confirmPaymentSchema.parse(request.body);

  // Verify action token and extract email (dashboard only)
  let userEmail: string | null = null;
  if (isDashboardOrigin(body.confirmed_by)) {
    if (!cacheClient?.isOpen) {
      return reply.status(503).send({ error: 'Action verification unavailable' });
    }
    const tokenKey = `action_token:${body.action_token}`;
    const tokenData = await cacheClient.get(tokenKey);
    if (!tokenData) {
      return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    }
    await cacheClient.del(tokenKey);
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  }

  const orders = await query(
    `SELECT id, quotation_number, client_name, current_stage, balance_paid, balance_verified
     FROM orders WHERE id = $1 AND status = 'active'`,
    [id],
  );
  if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });

  const order = orders[0];

  // Must be at payment_received stage
  if (order.current_stage !== 'payment_received') {
    return reply.code(400).send({
      error: `Order is at '${order.current_stage}' stage. Payment Confirmed can only be applied to orders at 'payment_received' stage.`,
    });
  }

  // Advance to payment_confirmed
  const nextStage = 'payment_confirmed';
  const stageLabel = 'Payment Confirmed';

  // Mark all balance payment records as verified (if not already)
  await query(
    `UPDATE payments SET verified=TRUE, verified_at=NOW(), verified_by=$2, updated_at=NOW()
     WHERE order_id=$1 AND type='balance' AND verified=FALSE`,
    [id, body.confirmed_by ?? null]
  );

  await query(
    `UPDATE orders SET
       balance_verified = TRUE,
       balance_verified_at = NOW(),
       balance_verified_by = $2,
       current_stage = $3,
       updated_at = NOW()
     WHERE id = $1`,
    [id, body.confirmed_by ?? null, nextStage],
  );

  // Record stage update
  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, $2, 'payment_confirmed', $3, $4)`,
    [id, nextStage, `Payment confirmed by ${body.confirmed_by ?? 'team'}. Order advanced to ${stageLabel}.`, body.confirmed_by ?? null],
  );

  // Complete payment_received reminders
  await query(
    `UPDATE reminders SET status='completed', updated_at=NOW()
     WHERE order_id = $1 AND stage = 'payment_received' AND status = 'active'`,
    [id],
  );

  // Trigger agents for payment_confirmed stage
  triggerAgentsForStage('payment_confirmed', order.quotation_number, order.client_name, body.confirmed_by ?? undefined);

  // Notify collection group immediately — payment confirmed
  setImmediate(() => {
    notifyGroupChat(
      COLLECTION_CHAT_ID,
      `✅ <b>Payment Confirmed</b>\n\n` +
      `Quotation: <b>${order.quotation_number}</b>\n` +
      `Client: ${order.client_name ?? 'N/A'}\n` +
      `Confirmed by: ${body.confirmed_by ?? 'team'}\n` +
      `Next stage: <b>${stageLabel}</b>\n\n` +
      `Payment has been confirmed on the dashboard.`
    );
  });

  // Notify escalation group about payment confirmation (dashboard only)
  if (isDashboardOrigin(body.confirmed_by)) {
    await notifyManualChange(
      'Payment confirmed',
      `Quotation: *${order.quotation_number ?? 'N/A'}*\nClient: *${order.client_name ?? 'Unknown'}*\nConfirmed by: ${body.confirmed_by ?? 'team'}\nNext stage: ${stageLabel}`,
      userEmail,
    );
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`, 'calendar:*', 'sales:*']);

  return reply.send({ ok: true, quotation_number: order.quotation_number, next_stage: nextStage });
});

// ── Grant Delivery Exception (Special Case) ─────────────────────────
const deliveryExceptionSchema = z.object({
  order_id: z.string(),
  notes: z.string().optional(),
  granted_by: z.string().optional(),
  action_token: z.string(),
});

app.post('/orders/delivery-exception', async (request, reply) => {
  const body = deliveryExceptionSchema.parse(request.body);

  // Verify action token and extract email
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  const rows = await query(
    `UPDATE orders SET
      delivery_exception = TRUE,
      delivery_exception_notes = $2,
      delivery_exception_granted_at = NOW(),
      delivery_exception_granted_by = $3,
      updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [body.order_id, body.notes ?? null, body.granted_by ?? null]
  );

  if (!rows[0]) return reply.code(404).send({ error: 'Order not found' });

  // Record stage update
  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [body.order_id, 'delivery_exception', 'granted',
     `Delivery exception granted. Notes: ${body.notes ?? 'None provided'}`,
     body.granted_by ?? null]
  );

  // Notify escalation group about delivery exception
  await notifyManualChange(
    'Delivery exception granted',
    `Order ID: *${body.order_id.slice(0, 8)}...*\nNotes: ${body.notes ?? 'None'}\nGranted by: ${body.granted_by ?? 'dashboard'}`,
    userEmail,
  );

  // Notify delivery group directly
  if (DELIVERY_CHAT_ID) {
    setImmediate(() => {
      notifyGroupChat(
        DELIVERY_CHAT_ID,
        `⚠️ <b>Delivery Exception Granted (Dashboard)</b>\n\n` +
        `Order ID: <b>${body.order_id.slice(0, 8)}...</b>\n` +
        `Notes: ${body.notes ?? 'None provided'}\n` +
        `Granted by: ${body.granted_by ?? 'dashboard'}\n\n` +
        `A delivery exception has been granted via dashboard.`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id: body.order_id });
  return reply.send({ ok: true, order: rows[0] });
});

// ── Special Case (Skip Balance Payment) ─────────────────────────────
// Allows an order at balance_due to proceed to delivery without paying the balance.
// The order advances to 'countered' stage and must go through:
//   countered → payment_received → payment_confirmed → completed
// A payment_counter record is created to track sales invoice and delivery invoice status.
const specialCaseSchema = z.object({
  order_id: z.string(),
  notes: z.string().optional(),
  granted_by: z.string().optional(),
  action_token: z.string(),
});

app.post('/orders/special-case', async (request, reply) => {
  const body = specialCaseSchema.parse(request.body);

  // Verify action token and extract email
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  // Fetch the order to validate current stage
  const orderRows = await query(
    `SELECT id, quotation_number, client_name, current_stage, total_amount, deposit_amount FROM orders WHERE id=$1`,
    [body.order_id]
  );
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });
  const order = orderRows[0];

  // Only allow special case from balance_due stage
  if (order.current_stage !== 'balance_due') {
    return reply.code(400).send({
      error: `Special case can only be granted from 'balance_due' stage. Current stage: '${order.current_stage}'`,
    });
  }

  // Update order: set special_case flags and advance to delivery_pending
  const updatedRows = await query(
    `UPDATE orders SET
      special_case = TRUE,
      special_case_notes = $2,
      special_case_granted_at = NOW(),
      special_case_granted_by = $3,
      current_stage = 'delivery_pending',
      updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [body.order_id, body.notes ?? null, body.granted_by ?? null]
  );

  // Record stage update
  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by, client_name, actor_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [body.order_id, 'delivery_pending', 'special_case',
     `Special case granted — skipped balance payment. Proceeding to delivery. Notes: ${body.notes ?? 'None provided'}`,
     body.granted_by ?? null, order.client_name ?? null, userEmail]
  );

  // Auto-complete balance_due reminders
  await query(
    `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage='balance_due' AND status='active'`,
    [body.order_id]
  );

  // Notify about special case
  await notifyManualChange(
    'Special case granted — balance payment skipped',
    `Order: *${order.quotation_number ?? order.client_name ?? body.order_id.slice(0, 8)}*\nNotes: ${body.notes ?? 'None'}\nGranted by: ${body.granted_by ?? 'dashboard'}\nAdvanced to: delivery_pending`,
    userEmail,
  );

  // Notify delivery group
  if (DELIVERY_CHAT_ID) {
    setImmediate(() => {
      notifyGroupChat(
        DELIVERY_CHAT_ID,
        `🔄 <b>Special Case Granted (Dashboard)</b>\n\n` +
        `Order: <b>${order.quotation_number ?? body.order_id.slice(0, 8)}</b>\n` +
        `Client: ${order.client_name ?? 'Unknown'}\n` +
        `Notes: ${body.notes ?? 'None provided'}\n` +
        `Granted by: ${body.granted_by ?? 'dashboard'}\n\n` +
        `A special case has been granted — balance payment was skipped. The order is now at <b>Delivery Pending</b> stage. Please proceed with delivery, then verify countered status with invoice tracking.`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id: body.order_id });
  return reply.send({ ok: true, order: updatedRows[0] });
});

// ── Verify Countered ─────────────────────────────────────────────────
// Creates the payment_counter record for a special case order that has
// arrived at the countered stage. This enables invoice tracking.

const verifyCounteredSchema = z.object({
  order_id: z.string(),
  action_token: z.string(),
  notes: z.string().optional(),
});

app.post('/orders/verify-countered', async (request, reply) => {
  const body = verifyCounteredSchema.parse(request.body);

  // Verify action token
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  // Fetch the order
  const orderRows = await query(
    `SELECT id, quotation_number, client_name, current_stage, special_case FROM orders WHERE id=$1`,
    [body.order_id]
  );
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });
  const order = orderRows[0];

  // Only allow from countered stage and must be special_case
  if (order.current_stage !== 'countered') {
    return reply.code(400).send({
      error: `Can only verify countered from 'countered' stage. Current stage: '${order.current_stage}'`,
    });
  }
  if (!order.special_case) {
    return reply.code(400).send({
      error: 'Only special case orders can be verified as countered.',
    });
  }

  // Update order's updated_at to reflect the verification timestamp
  await query(
    `UPDATE orders SET updated_at=NOW() WHERE id=$1`,
    [body.order_id]
  );

  // Create payment_counter record (order is already at countered stage)
  await query(
    `INSERT INTO payment_counter (order_id, sales_invoice_status, delivery_receipt_status)
     VALUES ($1, 'pending', 'pending')
     ON CONFLICT (order_id) DO NOTHING`,
    [body.order_id]
  );

  // Record stage update
  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by, client_name, actor_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [body.order_id, 'countered', 'verified_countered',
     `Delivery verified — order moved to countered for payment collection. Notes: ${body.notes ?? 'None provided'}`,
     'dashboard', order.client_name ?? null, userEmail]
  );

  // Auto-complete delivery_pending reminders
  await query(
    `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage='delivery_pending' AND status='active'`,
    [body.order_id]
  );

  // Notify
  await notifyManualChange(
    'Order verified as countered',
    `Order: *${order.quotation_number ?? body.order_id.slice(0, 8)}*\nVerified by: ${userEmail ?? 'dashboard'}\nAdvanced to: countered`,
    userEmail,
  );

  // Notify collection group
  if (COLLECTION_CHAT_ID) {
    setImmediate(() => {
      notifyGroupChat(
        COLLECTION_CHAT_ID,
        `🔄 <b>Order Countered (Dashboard)</b>\n\n` +
        `Order: <b>${order.quotation_number ?? body.order_id.slice(0, 8)}</b>\n` +
        `Client: ${order.client_name ?? 'Unknown'}\n` +
        `Notes: ${body.notes ?? 'None provided'}\n\n` +
        `The order has been verified as countered. Please collect payment and update invoice status.`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id: body.order_id });
  return reply.send({ ok: true, order });
});

// ── Payment Counter ──────────────────────────────────────────────────
// Tracks sales invoice and delivery invoice status for special case orders.
// Allows uploading invoice files and marking them as received.

const updatePaymentCounterSchema = z.object({
  sales_invoice_status: z.enum(['pending', 'received']).optional(),
  delivery_receipt_status: z.enum(['pending', 'received']).optional(),
  received_date: z.string().nullable().optional(),
  delivery_date: z.string().nullable().optional(),
  sales_invoice_file_id: z.string().nullable().optional(),
  delivery_receipt_file_id: z.string().nullable().optional(),
  action_token: z.string(),
});

app.post('/orders/:id/payment-counter', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = updatePaymentCounterSchema.parse(request.body);

  // Verify action token
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  // Build dynamic SET clause
  const setClauses: string[] = [];
  const values: any[] = [];
  let paramIdx = 1;

  if (body.sales_invoice_status !== undefined) {
    setClauses.push(`sales_invoice_status = $${paramIdx++}`);
    values.push(body.sales_invoice_status);
  }
  if (body.delivery_receipt_status !== undefined) {
    setClauses.push(`delivery_receipt_status = $${paramIdx++}`);
    values.push(body.delivery_receipt_status);
  }
  if (body.received_date !== undefined) {
    setClauses.push(`received_date = $${paramIdx++}`);
    values.push(body.received_date);
  }
  if (body.delivery_date !== undefined) {
    setClauses.push(`delivery_date = $${paramIdx++}`);
    values.push(body.delivery_date);
  }
  if (body.sales_invoice_file_id !== undefined) {
    setClauses.push(`sales_invoice_file_id = $${paramIdx++}`);
    values.push(body.sales_invoice_file_id);
  }
  if (body.delivery_receipt_file_id !== undefined) {
    setClauses.push(`delivery_receipt_file_id = $${paramIdx++}`);
    values.push(body.delivery_receipt_file_id);
  }

  if (setClauses.length === 0) {
    return reply.code(400).send({ error: 'No fields to update' });
  }

  setClauses.push(`updated_at = NOW()`);
  values.push(id);

  await query(
    `INSERT INTO payment_counter (order_id, sales_invoice_status, delivery_receipt_status)
     VALUES ($1, 'pending', 'pending')
     ON CONFLICT (order_id) DO NOTHING`,
    [id]
  );

  const result = await query(
    `UPDATE payment_counter SET ${setClauses.join(', ')} WHERE order_id = $${paramIdx} RETURNING *`,
    values
  );

  if (!result[0]) return reply.code(404).send({ error: 'Payment counter not found for this order' });

  // Record stage update for invoice tracking
  if (body.sales_invoice_status === 'received' || body.delivery_receipt_status === 'received') {
    const remarks = [
      body.sales_invoice_status === 'received' ? 'Sales invoice marked as received' : null,
      body.delivery_receipt_status === 'received' ? 'Delivery receipt marked as received' : null,
    ].filter(Boolean).join('; ');

    await query(
      `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by, actor_name)
       VALUES ($1, 'countered', 'invoice_updated', $2, $3, $4)`,
      [id, remarks, 'dashboard', userEmail]
    );
  }

  await notifyManualChange(
    'Payment counter updated',
    `Order ID: *${id.slice(0, 8)}...*\nSales Invoice: ${body.sales_invoice_status ?? 'unchanged'}\nDelivery Receipt: ${body.delivery_receipt_status ?? 'unchanged'}`,
    userEmail,
  );

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });
  return reply.send({ ok: true, payment_counter: result[0] });
});

app.get('/orders/:id/payment-counter', async (request, reply) => {
  const { id } = request.params as { id: string };
  const rows = await query(
    `SELECT * FROM payment_counter WHERE order_id = $1`,
    [id]
  );
  if (!rows[0]) {
    return reply.send({ ok: true, payment_counter: null });
  }
  return reply.send({ ok: true, payment_counter: rows[0] });
});

// ── Revoke Delivery Exception ───────────────────────────────────────
const revokeDeliveryExceptionSchema = z.object({
  order_id: z.string(),
  action_token: z.string(),
});

app.post('/orders/revoke-delivery-exception', async (request, reply) => {
  const body = revokeDeliveryExceptionSchema.parse(request.body);

  // Verify action token and extract email
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  const rows = await query(
    `UPDATE orders SET
      delivery_exception = FALSE,
      delivery_exception_notes = NULL,
      delivery_exception_granted_at = NULL,
      delivery_exception_granted_by = NULL,
      updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [body.order_id]
  );

  if (!rows[0]) return reply.code(404).send({ error: 'Order not found' });

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks)
     VALUES ($1, $2, $3, $4)`,
    [body.order_id, 'delivery_exception', 'revoked', 'Delivery exception revoked.']
  );

  // Notify escalation group about delivery exception revocation
  await notifyManualChange(
    'Delivery exception revoked',
    `Order ID: *${body.order_id.slice(0, 8)}...*`,
    userEmail,
  );

  // Notify delivery group directly
  if (DELIVERY_CHAT_ID) {
    setImmediate(() => {
      notifyGroupChat(
        DELIVERY_CHAT_ID,
        `✅ <b>Delivery Exception Revoked (Dashboard)</b>\n\n` +
        `Order ID: <b>${body.order_id.slice(0, 8)}...</b>\n\n` +
        `The delivery exception has been revoked via dashboard.`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id: body.order_id });
  return reply.send({ ok: true, order: rows[0] });
});

// ── Grant Production Exception (Special Case) ─────────────────────────
// Allows production to proceed without a verified downpayment
const productionExceptionSchema = z.object({
  order_id: z.string(),
  notes: z.string().optional(),
  granted_by: z.string().optional(),
  action_token: z.string(),
});

app.post('/orders/production-exception', async (request, reply) => {
  const body = productionExceptionSchema.parse(request.body);

  // Verify action token and extract email
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  const rows = await query(
    `UPDATE orders SET
      production_exception = TRUE,
      production_exception_notes = $2,
      production_exception_granted_at = NOW(),
      production_exception_granted_by = $3,
      updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [body.order_id, body.notes ?? null, body.granted_by ?? null]
  );

  if (!rows[0]) return reply.code(404).send({ error: 'Order not found' });

  // Record stage update
  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [body.order_id, 'production_exception', 'granted',
     `Production exception granted. Notes: ${body.notes ?? 'None provided'}`,
     body.granted_by ?? null]
  );

  await notifyManualChange(
    'Production exception granted',
    `Order ID: *${body.order_id.slice(0, 8)}...*\nNotes: ${body.notes ?? 'None'}\nGranted by: ${body.granted_by ?? 'dashboard'}`,
    userEmail,
  );

  const PRODUCTION_CHAT_ID = process.env.PRODUCTION_CHAT_ID;
  if (PRODUCTION_CHAT_ID) {
    setImmediate(() => {
      notifyGroupChat(
        PRODUCTION_CHAT_ID,
        `⚠️ <b>Production Exception Granted (Dashboard)</b>\n\n` +
        `Order ID: <b>${body.order_id.slice(0, 8)}...</b>\n` +
        `Notes: ${body.notes ?? 'None provided'}\n` +
        `Granted by: ${body.granted_by ?? 'dashboard'}\n\n` +
        `A production exception has been granted via dashboard.`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id: body.order_id });
  return reply.send({ ok: true, order: rows[0] });
});

// ── Revoke Production Exception ───────────────────────────────────────
const revokeProductionExceptionSchema = z.object({
  order_id: z.string(),
  action_token: z.string(),
});

app.post('/orders/revoke-production-exception', async (request, reply) => {
  const body = revokeProductionExceptionSchema.parse(request.body);

  // Verify action token and extract email
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  const rows = await query(
    `UPDATE orders SET
      production_exception = FALSE,
      production_exception_notes = NULL,
      production_exception_granted_at = NULL,
      production_exception_granted_by = NULL,
      updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [body.order_id]
  );

  if (!rows[0]) return reply.code(404).send({ error: 'Order not found' });

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks)
     VALUES ($1, $2, $3, $4)`,
    [body.order_id, 'production_exception', 'revoked', 'Production exception revoked.']
  );

  await notifyManualChange(
    'Production exception revoked',
    `Order ID: *${body.order_id.slice(0, 8)}...*`,
    userEmail,
  );

  const PRODUCTION_CHAT_ID = process.env.PRODUCTION_CHAT_ID;
  if (PRODUCTION_CHAT_ID) {
    setImmediate(() => {
      notifyGroupChat(
        PRODUCTION_CHAT_ID,
        `✅ <b>Production Exception Revoked (Dashboard)</b>\n\n` +
        `Order ID: <b>${body.order_id.slice(0, 8)}...</b>\n\n` +
        `The production exception has been revoked via dashboard.`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id: body.order_id });
  return reply.send({ ok: true, order: rows[0] });
});

app.get('/orders/:order_id/stage-updates', async (request, reply) => {
  const params = z.object({ order_id: z.string() }).parse(request.params);
  return query(`SELECT * FROM stage_updates WHERE order_id=$1 ORDER BY created_at DESC`, [params.order_id]);
});

// ── Agent Notes ─────────────────────────────────────────────────────
// Free-form notes that agents (Hermes, collection, delivery, etc.) can
// attach to orders for communication, updates, and flexible task tracking.

app.get('/orders/:order_id/notes', async (request, reply) => {
  const params = z.object({ order_id: z.string() }).parse(request.params);
  return query(
    `SELECT id, order_id, agent_name, note, created_at
     FROM agent_notes WHERE order_id=$1 ORDER BY created_at DESC`,
    [params.order_id]
  );
});

// ── Order Files ───────────────────────────────────────────────────────

app.get('/orders/:order_id/files', async (request, reply) => {
  const params = z.object({ order_id: z.string().uuid() }).parse(request.params);
  const rows = await query(
    `SELECT id, order_id, file_type, original_filename, storage_backend, local_file_path, mime_type, extracted_text, created_at
     FROM files WHERE order_id=$1 ORDER BY created_at DESC`,
    [params.order_id]
  );
  return reply.send({ ok: true, files: rows });
});

/**
 * GET /orders/:order_id/files/:file_id/download
 * Proxy binary file download from file-store service.
 */
app.get('/orders/:order_id/files/:file_id/download', async (request, reply) => {
  const params = z.object({ order_id: z.string().uuid(), file_id: z.string().uuid() }).parse(request.params);
  const fileRows = await query(
    `SELECT f.*, o.quotation_number FROM files f JOIN orders o ON o.id = f.order_id WHERE f.id=$1 AND f.order_id=$2`,
    [params.file_id, params.order_id]
  );
  if (!fileRows[0]) return reply.code(404).send({ error: 'File not found' });

  const fileRow = fileRows[0];
  const quotationNumber = fileRow.quotation_number;
  const localFilePath: string | null = fileRow.local_file_path ?? null;
  const FILE_STORE_URL = process.env.FILE_STORE_URL ?? 'http://file-store:8090';
  try {
    // Prefer exact path lookup (per-file) over quotation-number lookup (latest only)
    const url = localFilePath
      ? `${FILE_STORE_URL}/files/binary-by-path?path=${encodeURIComponent(localFilePath)}`
      : `${FILE_STORE_URL}/files/binary/${encodeURIComponent(quotationNumber)}`;

    const res = await fetch(url);
    if (!res.ok) return reply.code(404).send({ error: 'File not found in store' });

    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    const buffer = Buffer.from(await res.arrayBuffer());
    reply.header('Content-Type', contentType);
    reply.header('Content-Length', buffer.length);
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.send(buffer);
  } catch (err) {
    console.error('[FileDownload] Failed to proxy file from file-store:', err);
    return reply.code(502).send({ error: 'Failed to retrieve file' });
  }
});

app.post('/orders/:order_id/notes', async (request, reply) => {
  const params = z.object({ order_id: z.string() }).parse(request.params);
  const body = z.object({
    agent_name: z.string().min(1),
    note: z.string().min(1),
    action_token: z.string(),
  }).parse(request.body);

  // Verify action token
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const rows = await query(
    `INSERT INTO agent_notes (order_id, agent_name, note) VALUES ($1, $2, $3) RETURNING *`,
    [params.order_id, body.agent_name, body.note]
  );
  return rows[0];
});

// ── Production Notes (no OTP required) ──────────────────────────────

app.post('/orders/:order_id/production-notes', async (request, reply) => {
  const params = z.object({ order_id: z.string() }).parse(request.params);
  const body = z.object({
    note: z.string().min(1),
    created_by: z.string().optional().default('production-user'),
  }).parse(request.body);

  const rows = await query(
    `INSERT INTO agent_notes (order_id, agent_name, note) VALUES ($1, $2, $3) RETURNING id, order_id, agent_name, note, created_at`,
    [params.order_id, body.created_by, body.note]
  );
  return rows[0];
});

// ── Agent Logs ──────────────────────────────────────────────────────

app.get('/agent-logs', async () => {
  const cached = await cacheGet<object[]>('agent-logs');
  if (cached) return cached;
  const rows = await query(
    `SELECT id, agent_name, status, input, output, error, created_at
     FROM agent_logs ORDER BY created_at DESC LIMIT 100`
  );
  await cacheSet('agent-logs', rows, 15); // shorter TTL for logs
  return rows;
});

// ── Backup Status ───────────────────────────────────────────────────

/**
 * GET /backups — List Supabase backup files and latest backup log entry
 * Returns backup files from Supabase Storage + the most recent agent_log
 * entry for the supabase-backup agent.
 */
app.get('/backups', async () => {
  const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const SUPABASE_BACKUP_BUCKET = process.env.SUPABASE_BACKUP_BUCKET ?? 'db-backups';

  // Get latest backup log from DB
  const logRows = await query(
    `SELECT id, agent_name, status, input, output, error, created_at
     FROM agent_logs
     WHERE agent_name = 'supabase-backup'
     ORDER BY created_at DESC LIMIT 1`
  );
  const latestLog = logRows[0] ?? null;

  // If no Supabase credentials, return just the log
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { files: [], latestLog };
  }

  // List backup files from Supabase Storage
  try {
    const url = `${SUPABASE_URL}/storage/v1/object/list/${SUPABASE_BACKUP_BUCKET}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefix: '', sortBy: { column: 'created_at', order: 'desc' } }),
    });

    if (!res.ok) {
      return { files: [], latestLog, error: `Supabase API error: ${res.status}` };
    }

    const data = await res.json();
    const files = (Array.isArray(data) ? data : [])
      .filter((f: any) => f.name)
      .map((f: any) => ({
        name: f.name,
        size_bytes: f.metadata?.size ?? f.size ?? 0,
        created_at: f.created_at,
        updated_at: f.updated_at,
      }));

    return { files, latestLog };
  } catch (err) {
    return { files: [], latestLog, error: String(err) };
  }
});

/**
 * GET /backups/download/:filename — Proxy download of a backup file from Supabase Storage
 */
app.get('/backups/download/:filename', async (request, reply) => {
  const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const SUPABASE_BACKUP_BUCKET = process.env.SUPABASE_BACKUP_BUCKET ?? 'db-backups';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return reply.code(400).send({ error: 'Supabase not configured' });
  }

  const params = z.object({ filename: z.string() }).parse(request.params);
  const filename = params.filename;

  // Validate filename — only allow .sql.gz files matching our backup pattern
  // Prevents path traversal attacks (e.g. "../../other-bucket/file")
  if (!/^db_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.sql\.gz$/.test(filename)) {
    return reply.code(400).send({ error: 'Invalid backup filename' });
  }

  try {
    const url = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BACKUP_BUCKET}/${filename}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    });

    if (!res.ok) {
      return reply.code(res.status).send({ error: `Supabase API error: ${res.status}` });
    }

    const buffer = await res.arrayBuffer();
    return reply
      .header('Content-Type', 'application/gzip')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(Buffer.from(buffer));
  } catch (err) {
    return reply.code(500).send({ error: String(err) });
  }
});

/**
 * POST /vision/extract — Use Gemini Vision to extract data from an image
 * Body: { image_base64: string, mime_type: string, mode?: 'auto' | 'quotation' | 'payment' }
 * Returns extracted fields as JSON.
 */
const visionExtractSchema = z.object({
  image_base64: z.string().min(1, 'image_base64 is required'),
  mime_type: z.string().default('image/jpeg'),
  mode: z.enum(['auto', 'quotation', 'payment']).default('auto'),
});

app.post('/vision/extract', async (request, reply) => {
  const body = visionExtractSchema.parse(request.body);

  try {
    let result;
    switch (body.mode) {
      case 'quotation':
        result = await extractQuotation(body.image_base64, body.mime_type);
        break;
      case 'payment':
        result = await extractPayment(body.image_base64, body.mime_type);
        break;
      default:
        result = await autoExtract(body.image_base64, body.mime_type);
    }

    return reply.send({ ok: true, ...result });
  } catch (err: any) {
    console.error('[vision] Extraction error:', err);
    return reply.code(500).send({
      ok: false,
      error: err.message,
      type: 'unknown',
      raw_text: '',
      confidence: 'low',
    });
  }
});

// ── Vision Share Endpoints ──────────────────────────────────────────
// Database-backed store for extracted vision data shared from Telegram bot
// to the dashboard GUI. Data persists for 48 hours and survives API restarts.
// This replaces the previous in-memory Map which had only 30min TTL.

const visionShareSchema = z.object({
  image_base64: z.string().min(1),
  mime_type: z.string().min(1),
  file_name: z.string().min(1),
  extracted: z.record(z.string(), z.unknown()),
  type: z.enum(['quotation', 'payment', 'unknown']),
  confidence: z.enum(['high', 'medium', 'low']),
  raw_text: z.string(),
});

// POST /vision/share — Store extracted vision data and return a share token
app.post('/vision/share', async (request, reply) => {
  const body = visionShareSchema.parse(request.body);
  const token = randomUUID();
  await query(
    `INSERT INTO vision_uploads (token, image_base64, mime_type, file_name, extracted, type, confidence, raw_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [token, body.image_base64, body.mime_type, body.file_name,
     JSON.stringify(body.extracted), body.type, body.confidence, body.raw_text]
  );
  return { ok: true, token };
});

// GET /vision/share/:token — Retrieve a specific vision upload by token
app.get('/vision/share/:token', async (request, reply) => {
  const params = z.object({ token: z.string().uuid() }).parse(request.params);
  const rows = await query<any>(
    `SELECT image_base64, mime_type, file_name, extracted, type, confidence, raw_text, created_at
     FROM vision_uploads
     WHERE token = $1 AND expires_at > NOW()`,
    [params.token]
  );
  if (rows.length === 0) {
    return reply.code(404).send({ ok: false, error: 'Share not found or expired' });
  }
  const row = rows[0];
  return {
    ok: true,
    image_base64: row.image_base64,
    mime_type: row.mime_type,
    file_name: row.file_name,
    extracted: row.extracted,
    type: row.type,
    confidence: row.confidence,
    raw_text: row.raw_text,
    created_at: new Date(row.created_at).getTime(),
  };
});

// GET /vision/uploads — List recent vision uploads (for the Vision Upload tab)
app.get('/vision/uploads', async () => {
  const rows = await query<any>(
    `SELECT token, file_name, type, confidence, created_at
     FROM vision_uploads
     WHERE expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 50`
  );
  return {
    ok: true,
    uploads: rows.map((r: any) => ({
      token: r.token,
      file_name: r.file_name,
      type: r.type,
      confidence: r.confidence,
      created_at: new Date(r.created_at).getTime(),
    })),
  };
});

// Periodic cleanup of expired vision uploads (runs every 10 minutes)
setInterval(async () => {
  try {
    const result = await query('DELETE FROM vision_uploads WHERE expires_at <= NOW()');
    if (result.length > 0) {
      console.log(`[vision] Cleaned up ${result.length} expired upload(s)`);
    }
  } catch (err) {
    console.error('[vision] Cleanup error:', err);
  }
}, 600_000);

// ── Agent Endpoints ─────────────────────────────────────────────────

/**
 * GET /agents — List all available agents and their schedules
 */
app.get('/agents', async () => {
  return listAgents();
});

/**
 * POST /agents/run/:name — Manually trigger a specific agent
 */
app.post('/agents/run/:name', async (request, reply) => {
  const params = z.object({ name: z.string() }).parse(request.params);
  const body = z.object({ action_token: z.string() }).parse(request.body);

  // Verify action token
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);

  const result = await runAgentByName(params.name);
  if (!result.ok) return reply.code(400).send(result);
  return result;
});

/**
 * POST /agents/quotation-checker — Check quotation math for an order
 * Can be called on-demand when a new order is created or file uploaded.
 * Body: { quotation_number, total_amount, computed_amount }
 */
app.post('/agents/quotation-checker', async (request, reply) => {
  const body = request.body as any;
  const quotationNumber = body?.quotation_number;

  if (!quotationNumber) {
    return reply.code(400).send({ error: 'quotation_number is required' });
  }

  // Fetch the order from DB
  const orders = await query(
    `SELECT * FROM orders WHERE quotation_number = $1`,
    [quotationNumber]
  );
  if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });

  const result = await checkQuotation(orders[0]);
  return result;
});

/**
 * POST /agents/purchasing — Check purchasing status for an order
 * Body: { quotation_number }
 */
app.post('/agents/purchasing', async (request, reply) => {
  const body = request.body as any;
  const quotationNumber = body?.quotation_number;

  if (!quotationNumber) {
    return reply.code(400).send({ error: 'quotation_number is required' });
  }

  const orders = await query(
    `SELECT * FROM orders WHERE quotation_number = $1`,
    [quotationNumber]
  );
  if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });

  const result = await checkPurchasing(orders[0]);
  return result;
});

/**
 * POST /agents/inventory — Check inventory status for an order
 * Body: { quotation_number }
 */
app.post('/agents/inventory', async (request, reply) => {
  const body = request.body as any;
  const quotationNumber = body?.quotation_number;

  if (!quotationNumber) {
    return reply.code(400).send({ error: 'quotation_number is required' });
  }

  const orders = await query(
    `SELECT * FROM orders WHERE quotation_number = $1`,
    [quotationNumber]
  );
  if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });

  const result = await checkInventory(orders[0]);
  return result;
});

/**
 * POST /agents/delivery — Check delivery status for an order
 * Body: { quotation_number }
 */
app.post('/agents/delivery', async (request, reply) => {
  const body = request.body as any;
  const quotationNumber = body?.quotation_number;

  if (!quotationNumber) {
    return reply.code(400).send({ error: 'quotation_number is required' });
  }

  const orders = await query(
    `SELECT * FROM orders WHERE quotation_number = $1`,
    [quotationNumber]
  );
  if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });

  const order = orders[0];
  const result = await checkScheduledDelivery(order);
  return result;
});

/**
 * POST /agents/collection — Check collection status for an order
 * Body: { quotation_number }
 */
app.post('/agents/collection', async (request, reply) => {
  const body = request.body as any;
  const quotationNumber = body?.quotation_number;

  if (!quotationNumber) {
    return reply.code(400).send({ error: 'quotation_number is required' });
  }

  const orders = await query(
    `SELECT * FROM orders WHERE quotation_number = $1`,
    [quotationNumber]
  );
  if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });

  const result = await checkCollection(orders[0]);
  return result;
});

/**
 * POST /agents/escalation — Check escalation status for an order
 * Body: { quotation_number }
 */
app.post('/agents/escalation', async (request, reply) => {
  const body = request.body as any;
  const quotationNumber = body?.quotation_number;

  if (!quotationNumber) {
    return reply.code(400).send({ error: 'quotation_number is required' });
  }

  const orders = await query(
    `SELECT * FROM orders WHERE quotation_number = $1`,
    [quotationNumber]
  );
  if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });

  const result = await checkEscalation(orders[0]);
  return result;
});

/**
 * POST /agents/run/schedule-parser — Parse natural language into a structured schedule entry
 * Used by the Telegram bot's schedule group chat to intelligently parse user messages.
 * Body: { text, username }
 * Returns: { parsed: boolean, title?, date?, time?, description?, reply? }
 */
app.post('/agents/run/schedule-parser', async (request, reply) => {
  const body = request.body as any;
  const text: string = body?.text ?? '';
  const username: string | null = body?.username ?? null;

  if (!text) {
    return reply.code(400).send({ parsed: false, reply: '❌ No text provided.' });
  }

  const prompt = `You are a smart schedule parser. Extract schedule information from the following text.

Rules:
- Extract the title/event name
- Extract the date (if mentioned). Return in YYYY-MM-DD format.
- Extract the time (if mentioned). Return in HH:MM format (24-hour).
- Extract any additional description/notes.
- If the text mentions "today", use ${new Date().toISOString().slice(0, 10)}.
- If the text mentions "tomorrow", use ${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}.
- If no date is found, DO NOT guess — return date as empty string.
- If no time is found, return time as empty string.

Respond ONLY with a valid JSON object (no markdown, no code fences):
{
  "parsed": true/false,
  "title": "string or empty",
  "date": "YYYY-MM-DD or empty",
  "time": "HH:MM or empty",
  "description": "string or empty",
  "reply": "A friendly message to the user confirming what was detected, or asking for clarification if something is missing"
}

Text to parse: "${text.substring(0, 1000)}"`;

  /**
   * Try calling an AI provider to parse the schedule text.
   * Falls back through Gemini → OpenRouter → manual.
   */
  async function callAiParser(): Promise<{ parsed: boolean; title?: string; date?: string; time?: string; description?: string; reply: string } | null> {
    const errors: string[] = [];

    // Try Gemini first
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
            }),
            signal: AbortSignal.timeout(10_000),
          }
        );

        if (response.ok) {
          const geminiData = await response.json() as any;
          const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.parsed && parsed.title && parsed.date) {
              return {
                parsed: true,
                title: parsed.title,
                date: parsed.date,
                time: parsed.time || undefined,
                description: parsed.description || undefined,
                reply: parsed.reply || `📅 Detected: *${parsed.title}* on ${parsed.date}${parsed.time ? ` at ${parsed.time}` : ''}`,
              };
            }
            // AI couldn't fully parse — return its reply
            return {
              parsed: false,
              reply: parsed.reply || '❌ Could not understand that. Please specify a date (e.g., "Meeting on Monday" or "Event tomorrow at 2pm").',
            };
          }
          console.error('[schedule-parser] No JSON found in Gemini response:', rawText);
          errors.push('Gemini returned non-JSON response');
        } else {
          const errText = await response.text().catch(() => 'unknown error');
          console.error('[schedule-parser] Gemini API error:', response.status, errText);
          errors.push(`Gemini error ${response.status}`);
        }
      } catch (err: any) {
        console.warn('[schedule-parser] Gemini failed; trying OpenRouter fallback:', err.message);
        errors.push(`Gemini: ${err.message}`);
      }
    } else {
      errors.push('GEMINI_API_KEY not configured');
    }

    // Try OpenRouter as fallback
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (openRouterKey) {
      try {
        const response = await fetch(
          process.env.OPENROUTER_API_BASE || 'https://openrouter.ai/api/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openRouterKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': process.env.DASHBOARD_BASE_URL || 'https://track.abcx124.xyz',
              'X-Title': 'Quotation Automation System',
            },
            body: JSON.stringify({
              model: process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001',
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.1,
              max_tokens: 300,
            }),
            signal: AbortSignal.timeout(10_000),
          }
        );

        if (response.ok) {
          const data = await response.json() as any;
          const rawText = data?.choices?.[0]?.message?.content ?? '';
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.parsed && parsed.title && parsed.date) {
              return {
                parsed: true,
                title: parsed.title,
                date: parsed.date,
                time: parsed.time || undefined,
                description: parsed.description || undefined,
                reply: parsed.reply || `📅 Detected: *${parsed.title}* on ${parsed.date}${parsed.time ? ` at ${parsed.time}` : ''}`,
              };
            }
            return {
              parsed: false,
              reply: parsed.reply || '❌ Could not understand that. Please specify a date.',
            };
          }
          errors.push('OpenRouter returned non-JSON response');
        } else {
          const errText = await response.text().catch(() => 'unknown error');
          console.error('[schedule-parser] OpenRouter API error:', response.status, errText);
          errors.push(`OpenRouter error ${response.status}`);
        }
      } catch (err: any) {
        console.warn('[schedule-parser] OpenRouter also failed:', err.message);
        errors.push(`OpenRouter: ${err.message}`);
      }
    }

    console.error('[schedule-parser] All AI providers failed:', errors.join(' | '));
    return null;
  }

  try {
    const result = await callAiParser();
    if (result) {
      return result;
    }
    return { parsed: false, reply: '❌ AI parsing unavailable. Please specify the date manually.' };
  } catch (err: any) {
    console.error('[schedule-parser] Error:', err);
    return { parsed: false, reply: '❌ AI parsing error. Please specify the date manually.' };
  }
});

// ── Chat API ──────────────────────────────────────────────────────────

import {
  createConversation,
  getUserConversations,
  getConversationMessages,
  sendMessage,
  resetConversation,
  getUpdateLogs,
} from './services/chatService.js';
import {
  ingestAllSources,
  getKnowledgeBaseStatus,
} from './services/knowledgeBase.js';

/**
 * POST /chat/conversations — Create a new conversation
 */
app.post('/chat/conversations', async (request, reply) => {
  const body = z.object({
    user_email: z.string().email(),
    user_name: z.string().nullable().optional(),
    title: z.string().optional(),
  }).parse(request.body);

  const conversation = await createConversation(
    body.user_email,
    body.user_name ?? null,
    body.title
  );
  return conversation;
});

/**
 * GET /chat/conversations — Get user's conversations
 */
app.get('/chat/conversations', async (request) => {
  const query_params = request.query as any;
  const email = query_params.email as string;
  if (!email) return [];
  return getUserConversations(email);
});

/**
 * GET /chat/conversations/:id/messages — Get messages for a conversation
 */
app.get('/chat/conversations/:id/messages', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  return getConversationMessages(params.id);
});

/**
 * POST /chat/conversations/:id/messages — Send a message
 */
app.post('/chat/conversations/:id/messages', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({
    content: z.string().min(1).max(4000),
    user_email: z.string().email(),
    user_name: z.string().nullable().optional(),
    user_role: z.string().default('viewer'),
    current_page: z.string().optional(),
  }).parse(request.body);

  try {
    const result = await sendMessage(
      params.id,
      body.content,
      body.user_email,
      body.user_name ?? null,
      body.user_role,
      body.current_page
    );
    return result;
  } catch (err: any) {
    console.error('[chat] Error sending message:', err);
    return reply.code(500).send({ error: 'Failed to send message', details: err.message });
  }
});

/**
 * POST /chat/conversations/:id/reset — Reset a conversation
 */
app.post('/chat/conversations/:id/reset', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  await resetConversation(params.id);
  return { ok: true };
});

// ── Knowledge Base API ────────────────────────────────────────────────

/**
 * POST /knowledge/ingest — Trigger knowledge base re-ingestion (admin only)
 */
app.post('/knowledge/ingest', async (request, reply) => {
  const body = z.object({ action_token: z.string() }).parse(request.body);

  // Verify action token
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);

  // Run ingestion asynchronously
  setImmediate(async () => {
    try {
      await ingestAllSources();
    } catch (err: any) {
      console.error('[knowledge] Ingestion error:', err);
    }
  });

  return { ok: true, message: 'Knowledge base ingestion started. This may take a few minutes.' };
});

/**
 * GET /knowledge/status — Get knowledge base status
 */
app.get('/knowledge/status', async () => {
  return getKnowledgeBaseStatus();
});

// ── Update Logs API ───────────────────────────────────────────────────

/**
 * GET /update-logs — Get update logs (admin/bot only)
 * Protected by action_token in query params for admin access.
 */
app.get('/update-logs', async (request, reply) => {
  const query_params = request.query as any;
  const email = query_params.email as string;
  const role = query_params.role as string;

  // Only admin and bot can access update logs
  if (role !== 'admin' && role !== 'bot') {
    return reply.status(403).send({ error: 'Access denied. Only admin and bot can view update logs.' });
  }

  const limit = parseInt((query_params.limit as string) ?? '50', 10);
  const logs = await getUpdateLogs(limit);

  // Log access
  if (email) {
    try {
      await query(
        `INSERT INTO update_log_access (user_email, action) VALUES ($1, 'viewed')`,
        [email]
      );
    } catch { /* ignore */ }
  }

  return logs;
});

// ── Dashboard Stats ─────────────────────────────────────────────────

app.get('/dashboard/stats', async () => {
  // Try cache first
  const cached = await cacheGet<object>('dashboard:stats');
  if (cached) return cached;

  // Single query — all stats in one round-trip
  const rows = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM orders) AS total_orders,
      (SELECT COUNT(*)::int FROM orders WHERE status='active') AS active_orders,
      (SELECT COUNT(*)::int FROM orders WHERE current_stage='completed') AS completed_orders,
      (SELECT COUNT(*)::int FROM orders WHERE current_stage='purchasing_pending') AS pending_purchasing,
      (SELECT COUNT(*)::int FROM orders WHERE current_stage='delivery_scheduled') AS pending_delivery,
      (SELECT COUNT(*)::int FROM orders WHERE current_stage IN ('delivered','countered','payment_received')) AS pending_collection,
      (SELECT COUNT(*)::int FROM reminders WHERE status='active' AND next_run_at < NOW()) AS overdue_reminders,
      (SELECT COUNT(*)::int FROM orders WHERE status='active' AND deposit_paid=FALSE AND current_stage NOT IN ('completed','payment_confirmed')) AS pending_deposit,
      (SELECT COUNT(*)::int FROM orders WHERE status='active' AND balance_paid=FALSE AND deposit_paid=TRUE AND total_amount IS NOT NULL AND current_stage NOT IN ('completed','payment_confirmed')) AS pending_balance
  `);

  const stageBreakdown = await query(
    `SELECT current_stage AS stage, COUNT(*)::int AS count FROM orders WHERE status='active' GROUP BY current_stage ORDER BY MIN(created_at)`
  );

  const recentOrders = await query(
    `SELECT ${ORDER_LIST_SELECT}, 0 AS escalation_level
     FROM orders o ORDER BY o.created_at DESC LIMIT 10`
  );

  const result = {
    total_orders: rows[0].total_orders,
    active_orders: rows[0].active_orders,
    completed_orders: rows[0].completed_orders,
    pending_purchasing: rows[0].pending_purchasing,
    pending_delivery: rows[0].pending_delivery,
    pending_collection: rows[0].pending_collection,
    pending_deposit: rows[0].pending_deposit,
    pending_balance: rows[0].pending_balance,
    overdue_reminders: rows[0].overdue_reminders,
    stage_breakdown: stageBreakdown,
    recent_orders: recentOrders,
  };

  // Cache for 30 seconds
  await cacheSet('dashboard:stats', result);
  return result;
});

// ── Sales: Monthly Summary ────────────────────────────────────────────

app.get('/sales/monthly', async () => {
  const cached = await cacheGet<object>('sales:monthly');
  if (cached) return cached;

  const rows = await query(`
    SELECT
      TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
      COUNT(*)::int AS order_count,
      SUM(total_amount)::numeric(14,2) AS total_sales,
      SUM(computed_amount)::numeric(14,2) AS computed_sales
    FROM orders
    WHERE status = 'active'
      AND total_amount IS NOT NULL
    GROUP BY DATE_TRUNC('month', created_at)
    ORDER BY month DESC
    LIMIT 24
  `);

  const result = { monthly: rows };

  await cacheSet('sales:monthly', result);
  return result;
});

app.get('/sales/by-agent', async () => {
  const cached = await cacheGet<object[]>('sales:by-agent');
  if (cached) return cached;

  const rows = await query(`
    SELECT
      COALESCE(NULLIF(TRIM(sales_agent), ''), 'Unassigned') AS agent,
      COUNT(*)::int AS order_count,
      SUM(total_amount)::numeric(14,2) AS total_sales,
      SUM(computed_amount)::numeric(14,2) AS computed_sales
    FROM orders
    WHERE status = 'active'
      AND total_amount IS NOT NULL
    GROUP BY COALESCE(NULLIF(TRIM(sales_agent), ''), 'Unassigned')
    ORDER BY total_sales DESC NULLS LAST
  `);

  await cacheSet('sales:by-agent', rows);
  return rows;
});

app.get('/sales/by-client', async () => {
  const cached = await cacheGet<object[]>('sales:by-client');
  if (cached) return cached;

  const rows = await query(`
    SELECT
      COALESCE(NULLIF(TRIM(client_name), ''), 'Unknown') AS client,
      COUNT(*)::int AS order_count,
      SUM(total_amount)::numeric(14,2) AS total_sales,
      SUM(computed_amount)::numeric(14,2) AS computed_sales
    FROM orders
    WHERE status = 'active'
      AND total_amount IS NOT NULL
    GROUP BY COALESCE(NULLIF(TRIM(client_name), ''), 'Unknown')
    ORDER BY total_sales DESC NULLS LAST
    LIMIT 50
  `);

  await cacheSet('sales:by-client', rows);
  return rows;
});

// ── Google Drive ─────────────────────────────────────────────────────

const fileUploadSchema = z.object({
  order_id: z.string().uuid().optional(),
  quotation_number: z.string().optional(),
  file_type: z.string(),
  original_filename: z.string(),
  mime_type: z.string(),
  file_data: z.string(), // base64-encoded file content
  folder_id: z.string().optional(), // override parent folder
  extracted_text: z.string().optional(), // extracted text for local file-store
});

/**
 * POST /files/upload
 * Store extracted quotation text in the local file-store container.
 * Quotations are stored as text only for Hermes agent reference
 * during production analysis. Deposit slips are NOT stored anywhere.
 */
app.post('/files/upload', async (request, reply) => {
  const body = fileUploadSchema.parse(request.body);
  const FILE_STORE_URL = process.env.FILE_STORE_URL ?? 'http://file-store:8090';
  let localFilePath: string | null = null;
  let binaryStoreError: string | null = null;

  // Resolve order_id from quotation_number if not provided directly
  let resolvedOrderId: string | null = body.order_id ?? null;
  if (!resolvedOrderId && body.quotation_number) {
    try {
      const orderRows = await query(
        `SELECT id FROM orders WHERE quotation_number = $1 LIMIT 1`,
        [body.quotation_number]
      );
      if (orderRows[0]) {
        resolvedOrderId = orderRows[0].id;
      }
    } catch (err) {
      console.error('[FileUpload] Failed to resolve order_id from quotation_number:', err);
    }
  }

  // Forward quotation text to file-store for Hermes agent reference
  if (body.file_type === 'quotation' && body.quotation_number && body.extracted_text) {
    try {
      await fetch(`${FILE_STORE_URL}/files/store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: resolvedOrderId,
          quotation_number: body.quotation_number,
          extracted_text: body.extracted_text,
          file_type: body.file_type,
        }),
      });
    } catch (err) {
      console.error('[DriveUpload] Failed to store quotation text in file-store:', err);
    }
  }

  // Store binary file to file-store for dashboard viewing.
  // Requires at minimum file_data and either order_id or quotation_number.
  if (body.file_data && (resolvedOrderId || body.quotation_number)) {
    try {
      const res = await fetch(`${FILE_STORE_URL}/files/store-binary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: resolvedOrderId,
          quotation_number: body.quotation_number,
          file_data: body.file_data,
          mime_type: body.mime_type,
          original_filename: body.original_filename,
        }),
      });
      if (res.ok) {
        const result = await res.json() as { path?: string };
        localFilePath = result.path ?? null;
        if (!localFilePath) {
          binaryStoreError = 'File-store did not return a stored file path';
        }
      } else {
        const text = await res.text().catch(() => '');
        binaryStoreError = `File-store rejected binary upload (HTTP ${res.status})${text ? `: ${text}` : ''}`;
      }
    } catch (err) {
      console.error('[DriveUpload] Failed to store binary in file-store:', err);
      binaryStoreError = err instanceof Error ? err.message : String(err);
    }
  }

  if (binaryStoreError) {
    return reply.code(502).send({
      error: 'Failed to store file binary',
      detail: binaryStoreError,
    });
  }

  // Store file reference in DB
  const fileRecord = await query(
    `INSERT INTO files (order_id, file_type, original_filename, storage_backend, extracted_text, local_file_path, mime_type)
     VALUES ($1, $2, $3, 'local', $4, $5, $6)
     RETURNING *`,
    [
      resolvedOrderId,
      body.file_type,
      body.original_filename,
      body.extracted_text ?? null,
      localFilePath,
      body.mime_type ?? null,
    ]
  );

  // Invalidate caches so dashboard shows the new file
  if (resolvedOrderId || body.quotation_number) {
    await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
    if (resolvedOrderId) {
      broadcastSSE('order_updated', { id: resolvedOrderId });
    }
  }

  // Notify Telegram group chats about uploaded file
  const fileTypeLabels: Record<string, string> = {
    quotation: '📄 Quotation',
    order_confirmation: '📝 Order Confirmation',
    deposit: '💰 Deposit Proof',
    balance_proof: '💳 Balance Proof',
  };
  const label = fileTypeLabels[body.file_type] ?? body.file_type;
  const ref = body.quotation_number ?? `Order #${resolvedOrderId?.slice(0, 8) ?? '?'}`;

  setImmediate(() => {
    notifyGroupChat(
      ESCALATION_CHAT_ID,
      `<b>${label} Uploaded</b>\n\nQuotation: <b>${ref}</b>\nFile: ${body.original_filename}`
    );
  });

  if (body.file_type === 'order_confirmation' && PRODUCTION_CHAT_ID) {
    setImmediate(() => {
      notifyGroupChat(
        PRODUCTION_CHAT_ID,
        `<b>${label} Uploaded</b>\n\nQuotation: <b>${ref}</b>\nFile: ${body.original_filename}\n\nProduction may proceed.`
      );
    });
  }

  if (body.file_type === 'deposit' && COLLECTION_CHAT_ID) {
    setImmediate(() => {
      notifyGroupChat(
        COLLECTION_CHAT_ID,
        `<b>${label} Uploaded</b>\n\nQuotation: <b>${ref}</b>\nFile: ${body.original_filename}\n\nDeposit proof submitted for verification.`
      );
    });
  }

  if (body.file_type === 'balance_proof' && COLLECTION_CHAT_ID) {
    setImmediate(() => {
      notifyGroupChat(
        COLLECTION_CHAT_ID,
        `<b>${label} Uploaded</b>\n\nQuotation: <b>${ref}</b>\nFile: ${body.original_filename}\n\nBalance proof submitted for verification.`
      );
    });
  }

  return reply.send({
    ok: true,
    file: fileRecord[0],
    note: 'File stored locally.',
  });
});

// ── Reminders ────────────────────────────────────────────────────────

/**
 * GET /reminders
 * List all active reminders.
 */
app.get('/reminders', async () => {
  return query(
    `SELECT r.*, o.quotation_number, o.client_name
     FROM reminders r
     JOIN orders o ON o.id = r.order_id
     ORDER BY r.next_run_at ASC
     LIMIT 100`
  );
});

/**
 * GET /reminders/overdue
 * List overdue reminders (next_run_at < now).
 */
app.get('/reminders/overdue', async () => {
  return query(
    `SELECT r.*, o.quotation_number, o.client_name
     FROM reminders r
     JOIN orders o ON o.id = r.order_id
     WHERE r.status = 'active' AND r.next_run_at < NOW()
     ORDER BY r.next_run_at ASC`
  );
});

/**
 * POST /reminders
 * Create a new reminder for an order.
 */
app.post('/reminders', async (request, reply) => {
  const body = z
    .object({
      order_id: z.string().uuid(),
      stage: z.string(),
      group_chat_id: z.string(),
      message: z.string(),
      frequency: z.enum(['hourly', 'daily', 'once']).default('daily'),
      next_run_at: z.string().optional(),
    })
    .parse(request.body);

  if (body.next_run_at) {
    await query(
      `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       ON CONFLICT (order_id, stage) WHERE item_id IS NULL DO UPDATE SET
         group_chat_id=EXCLUDED.group_chat_id,
         message=EXCLUDED.message,
         frequency=EXCLUDED.frequency,
         next_run_at=EXCLUDED.next_run_at,
         status='active',
         updated_at=NOW()`,
      [body.order_id, body.stage, body.group_chat_id, body.message, body.frequency, body.next_run_at]
    );
  } else {
    await createStageReminder(body.order_id, body.stage, body.group_chat_id, body.message, body.frequency);
  }
  return reply.send({ ok: true });
});

/**
 * PATCH /reminders/:id/complete
 * Mark a reminder as completed.
 */
app.patch('/reminders/:id/complete', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  await query(`UPDATE reminders SET status = 'completed', updated_at = NOW() WHERE id = $1`, [params.id]);
  return reply.send({ ok: true });
});

/**
 * POST /reminders/process
 * Manually trigger due reminder processing.
 */
app.post('/reminders/process', async () => {
  const count = await processDueReminders();
  return { ok: true, sent: count };
});

// ── Calendar Events ─────────────────────────────────────────────────

/**
 * GET /calendar/events
 * Aggregate all time-based events across the system.
 */
app.get('/calendar/events', async () => {
  const cached = await cacheGet<object[]>('calendar:events');
  if (cached) return cached;

  const orderEvents = await query(
    `SELECT
       o.id AS event_id,
       'order' AS type,
       'Order Created' AS category,
       COALESCE(o.quotation_number, 'Unknown') AS title,
       o.client_name AS subtitle,
       o.created_at AS event_date,
       o.current_stage AS metadata
     FROM orders o
     WHERE o.created_at > NOW() - INTERVAL '1 year'`
  );

  const stageEvents = await query(
    `SELECT
       su.id AS event_id,
       'stage_update' AS type,
       'Stage Update' AS category,
       COALESCE(o.quotation_number, 'Unknown') AS title,
       su.stage AS subtitle,
       su.created_at AS event_date,
       su.status AS metadata
     FROM stage_updates su
     JOIN orders o ON o.id = su.order_id
     WHERE su.created_at > NOW() - INTERVAL '1 year'`
  );

  const reminderEvents = await query(
    `SELECT
       r.id AS event_id,
       'reminder' AS type,
       'Reminder' AS category,
       COALESCE(o.quotation_number, 'Unknown') AS title,
       r.stage AS subtitle,
       r.next_run_at AS event_date,
       r.status AS metadata
     FROM reminders r
     JOIN orders o ON o.id = r.order_id
     WHERE r.next_run_at IS NOT NULL
       AND r.next_run_at > NOW() - INTERVAL '1 month'
       AND r.next_run_at < NOW() + INTERVAL '3 months'`
  );

  const deliveryEvents = await query(
    `SELECT
       o.id AS event_id,
       'delivery' AS type,
       'Delivery Scheduled' AS category,
       COALESCE(o.quotation_number, 'Unknown') AS title,
       o.client_name AS subtitle,
       o.updated_at AS event_date,
       o.current_stage AS metadata
     FROM orders o
     WHERE o.current_stage = 'delivery_scheduled'`
  );

  const depositEvents = await query(
    `SELECT
       o.id AS event_id,
       'deposit' AS type,
       'Deposit Paid' AS category,
       COALESCE(o.quotation_number, 'Unknown') AS title,
       o.client_name AS subtitle,
       o.deposit_paid_at AS event_date,
       'Deposit: ₱' || o.deposit_amount AS metadata
     FROM orders o
     WHERE o.deposit_paid = TRUE
       AND o.deposit_paid_at > NOW() - INTERVAL '1 year'`
  );

  const balanceEvents = await query(
    `SELECT
       o.id AS event_id,
       'balance' AS type,
       'Balance Paid' AS category,
       COALESCE(o.quotation_number, 'Unknown') AS title,
       o.client_name AS subtitle,
       o.balance_paid_at AS event_date,
       o.current_stage AS metadata
     FROM orders o
     WHERE o.balance_paid = TRUE
       AND o.balance_paid_at > NOW() - INTERVAL '1 year'`
  );

  const productionStartEvents = await query(
    `SELECT
       o.id AS event_id,
       'production_start' AS type,
       'Production Started' AS category,
       COALESCE(o.quotation_number, 'Unknown') AS title,
       o.client_name AS subtitle,
       o.production_started_at AS event_date,
       o.estimated_production_days || ' days estimated' AS metadata
     FROM orders o
     WHERE o.production_started = TRUE
       AND o.production_started_at > NOW() - INTERVAL '1 year'`
  );

  const productionFinishEvents = await query(
    `SELECT
       o.id AS event_id,
       'production_finish' AS type,
       'Production Finished' AS category,
       COALESCE(o.quotation_number, 'Unknown') AS title,
       o.client_name AS subtitle,
       o.production_finished_at AS event_date,
       o.current_stage AS metadata
     FROM orders o
     WHERE o.production_finished = TRUE
       AND o.production_finished_at > NOW() - INTERVAL '1 year'`
  );

  const enRouteEvents = await query(
    `SELECT
       o.id AS event_id,
       'en_route' AS type,
       'Inventory En Route' AS category,
       COALESCE(o.quotation_number, 'Unknown') AS title,
       o.client_name AS subtitle,
       o.inventory_en_route_at AS event_date,
       COALESCE(o.estimated_inventory_arrival_days || ' days to arrival', '') AS metadata
     FROM orders o
     WHERE o.inventory_en_route_at IS NOT NULL
       AND o.inventory_en_route_at > NOW() - INTERVAL '1 year'`
  );

  const orderConfirmedEvents = await query(
    `SELECT
       o.id AS event_id,
       'order_confirmed' AS type,
       'Order Confirmed' AS category,
       COALESCE(o.quotation_number, 'Unknown') AS title,
       o.client_name AS subtitle,
       o.order_confirmed_at AS event_date,
       o.current_stage AS metadata
     FROM orders o
     WHERE o.order_confirmed_at IS NOT NULL
       AND o.order_confirmed_at > NOW() - INTERVAL '1 year'`
  );

  const scheduleEvents = await query(
    `SELECT
       cs.id AS event_id,
       'schedule' AS type,
       cs.category AS category,
       cs.title AS title,
       cs.description AS subtitle,
       cs.schedule_date::TEXT || ' ' || COALESCE(cs.schedule_time::TEXT, '00:00:00') AS event_date,
       cs.schedule_time::TEXT AS metadata
     FROM calendar_schedules cs
     WHERE cs.status = 'active'
       AND cs.schedule_date >= NOW() - INTERVAL '1 month'
       AND cs.schedule_date <= NOW() + INTERVAL '3 months'`
  );

  const allEvents = [
    ...orderEvents.map((e: any) => ({ ...e, color: '#3b82f6' })),               // blue
    ...stageEvents.map((e: any) => ({ ...e, color: '#8b5cf6' })),               // purple
    ...reminderEvents.map((e: any) => ({ ...e, color: '#ef4444' })),            // red
    ...deliveryEvents.map((e: any) => ({ ...e, color: '#f97316' })),            // orange
    ...depositEvents.map((e: any) => ({ ...e, color: '#10b981' })),             // emerald
    ...balanceEvents.map((e: any) => ({ ...e, color: '#06b6d4' })),             // cyan
    ...productionStartEvents.map((e: any) => ({ ...e, color: '#a855f7' })),     // violet
    ...productionFinishEvents.map((e: any) => ({ ...e, color: '#6366f1' })),    // indigo
    ...enRouteEvents.map((e: any) => ({ ...e, color: '#14b8a6' })),             // teal
    ...orderConfirmedEvents.map((e: any) => ({ ...e, color: '#84cc16' })),      // lime
    ...scheduleEvents.map((e: any) => ({ ...e, color: '#f59e0b' })),            // amber
  ].sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());

  await cacheSet('calendar:events', allEvents, 30);
  return allEvents;
});

// ── Search ──────────────────────────────────────────────────────────
app.get('/search', async (request) => {
  const query_params = z.object({ q: z.string().min(1).max(100) }).parse(request.query);
  const q = `%${query_params.q}%`;

  const orders = await query(
    `SELECT id, quotation_number, client_name, sales_agent, total_amount, computed_amount,
            math_status, current_stage, status, deposit_paid, deposit_amount, deposit_paid_at,
            balance_paid, order_confirmed_at, created_at, updated_at
     FROM orders
     WHERE quotation_number ILIKE $1
        OR client_name ILIKE $1
        OR sales_agent ILIKE $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [q]
  );

  return { orders };
});

// ── Calendar Notes ──────────────────────────────────────────────────
app.get('/calendar/notes', async () => {
  const rows = await query(
    `SELECT id, note_date, title, content, color, created_by, created_at, updated_at
     FROM calendar_notes
     ORDER BY note_date DESC, created_at DESC
     LIMIT 200`
  );
  return rows;
});

app.get('/calendar/notes/:date', async (request, reply) => {
  const params = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(request.params);
  const rows = await query(
    `SELECT id, note_date, title, content, color, created_by, created_at, updated_at
     FROM calendar_notes
     WHERE note_date = $1::date
     ORDER BY created_at DESC`,
    [params.date]
  );
  return rows;
});

const createNoteSchema = z.object({
  note_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1).max(200),
  content: z.string().max(2000).default(''),
  color: z.string().default('#2490ef'),
  action_token: z.string(),
});

app.post('/calendar/notes', async (request, reply) => {
  const body = createNoteSchema.parse(request.body);

  // Verify action token and extract email
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  const rows = await query(
    `INSERT INTO calendar_notes (note_date, title, content, color)
     VALUES ($1::date, $2, $3, $4)
     RETURNING *`,
    [body.note_date, body.title, body.content, body.color]
  );
  await invalidateCache(['calendar:*']);
  await notifyManualChange(
    '📝 Calendar note created',
    `Date: *${body.note_date}*\nTitle: ${body.title}`,
    userEmail,
  );
  return reply.send(rows[0]);
});

const updateNoteSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(2000).optional(),
  color: z.string().optional(),
  action_token: z.string(),
});

app.patch('/calendar/notes/:id', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = updateNoteSchema.parse(request.body);

  // Verify action token and extract email
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;
  if (body.title !== undefined) { sets.push(`title = $${idx++}`); values.push(body.title); }
  if (body.content !== undefined) { sets.push(`content = $${idx++}`); values.push(body.content); }
  if (body.color !== undefined) { sets.push(`color = $${idx++}`); values.push(body.color); }
  sets.push(`updated_at = NOW()`);

  if (sets.length === 1) return reply.code(400).send({ error: 'No fields to update' });

  values.push(params.id);
  const rows = await query(
    `UPDATE calendar_notes SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  if (!rows[0]) return reply.code(404).send({ error: 'Note not found' });
  await invalidateCache(['calendar:*']);
  await notifyManualChange(
    '✏️ Calendar note edited',
    `Note ID: *${params.id.slice(0, 8)}...*${body.title ? `\nTitle: ${body.title}` : ''}`,
    userEmail,
  );
  return reply.send(rows[0]);
});

app.delete('/calendar/notes/:id', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = (request.body ?? {}) as any;

  // Verify action token and extract email
  if (!body.action_token) {
    return reply.status(400).send({ error: 'action_token is required' });
  }
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  const rows = await query(`DELETE FROM calendar_notes WHERE id = $1 RETURNING id, title`, [params.id]);
  if (!rows[0]) return reply.code(404).send({ error: 'Note not found' });
  await invalidateCache(['calendar:*']);
  await notifyManualChange(
    '🗑️ Calendar note deleted',
    `Note ID: *${params.id.slice(0, 8)}...*\nTitle: ${rows[0].title ?? 'N/A'}`,
    userEmail,
  );
  return reply.send({ ok: true });
});

// ── Calendar Schedules ──────────────────────────────────────────────

/**
 * GET /calendar/schedules — List all active schedules
 */
app.get('/calendar/schedules', async () => {
  const rows = await query(
    `SELECT id, title, description, schedule_date, schedule_time, end_time,
            is_all_day, color, category, created_by, created_by_chat_id,
            telegram_message_id, reminder_at, reminder_sent, status,
            created_at, updated_at
     FROM calendar_schedules
     WHERE status = 'active'
     ORDER BY schedule_date DESC, schedule_time ASC NULLS LAST
     LIMIT 500`
  );
  return rows;
});

/**
 * GET /calendar/schedules/:id — Get a single schedule by UUID
 * IMPORTANT: This route MUST be registered before the :date route
 * to avoid Fastify matching a UUID as a date string.
 */
app.get('/calendar/schedules/:id', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const rows = await query(
    `SELECT id, title, description, schedule_date, schedule_time, end_time,
            is_all_day, color, category, created_by, created_by_chat_id,
            telegram_message_id, reminder_at, reminder_sent, status,
            created_at, updated_at
     FROM calendar_schedules
     WHERE id = $1 AND status = 'active'
     LIMIT 1`,
    [params.id]
  );
  if (!rows[0]) return reply.code(404).send({ error: 'Schedule not found' });
  return rows[0];
});

/**
 * GET /calendar/schedules/by-date/:date — Get schedules for a specific date
 * Named differently from /:id to avoid Fastify duplicate-route error.
 */
app.get('/calendar/schedules/by-date/:date', async (request, reply) => {
  const params = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(request.params);
  const rows = await query(
    `SELECT id, title, description, schedule_date, schedule_time, end_time,
            is_all_day, color, category, created_by, created_by_chat_id,
            telegram_message_id, reminder_at, reminder_sent, status,
            created_at, updated_at
     FROM calendar_schedules
     WHERE schedule_date = $1::date AND status = 'active'
     ORDER BY schedule_time ASC NULLS FIRST`,
    [params.date]
  );
  return rows;
});

const createScheduleSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(2000).default(''),
  schedule_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  schedule_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  is_all_day: z.boolean().default(false),
  color: z.string().default('#f59e0b'),
  category: z.string().default('general'),
  reminder_at: z.string().datetime().optional().nullable(),
  action_token: z.string().optional(),
  // Telegram-specific fields (no token required when coming from bot)
  created_by: z.string().optional(),
  created_by_chat_id: z.string().optional(),
  telegram_message_id: z.string().optional(),
});

/**
 * POST /calendar/schedules — Create a new schedule
 * Supports both dashboard (with action_token) and Telegram bot (with telegram fields)
 */
app.post('/calendar/schedules', async (request, reply) => {
  const body = createScheduleSchema.parse(request.body);

  let userEmail: string | null = null;

  // If action_token provided, verify it (dashboard flow)
  if (body.action_token) {
    if (!cacheClient?.isOpen) {
      return reply.status(503).send({ error: 'Action verification unavailable' });
    }
    const tokenKey = `action_token:${body.action_token}`;
    const tokenData = await cacheClient.get(tokenKey);
    if (!tokenData) {
      return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    }
    await cacheClient.del(tokenKey);
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  }

  const rows = await query(
    `INSERT INTO calendar_schedules (title, description, schedule_date, schedule_time, end_time, is_all_day, color, category, reminder_at, created_by, created_by_chat_id, telegram_message_id)
     VALUES ($1, $2, $3::date, $4::time, $5::time, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      body.title,
      body.description,
      body.schedule_date,
      body.schedule_time ?? null,
      body.end_time ?? null,
      body.is_all_day,
      body.color,
      body.category,
      body.reminder_at ?? null,
      body.created_by ?? userEmail ?? null,
      body.created_by_chat_id ?? null,
      body.telegram_message_id ?? null,
    ]
  );
  await invalidateCache(['calendar:*']);
  await notifyManualChange(
    '📅 Schedule created',
    `Date: *${body.schedule_date}*\nTitle: ${body.title}${body.schedule_time ? `\nTime: ${body.schedule_time}` : ''}`,
    userEmail ?? body.created_by ?? null,
  );
  // Also notify the schedule group chat so members see new schedules in real-time
  if (SCHEDULE_GROUP_CHAT_ID) {
    const timeStr = body.schedule_time ? ` at ${body.schedule_time}` : '';
    const byStr = userEmail ?? body.created_by ?? 'Telegram bot';
    const msg = `📅 <b>New Schedule</b>\n\n<b>${body.title}</b>\n📆 ${body.schedule_date}${timeStr}${body.description ? `\n\n${body.description}` : ''}\n\n👤 By: ${byStr}`;
    setImmediate(() => {
      notifyGroupChat(SCHEDULE_GROUP_CHAT_ID, msg);
    });
  }
  return reply.send(rows[0]);
});

const updateScheduleSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).optional(),
  schedule_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  schedule_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional().nullable(),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional().nullable(),
  is_all_day: z.boolean().optional(),
  color: z.string().optional(),
  category: z.string().optional(),
  reminder_at: z.string().datetime().optional().nullable(),
  status: z.enum(['active', 'cancelled', 'completed']).optional(),
  action_token: z.string().optional(),
  // Telegram bot fields (no token required when coming from bot)
  created_by_chat_id: z.string().optional(),
});

/**
 * PATCH /calendar/schedules/:id — Update a schedule
 * Supports both dashboard (with action_token) and Telegram bot (with created_by_chat_id)
 */
app.patch('/calendar/schedules/:id', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = updateScheduleSchema.parse(request.body);

  let userEmail: string | null = null;

  // If action_token provided, verify it (dashboard flow)
  if (body.action_token) {
    if (!cacheClient?.isOpen) {
      return reply.status(503).send({ error: 'Action verification unavailable' });
    }
    const tokenKey = `action_token:${body.action_token}`;
    const tokenData = await cacheClient.get(tokenKey);
    if (!tokenData) {
      return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    }
    await cacheClient.del(tokenKey);
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  } else if (!body.created_by_chat_id) {
    // Neither action_token nor created_by_chat_id provided — reject
    return reply.status(401).send({ error: 'action_token or created_by_chat_id is required' });
  }
  // If created_by_chat_id is present (Telegram bot flow), skip token verification

  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;
  if (body.title !== undefined) { sets.push(`title = $${idx++}`); values.push(body.title); }
  if (body.description !== undefined) { sets.push(`description = $${idx++}`); values.push(body.description); }
  if (body.schedule_date !== undefined) { sets.push(`schedule_date = $${idx++}::date`); values.push(body.schedule_date); }
  if (body.schedule_time !== undefined) { sets.push(`schedule_time = $${idx++}::time`); values.push(body.schedule_time); }
  if (body.end_time !== undefined) { sets.push(`end_time = $${idx++}::time`); values.push(body.end_time); }
  if (body.is_all_day !== undefined) { sets.push(`is_all_day = $${idx++}`); values.push(body.is_all_day); }
  if (body.color !== undefined) { sets.push(`color = $${idx++}`); values.push(body.color); }
  if (body.category !== undefined) { sets.push(`category = $${idx++}`); values.push(body.category); }
  if (body.reminder_at !== undefined) { sets.push(`reminder_at = $${idx++}`); values.push(body.reminder_at); }
  if (body.status !== undefined) { sets.push(`status = $${idx++}`); values.push(body.status); }
  sets.push(`updated_at = NOW()`);

  if (sets.length === 1) return reply.code(400).send({ error: 'No fields to update' });

  values.push(params.id);
  const rows = await query(
    `UPDATE calendar_schedules SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  if (!rows[0]) return reply.code(404).send({ error: 'Schedule not found' });
  await invalidateCache(['calendar:*']);
  await notifyManualChange(
    '✏️ Schedule updated',
    `Schedule ID: *${params.id.slice(0, 8)}...*${body.title ? `\nTitle: ${body.title}` : ''}`,
    userEmail,
  );
  // Notify schedule group about the update
  if (SCHEDULE_GROUP_CHAT_ID && userEmail) {
    const updated = rows[0] as any;
    const title = body.title ?? updated.title ?? 'Unknown';
    const dateStr = body.schedule_date ?? updated.schedule_date ?? '';
    const timeStr = body.schedule_time ?? updated.schedule_time ?? '';
    const msg = `✏️ <b>Schedule Updated</b>\n\n<b>${title}</b>\n📆 ${dateStr}${timeStr ? ` at ${timeStr}` : ''}\n\n👤 By: ${userEmail}`;
    setImmediate(() => {
      notifyGroupChat(SCHEDULE_GROUP_CHAT_ID, msg);
    });
  }
  return reply.send(rows[0]);
});

/**
 * DELETE /calendar/schedules/:id — Soft-delete a schedule (set status to cancelled)
 */
app.delete('/calendar/schedules/:id', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = (request.body ?? {}) as any;

  if (!body.action_token) {
    return reply.status(400).send({ error: 'action_token is required' });
  }
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  const rows = await query(
    `UPDATE calendar_schedules SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING id, title`,
    [params.id]
  );
  if (!rows[0]) return reply.code(404).send({ error: 'Schedule not found' });
  await invalidateCache(['calendar:*']);
  await notifyManualChange(
    '🗑️ Schedule cancelled',
    `Schedule ID: *${params.id.slice(0, 8)}...*\nTitle: ${rows[0].title ?? 'N/A'}`,
    userEmail,
  );
  // Notify schedule group about the cancellation
  if (SCHEDULE_GROUP_CHAT_ID && userEmail) {
    const title = rows[0]?.title ?? 'Unknown';
    const msg = `🗑️ <b>Schedule Cancelled</b>\n\n<b>${title}</b>\n\n👤 By: ${userEmail}`;
    setImmediate(() => {
      notifyGroupChat(SCHEDULE_GROUP_CHAT_ID, msg);
    });
  }
  return reply.send({ ok: true });
});

// ── Bot Logs ────────────────────────────────────────────────────────

/**
 * POST /bot-logs — Receive a log entry from the Telegram bot
 * The bot calls this to record message events, uploads, errors, etc.
 */
const botLogSchema = z.object({
  chat_id: z.string(),
  user_id: z.string().optional(),
  username: z.string().optional(),
  message_type: z.string(),
  direction: z.enum(['incoming', 'outgoing', 'internal']).optional().default('incoming'),
  content: z.string().optional(),
  metadata: z.any().optional(),
  status: z.enum(['success', 'error', 'pending']).optional().default('success'),
});

app.post('/bot-logs', async (request, reply) => {
  const body = botLogSchema.parse(request.body);
  const rows = await query(
    `INSERT INTO bot_logs (chat_id, user_id, username, message_type, direction, content, metadata, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, created_at`,
    [
      body.chat_id,
      body.user_id ?? null,
      body.username ?? null,
      body.message_type,
      body.direction,
      body.content ?? null,
      body.metadata ? JSON.stringify(body.metadata) : null,
      body.status,
    ]
  );
  return reply.send({ ok: true, id: rows[0].id, created_at: rows[0].created_at });
});

/**
 * GET /bot-logs — List bot logs (paginated, filterable)
 */
app.get('/bot-logs', async (request) => {
  const query_params = z.object({
    limit: z.coerce.number().min(1).max(200).optional().default(100),
    offset: z.coerce.number().min(0).optional().default(0),
    chat_id: z.string().optional(),
    message_type: z.string().optional(),
    status: z.string().optional(),
  }).parse(request.query);

  const conditions: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (query_params.chat_id) {
    conditions.push(`chat_id = $${idx++}`);
    values.push(query_params.chat_id);
  }
  if (query_params.message_type) {
    conditions.push(`message_type = $${idx++}`);
    values.push(query_params.message_type);
  }
  if (query_params.status) {
    conditions.push(`status = $${idx++}`);
    values.push(query_params.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT id, chat_id, user_id, username, message_type, direction, content, metadata, status, created_at
               FROM bot_logs ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  values.push(query_params.limit, query_params.offset);

  const rows = await query(sql, values);
  return rows;
});

// ── Clients ─────────────────────────────────────────────────────────

const clientSchema = z.object({
  client_name: z.string().min(1).transform((v) => v.trim()),
  delivery_address: z.string().nullable().optional(),
  contact_number: z.string().nullable().optional(),
  authorized_receiver_name: z.string().nullable().optional(),
  authorized_receiver_contact: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  action_token: z.string(),
});

const clientUpdateSchema = clientSchema.partial().extend({
  propagate_to_orders: z.boolean().optional().default(true),
  action_token: z.string().optional(),
});

const CLIENT_NORMALIZED_SQL = (alias: string) =>
  `btrim(regexp_replace(lower(COALESCE(${alias}.client_name, '')), '[^a-z0-9]+', ' ', 'g'))`;

const CLIENT_WITH_STATS_SELECT = `
  c.*,
  COUNT(DISTINCT o.id)::int AS order_count,
  COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'active')::int AS active_order_count,
  MAX(o.created_at) AS latest_order_at
`;

const CLIENT_ORDER_MATCH_SQL = `
  (o.client_id = c.id OR (
    o.client_id IS NULL
    AND o.client_name IS NOT NULL
    AND ${CLIENT_NORMALIZED_SQL('o')} = ${CLIENT_NORMALIZED_SQL('c')}
  ))
`;

function normalizeClientName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function nullableText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

async function getClientByDeterministicName(clientName: string) {
  const normalized = normalizeClientName(clientName);
  const exact = await query(
    `SELECT * FROM clients c WHERE ${CLIENT_NORMALIZED_SQL('c')} = $1 ORDER BY c.updated_at DESC, c.client_name ASC LIMIT 1`,
    [normalized]
  );
  if (exact[0]) return exact[0];

  const fallback = await query(
    `SELECT *, similarity(client_name, $1) AS match_score
     FROM clients
     WHERE client_name ILIKE $2
     ORDER BY match_score DESC, client_name ASC
     LIMIT 1`,
    [clientName.trim(), `%${clientName.trim()}%`]
  );
  return fallback[0] ?? null;
}

async function autoLinkClientToOrder(orderId: string, clientName: string | null) {
  if (!clientName) return;
  const trimmed = clientName.trim();
  if (!trimmed) return;

  // Try exact match first (normalized)
  const normalized = normalizeClientName(trimmed);
  const exactRows = await query(
    `SELECT * FROM clients c WHERE ${CLIENT_NORMALIZED_SQL('c')} = $1 ORDER BY c.updated_at DESC, c.client_name ASC LIMIT 1`,
    [normalized]
  );

  let client = exactRows[0] ?? null;

  // Auto-create client if no exact match exists
  if (!client) {
    const inserted = await query(
      `INSERT INTO clients (client_name, delivery_address, contact_number, authorized_receiver_name, authorized_receiver_contact, notes)
       VALUES ($1, NULL, NULL, NULL, NULL, NULL)
       ON CONFLICT (client_name) DO NOTHING
       RETURNING *`,
      [trimmed]
    );
    if (inserted[0]) {
      client = inserted[0];
    } else {
      // Another request created it concurrently — fetch it
      const conflictRows = await query(
        `SELECT * FROM clients c WHERE ${CLIENT_NORMALIZED_SQL('c')} = $1 ORDER BY c.updated_at DESC, c.client_name ASC LIMIT 1`,
        [normalized]
      );
      client = conflictRows[0] ?? null;
    }
  }

  if (client) {
    await query(
      `UPDATE orders SET
         client_id = $1,
         delivery_address = COALESCE(delivery_address, $2),
         contact_number = COALESCE(contact_number, $3),
         authorized_receiver_name = COALESCE(authorized_receiver_name, $4),
         authorized_receiver_contact = COALESCE(authorized_receiver_contact, $5),
         updated_at = NOW()
       WHERE id = $6`,
      [client.id, client.delivery_address ?? null, client.contact_number ?? null, client.authorized_receiver_name ?? null, client.authorized_receiver_contact ?? null, orderId]
    );
  }
}

function clientStatsQuery(where = '', limit = 500): string {
  return `SELECT ${CLIENT_WITH_STATS_SELECT}
          FROM clients c
          LEFT JOIN orders o ON ${CLIENT_ORDER_MATCH_SQL}
          ${where}
          GROUP BY c.id
          ORDER BY c.client_name ASC
          LIMIT ${limit}`;
}

app.post('/clients', async (request, reply) => {
  const body = clientSchema.parse(request.body);

  // Verify action token and extract email
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  // Check for existing client with same normalized name
  const normalized = normalizeClientName(body.client_name);
  const existing = await query(
    `SELECT id, client_name, delivery_address, contact_number, authorized_receiver_name, authorized_receiver_contact, notes
     FROM clients WHERE ${CLIENT_NORMALIZED_SQL('clients')} = $1 LIMIT 1`,
    [normalized]
  );

  if (existing.length > 0) {
    // Duplicate detected — upsert the existing record
    const existingClient = existing[0];
    const rows = await query(
      `UPDATE clients SET
        delivery_address = COALESCE($2, clients.delivery_address),
        contact_number = COALESCE($3, clients.contact_number),
        authorized_receiver_name = COALESCE($4, clients.authorized_receiver_name),
        authorized_receiver_contact = COALESCE($5, clients.authorized_receiver_contact),
        notes = COALESCE($6, clients.notes),
        updated_at = NOW()
      WHERE id = $7
      RETURNING *`,
      [
        body.client_name,
        nullableText(body.delivery_address) ?? null,
        nullableText(body.contact_number) ?? null,
        nullableText(body.authorized_receiver_name) ?? null,
        nullableText(body.authorized_receiver_contact) ?? null,
        nullableText(body.notes) ?? null,
        existingClient.id,
      ]
    );

    await notifyManualChange(
      'Client updated (duplicate merged)',
      `Client: *${body.client_name}* (existing record updated)\n${body.delivery_address ? `Address: ${body.delivery_address}\n` : ''}${body.contact_number ? `Contact: ${body.contact_number}` : ''}`,
      userEmail,
    );

    await invalidateCache(['clients:*', '/clients', 'dashboard:*']);
    broadcastSSE('client_updated', { id: rows[0].id });
    return reply.send({ ...rows[0], _duplicate: true, _existing_id: existingClient.id });
  }

  const rows = await query(
    `INSERT INTO clients (client_name, delivery_address, contact_number, authorized_receiver_name, authorized_receiver_contact, notes)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      body.client_name,
      nullableText(body.delivery_address) ?? null,
      nullableText(body.contact_number) ?? null,
      nullableText(body.authorized_receiver_name) ?? null,
      nullableText(body.authorized_receiver_contact) ?? null,
      nullableText(body.notes) ?? null,
    ]
  );

  await notifyManualChange(
    'Client created',
    `Client: *${body.client_name}*\n${body.delivery_address ? `Address: ${body.delivery_address}\n` : ''}${body.contact_number ? `Contact: ${body.contact_number}` : ''}`,
    userEmail,
  );

  await invalidateCache(['clients:*', '/clients', 'dashboard:*']);
  broadcastSSE('client_updated', { id: rows[0].id });
  return reply.send(rows[0]);
});

app.get('/clients', async () => {
  const cached = await cacheGet<object[]>('clients:all');
  if (cached) return cached;
  const rows = await query(clientStatsQuery());
  await cacheSet('clients:all', rows);
  return rows;
});

app.get('/clients/search', async (request) => {
  const q = z.object({ q: z.string().min(1) }).parse(request.query).q.trim();
  const normalized = normalizeClientName(q);
  const rows = await query(
    `SELECT ${CLIENT_WITH_STATS_SELECT},
            CASE
              WHEN ${CLIENT_NORMALIZED_SQL('c')} = $1 THEN 0
              WHEN c.client_name ILIKE $2 THEN 1
              ELSE 2
            END AS rank
     FROM clients c
     LEFT JOIN orders o ON ${CLIENT_ORDER_MATCH_SQL}
     WHERE ${CLIENT_NORMALIZED_SQL('c')} = $1 OR c.client_name ILIKE $3
     GROUP BY c.id
     ORDER BY rank ASC, similarity(c.client_name, $4) DESC, c.client_name ASC
     LIMIT 50`,
    [normalized, `${q}%`, `%${q}%`, q]
  );
  return rows;
});

app.get('/clients/lookup/:name', async (request, reply) => {
  const params = z.object({ name: z.string() }).parse(request.params);
  const client = await getClientByDeterministicName(params.name);
  if (!client) return reply.code(404).send({ error: 'Client not found' });
  return client;
});

app.get('/clients/:id/orders', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const clientRows = await query(`SELECT * FROM clients WHERE id=$1`, [params.id]);
  if (!clientRows[0]) return reply.code(404).send({ error: 'Client not found' });
  const normalized = normalizeClientName(clientRows[0].client_name);
  const rows = await query(
    `SELECT id, quotation_number, client_name, sales_agent, total_amount, current_stage, status,
            deposit_paid, balance_paid, delivery_address, contact_number,
            authorized_receiver_name, authorized_receiver_contact, created_at, updated_at
     FROM orders o
     WHERE o.client_id = $1 OR (o.client_id IS NULL AND ${CLIENT_NORMALIZED_SQL('o')} = $2)
     ORDER BY o.created_at DESC
     LIMIT 50`,
    [params.id, normalized]
  );
  return rows;
});

app.patch('/clients/:id', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = clientUpdateSchema.parse(request.body);

  // Verify action token and extract email
  let userEmail: string | null = null;
  if (body.action_token) {
    if (!cacheClient?.isOpen) return reply.status(503).send({ error: 'Action verification unavailable' });
    const tokenData = await cacheClient.get(`action_token:${body.action_token}`);
    if (!tokenData) return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    await cacheClient.del(`action_token:${body.action_token}`);
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  }

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;
  if (body.client_name !== undefined) { fields.push(`client_name=$${idx++}`); values.push(body.client_name); }
  if (body.delivery_address !== undefined) { fields.push(`delivery_address=$${idx++}`); values.push(nullableText(body.delivery_address)); }
  if (body.contact_number !== undefined) { fields.push(`contact_number=$${idx++}`); values.push(nullableText(body.contact_number)); }
  if (body.authorized_receiver_name !== undefined) { fields.push(`authorized_receiver_name=$${idx++}`); values.push(nullableText(body.authorized_receiver_name)); }
  if (body.authorized_receiver_contact !== undefined) { fields.push(`authorized_receiver_contact=$${idx++}`); values.push(nullableText(body.authorized_receiver_contact)); }
  if (body.notes !== undefined) { fields.push(`notes=$${idx++}`); values.push(nullableText(body.notes)); }

  if (fields.length === 0) {
    return reply.status(400).send({ error: 'No fields to update' });
  }

  fields.push(`updated_at=NOW()`);
  values.push(params.id);

  const rows = await query(
    `UPDATE clients SET ${fields.join(', ')} WHERE id=$${idx} RETURNING *`,
    values
  );

  if (!rows[0]) return reply.code(404).send({ error: 'Client not found' });
  const updated = rows[0];

  if (body.propagate_to_orders !== false) {
    await query(
      `UPDATE orders SET
         client_name = $2,
         delivery_address = $3,
         contact_number = $4,
         authorized_receiver_name = $5,
         authorized_receiver_contact = $6,
         updated_at = NOW()
       WHERE client_id = $1 AND status = 'active'`,
      [
        params.id,
        updated.client_name,
        updated.delivery_address ?? null,
        updated.contact_number ?? null,
        updated.authorized_receiver_name ?? null,
        updated.authorized_receiver_contact ?? null,
      ]
    );
  }

  await invalidateCache(['clients:*', '/clients', 'orders:*', 'dashboard:*']);
  broadcastSSE('client_updated', { id: params.id });
  await notifyManualChange(
    `✏️ Client edited via dashboard`,
    `Client: *${updated.client_name}*`,
    userEmail,
  );
  return reply.send(updated);
});

app.post('/clients/bulk-delete', async (request, reply) => {
  const body = z.object({
    ids: z.array(z.string().uuid()).min(1).max(200),
    force: z.boolean().optional().default(false),
    action_token: z.string(),
  }).parse(request.body);

  if (!cacheClient?.isOpen) return reply.status(503).send({ error: 'Action verification unavailable' });
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  await cacheClient.del(tokenKey);
  let userEmail: string | null = null;
  try {
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  } catch { /* non-fatal */ }

  const ids = Array.from(new Set(body.ids));
  const clientRows = await query(
    `SELECT id, client_name FROM clients WHERE id = ANY($1::uuid[]) ORDER BY client_name ASC`,
    [ids],
  );
  if (clientRows.length === 0) {
    return reply.code(404).send({ error: 'No matching clients found' });
  }

  const activeRows = await query(
    `SELECT client_id, COUNT(*)::int AS count
     FROM orders
     WHERE client_id = ANY($1::uuid[]) AND status = 'active'
     GROUP BY client_id`,
    [ids],
  );
  const activeOrderCount = activeRows.reduce((sum: number, row: any) => sum + Number(row.count ?? 0), 0);
  if (activeOrderCount > 0 && !body.force) {
    return reply.code(409).send({
      error: 'Cannot delete selected clients with active linked orders',
      active_order_count: activeOrderCount,
      force_available: true,
    });
  }

  if (body.force) {
    await query(`UPDATE orders SET client_id=NULL, updated_at=NOW() WHERE client_id = ANY($1::uuid[])`, [ids]);
  }

  const deletedRows = await query(
    `DELETE FROM clients WHERE id = ANY($1::uuid[]) RETURNING id, client_name`,
    [ids],
  );

  await invalidateCache(['clients:*', '/clients', 'orders:*', 'dashboard:*']);
  broadcastSSE('clients_bulk_deleted', { ids: deletedRows.map((row: any) => row.id) });
  const preview = deletedRows.map((row: any) => row.client_name).slice(0, 8).join(', ');
  const more = deletedRows.length > 8 ? ` and ${deletedRows.length - 8} more` : '';
  await notifyManualChange(
    `Clients bulk deleted via dashboard`,
    `Deleted: *${deletedRows.length}* client(s)\nClients: ${preview}${more}${body.force ? `\nForced: active orders unlinked (${activeOrderCount})` : ''}`,
    userEmail,
  );

  return reply.send({
    ok: true,
    deleted: deletedRows.length,
    clients: deletedRows,
    active_order_count: activeOrderCount,
    forced: body.force,
  });
});

app.delete('/clients/:id', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const queryParams = z.object({ force: z.string().optional() }).parse(request.query);
  const body = (request.body ?? {}) as any;
  const force = queryParams.force === 'true' || queryParams.force === '1' || body.force === true;

  // Verify action token and extract email
  let userEmail: string | null = null;
  if (body.action_token) {
    if (!cacheClient?.isOpen) return reply.status(503).send({ error: 'Action verification unavailable' });
    const tokenData = await cacheClient.get(`action_token:${body.action_token}`);
    if (!tokenData) return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    await cacheClient.del(`action_token:${body.action_token}`);
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  }

  const clientRows = await query(`SELECT * FROM clients WHERE id=$1`, [params.id]);
  if (!clientRows[0]) return reply.code(404).send({ error: 'Client not found' });

  const activeRows = await query(
    `SELECT COUNT(*)::int AS count FROM orders WHERE client_id=$1 AND status='active'`,
    [params.id]
  );
  const activeOrderCount = Number(activeRows[0]?.count ?? 0);

  if (activeOrderCount > 0 && !force) {
    return reply.code(409).send({
      error: 'Cannot delete client with active linked orders',
      active_order_count: activeOrderCount,
      force_available: true,
    });
  }

  if (force) {
    await query(`UPDATE orders SET client_id=NULL, updated_at=NOW() WHERE client_id=$1`, [params.id]);
  }

  const rows = await query(`DELETE FROM clients WHERE id=$1 RETURNING *`, [params.id]);
  await invalidateCache(['clients:*', '/clients', 'orders:*', 'dashboard:*']);
  broadcastSSE('client_deleted', { id: params.id });
  await notifyManualChange(
    `🗑️ Client deleted via dashboard`,
    `Client: *${rows[0]?.client_name ?? params.id}*${force ? ' (forced — active orders unlinked)' : ''}`,
    userEmail,
  );
  return reply.send({ ok: true, deleted: rows[0], active_order_count: activeOrderCount, forced: force });
});

// ── Inventory Management ────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result.map((s) => s.replace(/^"|"$/g, ''));
}

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  const rows = lines.slice(1).map(parseCSVLine);
  return { headers, rows };
}

function mapCSVHeaders(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const find = (candidates: string[]) => {
    for (const c of candidates) {
      const idx = headers.findIndex((h) => h.includes(c));
      if (idx !== -1) return idx;
    }
    return -1;
  };
  map.product_name = find(['product', 'name', 'product_name', 'item', 'title', 'item_name']);
  map.description = find(['description', 'desc', 'details', 'detail', 'spec', 'specification']);
  map.dimension = find(['dimension', 'dimensions', 'size', 'measurement', 'measurements', 'specs']);
  map.quantity = find(['quantity', 'qty', 'stock', 'count', 'amount', 'units']);
  return map;
}

app.get('/inventory', async (request, _reply) => {
  const queryParams = request.query as Record<string, string>;
  const limit = Math.min(Math.max(parseInt(queryParams.limit) || 200, 1), 500);
  const offset = Math.max(parseInt(queryParams.offset) || 0, 0);
  const rows = await query(
    `SELECT * FROM inventory_items ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
});

app.get('/inventory/count', async (_request, _reply) => {
  const rows = await query(`SELECT COUNT(*)::int AS total FROM inventory_items`);
  return { total: rows[0].total };
});

app.get('/inventory/:id/movements', async (request, reply) => {
  const { id } = request.params as { id: string };
  const rows = await query(
    `SELECT id, inventory_item_id, order_id, order_item_id, item_name, movement_type, quantity_change, quantity_after, note, created_by, created_at
     FROM inventory_movements
     WHERE inventory_item_id = $1
     ORDER BY created_at DESC`,
    [id]
  );
  return reply.send({ ok: true, movements: rows });
});

/**
 * GET /inventory/search?q=...
 * Full-text search across inventory_items by product_name, description, dimension, category.
 * Returns up to 50 results ranked by relevance.
 */
app.get('/inventory/search', async (request, reply) => {
  const queryParams = request.query as Record<string, string>;
  const q = (queryParams.q ?? '').trim();
  if (!q) return reply.code(400).send({ error: 'Search query "q" is required' });
  const limit = Math.min(Math.max(parseInt(queryParams.limit) || 20, 1), 50);

  const searchTerm = `%${q}%`;
  const rows = await query(
    `SELECT * FROM inventory_items
     WHERE product_name ILIKE $1
        OR description ILIKE $1
        OR dimension ILIKE $1
        OR category ILIKE $1
     ORDER BY
       CASE
         WHEN LOWER(product_name) = LOWER($2) THEN 0
         WHEN LOWER(product_name) LIKE LOWER($3) THEN 1
         WHEN LOWER(description) LIKE LOWER($3) THEN 2
         WHEN LOWER(category) LIKE LOWER($3) THEN 3
         ELSE 4
       END,
       product_name ASC
     LIMIT $4`,
    [searchTerm, q, `%${q}%`, limit]
  );
  return rows;
});

/**
 * POST /inventory/match
 * Fuzzy-match an order item name against all inventory items using a local
 * string similarity algorithm (no AI API cost). Returns top 5 matches.
 *
 * Request body: { name: string }
 * Response: { matches: Array<{ item: InventoryItem, score: number }> }
 */
app.post('/inventory/match', async (request, reply) => {
  const body = z.object({
    name: z.string().min(1),
  }).parse(request.body);

  const name = body.name.trim().toLowerCase();
  if (!name) return reply.code(400).send({ error: 'Item name is required' });

  // Fetch all inventory items (cached-friendly, typically < 1000 items)
  const items = await query(
    `SELECT * FROM inventory_items ORDER BY product_name ASC`
  );

  // ── Scoring function ──────────────────────────────────────────────
  function score(itemName: string, candidate: any): number {
    const cn = (candidate.product_name ?? '').toLowerCase();
    const cd = (candidate.description ?? '').toLowerCase();
    const cc = (candidate.category ?? '').toLowerCase();

    let s = 0;

    // Exact match → highest score
    if (cn === name) s += 100;
    else if (cn.includes(name) || name.includes(cn)) s += 60;

    // Token overlap (word-level matching)
    const nameTokens = name.split(/\s+/).filter(Boolean);
    const cnTokens = cn.split(/\s+/).filter(Boolean);
    const cdTokens = cd.split(/\s+/).filter(Boolean);

    let nameOverlap = 0;
    for (const nt of nameTokens) {
      if (cnTokens.some((t: string) => t.includes(nt) || nt.includes(t))) nameOverlap++;
    }
    if (nameTokens.length > 0) s += (nameOverlap / nameTokens.length) * 30;

    // Description overlap (weaker weight)
    let descOverlap = 0;
    for (const nt of nameTokens) {
      if (cdTokens.some((t: string) => t.includes(nt) || nt.includes(t))) descOverlap++;
    }
    if (nameTokens.length > 0) s += (descOverlap / nameTokens.length) * 15;

    // Category match
    if (cc && nameTokens.some((t: string) => cc.includes(t) || t.includes(cc))) s += 10;

    // Dimension match (if item has dimension info)
    const dim = (candidate.dimension ?? '').toLowerCase();
    if (dim && nameTokens.some((t: string) => dim.includes(t))) s += 5;

    // Penalize very short matches (likely noise)
    if (s > 0 && name.length <= 2) s *= 0.5;

    return Math.round(s);
  }

  const scored = items
    .map((item: any) => ({ item, score: score(name, item) }))
    .filter((m: any) => m.score > 0)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 5);

  return { matches: scored };
});

app.get('/inventory/:id', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const rows = await query(`SELECT * FROM inventory_items WHERE id=$1`, [params.id]);
  if (!rows[0]) return reply.code(404).send({ error: 'Item not found' });
  return rows[0];
});

app.post('/inventory', async (request, reply) => {
  const body = z.object({
    product_name: z.string().min(1),
    description: z.string().optional(),
    dimension: z.string().optional(),
    quantity: z.number().int().min(0).default(0),
    image_url: z.string().optional(),
    category: z.string().optional(),
    action_token: z.string(),
  }).parse(request.body);

  // Verify action token and extract email
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  const rows = await query(
    `INSERT INTO inventory_items (product_name, description, dimension, quantity, image_url, category)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [body.product_name, body.description ?? null, body.dimension ?? null, body.quantity, body.image_url ?? null, body.category ?? null]
  );

  await notifyManualChange(
    'Inventory item created',
    `Product: *${body.product_name}*\nQuantity: ${body.quantity}\n${body.category ? `Category: ${body.category}` : ''}`,
    userEmail,
  );

  await invalidateCache(['inventory:*', '/inventory']);
  broadcastSSE('inventory_updated', { id: rows[0].id });
  return reply.status(201).send(rows[0]);
});

app.patch('/inventory/:id', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({
    product_name: z.string().min(1).optional(),
    description: z.string().optional(),
    dimension: z.string().optional(),
    quantity: z.number().int().min(0).optional(),
    image_url: z.string().optional(),
    category: z.string().optional(),
    action_token: z.string().optional(),
  }).parse(request.body);

  // Verify action token and extract email
  let userEmail: string | null = null;
  if (body.action_token) {
    if (!cacheClient?.isOpen) return reply.status(503).send({ error: 'Action verification unavailable' });
    const tokenData = await cacheClient.get(`action_token:${body.action_token}`);
    if (!tokenData) return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    await cacheClient.del(`action_token:${body.action_token}`);
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  }

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;
  if (body.product_name !== undefined) { fields.push(`product_name=$${idx++}`); values.push(body.product_name); }
  if (body.description !== undefined) { fields.push(`description=$${idx++}`); values.push(body.description ?? null); }
  if (body.dimension !== undefined) { fields.push(`dimension=$${idx++}`); values.push(body.dimension ?? null); }
  if (body.quantity !== undefined) { fields.push(`quantity=$${idx++}`); values.push(body.quantity); }
  if (body.image_url !== undefined) { fields.push(`image_url=$${idx++}`); values.push(body.image_url ?? null); }
  if (body.category !== undefined) { fields.push(`category=$${idx++}`); values.push(body.category ?? null); }

  if (fields.length === 0) return reply.status(400).send({ error: 'No fields to update' });
  fields.push(`updated_at=NOW()`);
  values.push(params.id);

  const rows = await query(
    `UPDATE inventory_items SET ${fields.join(', ')} WHERE id=$${idx} RETURNING *`,
    values
  );
  if (!rows[0]) return reply.code(404).send({ error: 'Item not found' });
  await invalidateCache(['inventory:*', '/inventory']);
  broadcastSSE('inventory_updated', { id: params.id });
  await notifyManualChange(
    `✏️ Inventory item edited via dashboard`,
    `Item: *${rows[0].product_name}*`,
    userEmail,
  );
  return rows[0];
});

app.delete('/inventory/:id', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = (request.body ?? {}) as any;

  // Verify action token and extract email
  let userEmail: string | null = null;
  if (body.action_token) {
    if (!cacheClient?.isOpen) return reply.status(503).send({ error: 'Action verification unavailable' });
    const tokenData = await cacheClient.get(`action_token:${body.action_token}`);
    if (!tokenData) return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    await cacheClient.del(`action_token:${body.action_token}`);
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  }

  const rows = await query(`DELETE FROM inventory_items WHERE id=$1 RETURNING *`, [params.id]);
  if (!rows[0]) return reply.code(404).send({ error: 'Item not found' });
  await invalidateCache(['inventory:*', '/inventory']);
  broadcastSSE('inventory_deleted', { id: params.id });
  await notifyManualChange(
    `🗑️ Inventory item deleted via dashboard`,
    `Item: *${rows[0].product_name}*`,
    userEmail,
  );
  return { ok: true };
});

// Bulk delete inventory items
app.post('/inventory/bulk-delete', async (request, reply) => {
  const body = z.object({
    ids: z.array(z.string().uuid()).min(1),
    action_token: z.string(),
  }).parse(request.body);

  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail = tokenPayload.name ?? tokenPayload.email ?? null;

  const placeholders = body.ids.map((_, i) => `$${i + 1}`).join(',');
  const rows = await query(`DELETE FROM inventory_items WHERE id IN (${placeholders}) RETURNING product_name`, body.ids);
  await invalidateCache(['inventory:*', '/inventory']);
  broadcastSSE('inventory_bulk_deleted', { count: rows.length });
  await notifyManualChange(
    `🗑️ Inventory items bulk deleted via dashboard`,
    `${rows.length} item(s) removed`,
    userEmail,
  );
  return { ok: true, deleted_count: rows.length };
});

// Serve inventory item image (stored as raw base64 in image_url)
app.get('/inventory/:id/image', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const rows = await query(`SELECT image_url FROM inventory_items WHERE id=$1`, [params.id]);
  if (!rows[0] || !rows[0].image_url) return reply.code(404).send({ error: 'Image not found' });
  let rawBase64 = rows[0].image_url;
  // Handle legacy data URLs (e.g. "data:image/png;base64,iVBOR...")
  if (rawBase64.includes('base64,')) {
    rawBase64 = rawBase64.split('base64,')[1];
  }
  const imgBuffer = Buffer.from(rawBase64, 'base64');
  // Try to detect mime type from magic bytes
  let mimeType = 'image/png';
  if (imgBuffer[0] === 0xff && imgBuffer[1] === 0xd8) mimeType = 'image/jpeg';
  else if (imgBuffer[0] === 0x89 && imgBuffer[1] === 0x50) mimeType = 'image/png';
  else if (imgBuffer[0] === 0x47 && imgBuffer[1] === 0x49) mimeType = 'image/gif';
  else if (imgBuffer[0] === 0x52 && imgBuffer[1] === 0x49) mimeType = 'image/webp';
  reply.header('Content-Type', mimeType);
  reply.header('Cache-Control', 'public, max-age=86400');
  return reply.send(imgBuffer);
});

// Extract inventory details from an image using AI
app.post('/inventory/extract-image', async (request, reply) => {
  const body = z.object({
    image_base64: z.string(),
    mime_type: z.string(),
  }).parse(request.body);

  try {
    const result = await extractInventory(body.image_base64, body.mime_type);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return reply.status(500).send({ error: message });
  }
});

// Bulk upload: CSV, PDF, or image → create drafts
app.post('/inventory/bulk-upload', async (request, reply) => {
  const body = z.object({
    file_data: z.string(), // base64
    mime_type: z.string(),
    original_filename: z.string(),
    action_token: z.string(),
  }).parse(request.body);

  // Verify action token and extract email
  let userEmail: string | null = null;
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  try {
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  } catch { /* non-fatal */ }

  const mimeType = body.mime_type.toLowerCase();
  const drafts: any[] = [];

  if (mimeType === 'text/csv' || mimeType === 'application/vnd.ms-excel' || body.original_filename.toLowerCase().endsWith('.csv')) {
    // Parse CSV
    const text = Buffer.from(body.file_data, 'base64').toString('utf-8');
    const { headers, rows } = parseCSV(text);
    if (headers.length === 0 || rows.length === 0) {
      return reply.status(400).send({ error: 'CSV file is empty or invalid' });
    }
    const colMap = mapCSVHeaders(headers);

    for (const row of rows) {
      const productName = colMap.product_name >= 0 ? row[colMap.product_name] : '';
      if (!productName) continue;
      const description = colMap.description >= 0 ? row[colMap.description] : undefined;
      const dimension = colMap.dimension >= 0 ? row[colMap.dimension] : undefined;
      const quantityRaw = colMap.quantity >= 0 ? row[colMap.quantity] : undefined;
      const quantity = quantityRaw ? parseInt(quantityRaw.replace(/[^0-9]/g, ''), 10) : null;

      const draftRows = await query(
        `INSERT INTO inventory_drafts (product_name, description, dimension, category, quantity, source_type, source_filename, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [productName, description ?? null, dimension ?? null, null, isNaN(quantity as number) ? null : quantity, 'csv', body.original_filename, 'pending']
      );
      drafts.push(draftRows[0]);
    }
  } else if (mimeType.startsWith('image/') || mimeType === 'application/pdf') {
    // Use AI extraction for images and PDFs
    try {
      const result = await extractInventory(body.file_data, mimeType);
      if (result.type === 'inventory' && result.inventory && result.inventory.length > 0) {
        for (const item of result.inventory) {
          if (!item.product_name && !item.description) continue;
          const draftRows = await query(
            `INSERT INTO inventory_drafts (product_name, description, dimension, category, quantity, source_type, source_filename, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [
              item.product_name ?? null,
              item.description ?? null,
              item.dimension ?? null,
              item.category ?? null,
              item.quantity ?? null,
              mimeType.startsWith('image/') ? 'image' : 'pdf',
              body.original_filename,
              'pending',
            ]
          );
          drafts.push(draftRows[0]);
        }
      } else {
        return reply.status(422).send({ error: 'Could not extract inventory items from file', raw: result.raw_text });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  } else {
    return reply.status(400).send({ error: 'Unsupported file type. Please upload CSV, PDF, or image.' });
  }

  await notifyManualChange(
    'Inventory bulk upload',
    `File: *${body.original_filename}*\nDrafts created: ${drafts.length}`,
    userEmail,
  );

  await invalidateCache(['inventory:*', '/inventory/drafts']);
  broadcastSSE('inventory_drafts_created', { count: drafts.length });
  return { ok: true, drafts_created: drafts.length, drafts };
});

// Drafts
app.get('/inventory/drafts', async (_request, _reply) => {
  const rows = await query(`SELECT * FROM inventory_drafts WHERE status='pending' ORDER BY created_at DESC`);
  return rows;
});

app.patch('/inventory/drafts/:id', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({
    product_name: z.string().optional(),
    description: z.string().optional(),
    dimension: z.string().optional(),
    quantity: z.number().int().min(0).optional(),
    category: z.string().optional(),
  }).parse(request.body);

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;
  if (body.product_name !== undefined) { fields.push(`product_name=$${idx++}`); values.push(body.product_name); }
  if (body.description !== undefined) { fields.push(`description=$${idx++}`); values.push(body.description ?? null); }
  if (body.dimension !== undefined) { fields.push(`dimension=$${idx++}`); values.push(body.dimension ?? null); }
  if (body.quantity !== undefined) { fields.push(`quantity=$${idx++}`); values.push(body.quantity); }
  if (body.category !== undefined) { fields.push(`category=$${idx++}`); values.push(body.category ?? null); }

  if (fields.length === 0) return reply.status(400).send({ error: 'No fields to update' });
  fields.push(`updated_at=NOW()`);
  values.push(params.id);

  const rows = await query(
    `UPDATE inventory_drafts SET ${fields.join(', ')} WHERE id=$${idx} AND status='pending' RETURNING *`,
    values
  );
  if (!rows[0]) return reply.code(404).send({ error: 'Draft not found or already processed' });
  return rows[0];
});

app.post('/inventory/drafts/:id/approve', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ action_token: z.string() }).parse(request.body);

  // Verify action token and extract email
  let userEmail: string | null = null;
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  try {
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  } catch { /* non-fatal */ }

  const draftRows = await query(`SELECT * FROM inventory_drafts WHERE id=$1 AND status='pending'`, [params.id]);
  if (!draftRows[0]) return reply.code(404).send({ error: 'Draft not found or already processed' });
  const draft = draftRows[0];

  const itemRows = await query(
    `INSERT INTO inventory_items (product_name, description, dimension, quantity, image_url, category)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [draft.product_name, draft.description, draft.dimension, draft.quantity ?? 0, draft.image_url, draft.category]
  );
  await query(`UPDATE inventory_drafts SET status='approved', updated_at=NOW() WHERE id=$1`, [params.id]);

  await notifyManualChange(
    'Inventory draft approved',
    `Product: *${draft.product_name ?? 'N/A'}*\nQuantity: ${draft.quantity ?? 0}\n${draft.category ? `Category: ${draft.category}` : ''}`,
    userEmail,
  );

  await invalidateCache(['inventory:*', '/inventory', '/inventory/drafts']);
  broadcastSSE('inventory_updated', { id: itemRows[0].id });
  return { ok: true, item: itemRows[0] };
});

app.post('/inventory/drafts/approve-all', async (request, reply) => {
  const body = z.object({ action_token: z.string() }).parse(request.body);

  // Verify action token and extract email
  let userEmail: string | null = null;
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  try {
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  } catch { /* non-fatal */ }

  const draftRows = await query(`SELECT * FROM inventory_drafts WHERE status='pending' ORDER BY created_at`);
  const items: any[] = [];
  for (const draft of draftRows) {
    const itemRows = await query(
      `INSERT INTO inventory_items (product_name, description, dimension, quantity, image_url, category)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [draft.product_name, draft.description, draft.dimension, draft.quantity ?? 0, draft.image_url, draft.category]
    );
    await query(`UPDATE inventory_drafts SET status='approved', updated_at=NOW() WHERE id=$1`, [draft.id]);
    items.push(itemRows[0]);
  }

  await notifyManualChange(
    'All inventory drafts approved',
    `Approved: ${items.length} draft(s)`,
    userEmail,
  );

  await invalidateCache(['inventory:*', '/inventory', '/inventory/drafts']);
  broadcastSSE('inventory_bulk_approved', { count: items.length });
  return { ok: true, approved_count: items.length, items };
});

app.delete('/inventory/drafts/:id', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ action_token: z.string() }).parse(request.body);

  // Verify action token
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);

  await query(`UPDATE inventory_drafts SET status='rejected', updated_at=NOW() WHERE id=$1`, [params.id]);
  await invalidateCache(['inventory:*', '/inventory/drafts']);
  return { ok: true };
});

app.post('/inventory/drafts/clear', async (request, reply) => {
  const body = z.object({ action_token: z.string() }).parse(request.body);

  // Verify action token
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);

  await query(`DELETE FROM inventory_drafts WHERE status IN ('approved', 'rejected')`);
  await invalidateCache(['inventory:*', '/inventory/drafts']);
  return { ok: true };
});

// Bulk delete selected drafts
app.post('/inventory/drafts/bulk-delete', async (request, reply) => {
  const body = z.object({
    ids: z.array(z.string().uuid()).min(1),
    action_token: z.string(),
  }).parse(request.body);

  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);

  const placeholders = body.ids.map((_, i) => `$${i + 1}`).join(',');
  await query(`DELETE FROM inventory_drafts WHERE id IN (${placeholders})`, body.ids);
  await invalidateCache(['inventory:*', '/inventory/drafts']);
  broadcastSSE('inventory_drafts_updated', { type: 'bulk_deleted', count: body.ids.length });
  return { ok: true, deleted_count: body.ids.length };
});

// Delete ALL pending drafts
app.post('/inventory/drafts/delete-all', async (request, reply) => {
  const body = z.object({ action_token: z.string() }).parse(request.body);

  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);

  const result = await query(`DELETE FROM inventory_drafts WHERE status='pending' RETURNING id`);
  await invalidateCache(['inventory:*', '/inventory/drafts']);
  broadcastSSE('inventory_drafts_updated', { type: 'all_deleted', count: result.length });
  return { ok: true, deleted_count: result.length };
});

// ── Bug Reports ────────────────────────────────────────────────────────

const bugReportSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  source: z.enum(['dashboard', 'telegram']).default('dashboard'),
  reporter_name: z.string().max(200).optional(),
  reporter_contact: z.string().max(200).optional(),
  order_reference: z.string().max(100).optional(),
  action_token: z.string(),
});

app.post('/bug-reports', async (request, reply) => {
  const body = bugReportSchema.parse(request.body);

  // Verify action token and extract email
  let userEmail: string | null = null;
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  try {
    const tokenPayload = JSON.parse(tokenData);
    userEmail = tokenPayload.name ?? tokenPayload.email ?? null;
  } catch { /* non-fatal */ }

  const rows = await query(
    `INSERT INTO bug_reports (title, description, source, reporter_name, reporter_contact, order_reference)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [body.title, body.description, body.source, body.reporter_name ?? null, body.reporter_contact ?? null, body.order_reference ?? null]
  );

  const report = rows[0];

  // Notify escalation group about the bug report
  const sourceLabel = body.source === 'telegram' ? '🤖 Telegram' : '🌐 Dashboard';
  const reporterInfo = body.reporter_name
    ? `\nReporter: ${body.reporter_name}${body.reporter_contact ? ` (${body.reporter_contact})` : ''}`
    : '';
  const orderRef = body.order_reference ? `\nOrder: ${body.order_reference}` : '';

  await notifyManualChange(
    '🐛 Bug Report Submitted',
    `Title: *${body.title}*\nSource: ${sourceLabel}${reporterInfo}${orderRef}\n\nDescription:\n${body.description}`,
    userEmail,
  );

  await invalidateCache(['bug-reports:*']);
  broadcastSSE('bug_report_created', { id: report.id });

  return reply.code(201).send({ ok: true, report });
});

app.get('/bug-reports', async () => {
  const rows = await query(
    `SELECT * FROM bug_reports ORDER BY created_at DESC LIMIT 100`
  );
  return { ok: true, reports: rows };
});

app.patch('/bug-reports/:id', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({
    status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
    action_token: z.string(),
  }).parse(request.body);

  // Verify action token
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);

  const rows = await query(
    `UPDATE bug_reports SET status = COALESCE($1, status), updated_at = NOW() WHERE id = $2 RETURNING *`,
    [body.status ?? null, params.id]
  );

  if (!rows[0]) return reply.code(404).send({ error: 'Bug report not found' });

  await invalidateCache(['bug-reports:*']);
  broadcastSSE('bug_report_updated', { id: params.id });

  return reply.send({ ok: true, report: rows[0] });
});

// SSE Endpoint
app.get('/events', (request, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const clientId = randomUUID();
  const client = {
    id: clientId,
    write: (data: string) => reply.raw.write(data),
  };

  const remove = addSSEClient(client);
  console.log(`[sse] Client connected: ${clientId}`);

  // Send initial connected event
  reply.raw.write(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`);

  // Keep-alive every 30 seconds
  const keepAlive = setInterval(() => {
    try {
      reply.raw.write(':keepalive\n\n');
    } catch {
      clearInterval(keepAlive);
    }
  }, 30_000);

  // Cleanup on disconnect
  request.raw.on('close', () => {
    clearInterval(keepAlive);
    remove();
    console.log(`[sse] Client disconnected: ${clientId}`);
  });
});

// ── Auto-Migrations ─────────────────────────────────────────────────
// Runs all .sql files in database/migrations/ on startup so the schema
// never drifts from the codebase. Safe to run repeatedly (idempotent SQL).

import { readdir, readFile } from 'fs/promises';
// path — already imported at top of file

const MIGRATION_PATHS = [
  '/app/database/migrations',                 // Docker
  resolve(process.cwd(), 'database/migrations'), // Project root
  resolve(process.cwd(), '../../database/migrations'), // apps/api cwd
];

async function runMigrations(): Promise<void> {
  let migrationsDir: string | null = null;
  for (const p of MIGRATION_PATHS) {
    try {
      await readdir(p);
      migrationsDir = p;
      break;
    } catch { /* ignore */ }
  }

  if (!migrationsDir) {
    console.warn('[migrations] No migrations directory found. Skipping.');
    return;
  }

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    console.log('[migrations] No migration files found.');
    return;
  }

  console.log(`[migrations] Found ${files.length} migration(s) in ${migrationsDir}`);

  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf-8');
    try {
      await query(sql);
      console.log(`[migrations] ✓ ${file}`);
    } catch (err: any) {
      console.error(`[migrations] ✗ ${file} failed: ${err.message}`);
      // Continue with other migrations — don't crash the server for one bad file.
      // If a migration truly fails, the admin needs to fix it manually.
    }
  }
}

// ── Start ───────────────────────────────────────────────────────────

await runMigrations();

// ── Fix production reminder chat IDs (one-time data repair) ─────────
// production_pending was incorrectly inheriting group_chat_id from the
// deposit_verification reminder (finance group). production_midpoint and
// production_due used PURCHASING_GROUP_ID instead of PRODUCTION_GROUP_CHAT_ID.
// Reassign all active production-stage reminders to the correct chat.
if (PRODUCTION_CHAT_ID) {
  try {
    const fixed = await query(
      `UPDATE reminders
          SET group_chat_id = $1, updated_at = NOW()
        WHERE stage IN ('production_pending', 'production_midpoint', 'production_due')
          AND status IN ('active', 'pending')
          AND group_chat_id IS DISTINCT FROM $1`,
      [PRODUCTION_CHAT_ID],
    );
    const count = (fixed as any[]).length;
    if (count > 0) console.log(`[startup] Fixed ${count} production reminder(s) → production group chat`);
  } catch (err: any) {
    console.error('[startup] Failed to fix production reminder chat IDs:', err.message);
  }
}

const port = Number(process.env.PORT ?? 8080);

// Seed default dashboard accounts on first boot
(async function seedDashboardAccounts() {
  try {
    const existing = await query(`SELECT email FROM dashboard_accounts LIMIT 1`);
    if (existing.length > 0) return;

    const defaults = [
      { email: 'jpgyap@gmail.com', name: 'Admin', role: 'admin', allowed_tabs: null, sub_users: null },
      { email: 'maiquocquynh2506@gmail.com', name: 'Quynh Mai', role: 'editor', allowed_tabs: JSON.stringify(['/', '/orders', '/actions', '/clients', '/purchasing', '/production', '/inventory', '/stock-prep', '/delivery', '/sales', '/collection', '/stages', '/workflow', '/calendar', '/agents', '/logs', '/bot-logs', '/bugs', '/telegram', '/backup', '/vision', '/settings']), sub_users: null },
      { email: 'sales.homeu@gmail.com', name: 'Sales Team', role: 'editor', allowed_tabs: JSON.stringify(['/', '/orders', '/actions', '/clients', '/purchasing', '/production', '/inventory', '/stock-prep', '/delivery', '/sales', '/collection', '/stages', '/workflow', '/calendar', '/agents', '/logs', '/bot-logs', '/bugs', '/telegram', '/backup', '/vision', '/settings']), sub_users: JSON.stringify([{ code: '777', name: 'Mariella Ignaco' }, { code: '888', name: 'Cathlyn Roma' }]) },
    ];

    for (const d of defaults) {
      await query(
        `INSERT INTO dashboard_accounts (email, name, role, allowed_tabs, sub_users) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [d.email, d.name, d.role, d.allowed_tabs, d.sub_users]
      );
    }
    console.log('[seed] Dashboard accounts seeded');
  } catch (err) {
    console.warn('[seed] Failed to seed dashboard accounts:', err);
  }
})();

// Start the reminder scheduler (checks every 60 seconds)
const REMINDER_INTERVAL_MS = Number(process.env.REMINDER_INTERVAL_MS ?? 60_000);
startReminderScheduler(REMINDER_INTERVAL_MS);

// Start the agent scheduler (checks every 60 seconds for due agents)
const AGENT_CHECK_INTERVAL_MS = Number(process.env.AGENT_CHECK_INTERVAL_MS ?? 60_000);
startAgentScheduler(AGENT_CHECK_INTERVAL_MS);

await app.listen({ port, host: '0.0.0.0' });
console.log(`[server] Listening on port ${port}`);

// ── Memory Monitoring ────────────────────────────────────────────────
const MEM_CHECK_INTERVAL_MS = Number(process.env.MEM_CHECK_INTERVAL_MS ?? 60_000);
const MEM_WARN_MB = Number(process.env.MEM_WARN_MB ?? 512);
const MEM_CRIT_MB = Number(process.env.MEM_CRIT_MB ?? 768);

setInterval(() => {
  const usage = process.memoryUsage();
  const rssMb = Math.round(usage.rss / 1024 / 1024);
  const heapMb = Math.round(usage.heapUsed / 1024 / 1024);

  if (rssMb > MEM_CRIT_MB) {
    console.error(`[memory] CRITICAL — RSS ${rssMb}MB, Heap ${heapMb}MB. Consider restarting.`);
  } else if (rssMb > MEM_WARN_MB) {
    console.warn(`[memory] WARNING — RSS ${rssMb}MB, Heap ${heapMb}MB`);
  }
}, MEM_CHECK_INTERVAL_MS);

// ── Graceful Shutdown ────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  console.log(`[server] Received ${signal}. Shutting down gracefully...`);

  // Stop accepting new connections
  app.server?.close(() => {
    console.log('[server] HTTP server closed');
  });

  // Stop schedulers from firing new work
  stopReminderScheduler();
  stopAgentScheduler();

  // Wait for in-flight work to finish (with timeout)
  console.log('[server] Waiting for agents and reminders to finish...');
  await Promise.race([
    Promise.all([waitForAgents(30_000), waitForReminders(30_000)]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Shutdown timeout')), 35_000)),
  ]).catch((err) => {
    console.warn('[server] Graceful shutdown timed out:', err.message);
  });

  // Close Redis
  if (cacheClient?.isOpen) {
    try { await cacheClient.quit(); } catch { /* ignore */ }
  }

  console.log('[server] Goodbye');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));


