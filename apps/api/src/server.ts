import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { query } from './db.js';
import { createClient } from 'redis';
import { randomUUID, randomInt } from 'crypto';
import nodemailer from 'nodemailer';
import {
  uploadToDrive,
  createDriveFolder,
  getOrCreateFolder,
  getOrCreateMonthFolder,
  getOrCreateClientFolder,
  deleteDriveFile,
} from './services/googleDrive.js';
import {
  autoExtract,
  extractQuotation,
  extractPayment,
} from './services/geminiVision.js';
import {
  processDueReminders,
  createStageReminder,
  completeOrderReminders,
  startReminderScheduler,
} from './services/reminderScheduler.js';
import { checkQuotation } from './agents/quotationChecker.js';
import { checkPurchasing } from './agents/purchasingAgent.js';
import { checkInventory } from './agents/inventoryAgent.js';
import { checkScheduledDelivery, checkDelivered } from './agents/deliveryAgent.js';
import { checkCollection } from './agents/collectionAgent.js';
import { checkEscalation } from './agents/escalationAgent.js';
import {
  startAgentScheduler,
  runAgentByName,
  listAgents,
  getAgentHealth,
} from './services/agentScheduler.js';

const app = Fastify({ logger: true });
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

// ── Email (OTP) ──────────────────────────────────────────────────────
const smtpTransporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
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
  try {
    await smtpTransporter.sendMail({
      from: `"Quotation System" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Your login OTP',
      text: `Your one-time login code is: ${otp}\n\nIt expires in 5 minutes.`,
      html: `<p>Your one-time login code is:</p><h2 style="letter-spacing:4px">${otp}</h2><p>It expires in 5 minutes.</p>`,
    });
  } catch (err) {
    console.error('[otp] Failed to send email:', err);
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

// ── Orders ──────────────────────────────────────────────────────────

const createOrderSchema = z.object({
  quotation_number: z.string().optional(),
  client_name: z.string().optional(),
  sales_agent: z.string().optional(),
  total_amount: z.number().optional(),
});

app.post('/orders', async (request, reply) => {
  const body = createOrderSchema.parse(request.body);
  const rows = await query(
    `INSERT INTO orders (quotation_number, client_name, sales_agent, total_amount)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (quotation_number) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [body.quotation_number ?? null, body.client_name ?? null, body.sales_agent ?? null, body.total_amount ?? null]
  );
  // Invalidate caches after write
  await invalidateCache(['dashboard:*', 'orders:*']);
  return reply.send(rows[0]);
});

app.get('/orders', async () => {
  const cached = await cacheGet<object[]>('orders:all');
  if (cached) return cached;
  const rows = await query(
    `SELECT id, quotation_number, client_name, sales_agent, total_amount, computed_amount, math_status, current_stage, status, deposit_paid, deposit_amount, balance_paid, google_drive_folder_id, created_at, updated_at
     FROM orders ORDER BY created_at DESC LIMIT 100`
  );
  await cacheSet('orders:all', rows);
  return rows;
});

app.get('/orders/pending', async () => {
  const cached = await cacheGet<object[]>('orders:pending');
  if (cached) return cached;
  const rows = await query(
    `SELECT id, quotation_number, client_name, sales_agent, total_amount, computed_amount, math_status, current_stage, status, deposit_paid, deposit_amount, balance_paid, google_drive_folder_id, created_at, updated_at
     FROM orders WHERE status='active' ORDER BY created_at DESC LIMIT 50`
  );
  await cacheSet('orders:pending', rows);
  return rows;
});

app.get('/orders/stage/:stage', async (request, reply) => {
  const params = z.object({ stage: z.string() }).parse(request.params);
  const cacheKey = `orders:stage:${params.stage}`;
  const cached = await cacheGet<object[]>(cacheKey);
  if (cached) return cached;
  const rows = await query(
    `SELECT id, quotation_number, client_name, sales_agent, total_amount, computed_amount, math_status, current_stage, status, deposit_paid, deposit_amount, balance_paid, google_drive_folder_id, created_at, updated_at
     FROM orders WHERE current_stage=$1 ORDER BY created_at DESC`, [params.stage]
  );
  await cacheSet(cacheKey, rows);
  return rows;
});

