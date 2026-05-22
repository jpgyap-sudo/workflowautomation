import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { query } from './db.js';
import { createClient } from 'redis';
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
  o.created_at, o.updated_at
`;

const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });
await app.register(cors, { origin: true });

// ── Redis Cache ──────────────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL ?? 'redis://redis:6379';
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS ?? 15); // Reduced from 30 to 15

let cacheClient: Awaited<ReturnType<typeof createClient>> | null = null;
try {
  cacheClient = createClient({ url: REDIS_URL });
  cacheClient.on('error', (err) => console.warn('[cache] Redis error (non-fatal):', err.message));
  await cacheClient.connect();
  console.log('[cache] Redis connected');
} catch (err) {
  console.warn('[cache] Redis unavailable — running without cache');
}

async function cacheGet<T>(key: string): Promise<T | null> {
  if (!cacheClient?.isOpen) return null;
  try {
    const raw = await cacheClient.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function cacheSet(key: string, data: unknown, ttl = CACHE_TTL_SECONDS): Promise<void> {
  if (!cacheClient?.isOpen) return;
  try {
    await cacheClient.setEx(key, ttl, JSON.stringify(data));
  } catch { /* ignore */ }
}

// ── SSE (Server-Sent Events) ────────────────────────────────────────
// Connected dashboard clients get real-time invalidation events
const sseClients = new Set<{ id: string; write: (data: string) => void }>();

function broadcastSSE(event: string, data: unknown): void {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
}

// ── Cache Invalidation Helper ───────────────────────────────────────
async function invalidateCache(patterns: string[]): Promise<void> {
  if (!cacheClient?.isOpen) return;
  try {
    for (const pattern of patterns) {
      const keys = await cacheClient.keys(pattern);
      if (keys.length > 0) await cacheClient.del(keys);
    }
  } catch { /* ignore */ }

  // Also notify SSE clients so they can revalidate SWR caches
  broadcastSSE('invalidate', { keys: patterns });
}

// ── Telegram: Manual Change Notifications ──────────────────────────
const _TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ESCALATION_CHAT_ID = process.env.ESCALATION_GROUP_CHAT_ID ?? null;

async function notifyManualChange(action: string, details: string): Promise<void> {
  if (!_TELEGRAM_BOT_TOKEN || !ESCALATION_CHAT_ID) return;
  const msg = `🔔 <b>Dashboard Manual Change</b>\n\n${action}\n\n${details}`;
  try {
    await fetch(`https://api.telegram.org/bot${_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: ESCALATION_CHAT_ID, text: msg, parse_mode: 'HTML' }),
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

function isDashboardQuickAction(updatedBy?: string | null): boolean {
  return updatedBy === 'dashboard_quick_action';
}

// ── Instant Agent Triggers ─────────────────────────────────────────────
// When an order moves to a new stage, fire the relevant agent(s) immediately
// so Telegram group chats get notified now, not on the next hourly scheduler tick.

const AGENT_TRIGGER_MAP: Record<string, string[]> = {
  // Purchasing → Production
  production_pending:    ['purchasing-agent'],
  production_confirmed:  ['production-agent'],
  // Production → En Route
  en_route:              ['production-agent', 'inventory-agent'],
  // En Route → Inventory
  inventory_arrived:     ['inventory-agent'],
  // Inventory → Balance Due
  balance_due:           ['collection-agent', 'delivery-agent'],
  // Delivery
  delivery_scheduled:    ['delivery-agent'],
  delivered:             ['collection-agent'],
  countered:             ['collection-agent'],
  // Payment
  payment_received:      ['collection-agent'],
  payment_confirmed:     ['collection-agent'],
  // Deposit recorded (not a stage, but triggers collection agent)
  deposit_pending:       ['collection-agent'],
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
      subject: 'Your login OTP',
      text: `Your one-time login code is: ${otp}\n\nIt expires in 5 minutes.`,
      html: `<p>Your one-time login code is:</p><h2 style="letter-spacing:4px">${otp}</h2><p>It expires in 5 minutes.</p>`,
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
  // Generate a short-lived action token (valid for 2 minutes)
  const actionToken = randomUUID();
  await cacheClient.setEx(`action_token:${actionToken}`, 120, JSON.stringify({ email: email.toLowerCase(), verified: true }));
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
});

