import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { query } from './db.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get('/health', async () => ({ ok: true, service: 'quotation-automation-api' }));

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
  return reply.send(rows[0]);
});

app.get('/orders/pending', async () => {
  return query(`SELECT * FROM orders WHERE status='active' ORDER BY created_at DESC LIMIT 50`);
});

app.get('/orders/:quotation_number', async (request, reply) => {
  const params = z.object({ quotation_number: z.string() }).parse(request.params);
  const rows = await query(`SELECT * FROM orders WHERE quotation_number=$1`, [params.quotation_number]);
  if (!rows[0]) return reply.code(404).send({ error: 'Order not found' });
  return rows[0];
});

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
  return { ok: true };
});

app.post('/agents/quotation-checker', async (request) => {
  // Placeholder: replace with real OCR/PDF extraction + math validation.
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

const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: '0.0.0.0' });