app.get('/orders/:quotation_number', async (request, reply) => {
  const params = z.object({ quotation_number: z.string() }).parse(request.params);
  const cacheKey = `order:detail:${params.quotation_number}`;
  const cached = await cacheGet<object>(cacheKey);
  if (cached) return cached;
  const rows = await query(`SELECT * FROM orders WHERE quotation_number=$1`, [params.quotation_number]);
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

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`]);
  broadcastSSE('order_updated', { id: params.id });
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
  await query(`DELETE FROM order_files WHERE order_id=$1`, [params.id]);
  await query(`DELETE FROM reminders WHERE order_id=$1`, [params.id]);
  const rows = await query(`DELETE FROM orders WHERE id=$1 RETURNING *`, [params.id]);

  if (!rows[0]) return reply.code(404).send({ error: 'Order not found' });

  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:*`]);
  broadcastSSE('order_deleted', { id: params.id });
  return reply.send({ ok: true, deleted: rows[0] });
});

// ── Stage Updates ───────────────────────────────────────────────────

const stageUpdateSchema = z.object({
  quotation_number: z.string(),
  stage: z.string(),
  status: z.string(),
  remarks: z.string().optional(),
  updated_by: z.string().optional(),
});

app.post('/stage-updates', async (request, reply) => {
  const body = stageUpdateSchema.parse(request.body);
  const orders = await query(`SELECT id, total_amount, deposit_amount, balance_paid, current_stage FROM orders WHERE quotation_number=$1`, [body.quotation_number]);
  if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });

  const order = orders[0];

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
  const previousStage = order.current_stage;

  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by) VALUES ($1,$2,$3,$4,$5)`,
    [orderId, body.stage, body.status, body.remarks ?? null, body.updated_by ?? null]
  );
  await query(`UPDATE orders SET current_stage=$1, updated_at=NOW() WHERE id=$2`, [body.stage, orderId]);

  // Auto-complete reminders for the previous stage when moving forward
  if (previousStage && previousStage !== body.stage) {
    await query(
      `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage=$2 AND status='active'`,
      [orderId, previousStage]
    );
  }

  // Invalidate caches after stage update
  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${body.quotation_number}`]);
  return { ok: true };
});

// ── Deposits ──────────────────────────────────────────────────────────

const depositSchema = z.object({
  quotation_number: z.string(),
  amount: z.number().positive(),
  image_url: z.string().optional(),
  updated_by: z.string().optional(),
});

/**
 * POST /deposits
 * Record a deposit payment for an order.
 * Updates deposit_paid, deposit_amount, deposit_image_url on the order
 * and creates a stage update for deposit_pending → deposit_paid.
 */
app.post('/deposits', async (request, reply) => {
  const body = depositSchema.parse(request.body);
  const orders = await query(`SELECT id, current_stage, quotation_number FROM orders WHERE quotation_number=$1`, [body.quotation_number]);
  if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });

  const orderId = orders[0].id;
  const quotationNumber = orders[0].quotation_number;

  // Update deposit fields on the order
  await query(
    `UPDATE orders SET deposit_paid=TRUE, deposit_amount=$1, deposit_image_url=COALESCE($2, deposit_image_url), updated_at=NOW() WHERE id=$3`,
    [body.amount, body.image_url ?? null, orderId]
  );

  // Record stage update for deposit_pending → deposit_paid
  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by) VALUES ($1, $2, $3, $4, $5)`,
    [orderId, 'deposit_pending', 'deposit_paid', `Deposit of ₱${body.amount} recorded`, body.updated_by ?? null]
  );

  // Complete any deposit reminders for this order
  await query(
    `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage='deposit_pending' AND status='active'`,
    [orderId]
  );

  // Auto-create a balance_due reminder since balance is now due
  await query(
    `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
     SELECT $1, 'balance_due', r.group_chat_id,
            'The remaining balance is due before delivery can proceed.',
            'daily', NOW() + INTERVAL '1 hour', 'active'
     FROM reminders r
     WHERE r.order_id = $1 AND r.stage = 'deposit_pending' AND r.status = 'completed'
     LIMIT 1
     ON CONFLICT DO NOTHING`,
    [orderId]
  );

  // Invalidate caches
  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${body.quotation_number}`]);

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
});