app.post('/orders', async (request, reply) => {
  const body = createOrderSchema.parse(request.body);
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

  // Invalidate caches after write
  await invalidateCache(['dashboard:*', 'orders:*', 'calendar:*', 'sales:*']);
  return reply.send(rows[0]);
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
  await cacheSet(cacheKey, rows[0]);
  return rows[0];
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
  action_token: z.string(),
});

app.patch('/orders/:id', async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = updateOrderSchema.parse(request.body);

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

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id: params.id });

  const updatedFields = Object.keys(body).filter((k) => k !== 'action_token').join(', ');
  await notifyManualChange(
    `✏️ Order edited via dashboard`,
    `Quotation: *${rows[0].quotation_number ?? params.id}*\nClient: ${rows[0].client_name ?? '—'}\nFields changed: ${updatedFields}`,
  );

  return reply.send(rows[0]);
});

// ── Delete Order (requires action token) ────────────────────────────
app.delete('/orders/:id', async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
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
  );

  return reply.send({ ok: true, deleted: rows[0] });
});

// ── Bulk Delete Orders (requires action token) ──────────────────────
app.post('/orders/bulk-delete', async (request, reply) => {
  const body = z.object({
    ids: z.array(z.string()).min(1).max(100),
    action_token: z.string(),
  }).parse(request.body);

  // Verify action token once
  if (!cacheClient?.isOpen) {
    return reply.status(503).send({ error: 'Action verification unavailable' });
  }
  const tokenKey = `action_token:${body.action_token}`;
  const tokenData = await cacheClient.get(tokenKey);
  if (!tokenData) {
    return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
  }
  await cacheClient.del(tokenKey);

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
  );

  return reply.send({ ok: true, deleted: rows.length });
});

// ── Production Tracking ─────────────────────────────────────────────

const setProductionSchema = z.object({
  production_started: z.boolean(),
  estimated_production_days: z.number().int().positive().optional(),
});

app.post('/orders/:id/set-production', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = setProductionSchema.parse(request.body);

  const existingRows = await query(
    `SELECT id, quotation_number, current_stage FROM orders WHERE id = $1`,
    [id]
  );
  if (!existingRows[0]) return reply.code(404).send({ error: 'Order not found' });
  const previousStage = existingRows[0].current_stage;

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
    const groupChatId = process.env.PURCHASING_GROUP_ID;
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
         `*Production Due* - ${ref} (${client})\nEstimated production of ${body.estimated_production_days} days should be complete now.\nIs production finished?`,
         finishDate.toISOString()]
      );
    }
  }

  // Notify production agent immediately that production has started
  if (body.production_started) {
    triggerAgentsForStage('production_confirmed', updatedOrder.quotation_number, updatedOrder.client_name);
  }

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${updatedOrder.quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });
  return reply.send({ ok: true, order: updatedOrder });
});

// ── Partial Production ───────────────────────────────────────────────

const partialProductionSchema = z.object({
  missing_items: z.array(z.string().min(1)).min(1),
});

app.post('/orders/:id/partial-production', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = partialProductionSchema.parse(request.body);

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
       ON CONFLICT (order_id, stage) DO UPDATE SET
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
});

app.post('/orders/:id/partial-production-items', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = updatePartialItemsSchema.parse(request.body);

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
});

app.post('/orders/:id/report-production-status', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = reportProductionStatusSchema.parse(request.body);

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

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${rows[0].quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });
  return reply.send({ ok: true, order: rows[0] });
});

const finishProductionSchema = z.object({
  delivery_estimated_days: z.number().int().positive(),
});

