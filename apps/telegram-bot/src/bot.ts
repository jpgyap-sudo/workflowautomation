import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import { AsyncLocalStorage } from 'async_hooks';

const token = process.env.TELEGRAM_BOT_TOKEN;
const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:8080';

if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const bot = new Telegraf(token);

// ── Global callback query answer ───────────────────────────────────────
// Prevents ALL inline keyboard buttons from showing a loading spinner
// when clicked. Telegram requires answerCbQuery within 10 seconds.
bot.use(async (ctx, next) => {
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery().catch(() => {});
  }
  return next();
});

// ── Global error handler for callback queries ──────────────────────────
// Catches unhandled errors in any action handler and gives user feedback.
bot.use(async (ctx, next) => {
  try {
    return await next();
  } catch (err: any) {
    console.error('[bot] Unhandled error in handler:', err);
    if (ctx.callbackQuery) {
      await ctx.reply(
        '❌ Something went wrong. Please try again or contact support if the problem persists.',
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
    throw err;
  }
});

// ── AsyncLocalStorage for implicit context propagation ─────────────────
// Lets setStep/setLock read the current Telegraf ctx without passing it
// through every call site.
const ctxStore = new AsyncLocalStorage<any>();

// ── Global editMessageText safety patch ────────────────────────────────
// Swallows the harmless "message is not modified" error so callbacks don't
// crash when content hasn't changed.
bot.use(async (ctx, next) => {
  if (typeof (ctx as any).editMessageText === 'function') {
    const original = (ctx as any).editMessageText.bind(ctx);
    (ctx as any).editMessageText = async (...args: any[]) => {
      try {
        return await original(...args);
      } catch (err: any) {
        if (err?.description?.includes('message is not modified')) {
          // Silently ignore
          return;
        }
        throw err;
      }
    };
  }
  return next();
});

// ── Group Chat Guard + DM Admin Guard + Rate Limiting ──────────────────

const ALLOWED_GROUP_IDS = new Set<string>(
  [
    process.env.QUOTATION_GROUP_CHAT_ID,
    process.env.QUOTATION_GROUP_ID,
    process.env.PURCHASING_GROUP_CHAT_ID,
    process.env.PURCHASING_GROUP_ID,
    process.env.INVENTORY_GROUP_CHAT_ID,
    process.env.INVENTORY_GROUP_ID,
    process.env.DELIVERY_GROUP_CHAT_ID,
    process.env.DELIVERY_GROUP_ID,
    process.env.COLLECTION_GROUP_CHAT_ID,
    process.env.COLLECTION_GROUP_ID,
    process.env.ESCALATION_GROUP_CHAT_ID,
    process.env.ESCALATION_GROUP_ID,
    process.env.PRODUCTION_GROUP_CHAT_ID,
    process.env.PRODUCTION_GROUP_ID,
  ].filter((v): v is string => Boolean(v))
);

if (ALLOWED_GROUP_IDS.size === 0) {
  console.warn('[bot] No group chat IDs configured in environment. Bot will not respond anywhere.');
}

// ── Rate Limiting ──────────────────────────────────────────────────────
const rateLimits = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_REQUESTS = 5;

function checkRateLimit(userId: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const entry = rateLimits.get(userId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(userId, { count: 1, windowStart: now });
    return { allowed: true };
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSec = Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true };
}

// ── Admin Cache ────────────────────────────────────────────────────────
const adminCache = new Map<string, { isAdmin: boolean; expiresAt: number }>();
const ADMIN_CACHE_TTL_MS = 5 * 60 * 1000;
const ADMIN_CACHE_DENY_TTL_MS = 60 * 1000;

async function isUserAdmin(userId: string): Promise<boolean> {
  const cached = adminCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.isAdmin;

  for (const groupId of ALLOWED_GROUP_IDS) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getChatMember`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: groupId, user_id: Number(userId) }),
      });
      const data = await res.json();
      if (data.ok && (data.result.status === 'creator' || data.result.status === 'administrator')) {
        adminCache.set(userId, { isAdmin: true, expiresAt: Date.now() + ADMIN_CACHE_TTL_MS });
        return true;
      }
    } catch (e) {
      console.error(`[admin-check] Error checking group ${groupId}:`, e);
    }
  }

  adminCache.set(userId, { isAdmin: false, expiresAt: Date.now() + ADMIN_CACHE_DENY_TTL_MS });
  return false;
}

// ── Main Middleware: Auth + Rate Limit + Group Lock ────────────────────

bot.use(async (ctx, next) => {
  const chatId = String(ctx.chat?.id ?? '');
  const userId = String(ctx.from?.id ?? '');
  const chatType = ctx.chat?.type;

  // Rate limit every user
  if (userId) {
    const rate = checkRateLimit(userId);
    if (!rate.allowed) {
      if (chatType === 'private') {
        await ctx.reply(`⏳ Please wait ${rate.retryAfterSec}s before sending another message.`, { parse_mode: 'Markdown' }).catch(() => {});
      }
      // For callback queries, already answered by global middleware above
      return;
    }
  }

  // Private chats: only allow group admins
  if (chatType === 'private') {
    if (!userId) return; // Can't verify anonymous
    const admin = await isUserAdmin(userId);
    if (!admin) {
      await ctx.reply(
        '🔒 *Private messages are restricted.*\n\nOnly admins of authorized QAS groups can use this bot via DM.',
        { parse_mode: 'Markdown' }
      ).catch(() => {});
      return;
    }
    // Proceed to next (DMs use chatId as session key naturally)
    return ctxStore.run(ctx, next);
  }

  // Groups / supergroups
  if (chatType !== 'group' && chatType !== 'supergroup') {
    return; // Silently ignore channels etc.
  }

  if (!ALLOWED_GROUP_IDS.has(chatId)) {
    console.log(`[bot] Ignored message from unauthorized group ${chatId}`);
    return;
  }

  // Group session lock check
  const session = getSession(chatId);
  if (session.step.action !== 'idle' && session.ownerUserId && session.ownerUserId !== userId) {
    // Don't spam: only reply if this is a callback or command-like interaction
    const updateType = ctx.updateType;
    if (updateType === 'callback_query' || (ctx.message && 'text' in ctx.message)) {
      await ctx.reply(
        `⏳ *Bot is busy*\nAnother user ${session.ownerUsername ? `(@${session.ownerUsername})` : ''} is currently using the commands. Please wait until they finish.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
    return;
  }

  return ctxStore.run(ctx, next);
});

// ── Bot Logger ─────────────────────────────────────────────────────────

async function botLog(params: {
  chatId: string;
  userId?: string;
  username?: string;
  messageType: string;
  direction?: 'incoming' | 'outgoing' | 'internal';
  content?: string;
  metadata?: Record<string, unknown>;
  status?: 'success' | 'error' | 'pending';
}) {
  try {
    await fetch(`${apiBaseUrl}/bot-logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: params.chatId,
        user_id: params.userId,
        username: params.username,
        message_type: params.messageType,
        direction: params.direction ?? 'incoming',
        content: params.content,
        metadata: params.metadata,
        status: params.status ?? 'success',
      }),
    });
  } catch {
    // Silently ignore logging failures
  }
}

// ── API Helpers ────────────────────────────────────────────────────────

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getJson(path: string) {
  const res = await fetch(`${apiBaseUrl}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

function parseProductionDays(text: string): number | null {
  const match = text.trim().match(/(\d+)/);
  if (!match) return null;
  const days = Number(match[1]);
  return Number.isInteger(days) && days > 0 ? days : null;
}

async function lookupClient(name: string): Promise<any | null> {
  try {
    const res = await fetch(`${apiBaseUrl}/clients/lookup/${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function formatClientInfo(client: any): string {
  const parts: string[] = [];
  if (client.delivery_address) parts.push(`📍 *Address:* ${client.delivery_address}`);
  if (client.contact_number) parts.push(`📞 *Contact:* ${client.contact_number}`);
  if (client.authorized_receiver_name) {
    let receiver = `👤 *Auth. Receiver:* ${client.authorized_receiver_name}`;
    if (client.authorized_receiver_contact) receiver += ` (${client.authorized_receiver_contact})`;
    parts.push(receiver);
  }
  if (client.notes) parts.push(`📝 *Notes:* ${client.notes}`);
  return parts.join('\n');
}

// ── State Machine ──────────────────────────────────────────────────────

type UserStep =
  | { action: 'idle' }
  | { action: 'awaiting_order_number_for_status' }
  | { action: 'awaiting_order_number_for_produce'; status: string }
  | { action: 'awaiting_produce_status'; quotationNumber: string }
  | { action: 'awaiting_produce_remarks'; quotationNumber: string; status: string }
  | { action: 'awaiting_order_number_for_deposit' }
  | { action: 'awaiting_deposit_amount'; quotationNumber: string }
  | { action: 'awaiting_order_number_for_paybalance' }
  | { action: 'awaiting_paybalance_amount'; quotationNumber: string }
  | { action: 'awaiting_delivery_date'; quotationNumber: string }
  | { action: 'awaiting_order_number_for_delivered' }
  | { action: 'awaiting_order_number_for_mark_delivered' }
  | { action: 'awaiting_delivered_remarks'; quotationNumber: string }
  | { action: 'awaiting_order_number_for_payment' }
  | { action: 'awaiting_payment_status'; quotationNumber: string }
  | { action: 'awaiting_order_number_for_link' }
  | { action: 'awaiting_file_upload' }
  | { action: 'awaiting_vision_document_type'; imageBase64: string; mimeType: string; fileName: string }
  | { action: 'awaiting_vision_process'; imageBase64: string; mimeType: string; fileName: string }
  | { action: 'awaiting_vision_extract'; imageBase64: string; mimeType: string; fileName: string }
  | { action: 'awaiting_vision_retry_extract'; imageBase64: string; mimeType: string; fileName: string }
  | {
      action: 'awaiting_upload_retry';
      imageBase64: string;
      mimeType: string;
      fileName: string;
      quotationNumber?: string | null;
      telegramMessageId?: string;
      uploadedBy?: string;
    }
  // Deposit slip matching flow
  | { action: 'awaiting_deposit_confirmation'; imageBase64: string; mimeType: string; fileName: string; depositAmount: number; candidates: DepositCandidate[]; paymentDate?: string }
  | { action: 'awaiting_deposit_client_name'; imageBase64: string; mimeType: string; fileName: string; depositAmount: number; paymentDate?: string }
  // Production tracking flow
  | { action: 'awaiting_delay_days'; orderId: string; quotationNumber: string }
  | { action: 'awaiting_delivery_timeline'; orderId: string; quotationNumber: string }
  | { action: 'awaiting_custom_delivery_days'; orderId: string; quotationNumber: string }
  // En route flow
  | { action: 'awaiting_en_route'; orderId: string; quotationNumber: string }
  | { action: 'awaiting_en_route_arrival_days'; orderId: string; quotationNumber: string }
  | { action: 'awaiting_client_search' }
  // Partial production flow
  | { action: 'awaiting_partial_missing_items'; orderId: string; quotationNumber: string }
  | { action: 'awaiting_partial_items_update'; orderId: string; quotationNumber: string; remainingItems: string[] }
  // Balance payment proof photo flow
  | { action: 'awaiting_balance_proof_photo'; orderId: string; quotationNumber: string }
  // Delivery schedule confirmation flow
  | { action: 'awaiting_delivery_schedule'; orderId: string; quotationNumber: string }
  // Delivery day check flow
  | { action: 'awaiting_delivery_day_check'; orderId: string; quotationNumber: string }
  // Collection group deposit slip photo upload
  | { action: 'awaiting_deposit_slip_photo'; orderId: string; quotationNumber: string };

interface DepositCandidate {
  quotation_number: string;
  client_name: string;
  total_amount: number;
  expected_deposit: number;
  discrepancy: number;
}

interface UserSession {
  step: UserStep;
  linkedOrder: string | null;
  ownerUserId?: string;
  ownerUsername?: string;
  lockedAt?: number;
}

const sessions = new Map<string, UserSession>();

function getSession(chatId: string): UserSession {
  let session = sessions.get(chatId);
  if (!session) {
    session = { step: { action: 'idle' }, linkedOrder: null };
    sessions.set(chatId, session);
  }
  return session;
}

function setStep(chatId: string, step: UserStep) {
  const session = getSession(chatId);
  const wasIdle = session.step.action === 'idle';
  session.step = step;

  // Auto-lock on transition from idle -> active using AsyncLocalStorage context
  if (wasIdle && step.action !== 'idle') {
    const ctx = ctxStore.getStore();
    if (ctx) {
      session.ownerUserId = String(ctx.from?.id ?? '');
      session.ownerUsername = ctx.from?.username;
      session.lockedAt = Date.now();
    }
  }

  // Auto-unlock on reset
  if (step.action === 'idle') {
    delete session.ownerUserId;
    delete session.ownerUsername;
    delete session.lockedAt;
  }
}

function resetStep(chatId: string) {
  const session = getSession(chatId);
  session.step = { action: 'idle' };
  delete session.ownerUserId;
  delete session.ownerUsername;
  delete session.lockedAt;
}

// ── Auto-release stale group locks ─────────────────────────────────────
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [chatId, session] of sessions.entries()) {
    if (session.step.action !== 'idle' && session.lockedAt && now - session.lockedAt > LOCK_TIMEOUT_MS) {
      console.log(`[lock] Auto-releasing expired lock for chat ${chatId} (owner: ${session.ownerUsername ?? session.ownerUserId})`);
      resetStep(chatId);
    }
  }
}, 60_000);

function escapeMarkdown(value: unknown): string {
  return String(value ?? '').replace(/([_*`[\]\\])/g, '\\$1');
}

// ── Order Picker Helpers ───────────────────────────────────────────────

async function getOrdersForAction(action: string): Promise<{ id: string; quotation_number: string; client_name: string | null }[]> {
  try {
    const data = await getJson(`/orders/picker?action=${encodeURIComponent(action)}`);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function showOrderPicker(
  ctx: any,
  chatId: string,
  action: string,
  title: string,
  fallbackPrompt: string,
  stepToSet: UserStep,
) {
  setStep(chatId, stepToSet);
  const orders = await getOrdersForAction(action);

  const buttons: any[][] = [];
  if (orders.length > 0) {
    for (const o of orders.slice(0, 5)) {
      const label = `${o.quotation_number}${o.client_name ? ` — ${o.client_name}` : ''}`.substring(0, 60);
      buttons.push([Markup.button.callback(label, `pick:${action}:${o.quotation_number}`)]);
    }
    if (orders.length > 5) {
      buttons.push([Markup.button.callback(`+${orders.length - 5} more — type number below`, 'noop')]);
    }
  }
  buttons.push([Markup.button.callback('❌ Cancel', 'action:cancel')]);

  const text = orders.length > 0
    ? `${title}\n\nTap an order or type the quotation number:`
    : `${title}\n\n${fallbackPrompt}`;

  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) })
    .catch(() => ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }));
}

// ── Delivery Date Picker Helpers ───────────────────────────────────────

function getDeliveryDateButtons(quotationNumber: string) {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000); // PHT
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });

  const today = new Date(now);
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const plus2 = new Date(now); plus2.setDate(now.getDate() + 2);

  const dow = now.getDay();
  const daysToFri = dow <= 5 ? 5 - dow : 6;
  const nextFri = new Date(now); nextFri.setDate(now.getDate() + (daysToFri || 7));

  return Markup.inlineKeyboard([
    [Markup.button.callback(`📅 Today — ${fmt(today)}`, `date:today:${quotationNumber}`)],
    [Markup.button.callback(`📅 Tomorrow — ${fmt(tomorrow)}`, `date:tomorrow:${quotationNumber}`)],
    [Markup.button.callback(`📅 ${fmt(plus2)}`, `date:plus2:${quotationNumber}`)],
    [Markup.button.callback(`📅 ${fmt(nextFri)} (Fri)`, `date:friday:${quotationNumber}`)],
    [Markup.button.callback('✏️ Custom date...', `date:custom:${quotationNumber}`)],
    [Markup.button.callback('❌ Cancel', 'action:cancel')],
  ]);
}

async function showDeliveryDatePicker(ctx: any, chatId: string, quotationNumber: string, order: any, isEdit: boolean) {
  setStep(chatId, { action: 'awaiting_delivery_date', quotationNumber });

  let clientInfo = '';
  const client = order?.client_name ? await lookupClient(order.client_name).catch(() => null) : null;
  if (client) {
    const info = formatClientInfo(client);
    if (info) clientInfo = `\n\n🚚 *Delivery Info:*\n${info}`;
  } else if (order?.delivery_address) {
    clientInfo = `\n\n🚚 *Delivery Info:*\n📍 *Address:* ${order.delivery_address}`;
    if (order.contact_number) clientInfo += `\n📞 *Contact:* ${order.contact_number}`;
  }

  const text = `🚚 *Schedule Delivery for ${quotationNumber}*${clientInfo}\n\nSelect a delivery date:`;
  if (isEdit) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...getDeliveryDateButtons(quotationNumber) })
      .catch(() => ctx.reply(text, { parse_mode: 'Markdown', ...getDeliveryDateButtons(quotationNumber) }));
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', ...getDeliveryDateButtons(quotationNumber) });
  }
}

function retryUploadKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔁 Retry upload', 'upload:retry')],
    [Markup.button.callback('❌ Cancel', 'action:cancel')],
  ]);
}

async function uploadFileAndRecord(params: {
  chatId: string;
  imageBase64: string;
  mimeType: string;
  fileName: string;
  quotationNumber?: string | null;
  telegramMessageId?: string;
  uploadedBy?: string;
}) {
  const payload: Record<string, unknown> = {
    file_type: params.mimeType,
    original_filename: params.fileName,
    mime_type: params.mimeType,
    file_data: params.imageBase64,
    telegram_chat_id: params.chatId,
    uploaded_by: params.uploadedBy,
  };

  if (params.telegramMessageId) payload.telegram_message_id = params.telegramMessageId;
  if (params.quotationNumber) payload.quotation_number = params.quotationNumber;

  await postJson('/drive/upload', payload);
  return { fileId: null, webViewLink: null };
}