app.post('/deposits/match-and-record', async (request, reply) => {
  const body = matchDepositSchema.parse(request.body);

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

    // Record the deposit
    await query(
      `UPDATE orders SET deposit_paid=TRUE, deposit_amount=$1, updated_at=NOW() WHERE id=$2`,
      [body.amount, order.id]
    );

    await query(
      `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
       VALUES ($1, 'deposit_pending', 'deposit_paid', $2, 'telegram_bot')`,
      [order.id, `Deposit of ₱${body.amount.toLocaleString()} recorded via deposit slip matching`]
    );

    // Complete any deposit reminders
    await query(
      `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage='deposit_pending' AND status='active'`,
      [order.id]
    );

    await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${order.quotation_number}`]);

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

// ── Pay Balance ──────────────────────────────────────────────────────

const payBalanceSchema = z.object({
  quotation_number: z.string(),
  amount: z.number().positive(),
  updated_by: z.string().optional(),
});

app.post('/pay-balance', async (request, reply) => {
  const body = payBalanceSchema.parse(request.body);
  const orders = await query(
    `SELECT id, total_amount, deposit_amount, deposit_paid, balance_paid FROM orders WHERE quotation_number=$1`,
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

  // Update balance fields on the order
  await query(
    `UPDATE orders SET balance_paid=TRUE, balance_paid_at=NOW(), updated_at=NOW() WHERE id=$1`,
    [orderId]
  );

  // Record stage update
  const remarks = overpayment > 0
    ? `Balance of ₱${body.amount.toLocaleString()} paid (overpayment of ₱${overpayment.toLocaleString()})`
    : `Balance of ₱${body.amount.toLocaleString()} paid`;
  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by) VALUES ($1, $2, $3, $4, $5)`,
    [orderId, 'balance_due', 'balance_paid', remarks, body.updated_by ?? null]
  );

  // Complete any balance reminders for this order
  await query(
    `UPDATE reminders SET status='completed', updated_at=NOW() WHERE order_id=$1 AND stage='balance_due' AND status='active'`,
    [orderId]
  );

  // Invalidate caches
  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${body.quotation_number}`]);

  return reply.send({
    ok: true,
    quotation_number: body.quotation_number,
    amount: body.amount,
    expected_balance: expectedBalance,
    overpayment: overpayment,
  });
});

app.get('/orders/:order_id/stage-updates', async (request, reply) => {
  const params = z.object({ order_id: z.string() }).parse(request.params);
  return query(`SELECT * FROM stage_updates WHERE order_id=$1 ORDER BY created_at DESC`, [params.order_id]);
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
  let result;
  if (order.current_stage === 'delivery_scheduled') {
    result = await checkScheduledDelivery(order);
  } else if (order.current_stage === 'delivered') {
    result = await checkDelivered(order);
  } else {
    result = await checkScheduledDelivery(order);
  }
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
    `SELECT id, quotation_number, client_name, sales_agent, total_amount, computed_amount, math_status, current_stage, status, deposit_paid, deposit_amount, balance_paid, google_drive_folder_id, created_at, updated_at
     FROM orders ORDER BY created_at DESC LIMIT 10`
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

// ── Google Drive ─────────────────────────────────────────────────────

const fileUploadSchema = z.object({
  order_id: z.string().uuid().optional(),
  quotation_number: z.string().optional(),
  file_type: z.string(),
  original_filename: z.string(),
  mime_type: z.string(),
  file_data: z.string(), // base64-encoded file content
  folder_id: z.string().optional(), // override parent folder
});

/**
 * POST /drive/upload
 * Upload a file (base64) to Google Drive using hierarchical folder structure:
 *   Root → YYYY-MM (month) → ClientName - QTN-XXXX (client/project) → files
 * Stores reference in DB and links folder to order.
 */
app.post('/drive/upload', async (request, reply) => {
  const body = fileUploadSchema.parse(request.body);
  const fileBuffer = Buffer.from(body.file_data, 'base64');

  // Determine target folder: explicit folder_id overrides auto-organization
  let targetFolderId = body.folder_id;

  // If quotation_number provided, use hierarchical folder structure
  if (body.quotation_number && !targetFolderId) {
    const orders = await query(
      `SELECT id, client_name, google_drive_folder_id FROM orders WHERE quotation_number=$1`,
      [body.quotation_number]
    );
    if (orders[0]) {
      if (orders[0].google_drive_folder_id) {
        // Client folder already exists — use it directly
        targetFolderId = orders[0].google_drive_folder_id;
      } else {
        // Build hierarchy: Root → YYYY-MM → ClientName - QTN-XXXX
        const clientName = orders[0].client_name ?? 'Unknown Client';
        const monthFolder = await getOrCreateMonthFolder();
        const clientFolder = await getOrCreateClientFolder(
          clientName,
          body.quotation_number,
          monthFolder.id
        );
        targetFolderId = clientFolder.id;

        // Store the client folder ID on the order for future uploads
        await query(`UPDATE orders SET google_drive_folder_id=$1 WHERE id=$2`, [
          clientFolder.id,
          orders[0].id,
        ]);
      }
    }
  }

  // Upload to Drive
  const result = await uploadToDrive(
    fileBuffer,
    body.original_filename,
    body.mime_type,
    targetFolderId
  );

  // Store file reference in DB
  const fileRecord = await query(
    `INSERT INTO files (order_id, file_type, original_filename, google_drive_file_id, file_url)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      body.order_id ?? null,
      body.file_type,
      body.original_filename,
      result.fileId,
      result.webViewLink,
    ]
  );

  return reply.send({
    ok: true,
    file: fileRecord[0],
    drive: result,
  });
});