app.post('/orders/:id/finish-production', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = finishProductionSchema.parse(request.body);

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

  // Create en_route reminder for ALL orders (both legacy and item-level tracking)
  // The production agent's checkEnRoute/checkItemLevelEnRoute will also upsert this,
  // but creating it immediately ensures no gap between finish-production and the next agent run.
  const groupChatId = process.env.PURCHASING_GROUP_CHAT_ID;
  if (groupChatId) {
    const ref = rows[0].quotation_number ?? `Order #${id.slice(0, 8)}`;
    const client = rows[0].client_name ?? 'Unknown';
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
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
       tomorrow.toISOString()]
    );
  }

  // Notify production + inventory agents immediately that production is finished (order is en route)
  triggerAgentsForStage('en_route', rows[0].quotation_number, rows[0].client_name);

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${rows[0].quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });
  return reply.send({ ok: true, order: rows[0] });
});

// ── Confirm En Route ──────────────────────────────────────────────────
// After production is finished, the bot asks "Is the order en route?"
// If yes, this endpoint is called with estimated arrival days.
// The order moves from 'en_route' to 'inventory_arrived'.
const confirmEnRouteSchema = z.object({
  estimated_arrival_days: z.number().int().positive(),
});

app.post('/orders/:id/confirm-en-route', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = confirmEnRouteSchema.parse(request.body);

  const rows = await query(
    `UPDATE orders SET en_route_confirmed = TRUE, en_route_confirmed_at = NOW(),
     estimated_arrival_days = $1, current_stage = 'inventory_arrived', updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [body.estimated_arrival_days, id]
  );

  if (!rows[0]) return reply.code(404).send({ error: 'Order not found' });

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, 'inventory_arrived', 'en_route_confirmed', $2, 'system')`,
    [id, `En route confirmed; estimated arrival in ${body.estimated_arrival_days} day(s)`]
  );

  // Complete the en_route_reminder (legacy) and item_level_en_route (item-level tracking)
  await query(
    `UPDATE reminders SET status = 'completed', updated_at = NOW()
     WHERE order_id = $1 AND status = 'active' AND stage IN ('en_route_reminder', 'item_level_en_route')`,
    [id]
  );

  // Notify inventory agent immediately that the order has arrived
  triggerAgentsForStage('inventory_arrived', rows[0].quotation_number, rows[0].client_name);

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${rows[0].quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });
  return reply.send({ ok: true, order: rows[0] });
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

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { order_id });
  return reply.send({ ok: true, item: rows[0] });
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
const recalcProductionRemindersSchema = z.object({
  estimated_production_days: z.number().int().positive(),
});