// ── Inline Keyboard Builders ───────────────────────────────────────────

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📋 Check Order Status', 'menu:status')],
    [Markup.button.callback('🛒 Purchasing / Production', 'menu:produce')],
    [Markup.button.callback('💳 Record Downpayment', 'menu:deposit')],
    [Markup.button.callback('💰 Pay Balance', 'menu:paybalance')],
    [Markup.button.callback('🚚 Schedule Delivery', 'menu:deliverydate')],
    [Markup.button.callback('✅ Mark as Delivered', 'menu:delivered')],
    [Markup.button.callback('💵 Record Payment', 'menu:payment')],
    [Markup.button.callback('👤 Clients', 'menu:clients')],
    [Markup.button.callback('🔗 Link Order for Upload', 'menu:link')],
    [Markup.button.callback('📎 Upload File', 'menu:upload')],
  ]);
}

function cancelButton() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('❌ Cancel', 'action:cancel')],
  ]);
}

// ── Safe Reply Helper ─────────────────────────────────────────────────
// Splits long messages into chunks to avoid Telegram's 4096-char limit.
async function safeReply(
  ctx: any,
  text: string,
  opts?: { parse_mode?: string; reply_markup?: any; disable_web_page_preview?: boolean }
): Promise<void> {
  const MAX_LEN = 4000;
  const chunks: string[] = [];

  if (text.length <= MAX_LEN) {
    chunks.push(text);
  } else {
    // Try to split at paragraph boundaries
    const paragraphs = text.split('\n\n');
    let current = '';
    for (const para of paragraphs) {
      if ((current + '\n\n' + para).length > MAX_LEN && current.length > 0) {
        chunks.push(current.trim());
        current = para;
      } else {
        current = current ? current + '\n\n' + para : para;
      }
    }
    if (current) chunks.push(current.trim());

    // Fallback: if any chunk is still too long, force split
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].length > MAX_LEN) {
        const forced = chunks[i];
        chunks.splice(i, 1);
        for (let j = 0; j < forced.length; j += MAX_LEN) {
          chunks.push(forced.slice(j, j + MAX_LEN));
        }
      }
    }
  }

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    await ctx.reply(chunks[i], {
      parse_mode: opts?.parse_mode,
      disable_web_page_preview: opts?.disable_web_page_preview ?? true,
      ...(isLast && opts?.reply_markup ? { reply_markup: opts.reply_markup } : {}),
    });
  }
}

// ── Main Menu ──────────────────────────────────────────────────────────

bot.start(async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const username = ctx.from?.username;
  resetStep(chatId);
  botLog({
    chatId,
    username,
    messageType: 'command',
    content: '/start',
    direction: 'incoming',
  });
  await ctx.reply(
    '👋 *Welcome to Quotation Automation Bot!*\n\n' +
    'Use the buttons below to manage orders. No need to type commands — just tap and follow the prompts.',
    { parse_mode: 'Markdown', ...mainMenuKeyboard() }
  );
});

// ── Action: Cancel ─────────────────────────────────────────────────────

bot.action('action:cancel', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  resetStep(chatId);
  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: 'action:cancel',
    direction: 'incoming',
  });
  await ctx.editMessageText(
    '❌ Cancelled. What would you like to do next?',
    { parse_mode: 'Markdown', ...mainMenuKeyboard() }
  ).catch(() => ctx.reply('❌ Cancelled.', mainMenuKeyboard()));
});

// ── Menu Router ────────────────────────────────────────────────────────

bot.action(/^menu:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const action = ctx.match[1];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `menu:${action}`,
    direction: 'incoming',
  });

  switch (action) {
    case 'main':
      resetStep(chatId);
      await ctx.editMessageText(
        '🏠 *Main Menu*\nChoose an action below:',
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      ).catch(() =>
        ctx.reply('🏠 *Main Menu*\nChoose an action below:', {
          parse_mode: 'Markdown',
          ...mainMenuKeyboard(),
        })
      );
      break;

    case 'status':
      await showOrderPicker(ctx, chatId, 'status',
        '📋 *Check Order Status*',
        'Enter the quotation number:\n\nExample: `QTN-2026-001`',
        { action: 'awaiting_order_number_for_status' });
      break;

    case 'produce':
      await showOrderPicker(ctx, chatId, 'produce',
        '🛒 *Purchasing / Production*',
        'Enter the quotation number:\n\nExample: `QTN-2026-001`',
        { action: 'awaiting_order_number_for_produce', status: 'yes' });
      break;

    case 'deposit':
      await showOrderPicker(ctx, chatId, 'deposit',
        '💳 *Record Downpayment*',
        'Enter the quotation number:\n\nExample: `QTN-2026-001`',
        { action: 'awaiting_order_number_for_deposit' });
      break;

    case 'paybalance':
      await showOrderPicker(ctx, chatId, 'paybalance',
        '💰 *Pay Balance*',
        'Enter the quotation number:\n\nExample: `QTN-2026-001`',
        { action: 'awaiting_order_number_for_paybalance' });
      break;

    case 'deliverydate':
      await showOrderPicker(ctx, chatId, 'deliverydate',
        '🚚 *Schedule Delivery*',
        'Enter the quotation number:\n\nExample: `QTN-2026-001`',
        { action: 'awaiting_order_number_for_delivered' });
      break;

    case 'delivered':
      await showOrderPicker(ctx, chatId, 'delivered',
        '✅ *Mark as Delivered*',
        'Enter the quotation number:\n\nExample: `QTN-2026-001`',
        { action: 'awaiting_order_number_for_mark_delivered' });
      break;

    case 'payment':
      await showOrderPicker(ctx, chatId, 'payment',
        '💵 *Record Payment*',
        'Enter the quotation number:\n\nExample: `QTN-2026-001`',
        { action: 'awaiting_order_number_for_payment' });
      break;

    case 'link':
      await showOrderPicker(ctx, chatId, 'link',
        '🔗 *Link Order for Upload*',
        'Enter the quotation number to link:\n\nExample: `QTN-2026-001`',
        { action: 'awaiting_order_number_for_link' });
      break;

    case 'upload':
      {
        const session = getSession(chatId);
        if (!session.linkedOrder) {
          await showOrderPicker(ctx, chatId, 'link',
            '📎 *Upload File*\n\nNo order linked yet. Select one to link:',
            'Enter the quotation number to link:\n\nExample: `QTN-2026-001`',
            { action: 'awaiting_order_number_for_link' });
        } else {
          setStep(chatId, { action: 'awaiting_file_upload' });
          await ctx.editMessageText(
            `📎 *Upload File*\n\nLinked to: *${session.linkedOrder}*\n\nSend a document or photo to attach it to this order.`,
            { parse_mode: 'Markdown', ...cancelButton() }
          ).catch(() =>
            ctx.reply(
              `📎 *Upload File*\n\nLinked to: *${session.linkedOrder}*\n\nSend a document or photo to attach it to this order.`,
              { parse_mode: 'Markdown', ...cancelButton() }
            )
          );
        }
      }
      break;

    case 'clients':
      setStep(chatId, { action: 'awaiting_client_search' });
      await ctx.editMessageText(
        '👤 *Clients*\n\nTap to view all, or type a client name to search:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📋 View All Clients', 'clients:list')],
            [Markup.button.callback('❌ Cancel', 'action:cancel')],
          ]),
        }
      ).catch(() =>
        ctx.reply('👤 *Clients*\n\nTap to view all, or type a client name to search:', {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📋 View All Clients', 'clients:list')],
            [Markup.button.callback('❌ Cancel', 'action:cancel')],
          ]),
        })
      );
      break;

    default:
      await ctx.answerCbQuery('Unknown option');
  }
});

// ── No-op (info-only buttons like "+ N more") ──────────────────────────

bot.action('noop', async (ctx) => { await ctx.answerCbQuery(); });

// ── Order Picker Callback ─────────────────────────────────────────────
// Fired when user taps a quick-pick order button instead of typing.
// Jumps directly to the next step for the chosen action.

