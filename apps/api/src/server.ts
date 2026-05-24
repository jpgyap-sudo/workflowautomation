import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { query } from './db.js';
import { cacheClient, cacheGet, cacheSet, cacheDeletePattern } from './cache.js';
import { randomUUID, randomInt } from 'crypto';
import * as http from 'http';
import nodemailer from 'nodemailer';
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
  o.balance_paid, o.balance_paid_at, o.order_confirmed_at,
  o.production_started, o.production_started_at, o.estimated_production_days,
  o.production_delayed, o.production_delay_days,
  o.production_finished, o.production_finished_at, o.delivery_estimated_days,
  o.client_id, o.delivery_address, o.contact_number,
  o.authorized_receiver_name, o.authorized_receiver_contact,
  o.partial_production_items,
  o.delivery_date,
  o.delivery_exception, o.delivery_exception_notes,
  o.delivery_exception_granted_at, o.delivery_exception_granted_by,
  o.production_exception, o.production_exception_notes,
  o.production_exception_granted_at, o.production_exception_granted_by,
  o.inventory_verified_at, o.inventory_verification_pct,
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
const PRODUCTION_CHAT_ID = process.env.PRODUCTION_GROUP_CHAT_ID ?? null;

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
  production_confirmed:  ['production-agent'],
  // Production → En Route
  en_route:              ['production-agent', 'inventory-agent'],
  // En Route → Inventory Verification (when all items arrived)
  inventory_verification: ['inventory-agent'],
  // Inventory Verification → Inventory Arrived
  inventory_arrived:     ['inventory-agent'],
  // Inventory → Balance Due
  balance_due:           ['collection-agent', 'delivery-agent'],
  // Deposit / Payment Verification
  deposit_pending:       ['collection-agent'],
  deposit_verification:  ['collection-agent'],
  balance_verification:  ['collection-agent'],
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