app.post('/orders/:id/recalc-production-reminders', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = recalcProductionRemindersSchema.parse(request.body);

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

  const groupChatId = process.env.PURCHASING_GROUP_ID;
  if (!groupChatId) {
    return reply.status(500).send({ error: 'PURCHASING_GROUP_ID not configured' });
  }

  const ref = order.quotation_number ?? `Order #${id.slice(0, 8)}`;
  const client = order.client_name ?? 'Unknown';
  const productionStart = new Date(order.production_started_at);
  const finishDate = new Date(productionStart);
  finishDate.setDate(finishDate.getDate() + body.estimated_production_days);
  const midpointDays = Math.max(1, Math.floor(body.estimated_production_days / 2));
  const midpointDate = new Date(productionStart);
  midpointDate.setDate(midpointDate.getDate() + midpointDays);

  // Upsert midpoint reminder
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
     `*Production Due* - ${ref} (${client})\nEstimated production of ${body.estimated_production_days} days should be complete now.\nIs production finished?`,
     finishDate.toISOString()]
  );

  // Also update the estimated_production_days on the order
  await query(
    `UPDATE orders SET estimated_production_days = $1, updated_at = NOW() WHERE id = $2`,
    [body.estimated_production_days, id]
  );

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id });
  return reply.send({
    ok: true,
    message: `Production reminders recalculated for ${body.estimated_production_days} days`,
    midpoint_date: midpointDate.toISOString(),
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
  if (isDashboardQuickAction(body.updated_by) && !(await verifyActionTokenOrReply(body.action_token, reply))) return;
  const orders = await query(`SELECT id, total_amount, deposit_amount, balance_paid, current_stage FROM orders WHERE quotation_number=$1`, [body.quotation_number]);
  if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });

  const order = orders[0];

  // ── Workflow Guard: Valid Stage Transitions ──────────────────────────
  // Prevent invalid jumps (e.g., balance_due → payment_confirmed without delivery)
  const VALID_TRANSITIONS: Record<string, string[]> = {
    deposit_pending:           ['quotation_received', 'order_confirmation_received'],
    quotation_received:        ['order_confirmation_received', 'math_verified', 'production_pending'],
    order_confirmation_received: ['math_verified', 'production_pending'],
    math_verified:             ['purchasing_pending', 'production_pending'],
    purchasing_pending:        ['production_pending'],
    production_pending:        ['production_confirmed'],
    production_confirmed:      ['en_route', 'partial_production'],
    partial_production:        ['en_route'],
    en_route:                  ['inventory_arrived'],
    inventory_arrived:         ['balance_due'],
    balance_due:               ['delivery_scheduled', 'delivered', 'countered'],
    delivery_scheduled:        ['delivered', 'countered'],
    delivered:                 ['payment_received', 'payment_confirmed', 'completed'],
    countered:                 ['payment_received', 'payment_confirmed', 'completed'],
    payment_received:          ['payment_confirmed', 'completed'],
    payment_confirmed:         ['completed'],
  };

  const previousStage = order.current_stage;
  const targetStage = body.stage;

  // Allow transitions that are in the valid map, or if the stage hasn't changed
  if (previousStage !== targetStage) {
    const allowedNext = VALID_TRANSITIONS[previousStage];
    if (allowedNext && !allowedNext.includes(targetStage)) {
      return reply.code(400).send({
        error: `Invalid stage transition: cannot move from '${previousStage}' to '${targetStage}'. Allowed transitions: ${allowedNext.join(', ')}.`,
        current_stage: previousStage,
        allowed_stages: allowedNext,
      });
    }
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

  if (isDashboardQuickAction(body.updated_by)) {
    await notifyManualChange(
      'Quick Action: Stage updated',
      `Quotation: *${body.quotation_number}*\nStage: ${body.stage}\nStatus: ${body.status}\nRemarks: ${body.remarks ?? '-'}`,
    );
  }

  // Immediately fire the relevant agent so group chats are notified now, not on the next hourly tick
  triggerAgentsForStage(body.stage, body.quotation_number, order?.client_name ?? null);
  return { ok: true };
});

// ── Deposits ──────────────────────────────────────────────────────────

const depositSchema = z.object({
  quotation_number: z.string(),
  amount: z.number().positive(),
  image_url: z.string().optional(),
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
  const body = depositSchema.parse(request.body);
  if (isDashboardQuickAction(body.updated_by) && !(await verifyActionTokenOrReply(body.action_token, reply))) return;
  const orders = await query(`SELECT id, current_stage, quotation_number, client_name FROM orders WHERE quotation_number=$1`, [body.quotation_number]);
  if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });

  const orderId = orders[0].id;
  const quotationNumber = orders[0].quotation_number;
  const clientName = orders[0].client_name;

  // Update deposit fields.
  // deposit_paid=TRUE but deposit_verified=FALSE — collection agent will remind team to verify.
  // Stage advances to deposit_pending (not production_pending) until deposit is verified.
  await query(
    `UPDATE orders SET
       deposit_paid=TRUE,
       deposit_verified=FALSE,
       deposit_amount=$1,
       deposit_image_url=COALESCE($2, deposit_image_url),
       deposit_paid_at=COALESCE($4, deposit_paid_at),
       current_stage=CASE
         WHEN current_stage IN ('order_confirmation_received', 'math_verified')
         THEN 'deposit_pending'
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

  // Complete any deposit reminders for this order
  await query(
    `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage='deposit_pending' AND status='active'`,
    [orderId]
  );

  // Create a deposit_verification reminder — collection agent will remind team to verify the deposit
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

  // Notify collection agent immediately that a deposit needs verification
  triggerAgentsForStage('deposit_pending', quotationNumber, clientName);

  // Invalidate caches
  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${body.quotation_number}`, 'calendar:*', 'sales:*']);

  if (isDashboardQuickAction(body.updated_by)) {
    await notifyManualChange(
      'Quick Action: Downpayment recorded',
      `Quotation: *${quotationNumber ?? body.quotation_number}*\nAmount: PHP ${body.amount.toLocaleString()}\nDate: ${body.deposit_paid_at ?? 'now'}`,
    );
  }

  return reply.send({ ok: true, quotation_number: body.quotation_number, amount: body.amount });
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
  image_url: z.string().optional(),
  deposit_paid_at: z.string().optional(),
});