bot.action(/^pick:([^:]+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const action = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({ chatId, userId, username, messageType: 'callback_query', content: `pick:${action}:${quotationNumber}`, direction: 'incoming' });

  switch (action) {
    case 'status': {
      try {
        const res = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
        if (!res.ok) {
          resetStep(chatId);
          await ctx.editMessageText(`❌ Order *${quotationNumber}* not found.`, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
          return;
        }
        const order: any = await res.json();
        const totalAmount = Number(order.total_amount ?? 0);
        const depositAmount = Number(order.deposit_amount ?? 0);
        const balance = totalAmount - depositAmount;
        let msg =
          `📋 *${order.quotation_number}*\n` +
          `Stage: ${order.current_stage}\nStatus: ${order.status}\nMath: ${order.math_status}\n` +
          `Total: ₱${totalAmount.toLocaleString()}\n` +
          `Downpayment: ${order.deposit_paid ? `✅ ₱${depositAmount.toLocaleString()}` : '⏳ Pending'}\n` +
          `Balance: ${order.balance_paid ? '✅ Paid' : `⏳ ₱${balance.toLocaleString()}`}`;
        const client = order.client_name ? await lookupClient(order.client_name) : null;
        if (client || order.delivery_address) {
          msg += `\n\n🚚 *Delivery Info:*`;
          if (client) { const info = formatClientInfo(client); if (info) msg += `\n${info}`; }
          else {
            if (order.delivery_address) msg += `\n📍 *Address:* ${order.delivery_address}`;
            if (order.contact_number) msg += `\n📞 *Contact:* ${order.contact_number}`;
          }
        }
        resetStep(chatId);
        await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
      } catch {
        resetStep(chatId);
        await ctx.editMessageText(`❌ Error fetching order *${quotationNumber}*.`, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
      }
      break;
    }

    case 'produce': {
      setStep(chatId, { action: 'awaiting_produce_status', quotationNumber });
      await ctx.editMessageText(
        `🛒 *Production for ${quotationNumber}*\n\nHas production/purchasing started?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Yes, started', `produce:yes:${quotationNumber}`)],
            [Markup.button.callback('⚠️ Partial — some items started', `produce:partial:${quotationNumber}`)],
            [Markup.button.callback('⏳ Not yet', `produce:no:${quotationNumber}`)],
            [Markup.button.callback('❌ Cancel', 'action:cancel')],
          ]),
        }
      );
      break;
    }

    case 'deposit': {
      setStep(chatId, { action: 'awaiting_deposit_amount', quotationNumber });
      await ctx.editMessageText(
        `💳 *Downpayment for ${quotationNumber}*\n\nEnter the downpayment amount in PHP:\n\nExample: \`5000\``,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
      break;
    }

    case 'paybalance': {
      setStep(chatId, { action: 'awaiting_paybalance_amount', quotationNumber });
      await ctx.editMessageText(
        `💰 *Balance Payment for ${quotationNumber}*\n\nEnter the balance amount in PHP:\n\nExample: \`15000\``,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
      break;
    }

    case 'deliverydate': {
      let order: any;
      try {
        order = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
        const totalAmount = Number(order.total_amount ?? 0);
        const depositAmount = Number(order.deposit_amount ?? 0);
        const balance = totalAmount - depositAmount;
        if (!order.balance_paid && balance > 0) {
          resetStep(chatId);
          await ctx.editMessageText(
            `❌ *Balance not yet paid for ${quotationNumber}*\n\n` +
            `Total: ₱${totalAmount.toLocaleString()}\nDeposit: ₱${depositAmount.toLocaleString()}\nBalance Due: ₱${balance.toLocaleString()}\n\n` +
            `Please pay the balance first via *Pay Balance*.`,
            { parse_mode: 'Markdown', ...mainMenuKeyboard() }
          );
          return;
        }
      } catch {
        resetStep(chatId);
        await ctx.editMessageText(`❌ Order *${quotationNumber}* not found.`, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
        return;
      }
      await showDeliveryDatePicker(ctx, chatId, quotationNumber, order, true);
      break;
    }

    case 'delivered': {
      setStep(chatId, { action: 'awaiting_delivered_remarks', quotationNumber });
      await ctx.editMessageText(
        `✅ *Mark as Delivered — ${quotationNumber}*\n\nAdd delivery remarks, or skip:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⏭ Skip remarks', `skip_remarks:${quotationNumber}`)],
            [Markup.button.callback('❌ Cancel', 'action:cancel')],
          ]),
        }
      );
      break;
    }

    case 'payment': {
      setStep(chatId, { action: 'awaiting_payment_status', quotationNumber });
      await ctx.editMessageText(
        `💵 *Payment for ${quotationNumber}*\n\nHas the payment been confirmed?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Confirmed', `payment:confirmed:${quotationNumber}`)],
            [Markup.button.callback('⏳ Received (pending confirm)', `payment:pending:${quotationNumber}`)],
            [Markup.button.callback('❌ Cancel', 'action:cancel')],
          ]),
        }
      );
      break;
    }

    case 'link': {
      try {
        const order: any = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
        const sess = getSession(chatId);
        sess.linkedOrder = order.quotation_number;
        resetStep(chatId);
        await ctx.editMessageText(
          `🔗 *Linked to ${order.quotation_number}*\n\nFiles sent here will be attached to this order.\n\nSend a document or photo to upload, or choose another action.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch {
        resetStep(chatId);
        await ctx.editMessageText(`❌ Order *${quotationNumber}* not found.`, { parse_mode: 'Markdown', ...cancelButton() });
      }
      break;
    }

    default:
      await ctx.answerCbQuery('Unknown action');
  }
});

// ── Clients: View All ─────────────────────────────────────────────────

bot.action('clients:list', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  try {
    const clients: any[] = await getJson('/clients');
    if (clients.length === 0) {
      resetStep(chatId);
      await ctx.editMessageText('👤 No clients found.', { parse_mode: 'Markdown', ...mainMenuKeyboard() });
      return;
    }
    const list = clients.slice(0, 20).map((c) => `• *${escapeMarkdown(c.client_name)}*`).join('\n');
    resetStep(chatId);
    await ctx.editMessageText(`👤 *All Clients:*\n\n${list}`, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
  } catch {
    await ctx.editMessageText('❌ Error fetching clients.', { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// ── Delivery Date Picker Callback ─────────────────────────────────────

bot.action(/^date:(today|tomorrow|plus2|friday|custom):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const dateKey = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({ chatId, userId, username, messageType: 'callback_query', content: `date:${dateKey}:${quotationNumber}`, direction: 'incoming' });

  if (dateKey === 'custom') {
    setStep(chatId, { action: 'awaiting_delivery_date', quotationNumber });
    await ctx.editMessageText(
      `🚚 *Schedule Delivery for ${quotationNumber}*\n\nEnter the delivery date:\n\nExample: \`May 22 2026\``,
      { parse_mode: 'Markdown', ...cancelButton() }
    );
    return;
  }

  const now = new Date(Date.now() + 8 * 60 * 60 * 1000); // PHT
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });

  let dateText: string;
  switch (dateKey) {
    case 'today':
      dateText = fmt(now);
      break;
    case 'tomorrow': {
      const d = new Date(now); d.setDate(now.getDate() + 1);
      dateText = fmt(d);
      break;
    }
    case 'plus2': {
      const d = new Date(now); d.setDate(now.getDate() + 2);
      dateText = fmt(d);
      break;
    }
    case 'friday': {
      const dow = now.getDay();
      const daysToFri = dow <= 5 ? 5 - dow : 6;
      const d = new Date(now); d.setDate(now.getDate() + (daysToFri || 7));
      dateText = fmt(d);
      break;
    }
    default:
      dateText = 'Unknown date';
  }

  try {
    await postJson('/stage-updates', {
      quotation_number: quotationNumber,
      stage: 'delivery_scheduled',
      status: 'scheduled',
      remarks: dateText,
      updated_by: username ?? String(userId),
    });
    resetStep(chatId);
    await ctx.editMessageText(
      `🚚 *Delivery Scheduled*\n\nOrder: *${quotationNumber}*\nDate: ${dateText}`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } catch (err: any) {
    await ctx.editMessageText(`❌ Error scheduling delivery: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// ── Skip Delivery Remarks ─────────────────────────────────────────────

bot.action(/^skip_remarks:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const quotationNumber = ctx.match[1];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({ chatId, userId, username, messageType: 'callback_query', content: `skip_remarks:${quotationNumber}`, direction: 'incoming' });

  try {
    await postJson('/stage-updates', {
      quotation_number: quotationNumber,
      stage: 'delivered',
      status: 'delivered',
      remarks: '',
      updated_by: username ?? String(userId),
    });
    resetStep(chatId);
    await ctx.editMessageText(
      `✅ *Delivered*\n\nOrder: *${quotationNumber}*`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } catch (err: any) {
    await ctx.editMessageText(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// ── Text Message Handler (State Machine) ───────────────────────────────
// Single handler for all text input — routes based on current step

bot.on(message('text'), async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const text = ctx.message.text.trim();
  const session = getSession(chatId);
  const username = ctx.from?.username;
  const userId = String(ctx.from?.id ?? '');

  // Log incoming text message
  botLog({
    chatId,
    userId,
    username,
    messageType: 'text',
    content: text.substring(0, 500),
    metadata: { step: session.step.action },
  });

  // If idle, show main menu
  if (session.step.action === 'idle') {
    await ctx.reply(
      '🏠 *Main Menu*\nChoose an action below:',
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
    return;
  }

  switch (session.step.action) {
    // ── Check Status ────────────────────────────────────────────────
    case 'awaiting_order_number_for_status': {
      const quotationNumber = text;
      try {
        const res = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
        if (!res.ok) {
          await ctx.reply(`❌ Order *${quotationNumber}* not found. Please check the number and try again.`, {
            parse_mode: 'Markdown',
            ...cancelButton(),
          });
          return;
        }
        const order: any = await res.json();
        const totalAmount = Number(order.total_amount ?? 0);
        const depositAmount = Number(order.deposit_amount ?? 0);
        const balance = totalAmount - depositAmount;
        let msg =
          `📋 *${order.quotation_number}*\n` +
          `Stage: ${order.current_stage}\n` +
          `Status: ${order.status}\n` +
          `Math: ${order.math_status}\n` +
          `Total: ₱${totalAmount.toLocaleString()}\n` +
          `Downpayment: ${order.deposit_paid ? `✅ ₱${depositAmount.toLocaleString()}` : '⏳ Pending'}\n` +
          `Balance: ${order.balance_paid ? '✅ Paid' : `⏳ ₱${balance.toLocaleString()}`}`;

        // Auto-detect client delivery info
        const client = order.client_name ? await lookupClient(order.client_name) : null;
        if (client || order.delivery_address || order.contact_number) {
          msg += `\n\n🚚 *Delivery Info:*`;
          if (client) {
            const info = formatClientInfo(client);
            if (info) msg += `\n${info}`;
          } else {
            if (order.delivery_address) msg += `\n📍 *Address:* ${order.delivery_address}`;
            if (order.contact_number) msg += `\n📞 *Contact:* ${order.contact_number}`;
            if (order.authorized_receiver_name) msg += `\n👤 *Auth. Receiver:* ${order.authorized_receiver_name}${order.authorized_receiver_contact ? ` (${order.authorized_receiver_contact})` : ''}`;
          }
        }

        resetStep(chatId);
        await safeReply(ctx, msg, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard().reply_markup });
      } catch {
        await ctx.reply(`❌ Error fetching order *${quotationNumber}*.`, {
          parse_mode: 'Markdown',
          ...cancelButton(),
        });
      }
      break;
    }

    // ── Purchasing / Production ─────────────────────────────────────
    case 'awaiting_order_number_for_produce': {
      const quotationNumber = text;
      try {
        const res = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
        if (!res.ok) {
          await ctx.reply(`❌ Order *${quotationNumber}* not found.`, {
            parse_mode: 'Markdown',
            ...cancelButton(),
          });
          return;
        }
      } catch {
        await ctx.reply(`❌ Error checking order *${quotationNumber}*.`, {
          parse_mode: 'Markdown',
          ...cancelButton(),
        });
        return;
      }
      setStep(chatId, { action: 'awaiting_produce_status', quotationNumber });
      await ctx.reply(
        `🛒 *Production for ${quotationNumber}*\n\nHas production/purchasing started?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Yes, started', `produce:yes:${quotationNumber}`)],
            [Markup.button.callback('⚠️ Partial — some items started', `produce:partial:${quotationNumber}`)],
            [Markup.button.callback('⏳ Not yet', `produce:no:${quotationNumber}`)],
            [Markup.button.callback('❌ Cancel', 'action:cancel')],
          ]),
        }
      );
      break;
    }

    // ── Produce Remarks (after "yes" callback) ──────────────────────
    case 'awaiting_produce_remarks': {
      const { quotationNumber, status } = session.step;
      const estimatedDays = parseProductionDays(text);
      if (!estimatedDays) {
        await ctx.reply('Please enter the estimated production time in days (e.g., `10 days` or `10`).', {
          parse_mode: 'Markdown',
          ...cancelButton(),
        });
        return;
      }

      try {
        const order = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
        await postJson(`/orders/${order.id}/set-production`, {
          production_started: status === 'yes',
          estimated_production_days: estimatedDays,
        });
        resetStep(chatId);
        await ctx.reply(
          `Production Confirmed

Order: *${quotationNumber}*
Timeline: ${estimatedDays} day(s)

Midpoint and due reminders are now scheduled.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (err: any) {
        await ctx.reply(`Error: ${err.message}`, {
          parse_mode: 'Markdown',
          ...cancelButton(),
        });
      }
      break;
    }

    // ── Deposit ─────────────────────────────────────────────────────
    case 'awaiting_order_number_for_deposit': {
      const quotationNumber = text;
      try {
        const res = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
        if (!res.ok) {
          await ctx.reply(`❌ Order *${quotationNumber}* not found.`, {
            parse_mode: 'Markdown',
            ...cancelButton(),
          });
          return;
        }
      } catch {
        await ctx.reply(`❌ Error checking order *${quotationNumber}*.`, {
          parse_mode: 'Markdown',
          ...cancelButton(),
        });
        return;
      }
      setStep(chatId, { action: 'awaiting_deposit_amount', quotationNumber });
      await ctx.reply(
        `💳 *Downpayment for ${quotationNumber}*\n\nEnter the downpayment amount in PHP:\n\nExample: \`5000\``,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
      break;
    }

    case 'awaiting_deposit_amount': {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('❌ Invalid amount. Please enter a positive number (e.g., `5000`).', {
          parse_mode: 'Markdown',
          ...cancelButton(),
        });
        return;
      }
      const { quotationNumber } = session.step;
      try {
        await postJson('/deposits', {
          quotation_number: quotationNumber,
          amount,
          updated_by: ctx.from?.username ?? String(ctx.from?.id),
        });
        resetStep(chatId);
        await ctx.reply(
          `✅ *Downpayment Recorded*\n\nOrder: *${quotationNumber}*\nAmount: ₱${amount.toLocaleString()}\n\nProduction can now proceed.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (err: any) {
        await ctx.reply(`❌ Error recording downpayment: ${err.message}`, {
          parse_mode: 'Markdown',
          ...cancelButton(),
        });
      }
      break;
    }

    // ── Pay Balance ─────────────────────────────────────────────────
    case 'awaiting_order_number_for_paybalance': {
      const quotationNumber = text;
      try {
        const res = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
        if (!res.ok) {
          await ctx.reply(`❌ Order *${quotationNumber}* not found.`, {
            parse_mode: 'Markdown',
            ...cancelButton(),
          });
          return;
        }
      } catch {
        await ctx.reply(`❌ Error checking order *${quotationNumber}*.`, {
          parse_mode: 'Markdown',
          ...cancelButton(),
        });
        return;
      }
      setStep(chatId, { action: 'awaiting_paybalance_amount', quotationNumber });
      await ctx.reply(
        `💰 *Balance Payment for ${quotationNumber}*\n\nEnter the balance amount in PHP:\n\nExample: \`15000\``,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
      break;
    }

    case 'awaiting_paybalance_amount': {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('❌ Invalid amount. Please enter a positive number (e.g., `15000`).', {
          parse_mode: 'Markdown',
          ...cancelButton(),
        });
        return;
      }
      const { quotationNumber } = session.step;
      try {
        const result: any = await postJson('/pay-balance', {
          quotation_number: quotationNumber,
          amount,
          updated_by: ctx.from?.username ?? String(ctx.from?.id),
        });
        resetStep(chatId);
        let msg = `✅ *Balance Paid*\n\nOrder: *${quotationNumber}*\nAmount: ₱${amount.toLocaleString()}`;
        if (result.overpayment > 0) {
          msg += `\n⚠️ Overpayment of ₱${result.overpayment.toLocaleString()}`;
        }
        msg += `\n\n🚚 You can now schedule delivery.`;
        await ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
      } catch (err: any) {
        const errorData = err?.response?.data;
        if (errorData?.lacking_amount) {
          await ctx.reply(
            `❌ *Insufficient Payment*\n\n` +
            `Expected balance: ₱${Number(errorData.expected_balance).toLocaleString()}\n` +
            `Received: ₱${amount.toLocaleString()}\n` +
            `Still lacking: ₱${Number(errorData.lacking_amount).toLocaleString()}\n\n` +
            `Please pay the full remaining balance.`,
            { parse_mode: 'Markdown', ...cancelButton() }
          );
        } else {
          await ctx.reply(`❌ Error: ${errorData?.error ?? err.message}`, {
            parse_mode: 'Markdown',
            ...cancelButton(),
          });
        }
      }
      break;
    }

    // ── Schedule Delivery ───────────────────────────────────────────
    case 'awaiting_order_number_for_delivered': {
      const quotationNumber = text;
      // Check balance first
      let order: any;
      try {
        order = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
        const totalAmount = Number(order.total_amount ?? 0);
        const depositAmount = Number(order.deposit_amount ?? 0);
        const balance = totalAmount - depositAmount;

        if (order.total_amount == null) {
          await ctx.reply(
            `❌ *Total amount not set for ${quotationNumber}*\n\nPlease set the total amount first.`,
            { parse_mode: 'Markdown', ...cancelButton() }
          );
          return;
        }

        if (!order.balance_paid && balance > 0) {
          await ctx.reply(
            `❌ *Balance not yet paid for ${quotationNumber}*\n\n` +
            `Total: ₱${totalAmount.toLocaleString()}\n` +
            `Deposit: ₱${depositAmount.toLocaleString()}\n` +
            `Balance Due: ₱${balance.toLocaleString()}\n\n` +
            `Please pay the balance first using the Main Menu → Pay Balance.`,
            { parse_mode: 'Markdown', ...cancelButton() }
          );
          return;
        }
      } catch {
        await ctx.reply(`❌ Order *${quotationNumber}* not found.`, {
          parse_mode: 'Markdown',
          ...cancelButton(),
        });
        return;
      }
      await showDeliveryDatePicker(ctx, chatId, quotationNumber, order, false);
      break;
    }

    case 'awaiting_delivery_date': {
      const { quotationNumber } = session.step;
      const dateText = text;
      try {
        await postJson('/stage-updates', {
          quotation_number: quotationNumber,
          stage: 'delivery_scheduled',
          status: 'scheduled',
          remarks: dateText,
          updated_by: ctx.from?.username ?? String(ctx.from?.id),
        });
        resetStep(chatId);
        await ctx.reply(
          `🚚 *Delivery Scheduled*\n\nOrder: *${quotationNumber}*\nDate: ${dateText}`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (err: any) {
        await ctx.reply(`❌ Error scheduling delivery: ${err.message}`, {
          parse_mode: 'Markdown',
          ...cancelButton(),
        });
      }
      break;
    }

    // ── Mark as Delivered — order number input ──────────────────────
    case 'awaiting_order_number_for_mark_delivered': {
      const quotationNumber = text;
      try {
        const res = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
        if (!res.ok) {
          await ctx.reply(`❌ Order *${quotationNumber}* not found.`, {
            parse_mode: 'Markdown',
            ...cancelButton(),
          });
          return;
        }
      } catch {
        await ctx.reply(`❌ Error checking order *${quotationNumber}*.`, {
          parse_mode: 'Markdown',
          ...cancelButton(),
        });
        return;
      }
      setStep(chatId, { action: 'awaiting_delivered_remarks', quotationNumber });
      await ctx.reply(
        `✅ *Mark as Delivered — ${quotationNumber}*\n\nAdd delivery remarks (recipient name, notes), or skip:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⏭ Skip remarks', `skip_remarks:${quotationNumber}`)],
            [Markup.button.callback('❌ Cancel', 'action:cancel')],
          ]),
        }
      );
      break;
    }

    // ── Mark as Delivered (remarks) ─────────────────────────────────
    case 'awaiting_delivered_remarks': {
      const { quotationNumber } = session.step;
      const remarks = text;
      try {
        await postJson('/stage-updates', {
          quotation_number: quotationNumber,
          stage: 'delivered',
          status: 'delivered',
          remarks,
          updated_by: ctx.from?.username ?? String(ctx.from?.id),
        });
        resetStep(chatId);
        await ctx.reply(
          `✅ *Delivered*\n\nOrder: *${quotationNumber}*\nRemarks: ${remarks || '—'}`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (err: any) {
        await ctx.reply(`❌ Error: ${err.message}`, {
          parse_mode: 'Markdown',
          ...cancelButton(),
        });
      }
      break;
    }

    // ── Record Payment ──────────────────────────────────────────────
    case 'awaiting_order_number_for_payment': {
      const quotationNumber = text;
      try {
        const res = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
        if (!res.ok) {
          await ctx.reply(`❌ Order *${quotationNumber}* not found.`, {
            parse_mode: 'Markdown',
            ...cancelButton(),
          });
          return;
        }
      } catch {
        await ctx.reply(`❌ Error checking order *${quotationNumber}*.`, {
          parse_mode: 'Markdown',
          ...cancelButton(),
        });
        return;
      }
      setStep(chatId, { action: 'awaiting_payment_status', quotationNumber });
      await ctx.reply(
        `💵 *Payment for ${quotationNumber}*\n\nHas the payment been confirmed?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Confirmed', `payment:confirmed:${quotationNumber}`)],
            [Markup.button.callback('⏳ Received (pending confirm)', `payment:pending:${quotationNumber}`)],
            [Markup.button.callback('❌ Cancel', 'action:cancel')],
          ]),
        }
      );
      break;
    }

    // ── Link Order ──────────────────────────────────────────────────
    case 'awaiting_order_number_for_link': {
      const quotationNumber = text;
      try {
        const order: any = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
        const session = getSession(chatId);
        session.linkedOrder = order.quotation_number;
        resetStep(chatId);
        await ctx.reply(
          `🔗 *Linked to ${order.quotation_number}*\n\nUploaded files will be attached to this order.\n\nSend a document or photo to upload, or choose another action.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch {
        await ctx.reply(`❌ Order *${quotationNumber}* not found.`, {
          parse_mode: 'Markdown',
          ...cancelButton(),
        });
      }
      break;
    }

    // ── Deposit Slip Client Name Input ─────────────────────────────
    case 'awaiting_deposit_client_name': {
      const clientName = text.trim();

      // Allow cancel
      if (clientName.toLowerCase() === 'cancel') {
        resetStep(chatId);
        await ctx.reply('❌ Deposit recording cancelled.', {
          parse_mode: 'Markdown',
          ...mainMenuKeyboard(),
        });
        return;
      }

      const { depositAmount, imageBase64, mimeType, fileName, paymentDate } = session.step;

      await ctx.reply(`🔍 Looking up client *${escapeMarkdown(clientName)}*...`, {
        parse_mode: 'Markdown',
      });

      try {
        // Record deposit via match-and-record (no Google Drive upload — deposit slips not stored)
        const res = await fetch(`${apiBaseUrl}/deposits/match-and-record`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: depositAmount,
            client_name: clientName,
            image_url: null,
            deposit_paid_at: paymentDate ?? null,
          }),
        });

        const data = await res.json();

        if (!res.ok || !data.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        resetStep(chatId);

        botLog({
          chatId, userId, username: ctx.from?.username,
          messageType: 'deposit',
          content: `deposit_recorded: ${data.quotation_number} ₱${depositAmount} (by name: ${clientName})`,
          metadata: { quotationNumber: data.quotation_number, amount: depositAmount, clientName, driveLink: depositImageUrl },
          status: 'success',
        });

        const successMsg =
          `✅ *Downpayment Recorded Successfully!*\n\n` +
          `👤 Client: *${escapeMarkdown(data.client_name)}*\n` +
          `📋 Order: *${data.quotation_number}*\n` +
          `💰 Amount: ₱${depositAmount.toLocaleString()}\n` +
          (data.expected_deposit
            ? `💵 Expected Downpayment (50%): ₱${Number(data.expected_deposit).toLocaleString()}\n`
            : '') +
          (depositImageUrl ? `🔗 [View Deposit Slip](${depositImageUrl})\n` : '') +
          `\nProduction can now proceed.`;

        await ctx.reply(successMsg, {
          parse_mode: 'Markdown',
          ...mainMenuKeyboard(),
        });
      } catch (error: any) {
        console.error('[deposit] Client name lookup error:', error);
        botLog({
          chatId, userId: String(ctx.from?.id ?? ''), username: ctx.from?.username,
          messageType: 'deposit',
          content: `deposit_error_by_name: ${clientName}`,
          metadata: { clientName, depositAmount, errorMessage: String(error.message ?? error) },
          status: 'error',
        });

        // Keep the step so user can retry
        await ctx.reply(
          `❌ ${error.message}\n\nPlease check the name and try again, or type *cancel* to go back.`,
          { parse_mode: 'Markdown', ...cancelButton() }
        );
      }
      break;
    }

    // ── Client Search ───────────────────────────────────────────────
    case 'awaiting_client_search': {
      const searchText = text.trim();
      if (searchText.toLowerCase() === 'cancel') {
        resetStep(chatId);
        await ctx.reply('❌ Cancelled.', { parse_mode: 'Markdown', ...mainMenuKeyboard() });
        break;
      }
      try {
        if (searchText.toLowerCase() === 'list') {
          const clients: any[] = await getJson('/clients');
          if (clients.length === 0) {
            await ctx.reply('👤 No clients found in the database.', { parse_mode: 'Markdown', ...mainMenuKeyboard() });
            break;
          }
          const list = clients.slice(0, 20).map((c) => `• *${escapeMarkdown(c.client_name)}*`).join('\n');
          resetStep(chatId);
          await ctx.reply(`👤 *Clients:*\n\n${list}`, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
        } else {
          const client = await lookupClient(searchText);
          if (!client) {
            await ctx.reply(
              `❌ No client found matching "${escapeMarkdown(searchText)}".\n\nTry typing *list* to see all clients, or check the spelling.`,
              { parse_mode: 'Markdown', ...cancelButton() }
            );
            break;
          }
          const info = formatClientInfo(client);
          resetStep(chatId);
          await safeReply(
            ctx,
            `👤 *${escapeMarkdown(client.client_name)}*\n\n${info || 'No delivery details on file.'}`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard().reply_markup }
          );
        }
      } catch {
        await ctx.reply('❌ Error searching clients. Please try again.', { parse_mode: 'Markdown', ...cancelButton() });
      }
      break;
    }

    // ── Production Tracking Text Handlers ────────────────────────────
    case 'awaiting_delay_days': {
      const { orderId, quotationNumber } = session.step;
      const days = parseInt(text, 10);
      if (isNaN(days) || days < 0) {
        await ctx.reply('❌ Please enter a valid number of days (e.g., `5`).', { parse_mode: 'Markdown', ...cancelButton() });
        break;
      }
      try {
        await postJson(`/orders/${orderId}/report-production-status`, {
          on_time: false,
          delay_days: days,
        });
        resetStep(chatId);
        await ctx.reply(
          `⚠️ *Delay Recorded* — ${quotationNumber}\n\nDelay of ${days} day(s) has been recorded. The dashboard has been updated.\n\nA reminder will be sent at the estimated completion date.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (err: any) {
        await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
      }
      break;
    }

    case 'awaiting_custom_delivery_days': {
      const { orderId: cOrderId, quotationNumber: cQuotationNumber } = session.step;
      const deliveryDays = parseInt(text, 10);
      if (isNaN(deliveryDays) || deliveryDays < 1) {
        await ctx.reply('❌ Please enter a valid number of days (e.g., `14`).', { parse_mode: 'Markdown', ...cancelButton() });
        break;
      }
      try {
        await postJson(`/orders/${cOrderId}/finish-production`, {
          delivery_estimated_days: deliveryDays,
        });
        // Ask: Is the order en route?
        setStep(chatId, { action: 'awaiting_en_route', orderId: cOrderId, quotationNumber: cQuotationNumber });
        await ctx.reply(
          `✅ *Delivery Timeline Set* — ${cQuotationNumber}\n\nProduction is finished. Estimated delivery availability: *${deliveryDays} days*.\n\n🚚 Is the order en route to the client?`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('✅ Yes, it\'s en route', `en_route:yes:${cOrderId}:${cQuotationNumber}`)],
              [Markup.button.callback('❌ Not yet', `en_route:no:${cOrderId}:${cQuotationNumber}`)],
            ]),
          }
        );
      } catch (err: any) {
        await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
      }
      break;
    }

    case 'awaiting_en_route_arrival_days': {
      const { orderId: eOrderId, quotationNumber: eQuotationNumber } = session.step;
      const arrivalDays = parseInt(text, 10);
      if (isNaN(arrivalDays) || arrivalDays < 1) {
        await ctx.reply('❌ Please enter a valid number of days (e.g., `28`).', { parse_mode: 'Markdown', ...cancelButton() });
        break;
      }
      try {
        await postJson(`/orders/${eOrderId}/confirm-en-route`, {
          estimated_arrival_days: arrivalDays,
        });

        resetStep(chatId);
        await ctx.reply(
          `✅ *En Route Confirmed* — ${eQuotationNumber}\n\nEstimated inventory arrival: *${arrivalDays} days*.\n\nThe order has moved to the next stage.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (err: any) {
        await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
      }
      break;
    }

    // ── Partial Production — enter missing items ────────────────────
    case 'awaiting_partial_missing_items': {
      const { orderId, quotationNumber } = session.step;
      const items = text.replace(/\r/g, '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
      if (items.length === 0) {
        await ctx.reply(
          '❌ No items entered. Please list the missing items (comma-separated or one per line).',
          { parse_mode: 'Markdown', ...cancelButton() }
        );
        return;
      }
      try {
        await postJson(`/orders/${orderId}/partial-production`, { missing_items: items });
        resetStep(chatId);
        const list = items.map(i => `• ${i}`).join('\n');
        await ctx.reply(
          `⚠️ *Partial Production Noted — ${quotationNumber}*\n\nItems still pending:\n${list}\n\nA daily reminder will track these items until all are produced.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (err: any) {
        await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
      }
      break;
    }

    // ── Partial Production — update which items are now done ────────
    case 'awaiting_partial_items_update': {
      const { orderId, quotationNumber, remainingItems } = session.step;
      const raw = text.trim().toLowerCase();

      let nowDone: string[];
      let newRemaining: string[];

      if (raw === 'all') {
        nowDone = [...remainingItems];
        newRemaining = [];
      } else {
        const inputItems = text.replace(/\r/g, '').split(/[\n,]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
        nowDone = remainingItems.filter(item =>
          inputItems.some(input => item.toLowerCase().includes(input) || input.includes(item.toLowerCase()))
        );
        newRemaining = remainingItems.filter(item => !nowDone.includes(item));
      }

      if (nowDone.length === 0) {
        const list = remainingItems.map(i => `• ${i}`).join('\n');
        await ctx.reply(
          `❌ Couldn't match any items. Still pending:\n${list}\n\nPlease type the exact item names, or type \`all\` if all are done.`,
          { parse_mode: 'Markdown', ...cancelButton() }
        );
        return;
      }

      try {
        await postJson(`/orders/${orderId}/partial-production-items`, { remaining_items: newRemaining });
        resetStep(chatId);
        const doneList = nowDone.map(i => `✅ ${i}`).join('\n');
        if (newRemaining.length === 0) {
          await ctx.reply(
            `🎉 *All Items Produced — ${quotationNumber}*\n\n${doneList}\n\nAll pending items have been confirmed produced! Daily reminders have been stopped.`,
            { parse_mode: 'Markdown', ...mainMenuKeyboard() }
          );
        } else {
          const remainList = newRemaining.map(i => `• ${i}`).join('\n');
          await ctx.reply(
            `✅ *Updated — ${quotationNumber}*\n\nMarked as produced:\n${doneList}\n\nStill pending:\n${remainList}\n\nThe daily reminder will continue tracking these items.`,
            { parse_mode: 'Markdown', ...mainMenuKeyboard() }
          );
        }
      } catch (err: any) {
        await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
      }
      break;
    }

    default:
      // Do NOT reset — preserve active flow. Show guidance instead.
      await ctx.reply(
        '❓ I didn\'t understand that. You are currently in a flow. Please follow the prompts above, or press *Cancel* to go back to the Main Menu.',
        { parse_mode: 'Markdown', ...cancelButton() }
      );
  }
});

// ── Inline Callback Handlers ───────────────────────────────────────────

// Production status callback
bot.action(/^produce:(yes|no):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const status = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `produce:${status}:${quotationNumber}`,
    direction: 'incoming',
  });

  if (status === 'no') {
    await postJson('/stage-updates', {
      quotation_number: quotationNumber,
      stage: 'production_pending',
      status: 'no',
      remarks: 'Not yet started',
      updated_by: ctx.from?.username ?? String(ctx.from?.id),
    });
    resetStep(chatId);
    await ctx.editMessageText(
      `✅ Noted. Production for *${quotationNumber}* has not started yet. Reminders will continue.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } else {
    setStep(chatId, { action: 'awaiting_produce_remarks', quotationNumber, status: 'yes' });
    await ctx.editMessageText(
      `✅ Production started for *${quotationNumber}*.\n\nEnter the estimated timeline (e.g., \`10 days\`):`,
      { parse_mode: 'Markdown', ...cancelButton() }
    );
  }
});