function triggerAgentsForStage(stage: string, orderRef?: string, clientName?: string): void {
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
      const msg = `📋 <b>Stage Update</b> — ${orderRef}${client}\n➡️ ${stageLabel}`;
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
  const { email } = z.object({ email: z.string().email() }).parse(request.body);

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

  const msg = `🔐 <b>Dashboard Action Verification</b>\n\nA dashboard action requires confirmation.\n\nYour 4-digit code:\n\n<code>${code}</code>\n\n<i>Expires in 5 minutes. Do not share this code.</i>`;
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

  const rows = await query(
    `INSERT INTO orders (quotation_number, client_name, sales_agent, total_amount, order_confirmed_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (quotation_number) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [body.quotation_number ?? null, body.client_name ?? null, body.sales_agent ?? null, body.total_amount ?? null, body.order_confirmed_at ?? null]
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

  return reply.send(newOrder);
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
     WHERE o.current_stage = 'purchasing_pending'
       AND o.partial_production_items IS NOT NULL
       AND o.partial_production_items != '[]'::jsonb
       AND o.status = 'active'
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

app.get('/orders/picker', async (request, reply) => {
  const { action } = z.object({ action: z.string() }).parse(request.query);

  const whereMap: Record<string, string> = {
    status:       `o.status = 'active'`,
    produce:      `o.status = 'active' AND o.deposit_paid = true AND (o.production_finished IS NULL OR o.production_finished = false)`,
    deposit:      `o.status = 'active' AND (o.deposit_paid IS NULL OR o.deposit_paid = false)`,
    paybalance:   `o.status = 'active' AND o.deposit_paid = true AND (o.balance_paid IS NULL OR o.balance_paid = false)`,
    deliverydate: `o.status = 'active' AND o.balance_paid = true AND o.current_stage NOT IN ('delivery_scheduled','delivered','payment_received','payment_confirmed')`,
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

  // Build SET clause dynamically
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;
  if (body.client_name !== undefined) { fields.push(`client_name=$${idx++}`); values.push(body.client_name); }
  if (body.sales_agent !== undefined) { fields.push(`sales_agent=$${idx++}`); values.push(body.sales_agent); }
  if (body.total_amount !== undefined) { fields.push(`total_amount=$${idx++}`); values.push(body.total_amount); }
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

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id: params.id });

  const updatedFields = Object.keys(body).filter((k) => k !== 'action_token').join(', ');
  await notifyManualChange(
    `✏️ Order edited via dashboard`,
    `Quotation: *${rows[0].quotation_number ?? params.id}*\nClient: ${rows[0].client_name ?? '—'}\nFields changed: ${updatedFields}`,
    userEmail,
  );

  return reply.send(rows[0]);
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
    `SELECT id, quotation_number, current_stage, deposit_verified, production_exception FROM orders WHERE id = $1`,
    [id]
  );
  if (!existingRows[0]) return reply.code(404).send({ error: 'Order not found' });
  const previousStage = existingRows[0].current_stage;

  if (body.production_started && !existingRows[0].deposit_verified && !existingRows[0].production_exception) {
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
    setClauses.push(`current_stage = 'production_confirmed'`);
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
    await query(
      `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
       VALUES ($1, 'production_confirmed', 'started', $2, 'system')`,
      [id, body.estimated_production_days
        ? `Production started; estimated ${body.estimated_production_days} day(s)`
        : 'Production started']
    );

    if (previousStage && previousStage !== 'production_confirmed') {
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
         ON CONFLICT (order_id, stage) DO UPDATE SET
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
         ON CONFLICT (order_id, stage) DO UPDATE SET
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
    triggerAgentsForStage('production_confirmed', updatedOrder.quotation_number, updatedOrder.client_name);
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
    `SELECT id, quotation_number, client_name FROM orders WHERE id = $1`,
    [id]
  );
  if (!existingRows[0]) return reply.code(404).send({ error: 'Order not found' });
  const order = existingRows[0];

  await query(
    `UPDATE orders SET partial_production_items = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(body.missing_items), id]
  );

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'purchasing_pending', 'partial', $2, 'system')`,
    [id, `Partial production: items pending — ${body.missing_items.join(', ')}`]
  );

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
     VALUES ($1, 'production_confirmed', $2, $3, 'system')`,
    [id, body.on_time ? 'on_time' : 'delayed',
     body.on_time ? 'Production reported on time' : `Production delayed by ${body.delay_days ?? 0} day(s)`]
  );

  // Notify production agent immediately about the production status update
  triggerAgentsForStage('production_confirmed', rows[0].quotation_number, rows[0].client_name);

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
     WHERE current_stage IN ('production_pending', 'production_confirmed', 'purchasing_pending', 'partial_production', 'en_route')
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
      `UPDATE order_items SET production_status = $1, updated_at = NOW() WHERE id = $2`,
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
    await query(
      `UPDATE orders
       SET production_started = TRUE,
           production_finished = TRUE,
           production_finished_at = COALESCE(production_finished_at, NOW()),
           current_stage = 'en_route',
           updated_at = NOW()
       WHERE id = $1`,
      [orderId],
    );
    await query(
      `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
       VALUES ($1, 'en_route', 'production_finished', 'All production board items marked finished; ready for delivery / dispatch.', 'production_board')`,
      [orderId],
    );
  } else if (body.area === 'production' && body.status === 'in_progress') {
    await query(
      `UPDATE orders
       SET production_started = TRUE,
           production_started_at = COALESCE(production_started_at, NOW()),
           current_stage = CASE WHEN current_stage IN ('purchasing_pending', 'production_pending') THEN 'production_confirmed' ELSE current_stage END,
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

  const rows = await query(
    `UPDATE orders SET production_finished = TRUE, production_finished_at = NOW(),
     delivery_estimated_days = $1, current_stage = 'en_route', updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [body.delivery_estimated_days, id]
  );

  if (!rows[0]) return reply.code(404).send({ error: 'Order not found' });

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'en_route', 'production_finished', $2, 'system')`,
    [id, `Production finished; delivery availability estimated in ${body.delivery_estimated_days} day(s)`]
  );

  // Complete item-level production reminder if it exists
  await query(
    `UPDATE reminders SET status = 'completed', updated_at = NOW()
     WHERE order_id = $1 AND status = 'active' AND stage = 'item_level_production'`,
    [id]
  );

  // Check if order has item-level tracking items
  const itemRows = await query(
    `SELECT COUNT(*)::int AS cnt FROM order_items WHERE order_id = $1`,
    [id]
  );
  const hasItems = itemRows[0]?.cnt > 0;

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
         ON CONFLICT (order_id, stage) DO UPDATE SET
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
  return reply.send({ ok: true, order: rows[0] });
});

// ── Confirm En Route ──────────────────────────────────────────────────
// After production is finished, the order is in 'en_route' stage awaiting
// dispatch confirmation. When confirmed, this endpoint is called with
// estimated arrival days. The order moves from 'en_route' to 'inventory_verification'.
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
     estimated_arrival_days = $1, current_stage = 'inventory_verification', updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [body.estimated_arrival_days, id]
  );

  if (!rows[0]) return reply.code(404).send({ error: 'Order not found' });

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'inventory_verification', 'en_route_confirmed', $2, 'system')`,
    [id, `En route confirmed; estimated arrival in ${body.estimated_arrival_days} day(s). Inventory verification pending.`]
  );

  // Complete the en_route_reminder (legacy) and item_level_en_route (item-level tracking)
  await query(
    `UPDATE reminders SET status = 'completed', updated_at = NOW()
     WHERE order_id = $1 AND status = 'active' AND stage IN ('en_route_reminder', 'item_level_en_route')`,
    [id]
  );

  // Notify inventory agent immediately that inventory verification is needed
  triggerAgentsForStage('inventory_verification', rows[0].quotation_number, rows[0].client_name);

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
        `Order is en route. Inventory verification is now needed.`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${rows[0].quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });
  return reply.send({ ok: true, order: rows[0] });
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
      await query(
        `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
         VALUES ($1, $2, $3, $4, 'once', $5, 'active')
         ON CONFLICT (order_id, stage) WHERE item_id IS NULL DO UPDATE SET
           next_run_at = EXCLUDED.next_run_at,
           status = 'active',
           updated_at = NOW()`,
        [id, body.stage, chatId, `📦 En Route ${body.stage === 'en_route_arrival' ? 'Arrival' : 'Midpoint'} — #${orderRow[0].quotation_number}`, newRunAt.toISOString()]
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
const inventoryVerifyItemSchema = z.object({
  item_id: z.string(),
  action: z.enum(['all', 'partial', 'not_yet']),
  verified_qty: z.number().int().min(0).optional(),
  action_token: z.string(),
});

app.post('/orders/:id/inventory-verify-item', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = inventoryVerifyItemSchema.parse(request.body);

  // Verify the order is in inventory_verification stage
  const orderRows = await query(`SELECT current_stage, quotation_number FROM orders WHERE id = $1`, [id]);
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });
  if (orderRows[0].current_stage !== 'inventory_verification') {
    return reply.code(400).send({ error: 'Order is not in inventory verification stage' });
  }

  // Get the item
  const itemRows = await query(`SELECT id, name, quantity, verified_qty FROM order_items WHERE id = $1 AND order_id = $2`, [body.item_id, id]);
  if (!itemRows[0]) return reply.code(404).send({ error: 'Item not found' });

  const item = itemRows[0];
  let newVerifiedQty = item.verified_qty ?? 0;

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

  // Update verified_qty on the item
  await query(
    `UPDATE order_items SET verified_qty = $1, updated_at = NOW() WHERE id = $2`,
    [newVerifiedQty, body.item_id]
  );

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
  await query(
    `INSERT INTO production_update_logs (order_id, order_item_id, note, log_type, created_by)
     VALUES ($1, $2, $3, 'agent', 'inventory-agent')`,
    [id, body.item_id, `Inventory verification: ${item.name} — ${body.action} (verified ${newVerifiedQty}/${item.quantity})`]
  );

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${orderRows[0].quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  return reply.send({
    ok: true,
    item_id: body.item_id,
    verified_qty: newVerifiedQty,
    verification_pct: verificationPct,
  });
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
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);
  const tokenPayload = JSON.parse(tokenData);
  const userEmail: string | null = tokenPayload.name ?? tokenPayload.email ?? null;

  const orderRows = await query(`SELECT current_stage, quotation_number, client_name FROM orders WHERE id = $1`, [id]);
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });
  if (orderRows[0].current_stage !== 'inventory_verification') {
    return reply.code(400).send({ error: 'Order is not in inventory verification stage' });
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
        `📦 <b>Inventory Verification Complete (Dashboard)</b>\n\n` +
        `Quotation: <b>${ref}</b>\n` +
        `Client: ${client}\n\n` +
        `Inventory verification has been completed via dashboard. Order is now in Inventory Arrived stage.`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${orderRows[0].quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  return reply.send({ ok: true, message: 'Inventory verification completed. Advanced to inventory_arrived.' });
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

  const orderRows = await query(`SELECT current_stage, quotation_number, client_name FROM orders WHERE id = $1`, [id]);
  if (!orderRows[0]) return reply.code(404).send({ error: 'Order not found' });
  if (orderRows[0].current_stage !== 'inventory_arrived') {
    return reply.code(400).send({ error: 'Order is not in inventory arrival stage' });
  }

  // Advance to balance_due — set completion pct and verified_at timestamp
  await query(
    `UPDATE orders SET current_stage = 'balance_due', inventory_verified_at = NOW(),
     inventory_verification_pct = 100, updated_at = NOW()
     WHERE id = $1`,
    [id]
  );

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'balance_due', 'auto_advanced', 'Inventory arrival confirmed. Proceeding to balance due.', 'inventory-agent')`,
    [id]
  );

  // Complete reminders for inventory_arrived
  await query(
    `UPDATE reminders SET status = 'completed', updated_at = NOW()
     WHERE order_id = $1 AND status = 'active' AND stage = 'inventory_arrived'`,
    [id]
  );

  // Fire agents for the new stage
  triggerAgentsForStage('balance_due', orderRows[0].quotation_number, orderRows[0].client_name);

  // Notify escalation group
  await notifyManualChange(
    'Inventory arrival confirmed',
    `Quotation: *${orderRows[0].quotation_number ?? 'N/A'}*\nClient: *${orderRows[0].client_name ?? 'Unknown'}*\nAdvanced to: Balance Due`,
    userEmail,
  );

  // Notify inventory group chat
  const INVENTORY_GROUP_CHAT_ID = process.env.INVENTORY_GROUP_CHAT_ID;
  if (INVENTORY_GROUP_CHAT_ID) {
    const ref = orderRows[0].quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = orderRows[0].client_name ?? 'Unknown';
    setImmediate(() => {
      notifyGroupChat(
        INVENTORY_GROUP_CHAT_ID,
        `✅ <b>Inventory Arrival Confirmed (Dashboard)</b>\n\n` +
        `Quotation: <b>${ref}</b>\n` +
        `Client: ${client}\n\n` +
        `All inventory has been confirmed as arrived via dashboard. Order is now in Balance Due stage.`
      );
    });
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${orderRows[0].quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });

  return reply.send({ ok: true, message: 'Inventory arrival confirmed. Advanced to balance_due.' });
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
  action_token: z.string().optional(),
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
            oi.production_status, oi.en_route_status,
            oi.estimated_arrival_days, oi.created_at, oi.updated_at
     FROM order_items oi
     WHERE oi.order_id = $1
     ORDER BY oi.created_at ASC`,
    [id]
  );

  return reply.send({ ok: true, items: rows });
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
      `INSERT INTO order_items (order_id, name, quantity, production_status, en_route_status, estimated_arrival_days)
       VALUES ($1, $2, $3, $4, $5, $6)`,
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
            estimated_arrival_days, created_at, updated_at
     FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
    [id]
  );

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });
  return reply.send({ ok: true, items });
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
  }
  if (body.en_route_status !== undefined) {
    setClauses.push(`en_route_status = $${idx++}`);
    values.push(body.en_route_status);
  }
  if (body.estimated_arrival_days !== undefined) {
    setClauses.push(`estimated_arrival_days = $${idx++}`);
    values.push(body.estimated_arrival_days);
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
               estimated_arrival_days, created_at, updated_at`,
    values
  );

  if (!rows[0]) return reply.code(404).send({ error: 'Item not found' });

  const updatedItem = rows[0] as any;

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
      }
    }
  }

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
            estimated_arrival_days, created_at, updated_at
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
       ON CONFLICT (order_id, stage) DO UPDATE SET
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
     ON CONFLICT (order_id, stage) DO UPDATE SET
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
    `SELECT id, total_amount, deposit_amount, balance_paid, current_stage, deposit_verified, production_exception
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
    deposit_verification:      ['purchasing_pending'],
    purchasing_pending:        ['production_pending'],
    production_pending:        ['production_confirmed'],
    production_confirmed:      ['en_route', 'partial_production'],
    partial_production:        ['en_route'],
    en_route:                  ['inventory_verification', 'inventory_arrived'],
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

  const previousStage = order.current_stage;
  const targetStage = body.stage;
  const productionGatedStages = new Set(['production_pending', 'production_confirmed', 'partial_production', 'en_route']);
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

  // Guard: Block delivery_scheduled if balance is not paid
  if (body.stage === 'delivery_scheduled' && !order.balance_paid) {
    if (order.total_amount == null) {
      return reply.code(400).send({
        error: 'Cannot schedule delivery: total amount not set for this order. Please set the total amount first.',
      });
    }
    const totalAmount = Number(order.total_amount);
    const depositAmount = Number(order.deposit_amount ?? 0);
    const balance = totalAmount - depositAmount;
    return reply.code(400).send({
      error: `Cannot schedule delivery: balance not yet paid. Balance due: ₱${balance.toLocaleString()}`,
      balance_due: balance,
    });
  }

  const orderId = order.id;

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by) VALUES ($1,$2,$3,$4,$5)`,
    [orderId, body.stage, body.status, body.remarks ?? null, body.updated_by ?? null]
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

    // Schedule file-store cleanup: delete quotation text after 3 months
    // The file-store container handles the actual deletion based on file age.
    // We set retention_until on the files table for tracking.
    const retentionUntil = new Date();
    retentionUntil.setDate(retentionUntil.getDate() + 90); // 3 months
    await query(
      `UPDATE files SET retention_until=$1 WHERE order_id=$2 AND storage_backend='local'`,
      [retentionUntil.toISOString(), orderId]
    );

    // ── Auto-complete if balance was already paid before delivery ──────────
    // If balance_paid is already true, steps 14-16 (countered → payment_received → payment_confirmed)
    // are N/A. The order can go directly to 'completed'.
    if (order.balance_paid) {
      await query(
        `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
         VALUES ($1, 'completed', 'auto_completed', 'Balance already paid — auto-completed on delivery (steps 14-16 N/A)', $2)`,
        [orderId, body.updated_by ?? null]
      );
      await query(`UPDATE orders SET current_stage='completed', updated_at=NOW() WHERE id=$1`, [orderId]);

      // Auto-complete reminders for delivered stage
      await query(
        `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage='delivered' AND status='active'`,
        [orderId]
      );

      // Fire notification for 'completed' stage so the transition group gets notified
      triggerAgentsForStage('completed', body.quotation_number, order?.client_name ?? null);
    }
  }

  // Auto-complete reminders for the previous stage when moving forward
  if (previousStage && previousStage !== body.stage) {
    await query(
      `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage=$2 AND status='active'`,
      [orderId, previousStage]
    );
  }

  // Invalidate caches after stage update
  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${body.quotation_number}`, 'calendar:*', 'sales:*']);

  if (isDashboardOrigin(body.updated_by)) {
    await notifyManualChange(
      'Quick Action: Stage updated',
      `Quotation: *${body.quotation_number}*\nStage: ${body.stage}\nStatus: ${body.status}\nRemarks: ${body.remarks ?? '-'}`,
      userEmail,
    );
  }

  // Immediately fire the relevant agent so group chats are notified now, not on the next hourly tick
  triggerAgentsForStage(body.stage, body.quotation_number, order?.client_name ?? null);

  // Also notify the specific functional group directly based on the target stage
  // This ensures the group that needs to act gets an immediate notification,
  // not just the general progress group (STAGE_TRANSITION_GROUP_CHAT_ID)
  if (isDashboardOrigin(body.updated_by)) {
    const stageToGroup: Record<string, string | null> = {
      production_pending: PRODUCTION_CHAT_ID,
      production_confirmed: PRODUCTION_CHAT_ID,
      en_route: PRODUCTION_CHAT_ID,
      inventory_verification: DELIVERY_CHAT_ID,
      inventory_arrived: DELIVERY_CHAT_ID,
      balance_due: COLLECTION_CHAT_ID,
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
      setImmediate(() => {
        notifyGroupChat(
          targetChatId,
          `📋 <b>Stage Update (Dashboard)</b>\n\n` +
          `Quotation: <b>${body.quotation_number}</b>\n` +
          `Client: ${order?.client_name ?? 'N/A'}\n` +
          `Stage: <b>${stageLabel}</b>\n` +
          `Status: ${body.status}\n` +
          `Remarks: ${body.remarks ?? '-'}\n\n` +
          `Updated via dashboard. Please check and take necessary action.`
        );
      });
    }
  }

  return { ok: true };
});

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

    const orders = await query(`SELECT id, current_stage, quotation_number, client_name, sales_agent, total_amount FROM orders WHERE quotation_number=$1`, [body.quotation_number]);
    if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });

    const orderId = orders[0].id;
    const quotationNumber = orders[0].quotation_number;
    const clientName = orders[0].client_name;
    const salesAgent = orders[0].sales_agent;
    const totalAmount = orders[0].total_amount;

    // Update deposit fields.
    // deposit_paid=TRUE but deposit_verified=FALSE — collection agent will remind team to verify.
    // Stage advances to deposit_verification until the downpayment is verified.
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
      [body.amount, body.image_url ?? null, orderId, body.deposit_paid_at ?? null]
    );

    // Record stage update for deposit_pending → deposit_paid
    await query(
      `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by) VALUES ($1, $2, $3, $4, $5)`,
      [orderId, 'deposit_pending', 'deposit_paid', `Downpayment of ₱${body.amount} recorded`, body.updated_by ?? null]
    );
    await query(
      `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by) VALUES ($1, $2, $3, $4, $5)`,
      [orderId, 'deposit_verification', 'pending', 'Downpayment recorded; awaiting payment verification', body.updated_by ?? null]
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
    triggerAgentsForStage('deposit_verification', quotationNumber, clientName);

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

      // Record the deposit. deposit_paid=TRUE but deposit_verified=FALSE.
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
        [body.amount, body.image_url ?? null, order.id, body.deposit_paid_at ?? null]
      );

      await query(
        `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
         VALUES ($1, 'deposit_pending', 'deposit_paid', $2, 'telegram_bot')`,
        [order.id, `Downpayment of ₱${body.amount.toLocaleString()} recorded via deposit slip matching`]
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
      triggerAgentsForStage('deposit_verification', order.quotation_number, order.client_name);

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

      // Record the deposit. deposit_paid=TRUE but deposit_verified=FALSE.
      // Stage advances to deposit_verification until the downpayment is verified.
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
        [body.amount, body.image_url ?? null, order.id, body.deposit_paid_at ?? null]
      );

      await query(
        `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
         VALUES ($1, 'deposit_pending', 'deposit_paid', $2, 'telegram_bot')`,
        [order.id, `Downpayment of ₱${body.amount.toLocaleString()} recorded via deposit slip matching`]
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
      triggerAgentsForStage('deposit_verification', order.quotation_number, order.client_name);

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
    if (order.balance_paid) {
      return reply.code(400).send({ error: 'Balance already paid for this order' });
    }

    if (!order.deposit_paid) {
      return reply.code(400).send({ error: 'Deposit must be paid before balance payment can be processed. Please record the deposit first using /deposit.' });
    }

    if (order.total_amount == null) {
      return reply.code(400).send({ error: 'Total amount not set for this order. Cannot compute balance.' });
    }

    const totalAmount = Number(order.total_amount);
    const depositAmount = Number(order.deposit_amount ?? 0);
    const expectedBalance = totalAmount - depositAmount;

    if (body.amount < expectedBalance) {
      return reply.code(400).send({
        error: `Insufficient payment. Expected balance: ₱${expectedBalance.toLocaleString()}, received: ₱${body.amount.toLocaleString()}`,
        expected_balance: expectedBalance,
        lacking_amount: expectedBalance - body.amount,
      });
    }

    const orderId = order.id;
    const overpayment = body.amount - expectedBalance;

    // Update balance fields on the order.
    // balance_paid=TRUE but balance_verified=FALSE — collection agent will remind team to verify.
    // Stage does NOT advance to payment_received until balance is verified.
    await query(
      `UPDATE orders SET
         balance_paid=TRUE,
         balance_verified=FALSE,
         balance_paid_at=COALESCE($2, NOW()),
         current_stage=CASE
           WHEN current_stage IN ('balance_due', 'inventory_arrived', 'delivery_scheduled')
           THEN 'balance_verification'
           ELSE current_stage
         END,
         updated_at=NOW()
       WHERE id=$1`,
      [orderId, body.payment_date ?? null]
    );

    // Record stage update — balance paid → balance_verification
    const remarks = overpayment > 0
      ? `Balance of ₱${body.amount.toLocaleString()} paid (overpayment of ₱${overpayment.toLocaleString()})`
      : `Balance of ₱${body.amount.toLocaleString()} paid`;
    await query(
      `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by) VALUES ($1, $2, $3, $4, $5)`,
      [orderId, 'balance_verification', 'balance_paid', remarks, body.updated_by ?? null]
    );

    // Complete any balance_due reminders for this order
    await query(
      `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage IN ('balance_due', 'inventory_arrived') AND status='active'`,
      [orderId]
    );

    // Create a balance_verification reminder — collection agent will remind team to verify the balance payment (best-effort)
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
    triggerAgentsForStage('balance_verification', body.quotation_number, order.client_name);

    // Notify collection group immediately — balance payment recorded, needs verification
    setImmediate(() => {
      notifyGroupChat(
        COLLECTION_CHAT_ID,
        `💳 <b>Balance Payment Recorded — Needs Verification</b>\n\n` +
        `Quotation: <b>${body.quotation_number}</b>\n` +
        `Client: ${order.client_name ?? 'N/A'}\n` +
        `Amount paid: PHP ${body.amount.toLocaleString()}\n` +
        `Expected balance: PHP ${expectedBalance.toLocaleString()}\n` +
        (overpayment > 0 ? `Overpayment: PHP ${overpayment.toLocaleString()}\n` : '') +
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
        `Quotation: *${body.quotation_number}*\nAmount: PHP ${body.amount.toLocaleString()}\nExpected balance: PHP ${expectedBalance.toLocaleString()}\nOverpayment: PHP ${overpayment.toLocaleString()}`,
        userEmail,
      );
    }

    return reply.send({
      ok: true,
      quotation_number: body.quotation_number,
      amount: body.amount,
      expected_balance: expectedBalance,
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
    `SELECT id, quotation_number, client_name, current_stage, deposit_paid, deposit_verified
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

  if (!['deposit_pending', 'deposit_verification'].includes(order.current_stage)) {
    return reply.code(400).send({
      error: `Deposit can only be verified from deposit_pending or deposit_verification. Current stage: ${order.current_stage}.`,
      current_stage: order.current_stage,
    });
  }

  const nextStage = 'purchasing_pending';

  await query(
    `UPDATE orders SET
       deposit_verified = TRUE,
       deposit_verified_at = NOW(),
       deposit_verified_by = $2,
       current_stage = $3,
       updated_at = NOW()
     WHERE id = $1`,
    [id, body.verified_by ?? null, nextStage],
  );

  // Record stage updates
  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'deposit_verification', 'deposit_verified', $2, $3)`,
    [id, `Deposit verified by ${body.verified_by ?? 'team'}. Advancing to ${nextStage}.`, body.verified_by ?? null],
  );
  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'purchasing_pending', 'ready', 'Downpayment verified; ready for purchasing/production preparation.', $2)`,
    [id, body.verified_by ?? null],
  );

  // Complete deposit_verification reminders
  await query(
    `UPDATE reminders SET status='completed', updated_at=NOW()
     WHERE order_id = $1 AND stage = 'deposit_verification' AND status = 'active'`,
    [id],
  );


  // Notify purchasing agent immediately that deposit is verified and order is ready for purchasing
  triggerAgentsForStage(nextStage, order.quotation_number, order.client_name);

  // Notify collection group immediately — deposit verified, advancing to production
  setImmediate(() => {
    notifyGroupChat(
      COLLECTION_CHAT_ID,
      `✅ <b>Deposit Verified</b>\n\n` +
      `Quotation: <b>${order.quotation_number}</b>\n` +
      `Client: ${order.client_name ?? 'N/A'}\n` +
      `Verified by: ${body.verified_by ?? 'team'}\n` +
      `Next stage: <b>Purchasing Pending</b>\n\n` +
      `Deposit has been verified on the dashboard.`
    );
  });

  // Notify production group — ask if production workflow has started
  // The deposit is now verified, so the production gate is cleared.
  setImmediate(() => {
    const prodGroupChatId = process.env.PRODUCTION_GROUP_CHAT_ID;
    if (prodGroupChatId && _TELEGRAM_BOT_TOKEN) {
      notifyGroupChatWithButtons(
        prodGroupChatId,
        `💰 <b>Downpayment Verified</b>\n\n` +
        `Quotation: <b>${order.quotation_number}</b>\n` +
        `Client: ${order.client_name ?? 'N/A'}\n\n` +
        `The client has made the downpayment and the deposit is now verified.\n\n` +
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

  // Notify escalation group about deposit verification (dashboard only)
  if (isDashboardOrigin(body.verified_by)) {
    await notifyManualChange(
      'Deposit verified',
      `Quotation: *${order.quotation_number ?? 'N/A'}*\nClient: *${order.client_name ?? 'Unknown'}*\nVerified by: ${body.verified_by ?? 'team'}\nNext stage: Purchasing Pending`,
      userEmail,
    );
  }

  // Create/update the purchasing_pending reminder to point to the production group.
  // The production team needs daily reminders to start the workflow — not just the one-time notification above.
  // Uses upsertStageReminder so existing reminders created with the wrong group are corrected.
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

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`, 'calendar:*', 'sales:*']);

  return reply.send({ ok: true, quotation_number: order.quotation_number, next_stage: nextStage });
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
    : 'delivery_pending';

  const stageLabel = nextStage === 'payment_received' ? 'Payment Received' : 'Delivery Pending';

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

  // Notify the relevant agent immediately
  triggerAgentsForStage(nextStage, order.quotation_number, order.client_name);

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
        `INSERT INTO inventory_drafts (product_name, description, dimension, quantity, source_type, source_filename, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [productName, description ?? null, dimension ?? null, isNaN(quantity as number) ? null : quantity, 'csv', body.original_filename, 'pending']
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
            `INSERT INTO inventory_drafts (product_name, description, dimension, quantity, source_type, source_filename, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [
              item.product_name ?? null,
              item.description ?? null,
              item.dimension ?? null,
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
import { resolve, join } from 'path';

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