app.post('/deposits/match-and-record', async (request, reply) => {
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
           WHEN current_stage IN ('quotation_received', 'order_confirmation_received', 'math_verified')
           THEN 'deposit_pending'
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

    // Complete any deposit reminders
    await query(
      `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage='deposit_pending' AND status='active'`,
      [order.id]
    );

    // Create a deposit_verification reminder
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

    // Notify collection agent immediately that a deposit needs verification
    triggerAgentsForStage('deposit_pending', order.quotation_number, order.client_name);

    await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`, 'calendar:*', 'sales:*']);

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
    // Stage advances to deposit_pending (not purchasing_pending) until deposit is verified.
    await query(
      `UPDATE orders SET
         deposit_paid=TRUE,
         deposit_verified=FALSE,
         deposit_amount=$1,
         deposit_image_url=COALESCE($2, deposit_image_url),
         deposit_paid_at=COALESCE($4, deposit_paid_at),
         current_stage=CASE
           WHEN current_stage IN ('quotation_received', 'order_confirmation_received', 'math_verified')
           THEN 'deposit_pending'
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

    // Complete any deposit reminders
    await query(
      `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage='deposit_pending' AND status='active'`,
      [order.id]
    );

    // Create a deposit_verification reminder — collection agent will remind team to verify
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

    // Notify collection agent immediately that a deposit needs verification
    triggerAgentsForStage('deposit_pending', order.quotation_number, order.client_name);

    await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`, 'calendar:*', 'sales:*']);

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
});

// ── Pay Balance ──────────────────────────────────────────────────────

const payBalanceSchema = z.object({
  quotation_number: z.string(),
  amount: z.number().positive(),
  updated_by: z.string().optional(),
  action_token: z.string().optional(),
});

app.post('/pay-balance', async (request, reply) => {
  const body = payBalanceSchema.parse(request.body);
  if (isDashboardQuickAction(body.updated_by) && !(await verifyActionTokenOrReply(body.action_token, reply))) return;
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
       balance_paid_at=NOW(),
       current_stage=CASE
         WHEN current_stage IN ('balance_due', 'inventory_arrived', 'delivery_scheduled')
         THEN 'balance_verification'
         ELSE current_stage
       END,
       updated_at=NOW()
     WHERE id=$1`,
    [orderId]
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

  // Create a balance_verification reminder — collection agent will remind team to verify the balance payment
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

  // Notify collection agent immediately that balance needs verification
  triggerAgentsForStage('balance_due', body.quotation_number, order.client_name);

  // Invalidate caches
  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${body.quotation_number}`, 'calendar:*', 'sales:*']);

  if (isDashboardQuickAction(body.updated_by)) {
    await notifyManualChange(
      'Quick Action: Balance payment recorded',
      `Quotation: *${body.quotation_number}*\nAmount: PHP ${body.amount.toLocaleString()}\nExpected balance: PHP ${expectedBalance.toLocaleString()}\nOverpayment: PHP ${overpayment.toLocaleString()}`,
    );
  }

  return reply.send({
    ok: true,
    quotation_number: body.quotation_number,
    amount: body.amount,
    expected_balance: expectedBalance,
    overpayment: overpayment,
  });
});

// ── Verify Deposit ──────────────────────────────────────────────────────

/**
 * POST /orders/:id/verify-deposit
 *
 * Called by the team (via dashboard or API) to verify that a deposit payment
 * has gone through. Sets deposit_verified=TRUE and advances the stage:
 *   deposit_pending → production_pending (or purchasing_pending)
 * Completes the deposit_verification reminder and creates a production reminder.
 */
const verifyDepositSchema = z.object({
  verified_by: z.string().optional(),
});

app.post('/orders/:id/verify-deposit', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = verifyDepositSchema.parse(request.body);

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

  // Determine next stage based on whether the order needs purchasing
  // If the order is at any pre-production stage (quotation_received, deposit_pending, etc.),
  // advance to production_pending after deposit verification
  const preProductionStages = ['quotation_received', 'order_confirmation_received', 'math_verified', 'deposit_pending'];
  const nextStage = preProductionStages.includes(order.current_stage)
    ? 'production_pending'
    : order.current_stage;

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

  // Record stage update
  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
     VALUES ($1, $2, 'deposit_verified', $3, $4)`,
    [id, nextStage, `Deposit verified by ${body.verified_by ?? 'team'}. Advancing to ${nextStage}.`, body.verified_by ?? null],
  );

  // Complete deposit_verification reminders
  await query(
    `UPDATE reminders SET status='completed', updated_at=NOW()
     WHERE order_id = $1 AND stage = 'deposit_verification' AND status = 'active'`,
    [id],
  );

  // Create a production_pending reminder — production agent will remind the production group to start production
  // Uses the production group chat ID from the completed deposit_verification reminder
  await query(
    `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
     SELECT $1, 'production_pending', r.group_chat_id,
            'Deposit has been verified. Production should start now. Has production started for this order?',
            'daily', NOW() + INTERVAL '5 minutes', 'active'
     FROM reminders r
     WHERE r.order_id = $1 AND r.stage = 'deposit_verification' AND r.status = 'completed'
     LIMIT 1
     ON CONFLICT DO NOTHING`,
    [id],
  );

  // Notify purchasing agent immediately that deposit is verified and order needs production
  triggerAgentsForStage(nextStage, order.quotation_number, order.client_name);

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
});