// Partial production: ask for missing items
bot.action(/^produce:partial:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const quotationNumber = ctx.match[1];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `produce:partial:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    const order = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    setStep(chatId, { action: 'awaiting_partial_missing_items', orderId: order.id, quotationNumber });
    await ctx.editMessageText(
      `⚠️ *Partial Production — ${quotationNumber}*\n\nWhich items are NOT yet produced or ordered?\n\nList them comma-separated or one per line:\n\nExample:\n\`chairs, tables, shelves\``,
      { parse_mode: 'Markdown', ...cancelButton() }
    );
  } catch (err: any) {
    await ctx.editMessageText(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
  }
});

// Partial production: update which items are now done (from daily reminder button)
bot.action(/^partial_production:update:([^:]+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `partial_production:update:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    const order = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    const remainingItems: string[] = Array.isArray(order.partial_production_items)
      ? order.partial_production_items
      : [];

    if (remainingItems.length === 0) {
      resetStep(chatId);
      await ctx.editMessageText(
        `✅ All items are already marked as produced for *${quotationNumber}*.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
      return;
    }

    const list = remainingItems.map(i => `• ${i}`).join('\n');
    setStep(chatId, { action: 'awaiting_partial_items_update', orderId, quotationNumber, remainingItems });
    await ctx.editMessageText(
      `📝 *Update Items — ${quotationNumber}*\n\nCurrently pending:\n${list}\n\nWhich items have been produced? (comma or newline separated, or type \`all\` if all are done):`,
      { parse_mode: 'Markdown', ...cancelButton() }
    );
  } catch (err: any) {
    await ctx.editMessageText(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
  }
});

// Payment status callback
// payment:confirmed:orderId:quotationNumber (from inline keyboards)
// OR payment:confirmed:quotationNumber (from /payment command, legacy)
bot.action(/^payment:(confirmed|pending):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const status = ctx.match[1];
  const rest = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  // Support both formats: "orderId:quotationNumber" and just "quotationNumber"
  const parts = rest.split(':');
  const quotationNumber = parts.length >= 2 ? parts.slice(1).join(':') : rest;
  const orderId = parts.length >= 2 ? parts[0] : '';

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `payment:${status}:${rest}`,
    direction: 'incoming',
  });

  try {
    await postJson('/stage-updates', {
      quotation_number: quotationNumber,
      stage: status === 'confirmed' ? 'payment_confirmed' : 'payment_received',
      status,
      remarks: status === 'confirmed' ? 'Payment confirmed' : 'Payment received, pending confirmation',
      updated_by: ctx.from?.username ?? String(ctx.from?.id),
    });
    resetStep(chatId);
    const msg = status === 'confirmed'
      ? `✅ *Payment Confirmed*\n\nOrder: *${quotationNumber}*\n\nOrder is now complete! 🏁`
      : `💰 *Payment Received*\n\nOrder: *${quotationNumber}*\n\nAwaiting confirmation.`;
    await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
  } catch (err: any) {
    await ctx.editMessageText(`❌ Error: ${err.message}`, {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  }
});

// ── Production Tracking Callback Handlers ────────────────────────────
// Workflow:
//   1. Midpoint reminder sent → user clicks "On Time" or "Delayed"
//   2. If Delayed → bot asks how many days delay
//   3. Production due reminder sent → user clicks "Finished" or "Not Yet"
//   4. If Finished → bot asks delivery timeline (standard 4 weeks or custom)

// Midpoint check: On Time
bot.action(/^production:ontime:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `production:ontime:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    // Report on-time status to API
    await postJson(`/orders/${orderId}/report-production-status`, {
      on_time: true,
      delay_days: 0,
    });

    resetStep(chatId);
    await ctx.editMessageText(
      `✅ *On Time* — ${quotationNumber}\n\nProduction is on schedule. A reminder will be sent at the estimated completion date.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } catch (err: any) {
    await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// Midpoint check: Delayed
bot.action(/^production:delayed:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `production:delayed:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  // Set step to ask for delay days
  setStep(chatId, { action: 'awaiting_delay_days', orderId, quotationNumber });
  await ctx.editMessageText(
    `⚠️ *Delayed* — ${quotationNumber}\n\nHow many days is the delay? (Enter a number)`,
    { parse_mode: 'Markdown', ...cancelButton() }
  );
});

// Production due: Finished
bot.action(/^production:finished:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `production:finished:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  // Ask for delivery timeline (how many days until available for delivery)
  setStep(chatId, { action: 'awaiting_delivery_timeline', orderId, quotationNumber });
  await ctx.editMessageText(
    `✅ *Production Finished* — ${quotationNumber}\n\nHow long until it's available for delivery?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📦 Standard (4 weeks)', `production:delivery_standard:${orderId}:${quotationNumber}`)],
        [Markup.button.callback('📦 Custom', `production:delivery_custom:${orderId}:${quotationNumber}`)],
        [Markup.button.callback('❌ Cancel', 'action:cancel')],
      ]),
    }
  );
});

// Production due: Not Yet Finished
bot.action(/^production:not_finished:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `production:not_finished:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  // Re-create the production_due reminder for tomorrow
  try {
    const orderRes = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
    const order = await orderRes.json();
    const groupChatId = process.env.PURCHASING_GROUP_ID;
    if (groupChatId && order) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      await postJson('/reminders', {
        order_id: orderId,
        stage: 'production_due',
        group_chat_id: groupChatId,
        message: `🏭 *Production Due* — ${quotationNumber} (${order.client_name ?? 'Unknown'})\nEstimated production should be complete now.\nIs production finished?`,
        frequency: 'once',
        next_run_at: tomorrow.toISOString(),
      });
    }

    resetStep(chatId);
    await ctx.editMessageText(
      `⏳ *Noted* — ${quotationNumber}\n\nProduction is not yet finished. A reminder will be sent again tomorrow.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } catch (err: any) {
    await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// ── Item-Level Production Callback Handlers ──────────────────────────────
// These handle the process-of-elimination item-by-item production tracking.
// Callback format: item_prod:{status}:{itemId}:{orderId}
//   status = finished | in_progress | pending

bot.action(/^item_prod:(finished|in_progress|pending):([^:]+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const newStatus = ctx.match[1];
  const itemId = ctx.match[2];
  const orderId = ctx.match[3];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `item_prod:${newStatus}:${itemId}:${orderId}`,
    direction: 'incoming',
  });

  try {
    // Update the item's production status via API
    await postJson(`/orders/${orderId}/items/${itemId}`, {
      production_status: newStatus,
    });

    // Add a production update log
    const statusLabels: Record<string, string> = {
      finished: '✅ Finished',
      in_progress: '🔄 In Progress',
      pending: '⏳ Not Yet Started',
    };
    await postJson(`/orders/${orderId}/production-logs`, {
      order_item_id: itemId,
      note: `Item production status updated to: ${statusLabels[newStatus]}`,
      log_type: 'telegram',
      created_by: username ?? `user_${userId}`,
    });

    // Fetch updated completion and items to show next question
    const completionRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items/completion`);
    const completion = await completionRes.json();

    const itemsRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items`);
    const items = await itemsRes.json();

    // Find the next unfinished item (process of elimination)
    const unfinishedItem = items?.items?.find(
      (item: any) => item.production_status !== 'finished'
    );

    if (!unfinishedItem) {
      // All items finished! Advance the order immediately
      await postJson(`/orders/${orderId}/production-logs`, {
        order_item_id: null,
        note: `✅ All items production finished (${completion?.production_pct ?? 100}% complete). Auto-advancing to en_route.`,
        log_type: 'telegram',
        created_by: username ?? `user_${userId}`,
      });

      // Use standard 28-day delivery estimate (same default used by the production agent)
      await postJson(`/orders/${orderId}/finish-production`, {
        delivery_estimated_days: 28,
      });

      await ctx.editMessageText(
        `✅ *All Items Production Finished!*\n\nOrder #${orderId.slice(0, 8)}\nAll items completed (${completion?.production_pct ?? 100}%).\n\nOrder has been auto-advanced to 🚚 En Route.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
    } else {
      // Ask about the next unfinished item (process of elimination)
      const finishedCount = items.items.filter((i: any) => i.production_status === 'finished').length;
      const totalCount = items.items.length;
      const prodPct = completion?.production_pct ?? 0;

      const progressBar = '█'.repeat(Math.round(prodPct / 10)) + '░'.repeat(10 - Math.round(prodPct / 10));

      let msg = `🏗️ *Item-Level Production*\n\n`;
      msg += `Progress: ${prodPct}% complete ${progressBar}\n`;
      msg += `Items: ${finishedCount}/${totalCount} finished\n\n`;
      msg += `*Process of Elimination:*\n`;
      msg += `Next item: *${unfinishedItem.name}* x${unfinishedItem.quantity}\n\n`;
      msg += `Has *${unfinishedItem.name}* started or finished production?`;

      await ctx.editMessageText(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`✅ ${unfinishedItem.name} — Finished`, `item_prod:finished:${unfinishedItem.id}:${orderId}`)],
          [Markup.button.callback(`🔄 ${unfinishedItem.name} — In Progress`, `item_prod:in_progress:${unfinishedItem.id}:${orderId}`)],
          [Markup.button.callback(`⏳ ${unfinishedItem.name} — Not Yet`, `item_prod:pending:${unfinishedItem.id}:${orderId}`)],
        ]),
      });
    }
  } catch (err: any) {
    await ctx.reply(`❌ Error updating item production: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// ── Item-Level En Route Callback Handlers ────────────────────────────────
// These handle the process-of-elimination item-by-item en-route tracking.
// Callback format: item_en_route:{status}:{itemId}:{orderId}
//   status = yes | no | arrived

bot.action(/^item_en_route:(yes|no|arrived):([^:]+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const newStatus = ctx.match[1];
  const itemId = ctx.match[2];
  const orderId = ctx.match[3];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `item_en_route:${newStatus}:${itemId}:${orderId}`,
    direction: 'incoming',
  });

  try {
    // Map callback status to en_route_status value
    const statusMap: Record<string, string> = {
      yes: 'en_route',
      no: 'not_yet',
      arrived: 'arrived',
    };
    const enRouteStatus = statusMap[newStatus];

    // Update the item's en_route status via API
    await postJson(`/orders/${orderId}/items/${itemId}`, {
      en_route_status: enRouteStatus,
    });

    // Add a production update log
    const statusLabels: Record<string, string> = {
      yes: '🚚 En Route',
      no: '⏳ Not Yet En Route',
      arrived: '📦 Arrived at Inventory',
    };
    await postJson(`/orders/${orderId}/production-logs`, {
      order_item_id: itemId,
      note: `Item en-route status updated to: ${statusLabels[newStatus]}`,
      log_type: 'telegram',
      created_by: username ?? `user_${userId}`,
    });

    // Fetch updated completion and items to show next question
    const completionRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items/completion`);
    const completion = await completionRes.json();

    const itemsRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items`);
    const items = await itemsRes.json();

    // Calculate en-route % based on quantity
    const totalQty = items.items.reduce((sum: number, i: any) => sum + (i.quantity ?? 1), 0);
    const enRouteQty = items.items
      .filter((i: any) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived')
      .reduce((sum: number, i: any) => sum + (i.quantity ?? 1), 0);
    const enRoutePct = totalQty > 0 ? Math.round((enRouteQty / totalQty) * 100) : 0;
    const thresholdMet = enRoutePct > 50;

    // Find the next item not yet en route (process of elimination)
    const notEnRouteItem = items.items?.find(
      (item: any) => item.en_route_status === 'not_yet'
    );

    if (!notEnRouteItem) {
      // All items en route! Advance the order immediately
      await postJson(`/orders/${orderId}/production-logs`, {
        order_item_id: null,
        note: `✅ All items en route (${enRoutePct}% of qty). Auto-advancing to inventory_arrived.`,
        log_type: 'telegram',
        created_by: username ?? `user_${userId}`,
      });

      // Use standard 28-day arrival estimate (same default used by the production agent)
      await postJson(`/orders/${orderId}/confirm-en-route`, {
        estimated_arrival_days: 28,
      });

      await ctx.editMessageText(
        `✅ *All Items En Route!*\n\nOrder #${orderId.slice(0, 8)}\nAll items en route (${enRoutePct}% of qty).\n\nOrder has been auto-advanced to 📦 Inventory Arrived.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
    } else {
      // Ask about the next not-en-route item (process of elimination)
      const enRouteCount = items.items.filter((i: any) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived').length;
      const totalCount = items.items.length;

      const progressBar = '█'.repeat(Math.round(enRoutePct / 10)) + '░'.repeat(10 - Math.round(enRoutePct / 10));

      let msg = `🚚 *Item-Level En Route*\n\n`;
      msg += `En Route: ${enRoutePct}% of qty ${progressBar}\n`;
      msg += `Items: ${enRouteCount}/${totalCount} en route\n`;
      if (thresholdMet) {
        msg += `✅ *>50% threshold met* — order can progress once all confirmed\n\n`;
      }
      msg += `*Process of Elimination:*\n`;
      msg += `Next item: *${notEnRouteItem.name}* x${notEnRouteItem.quantity}\n\n`;
      msg += `Is *${notEnRouteItem.name}* en route yet?`;

      await ctx.editMessageText(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`🚚 ${notEnRouteItem.name} — Yes, En Route`, `item_en_route:yes:${notEnRouteItem.id}:${orderId}`)],
          [Markup.button.callback(`❌ ${notEnRouteItem.name} — Not Yet`, `item_en_route:no:${notEnRouteItem.id}:${orderId}`)],
          [Markup.button.callback(`📦 ${notEnRouteItem.name} — Arrived`, `item_en_route:arrived:${notEnRouteItem.id}:${orderId}`)],
        ]),
      });
    }
  } catch (err: any) {
    await ctx.reply(`❌ Error updating item en-route: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// Delivery timeline: Standard (4 weeks)
bot.action(/^production:delivery_standard:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `production:delivery_standard:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    // Finish production with standard 4 weeks (28 days) delivery estimate
    await postJson(`/orders/${orderId}/finish-production`, {
      delivery_estimated_days: 28,
    });

    // Now ask: Is the order en route?
    setStep(chatId, { action: 'awaiting_en_route', orderId, quotationNumber });
    await ctx.editMessageText(
      `✅ *Delivery Timeline Set* — ${quotationNumber}\n\nProduction is finished. Estimated delivery availability: *4 weeks (28 days)*.\n\n🚚 Is the order en route to the client?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Yes, it\'s en route', `en_route:yes:${orderId}:${quotationNumber}`)],
          [Markup.button.callback('❌ Not yet', `en_route:no:${orderId}:${quotationNumber}`)],
        ]),
      }
    );
  } catch (err: any) {
    await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// Delivery timeline: Custom
bot.action(/^production:delivery_custom:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `production:delivery_custom:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  // Ask for custom delivery days
  setStep(chatId, { action: 'awaiting_custom_delivery_days', orderId, quotationNumber });
  await ctx.editMessageText(
    `📦 *Custom Delivery Timeline* — ${quotationNumber}\n\nEnter the number of days until available for delivery:`,
    { parse_mode: 'Markdown', ...cancelButton() }
  );
});

// ── En Route Callback Handlers ────────────────────────────────────────
// After production is finished, the bot asks "Is the order en route?"
// If yes → ask for estimated arrival days (28 days default or custom)
// If no → daily reminder will keep asking

// En Route: Yes — ask for estimated arrival days
bot.action(/^en_route:yes:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `en_route:yes:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  setStep(chatId, { action: 'awaiting_en_route_arrival_days', orderId, quotationNumber });
  await ctx.editMessageText(
    `🚚 *En Route Confirmed* — ${quotationNumber}\n\nHow many days estimated for inventory to arrive?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📦 28 days (Standard)', `en_route:arrival_standard:${orderId}:${quotationNumber}`)],
        [Markup.button.callback('📦 Custom days', `en_route:arrival_custom:${orderId}:${quotationNumber}`)],
        [Markup.button.callback('❌ Cancel', 'action:cancel')],
      ]),
    }
  );
});

