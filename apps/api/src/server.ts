import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { query } from './db.js';
import { createClient } from 'redis';
import { randomUUID } from 'crypto';
import {
  uploadToDrive,
  createDriveFolder,
  getOrCreateFolder,
  deleteDriveFile,
} from './services/googleDrive.js';
import {
  processDueReminders,
  createStageReminder,
  completeOrderReminders,
  startReminderScheduler,
} from './services/reminderScheduler.js';

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

// ── Health ──────────────────────────────────────────────────────────
app.get('/health', async () => ({ ok: true, service: 'quotation-automation-api' }));

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
    `SELECT id, quotation_number, client_name, sales_agent, total_amount, computed_amount, math_status, current_stage, status, created_at, updated_at
     FROM orders ORDER BY created_at DESC LIMIT 100`
  );
  await cacheSet('orders:all', rows);
  return rows;
});

app.get('/orders/pending', async () => {
  const cached = await cacheGet<object[]>('orders:pending');
  if (cached) return cached;
  const rows = await query(
    `SELECT id, quotation_number, client_name, sales_agent, total_amount, computed_amount, math_status, current_stage, status, created_at, updated_at
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
    `SELECT id, quotation_number, client_name, sales_agent, total_amount, computed_amount, math_status, current_stage, status, created_at, updated_at
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
  const orders = await query(`SELECT id FROM orders WHERE quotation_number=$1`, [body.quotation_number]);
  if (!orders[0]) return reply.code(404).send({ error: 'Order not found' });
  const orderId = orders[0].id;
  await query(
    `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by) VALUES ($1,$2,$3,$4,$5)`,
    [orderId, body.stage, body.status, body.remarks ?? null, body.updated_by ?? null]
  );
  await query(`UPDATE orders SET current_stage=$1, updated_at=NOW() WHERE id=$2`, [body.stage, orderId]);
  // Invalidate caches after stage update
  await invalidateCache(['dashboard:*', 'orders:*', `order:detail:${body.quotation_number}`]);
  return { ok: true };
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

app.post('/agents/quotation-checker', async (request) => {
  const input = request.body as any;
  const output = {
    math_status: 'needs_review',
    quoted_total: input?.quoted_total ?? null,
    computed_total: input?.computed_total ?? null,
    difference: null,
    message: 'Quotation received. OCR/math checker placeholder ran successfully.'
  };
  await query(
    `INSERT INTO agent_logs (agent_name, input, output, status) VALUES ($1,$2,$3,$4)`,
    ['quotation-checker', input, output, 'success']
  );
  return output;
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
      (SELECT COUNT(*)::int FROM reminders WHERE status='active' AND next_run_at < NOW()) AS overdue_reminders
  `);

  const stageBreakdown = await query(
    `SELECT current_stage AS stage, COUNT(*)::int AS count FROM orders WHERE status='active' GROUP BY current_stage ORDER BY MIN(created_at)`
  );

  const recentOrders = await query(
    `SELECT id, quotation_number, client_name, sales_agent, total_amount, computed_amount, math_status, current_stage, status, created_at, updated_at
     FROM orders ORDER BY created_at DESC LIMIT 10`
  );

  const result = {
    total_orders: rows[0].total_orders,
    active_orders: rows[0].active_orders,
    completed_orders: rows[0].completed_orders,
    pending_purchasing: rows[0].pending_purchasing,
    pending_delivery: rows[0].pending_delivery,
    pending_collection: rows[0].pending_collection,
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
 * Upload a file (base64) to Google Drive and store reference in DB.
 */
app.post('/drive/upload', async (request, reply) => {
  const body = fileUploadSchema.parse(request.body);
  const fileBuffer = Buffer.from(body.file_data, 'base64');

  // Determine target folder: per-order folder or root
  let targetFolderId = body.folder_id;

  // If quotation_number provided, get or create per-order folder
  if (body.quotation_number && !targetFolderId) {
    const orders = await query(
      `SELECT id, google_drive_folder_id FROM orders WHERE quotation_number=$1`,
      [body.quotation_number]
    );
    if (orders[0]) {
      if (orders[0].google_drive_folder_id) {
        targetFolderId = orders[0].google_drive_folder_id;
      } else {
        // Create a folder for this order
        const folder = await createDriveFolder(`Order-${body.quotation_number}`);
        targetFolderId = folder.id;
        await query(`UPDATE orders SET google_drive_folder_id=$1 WHERE id=$2`, [
          folder.id,
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
 * Create a folder for an order.
 */
app.post('/drive/folder', async (request, reply) => {
  const body = z
    .object({
      quotation_number: z.string(),
      folder_name: z.string().optional(),
    })
    .parse(request.body);

  const folderName = body.folder_name ?? `Order-${body.quotation_number}`;
  const folder = await getOrCreateFolder(folderName);

  // Link folder to order
  await query(`UPDATE orders SET google_drive_folder_id=$1 WHERE quotation_number=$2`, [
    folder.id,
    body.quotation_number,
  ]);

  return reply.send({ ok: true, folder });
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

await app.listen({ port, host: '0.0.0.0' });