app.post('/orders/:id/verify-balance', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = verifyBalanceSchema.parse(request.body);

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
  // - If order is at balance_due (not yet delivered) → advance to delivery_scheduled
  // - If order is at delivered/countered (already delivered) → advance to payment_received
  const currentStage = order.current_stage;
  const nextStage = (currentStage === 'delivered' || currentStage === 'countered')
    ? 'payment_received'
    : 'delivery_scheduled';

  const stageLabel = nextStage === 'payment_received' ? 'Payment Received' : 'Delivery Scheduled';

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

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`, 'calendar:*', 'sales:*']);

  return reply.send({ ok: true, quotation_number: order.quotation_number, next_stage: nextStage });
});

// ── Grant Delivery Exception (Special Case) ─────────────────────────
const deliveryExceptionSchema = z.object({
  order_id: z.string(),
  notes: z.string().optional(),
  granted_by: z.string().optional(),
});

app.post('/orders/delivery-exception', async (request, reply) => {
  const body = deliveryExceptionSchema.parse(request.body);

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

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`, 'calendar:*', 'sales:*']);
  broadcastSSE('order_updated', { id: body.order_id });
  return reply.send({ ok: true, order: rows[0] });
});

// ── Revoke Delivery Exception ───────────────────────────────────────
app.post('/orders/revoke-delivery-exception', async (request, reply) => {
  const body = z.object({ order_id: z.string() }).parse(request.body);

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

  const quotationNumber = fileRows[0].quotation_number;
  const FILE_STORE_URL = process.env.FILE_STORE_URL ?? 'http://file-store:8090';
  try {
    const res = await fetch(`${FILE_STORE_URL}/files/binary/${encodeURIComponent(quotationNumber)}`);
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
  }).parse(request.body);
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

  // Forward quotation text to file-store for Hermes agent reference
  if (body.file_type === 'quotation' && body.quotation_number && body.extracted_text) {
    try {
      await fetch(`${FILE_STORE_URL}/files/store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: body.order_id,
          quotation_number: body.quotation_number,
          extracted_text: body.extracted_text,
          file_type: body.file_type,
        }),
      });
    } catch (err) {
      console.error('[DriveUpload] Failed to store quotation text in file-store:', err);
    }
  }

  // Store binary file to file-store for dashboard viewing
  if (body.file_data && body.quotation_number) {
    try {
      const res = await fetch(`${FILE_STORE_URL}/files/store-binary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: body.order_id,
          quotation_number: body.quotation_number,
          file_data: body.file_data,
          mime_type: body.mime_type,
          original_filename: body.original_filename,
        }),
      });
      if (res.ok) {
        const result = await res.json() as { path?: string };
        localFilePath = result.path ?? null;
      }
    } catch (err) {
      console.error('[DriveUpload] Failed to store binary in file-store:', err);
    }
  }

  // Store file reference in DB
  const fileRecord = await query(
    `INSERT INTO files (order_id, file_type, original_filename, storage_backend, extracted_text, local_file_path, mime_type)
     VALUES ($1, $2, $3, 'local', $4, $5, $6)
     RETURNING *`,
    [
      body.order_id ?? null,
      body.file_type,
      body.original_filename,
      body.extracted_text ?? null,
      localFilePath,
      body.mime_type ?? null,
    ]
  );

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
       ON CONFLICT (order_id, stage) DO UPDATE SET
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
});