// En Route: No — remind daily (the en_route_reminder will handle this)
bot.action(/^en_route:no:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `en_route:no:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  resetStep(chatId);
  await ctx.editMessageText(
    `⏳ *Noted* — ${quotationNumber}\n\nThe order is not yet en route. A daily reminder will be sent to check again.\n\nWhen the order is en route, use the menu to confirm.`,
    { parse_mode: 'Markdown', ...mainMenuKeyboard() }
  );
});

// En Route: Standard arrival (28 days)
bot.action(/^en_route:arrival_standard:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `en_route:arrival_standard:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    await postJson(`/orders/${orderId}/confirm-en-route`, {
      estimated_arrival_days: 28,
    });

    resetStep(chatId);
    await ctx.editMessageText(
      `✅ *En Route Confirmed* — ${quotationNumber}\n\nEstimated inventory arrival: *28 days*.\n\nThe order has moved to the next stage.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } catch (err: any) {
    await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// En Route: Custom arrival days
bot.action(/^en_route:arrival_custom:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `en_route:arrival_custom:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  setStep(chatId, { action: 'awaiting_en_route_arrival_days', orderId, quotationNumber });
  await ctx.editMessageText(
    `📦 *Custom Arrival Days* — ${quotationNumber}\n\nEnter the number of days estimated for inventory to arrive:`,
    { parse_mode: 'Markdown', ...cancelButton() }
  );
});

// ── Inventory Arrived Callback Handlers ──────────────────────────────

// User confirmed inventory is ready for delivery → advance to balance_due stage
bot.action(/^inventory:ready:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `inventory:ready:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    // Advance to balance_due stage via /stage-updates (accepts quotation_number)
    await postJson('/stage-updates', {
      quotation_number: quotationNumber,
      stage: 'balance_due',
      status: 'auto_advanced',
      remarks: 'Inventory arrived — ready for delivery, balance payment required',
      updated_by: 'delivery-agent',
    });

    await ctx.editMessageText(
      `✅ *Inventory Ready* — ${quotationNumber}\n\n` +
      `Stage advanced to ⚖️ *Balance Due*.\n\n` +
      `Please collect the balance payment from the client.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('💰 Pay Balance', `pick:paybalance:${quotationNumber}`)],
          [Markup.button.callback('🏠 Main Menu', 'menu:main')],
        ]),
      }
    );
  } catch (err: any) {
    await ctx.editMessageText(
      `❌ Error updating order: ${err.message}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// User said inventory is still waiting
bot.action(/^inventory:waiting:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `inventory:waiting:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  await ctx.editMessageText(
    `⏳ *Still Waiting* — ${quotationNumber}\n\nNoted. The bot will check again tomorrow.\nPlease update once the inventory is ready for delivery.`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 Main Menu', 'menu:main')]]) }
  );
});

// ── Item-Level Inventory Arrival Callback Handlers ──────────────────────
// These handle the process-of-elimination item-by-item inventory tracking.
// Callback format: item_inventory:{status}:{itemId}:{orderId}
//   status = arrived | en_route | not_yet

bot.action(/^item_inventory:(arrived|en_route|not_yet):([^:]+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const newStatus = ctx.match[1];
  const itemId = ctx.match[2];
  const orderId = ctx.match[3];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `item_inventory:${newStatus}:${itemId}:${orderId}`,
    direction: 'incoming',
  });

  try {
    // Update the item's en_route_status via API
    await postJson(`/orders/${orderId}/items/${itemId}`, {
      en_route_status: newStatus,
    });

    // Add a production update log
    const statusLabels: Record<string, string> = {
      arrived: '📦 Arrived at Inventory',
      en_route: '🚚 En Route to Inventory',
      not_yet: '⏳ Not Yet Arrived',
    };
    await postJson(`/orders/${orderId}/production-logs`, {
      order_item_id: itemId,
      note: `Item inventory status updated to: ${statusLabels[newStatus]}`,
      log_type: 'telegram',
      created_by: username ?? `user_${userId}`,
    });

    // Fetch updated completion and items to show next question
    const completionRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items/completion`);
    const completion = await completionRes.json();

    const itemsRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items`);
    const items = await itemsRes.json();

    // Calculate inventory % based on quantity
    const totalQty = items.items.reduce((sum: number, i: any) => sum + (i.quantity ?? 1), 0);
    const arrivedQty = items.items
      .filter((i: any) => i.en_route_status === 'arrived')
      .reduce((sum: number, i: any) => sum + (i.quantity ?? 1), 0);
    const inventoryPct = totalQty > 0 ? Math.round((arrivedQty / totalQty) * 100) : 0;

    // Find the next item not yet arrived (process of elimination)
    const notArrivedItem = items.items?.find(
      (item: any) => item.en_route_status !== 'arrived'
    );

    if (!notArrivedItem) {
      // All items arrived! Notify ready for delivery
      await postJson(`/orders/${orderId}/production-logs`, {
        order_item_id: null,
        note: `✅ All items arrived at inventory (${inventoryPct}% of qty). Ready for delivery confirmation.`,
        log_type: 'telegram',
        created_by: username ?? `user_${userId}`,
      });

      await ctx.editMessageText(
        `✅ *All Items Arrived at Inventory!*\n\nOrder #${orderId.slice(0, 8)}\nAll items arrived (${inventoryPct}% of qty).\n\nReady for delivery! Please confirm below:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Ready for Delivery', `inventory:ready:${orderId}:${orderId.slice(0, 8)}`)],
            [Markup.button.callback('⏳ Still Waiting', `inventory:waiting:${orderId}:${orderId.slice(0, 8)}`)],
          ]),
        }
      );
    } else {
      // Ask about the next not-arrived item (process of elimination)
      const arrivedCount = items.items.filter((i: any) => i.en_route_status === 'arrived').length;
      const totalCount = items.items.length;

      const progressBar = '█'.repeat(Math.round(inventoryPct / 10)) + '░'.repeat(10 - Math.round(inventoryPct / 10));

      let msg = `📦 *Item-Level Inventory Check*\n\n`;
      msg += `Inventory: ${inventoryPct}% arrived ${progressBar}\n`;
      msg += `Items: ${arrivedCount}/${totalCount} arrived\n\n`;
      msg += `*Process of Elimination:*\n`;
      msg += `Next item: *${notArrivedItem.name}* x${notArrivedItem.quantity}\n\n`;
      msg += `Has *${notArrivedItem.name}* arrived at inventory?`;

      await ctx.editMessageText(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`📦 ${notArrivedItem.name} — Arrived`, `item_inventory:arrived:${notArrivedItem.id}:${orderId}`)],
          [Markup.button.callback(`🚚 ${notArrivedItem.name} — En Route`, `item_inventory:en_route:${notArrivedItem.id}:${orderId}`)],
          [Markup.button.callback(`⏳ ${notArrivedItem.name} — Not Yet`, `item_inventory:not_yet:${notArrivedItem.id}:${orderId}`)],
        ]),
      });
    }
  } catch (err: any) {
    await ctx.reply(`❌ Error updating item inventory: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// ── Balance Payment Callback Handlers ────────────────────────────────

// User confirmed client paid the balance → ask for proof of payment photo
bot.action(/^balance:paid:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `balance:paid:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  setStep(chatId, { action: 'awaiting_balance_proof_photo', orderId, quotationNumber });

  await ctx.editMessageText(
    `📸 *Balance Payment Proof Required* — ${quotationNumber}\n\n` +
    `Please send a **photo of the deposit slip or proof of payment** so we can record the amount and date of the balance payment.\n\n` +
    `The AI will scan the image to extract the payment details automatically.`,
    { parse_mode: 'Markdown', ...cancelButton() }
  );
});

// User said client has NOT paid yet
bot.action(/^balance:not_paid:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `balance:not_paid:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  await ctx.editMessageText(
    `⏳ *Payment Pending* — ${quotationNumber}\n\nNoted. The bot will check again tomorrow.\nPlease remind the client about the balance payment.`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 Main Menu', 'menu:main')]]) }
  );
});

// ── Delivery Day Check Callback Handlers ─────────────────────────────

// User confirmed item has been delivered
bot.action(/^delivery:yes:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `delivery:yes:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    // Advance to delivered stage
    await postJson('/stage-updates', {
      quotation_number: quotationNumber,
      stage: 'delivered',
      status: 'auto_advanced',
      remarks: 'Delivery confirmed via bot callback',
      updated_by: 'delivery-agent',
    });

    await ctx.editMessageText(
      `✅ *Delivery Confirmed* — ${quotationNumber}\n\nStage advanced to 📦 *Delivered*.\n\nPlease record the payment status.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('💵 Record Payment', `pick:payment:${quotationNumber}`)],
          [Markup.button.callback('🏠 Main Menu', 'menu:main')],
        ]),
      }
    );
  } catch (err: any) {
    await ctx.editMessageText(
      `❌ Error updating delivery status: ${err.message}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// User said item has NOT been delivered yet
bot.action(/^delivery:no:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `delivery:no:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  await ctx.editMessageText(
    `⏳ *Delivery Pending* — ${quotationNumber}\n\nNoted. The bot will check again tomorrow.\nPlease update once the item has been delivered.`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 Main Menu', 'menu:main')]]) }
  );
});

// ── Gemini Vision Callback Handlers ──────────────────────────────────
// Workflow:
//   1. User sends image/PDF → bot asks "Process this order?" (Yes/No)
//   2. If Yes → bot asks "Extract info from image/PDF?" (Yes/No)
//   3. If Yes to extract → Gemini extracts → share link to dashboard GUI
//   4. If No to extract → upload to Drive
//   5. If No to process → do nothing

// Step 1: User said Yes to "Process this order?" → ask about extraction
// User said the document is a Quotation/Order — proceed to extract
bot.action('vision:type_quotation', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);

  if (session.step.action !== 'awaiting_vision_document_type') {
    return ctx.editMessageText('⏳ This session has expired. Please upload the file again.', {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  }

  const { imageBase64, mimeType, fileName } = session.step;

  // Store data for next step (same as vision:process_yes)
  setStep(chatId, {
    action: 'awaiting_vision_extract',
    imageBase64,
    mimeType,
    fileName,
  });

  await ctx.editMessageText(
    `📄 *Quotation/Order detected:* ${escapeMarkdown(fileName)}\n\n` +
    `Do you want me to extract the information using AI?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Yes, extract info', 'vision:extract_yes')],
        [Markup.button.callback('📤 Just upload to Drive', 'vision:upload')],
        [Markup.button.callback('❌ Cancel', 'action:cancel')],
      ]),
    }
  );
});

// User said the document is a Deposit Slip/Payment — go directly to extraction
bot.action('vision:type_deposit', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);

  if (session.step.action !== 'awaiting_vision_document_type') {
    return ctx.editMessageText('⏳ This session has expired. Please upload the file again.', {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  }

  const { imageBase64, mimeType, fileName } = session.step;

  // Store data for next step
  setStep(chatId, {
    action: 'awaiting_vision_extract',
    imageBase64,
    mimeType,
    fileName,
  });

  await ctx.editMessageText(
    `💳 *Deposit Slip detected:* ${escapeMarkdown(fileName)}\n\n` +
    `Do you want me to extract the payment information using AI?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Yes, extract info', 'vision:extract_yes')],
        [Markup.button.callback('📤 Just upload to Drive', 'vision:upload')],
        [Markup.button.callback('❌ Cancel', 'action:cancel')],
      ]),
    }
  );
});

