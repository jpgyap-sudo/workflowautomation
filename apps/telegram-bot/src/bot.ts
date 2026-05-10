import { Telegraf } from 'telegraf';

const token = process.env.TELEGRAM_BOT_TOKEN;
const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:8080';

if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const bot = new Telegraf(token);

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

bot.start((ctx) => ctx.reply('Quotation Automation Bot is active.'));

bot.command('status', async (ctx) => {
  const quotationNumber = ctx.message.text.split(' ')[1];
  if (!quotationNumber) return ctx.reply('Usage: /status QTN-2026-001');
  const res = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
  if (!res.ok) return ctx.reply('Order not found.');
  const order: any = await res.json();
  return ctx.reply(`Order ${order.quotation_number}\nStage: ${order.current_stage}\nStatus: ${order.status}\nMath: ${order.math_status}`);
});

bot.command('produce', async (ctx) => {
  // Example: /produce QTN-2026-001 yes 10 days
  const [, quotation_number, status, ...remarks] = ctx.message.text.split(' ');
  if (!quotation_number || !status) return ctx.reply('Usage: /produce QTN-2026-001 yes 10 days');
  await postJson('/stage-updates', {
    quotation_number,
    stage: 'production_confirmed',
    status,
    remarks: remarks.join(' '),
    updated_by: ctx.from?.username ?? String(ctx.from?.id),
  });
  return ctx.reply(`✅ Purchasing update saved for ${quotation_number}.`);
});

bot.command('deliverydate', async (ctx) => {
  const [, quotation_number, ...dateParts] = ctx.message.text.split(' ');
  if (!quotation_number || dateParts.length === 0) return ctx.reply('Usage: /deliverydate QTN-2026-001 May 22 2026');
  await postJson('/stage-updates', {
    quotation_number,
    stage: 'delivery_scheduled',
    status: 'scheduled',
    remarks: dateParts.join(' '),
    updated_by: ctx.from?.username ?? String(ctx.from?.id),
  });
  return ctx.reply(`🚚 Delivery date saved for ${quotation_number}.`);
});

bot.command('delivered', async (ctx) => {
  const [, quotation_number, ...remarks] = ctx.message.text.split(' ');
  if (!quotation_number) return ctx.reply('Usage: /delivered QTN-2026-001 yes countered');
  await postJson('/stage-updates', {
    quotation_number,
    stage: 'delivered',
    status: 'delivered',
    remarks: remarks.join(' '),
    updated_by: ctx.from?.username ?? String(ctx.from?.id),
  });
  return ctx.reply(`✅ Delivery update saved for ${quotation_number}.`);
});

bot.command('payment', async (ctx) => {
  const [, quotation_number, ...remarks] = ctx.message.text.split(' ');
  if (!quotation_number) return ctx.reply('Usage: /payment QTN-2026-001 confirmed');
  await postJson('/stage-updates', {
    quotation_number,
    stage: remarks.includes('confirmed') ? 'payment_confirmed' : 'payment_pending',
    status: remarks.join(' ') || 'pending',
    updated_by: ctx.from?.username ?? String(ctx.from?.id),
  });
  return ctx.reply(`💰 Payment update saved for ${quotation_number}.`);
});

bot.on(['document', 'photo'], async (ctx) => {
  const chatId = String(ctx.chat.id);
  const messageId = String(ctx.message.message_id);
  await ctx.reply('📎 File received. I will upload/link this to the order. Use /status or /link next.');
  console.log({ chatId, messageId, from: ctx.from?.username });
});

bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