app.post('/calendar/notes', async (request, reply) => {
  const body = createNoteSchema.parse(request.body);
  const rows = await query(
    `INSERT INTO calendar_notes (note_date, title, content, color)
     VALUES ($1::date, $2, $3, $4)
     RETURNING *`,
    [body.note_date, body.title, body.content, body.color]
  );
  await invalidateCache(['calendar:*']);
  return reply.send(rows[0]);
});

const updateNoteSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(2000).optional(),
  color: z.string().optional(),
});

app.patch('/calendar/notes/:id', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = updateNoteSchema.parse(request.body);

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
  return reply.send(rows[0]);
});

app.delete('/calendar/notes/:id', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const rows = await query(`DELETE FROM calendar_notes WHERE id = $1 RETURNING id`, [params.id]);
  if (!rows[0]) return reply.code(404).send({ error: 'Note not found' });
  await invalidateCache(['calendar:*']);
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
  const rows = await query(
    `INSERT INTO clients (client_name, delivery_address, contact_number, authorized_receiver_name, authorized_receiver_contact, notes)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (client_name) DO UPDATE SET
       delivery_address = COALESCE(EXCLUDED.delivery_address, clients.delivery_address),
       contact_number = COALESCE(EXCLUDED.contact_number, clients.contact_number),
       authorized_receiver_name = COALESCE(EXCLUDED.authorized_receiver_name, clients.authorized_receiver_name),
       authorized_receiver_contact = COALESCE(EXCLUDED.authorized_receiver_contact, clients.authorized_receiver_contact),
       notes = COALESCE(EXCLUDED.notes, clients.notes),
       updated_at = NOW()
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

  if (body.action_token) {
    if (!cacheClient?.isOpen) return reply.status(503).send({ error: 'Action verification unavailable' });
    const tokenData = await cacheClient.get(`action_token:${body.action_token}`);
    if (!tokenData) return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    await cacheClient.del(`action_token:${body.action_token}`);
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
  );
  return reply.send(updated);
});

app.delete('/clients/:id', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const queryParams = z.object({ force: z.string().optional() }).parse(request.query);
  const body = (request.body ?? {}) as any;
  const force = queryParams.force === 'true' || queryParams.force === '1' || body.force === true;

  if (body.action_token) {
    if (!cacheClient?.isOpen) return reply.status(503).send({ error: 'Action verification unavailable' });
    const tokenData = await cacheClient.get(`action_token:${body.action_token}`);
    if (!tokenData) return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    await cacheClient.del(`action_token:${body.action_token}`);
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
  }).parse(request.body);

  const rows = await query(
    `INSERT INTO inventory_items (product_name, description, dimension, quantity, image_url, category)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [body.product_name, body.description ?? null, body.dimension ?? null, body.quantity, body.image_url ?? null, body.category ?? null]
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

  if (body.action_token) {
    if (!cacheClient?.isOpen) return reply.status(503).send({ error: 'Action verification unavailable' });
    const tokenData = await cacheClient.get(`action_token:${body.action_token}`);
    if (!tokenData) return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    await cacheClient.del(`action_token:${body.action_token}`);
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
  );
  return rows[0];
});