bot.action('vision:process_yes', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  if (session.step.action !== 'awaiting_vision_process') {
    return ctx.editMessageText('⏳ This session has expired. Please upload the file again.', {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  }

  const { imageBase64, mimeType, fileName } = session.step;

  botLog({
    chatId, userId, username,
    messageType: 'vision',
    content: `process_yes: ${fileName}`,
    metadata: { mimeType, fileName },
    direction: 'incoming',
  });

  // Store data for next step
  setStep(chatId, {
    action: 'awaiting_vision_extract',
    imageBase64,
    mimeType,
    fileName,
  });

  await ctx.editMessageText(
    `📄 *File received:* ${escapeMarkdown(fileName)}\n\n` +
    `Do you want me to extract the information from this image/PDF using AI?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Yes, extract info', 'vision:extract_yes')],
        [Markup.button.callback('📤 Just upload to Drive', 'vision:upload')],
        [Markup.button.callback('❌ No, do nothing', 'vision:ignore')],
      ]),
    }
  );
});

// Step 1: User said No to "Process this order?" → do nothing
bot.action('vision:process_no', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  resetStep(chatId);
  botLog({
    chatId, userId, username,
    messageType: 'vision',
    content: 'process_no',
    direction: 'incoming',
  });
  await ctx.editMessageText('✅ File ignored. Nothing was uploaded.', {
    parse_mode: 'Markdown',
    ...mainMenuKeyboard(),
  });
});

// Step 2: User said Yes to extract → call Gemini Vision, share to dashboard
bot.action('vision:extract_yes', async (ctx) => {
  await ctx.answerCbQuery('🤖 Analyzing...');
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  if (session.step.action !== 'awaiting_vision_extract') {
    return ctx.editMessageText('⏳ This session has expired. Please upload the file again.', {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  }

  const { imageBase64, mimeType, fileName } = session.step;

  // Show the image back to the user so they can see what's being analyzed
  try {
    const imgBuffer = Buffer.from(imageBase64, 'base64');
    if (/^image\//.test(mimeType)) {
      await ctx.replyWithPhoto({ source: imgBuffer, filename: fileName });
    } else {
      await ctx.replyWithDocument({ source: imgBuffer, filename: fileName });
    }
  } catch {
    // If sending the image fails (e.g., too large), just proceed with text
  }

  await ctx.editMessageText(`🤖 Analyzing with AI Vision...`);

  botLog({
    chatId, userId, username,
    messageType: 'vision',
    content: `extract_yes: ${fileName}`,
    metadata: { mimeType, fileName },
    direction: 'incoming',
  });

  try {
    // Call the API's vision/extract endpoint
    const res = await fetch(`${apiBaseUrl}/vision/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: imageBase64,
        mime_type: mimeType,
        mode: 'auto',
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = text ? JSON.parse(text) : { error: `Vision API error (HTTP ${res.status})` };
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();

    // Store the extracted data + image via the share endpoint
    const shareRes = await fetch(`${apiBaseUrl}/vision/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: imageBase64,
        mime_type: mimeType,
        file_name: fileName,
        extracted: data.quotation || data.payment || {},
        type: data.type,
        confidence: data.confidence,
        raw_text: data.raw_text || '',
      }),
    });

    if (!shareRes.ok) {
      throw new Error('Failed to create share link');
    }

    const shareData = await shareRes.json();
    const token = shareData.token;

    // Build dashboard URL
    const dashboardBase = process.env.DASHBOARD_BASE_URL ?? 'http://localhost:3000';
    const visionUrl = `${dashboardBase}/vision?token=${token}`;

    resetStep(chatId);

    // Log successful extraction
    botLog({
      chatId, userId, username,
      messageType: 'vision',
      content: `extracted: ${data.type} (${data.confidence})`,
      metadata: { fileName, type: data.type, confidence: data.confidence, token },
      status: 'success',
    });

    if (data.type === 'quotation' && data.quotation) {
      const q = data.quotation;
      const fields = [
        `📋 *Extracted Quotation Info:*`,
        q.quotation_number ? `🔢 Number: \`${q.quotation_number}\`` : null,
        q.client_name ? `👤 Client: ${q.client_name}` : null,
        q.sales_agent ? `🧑‍💼 Agent: ${q.sales_agent}` : null,
        q.total_amount ? `💰 Amount: ₱${Number(q.total_amount).toLocaleString()}` : null,
        `📊 Confidence: ${data.confidence}`,
      ].filter(Boolean).join('\n');

      await ctx.editMessageText(
        `${fields}\n\n` +
        `✅ *Information extracted!*\n\n` +
        `👉 [Open in Dashboard to review & create order](${visionUrl})\n\n` +
        `The extracted data has been sent to the dashboard. You can edit the fields and create the order there.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.url('🚀 Open in Dashboard', visionUrl)],
            [Markup.button.callback('📤 Upload to Drive instead', 'vision:upload')],
          ]),
        }
      );
    } else if (data.type === 'payment' && data.payment) {
      const p = data.payment;
      const depositAmount = p.amount ? Number(p.amount) : 0;
      const paymentDate: string | undefined = p.payment_date ?? undefined;
      const fields = [
        `💳 *Extracted Payment Info:*`,
        p.amount ? `💰 Amount: ₱${depositAmount.toLocaleString()}` : null,
        p.type !== 'unknown' ? `📌 Type: ${p.type}` : null,
        p.reference_number ? `🔖 Ref: \`${p.reference_number}\`` : null,
        p.paid_by ? `👤 Paid by: ${p.paid_by}` : null,
        paymentDate ? `📅 Date: ${paymentDate}` : null,
        `📊 Confidence: ${data.confidence}`,
      ].filter(Boolean).join('\n');

      if (depositAmount > 0) {
        // Try to match this deposit to an order
        try {
          const matchRes = await fetch(`${apiBaseUrl}/deposits/match-and-record`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: depositAmount }),
          });
          const matchData = await matchRes.json();

          if (matchData.ok && matchData.matched && matchData.candidates && matchData.candidates.length > 0) {
            const best = matchData.candidates[0];

            // Store candidates in session for confirmation
            setStep(chatId, {
              action: 'awaiting_deposit_confirmation',
              imageBase64,
              mimeType,
              fileName,
              depositAmount,
              candidates: matchData.candidates,
              paymentDate,
            });

            // Build keyboard with top candidate(s)
            const buttons: any[][] = [];
            for (const c of matchData.candidates) {
              const expectedPct = Math.round((1 - c.discrepancy / 100) * 100);
              buttons.push([
                Markup.button.callback(
                  `✅ Yes — ${c.client_name} (${c.quotation_number}) ${expectedPct}% match`,
                  `deposit:confirm_yes:${c.quotation_number}`
                ),
              ]);
            }
            buttons.push([Markup.button.callback('❌ No — different client', 'deposit:confirm_no')]);

            await ctx.editMessageText(
              `${fields}\n\n` +
              `🔍 *Deposit Matching*\n\n` +
              `I found an order that matches this deposit amount.\n\n` +
              `*Best Match:*\n` +
              `👤 Client: ${best.client_name}\n` +
              `📋 Order: ${best.quotation_number}\n` +
              `💰 Total: ₱${best.total_amount.toLocaleString()}\n` +
              `💵 Expected Deposit (50%): ₱${best.expected_deposit.toLocaleString()}\n` +
              `📊 Match: ${Math.round((1 - best.discrepancy / 100) * 100)}%\n\n` +
              `Is this the deposit for *${best.client_name}*?`,
              {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons),
              }
            );
          } else {
            // No deposit match found — try balance matching instead
            try {
              const balanceRes = await fetch(`${apiBaseUrl}/deposits/match-balance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: depositAmount }),
              });
              const balanceData = await balanceRes.json();

              if (balanceData.ok && balanceData.matched && balanceData.candidates && balanceData.candidates.length > 0) {
                // Balance match found!
                const best = balanceData.candidates[0];

                setStep(chatId, {
                  action: 'awaiting_deposit_confirmation',
                  imageBase64,
                  mimeType,
                  fileName,
                  depositAmount,
                  candidates: balanceData.candidates.map((c: any) => ({
                    quotation_number: c.quotation_number,
                    client_name: c.client_name,
                    total_amount: c.total_amount,
                    expected_deposit: c.expected_balance,
                    discrepancy: c.discrepancy,
                  })),
                  paymentDate,
                });

                const buttons: any[][] = [];
                for (const c of balanceData.candidates) {
                  const expectedPct = Math.round((1 - c.discrepancy / 100) * 100);
                  buttons.push([
                    Markup.button.callback(
                      `✅ Yes — ${c.client_name} (${c.quotation_number}) ${expectedPct}% match`,
                      `balance:confirm_yes:${c.quotation_number}`
                    ),
                  ]);
                }
                buttons.push([Markup.button.callback('❌ No — different client', 'deposit:confirm_no')]);

                await ctx.editMessageText(
                  `${fields}\n\n` +
                  `🔍 *Balance Payment Matching*\n\n` +
                  `This amount matches a *balance payment* for an order where deposit was already paid.\n\n` +
                  `*Best Match:*\n` +
                  `👤 Client: ${best.client_name}\n` +
                  `📋 Order: ${best.quotation_number}\n` +
                  `💰 Total: ₱${best.total_amount.toLocaleString()}\n` +
                  `💵 Deposit Paid: ₱${best.deposit_amount.toLocaleString()}\n` +
                  `⚖️ Expected Balance: ₱${best.expected_balance.toLocaleString()}\n` +
                  `📊 Match: ${Math.round((1 - best.discrepancy / 100) * 100)}%\n\n` +
                  `Is this the balance payment for *${best.client_name}*?`,
                  {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard(buttons),
                  }
                );
              } else {
                // No balance match either — ask user to type client name
                setStep(chatId, {
                  action: 'awaiting_deposit_client_name',
                  imageBase64,
                  mimeType,
                  fileName,
                  depositAmount,
                  paymentDate,
                });

                const otherCandidates = matchData.candidates && matchData.candidates.length > 0
                  ? matchData.candidates.map((c: any) =>
                      `• ${c.client_name} (${c.quotation_number}) — expected deposit: ₱${c.expected_deposit.toLocaleString()}`
                    ).join('\n')
                  : '';

                const balanceCandidatesText = balanceData.candidates && balanceData.candidates.length > 0
                  ? balanceData.candidates.map((c: any) =>
                      `• ${c.client_name} (${c.quotation_number}) — expected balance: ₱${c.expected_balance.toLocaleString()}`
                    ).join('\n')
                  : '';

                await ctx.editMessageText(
                  `${fields}\n\n` +
                  `🔍 *Payment Matching*\n\n` +
                  `This amount (₱${depositAmount.toLocaleString()}) does not closely match any deposit or balance.\n\n` +
                  (otherCandidates ? `*Possible deposit orders:*\n${otherCandidates}\n\n` : '') +
                  (balanceCandidatesText ? `*Possible balance orders:*\n${balanceCandidatesText}\n\n` : '') +
                  `Please type the *client name* this payment is for, or type *cancel* to skip.`,
                  { parse_mode: 'Markdown', ...cancelButton() }
                );
              }
            } catch (balanceErr: any) {
              console.error('[balance] Match error:', balanceErr);
              // Fall back to asking for client name
              setStep(chatId, {
                action: 'awaiting_deposit_client_name',
                imageBase64,
                mimeType,
                fileName,
                depositAmount,
                paymentDate,
              });

              const otherCandidates = matchData.candidates && matchData.candidates.length > 0
                ? matchData.candidates.map((c: any) =>
                    `• ${c.client_name} (${c.quotation_number}) — expected deposit: ₱${c.expected_deposit.toLocaleString()}`
                  ).join('\n')
                : '';

              await ctx.editMessageText(
                `${fields}\n\n` +
                `🔍 *Deposit Matching*\n\n` +
                `This deposit amount (₱${depositAmount.toLocaleString()}) does not closely match any order.\n\n` +
                (otherCandidates ? `*Possible orders:*\n${otherCandidates}\n\n` : '') +
                `Please type the *client name* this deposit is for, or type *cancel* to skip.`,
                { parse_mode: 'Markdown', ...cancelButton() }
              );
            }
          }
        } catch (err: any) {
          console.error('[deposit] Match error:', err);
          await ctx.editMessageText(
            `${fields}\n\n` +
            `ℹ️ Payment info extracted. To record this payment, use the order status menu in the dashboard.`,
            { parse_mode: 'Markdown', ...mainMenuKeyboard() }
          );
        }
      } else {
        await ctx.editMessageText(
          `${fields}\n\n` +
          `ℹ️ Payment info extracted but no amount detected. To record this payment, use the order status menu in the dashboard.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      }
    } else {
      await ctx.editMessageText(
        `🤷 Could not identify this image as a quotation or payment receipt.\nRaw text: ${data.raw_text?.slice(0, 200) || 'none'}`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
    }
  } catch (error: any) {
    console.error('[vision] Extraction error:', error);
    botLog({
      chatId, userId, username,
      messageType: 'vision',
      content: `extract_error: ${fileName}`,
      metadata: { errorMessage: String(error.message ?? error) },
      status: 'error',
    });
    // Keep the data so user can retry
    setStep(chatId, {
      action: 'awaiting_vision_retry_extract',
      imageBase64,
      mimeType,
      fileName,
    });
    await ctx.editMessageText(`❌ Vision analysis failed: ${error.message}

Tap Retry to try again, or Cancel to go back.`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔁 Retry extraction', 'vision:retry_extract')],
        [Markup.button.callback('📤 Upload to Drive instead', 'vision:upload')],
        [Markup.button.callback('❌ Cancel', 'action:cancel')],
      ]),
    });
  }
});

// ── Collection Group Deposit Handlers ────────────────────────────────

// User clicked "Yes, Upload Deposit Slip" from deposit_pending reminder
bot.action(/^deposit:yes:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];

  await ctx.editMessageText(
    `📸 *Deposit Slip Upload*\n\n` +
    `Please upload a photo of the deposit slip for *${quotationNumber}*.\n\n` +
    `The bot will automatically extract the payment information and match it to the order.`,
    { parse_mode: 'Markdown' }
  );

  // Set session to expect a deposit slip image
  setStep(chatId, {
    action: 'awaiting_deposit_slip_photo',
    orderId,
    quotationNumber,
  });
});

// User clicked "Not Yet" from deposit_pending reminder
bot.action(/^deposit:no:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const quotationNumber = ctx.match[2];

  await ctx.editMessageText(
    `⏳ No problem! I'll check again tomorrow.\n\n` +
    `When the deposit for *${quotationNumber}* is ready, just upload the deposit slip photo here.`,
    { parse_mode: 'Markdown' }
  );
});

// ── Deposit Confirmation Handlers ────────────────────────────────────