/**
 * POST /drive/folder
 * Create a folder for an order using hierarchical structure:
 *   Root → YYYY-MM (month) → ClientName - QTN-XXXX (client/project)
 */
app.post('/drive/folder', async (request, reply) => {
  const body = z
    .object({
      quotation_number: z.string(),
      folder_name: z.string().optional(),
    })
    .parse(request.body);

  // Look up order to get client name
  const orders = await query(
    `SELECT id, client_name, google_drive_folder_id FROM orders WHERE quotation_number=$1`,
    [body.quotation_number]
  );
  if (!orders[0]) {
    return reply.code(404).send({ error: 'Order not found' });
  }

  // If folder already exists, return it
  if (orders[0].google_drive_folder_id) {
    return reply.send({ ok: true, folder: { id: orders[0].google_drive_folder_id } });
  }

  // Build hierarchy: Root → YYYY-MM → ClientName - QTN-XXXX
  const clientName = orders[0].client_name ?? 'Unknown Client';
  const monthFolder = await getOrCreateMonthFolder();
  const clientFolder = await getOrCreateClientFolder(
    clientName,
    body.quotation_number,
    monthFolder.id
  );

  // Link folder to order
  await query(`UPDATE orders SET google_drive_folder_id=$1 WHERE quotation_number=$2`, [
    clientFolder.id,
    body.quotation_number,
  ]);

  return reply.send({ ok: true, folder: clientFolder });
});

/**
 * DELETE /drive/files/:fileId
 * Delete a file from Google Drive and optionally from DB.
 */
app.delete('/drive/files/:fileId', async (request, reply) => {
  const params = z.object({ fileId: z.string() }).parse(request.params);
  await deleteDriveFile(params.fileId);

  // Also remove from files table if linked
  await query(`DELETE FROM files WHERE google_drive_file_id=$1`, [params.fileId]);

  return reply.send({ ok: true });
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
      frequency: z.enum(['hourly', 'daily']).default('daily'),
    })
    .parse(request.body);

  await createStageReminder(body.order_id, body.stage, body.group_chat_id, body.message, body.frequency);
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

  const allEvents = [
    ...orderEvents.map((e: any) => ({ ...e, color: '#3b82f6' })),      // blue
    ...stageEvents.map((e: any) => ({ ...e, color: '#8b5cf6' })),      // purple
    ...reminderEvents.map((e: any) => ({ ...e, color: '#ef4444' })),   // red
    ...deliveryEvents.map((e: any) => ({ ...e, color: '#f97316' })),   // orange
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
            math_status, current_stage, status, deposit_paid, deposit_amount, balance_paid,
            google_drive_folder_id, created_at, updated_at
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

// ── SSE Endpoint ────────────────────────────────────────────────────
// Dashboard clients connect here for real-time cache invalidation events
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

// ── Start ───────────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 8080);

// Start the reminder scheduler (checks every 60 seconds)
const REMINDER_INTERVAL_MS = Number(process.env.REMINDER_INTERVAL_MS ?? 60_000);
startReminderScheduler(REMINDER_INTERVAL_MS);

// Start the agent scheduler (checks every 60 seconds for due agents)
const AGENT_CHECK_INTERVAL_MS = Number(process.env.AGENT_CHECK_INTERVAL_MS ?? 60_000);
startAgentScheduler(AGENT_CHECK_INTERVAL_MS);

await app.listen({ port, host: '0.0.0.0' });