app.delete('/inventory/:id', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = (request.body ?? {}) as any;

  if (body.action_token) {
    if (!cacheClient?.isOpen) return reply.status(503).send({ error: 'Action verification unavailable' });
    const tokenData = await cacheClient.get(`action_token:${body.action_token}`);
    if (!tokenData) return reply.status(401).send({ error: 'Action token expired or invalid. Please verify OTP again.' });
    await cacheClient.del(`action_token:${body.action_token}`);
  }

  const rows = await query(`DELETE FROM inventory_items WHERE id=$1 RETURNING *`, [params.id]);
  if (!rows[0]) return reply.code(404).send({ error: 'Item not found' });
  await invalidateCache(['inventory:*', '/inventory']);
  broadcastSSE('inventory_deleted', { id: params.id });
  await notifyManualChange(
    `🗑️ Inventory item deleted via dashboard`,
    `Item: *${rows[0].product_name}*`,
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
  }).parse(request.body);

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
  const draftRows = await query(`SELECT * FROM inventory_drafts WHERE id=$1 AND status='pending'`, [params.id]);
  if (!draftRows[0]) return reply.code(404).send({ error: 'Draft not found or already processed' });
  const draft = draftRows[0];

  const itemRows = await query(
    `INSERT INTO inventory_items (product_name, description, dimension, quantity, image_url, category)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [draft.product_name, draft.description, draft.dimension, draft.quantity ?? 0, draft.image_url, draft.category]
  );
  await query(`UPDATE inventory_drafts SET status='approved', updated_at=NOW() WHERE id=$1`, [params.id]);
  await invalidateCache(['inventory:*', '/inventory', '/inventory/drafts']);
  broadcastSSE('inventory_updated', { id: itemRows[0].id });
  return { ok: true, item: itemRows[0] };
});

app.post('/inventory/drafts/approve-all', async (_request, reply) => {
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
  await invalidateCache(['inventory:*', '/inventory', '/inventory/drafts']);
  broadcastSSE('inventory_bulk_approved', { count: items.length });
  return { ok: true, approved_count: items.length, items };
});

app.delete('/inventory/drafts/:id', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  await query(`UPDATE inventory_drafts SET status='rejected', updated_at=NOW() WHERE id=$1`, [params.id]);
  await invalidateCache(['inventory:*', '/inventory/drafts']);
  return { ok: true };
});

app.post('/inventory/drafts/clear', async (_request, reply) => {
  await query(`DELETE FROM inventory_drafts WHERE status IN ('approved', 'rejected')`);
  await invalidateCache(['inventory:*', '/inventory/drafts']);
  return { ok: true };
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

  sseClients.add(client);
  console.log(`[sse] Client connected: ${clientId} (total: ${sseClients.size})`);

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
    sseClients.delete(client);
    console.log(`[sse] Client disconnected: ${clientId} (total: ${sseClients.size})`);
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