// User confirmed Yes — record the deposit for the matched order
bot.action(/^deposit:confirm_yes:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const quotationNumber = ctx.match[1];

  if (session.step.action !== 'awaiting_deposit_confirmation') {
    return ctx.editMessageText('⏳ This session has expired. Please upload the deposit slip again.', {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  }

  const { depositAmount, imageBase64, mimeType, fileName, paymentDate } = session.step;

  await ctx.editMessageText(`💳 Recording deposit of ₱${depositAmount.toLocaleString()} for *${quotationNumber}*...`, {
    parse_mode: 'Markdown',
  });

  try {
    // Record the deposit via the existing /deposits endpoint (no Google Drive upload — deposit slips not stored)
    const depositRes = await fetch(`${apiBaseUrl}/deposits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quotation_number: quotationNumber,
        amount: depositAmount,
        image_url: null,
        updated_by: username ?? userId,
        deposit_paid_at: paymentDate ?? null,
      }),
    });

    if (!depositRes.ok) {
      const err = await depositRes.json().catch(() => ({ error: 'Deposit API error' }));
      throw new Error(err.error || `HTTP ${depositRes.status}`);
    }

    resetStep(chatId);

    botLog({
      chatId, userId, username,
      messageType: 'deposit',
      content: `deposit_recorded: ${quotationNumber} ₱${depositAmount}`,
      metadata: { quotationNumber, amount: depositAmount },
      status: 'success',
    });

    const successMsg =
      `✅ *Deposit Recorded Successfully!*\n\n` +
      `📋 Order: *${quotationNumber}*\n` +
      `💰 Amount: ₱${depositAmount.toLocaleString()}\n` +
      `\nProduction can now proceed.`;

    await ctx.editMessageText(successMsg, {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  } catch (error: any) {
    console.error('[deposit] Record error:', error);
    botLog({
      chatId, userId, username,
      messageType: 'deposit',
      content: `deposit_error: ${quotationNumber}`,
      metadata: { quotationNumber, amount: depositAmount, errorMessage: String(error.message ?? error) },
      status: 'error',
    });
    await ctx.editMessageText(
      `❌ Failed to record deposit: ${error.message}\n\nYou can try again from the main menu.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  }
});

// ── Balance Payment Confirmation Handler ────────────────────────────

// User confirmed Yes for balance payment — record the balance via /pay-balance
bot.action(/^balance:confirm_yes:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const quotationNumber = ctx.match[1];

  if (session.step.action !== 'awaiting_deposit_confirmation') {
    return ctx.editMessageText('⏳ This session has expired. Please upload the payment slip again.', {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  }

  const { depositAmount, imageBase64, mimeType, fileName } = session.step;

  await ctx.editMessageText(`⚖️ Recording balance payment of ₱${depositAmount.toLocaleString()} for *${quotationNumber}*...`, {
    parse_mode: 'Markdown',
  });

  try {
    // Record the balance payment via /pay-balance (no Google Drive upload — payment proofs not stored)
    const balanceRes = await fetch(`${apiBaseUrl}/pay-balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quotation_number: quotationNumber,
        amount: depositAmount,
        updated_by: username ?? userId,
      }),
    });

    if (!balanceRes.ok) {
      const err = await balanceRes.json().catch(() => ({ error: 'Balance API error' }));
      throw new Error(err.error || `HTTP ${balanceRes.status}`);
    }

    resetStep(chatId);

    botLog({
      chatId, userId, username,
      messageType: 'balance',
      content: `balance_recorded: ${quotationNumber} ₱${depositAmount}`,
      metadata: { quotationNumber, amount: depositAmount },
      status: 'success',
    });

    const successMsg =
      `✅ *Balance Payment Recorded Successfully!*\n\n` +
      `📋 Order: *${quotationNumber}*\n` +
      `💰 Amount: ₱${depositAmount.toLocaleString()}\n` +
      `\nDelivery can now proceed.`;

    await ctx.editMessageText(successMsg, {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  } catch (error: any) {
    console.error('[balance] Record error:', error);
    botLog({
      chatId, userId, username,
      messageType: 'balance',
      content: `balance_error: ${quotationNumber}`,
      metadata: { quotationNumber, amount: depositAmount, errorMessage: String(error.message ?? error) },
      status: 'error',
    });
    await ctx.editMessageText(
      `❌ Failed to record balance payment: ${error.message}\n\nYou can try again from the main menu.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  }
});

// User said No — ask them to type the client name
bot.action('deposit:confirm_no', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  if (session.step.action !== 'awaiting_deposit_confirmation') {
    return ctx.editMessageText('⏳ This session has expired. Please upload the deposit slip again.', {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  }

  const { imageBase64, mimeType, fileName, depositAmount } = session.step;

  // Switch to client name input step
  setStep(chatId, {
    action: 'awaiting_deposit_client_name',
    imageBase64,
    mimeType,
    fileName,
    depositAmount,
  });

  botLog({
    chatId, userId, username,
    messageType: 'deposit',
    content: 'deposit_confirm_no',
    metadata: { depositAmount },
    direction: 'incoming',
  });

  await ctx.editMessageText(
    `🔍 *Deposit Matching*\n\n` +
    `Please type the *client name* this deposit of ₱${depositAmount.toLocaleString()} is for.\n\n` +
    `Example: \`Juan Dela Cruz\``,
    { parse_mode: 'Markdown', ...cancelButton() }
  );
});

// ── Verify Deposit Callback Handler ──────────────────────────────────

// Team member clicked "Verify Deposit" from collection agent reminder
bot.action(/^verify:deposit:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `verify:deposit:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  await ctx.editMessageText(
    `🔍 *Verifying Deposit* — ${quotationNumber}\n\nPlease wait...`,
    { parse_mode: 'Markdown' }
  );

  try {
    const res = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(orderId)}/verify-deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verified_by: username ?? userId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Verify API error' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();

    botLog({
      chatId, userId, username,
      messageType: 'deposit',
      content: `deposit_verified: ${quotationNumber}`,
      metadata: { orderId, quotationNumber, nextStage: data.next_stage },
      status: 'success',
    });

    await ctx.editMessageText(
      `✅ *Deposit Verified Successfully!*\n\n` +
      `📋 Order: *${quotationNumber}*\n` +
      `🔜 Next Stage: *${data.next_stage?.replace(/_/g, ' ') ?? 'Production'}*\n\n` +
      `Production can now proceed.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } catch (error: any) {
    console.error('[verify-deposit] Error:', error);
    botLog({
      chatId, userId, username,
      messageType: 'deposit',
      content: `deposit_verify_error: ${quotationNumber}`,
      metadata: { orderId, quotationNumber, errorMessage: String(error.message ?? error) },
      status: 'error',
    });
    await ctx.editMessageText(
      `❌ Failed to verify deposit: ${error.message}\n\nYou can try again from the dashboard.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  }
});

// ── Verify Balance Callback Handler ──────────────────────────────────

// Team member clicked "Verify Balance" from collection agent reminder
bot.action(/^verify:balance:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `verify:balance:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  await ctx.editMessageText(
    `🔍 *Verifying Balance Payment* — ${quotationNumber}\n\nPlease wait...`,
    { parse_mode: 'Markdown' }
  );

  try {
    const res = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(orderId)}/verify-balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verified_by: username ?? userId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Verify API error' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();

    botLog({
      chatId, userId, username,
      messageType: 'balance',
      content: `balance_verified: ${quotationNumber}`,
      metadata: { orderId, quotationNumber, nextStage: data.next_stage },
      status: 'success',
    });

    await ctx.editMessageText(
      `✅ *Balance Payment Verified Successfully!*\n\n` +
      `📋 Order: *${quotationNumber}*\n` +
      `🔜 Next Stage: *Payment Received*\n\n` +
      `Order can now proceed to completion.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } catch (error: any) {
    console.error('[verify-balance] Error:', error);
    botLog({
      chatId, userId, username,
      messageType: 'balance',
      content: `balance_verify_error: ${quotationNumber}`,
      metadata: { orderId, quotationNumber, errorMessage: String(error.message ?? error) },
      status: 'error',
    });
    await ctx.editMessageText(
      `❌ Failed to verify balance payment: ${error.message}\n\nYou can try again from the dashboard.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  }
});

// Fallback: upload to Drive (used from multiple steps)
bot.action('vision:upload', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  if (session.step.action !== 'awaiting_vision_process' && session.step.action !== 'awaiting_vision_extract' && session.step.action !== 'awaiting_vision_document_type') {
    return ctx.editMessageText('⏳ Session expired.', {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  }

  const { imageBase64, mimeType, fileName } = session.step;
  const uploadedBy = ctx.from?.username ?? String(ctx.from?.id);

  botLog({
    chatId, userId, username,
    messageType: 'vision',
    content: `upload_to_drive: ${fileName}`,
    metadata: { mimeType, fileName },
    direction: 'incoming',
  });

  try {
    await ctx.editMessageText(`📤 Uploading to Google Drive...`);

    const driveResult = await uploadFileAndRecord({
      chatId,
      imageBase64,
      mimeType,
      fileName,
      uploadedBy,
    });

    botLog({
      chatId, userId, username,
      messageType: 'upload',
      content: fileName,
      metadata: { mimeType, driveFileId: driveResult.fileId, driveLink: driveResult.webViewLink },
      status: 'success',
    });

    resetStep(chatId);
    await ctx.editMessageText(
      `✅ *File uploaded to Google Drive!*
📄 ${escapeMarkdown(fileName)}
🔗 ${escapeMarkdown(driveResult.webViewLink)}`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } catch (error: any) {
    console.error('[vision] Upload error:', error);
    botLog({
      chatId, userId, username,
      messageType: 'upload',
      content: fileName,
      metadata: { mimeType, errorMessage: String(error.message ?? error) },
      status: 'error',
    });
    setStep(chatId, {
      action: 'awaiting_upload_retry',
      imageBase64,
      mimeType,
      fileName,
      uploadedBy,
    });
    await ctx.editMessageText(`❌ Upload failed: ${String(error.message ?? error)}

Tap Retry upload to try again.`, {
      ...retryUploadKeyboard(),
    });
  }
});

bot.action('upload:retry', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  if (session.step.action !== 'awaiting_upload_retry') {
    return ctx.editMessageText('⏳ Retry session expired. Please upload the file again.', {
      ...mainMenuKeyboard(),
    });
  }

  const { imageBase64, mimeType, fileName, quotationNumber, telegramMessageId, uploadedBy } = session.step;

  try {
    await ctx.editMessageText('📤 Retrying upload to Google Drive...');
    const driveResult = await uploadFileAndRecord({
      chatId,
      imageBase64,
      mimeType,
      fileName,
      quotationNumber,
      telegramMessageId,
      uploadedBy: uploadedBy ?? ctx.from?.username ?? String(ctx.from?.id),
    });

    // Log successful retry
    botLog({
      chatId, userId, username,
      messageType: 'upload',
      content: fileName,
      metadata: {
        mimeType, quotationNumber, telegramMessageId,
        driveFileId: driveResult.fileId,
        driveLink: driveResult.webViewLink,
        retry: true,
      },
      status: 'success',
    });

    resetStep(chatId);
    await ctx.editMessageText(
      `✅ *File uploaded to Google Drive!*
📄 ${escapeMarkdown(fileName)}
🔗 ${escapeMarkdown(driveResult.webViewLink)}` +
        (quotationNumber ? `
📦 Linked to order: ${escapeMarkdown(quotationNumber)}` : ''),
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } catch (error: any) {
    console.error('[upload:retry] Upload error:', error);
    // Log retry failure
    botLog({
      chatId, userId, username,
      messageType: 'upload',
      content: fileName,
      metadata: {
        mimeType, quotationNumber, telegramMessageId,
        errorMessage: String(error.message ?? error),
        retry: true,
      },
      status: 'error',
    });

    setStep(chatId, {
      action: 'awaiting_upload_retry',
      imageBase64,
      mimeType,
      fileName,
      quotationNumber,
      telegramMessageId,
      uploadedBy,
    });
    await ctx.editMessageText(`❌ Upload failed again: ${String(error.message ?? error)}

Tap Retry upload to try again.`, {
      ...retryUploadKeyboard(),
    });
  }
});

// Do nothing
bot.action('vision:ignore', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  resetStep(chatId);
  botLog({
    chatId, userId, username,
    messageType: 'vision',
    content: 'ignore',
    direction: 'incoming',
  });
  await ctx.editMessageText('✅ File ignored. Nothing was uploaded.', {
    parse_mode: 'Markdown',
    ...mainMenuKeyboard(),
  });
});

// Retry extraction after a vision API failure
bot.action('vision:retry_extract', async (ctx) => {
  await ctx.answerCbQuery('🤖 Retrying...');
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  if (session.step.action !== 'awaiting_vision_retry_extract') {
    return ctx.editMessageText('⏳ Retry session expired. Please upload the file again.', {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  }

  const { imageBase64, mimeType, fileName } = session.step;

  // Show the image back to the user so they can see what's being re-analyzed
  try {
    const imgBuffer = Buffer.from(imageBase64, 'base64');
    if (/^image\//.test(mimeType)) {
      await ctx.replyWithPhoto({ source: imgBuffer, filename: fileName });
    } else {
      await ctx.replyWithDocument({ source: imgBuffer, filename: fileName });
    }
  } catch {
    // If sending the image fails (e.g., too large), just proceed with text
  }

  await ctx.editMessageText(`🤖 Retrying AI Vision analysis...`);

  botLog({
    chatId, userId, username,
    messageType: 'vision',
    content: `retry_extract: ${fileName}`,
    metadata: { mimeType, fileName },
    direction: 'incoming',
  });

  try {
    // Call the API's vision/extract endpoint
    const res = await fetch(`${apiBaseUrl}/vision/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: imageBase64,
        mime_type: mimeType,
        mode: 'auto',
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = text ? JSON.parse(text) : { error: `Vision API error (HTTP ${res.status})` };
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();

    // Store the extracted data + image via the share endpoint
    const shareRes = await fetch(`${apiBaseUrl}/vision/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: imageBase64,
        mime_type: mimeType,
        file_name: fileName,
        extracted: data.quotation || data.payment || {},
        type: data.type,
        confidence: data.confidence,
        raw_text: data.raw_text || '',
      }),
    });

    if (!shareRes.ok) {
      throw new Error('Failed to create share link');
    }

    const shareData = await shareRes.json();
    const token = shareData.token;

    // Build dashboard URL
    const dashboardBase = process.env.DASHBOARD_BASE_URL ?? 'http://localhost:3000';
    const visionUrl = `${dashboardBase}/vision?token=${token}`;

    resetStep(chatId);

    // Log successful retry extraction
    botLog({
      chatId, userId, username,
      messageType: 'vision',
      content: `retry_extracted: ${data.type} (${data.confidence})`,
      metadata: { fileName, type: data.type, confidence: data.confidence, token, retry: true },
      status: 'success',
    });

    if (data.type === 'quotation' && data.quotation) {
      const q = data.quotation;
      const fields = [
        `📋 *Extracted Quotation Info:*`,
        q.quotation_number ? `🔢 Number: \`${q.quotation_number}\`` : null,
        q.client_name ? `👤 Client: ${q.client_name}` : null,
        q.sales_agent ? `🧑‍💼 Agent: ${q.sales_agent}` : null,
        q.total_amount ? `💰 Amount: ₱${Number(q.total_amount).toLocaleString()}` : null,
        `📊 Confidence: ${data.confidence}`,
      ].filter(Boolean).join('\n');

      await ctx.editMessageText(
        `${fields}\n\n` +
        `✅ *Information extracted!*\n\n` +
        `👉 [Open in Dashboard to review & create order](${visionUrl})\n\n` +
        `The extracted data has been sent to the dashboard. You can edit the fields and create the order there.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.url('🚀 Open in Dashboard', visionUrl)],
            [Markup.button.callback('📤 Upload to Drive instead', 'vision:upload')],
          ]),
        }
      );
    } else if (data.type === 'payment' && data.payment) {
      const p = data.payment;
      const fields = [
        `💳 *Extracted Payment Info:*`,
        p.amount ? `💰 Amount: ₱${Number(p.amount).toLocaleString()}` : null,
        p.type !== 'unknown' ? `📌 Type: ${p.type}` : null,
        p.reference_number ? `🔖 Ref: \`${p.reference_number}\`` : null,
        p.paid_by ? `👤 Paid by: ${p.paid_by}` : null,
        `📊 Confidence: ${data.confidence}`,
      ].filter(Boolean).join('\n');

      await ctx.editMessageText(
        `${fields}\n\n` +
        `ℹ️ Payment info extracted. To record this payment, use the order status menu in the dashboard.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
    } else {
      await ctx.editMessageText(
        `🤷 Could not identify this image as a quotation or payment receipt.\nRaw text: ${data.raw_text?.slice(0, 200) || 'none'}`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
    }
  } catch (error: any) {
    console.error('[vision] Retry extraction error:', error);
    botLog({
      chatId, userId, username,
      messageType: 'vision',
      content: `retry_extract_error: ${fileName}`,
      metadata: { errorMessage: String(error.message ?? error), retry: true },
      status: 'error',
    });
    // Keep data for another retry
    setStep(chatId, {
      action: 'awaiting_vision_retry_extract',
      imageBase64,
      mimeType,
      fileName,
    });
    await ctx.editMessageText(`❌ Vision analysis failed again: ${error.message}

Tap Retry to try again, or Cancel to go back.`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔁 Retry extraction', 'vision:retry_extract')],
        [Markup.button.callback('📤 Upload to Drive instead', 'vision:upload')],
        [Markup.button.callback('❌ Cancel', 'action:cancel')],
      ]),
    });
  }
});

// ── File Upload Handler ──────────────────────────────────────────────
// Handles documents (PDFs, images, etc.) and photos sent to the bot.
// For images, asks the user if they want Gemini Vision to extract data.

bot.on(['document', 'photo'], async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const messageId = String(ctx.message.message_id);
  const from = ctx.from?.username ?? String(ctx.from?.id);
  const userId = String(ctx.from?.id ?? '');
  const session = getSession(chatId);

  // Determine file info using type-safe narrowing
  let fileId: string;
  let fileName: string;
  let mimeType: string;
  let imageBase64: string | null = null;

  const msg = ctx.message as any;
  if (msg.document) {
    fileId = msg.document.file_id;
    fileName = msg.document.file_name ?? `document_${Date.now()}`;
    mimeType = msg.document.mime_type ?? 'application/octet-stream';
  } else if (msg.photo) {
    // Get the largest photo (last in array)
    const photo = msg.photo[msg.photo.length - 1];
    fileId = photo.file_id;
    fileName = `photo_${Date.now()}.jpg`;
    mimeType = 'image/jpeg';
  } else {
    botLog({
      chatId, userId, username: from,
      messageType: 'error',
      content: 'Unsupported file type',
      status: 'error',
    });
    return ctx.reply('❌ Unsupported file type.');
  }

  // Log file receipt
  botLog({
    chatId, userId, username: from,
    messageType: msg.document ? 'document' : 'photo',
    content: fileName,
    metadata: { fileId, mimeType, messageId, linkedOrder: session.linkedOrder },
    status: 'pending',
  });

  await ctx.reply(`📎 Downloading ${fileName}...`);

  try {
    // Step 1: Download file from Telegram
    const link = await ctx.telegram.getFileLink(fileId);
    const response = await fetch(link.href);
    if (!response.ok) throw new Error(`Telegram download failed: ${response.status}`);
    const fileBuffer = Buffer.from(await response.arrayBuffer());
    imageBase64 = fileBuffer.toString('base64');

    // Check if user is in balance proof photo flow
    if (session.step.action === 'awaiting_balance_proof_photo') {
      const { orderId, quotationNumber } = session.step;

      // For images, call vision API to extract payment details
      const isProcessable = /^image\//.test(mimeType) || mimeType === 'application/pdf';
      if (isProcessable) {
        await ctx.reply(`🔍 Scanning proof of payment for *${quotationNumber}*...`, { parse_mode: 'Markdown' });

        try {
          // Call vision API to extract payment info
          const visionResult: any = await postJson('/vision/extract', {
            image_base64: imageBase64,
            mime_type: mimeType,
            mode: 'payment',
          });

          const paymentAmount = visionResult?.payment?.amount;
          const paymentDate = visionResult?.payment?.payment_date;

          if (paymentAmount && paymentAmount > 0) {
            // Record the balance payment
            const payResult: any = await postJson('/pay-balance', {
              quotation_number: quotationNumber,
              amount: paymentAmount,
              payment_date: paymentDate ?? null,
              updated_by: from,
            });

            // Advance stage to delivery_scheduled
            await postJson('/stage-updates', {
              quotation_number: quotationNumber,
              stage: 'delivery_scheduled',
              status: 'auto_advanced',
              remarks: 'Balance paid — ready for delivery scheduling',
              updated_by: 'delivery-agent',
            });

            resetStep(chatId);

            let msg = `✅ *Balance Payment Recorded!*\n\n`;
            msg += `Order: *${quotationNumber}*\n`;
            msg += `Amount: ₱${Number(paymentAmount).toLocaleString()}`;
            if (paymentDate) {
              msg += `\nDate: ${paymentDate}`;
            }
            if (payResult.overpayment > 0) {
              msg += `\n⚠️ Overpayment of ₱${Number(payResult.overpayment).toLocaleString()}`;
            }
            msg += `\n\n🚚 *Delivery Scheduling*\n\n`;
            msg += `The stage has been advanced to *Delivery Scheduled*.\n`;
            msg += `Please set the delivery schedule using the /deliverydate command.`;

            await ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
          } else {
            // Vision couldn't extract amount — ask user to enter manually
            setStep(chatId, { action: 'awaiting_paybalance_amount', quotationNumber });
            await ctx.reply(
              `⚠️ Could not automatically detect the payment amount from the image.\n\n` +
              `💰 Please enter the balance amount in PHP manually:\n\nExample: \`15000\``,
              { parse_mode: 'Markdown', ...cancelButton() }
            );
          }
        } catch (err: any) {
          // Vision API failed — fall back to manual entry
          setStep(chatId, { action: 'awaiting_paybalance_amount', quotationNumber });
          await ctx.reply(
            `⚠️ Could not process the image: ${err.message}\n\n` +
            `💰 Please enter the balance amount in PHP manually:\n\nExample: \`15000\``,
            { parse_mode: 'Markdown', ...cancelButton() }
          );
        }
      } else {
        // Non-image file sent as proof — ask for image
        await ctx.reply(
          `❌ Please send a **photo** of the deposit slip or proof of payment (JPEG/PNG).`,
          { parse_mode: 'Markdown', ...cancelButton() }
        );
      }
      return;
    }

    // Check if user is in deposit slip photo flow (from collection group)
    if (session.step.action === 'awaiting_deposit_slip_photo') {
      const { orderId, quotationNumber } = session.step;

      // For images, call vision API to extract payment details
      const isProcessable = /^image\//.test(mimeType) || mimeType === 'application/pdf';
      if (isProcessable) {
        await ctx.reply(`🔍 Scanning deposit slip for *${quotationNumber}*...`, { parse_mode: 'Markdown' });

        try {
          // Call vision API to extract payment info
          const visionResult: any = await postJson('/vision/extract', {
            image_base64: imageBase64,
            mime_type: mimeType,
            mode: 'payment',
          });

          const depositAmount = visionResult?.payment?.amount;
          const paymentDate = visionResult?.payment?.payment_date;

          if (depositAmount && depositAmount > 0) {
            // Try to match this deposit to the specific order
            try {
              const matchRes = await fetch(`${apiBaseUrl}/deposits/match-and-record`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: depositAmount, quotation_number: quotationNumber }),
              });
              const matchData = await matchRes.json();

              if (matchData.ok && matchData.matched) {
                // Deposit recorded successfully
                resetStep(chatId);

                let msg = `✅ *Deposit Recorded!*\n\n`;
                msg += `Order: *${quotationNumber}*\n`;
                msg += `Amount: ₱${Number(depositAmount).toLocaleString()}`;
                if (paymentDate) {
                  msg += `\nDate: ${paymentDate}`;
                }
                msg += `\n\nThank you! The deposit has been recorded and the order will proceed.`;

                await ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
                return;
              }
            } catch (err: any) {
              console.error('[deposit-slip] Match error:', err);
            }

            // No deposit match found — try balance matching
            try {
              const balanceRes = await fetch(`${apiBaseUrl}/deposits/match-balance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: depositAmount, quotation_number: quotationNumber }),
              });
              const balanceData = await balanceRes.json();

              if (balanceData.ok && balanceData.matched && balanceData.candidates && balanceData.candidates.length > 0) {
                // Balance match found!
                const best = balanceData.candidates[0];

                setStep(chatId, {
                  action: 'awaiting_deposit_confirmation',
                  imageBase64,
                  mimeType,
                  fileName,
                  depositAmount,
                  candidates: balanceData.candidates.map((c: any) => ({
                    quotation_number: c.quotation_number,
                    client_name: c.client_name,
                    total_amount: c.total_amount,
                    expected_deposit: c.expected_balance,
                    discrepancy: c.discrepancy,
                  })),
                  paymentDate,
                });

                const buttons: any[][] = [];
                for (const c of balanceData.candidates) {
                  const expectedPct = Math.round((1 - c.discrepancy / 100) * 100);
                  buttons.push([
                    Markup.button.callback(
                      `✅ Yes — ${c.client_name} (${c.quotation_number}) ${expectedPct}% match`,
                      `balance:confirm_yes:${c.quotation_number}`
                    ),
                  ]);
                }
                buttons.push([Markup.button.callback('❌ No — different client', 'deposit:confirm_no')]);

                await ctx.reply(
                  `💳 *Extracted Payment Info:*\n` +
                  `💰 Amount: ₱${depositAmount.toLocaleString()}\n` +
                  (paymentDate ? `📅 Date: ${paymentDate}\n` : '') +
                  `\n🔍 *Balance Payment Matching*\n\n` +
                  `This amount matches a *balance payment* for an order where deposit was already paid.\n\n` +
                  `*Best Match:*\n` +
                  `👤 Client: ${best.client_name}\n` +
                  `📋 Order: ${best.quotation_number}\n` +
                  `💰 Total: ₱${best.total_amount.toLocaleString()}\n` +
                  `💵 Deposit Paid: ₱${best.deposit_amount.toLocaleString()}\n` +
                  `⚖️ Expected Balance: ₱${best.expected_balance.toLocaleString()}\n` +
                  `📊 Match: ${Math.round((1 - best.discrepancy / 100) * 100)}%\n\n` +
                  `Is this the balance payment for *${best.client_name}*?`,
                  {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard(buttons),
                  }
                );
                return;
              }
            } catch (balanceErr: any) {
              console.error('[deposit-slip] Balance match error:', balanceErr);
            }

            // No balance match either — ask user to enter client name
            setStep(chatId, {
              action: 'awaiting_deposit_client_name',
              imageBase64,
              mimeType,
              fileName,
              depositAmount,
              paymentDate,
            });

            await ctx.reply(
              `💳 *Extracted Payment Info:*\n` +
              `💰 Amount: ₱${depositAmount.toLocaleString()}\n` +
              (paymentDate ? `📅 Date: ${paymentDate}\n` : '') +
              `\n🔍 *Payment Matching*\n\n` +
              `This amount (₱${depositAmount.toLocaleString()}) does not closely match any deposit or balance.\n\n` +
              `Please type the *client name* this payment is for, or type *cancel* to skip.`,
              { parse_mode: 'Markdown', ...cancelButton() }
            );
          } else {
            // Vision couldn't extract amount — ask user to enter manually
            setStep(chatId, { action: 'awaiting_deposit_amount', quotationNumber });
            await ctx.reply(
              `⚠️ Could not automatically detect the deposit amount from the image.\n\n` +
              `💰 Please enter the deposit amount in PHP manually:\n\nExample: \`15000\``,
              { parse_mode: 'Markdown', ...cancelButton() }
            );
          }
        } catch (err: any) {
          // Vision API failed — fall back to manual entry
          setStep(chatId, { action: 'awaiting_deposit_amount', quotationNumber });
          await ctx.reply(
            `⚠️ Could not process the image: ${err.message}\n\n` +
            `💰 Please enter the deposit amount in PHP manually:\n\nExample: \`15000\``,
            { parse_mode: 'Markdown', ...cancelButton() }
          );
        }
      } else {
        // Non-image file sent as deposit slip — ask for image
        await ctx.reply(
          `❌ Please send a **photo** of the deposit slip (JPEG/PNG).`,
          { parse_mode: 'Markdown', ...cancelButton() }
        );
      }
      return;
    }

    // Step 2: Ask user what type of document this is
    // For images and PDFs, offer the vision workflow
    const isProcessable = /^image\//.test(mimeType) || mimeType === 'application/pdf';
    if (isProcessable) {
      setStep(chatId, {
        action: 'awaiting_vision_document_type',
        imageBase64,
        mimeType,
        fileName,
      });

      await ctx.reply(
        `📎 *File received:* ${escapeMarkdown(fileName)}

What type of document is this?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📋 Quotation / Order', 'vision:type_quotation')],
            [Markup.button.callback('💳 Deposit Slip / Payment', 'vision:type_deposit')],
            [Markup.button.callback('❌ Cancel', 'action:cancel')],
          ]),
        }
      );
    } else {
      // Non-image/PDF: upload directly to Drive and keep retry data if it fails.
      await ctx.reply(`📤 Uploading to Google Drive...`);
      const quotationNumber = session.linkedOrder;
      const driveResult = await uploadFileAndRecord({
        chatId,
        imageBase64,
        mimeType,
        fileName,
        quotationNumber,
        telegramMessageId: messageId,
        uploadedBy: from,
      });

      // Log successful upload
      botLog({
        chatId, userId, username: from,
        messageType: 'upload',
        content: fileName,
        metadata: {
          fileId, mimeType, messageId,
          quotationNumber,
          driveFileId: driveResult.fileId,
          driveLink: driveResult.webViewLink,
        },
        status: 'success',
      });

      await ctx.reply(
        `✅ *File uploaded to Google Drive!*
📄 ${escapeMarkdown(fileName)}
🔗 ${escapeMarkdown(driveResult.webViewLink)}` +
          (quotationNumber ? `
📦 Linked to order: ${escapeMarkdown(quotationNumber)}` : ''),
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
    }
  } catch (error: any) {
    console.error('Upload error:', error);
    // Log the failure
    botLog({
      chatId, userId, username: from,
      messageType: 'upload',
      content: fileName,
      metadata: {
        fileId, mimeType, messageId,
        linkedOrder: session.linkedOrder,
        errorMessage: String(error.message ?? error),
      },
      status: 'error',
    });

    if (imageBase64) {
      setStep(chatId, {
        action: 'awaiting_upload_retry',
        imageBase64,
        mimeType,
        fileName,
        quotationNumber: session.linkedOrder,
        telegramMessageId: messageId,
        uploadedBy: from,
      });
      await ctx.reply(`❌ Upload failed: ${String(error.message ?? error)}

Tap Retry upload to try again.`, {
        ...retryUploadKeyboard(),
      });
      return;
    }

    await ctx.reply(`❌ Upload failed: ${String(error.message ?? error)}`, {
      ...cancelButton(),
    });
  }
});

// ── Commands Overview ─────────────────────────────────────────────────
bot.command('commands', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  resetStep(chatId);
  botLog({ chatId, userId, username, messageType: 'command', content: '/commands', direction: 'incoming' });

  const text =
    '📋 *Available Commands & Features*\n\n' +
    '*Slash Commands:*\n' +
    '/start — Show main menu\n' +
    '/commands — Show this feature list\n' +
    '/help — Detailed guide for each feature\n' +
    '/unlink — Clear linked order for uploads\n\n' +
    '*Main Menu Features:*\n' +
    '1️⃣ 📋 Check Order Status — View stage, deposit, balance, delivery\n' +
    '2️⃣ 🛒 Purchasing / Production — Mark production started/partial/not yet\n' +
    '3️⃣ 💳 Record Downpayment — Log deposit with optional AI slip scan\n' +
    '4️⃣ 💰 Pay Balance — Record balance payment before delivery\n' +
    '5️⃣ 🚚 Schedule Delivery — Pick date (requires balance paid)\n' +
    '6️⃣ ✅ Mark as Delivered — Confirm delivery with remarks\n' +
    '7️⃣ 💵 Record Payment — Confirm or log payment received\n' +
    '8️⃣ 👤 Clients — Search client details and delivery info\n' +
    '9️⃣ 🔗 Link Order for Upload — Bind an order for auto-file linking\n' +
    '🔟 📎 Upload File — Send docs/photos to Google Drive\n\n' +
    '*Smart Features:*\n' +
    '🤖 AI Vision — Send a quotation or deposit slip photo and the bot auto-extracts details\n' +
    '⏰ Auto Reminders — Bot sends scheduled reminders for production, delivery, payments\n' +
    '📊 Dashboard Sync — All data syncs to the web dashboard in real-time\n\n' +
    '_Tap any button below to begin, or type /help for detailed instructions._';

  await safeReply(ctx, text, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard().reply_markup });
});

// Help Command — detailed explanations
bot.command('help', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  resetStep(chatId);
  botLog({
    chatId, userId, username,
    messageType: 'command',
    content: '/help',
    direction: 'incoming',
  });

  const text =
    '📖 *Quotation Automation Bot — Detailed Help*\n\n' +
    'This bot is designed for *team workflow automation*. Most actions use inline buttons. Here is how each feature works:\n\n' +
    '*1️⃣ Check Order Status*\n' +
    'Type a quotation number (e.g., `QTN-2026-001`). The bot shows the current stage, deposit/balance status, production timeline, and delivery info.\n\n' +
    '*2️⃣ Purchasing / Production*\n' +
    'After an order is confirmed, the bot asks if production has started.\n' +
    '• *Yes, started* → Enter estimated days. Bot schedules midpoint and due reminders.\n' +
    '• *Partial* → List missing items. Bot tracks them until all are produced.\n' +
    '• *Not yet* → Daily reminder continues until you confirm.\n\n' +
    '*3️⃣ Record Downpayment*\n' +
    'Enter the deposit amount. The bot updates the order and clears the deposit-pending reminder.\n' +
    'You can also send a *deposit slip photo* — AI will extract the amount automatically.\n\n' +
    '*4️⃣ Pay Balance*\n' +
    'Records the balance payment. *Delivery cannot be scheduled until balance is paid.*\n' +
    'The bot will ask for a proof photo if triggered from a reminder.\n\n' +
    '*5️⃣ Schedule Delivery*\n' +
    'Pick from quick options (Today, Tomorrow, +2 days, Next Friday) or type a custom date.\n' +
    'Requires balance to be paid first.\n\n' +
    '*6️⃣ Mark as Delivered*\n' +
    'Confirm the item was delivered. Optional remarks (e.g., "Client was happy").\n' +
    'This moves the order to the *delivered* stage and triggers collection reminders.\n\n' +
    '*7️⃣ Record Payment*\n' +
    'Log a payment as *Confirmed* (verified) or *Pending* (waiting for verification).\n' +
    'Use this when the client says they paid but you have not verified yet.\n\n' +
    '*8️⃣ Clients*\n' +
    'Search by client name or type "list" to see all clients.\n' +
    'Shows delivery address, contact number, and authorized receiver.\n\n' +
    '*9️⃣ Link Order for Upload*\n' +
    'Bind a quotation number to this chat. After linking, any file you send is automatically uploaded to that order\'s Google Drive folder.\n' +
    'Use */unlink* to clear the link.\n\n' +
    '*🔟 Upload File*\n' +
    'Send any photo, PDF, or document. If an order is linked, it goes to the correct Drive folder.\n' +
    'If not linked, the bot asks you to link one first.\n\n' +
    '*🤖 AI Vision (Smart Uploads)*\n' +
    'Send a *quotation screenshot* → AI extracts client, amount, and order number.\n' +
    'Send a *deposit slip* → AI extracts amount and tries to match it to an order.\n' +
    'After extraction, tap *Yes, extract info* to review and save.\n\n' +
    '*⏰ Auto Reminders*\n' +
    'The bot automatically sends reminders at 10 AM and 4 PM PHT for:\n' +
    '• Production midpoint and due dates\n' +
    '• En-route confirmation\n' +
    '• Inventory arrival\n' +
    '• Balance due\n' +
    '• Delivery day check\n' +
    'Reply directly to the reminder buttons to update status.\n\n' +
    '*📊 Dashboard*\n' +
    'All data syncs to the web dashboard in real-time:\n' +
    'https://track.abcx124.xyz\n\n' +
    '*Group Setup Tips:*\n' +
    '• Disable *privacy mode* in @BotFather so the bot can see messages and files in groups.\n' +
    '• Only one user can interact at a time per group. If busy, wait for the current user to finish or tap Cancel.\n' +
    '• Only group admins can DM the bot privately.\n\n' +
    '*Available Commands:*\n' +
    '/start — Show main menu\n' +
    '/commands — List all features\n' +
    '/help — Show this detailed guide\n' +
    '/unlink — Clear linked order for uploads';

  await safeReply(ctx, text, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard().reply_markup });
});

// ── Unlink Command (keep for power users) ─────────────────────────────
bot.command('unlink', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const session = getSession(chatId);
  session.linkedOrder = null;
  botLog({
    chatId, userId, username,
    messageType: 'command',
    content: '/unlink',
    direction: 'incoming',
  });
  await ctx.reply('🔗 Order context cleared. Files will not be linked to any order.', mainMenuKeyboard());
});

// ── Start ─────────────────────────────────────────────────────────────

/**
 * Launch the bot with retry logic for 409 Conflict and 429 rate-limit errors.
 *
 * When a container restarts abruptly, Telegram's server may still consider
 * the previous long-polling getUpdates connection active, causing a 409
 * Conflict on the next launch. We retry with exponential backoff (capped at
 * 60s) up to 30 times (~15 minutes total) to wait for the lock to expire.
 *
 * On each attempt we first call deleteWebhook to clear any lingering webhook,
 * then try bot.launch(). 429 rate-limit errors use Telegram's recommended
 * retry_after value.
 */
// ── Webhook mode ─────────────────────────────────────────────────────
// Use webhook instead of long-polling to avoid 409 Conflict errors
// caused by another instance polling with the same bot token.
// The API server proxies Telegram webhook calls to this bot's internal
// HTTP server.

import * as http from 'http';

const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT ?? 8443);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';

async function startWebhook(): Promise<void> {
  // Clear any lingering webhook first
  await bot.telegram.deleteWebhook({ drop_pending_updates: true }).catch(() => {});

  // Set webhook to the public HTTPS endpoint
  // track.abcx124.xyz proxies /api/telegram-webhook -> http://api:8080/telegram-webhook
  // The API server then forwards to http://telegram-bot:WEBHOOK_PORT/
  const publicWebhookUrl =
    process.env.PUBLIC_WEBHOOK_BASE_URL ??
    process.env.DASHBOARD_BASE_URL ??
    'https://track.abcx124.xyz';
  const webhookUrl = `${publicWebhookUrl.replace(/\/+$/, '')}/api/telegram-webhook`;

  await bot.telegram.setWebhook(webhookUrl, {
    secret_token: WEBHOOK_SECRET || undefined,
  });
  console.log(`[bot] Webhook set to ${webhookUrl}`);

  // Start a simple HTTP server that receives forwarded webhook updates
  // from the API server and feeds them to the bot
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }

    // Verify secret token if configured
    const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];
    if (WEBHOOK_SECRET && receivedSecret !== WEBHOOK_SECRET) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const update = JSON.parse(body);
        bot.handleUpdate(update).catch((err) => {
          console.error('[bot] Error handling update:', err);
        });
        res.writeHead(200);
        res.end('OK');
      } catch (err) {
        console.error('[bot] Error parsing webhook body:', err);
        res.writeHead(400);
        res.end('Bad Request');
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(WEBHOOK_PORT, '0.0.0.0', () => {
      console.log(`[bot] Webhook server listening on port ${WEBHOOK_PORT}`);
      resolve();
    });
    server.once('error', reject);
  });
}

async function launchWithRetry(maxRetries = 30, baseDelayMs = 5000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await startWebhook();
      console.log(`[bot] Launched successfully on attempt ${attempt}`);
      return;
    } catch (err: any) {
      const errCode = err?.response?.error_code ?? err?.code ?? 0;
      const errMsg = err?.message ?? '';
      const is409 = errCode === 409 || errMsg.includes('409');
      const is429 = errCode === 429 || errMsg.includes('429');
      const retryAfter = err?.response?.parameters?.retry_after;

      if (attempt === maxRetries) {
        throw err;
      }

      let delay: number;
      if (is429 && retryAfter) {
        delay = (retryAfter + 1) * 1000;
        console.log(`[bot] 429 Rate Limited on attempt ${attempt}, waiting ${retryAfter}s as recommended...`);
      } else if (is409) {
        delay = Math.min(baseDelayMs * Math.pow(1.5, attempt - 1), 60_000);
        console.log(`[bot] 409 Conflict on attempt ${attempt}, retrying in ${delay}ms...`);
      } else {
        throw err;
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

launchWithRetry().catch((err) => {
  console.error('[bot] Failed to launch after all retries:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
