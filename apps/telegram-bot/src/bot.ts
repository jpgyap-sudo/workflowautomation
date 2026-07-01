import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import { AsyncLocalStorage } from 'async_hooks';
import * as fs from 'fs';

const token = process.env.TELEGRAM_BOT_TOKEN;
const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:8080';

if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const bot = new Telegraf(token);

// ── Global callback query answer ───────────────────────────────────────
// Prevents ALL inline keyboard buttons from showing a loading spinner
// when clicked. Telegram requires answerCbQuery within 10 seconds.
bot.use(async (ctx, next) => {
  if (ctx.callbackQuery) {
    const cq = ctx.callbackQuery as any;
    const chatId = String(ctx.chat?.id ?? '');
    const userId = String(ctx.from?.id ?? '');
    console.log(`[callback] data=${cq.data} chat=${chatId} user=${userId}`);
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
    await logBotError(ctx, err, 'handler');
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
    process.env.SCHEDULE_GROUP_CHAT_ID,
    process.env.SCHEDULE_GROUP_ID,
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

// ── Confirmation Passcode Middleware ─────────────────────────────────────
// Intercepts callback queries for consequential actions and asks the user
// to type the confirmation code (888) before the action executes.
// This prevents accidental clicks on GUI buttons that trigger API calls.
bot.use(async (ctx, next) => {
  if (!ctx.callbackQuery) return next();
  const cq = ctx.callbackQuery as any;
  if (!cq.data) return next();

  const callbackData: string = cq.data;
  const chatId = String(ctx.chat?.id ?? '');

  // Skip safe callbacks (navigation, cancel, view-only, input-prompting steps)
  const isSafe = SAFE_PREFIXES.some((prefix) => callbackData.startsWith(prefix));
  if (isSafe) return next();

  // Skip if this is a re-dispatch from the confirmation handler
  // (the key was added to confirmedCallbacks before handleUpdate was called)
  const confirmKey = `${callbackData}:${chatId}`;
  if (confirmedCallbacks.has(confirmKey)) {
    // Clean up immediately so subsequent clicks still require confirmation
    confirmedCallbacks.delete(confirmKey);
    return next();
  }

  // Store the pending action and show inline Confirm / Cancel buttons
  const messageId = ctx.callbackQuery.message?.message_id;
  const originalText = (ctx.callbackQuery.message as any)?.text ?? (ctx.callbackQuery.message as any)?.caption ?? '';
  const chatInstance = (cq as any).chat_instance ?? '';

  const currentStep = getSession(chatId).step;
  setStep(chatId, {
    action: 'awaiting_confirmation',
    callbackData,
    messageId: messageId ?? 0,
    originalText,
    chatInstance,
    previousStep: currentStep,
  });

  await ctx.editMessageText(
    `${originalText}\n\n⚠️ <b>Confirm this action?</b>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Confirm', callback_data: 'confirm_action:yes' },
            { text: '❌ Cancel',  callback_data: 'confirm_action:cancel' },
          ],
        ],
      },
    }
  ).catch(() => {});
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

// ── Escalation Action Logger ───────────────────────────────────────────
// Logs a completed write action to the DB and notifies the escalation group.

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const details: Record<string, unknown> = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
    const maybeAny = err as any;
    if (maybeAny.code !== undefined) details.code = maybeAny.code;
    if (maybeAny.description !== undefined) details.description = maybeAny.description;
    if (maybeAny.response !== undefined) details.response = maybeAny.response;
    if (maybeAny.parameters !== undefined) details.parameters = maybeAny.parameters;
    return details;
  }

  return {
    message: typeof err === 'string' ? err : 'Non-Error thrown',
    value: err,
  };
}

function getUpdateTrace(ctx: any): Record<string, unknown> {
  const message = ctx.message ?? ctx.update?.message;
  const callbackQuery = ctx.callbackQuery ?? ctx.update?.callback_query;
  const callbackMessage = callbackQuery?.message;

  return {
    updateId: ctx.update?.update_id,
    updateType: ctx.updateType,
    chatId: String(ctx.chat?.id ?? message?.chat?.id ?? callbackMessage?.chat?.id ?? 'unknown'),
    chatType: ctx.chat?.type ?? message?.chat?.type ?? callbackMessage?.chat?.type,
    messageId: message?.message_id ?? callbackMessage?.message_id,
    callbackData: callbackQuery?.data,
    text: message?.text,
    from: {
      id: ctx.from?.id ?? callbackQuery?.from?.id ?? message?.from?.id,
      username: ctx.from?.username ?? callbackQuery?.from?.username ?? message?.from?.username,
      firstName: ctx.from?.first_name ?? callbackQuery?.from?.first_name ?? message?.from?.first_name,
    },
  };
}

async function logBotError(ctx: any, err: unknown, source: string, extraMetadata?: Record<string, unknown>) {
  const trace = getUpdateTrace(ctx);
  const from = trace.from as Record<string, unknown> | undefined;
  await botLog({
    chatId: String(trace.chatId ?? 'unknown'),
    userId: from?.id !== undefined ? String(from.id) : undefined,
    username: from?.username !== undefined ? String(from.username) : undefined,
    messageType: 'error',
    direction: 'internal',
    content: `[${source}] ${err instanceof Error ? err.message : String(err)}`,
    status: 'error',
    metadata: {
      source,
      trace,
      error: serializeError(err),
      ...extraMetadata,
    },
  });
}

async function logSystemBotError(err: unknown, source: string, extraMetadata?: Record<string, unknown>) {
  await botLog({
    chatId: 'system',
    messageType: 'error',
    direction: 'internal',
    content: `[${source}] ${err instanceof Error ? err.message : String(err)}`,
    status: 'error',
    metadata: {
      source,
      error: serializeError(err),
      ...extraMetadata,
    },
  });
}

const ESCALATION_NOTIFY_CHAT_ID =
  process.env.ESCALATION_GROUP_CHAT_ID ??
  process.env.ESCALATION_GROUP_ID ??
  null;

async function logAction(params: {
  chatId: string;
  userId: string;
  username?: string;
  label: string;            // Short action name, e.g. "Record Downpayment"
  quotationNumber?: string; // Order reference
  details?: string;         // Human-readable detail line, e.g. "₱5,000"
  metadata?: Record<string, unknown>;
}) {
  const actor = params.username ? `@${params.username}` : `user #${params.userId}`;
  const content = [params.label, params.quotationNumber ? `[${params.quotationNumber}]` : '', params.details ?? '']
    .filter(Boolean).join(' ');

  // 1. Persist to bot_logs DB table
  await botLog({
    chatId: params.chatId,
    userId: params.userId,
    username: params.username,
    messageType: 'telegram_action',
    direction: 'incoming',
    content,
    metadata: {
      label: params.label,
      quotationNumber: params.quotationNumber,
      details: params.details,
      ...params.metadata,
    },
    status: 'success',
  });

  // 2. Notify escalation group (fire-and-forget — never block the bot)
  if (!ESCALATION_NOTIFY_CHAT_ID || !token) return;
  const orderLine = params.quotationNumber ? `\n📋 Order: <b>${params.quotationNumber}</b>` : '';
  const detailLine = params.details ? `\n📝 ${params.details}` : '';
  const msg = `🤖 <b>Telegram Action</b>\n👤 By: ${actor}${orderLine}\n✅ ${params.label}${detailLine}`;

  fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: ESCALATION_NOTIFY_CHAT_ID, text: msg, parse_mode: 'HTML' }),
  }).catch((err) => console.error('[escalation-log] Failed to send:', err));
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

async function patchJson(path: string, body: unknown) {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    method: 'PATCH',
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

async function recordPreProductionPayment(args: {
  quotationNumber: string;
  amount: number;
  paymentType?: 'deposit' | 'full';
  paymentDate?: string | null;
  updatedBy?: string | null;
}) {
  if (args.paymentType === 'full') {
    return postJson('/full-payment', {
      quotation_number: args.quotationNumber,
      amount: args.amount,
      payment_date: args.paymentDate ?? undefined,
      paid_by: args.updatedBy ?? 'telegram_bot',
      updated_by: 'telegram_bot',
    });
  }
  return postJson('/deposits', {
    quotation_number: args.quotationNumber,
    amount: args.amount,
    updated_by: args.updatedBy ?? 'telegram_bot',
    deposit_paid_at: args.paymentDate ?? null,
  });
}

function paymentTypeLabel(paymentType?: 'deposit' | 'full') {
  return paymentType === 'full' ? 'Full Payment' : 'Downpayment';
}


async function buildProductionPromptPayload(quotationNumber: string) {
  const order = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
  let items: any[] = [];
  try {
    const itemsRes = await fetch(`${apiBaseUrl}/orders/${order.id}/items`);
    const itemsData = itemsRes.ok ? await itemsRes.json() : { items: [] };
    items = Array.isArray(itemsData?.items) ? itemsData.items : [];
  } catch {
    items = [];
  }

  if (items.length === 0) {
    return {
      text: `Production for ${quotationNumber}\n\nHas production/purchasing started?`,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('Yes, started', `produce:yes:${quotationNumber}`)],
        [Markup.button.callback('Partial - some items started', `produce:partial:${quotationNumber}`)],
        [Markup.button.callback('Not yet', `produce:no:${quotationNumber}`)],
        [Markup.button.callback('Cancel', 'action:cancel')],
      ]),
    };
  }

  const itemLines = items.map((item, index) => {
    const status = item.production_status === 'finished'
      ? 'finished'
      : item.production_status === 'in_progress'
        ? 'in progress'
        : 'not started';
    return `${index + 1}. ${item.name} x${item.quantity} - ${status}`;
  }).join('\n');

  return {
    text:
      `Production for ${quotationNumber}\n\n` +
      `Items extracted from the quotation:\n${itemLines}\n\n` +
      `Production can proceed item-by-item. If only some items started, update the items instead of marking the whole order started.`,
    keyboard: Markup.inlineKeyboard([
      [Markup.button.callback('Update item-by-item', `produce:partial:${order.id.slice(0, 8)}:${quotationNumber}`)],
      [Markup.button.callback('Whole order started', `produce:yes:${order.id.slice(0, 8)}:${quotationNumber}`)],
      [Markup.button.callback('None started yet', `produce:no:${order.id.slice(0, 8)}:${quotationNumber}`)],
      [Markup.button.callback('Cancel', 'action:cancel')],
    ]),
  };
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

// ── Confirmation Guard ────────────────────────────────────────────────────
// Every inline button tap goes through inline Confirm/Cancel buttons before
// executing — keeps group chat clean (no "type 888" messages).
// Only explicitly safe callbacks (navigation, cancel, view-only, input-prompts)
// are skipped. Everything else requires confirmation.
const CONFIRMATION_CODE = '888'; // kept for backward-compat text fallback

// Callbacks that are safe to run immediately — no confirmation needed.
// Rule: navigation, explicit cancel, view-only, or "just asks for more input".
const SAFE_PREFIXES = [
  // Meta — the confirmation buttons themselves
  'confirm_action:',
  // Explicit cancel/dismiss
  'action:cancel',
  'assistant:cancel',
  'deposit:confirm_no',
  'deposit:type:',
  'deposit:photo_type:',
  // Navigation / view-only
  'noop',
  'menu:',
  'prd:list',
  'prd:cat:',
  'prd:o:',          // view order items in production board
  'prd:i:',
  'clients:list',
  // Order picker — just selects an order and moves to the next step
  'pick:',
  // Input-prompting steps — ask for more info, no API call yet
  'produce:custom:',
  'prod_remaining:custom:',
  'date:custom:',
  'production:delivery_custom:',
  'en_route:arrival_custom:',
  // Delivery day-before acknowledgement — no API call, just a confirmation message
  'delivery:ready:',
  // Stock preparation callbacks — from_stock orders
  'stock_prep:ready:',
  'stock_prep:delay:',
  // Vision flow navigation (no state changes)
  'vision:type_',
  'vision:ignore',
  'vision:retry_extract',
  'vision:upload',
  'upload:retry',
  'vision:process_yes',
  'vision:extract_yes',
  // Item-level production status updates — simple status toggles, not destructive
  'item_prod:',
  // Item-level en-route status updates — simple status toggles, not destructive
  'item_en_route:',
  // Inventory verification status updates — simple qty confirmations, not destructive
  'inv_verify:',
  // Dispatch ready — navigation to en-route for finished items
  'dispatch_ready:',
];

// Set of recently-confirmed callback keys (format: "callbackData:chatId").
// When the user types 888, the key is added here before re-dispatching,
// and the confirmation middleware skips it. Entries are cleaned up after 5s.
const confirmedCallbacks = new Set<string>();

type UserStep =
  | { action: 'idle' }
  | { action: 'awaiting_confirmation'; callbackData: string; messageId: number; originalText: string; chatInstance?: string; previousStep: UserStep }
  | { action: 'awaiting_order_number_for_status' }
  | { action: 'awaiting_order_number_for_produce'; status: string }
  | { action: 'awaiting_produce_status'; quotationNumber: string }
  | { action: 'awaiting_produce_remarks'; quotationNumber: string; status: string }
  | { action: 'awaiting_produce_date'; quotationNumber: string; orderId?: string }
  | { action: 'awaiting_produce_custom_days'; quotationNumber: string; orderId?: string; startedAt?: string }
  | { action: 'awaiting_produce_custom_date_text'; quotationNumber: string; orderId?: string }
  | { action: 'awaiting_order_number_for_deposit' }
  | { action: 'awaiting_deposit_amount'; quotationNumber: string; paymentType?: 'deposit' | 'full' }
  | { action: 'awaiting_order_number_for_paybalance' }
  | { action: 'awaiting_paybalance_amount'; quotationNumber: string; imageBase64?: string; mimeType?: string; fileName?: string }
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
  | { action: 'awaiting_deposit_confirmation'; imageBase64: string; mimeType: string; fileName: string; depositAmount: number; candidates: DepositCandidate[]; paymentDate?: string; paymentType?: 'deposit' | 'full' }
  | { action: 'awaiting_deposit_client_name'; imageBase64: string; mimeType: string; fileName: string; depositAmount: number; paymentDate?: string }
  // Production tracking flow
  | { action: 'awaiting_delay_days'; orderId: string; quotationNumber: string }
  | { action: 'awaiting_delivery_timeline'; orderId: string; quotationNumber: string }
  | { action: 'awaiting_custom_delivery_days'; orderId: string; quotationNumber: string }
  | { action: 'awaiting_remaining_production_days'; orderId: string; quotationNumber: string }
  // Item-level production timeline flow
  | { action: 'awaiting_item_prod_days'; itemId: string; orderId: string; quotationNumber: string }
  | { action: 'awaiting_item_prod_delay_days'; itemId: string; orderId: string; quotationNumber: string }
  // En route flow
  | { action: 'awaiting_en_route'; orderId: string; quotationNumber: string }
  | { action: 'awaiting_en_route_arrival_days'; orderId: string; quotationNumber: string }
  | { action: 'awaiting_en_route_item_days'; itemId: string; orderId: string; quotationNumber: string }
  | { action: 'awaiting_en_route_item_new_days'; itemId: string; quotationNumber: string }
  | { action: 'awaiting_en_route_midpoint_new_days'; orderId: string; quotationNumber: string }
  | { action: 'awaiting_en_route_arrival_not_yet_days'; orderId: string; quotationNumber: string }
  | { action: 'awaiting_en_route_verif_not_yet_days'; orderId: string; quotationNumber: string }
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
  | { action: 'awaiting_deposit_slip_photo'; orderId: string; quotationNumber: string; paymentType?: 'deposit' | 'full' }
  // Inventory verification — enter partial qty
  | { action: 'awaiting_inv_verify_qty'; data: { itemId: string; orderId: string; quotationNumber: string } }
  // Bug report interactive flow
  | { action: 'awaiting_bug_title' }
  | { action: 'awaiting_bug_description'; title: string }
  | { action: 'awaiting_bug_order_pick'; title: string; description: string }
  // Schedule group chat flow
  | { action: 'awaiting_schedule_date'; scheduleText: string }
  | { action: 'awaiting_schedule_time'; scheduleText: string; scheduleDate: string }
  | { action: 'awaiting_schedule_confirm'; scheduleText: string; scheduleDate: string; scheduleTime?: string }
  | { action: 'awaiting_schedule_vision_choice'; imageBase64: string; mimeType: string; fileName: string }
  | { action: 'awaiting_schedule_vision_extract'; imageBase64: string; mimeType: string; fileName: string; extractedText?: string }
  | { action: 'awaiting_schedule_vision_notes'; imageBase64: string; mimeType: string; fileName: string; extractedText: string }
  | { action: 'awaiting_schedule_reminder'; scheduleId: string; scheduleTitle: string; scheduleDate: string };

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
const SESSIONS_FILE = '/app/.sessions.json';

function saveSessions(): void {
  try {
    const obj: Record<string, UserSession> = {};
    for (const [chatId, session] of sessions.entries()) {
      obj[chatId] = session;
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj), 'utf8');
  } catch (err) {
    console.error('[sessions] Failed to save sessions:', err);
  }
}

function loadSessions(): void {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return;
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    const obj = JSON.parse(raw) as Record<string, UserSession>;
    for (const [chatId, session] of Object.entries(obj)) {
      // Reset image-based sessions since base64 images are too large to persist
      // and would be stale anyway after a restart.
      const imageBasedActions = [
        'awaiting_vision_document_type',
        'awaiting_vision_process',
        'awaiting_vision_extract',
        'awaiting_vision_retry_extract',
        'awaiting_upload_retry',
        'awaiting_deposit_confirmation',
        'awaiting_deposit_client_name',
        'awaiting_paybalance_amount',
        'awaiting_schedule_vision_choice',
        'awaiting_schedule_vision_extract',
        'awaiting_schedule_vision_notes',
      ];
      if (imageBasedActions.includes((session.step as any).action)) {
        session.step = { action: 'idle' };
        delete session.ownerUserId;
        delete session.ownerUsername;
        delete session.lockedAt;
      }
      sessions.set(chatId, session);
    }
    console.log(`[sessions] Restored ${sessions.size} sessions from disk`);
  } catch (err) {
    console.error('[sessions] Failed to load sessions:', err);
  }
}

loadSessions();

// Periodically save sessions to disk
setInterval(() => {
  saveSessions();
}, 30_000);

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
  session.step = step;

  if (step.action !== 'idle') {
    const ctx = ctxStore.getStore();
    if (ctx) {
      session.ownerUserId = String(ctx.from?.id ?? '');
      session.ownerUsername = ctx.from?.username;
    }
    session.lockedAt = Date.now();
  } else {
    delete session.ownerUserId;
    delete session.ownerUsername;
    delete session.lockedAt;
  }

  saveSessions();
}

function resetStep(chatId: string) {
  const session = getSession(chatId);
  session.step = { action: 'idle' };
  delete session.ownerUserId;
  delete session.ownerUsername;
  delete session.lockedAt;
  saveSessions();
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

// ── Gantt-Linked Smart Status Summary ──────────────────────────────────
// Mirrors the dashboard GanttChart logic so the bot can answer order status
// queries with rich timeline context: stage pipeline, dates, days remaining,
// delay warnings, and delivery info.

const STAGE_ORDER_BOT = [
  'order_confirmation_received',
  'math_verified',
  'deposit_pending',
  'deposit_verification',
  'purchasing_pending',
  'production_pending',
  'partial_production',
  'production_in_progress',
  'en_route',
  'en_route_verification',
  'inventory_verification',
  'inventory_arrived',
  'stock_preparation',
  'balance_due',
  'balance_verification',
  'delivery_pending',
  'delivery_scheduled',
  'delivered',
  'countered',
  'payment_received',
  'payment_confirmed',
  'completed',
];

const STAGE_LABELS_BOT: Record<string, string> = {
  order_confirmation_received: '📄 Order Confirmed',
  math_verified:             '✅ Math Verified',
  purchasing_pending:        '🛒 Purchasing',
  production_pending:        '🏗️ Prod. Pending',
  partial_production:        '🔨 Partial Prod.',
  production_in_progress:    '🏭 In Production',
  deposit_pending:           '💳 Downpayment Pending',
  deposit_verification:      '🔍 Deposit Verified',
  en_route:                  '🚚 En Route',
  en_route_verification:     '🔎 En Route Verified',
  inventory_verification:    '📋 Inventory Check',
  inventory_arrived:         '📦 Stock Arrived',
  stock_preparation:         '📦 Stock Prep',
  balance_due:               '⚖️ Balance Due',
  balance_verification:      '🔍 Balance Verified',
  delivery_pending:          '⏳ Delivery Pending',
  delivery_scheduled:        '📅 Delivery Scheduled',
  delivered:                 '🚚 Delivered',
  countered:                 '📋 Countered',
  payment_received:          '💰 Payment Received',
  payment_confirmed:         '✅ Payment Confirmed',
  completed:                 '🏁 Completed',
};

interface GanttStatusSummary {
  text: string;            // Full formatted Markdown message
  isDelayed: boolean;
  daysRemaining: number;
  currentStageIndex: number;
  totalStages: number;
  stageBreakdown: string;  // Stage pipeline lines
}

function fmtBotDate(d: Date): string {
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtBotDateShort(d: Date): string {
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function buildGanttStatusSummary(order: any, clientInfo: string): GanttStatusSummary {
  const projectedLeadTime = order.projected_lead_time as number | null;
  const now = new Date();

  // Start date: deposit_paid_at > order_confirmed_at > created_at
  // Bug 2A fix: guard against all dates being null
  const startedAt = order.deposit_paid_at ?? order.order_confirmed_at ?? order.created_at;
  if (!startedAt) {
    const text = `📋 *${escapeMarkdown(order.quotation_number || 'Unknown Order')}*\n\n⚠️ No start date available for timeline computation.`;
    return { text, isDelayed: false, daysRemaining: 0, currentStageIndex: -1, totalStages: STAGE_ORDER_BOT.length, stageBreakdown: '' };
  }
  const startDate = new Date(startedAt as string);

  // Bug 2A guard: if startDate is Invalid Date
  if (isNaN(startDate.getTime())) {
    const text = `📋 *${escapeMarkdown(order.quotation_number || 'Unknown Order')}*\n\n⚠️ Invalid start date — cannot compute timeline.`;
    return { text, isDelayed: false, daysRemaining: 0, currentStageIndex: -1, totalStages: STAGE_ORDER_BOT.length, stageBreakdown: '' };
  }

  // Current stage info
  const currentStage = order.current_stage as string;
  const currentStageIndex = STAGE_ORDER_BOT.indexOf(currentStage);
  const totalStages = STAGE_ORDER_BOT.length;

  // Bug 2B fix: unknown stage → fall back to basic summary
  if (currentStageIndex < 0) {
    const stageLabel = currentStage || 'Unknown';
    let text = `📋 *${escapeMarkdown(order.quotation_number)}*\n\n`;
    text += `🏷️ Stage: *${escapeMarkdown(stageLabel)}*\n`;
    text += `📊 Status: ${escapeMarkdown(order.status ?? '—')}\n`;
    text += `💰 Total: ₱${Number(order.total_amount ?? 0).toLocaleString()}\n`;
    if (order.deposit_paid) text += `💳 Downpayment: ✅ ₱${Number(order.deposit_amount ?? 0).toLocaleString()}\n`;
    else text += `💳 Downpayment: ⏳ Pending\n`;
    if (clientInfo) text += `\n${clientInfo}`;
    return { text, isDelayed: false, daysRemaining: 0, currentStageIndex: -1, totalStages, stageBreakdown: '' };
  }

  // If no projected lead time, return a basic summary
  if (!projectedLeadTime || projectedLeadTime <= 0) {
    const stageLabel = STAGE_LABELS_BOT[currentStage] ?? currentStage;
    let text = `📋 *${escapeMarkdown(order.quotation_number)}*\n\n`;
    text += `🏷️ Stage: *${stageLabel}*\n`;
    text += `📊 Status: ${escapeMarkdown(order.status ?? '—')}\n`;
    if (order.math_status) text += `🧮 Math: ${escapeMarkdown(order.math_status)}\n`;
    text += `💰 Total: ₱${Number(order.total_amount ?? 0).toLocaleString()}\n`;
    if (order.deposit_paid) {
      text += `💳 Downpayment: ✅ ₱${Number(order.deposit_amount ?? 0).toLocaleString()}`;
      if (order.deposit_paid_at) text += ` (${fmtBotDateShort(new Date(order.deposit_paid_at))})`;
      text += `\n`;
    } else {
      text += `💳 Downpayment: ⏳ Pending\n`;
    }
    if (clientInfo) text += `\n${clientInfo}`;
    text += `\n\n💡 _Set a projected lead time to enable Gantt timeline tracking._`;
    return { text, isDelayed: false, daysRemaining: 0, currentStageIndex, totalStages, stageBreakdown: '' };
  }

  // Compute Gantt timeline
  const deadlineMs = projectedLeadTime * 86_400_000;
  const deadlineDate = new Date(startDate.getTime() + deadlineMs);
  const elapsedMs = now.getTime() - startDate.getTime();
  const totalPct = Math.min(elapsedMs / deadlineMs, 1);
  const remainingMs = Math.max(deadlineMs - elapsedMs, 0);
  const remainingDays = Math.ceil(remainingMs / 86_400_000);
  const isDelayed = elapsedMs > deadlineMs;
  const delayDays = isDelayed ? Math.ceil((elapsedMs - deadlineMs) / 86_400_000) : 0;
  const stageDurationMs = deadlineMs / totalStages;

  // Build header
  // Bug 2C fix: use deposit_paid flag, not deposit_paid_at, for label accuracy
  const startLabel = order.deposit_paid ? 'Deposit paid' : order.order_confirmed_at ? 'Order confirmed' : 'Created';
  // Bug 2D fix: handle 0d remaining edge case
  const remainingLabel = isDelayed
    ? `DELAYED by ${delayDays}d`
    : remainingDays === 0
      ? 'Due today'
      : `${remainingDays}d remaining`;
  const header = isDelayed
    ? `🔴 *${escapeMarkdown(order.quotation_number)}* — ${remainingLabel}`
    : remainingDays <= Math.ceil(projectedLeadTime * 0.15)
      ? `🟡 *${escapeMarkdown(order.quotation_number)}* — ${remainingLabel}`
      : `🟢 *${escapeMarkdown(order.quotation_number)}* — ${remainingLabel}`;

  // Stage pipeline — show each stage with status markers and approximate dates
  const stageLines: string[] = [];
  for (let i = 0; i < STAGE_ORDER_BOT.length; i++) {
    const stage = STAGE_ORDER_BOT[i];
    const label = STAGE_LABELS_BOT[stage] ?? stage;
    const segStartMs = i * stageDurationMs;
    const segEndMs = (i + 1) * stageDurationMs;
    const approxStart = new Date(startDate.getTime() + segStartMs);
    const approxEnd = new Date(startDate.getTime() + segEndMs);

    let marker: string;
    if (i < currentStageIndex) {
      marker = '✅';
    } else if (i === currentStageIndex) {
      marker = '◉';
    } else {
      marker = '○';
    }
    const dateRange = `${fmtBotDateShort(approxStart)}–${fmtBotDateShort(approxEnd)}`;
    stageLines.push(`${marker} ${label}  _${dateRange}_`);
  }

  // Days in current stage — from the stage_update created_at for the current stage
  let daysInStage = 0;
  const currentStageUpdate = (order.stage_updates as any[] | undefined)
    ?.find((u: any) => u.stage === currentStage);
  if (currentStageUpdate?.created_at) {
    daysInStage = Math.floor((now.getTime() - new Date(currentStageUpdate.created_at).getTime()) / 86_400_000);
  } else if (order.updated_at) {
    daysInStage = Math.floor((now.getTime() - new Date(order.updated_at).getTime()) / 86_400_000);
  }

  // Build full message
  let text = `${header}\n\n`;
  text += `📊 Stage: *${STAGE_LABELS_BOT[currentStage] ?? currentStage}*`;
  if (daysInStage > 0) text += ` (${daysInStage}d in stage)`;
  text += `\n`;
  text += `📅 ${startLabel}: *${fmtBotDate(startDate)}*\n`;
  text += `🎯 Due: *${fmtBotDate(deadlineDate)}*\n`;
  text += `📈 Progress: ${Math.round(totalPct * 100)}%  —  ${currentStageIndex + 1}/${totalStages} stages\n`;

  if (isDelayed) {
    text += `\n⚠️ *Overdue by ${delayDays} day${delayDays !== 1 ? 's' : ''}*\n`;
  } else if (remainingDays <= Math.ceil(projectedLeadTime * 0.15)) {
    text += `\n⚡ *Only ${remainingDays} day${remainingDays !== 1 ? 's' : ''} left — at risk!*\n`;
  }

  // Financial summary
  const totalAmount = Number(order.total_amount ?? 0);
  const depositAmount = Number(order.deposit_amount ?? 0);
  text += `\n💰 Total: *₱${totalAmount.toLocaleString()}*\n`;
  if (order.deposit_paid) {
    text += `💳 Downpayment: ✅ ₱${depositAmount.toLocaleString()}`;
    if (order.deposit_paid_at) text += ` (${fmtBotDateShort(new Date(order.deposit_paid_at))})`;
    text += `\n`;
  } else {
    text += `💳 Downpayment: ⏳ Pending\n`;
  }

  if (clientInfo) text += `\n${clientInfo}`;

  // Stage pipeline (collapsed view)
  const activeStages = stageLines.filter((_, i) => {
    // Show only nearby stages: 1 before, current, 2 after
    return i >= Math.max(0, currentStageIndex - 1) && i <= Math.min(totalStages - 1, currentStageIndex + 3);
  });
  if (currentStageIndex > 1) activeStages.unshift('   ...');
  if (currentStageIndex < totalStages - 4) activeStages.push('   ...');

  text += `\n\n📋 *Pipeline:*\n${activeStages.join('\n')}`;

  return { text, isDelayed, daysRemaining: remainingDays, currentStageIndex, totalStages, stageBreakdown: stageLines.join('\n') };
}

// ── Smart Order Query — natural language detection ─────────────────────
/**
 * OpenClaw-powered smart query — replaced old QTN-only trySmartOrderQuery.
 * Routes ANY natural language query through the OpenClaw engine which:
 * 1. Searches by client name, quotation number, stage, keywords
 * 2. Returns formatted order status with ETA + suggested action buttons
 * 3. Falls back to CentralBrain lessons, then Gemini AI
 */
async function trySmartOrderQuery(chatId: string, text: string): Promise<{ text: string; actions?: Array<{ label: string; callback_data: string }> } | null> {
  try {
    const res = await fetch(`${apiBaseUrl}/openclaw/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, username: null, chat_type: 'group' }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      formatted_reply?: string;
      reply: string;
      suggested_actions?: Array<{ label: string; callback_data: string }>;
    };
    return {
      text: data.formatted_reply ?? data.reply,
      actions: data.suggested_actions,
    };
  } catch {
    return null;
  }
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
  fileType?: string;
}) {
  const payload: Record<string, unknown> = {
    file_type: params.fileType ?? 'quotation',
    original_filename: params.fileName,
    mime_type: params.mimeType,
    file_data: params.imageBase64,
    telegram_chat_id: params.chatId,
    uploaded_by: params.uploadedBy,
  };

  if (params.telegramMessageId) payload.telegram_message_id = params.telegramMessageId;
  if (params.quotationNumber) payload.quotation_number = params.quotationNumber;

  await postJson('/files/upload', payload);
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
    // Split at paragraph boundaries BUT preserve HTML tag integrity
    // This prevents broken <b>, </b>, <code>, </code> etc. across chunks
    const paragraphs = text.split('\n\n');
    let current = '';
    for (const para of paragraphs) {
      const candidate = current ? current + '\n\n' + para : para;
      if (candidate.length > MAX_LEN && current.length > 0) {
        chunks.push(current.trim());
        current = para;
      } else {
        current = candidate;
      }
    }
    if (current) chunks.push(current.trim());

    // Fallback: force split at safe (non-tag) boundaries
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].length > MAX_LEN) {
        const forced = chunks[i];
        chunks.splice(i, 1);
        // Split at newlines first (safer than mid-tag), then char boundary
        const lines = forced.split('\n');
        let lineChunk = '';
        for (const line of lines) {
          const lineCandidate = lineChunk ? lineChunk + '\n' + line : line;
          if (lineCandidate.length > MAX_LEN && lineChunk.length > 0) {
            chunks.push(lineChunk.trim());
            lineChunk = line;
          } else {
            lineChunk = lineCandidate;
          }
        }
        if (lineChunk) chunks.push(lineChunk.trim());
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

// ── Inline Confirmation: Confirm ──────────────────────────────────────
// Replaces the "type 888 in chat" flow. The middleware stored the pending
// action in session; tapping ✅ Confirm re-dispatches it.

bot.action('confirm_action:yes', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);
  await ctx.answerCbQuery();

  if (session.step.action !== 'awaiting_confirmation') return;

  const { callbackData, messageId, originalText, chatInstance, previousStep } = session.step;

  // Restore the original session step so the re-dispatched handler can access
  // flow-specific data (e.g. depositAmount, imageBase64 from awaiting_deposit_confirmation)
  setStep(chatId, previousStep);

  const confirmKey = `${callbackData}:${chatId}`;
  confirmedCallbacks.add(confirmKey);

  const syntheticUpdate: any = {
    update_id: Date.now(),
    callback_query: {
      id: `confirm_${Date.now()}`,
      from: ctx.from,
      message: {
        message_id: messageId,
        chat: ctx.chat,
        date: Math.floor(Date.now() / 1000),
        text: originalText,
      },
      chat_instance: chatInstance,
      data: callbackData,
    },
  };

  bot.handleUpdate(syntheticUpdate).catch((err) => {
    console.error('[bot] Error re-dispatching confirmed callback:', err);
  });
});

// ── Inline Confirmation: Cancel ───────────────────────────────────────

bot.action('confirm_action:cancel', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);
  await ctx.answerCbQuery('❌ Cancelled');

  if (session.step.action === 'awaiting_confirmation') {
    const { messageId, originalText, previousStep } = session.step;
    setStep(chatId, previousStep);
    try {
      await ctx.telegram.editMessageText(chatId, messageId, undefined, originalText, { parse_mode: 'HTML' });
    } catch {
      // Message may no longer be editable — ignore
    }
  }
});

// ── Schedule Actions ──────────────────────────────────────────────────

/**
 * schedule:confirm — User confirmed a schedule entry. Create it via API.
 */
bot.action('schedule:confirm', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);
  await ctx.answerCbQuery('✅ Confirmed');

  if (session.step.action !== 'awaiting_schedule_confirm') {
    await ctx.reply('❌ No pending schedule to confirm.');
    return;
  }

  const { scheduleText, scheduleDate, scheduleTime } = session.step;
  const username = ctx.from?.username ?? String(ctx.from?.id ?? '');
  const title = scheduleText.length > 200 ? scheduleText.substring(0, 197) + '...' : scheduleText;

  try {
    const result = await postJson('/calendar/schedules', {
      title,
      description: scheduleText,
      schedule_date: scheduleDate,
      schedule_time: scheduleTime ?? null,
      created_by: username,
      created_by_chat_id: chatId,
    });

    resetStep(chatId);

    const timeStr = scheduleTime ? ` at ${scheduleTime}` : '';
    await ctx.reply(
      `✅ *Schedule Added!*\n\n📅 *${title}*\n📆 ${scheduleDate}${timeStr}\n\nWant to set a reminder?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('⏰ Set Reminder', `schedule:reminder:${result.id}`),
            Markup.button.callback('✅ No, thanks', 'action:cancel'),
          ],
        ]),
      }
    );
  } catch (err: any) {
    console.error('[bot] Failed to create schedule:', err);
    await ctx.reply(`❌ Failed to create schedule: ${err.message}`, { ...cancelButton() });
  }
});

/**
 * schedule:edit_date — User wants to change the date of a detected schedule.
 */
bot.action('schedule:edit_date', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);
  await ctx.answerCbQuery('🔄 Edit date');

  if (session.step.action !== 'awaiting_schedule_confirm') {
    await ctx.reply('❌ No pending schedule to edit.');
    return;
  }

  const { scheduleText, scheduleTime } = session.step;
  setStep(chatId, {
    action: 'awaiting_schedule_date',
    scheduleText,
  });

  await ctx.reply(
    `📝 What date should this be on?\n(e.g., \`today\`, \`tomorrow\`, \`2026-06-15\`, or a day name)`,
    { parse_mode: 'Markdown', ...cancelButton() }
  );
});

/**
 * schedule:reminder:<id> — Set a reminder for a schedule.
 */
bot.action(/^schedule:reminder:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const scheduleId = ctx.match[1];
  await ctx.answerCbQuery('⏰ Set reminder');

  // Get schedule details
  try {
    const schedule = await getJson(`/calendar/schedules/${scheduleId}`);
    if (!schedule) {
      await ctx.reply('❌ Schedule not found.');
      return;
    }

    setStep(chatId, {
      action: 'awaiting_schedule_reminder',
      scheduleId,
      scheduleTitle: schedule.title,
      scheduleDate: schedule.schedule_date,
    });

    await ctx.reply(
      `⏰ *Set Reminder for:* ${schedule.title}\n📆 ${schedule.schedule_date}\n\nWhen should I remind you?\n(e.g., \`1 hour before\`, \`30 minutes before\`, \`1 day before\`, \`at 08:00\`)`,
      { parse_mode: 'Markdown', ...cancelButton() }
    );
  } catch (err: any) {
    console.error('[bot] Failed to get schedule:', err);
    await ctx.reply(`❌ Failed to get schedule: ${err.message}`, { ...cancelButton() });
  }
});

/**
 * schedule:list — Show today's schedules.
 */
bot.action('schedule:list', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  await ctx.answerCbQuery('📋 Loading schedules...');

  try {
    const today = new Date().toISOString().slice(0, 10);
    const schedules = await getJson(`/calendar/schedules/by-date/${today}`);

    if (!Array.isArray(schedules) || schedules.length === 0) {
      await ctx.reply('📋 *No schedules for today.*', { parse_mode: 'Markdown' });
      return;
    }

    const lines = schedules.map((s: any, i: number) =>
      `${i + 1}. ${s.schedule_time ? `🕐 ${s.schedule_time.slice(0, 5)}` : '📅'} *${s.title}*${s.description ? `\n   ${s.description}` : ''}`
    );

    await ctx.reply(
      `📋 *Today's Schedules (${today})*\n\n${lines.join('\n')}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err: any) {
    console.error('[bot] Failed to list schedules:', err);
    await ctx.reply(`❌ Failed to load schedules: ${err.message}`);
  }
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

        // Build client delivery info
        let clientInfo = '';
        const client = order.client_name ? await lookupClient(order.client_name).catch(() => null) : null;
        if (client) {
          const info = formatClientInfo(client);
          if (info) clientInfo = `🚚 *Delivery Info:*\n${info}`;
        } else if (order.delivery_address) {
          clientInfo = `🚚 *Delivery Info:*\n📍 ${escapeMarkdown(order.delivery_address)}`;
          if (order.contact_number) clientInfo += `\n📞 ${escapeMarkdown(order.contact_number)}`;
          if (order.authorized_receiver_name) clientInfo += `\n👤 *Auth. Receiver:* ${escapeMarkdown(order.authorized_receiver_name)}`;
        }

        // Use Gantt-powered smart status summary
        const summary = buildGanttStatusSummary(order, clientInfo);
        resetStep(chatId);
        await safeReply(ctx, summary.text, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard().reply_markup });
      } catch {
        resetStep(chatId);
        await ctx.editMessageText(`❌ Error fetching order *${quotationNumber}*.`, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
      }
      break;
    }

    case 'produce': {
      setStep(chatId, { action: 'awaiting_produce_status', quotationNumber });
      const prompt = await buildProductionPromptPayload(quotationNumber);
      await ctx.editMessageText(prompt.text, { parse_mode: 'Markdown', ...prompt.keyboard });
      break;
    }

    case 'deposit': {
      await ctx.editMessageText(
        `💳 *Payment Before Production for ${quotationNumber}*\n\nIs this a downpayment or full payment?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('💳 Downpayment', `deposit:type:deposit:${quotationNumber}`)],
            [Markup.button.callback('✅ Full Payment', `deposit:type:full:${quotationNumber}`)],
            [Markup.button.callback('❌ Cancel', 'action:cancel')],
          ]),
        }
      );
      break;
    }

    case 'paybalance': {
      // Fetch order to get its DB id for the proof-photo step
      let orderId = '';
      try {
        const res = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
        if (res.ok) { const o: any = await res.json(); orderId = String(o.id ?? ''); }
      } catch { /* non-fatal — orderId can be empty */ }
      setStep(chatId, { action: 'awaiting_balance_proof_photo', orderId, quotationNumber });
      await ctx.editMessageText(
        `💰 *Balance Payment for ${quotationNumber}*\n\n` +
        `📸 Send a **photo of the payment slip** and the AI will extract the amount automatically.\n\n` +
        `Or tap *Skip* to enter the amount manually.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⏭ Skip — enter manually', `paybalance:skip:${quotationNumber}`)],
            [Markup.button.callback('❌ Cancel', 'action:cancel')],
          ]),
        }
      );
      break;
    }

    case 'deliverydate': {
      let order: any;
      try {
        order = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
        const totalAmount = Number(order.total_amount ?? 0);
        const depositAmount = Number(order.deposit_amount ?? 0);
        // Fetch actual remaining balance from payments API
        let remainingBalance = Math.max(totalAmount - depositAmount, 0);
        try {
          const paymentsRes = await fetch(`${apiBaseUrl}/orders/${order.id}/payments`);
          if (paymentsRes.ok) {
            const paymentsData = await paymentsRes.json();
            remainingBalance = paymentsData.totals?.remaining_balance ?? remainingBalance;
          }
        } catch { /* use computed fallback */ }
        if (remainingBalance > 0) {
          // Allow scheduling but warn about remaining balance
          await ctx.reply(
            `⚠️ *Balance Not Fully Paid*\n\n` +
            `Order: *${quotationNumber}*\n` +
            `Total: ₱${totalAmount.toLocaleString()}\n` +
            `Deposit: ₱${depositAmount.toLocaleString()}\n` +
            `Remaining Balance: ₱${remainingBalance.toLocaleString()}\n\n` +
            `You may still schedule delivery, but the client still owes ₱${remainingBalance.toLocaleString()}.`,
            { parse_mode: 'Markdown', ...cancelButton() }
          );
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

    case 'bug_order': {
      const session = getSession(chatId);
      if (session.step.action !== 'awaiting_bug_order_pick') {
        await ctx.answerCbQuery('Session expired. Please start again with /bug');
        resetStep(chatId);
        return;
      }
      const { title, description } = session.step;

      if (quotationNumber === 'skip') {
        // Submit without order reference
        try {
          await postJson('/bug-reports', {
            title,
            description,
            source: 'telegram',
            reporter_name: username ?? null,
            reporter_contact: userId,
            order_reference: null,
          });
          resetStep(chatId);
          await ctx.editMessageText(
            `✅ *Bug Report Submitted*\n\nTitle: ${title}\n\nThank you! The development team has been notified.`,
            { parse_mode: 'Markdown' }
          );
        } catch (err: any) {
          console.error('[bot] Failed to submit bug report:', err);
          await ctx.editMessageText('❌ Failed to submit bug report. Please try again later.', { ...cancelButton() });
        }
      } else {
        // Submit with order reference
        try {
          await postJson('/bug-reports', {
            title,
            description,
            source: 'telegram',
            reporter_name: username ?? null,
            reporter_contact: userId,
            order_reference: quotationNumber,
          });
          resetStep(chatId);
          await ctx.editMessageText(
            `✅ *Bug Report Submitted*\n\nTitle: ${title}\nOrder: ${quotationNumber}\n\nThank you! The development team has been notified.`,
            { parse_mode: 'Markdown' }
          );
        } catch (err: any) {
          console.error('[bot] Failed to submit bug report:', err);
          await ctx.editMessageText('❌ Failed to submit bug report. Please try again later.', { ...cancelButton() });
        }
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
    await logAction({ chatId, userId, username, label: 'Schedule Delivery', quotationNumber, details: `Date: ${dateText}` });
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
    await logAction({ chatId, userId, username, label: 'Mark as Delivered', quotationNumber });
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

  // ── Skip slash commands so bot.command() handlers can process them ──
  if (text.startsWith('/')) {
    return;
  }

  // ── OpenClaw Intelligent Routing — Handle ALL idle text messages ──
  // Instead of routing each group separately, OpenClaw routes to the right
  // handler (production assistant, schedule parser, or general query)
  // via the single /openclaw/query endpoint.
  if (session.step.action === 'idle') {
    const botUsername = (bot.botInfo?.username ?? '').toLowerCase();
    const mentionsBot = botUsername && text.toLowerCase().includes(`@${botUsername}`);
    const hasQtn = /qtn[-\s]?\w+/i.test(text);

    // ── Determine which chat type this is ───────────────────────────
    const PRODUCTION_CHAT_ID = process.env.PRODUCTION_GROUP_CHAT_ID ?? process.env.PRODUCTION_GROUP_ID ?? '';
    const isProductionChat = PRODUCTION_CHAT_ID && chatId === PRODUCTION_CHAT_ID;
    const SCHEDULE_CHAT_ID = process.env.SCHEDULE_GROUP_CHAT_ID ?? process.env.SCHEDULE_GROUP_ID ?? '';
    const isScheduleChat = SCHEDULE_CHAT_ID && chatId === SCHEDULE_CHAT_ID;

    // ── Production chat: production assistant first ─────────────
    // Issue 4A fix: run specialized handlers BEFORE generic smart order query
    if (isProductionChat) {
      const handled = await handleProdQuickAction(ctx, text, chatId);
      if (handled) return;

      // Action keywords only — route status queries to OpenClaw for richer responses
      const hasKeyword = /\b(done|finished|produced|complete|shipped|en.?route|dispatched|pending|delayed|ready|all|items?)\b/i.test(text);

      if (mentionsBot || hasQtn || hasKeyword) {
        try {
          const res = await fetch(`${apiBaseUrl}/production/chat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text, username: username ?? null }),
            signal: AbortSignal.timeout(20_000),
          });

          if (res.ok) {
            const data = await res.json() as {
              reply: string | null;
              action?: {
                type: 'mark_items_produced' | 'confirm_en_route';
                orderId: string;
                quotationNumber: string;
                itemIds?: string[];
              };
            };

            if (!data.reply) return; // 'ignore' intent — stay silent

            if (data.action?.type === 'mark_items_produced' && data.action.itemIds?.length) {
              const { orderId, quotationNumber, itemIds } = data.action;
              await ctx.reply(
                `${data.reply}\n\nShould I mark ${itemIds.length} item(s) as produced for *${quotationNumber}*?`,
                {
                  parse_mode: 'Markdown',
                  ...Markup.inlineKeyboard([
                    [
                      Markup.button.callback('✅ Yes, mark produced', `assistant:mark_produced:${orderId}:${quotationNumber}:${itemIds.join(',')}`),
                      Markup.button.callback('❌ No', 'assistant:cancel'),
                    ],
                  ]),
                }
              );
            } else if (data.action?.type === 'confirm_en_route') {
              const { orderId, quotationNumber } = data.action;
              await ctx.reply(
                `${data.reply}\n\nShould I mark *${quotationNumber}* as en route?`,
                {
                  parse_mode: 'Markdown',
                  ...Markup.inlineKeyboard([
                    [
                      Markup.button.callback('✅ Yes, en route', `assistant:en_route:${orderId}:${quotationNumber}`),
                      Markup.button.callback('❌ No', 'assistant:cancel'),
                    ],
                  ]),
                }
              );
            } else {
              await ctx.reply(data.reply);
            }
            return;
          }
        } catch (err) {
          console.error('[bot] Production assistant error:', err);
          // Swallow — don't spam the group on AI failures
        }
      }

      // OpenClaw fallback: route any query through the intelligence engine
      // (client names, QTN numbers, natural language — everything)
      {
        const smartResult = await trySmartOrderQuery(chatId, text);
        if (smartResult) {
          let keyboard;
          if (smartResult.actions && smartResult.actions.length > 0) {
            keyboard = Markup.inlineKeyboard(
              smartResult.actions.map((a) => [Markup.button.callback(a.label, a.callback_data)])
            );
          }
          await safeReply(ctx, smartResult.text, {
            parse_mode: 'HTML',
            ...(keyboard ? keyboard : {}),
          });
          // Still refresh the production panel (Issue 4B fix)
          await showOrUpdatePanel(ctx, chatId);
          return;
        }
      }
      // Always show/update the persistent control panel after any message in the production chat
      await showOrUpdatePanel(ctx, chatId);
      return;
    }

    // ── Schedule group chat ──────────────────────────────────────────
    if (isScheduleChat) {
      try {
        const res = await fetch(`${apiBaseUrl}/agents/run/schedule-parser`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, username: username ?? null }),
          signal: AbortSignal.timeout(15_000),
        });

        if (res.ok) {
          const data = await res.json() as {
            parsed: boolean;
            title?: string;
            date?: string;
            time?: string;
            description?: string;
            reply?: string;
          };

          if (data.parsed && data.title && data.date) {
            // AI successfully parsed — ask user to confirm
            const dateStr = data.date;
            const timeStr = data.time ? ` at ${data.time}` : '';
            const descStr = data.description ? `\n📝 ${data.description}` : '';
            const confirmText = `📅 *New Schedule Detected*

*Title:* ${data.title}
*Date:* ${dateStr}${timeStr}${descStr}

Is this correct?`;

            setStep(chatId, {
              action: 'awaiting_schedule_confirm',
              scheduleText: text,
              scheduleDate: dateStr,
              scheduleTime: data.time,
            });

            await ctx.reply(confirmText, {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [
                  Markup.button.callback('✅ Confirm & Add', 'schedule:confirm'),
                  Markup.button.callback('🔄 Edit Date', 'schedule:edit_date'),
                ],
                [
                  Markup.button.callback('❌ Cancel', 'action:cancel'),
                ],
              ]),
            });
            return;
          } else if (data.reply) {
            // AI has a response but couldn't parse — show it
            await ctx.reply(data.reply, { parse_mode: 'Markdown' });
            return;
          }
        }
      } catch (err) {
        console.error('[bot] Schedule parser error:', err);
        // Fall through to manual parsing
      }

      // Fallback: manual date parsing
      const dateMatch = text.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
      const dayNames = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|today|tomorrow)\b/i;
      const dayMatch = text.match(dayNames);

      if (dateMatch || dayMatch) {
        // Has a date reference — ask for confirmation
        let detectedDate = '';
        if (dateMatch) {
          const [, m, d, y] = dateMatch;
          const year = y ? (y.length === 2 ? `20${y}` : y) : String(new Date().getFullYear());
          detectedDate = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        } else if (dayMatch) {
          const dayStr = dayMatch[0].toLowerCase();
          if (dayStr === 'today') {
            detectedDate = new Date().toISOString().slice(0, 10);
          } else if (dayStr === 'tomorrow') {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            detectedDate = d.toISOString().slice(0, 10);
          } else {
            // Find next occurrence of that day
            const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const targetDay = days.findIndex(d => d.startsWith(dayStr.slice(0, 3)));
            if (targetDay >= 0) {
              const today = new Date();
              const currentDay = today.getDay();
              let diff = targetDay - currentDay;
              if (diff <= 0) diff += 7;
              const d = new Date();
              d.setDate(d.getDate() + diff);
              detectedDate = d.toISOString().slice(0, 10);
            }
          }
        }

        if (detectedDate) {
          const timeMatch = text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
          const detectedTime = timeMatch
            ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`
            : undefined;

          setStep(chatId, {
            action: 'awaiting_schedule_confirm',
            scheduleText: text,
            scheduleDate: detectedDate,
            scheduleTime: detectedTime,
          });

          const timeStr = detectedTime ? ` at ${detectedTime}` : '';
          await ctx.reply(
            `📅 *Schedule Detected*

*Text:* ${text}
*Date:* ${detectedDate}${timeStr}

Is this correct?`,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [
                  Markup.button.callback('✅ Confirm & Add', 'schedule:confirm'),
                  Markup.button.callback('🔄 Edit Date', 'schedule:edit_date'),
                ],
                [
                  Markup.button.callback('❌ Cancel', 'action:cancel'),
                ],
              ]),
            }
          );
          return;
        }
      }

      // No date detected — try OpenClaw for any order/client query before asking for date
      {
        const smartResult = await trySmartOrderQuery(chatId, text);
        if (smartResult) {
          let keyboard;
          if (smartResult.actions && smartResult.actions.length > 0) {
            keyboard = Markup.inlineKeyboard(
              smartResult.actions.map((a) => [Markup.button.callback(a.label, a.callback_data)])
            );
          }
          await safeReply(ctx, smartResult.text, {
            parse_mode: 'HTML',
            ...(keyboard ? keyboard : {}),
          });
          return;
        }
      }

      // No date AND no order — ask user for the date
      setStep(chatId, {
        action: 'awaiting_schedule_date',
        scheduleText: text,
      });

      await ctx.reply(
        `📝 *Schedule Entry*

I'll save this as a schedule. What date should this be on?
(e.g., \`today\`, \`tomorrow\`, \`2026-06-15\`, or a day name like \`Monday\`)`,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
      return;
    }

    // ── OpenClaw: universal query for DM / non-specialized groups ──
    // Routes ALL messages through the intelligence engine
    {
      const smartResult = await trySmartOrderQuery(chatId, text);
      if (smartResult) {
        let keyboard;
        if (smartResult.actions && smartResult.actions.length > 0) {
          keyboard = Markup.inlineKeyboard(
            smartResult.actions.map((a) => [Markup.button.callback(a.label, a.callback_data)])
          );
        }
        await safeReply(ctx, smartResult.text, {
          parse_mode: 'HTML',
          ...(keyboard ? keyboard : {}),
        });
        return;
      }
    }

    // DM or non-production group: show main menu
    await ctx.reply(
      '🏠 *Main Menu*\nChoose an action below:',
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
    return;
  }

  switch (session.step.action) {
    // ── Confirmation Passcode ───────────────────────────────────────
    // When a user clicks a consequential button, the middleware asks them
    // to type 888 to confirm. This handler processes that confirmation.
    case 'awaiting_confirmation': {
      const { callbackData, messageId, originalText, chatInstance, previousStep } = session.step;

      if (text === CONFIRMATION_CODE) {
        // Confirmed — restore the original session step and re-dispatch the callback
        setStep(chatId, previousStep);

        // Add to confirmed set so the middleware skips this re-dispatch
        const confirmKey = `${callbackData}:${chatId}`;
        confirmedCallbacks.add(confirmKey);

        // Build a synthetic callback query update to re-trigger the original handler
        const syntheticUpdate: any = {
          update_id: Date.now(),
          callback_query: {
            id: `confirm_${Date.now()}`,
            from: ctx.from,
            message: {
              message_id: messageId,
              chat: ctx.chat,
              date: Math.floor(Date.now() / 1000),
              text: originalText,
            },
            chat_instance: chatInstance,
            data: callbackData,
          },
        };

        bot.handleUpdate(syntheticUpdate).catch((err) => {
          console.error('[bot] Error re-dispatching confirmed callback:', err);
        });
      } else {
        // Cancelled — restore the original step and message
        setStep(chatId, previousStep);
        await ctx.reply('❌ Action cancelled.', { parse_mode: 'Markdown' }).catch(() => {});
        // Try to restore the original message text
        try {
          await ctx.telegram.editMessageText(chatId, messageId, undefined, originalText, { parse_mode: 'Markdown' });
        } catch {
          // Ignore if message can't be restored
        }
      }
      return;
    }

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

        // Build client delivery info
        let clientInfo = '';
        const client = order.client_name ? await lookupClient(order.client_name).catch(() => null) : null;
        if (client) {
          const info = formatClientInfo(client);
          if (info) clientInfo = `🚚 *Delivery Info:*\n${info}`;
        } else if (order.delivery_address) {
          clientInfo = `🚚 *Delivery Info:*\n📍 ${escapeMarkdown(order.delivery_address)}`;
          if (order.contact_number) clientInfo += `\n📞 ${escapeMarkdown(order.contact_number)}`;
          if (order.authorized_receiver_name) clientInfo += `\n👤 *Auth. Receiver:* ${escapeMarkdown(order.authorized_receiver_name)}`;
        }

        // Use Gantt-powered smart status summary
        const summary = buildGanttStatusSummary(order, clientInfo);
        resetStep(chatId);
        await safeReply(ctx, summary.text, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard().reply_markup });
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
      const prompt = await buildProductionPromptPayload(quotationNumber);
      await ctx.reply(prompt.text, { parse_mode: 'Markdown', ...prompt.keyboard });
      break;
    }

    // ── Produce Custom Days (after "Enter custom days" button) ─────────
    case 'awaiting_produce_custom_days': {
      const { quotationNumber } = session.step;
      const estimatedDays = parseProductionDays(text);
      if (!estimatedDays || estimatedDays <= 0) {
        await ctx.reply('Please enter the number of days (e.g. `45`) or a target date (e.g. `Jul 15`).', {
          parse_mode: 'Markdown',
          ...cancelButton(),
        });
        return;
      }

      try {
        const order = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
        const payload: any = {
          production_started: true,
          estimated_production_days: estimatedDays,
        };
        const startedAt = (session.step as any).startedAt;
        if (startedAt) payload.started_at = startedAt;
        await postJson(`/orders/${order.id}/set-production`, payload);

        // Also mark all order items as in_progress so they appear in Production In Progress
        try {
          const itemsRes = await fetch(`${apiBaseUrl}/orders/${order.id}/items`);
          const itemsData = await itemsRes.json();
          const items: any[] = itemsData?.items ?? [];
          if (items.length > 0) {
            await Promise.all(items.map((item: any) =>
              patchJson(`/orders/${order.id}/items/${item.id}`, {
                production_status: 'in_progress',
                estimated_production_days: estimatedDays,
              })
            ));
          }
        } catch { /* non-fatal — items may not exist */ }

        await logAction({ chatId, userId, username, label: 'Production Started', quotationNumber, details: `Timeline: ${estimatedDays} day(s)` });
        resetStep(chatId);
        await ctx.reply(
          `✅ *Production Started* — ${quotationNumber}\n\nTimeline: *${estimatedDays} days*\n\nA midpoint check will be sent in *${Math.max(1, Math.floor(estimatedDays / 2))} days* to confirm if production is on time, early, or delayed. A due reminder will follow at the end of the production window.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (err: any) {
        await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
      }
      break;
    }

    // ── Awaiting Custom Date Text (user typed a date) ──────────────────
    case 'awaiting_produce_custom_date_text': {
      const { quotationNumber, orderId } = session.step;
      // Try to parse the date text
      const parsedDate = new Date(text);
      let startedAt: string | undefined;
      if (!isNaN(parsedDate.getTime())) {
        startedAt = parsedDate.toISOString();
      } else {
        // Try common date formats: "June 15", "Jun 15", "06/15", "15/06"
        const formats = [
          /^(\d{4})-(\d{2})-(\d{2})$/,                         // 2026-06-15
          /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,                    // 06/15/2026
          /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/,          // June 15
          /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)$/,          // 15 June
        ];
        for (const fmt of formats) {
          const m = text.match(fmt);
          if (m) {
            if (fmt === formats[0]) {
              startedAt = new Date(`${m[1]}-${m[2]}-${m[3]}T08:00:00+08:00`).toISOString();
            } else if (fmt === formats[1]) {
              startedAt = new Date(`${m[3]}-${m[1]}-${m[2]}T08:00:00+08:00`).toISOString();
            } else if (fmt === formats[2]) {
              startedAt = new Date(`${m[1]} ${m[2]}, ${new Date().getFullYear()}T08:00:00+08:00`).toISOString();
            } else if (fmt === formats[3]) {
              startedAt = new Date(`${m[2]} ${m[1]}, ${new Date().getFullYear()}T08:00:00+08:00`).toISOString();
            }
            break;
          }
        }
      }

      if (!startedAt) {
        await ctx.reply(
          `Could not parse "${text}". Try a format like \`Jun 15\`, \`2026-06-15\`, or \`15 June\`.`,
          { parse_mode: 'Markdown', ...cancelButton() }
        );
        return;
      }

      setStep(chatId, { action: 'awaiting_produce_custom_days', quotationNumber, orderId, startedAt });
      await ctx.reply(
        `📅 Date set to: *${new Date(startedAt).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}*\n\nHow long is production?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📅 28 days (standard)', `produce:days:28:${orderId?.slice(0, 8) ?? ''}:${quotationNumber}`)],
            [Markup.button.callback('✏️ Enter custom days', `produce:custom:${orderId?.slice(0, 8) ?? ''}:${quotationNumber}`)],
            [Markup.button.callback('❌ Cancel', 'action:cancel')],
          ]),
        }
      );
      break;
    }

    // ── Produce Remarks (legacy — kept for backward compatibility) ──────
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

        // Also mark all order items as in_progress so they appear in Production In Progress
        try {
          const itemsRes = await fetch(`${apiBaseUrl}/orders/${order.id}/items`);
          const itemsData = await itemsRes.json();
          const items: any[] = itemsData?.items ?? [];
          if (items.length > 0) {
            await Promise.all(items.map((item: any) =>
              patchJson(`/orders/${order.id}/items/${item.id}`, {
                production_status: 'in_progress',
                estimated_production_days: estimatedDays,
              })
            ));
          }
        } catch { /* non-fatal — items may not exist */ }

        await logAction({ chatId, userId, username, label: 'Production Started', quotationNumber, details: `Timeline: ${estimatedDays} day(s)` });
        resetStep(chatId);
        await ctx.reply(
          `✅ *Production Started* — ${quotationNumber}\n\nTimeline: *${estimatedDays} days*\n\nA midpoint check will be sent in *${Math.max(1, Math.floor(estimatedDays / 2))} days* to confirm if production is on time, early, or delayed. A due reminder will follow at the end of the production window.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (err: any) {
        await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
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
      await ctx.reply(
        `?? *Payment Before Production for ${quotationNumber}*

Is this a downpayment or full payment?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('?? Downpayment', `deposit:type:deposit:${quotationNumber}`)],
            [Markup.button.callback('? Full Payment', `deposit:type:full:${quotationNumber}`)],
            [Markup.button.callback('? Cancel', 'action:cancel')],
          ]),
        }
      );
      break;
    }

    case 'awaiting_deposit_amount': {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('Invalid amount. Please enter a positive number (e.g., `5000`).', {
          parse_mode: 'Markdown',
          ...cancelButton(),
        });
        return;
      }
      const { quotationNumber, paymentType } = session.step;
      const label = paymentTypeLabel(paymentType);
      try {
        await recordPreProductionPayment({
          quotationNumber,
          amount,
          paymentType,
          updatedBy: ctx.from?.username ?? String(ctx.from?.id),
        });
        await logAction({ chatId, userId, username, label: `Record ${label}`, quotationNumber, details: `PHP ${amount.toLocaleString()}` });
        resetStep(chatId);
        await ctx.reply(
          `? *${label} Recorded*\n\nOrder: *${quotationNumber}*\nAmount: PHP ${amount.toLocaleString()}\n\n${paymentType === 'full' ? 'Full payment has been recorded and is awaiting verification.' : 'Production can now proceed after verification.'}`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (err: any) {
        const errorMsg = err.message ?? String(err);
        const dashboardBase = process.env.DASHBOARD_BASE_URL ?? 'https://track.homeatelier.ph';
        await ctx.reply(
          `? *Error Recording ${label}*\n\n` +
          `Order: *${quotationNumber}*\n` +
          `Amount: PHP ${amount.toLocaleString()}\n\n` +
          `Error: ${escapeMarkdown(errorMsg)}\n\n` +
          `You can try again or record this on the dashboard:\n` +
          `${dashboardBase}/orders/${encodeURIComponent(quotationNumber)}`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('Try Again', `pick:deposit:${quotationNumber}`)],
              [Markup.button.callback('Main Menu', 'menu:main')],
            ]),
          }
        );
      }
      break;
    }

    // ── Pay Balance ─────────────────────────────────────────────────
    case 'awaiting_order_number_for_paybalance': {
      const quotationNumber = text;
      let orderId = '';
      try {
        const res = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
        if (!res.ok) {
          await ctx.reply(`❌ Order *${quotationNumber}* not found.`, {
            parse_mode: 'Markdown',
            ...cancelButton(),
          });
          return;
        }
        const o: any = await res.json();
        orderId = String(o.id ?? '');
      } catch {
        await ctx.reply(`❌ Error checking order *${quotationNumber}*.`, {
          parse_mode: 'Markdown',
          ...cancelButton(),
        });
        return;
      }
      setStep(chatId, { action: 'awaiting_balance_proof_photo', orderId, quotationNumber });
      await ctx.reply(
        `💰 *Balance Payment for ${quotationNumber}*\n\n` +
        `📸 Send a **photo of the payment slip** and the AI will extract the amount automatically.\n\n` +
        `Or tap *Skip* to enter the amount manually.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⏭ Skip — enter manually', `paybalance:skip:${quotationNumber}`)],
            [Markup.button.callback('❌ Cancel', 'action:cancel')],
          ]),
        }
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
      const { quotationNumber, imageBase64: proofBase64, mimeType: proofMime, fileName: proofFileName } = session.step;
      try {
        const result: any = await postJson('/pay-balance', {
          quotation_number: quotationNumber,
          amount,
          updated_by: ctx.from?.username ?? String(ctx.from?.id),
        });
        // If user sent a proof image earlier (vision fallback) — save it now
        if (proofBase64 && proofFileName) {
          uploadFileAndRecord({
            chatId,
            imageBase64: proofBase64,
            mimeType: proofMime ?? 'image/jpeg',
            fileName: proofFileName,
            quotationNumber,
            telegramMessageId: String(ctx.message.message_id),
            uploadedBy: username ?? userId,
            fileType: 'balance_proof',
          }).catch((err: any) => console.error('[paybalance] Failed to save proof image:', err));
        }
        await logAction({ chatId, userId, username, label: 'Pay Balance', quotationNumber, details: `₱${amount.toLocaleString()}` });
        resetStep(chatId);
        let msg;
        if (result.is_fully_paid) {
          msg = `✅ *Balance Fully Paid*\n\nOrder: *${quotationNumber}*\nAmount: ₱${amount.toLocaleString()}`;
          if (result.overpayment > 0) {
            msg += `\n⚠️ Overpayment of ₱${result.overpayment.toLocaleString()}`;
          }
          msg += `\n\n🚚 You can now schedule delivery.`;
        } else {
          msg = `✅ *Partial Balance Recorded*\n\nOrder: *${quotationNumber}*\nThis payment: ₱${amount.toLocaleString()}\nTotal paid: ₱${result.balance_total.toLocaleString()} / ₱${result.expected_balance.toLocaleString()}\nRemaining: ₱${result.remaining_balance.toLocaleString()}\n\n💡 The client still has a remaining balance. Record another payment when they pay more.`;
        }
        await ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
      } catch (err: any) {
        const errorData = err?.response?.data;
        await ctx.reply(`❌ Error: ${errorData?.error ?? err.message}`, {
          parse_mode: 'Markdown',
          ...cancelButton(),
        });
      }
      break;
    }

    // ── Schedule Delivery ───────────────────────────────────────────
    case 'awaiting_order_number_for_delivered': {
      const quotationNumber = text;
      // Check balance first (allow delivery with warning if partially paid)
      let order: any;
      try {
        order = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
        const totalAmount = Number(order.total_amount ?? 0);
        const depositAmount = Number(order.deposit_amount ?? 0);

        if (order.total_amount == null) {
          await ctx.reply(
            `❌ *Total amount not set for ${quotationNumber}*\n\nPlease set the total amount first.`,
            { parse_mode: 'Markdown', ...cancelButton() }
          );
          return;
        }

        // Fetch actual remaining balance from payments API
        let remainingBalance = Math.max(totalAmount - depositAmount, 0);
        try {
          const paymentsRes = await fetch(`${apiBaseUrl}/orders/${order.id}/payments`);
          if (paymentsRes.ok) {
            const paymentsData = await paymentsRes.json();
            remainingBalance = paymentsData.totals?.remaining_balance ?? remainingBalance;
          }
        } catch { /* use computed fallback */ }

        if (remainingBalance > 0) {
          // Allow scheduling but warn about remaining balance
          await ctx.reply(
            `⚠️ *Balance Not Fully Paid*\n\n` +
            `Order: *${quotationNumber}*\n` +
            `Total: ₱${totalAmount.toLocaleString()}\n` +
            `Deposit: ₱${depositAmount.toLocaleString()}\n` +
            `Remaining Balance: ₱${remainingBalance.toLocaleString()}\n\n` +
            `You may still schedule delivery, but the client still owes ₱${remainingBalance.toLocaleString()}.`,
            { parse_mode: 'Markdown', ...cancelButton() }
          );
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
        await logAction({ chatId, userId, username, label: 'Schedule Delivery', quotationNumber, details: `Date: ${dateText}` });
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
        await logAction({ chatId, userId, username, label: 'Mark as Delivered', quotationNumber, details: remarks ? `Remarks: ${remarks}` : undefined });
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
        // Record deposit via match-and-record
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

        // Save the deposit slip image to the order's file viewer so it appears in the dashboard
        if (imageBase64 && data.quotation_number) {
          uploadFileAndRecord({
            chatId,
            imageBase64,
            mimeType: mimeType ?? 'image/jpeg',
            fileName: fileName ?? `deposit-${data.quotation_number}.jpg`,
            quotationNumber: data.quotation_number,
            fileType: 'deposit',
          }).catch((err: any) => console.error('[deposit] File upload error (non-blocking):', err));
        }

        resetStep(chatId);

        botLog({
          chatId, userId, username: ctx.from?.username,
          messageType: 'deposit',
          content: `deposit_recorded: ${data.quotation_number} ₱${depositAmount} (by name: ${clientName})`,
          metadata: { quotationNumber: data.quotation_number, amount: depositAmount, clientName },
          status: 'success',
        });
        await logAction({ chatId, userId, username: ctx.from?.username, label: 'Record Downpayment (by client name)', quotationNumber: data.quotation_number, details: `₱${depositAmount.toLocaleString()} — ${clientName}` });

        const successMsg =
          `✅ *Downpayment Recorded Successfully!*\n\n` +
          `👤 Client: *${escapeMarkdown(data.client_name)}*\n` +
          `📋 Order: *${data.quotation_number}*\n` +
          `💰 Amount: ₱${depositAmount.toLocaleString()}\n` +
          (data.expected_deposit
            ? `💵 Expected Downpayment (50%): ₱${Number(data.expected_deposit).toLocaleString()}\n`
            : '') +
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
        await logAction({ chatId, userId, username, label: 'Production Delay Recorded', quotationNumber, details: `Delay: ${days} day(s)` });
        // After recording delay, ask how many days left to finish
        setStep(chatId, { action: 'awaiting_remaining_production_days', orderId, quotationNumber });
        await ctx.reply(
          `⚠️ *Delay Recorded* — ${quotationNumber}\n\nDelay of ${days} day(s) has been recorded.\n\nNow, how many days left to finish production?`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📅 14 days (estimated)', `prod_remaining:14:${orderId.slice(0, 8)}:${quotationNumber}`)],
              [Markup.button.callback('✏️ Enter custom days', `prod_remaining:custom:${orderId.slice(0, 8)}:${quotationNumber}`)],
            ]),
          }
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
        await logAction({ chatId, userId, username, label: 'Production Finished', quotationNumber: cQuotationNumber, details: `Delivery in: ${deliveryDays} day(s)` });

        // For item-level orders, start per-item en route verification
        const itemsRes = await fetch(`${apiBaseUrl}/orders/${cOrderId}/items`);
        const itemsData = await itemsRes.json();
        if (itemsData?.items?.length > 0) {
          await showItemLevelEnRoute(ctx, cOrderId, cQuotationNumber, itemsData.items, false);
        } else {
          // Legacy order-level flow
          setStep(chatId, { action: 'awaiting_en_route', orderId: cOrderId, quotationNumber: cQuotationNumber });
          await ctx.reply(
            `✅ *Delivery Timeline Set* — ${cQuotationNumber}\n\nProduction is finished. Estimated delivery availability: *${deliveryDays} days*.\n\n🚚 Is the order en route to the client?`,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ Yes, it\'s en route', `en_route:yes:${cOrderId.slice(0, 8)}:${cQuotationNumber}`)],
                [Markup.button.callback('❌ Not yet', `en_route:no:${cOrderId.slice(0, 8)}:${cQuotationNumber}`)],
              ]),
            }
          );
        }
      } catch (err: any) {
        await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
      }
      break;
    }

    // ── Awaiting remaining production days (after midpoint check) ──────
    case 'awaiting_remaining_production_days': {
      const { orderId: rOrderId, quotationNumber: rQuotationNumber } = session.step;
      const remainingDays = parseInt(text, 10);
      if (isNaN(remainingDays) || remainingDays < 1) {
        await ctx.reply('❌ Please enter a valid number of days (e.g., `14`).', { parse_mode: 'Markdown', ...cancelButton() });
        break;
      }
      try {
        await postJson(`/orders/${rOrderId}/recalc-production-reminders`, {
          remaining_production_days: remainingDays,
        });
        await logAction({ chatId, userId, username, label: 'Production Remaining Days Set', quotationNumber: rQuotationNumber, details: `${remainingDays} day(s) left` });
        resetStep(chatId);
        await ctx.reply(
          `✅ *Noted* — ${rQuotationNumber}\n\n*${remainingDays} days* remaining to finish production.\n\nA reminder will be sent when the production window ends to confirm if production has finished.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (err: any) {
        await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
      }
      break;
    }

    // ── Item-level production: initial days estimate ───────────────────
    case 'awaiting_item_prod_days': {
      const { itemId: ipItemId, orderId: ipOrderId, quotationNumber: ipQuotationNumber } = session.step;
      const prodDays = parseInt(text, 10);
      if (isNaN(prodDays) || prodDays < 1) {
        await ctx.reply('❌ Please enter a valid number of days (e.g., `7`).', { parse_mode: 'Markdown', ...cancelButton() });
        break;
      }
      try {
        await patchJson(`/orders/${ipOrderId}/items/${ipItemId}`, {
          estimated_production_days: prodDays,
        });
        await logAction({ chatId, userId, username, label: 'Item Production Days Set', quotationNumber: ipQuotationNumber, details: `${prodDays} day(s)` });
        resetStep(chatId);
        await ctx.reply(
          `✅ *Timeline Set* — ${ipQuotationNumber}\n\n*${prodDays} days* estimated for this item.\n\n📅 Midpoint check at day ${Math.floor(prodDays / 2)}.\n🏭 Due reminder at day ${prodDays}.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (err: any) {
        await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
      }
      break;
    }

    // ── Item-level production: delay additional days ───────────────────
    case 'awaiting_item_prod_delay_days': {
      const { itemId: idItemId, orderId: idOrderId, quotationNumber: idQuotationNumber } = session.step;
      const extraDays = parseInt(text, 10);
      if (isNaN(extraDays) || extraDays < 1) {
        await ctx.reply('❌ Please enter a valid number of days (e.g., `3`).', { parse_mode: 'Markdown', ...cancelButton() });
        break;
      }
      try {
        // Fetch current item to get existing estimated_production_days
        const itemsRes = await fetch(`${apiBaseUrl}/orders/${idOrderId}/items`);
        const itemsData = await itemsRes.json();
        const items = itemsData?.items ?? [];
        const item = items.find((i: any) => i.id === idItemId);
        const currentDays = item?.estimated_production_days ?? 0;
        const newDays = currentDays + extraDays;

        await patchJson(`/orders/${idOrderId}/items/${idItemId}`, {
          estimated_production_days: newDays,
        });
        await postJson(`/orders/${idOrderId}/production-logs`, {
          order_item_id: idItemId,
          note: `🔴 Item "${item?.name ?? 'Unknown'}" delayed by ${extraDays} day(s). New timeline: ${newDays} day(s) total.`,
          log_type: 'user',
          created_by: username ?? `user_${userId}`,
        });
        await logAction({ chatId, userId, username, label: 'Item Production Delayed', quotationNumber: idQuotationNumber, details: `+${extraDays} days = ${newDays} total` });
        resetStep(chatId);
        await ctx.reply(
          `🔴 *Delay Recorded* — ${idQuotationNumber}\n\nItem delayed by *${extraDays} day(s)*.\nNew timeline: *${newDays} days* total.\n\n📅 Midpoint and due reminders recalculated.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
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
        await postJson(`/orders/${eOrderId}/start-en-route-tracking`, {
          estimated_inventory_arrival_days: arrivalDays,
        });
        await logAction({ chatId, userId, username, label: 'En Route Tracking Started', quotationNumber: eQuotationNumber, details: `Arrival in: ${arrivalDays} day(s)` });
        resetStep(chatId);
        await ctx.reply(
          `✅ *En Route Tracking Started* — ${eQuotationNumber}\n\nEstimated arrival: *${arrivalDays} days*.\n\n📅 Midpoint check scheduled at day ${Math.floor(arrivalDays / 2)}.\n📦 Arrival check will fire on the estimated arrival date in the inventory group.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (err: any) {
        await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
      }
      break;
    }

    // ── En Route Item: Custom arrival days ─────────────────────────
    case 'awaiting_en_route_item_days': {
      const { itemId: eiItemId, orderId: eiOrderId, quotationNumber: eiQuotationNumber } = session.step;
      const arrivalDays = parseInt(text, 10);
      if (isNaN(arrivalDays) || arrivalDays < 1) {
        await ctx.reply('❌ Please enter a valid number of days (e.g., `28`).', { parse_mode: 'Markdown', ...cancelButton() });
        break;
      }
      try {
        // Find the full item ID from the prefix
        const itemsRes = await fetch(`${apiBaseUrl}/orders/${eiOrderId}/items`);
        const itemsData = await itemsRes.json();
        const items = itemsData?.items ?? [];
        const targetItem = items.find((i: any) => i.id?.startsWith(eiItemId));
        if (!targetItem) {
          await ctx.reply('❌ Item not found. It may have been removed.', { parse_mode: 'Markdown', ...cancelButton() });
          resetStep(chatId);
          break;
        }

        await patchJson(`/orders/${eiOrderId}/items/${targetItem.id}`, {
          en_route_status: 'en_route',
          estimated_arrival_days: arrivalDays,
        });
        await postJson(`/orders/${eiOrderId}/production-logs`, {
          order_item_id: targetItem.id,
          note: `🚚 ${targetItem.name} marked en route — estimated arrival: ${arrivalDays} days`,
          log_type: 'user',
          created_by: username ?? `user_${userId}`,
        });

        // Re-fetch to show next item or completion
        const updatedItemsRes = await fetch(`${apiBaseUrl}/orders/${eiOrderId}/items`);
        const updatedItemsData = await updatedItemsRes.json();
        const updatedItems = updatedItemsData?.items ?? [];
        const totalQty = updatedItems.reduce((sum: number, i: any) => sum + (i.quantity ?? 1), 0);
        const enRouteQty = updatedItems
          .filter((i: any) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived')
          .reduce((sum: number, i: any) => sum + (i.quantity ?? 1), 0);
        const enRoutePct = totalQty > 0 ? Math.round((enRouteQty / totalQty) * 100) : 0;
        const notEnRouteItem = updatedItems.find((i: any) => i.en_route_status === 'not_yet');

        resetStep(chatId);

        if (!notEnRouteItem) {
          const maxDays = Math.max(...updatedItems.map((i: any) => i.estimated_arrival_days ?? 28));
          await postJson(`/orders/${eiOrderId}/start-en-route-tracking`, { estimated_inventory_arrival_days: maxDays });
          await ctx.reply(
            `✅ *All Items En Route!*\n\nOrder #${eiQuotationNumber}\nAll items en route (${enRoutePct}% of qty).\n\n📅 Midpoint check scheduled at day ${Math.floor(maxDays / 2)}.\n📦 Arrival check will fire in the inventory group on the estimated arrival date.`,
            { parse_mode: 'Markdown', ...mainMenuKeyboard() }
          );
        } else {
          const enRouteCount = updatedItems.filter((i: any) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived').length;
          const progressBar = '█'.repeat(Math.round(enRoutePct / 10)) + '░'.repeat(10 - Math.round(enRoutePct / 10));
          let msg = `✅ *${targetItem.name}* is en route — arriving in *${arrivalDays} days*!\n\n`;
          msg += `🚚 *Item-Level En Route* — ${enRouteCount}/${updatedItems.length} items (${enRoutePct}%) ${progressBar}\n\n`;
          msg += `Next item: *${notEnRouteItem.name}* x${notEnRouteItem.quantity}\n\nIs *${notEnRouteItem.name}* en route yet?`;
          await ctx.reply(msg, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(`🚚 Yes, En Route`, `item_en_route:yes:${notEnRouteItem.id.slice(0, 8)}:${eiQuotationNumber}`)],
              [Markup.button.callback(`❌ Not Yet`, `item_en_route:no:${notEnRouteItem.id.slice(0, 8)}:${eiQuotationNumber}`)],
            ]),
          });
        }
      } catch (err: any) {
        await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
      }
      break;
    }

    // ── En Route Item: New days after delay report ──────────────────
    case 'awaiting_en_route_item_new_days': {
      const { itemId: niItemId, quotationNumber: niQuotationNumber } = session.step;
      const newDays = parseInt(text, 10);
      if (isNaN(newDays) || newDays < 1) {
        await ctx.reply('❌ Please enter a valid number of days (e.g., `42`).', { parse_mode: 'Markdown', ...cancelButton() });
        break;
      }
      try {
        const orderData = await getJson(`/orders/${encodeURIComponent(niQuotationNumber)}`);
        const orderId = orderData.id;
        const itemsRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items`);
        const itemsData = await itemsRes.json();
        const items = itemsData?.items ?? [];
        const targetItem = items.find((i: any) => i.id?.startsWith(niItemId));
        if (!targetItem) {
          await ctx.reply('❌ Item not found.', { parse_mode: 'Markdown', ...cancelButton() });
          resetStep(chatId);
          break;
        }

        await patchJson(`/orders/${orderId}/items/${targetItem.id}`, {
          estimated_arrival_days: newDays,
        });
        await postJson(`/orders/${orderId}/production-logs`, {
          order_item_id: targetItem.id,
          note: `⚠️ Arrival delay updated for ${targetItem.name} — new estimate: ${newDays} days`,
          log_type: 'user',
          created_by: username ?? `user_${userId}`,
        });

        resetStep(chatId);
        await ctx.reply(
          `✅ Updated — *${targetItem.name}* arrival estimate is now *${newDays} days*.\n\nI'll check again when the new arrival date comes.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (err: any) {
        await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
      }
      break;
    }

    // ── En Route Midpoint: new days after delay ─────────────────────
    case 'awaiting_en_route_midpoint_new_days': {
      const { orderId: mpOrderId, quotationNumber: mpQn } = session.step;
      const newDays = parseInt(text, 10);
      if (isNaN(newDays) || newDays < 1) {
        await ctx.reply('❌ Please enter a valid number of days (e.g., `42`).', { parse_mode: 'Markdown', ...cancelButton() });
        break;
      }
      try {
        await patchJson(`/orders/${mpOrderId}/reschedule-reminder`, { stage: 'en_route_arrival', new_days: newDays });
        await logAction({ chatId, userId, username, label: 'En Route Delay — Arrival Rescheduled', quotationNumber: mpQn, details: `New estimate: ${newDays} days` });
        resetStep(chatId);
        await ctx.reply(
          `✅ *Updated* — ${mpQn}\n\nArrival reminder rescheduled to *${newDays} days* from now.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (err: any) {
        await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
      }
      break;
    }

    // ── En Route Arrival: not yet — reschedule arrival check ─────────
    case 'awaiting_en_route_arrival_not_yet_days': {
      const { orderId: anOrderId, quotationNumber: anQn } = session.step;
      const moreDays = parseInt(text, 10);
      if (isNaN(moreDays) || moreDays < 1) {
        await ctx.reply('❌ Please enter a valid number of days (e.g., `7`).', { parse_mode: 'Markdown', ...cancelButton() });
        break;
      }
      try {
        await patchJson(`/orders/${anOrderId}/reschedule-reminder`, { stage: 'en_route_arrival', new_days: moreDays });
        await logAction({ chatId, userId, username, label: 'Arrival Not Yet — Rescheduled', quotationNumber: anQn, details: `${moreDays} more days` });
        resetStep(chatId);
        await ctx.reply(
          `✅ *Noted* — ${anQn}\n\nI'll check again in *${moreDays} days*.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (err: any) {
        await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
      }
      break;
    }

    // ── En Route Verification: not yet — reschedule ─────────────────
    case 'awaiting_en_route_verif_not_yet_days': {
      const { orderId: evOrderId, quotationNumber: evQn } = session.step;
      const evMoreDays = parseInt(text, 10);
      if (isNaN(evMoreDays) || evMoreDays < 1) {
        await ctx.reply('❌ Please enter a valid number of days (e.g., `7`).', { parse_mode: 'Markdown', ...cancelButton() });
        break;
      }
      try {
        await patchJson(`/orders/${evOrderId}/reschedule-reminder`, { stage: 'en_route_verification', new_days: evMoreDays });
        await logAction({ chatId, userId, username, label: 'En Route Verif Not Yet — Rescheduled', quotationNumber: evQn, details: `${evMoreDays} more days` });
        resetStep(chatId);
        await ctx.reply(
          `✅ *Noted* — ${evQn}\n\nI'll check again in *${evMoreDays} days*.`,
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
        await logAction({ chatId, userId, username, label: 'Partial Production Noted', quotationNumber, details: `Pending items: ${items.join(', ')}` });
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
          await logAction({ chatId, userId, username, label: 'All Partial Items Produced', quotationNumber, details: `Done: ${nowDone.join(', ')}` });
          await ctx.reply(
            `🎉 *All Items Produced — ${quotationNumber}*\n\n${doneList}\n\nAll pending items have been confirmed produced! Daily reminders have been stopped.`,
            { parse_mode: 'Markdown', ...mainMenuKeyboard() }
          );
        } else {
          await logAction({ chatId, userId, username, label: 'Partial Items Updated', quotationNumber, details: `Done: ${nowDone.join(', ')} | Still pending: ${newRemaining.join(', ')}` });
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

    // ── Inventory Verification — enter partial qty ────────────────────
    case 'awaiting_inv_verify_qty': {
      const { itemId, orderId, quotationNumber } = session.step.data;
      console.log(`[bot awaiting_inv_verify_qty] chat=${chatId} item=${itemId} order=${orderId} text="${text}"`);
      const qty = parseInt(text, 10);
      if (isNaN(qty) || qty < 0) {
        await ctx.reply('❌ Please enter a valid number (e.g., `5`).', { parse_mode: 'Markdown', ...cancelButton() });
        break;
      }
      try {
        console.log(`[bot awaiting_inv_verify_qty] calling API with verified_qty=${qty}`);
        const result = await postJson(`/orders/${orderId}/inventory-verify-item`, {
          item_id: itemId,
          action: 'partial',
          verified_qty: qty,
        });
        console.log(`[bot awaiting_inv_verify_qty] API result:`, JSON.stringify(result));

        resetStep(chatId);

        // Fetch updated items to show next question
        const itemsRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items`);
        const itemsData = await itemsRes.json();
        const currentItem = itemsData?.items?.find((i: any) => i.id === itemId);

        // Find the next not-fully-verified item (process of elimination)
        const notVerifiedItem = itemsData?.items?.find(
          (item: any) => (item.verified_qty ?? 0) < item.quantity
        );

        // Acknowledge the update explicitly
        let ackMsg = `✅ *Recorded: ${currentItem?.name ?? 'Item'} — ${qty} unit(s) verified*\n`;
        ackMsg += `Progress: ${result.verification_pct}% of total qty\n\n`;

        if (!notVerifiedItem) {
          // All items fully verified! Offer to complete verification
          await ctx.reply(
            ackMsg +
            `🎉 *All Items Fully Verified!*\n\nOrder #${orderId.slice(0, 8)}\nAll items and quantities verified (${result.verification_pct}% of qty).\n\nReady to complete inventory verification and proceed to inventory arrival?`,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ Complete Verification', `inv_v:comp:${orderId}:${orderId.slice(0, 8)}`)],
                [Markup.button.callback('⏳ Review Again', `inv_v:rev:${orderId}:${orderId.slice(0, 8)}`)],
              ]),
            }
          );
        } else {
          // Ask about the next not-fully-verified item
          const verifiedCount = itemsData.items.filter((i: any) => (i.verified_qty ?? 0) >= i.quantity).length;
          const totalCount = itemsData.items.length;
          const remainingQty = notVerifiedItem.quantity - (notVerifiedItem.verified_qty ?? 0);

          const progressBar = '█'.repeat(Math.round(result.verification_pct / 10)) + '░'.repeat(10 - Math.round(result.verification_pct / 10));

          let msg = ackMsg;
          msg += `🔍 *Inventory Verification*\n\n`;
          msg += `Verified: ${result.verification_pct}% ${progressBar}\n`;
          msg += `Items: ${verifiedCount}/${totalCount} fully verified\n\n`;
          msg += `*Process of Elimination:*\n`;
          msg += `Next item: *${notVerifiedItem.name}* x${notVerifiedItem.quantity}\n`;
          msg += `Already verified: ${notVerifiedItem.verified_qty ?? 0} | Remaining: ${remainingQty}\n\n`;
          msg += `Has *${notVerifiedItem.name}* arrived? How many units can you confirm?`;

          await ctx.reply(msg, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(`✅ ${notVerifiedItem.name} — All ${notVerifiedItem.quantity} Verified`, `inv_verify:all:${notVerifiedItem.id.slice(0, 8)}:${orderId.slice(0, 8)}:${quotationNumber}`)],
              [Markup.button.callback(`📦 ${notVerifiedItem.name} — Partial (Enter Qty)`, `inv_verify:partial:${notVerifiedItem.id.slice(0, 8)}:${orderId.slice(0, 8)}:${quotationNumber}`)],
              [Markup.button.callback(`⏳ ${notVerifiedItem.name} — Not Yet`, `inv_verify:not_yet:${notVerifiedItem.id.slice(0, 8)}:${orderId.slice(0, 8)}:${quotationNumber}`)],
            ]),
          });
        }
      } catch (err: any) {
        console.error(`[bot awaiting_inv_verify_qty] API error:`, err.message);
        await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
      }
      break;
    }

    // ── Bug Report Interactive Flow ────────────────────────────────────
    case 'awaiting_bug_title': {
      const title = text.trim();
      if (!title || title.length > 200) {
        await ctx.reply('❌ Please enter a title (max 200 characters).', { parse_mode: 'Markdown', ...cancelButton() });
        break;
      }
      setStep(chatId, { action: 'awaiting_bug_description', title });
      await ctx.reply(
        `📝 *Describe the Bug*\n\nTitle: *${title}*\n\nNow please describe the bug in detail. What happened? What did you expect?`,
        { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
      );
      break;
    }

    case 'awaiting_bug_description': {
      const { title } = session.step;
      const description = text.trim();
      if (!description || description.length > 5000) {
        await ctx.reply('❌ Please enter a description (max 5000 characters).', { parse_mode: 'Markdown', ...cancelButton() });
        break;
      }
      // Fetch active orders to show as a picker
      setStep(chatId, { action: 'awaiting_bug_order_pick', title, description });
      try {
        const ordersRes = await fetch(`${apiBaseUrl}/orders`);
        const ordersData = await ordersRes.json();
        const orders: { quotation_number: string; client_name: string | null }[] = Array.isArray(ordersData) ? ordersData : (ordersData.orders ?? []);

        const buttons: any[][] = [];
        const shown = orders.slice(0, 10);
        for (const o of shown) {
          const label = `${o.quotation_number}${o.client_name ? ` — ${o.client_name}` : ''}`.substring(0, 60);
          buttons.push([Markup.button.callback(label, `pick:bug_order:${o.quotation_number}`)]);
        }
        if (orders.length > 10) {
          buttons.push([Markup.button.callback(`+${orders.length - 10} more — type number below`, 'noop')]);
        }
        buttons.push([Markup.button.callback('⏭️ Skip (no order)', 'pick:bug_order:skip')]);
        buttons.push([Markup.button.callback('❌ Cancel', 'action:cancel')]);

        await ctx.reply(
          `📝 *Link to Order (Optional)*\n\nTitle: *${title}*\nDescription: ${description.slice(0, 100)}${description.length > 100 ? '...' : ''}\n\nSelect the related order or tap *Skip* to submit without one:`,
          { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
        );
      } catch {
        // Fallback: allow typing the order number or skip
        await ctx.reply(
          `📝 *Bug Report — Optional*\n\nTitle: *${title}*\nDescription: ${description.slice(0, 100)}${description.length > 100 ? '...' : ''}\n\nType the *quotation number* to link, or type *skip* to submit without one.`,
          { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
        );
      }
      break;
    }

    case 'awaiting_bug_order_pick': {
      const { title, description } = session.step;
      const orderReference = text.trim().toLowerCase() === 'skip' ? null : text.trim();

      try {
        await postJson('/bug-reports', {
          title,
          description,
          source: 'telegram',
          reporter_name: username ?? null,
          reporter_contact: userId,
          order_reference: orderReference,
        });
        resetStep(chatId);
        await ctx.reply(
          `✅ *Bug Report Submitted*\n\nTitle: ${title}\n\nThank you! The development team has been notified.`,
          { parse_mode: 'Markdown' }
        );
      } catch (err: any) {
        console.error('[bot] Failed to submit bug report:', err);
        await ctx.reply('❌ Failed to submit bug report. Please try again later.', { ...cancelButton() });
      }
      break;
    }

    // ── Schedule Vision: Awaiting Extract (user types schedule text manually) ──
    case 'awaiting_schedule_vision_extract': {
      // User typed schedule details manually after vision failed or chose to type
      // Treat this as a schedule text and try to parse it
      const scheduleText = text;

      // Try to detect a date in the text
      const dateMatch = text.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
      const dayNames = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|today|tomorrow)\b/i;
      const dayMatch = text.match(dayNames);

      if (dateMatch || dayMatch) {
        let detectedDate = '';
        if (dateMatch) {
          const [, m, d, y] = dateMatch;
          const year = y ? (y.length === 2 ? `20${y}` : y) : String(new Date().getFullYear());
          detectedDate = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        } else if (dayMatch) {
          const dayStr = dayMatch[0].toLowerCase();
          if (dayStr === 'today') {
            detectedDate = new Date().toISOString().slice(0, 10);
          } else if (dayStr === 'tomorrow') {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            detectedDate = d.toISOString().slice(0, 10);
          } else {
            const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const targetDay = days.findIndex(d => d.startsWith(dayStr.slice(0, 3)));
            if (targetDay >= 0) {
              const today = new Date();
              const currentDay = today.getDay();
              let diff = targetDay - currentDay;
              if (diff <= 0) diff += 7;
              const d = new Date();
              d.setDate(d.getDate() + diff);
              detectedDate = d.toISOString().slice(0, 10);
            }
          }
        }

        if (detectedDate) {
          const timeMatch = text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
          const detectedTime = timeMatch
            ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`
            : undefined;

          setStep(chatId, {
            action: 'awaiting_schedule_confirm',
            scheduleText: text,
            scheduleDate: detectedDate,
            scheduleTime: detectedTime,
          });

          const timeStr = detectedTime ? ` at ${detectedTime}` : '';
          await ctx.reply(
            `📅 *Schedule Detected*
            
*Text:* ${text}
*Date:* ${detectedDate}${timeStr}

Is this correct?`,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [
                  Markup.button.callback('✅ Confirm & Add', 'schedule:confirm'),
                  Markup.button.callback('🔄 Edit Date', 'schedule:edit_date'),
                ],
                [
                  Markup.button.callback('❌ Cancel', 'action:cancel'),
                ],
              ]),
            }
          );
          return;
        }
      }

      // No date detected — ask for date
      setStep(chatId, {
        action: 'awaiting_schedule_date',
        scheduleText: text,
      });

      await ctx.reply(
        `📝 *Schedule Entry*
        
I'll save this as a schedule. What date should this be on?
(e.g., \`today\`, \`tomorrow\`, \`2026-06-15\`, or a day name like \`Monday\`)`,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
      break;
    }

    // ── Schedule Vision: Awaiting Notes (user provides title for calendar note) ──
    case 'awaiting_schedule_vision_notes': {
      const { extractedText } = session.step;
      const noteTitle = text.trim();

      if (noteTitle.length === 0) {
        await ctx.reply('❌ Please provide a non-empty title for the note.', { ...cancelButton() });
        return;
      }

      // Create a calendar note for today with the extracted text
      const today = new Date().toISOString().slice(0, 10);
      try {
        await postJson('/calendar/notes', {
          note_date: today,
          title: noteTitle.substring(0, 200),
          content: extractedText || noteTitle,
          color: '#f59e0b',
        });

        resetStep(chatId);
        await ctx.reply(
          `✅ *Calendar Note Created!*\n\n📝 *${noteTitle}*\n📆 ${today}\n\nThe note has been added to the calendar.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (err: any) {
        console.error('[schedule_vision] Failed to create note:', err);
        await ctx.reply(`❌ Failed to create note: ${err.message}`, { ...cancelButton() });
      }
      break;
    }

    // ── Schedule: Awaiting Date ──────────────────────────────────────
    case 'awaiting_schedule_date': {
      const { scheduleText } = session.step;
      let detectedDate = '';

      const dateMatch = text.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
      const dayStr = text.toLowerCase().trim();

      if (dateMatch) {
        const [, m, d, y] = dateMatch;
        const year = y ? (y.length === 2 ? `20${y}` : y) : String(new Date().getFullYear());
        detectedDate = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      } else if (dayStr === 'today') {
        detectedDate = new Date().toISOString().slice(0, 10);
      } else if (dayStr === 'tomorrow') {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        detectedDate = d.toISOString().slice(0, 10);
      } else {
        // Try day name
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const targetDay = days.findIndex(d => d.startsWith(dayStr.slice(0, 3)));
        if (targetDay >= 0) {
          const today = new Date();
          const currentDay = today.getDay();
          let diff = targetDay - currentDay;
          if (diff <= 0) diff += 7;
          const d = new Date();
          d.setDate(d.getDate() + diff);
          detectedDate = d.toISOString().slice(0, 10);
        }
      }

      if (!detectedDate) {
        await ctx.reply(
          '❌ Could not understand that date. Please try again:\n(e.g., \`today\`, \`tomorrow\`, \`2026-06-15\`, \`Monday\`)',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      setStep(chatId, {
        action: 'awaiting_schedule_confirm',
        scheduleText,
        scheduleDate: detectedDate,
      });

      await ctx.reply(
        `📅 *Schedule:* ${scheduleText}\n📆 *Date:* ${detectedDate}\n\nIs this correct?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Confirm & Add', 'schedule:confirm'),
              Markup.button.callback('🔄 Edit Date', 'schedule:edit_date'),
            ],
            [
              Markup.button.callback('❌ Cancel', 'action:cancel'),
            ],
          ]),
        }
      );
      break;
    }

    // ── Schedule: Awaiting Reminder ──────────────────────────────────
    case 'awaiting_schedule_reminder': {
      const { scheduleId, scheduleTitle, scheduleDate } = session.step;

      // Parse reminder time
      let reminderAt: string | null = null;
      const beforeMatch = text.match(/(\d+)\s*(minute|hour|day)s?\s*before/i);
      const atMatch = text.match(/at\s*(\d{1,2}):(\d{2})/i);

      if (beforeMatch) {
        const amount = parseInt(beforeMatch[1], 10);
        const unit = beforeMatch[2].toLowerCase();
        const scheduleDateTime = new Date(`${scheduleDate}T09:00:00`);
        if (unit === 'minute') scheduleDateTime.setMinutes(scheduleDateTime.getMinutes() - amount);
        else if (unit === 'hour') scheduleDateTime.setHours(scheduleDateTime.getHours() - amount);
        else if (unit === 'day') scheduleDateTime.setDate(scheduleDateTime.getDate() - amount);
        reminderAt = scheduleDateTime.toISOString();
      } else if (atMatch) {
        const hours = atMatch[1].padStart(2, '0');
        const mins = atMatch[2].padStart(2, '0');
        const reminderDate = new Date(`${scheduleDate}T${hours}:${mins}:00`);
        reminderAt = reminderDate.toISOString();
      }

      if (!reminderAt) {
        await ctx.reply(
          '❌ Could not understand that. Please specify like:\n- \`1 hour before\`\n- \`30 minutes before\`\n- \`at 08:00\`',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      try {
        await patchJson(`/calendar/schedules/${scheduleId}`, {
          reminder_at: reminderAt,
          created_by_chat_id: chatId, // Bot bypass — no action_token needed
        });

        resetStep(chatId);
        await ctx.reply(
          `✅ *Reminder Set!*\n\n📅 *${scheduleTitle}*\n📆 ${scheduleDate}\n⏰ I'll remind you at the specified time.`,
          { parse_mode: 'Markdown' }
        );
      } catch (err: any) {
        console.error('[bot] Failed to set reminder:', err);
        await ctx.reply(`❌ Failed to set reminder: ${err.message}`, { ...cancelButton() });
      }
      break;
    }

    default:
      // Active flow but unrecognized step — preserve it and guide the user.
      await ctx.reply(
        '❓ I didn\'t understand that. You are currently in a flow. Please follow the prompts above, or press *Cancel* to go back to the Main Menu.',
        { parse_mode: 'Markdown', ...cancelButton() }
      );
  }
});

// ── Inline Callback Handlers ───────────────────────────────────────────

// ── Production Board — tap-based GUI ─────────────────────────────────────
//
// Flow:
//   /prod  →  list of orders (prd:o:{8})
//   tap order  →  item list (prd:i:{itemId8}:{orderId8}:f|p|s per item)
//   tap item status  →  update & refresh item view
//   [↩ Back]  →  prd:list  →  back to order list
//
// Callback data max is 64 bytes. Using 8-char ID prefixes keeps us well under.


type BoardCategory = 'pending_start' | 'in_progress' | 'en_route_verification' | 'en_route';

interface BoardOrder {
  id: string;
  quotation_number: string | null;
  client_name: string | null;
  current_stage: string;
  production_started: boolean | null;
  production_finished: boolean | null;
  en_route_confirmed: boolean | null;
  items: { id: string; name: string; quantity: number; production_status: string; en_route_status: string }[];
}

interface BoardResponse {
  ok: boolean;
  orders: BoardOrder[];
}

const BOARD_CATEGORIES: { id: BoardCategory; label: string; icon: string }[] = [
  { id: 'pending_start', label: 'Pending Start', icon: '?' },
  { id: 'in_progress', label: 'In Progress', icon: '??' },
  { id: 'en_route_verification', label: 'Arrival Verification', icon: '?' },
  { id: 'en_route', label: 'En Route', icon: '??' },
];

async function fetchBoard(): Promise<BoardOrder[]> {
  const res = await fetch(`${apiBaseUrl}/production/board`);
  if (!res.ok) return [];
  const data = (await res.json()) as BoardResponse;
  return data.orders ?? [];
}

function productionDone(order: BoardOrder): boolean {
  return order.production_finished === true || (order.items.length > 0 && order.items.every((i) => i.production_status === 'finished'));
}

function anyItemStarted(order: BoardOrder): boolean {
  return order.items.some((i) => i.production_status === 'in_progress' || i.production_status === 'finished');
}

function anyItemEnRoute(order: BoardOrder): boolean {
  return order.items.some((i) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived');
}

function boardCategory(order: BoardOrder): BoardCategory {
  if (order.current_stage === 'en_route' || productionDone(order)) {
    const allEnRoute = order.items.every((i) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived');
    return allEnRoute || order.en_route_confirmed ? 'en_route' : 'en_route_verification';
  }
  // Partial production: finished items can go en-route individually
  const finishedItems = order.items.filter((i) => i.production_status === 'finished');
  if (finishedItems.length > 0) {
    const allFinishedEnRoute = finishedItems.every((i) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived');
    if (!allFinishedEnRoute) {
      return 'en_route_verification';
    }
    // All finished items are en-route, but not all items are finished yet
    return 'en_route';
  }
  if (order.production_started || anyItemStarted(order) || order.current_stage === 'production_in_progress' || order.current_stage === 'partial_production') {
    return 'in_progress';
  }
  return 'pending_start';
}

// ── Persistent control panel message ID (per chat) ──────────────────────
const panelMessageIds = new Map<string, number>();

function prodReplyKeyboard() {
  return Markup.keyboard([
    ['📊 Dashboard', '✅ Mark Produced', '🚚 Mark En Route'],
    ['⏳ Pending', '🔧 In Progress', '🚚 Verify En Route', '🚛 En Route'],
  ]).resize();
}

async function showItemLevelEnRoute(ctx: any, orderId: string, quotationNumber: string, existingItems?: any[], edit = false): Promise<void> {
  let items: any[];
  if (existingItems && existingItems.length > 0) {
    items = existingItems;
  } else {
    const itemsRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items`);
    const itemsData = await itemsRes.json();
    items = itemsData?.items ?? [];
  }

  // Only consider finished items for en-route tracking
  const finishedItems = items.filter((i: any) => i.production_status === 'finished');
  const totalQty = finishedItems.reduce((sum: number, i: any) => sum + (i.quantity ?? 1), 0);
  const enRouteQty = finishedItems
    .filter((i: any) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived')
    .reduce((sum: number, i: any) => sum + (i.quantity ?? 1), 0);
  const enRoutePct = totalQty > 0 ? Math.round((enRouteQty / totalQty) * 100) : 0;
  const enRouteCount = finishedItems.filter((i: any) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived').length;
  const totalCount = finishedItems.length;
  const allItemsFinished = items.length > 0 && items.every((i: any) => i.production_status === 'finished');

  const notEnRouteItem = finishedItems.find((i: any) => i.en_route_status === 'not_yet');

  if (!notEnRouteItem) {
    const maxDays = Math.max(...finishedItems.map((i: any) => i.estimated_arrival_days ?? 28));
    // Start en-route tracking whenever all finished items are en-route
    // (even if not all order items are finished yet)
    await postJson(`/orders/${orderId}/start-en-route-tracking`, { estimated_inventory_arrival_days: maxDays });
    const statusLine = allItemsFinished
      ? `All items completed and already en route (${enRoutePct}% of qty).`
      : `All finished items are en route (${enRoutePct}% of finished qty). Production still in progress for other items.`;
    const msg =
      `✅ *All Finished Items En Route!*\n\n` +
      `Order #${quotationNumber}\n` +
      `${statusLine}\n\n` +
      `📅 Midpoint check at day ${Math.floor(maxDays / 2)}.\n` +
      `📦 Arrival check in the inventory group on the estimated arrival date.`;
    if (edit) {
      await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
    } else {
      await ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
    }
    return;
  }

  const progressBar = '█'.repeat(Math.round(enRoutePct / 10)) + '░'.repeat(10 - Math.round(enRoutePct / 10));

  let msg = allItemsFinished
    ? `✅ *All Items Produced!*\n\nOrder #${quotationNumber}\nAll production items are finished.\n\n`
    : `🏗️ *Production In Progress*\n\nOrder #${quotationNumber}\nSome items still in production.\n\n`;
  msg += `🚚 *Item-Level En Route*\n`;
  msg += `En Route: ${enRoutePct}% of finished qty ${progressBar}\n`;
  msg += `Items: ${enRouteCount}/${totalCount} en route\n\n`;
  msg += `*Process of Elimination:*\n`;
  msg += `Next item: *${notEnRouteItem.name}* x${notEnRouteItem.quantity}\n\n`;
  msg += `Is *${notEnRouteItem.name}* en route yet?`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(`🚚 ${notEnRouteItem.name} — Yes, En Route`, `item_en_route:yes:${notEnRouteItem.id.slice(0, 8)}:${quotationNumber}`)],
    [Markup.button.callback(`❌ ${notEnRouteItem.name} — Not Yet`, `item_en_route:no:${notEnRouteItem.id.slice(0, 8)}:${quotationNumber}`)],
  ]);

  if (edit) {
    await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...keyboard });
  } else {
    await ctx.reply(msg, { parse_mode: 'Markdown', ...keyboard });
  }
}

async function handleProdQuickAction(ctx: any, text: string, chatId: string): Promise<boolean> {
  const trimmed = text.trim();

  if (trimmed === '📊 Dashboard') {
    await showOrUpdatePanel(ctx, chatId);
    return true;
  }

  if (trimmed === '✅ Mark Produced') {
    const orders = await fetchBoard();
    const pending = orders.filter((o) => boardCategory(o) === 'in_progress' || boardCategory(o) === 'pending_start');
    if (pending.length === 0) {
      await ctx.reply('❌ No orders pending production.');
    } else {
      const buttons = pending.slice(0, 20).map((o) => [
        Markup.button.callback(
          `${o.quotation_number ?? o.id.slice(0, 8)} 🔨 ${o.client_name ?? '?'}`.slice(0, 58),
          `prd:o:${o.id.slice(0, 8)}`,
        ),
      ]);
      buttons.push([Markup.button.callback('🔙 Back to Dashboard', 'prd:list')]);
      await ctx.reply('🔨 *Mark Produced*\n\nSelect an order to view and mark items as produced:', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    }
    return true;
  }

  if (trimmed === '🚚 Mark En Route') {
    const orders = await fetchBoard();
    const ready = orders.filter((o) => boardCategory(o) === 'en_route_verification' || boardCategory(o) === 'en_route');
    if (ready.length === 0) {
      await ctx.reply('❌ No orders ready for en route.');
    } else {
      const buttons = ready.slice(0, 20).map((o) => [
        Markup.button.callback(
          `${o.quotation_number ?? o.id.slice(0, 8)} 🚚 ${o.client_name ?? '?'}`.slice(0, 58),
          `prd:o:${o.id.slice(0, 8)}`,
        ),
      ]);
      buttons.push([Markup.button.callback('🔙 Back to Dashboard', 'prd:list')]);
      await ctx.reply('🚚 *Mark En Route*\n\nSelect an order to view and mark items as en route:', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    }
    return true;
  }

  const categoryMap: Record<string, BoardCategory> = {
    '⏳ Pending': 'pending_start',
    '🔧 In Progress': 'in_progress',
    '🚚 Verify En Route': 'en_route_verification',
    '🚛 En Route': 'en_route',
  };

  if (categoryMap[trimmed]) {
    const orders = await fetchBoard();
    const { text: catText, keyboard } = boardOrderList(orders, categoryMap[trimmed]);
    await ctx.reply(catText, { parse_mode: 'Markdown', ...keyboard });
    return true;
  }

  return false;
}

async function showOrUpdatePanel(ctx: any, chatId: string): Promise<void> {
  try {
    const orders = await fetchBoard();
    const { text, keyboard } = boardDashboard(orders);
    const existingMsgId = panelMessageIds.get(chatId);

    if (existingMsgId) {
      await ctx.telegram.editMessageText(chatId, existingMsgId, undefined, text, {
        parse_mode: 'Markdown',
        ...keyboard,
      }).catch(async () => {
        // Message too old or deleted — send fresh
        const msg = await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
        if (msg) panelMessageIds.set(chatId, msg.message_id);
      });
    } else {
      const msg = await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
      if (msg) panelMessageIds.set(chatId, msg.message_id);
    }
  } catch (err) {
    console.error('[bot] Failed to show/update panel:', err);
  }
}

function boardDashboard(orders: BoardOrder[]): { text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> } {
  const counts = new Map<BoardCategory, number>();
  for (const c of BOARD_CATEGORIES) counts.set(c.id, 0);
  for (const order of orders) counts.set(boardCategory(order), (counts.get(boardCategory(order)) ?? 0) + 1);

  const lines = BOARD_CATEGORIES.map((c) => `${c.icon} ${c.label}: *${counts.get(c.id) ?? 0}*`);
  return {
    text: `?? *Production Dashboard*\n\n${lines.join('\n')}\n\nProduction chat monitors only production, ready-for-delivery, and en-route work. Tap a section:`,
    keyboard: Markup.inlineKeyboard([
      // ── Quick-action row ──
      [
        Markup.button.callback('?? Refresh', 'prd:list'),
        Markup.button.callback('? Mark Produced', 'prd:quick:produced'),
        Markup.button.callback('?? Mark En Route', 'prd:quick:en_route'),
      ],
      // ── Category navigation ──
      [
        Markup.button.callback(`? Pending Start (${counts.get('pending_start') ?? 0})`, 'prd:cat:pending_start'),
        Markup.button.callback(`?? In Progress (${counts.get('in_progress') ?? 0})`, 'prd:cat:in_progress'),
      ],
      [Markup.button.callback(`? Arrival Verification (${counts.get('en_route_verification') ?? 0})`, 'prd:cat:en_route_verification')],
      [Markup.button.callback(`?? En Route (${counts.get('en_route') ?? 0})`, 'prd:cat:en_route')],
    ]),
  };
}

function boardOrderList(orders: BoardOrder[], category: BoardCategory): { text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> } {
  const meta = BOARD_CATEGORIES.find((c) => c.id === category)!;
  const filtered = orders.filter((o) => boardCategory(o) === category);

  if (filtered.length === 0) {
    return {
      text: `${meta.icon} *${meta.label}*\n\nNo orders in this section.`,
      keyboard: Markup.inlineKeyboard([[Markup.button.callback('? Back to Production Dashboard', 'prd:list')]]),
    };
  }

  const lines = filtered.map((o) => {
    const total = o.items.length;
    const produced = o.items.filter((i) => i.production_status === 'finished').length;
    const routed = o.items.filter((i) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived').length;
    const progress = category === 'en_route_verification' || category === 'en_route'
      ? `${routed}/${total || 'no'} en route`
      : `${produced}/${total || 'no'} produced`;
    return `? *${o.quotation_number ?? o.id.slice(0, 8)}* ? ${o.client_name ?? 'Unknown'} (${progress})`;
  });

  const buttons = filtered.slice(0, 20).map((o) => [
    Markup.button.callback(
      `${o.quotation_number ?? o.id.slice(0, 8)} ? ${o.client_name ?? '?'}`.slice(0, 58),
      `prd:o:${o.id.slice(0, 8)}`,
    ),
  ]);
  buttons.push([Markup.button.callback('? Back to Production Dashboard', 'prd:list')]);

  return {
    text: `${meta.icon} *${meta.label}* ? ${filtered.length} order(s)\n\n${lines.join('\n')}\n\nTap an order to update item-by-item:`,
    keyboard: Markup.inlineKeyboard(buttons),
  };
}

function boardItemView(order: BoardOrder): { text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> } {
  const qn = order.quotation_number ?? order.id.slice(0, 8);
  const category = boardCategory(order);
  const categoryMeta = BOARD_CATEGORIES.find((c) => c.id === category)!;
  const total = order.items.length;
  const produced = order.items.filter((i) => i.production_status === 'finished').length;
  const routed = order.items.filter((i) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived').length;

  let text = `${categoryMeta.icon} *${qn}* ? ${order.client_name ?? 'Unknown'}\n`;
  text += `Section: *${categoryMeta.label}*\n`;
  text += `Production: ${produced}/${total} finished\n`;
  text += `En route: ${routed}/${total} dispatched\n\n`;

  if (total === 0) {
    text += '_No items on record._';
  } else {
    for (const item of order.items) {
      const prodIcon = item.production_status === 'finished' ? '?' : item.production_status === 'in_progress' ? '??' : '?';
      const routeIcon = item.en_route_status === 'en_route' || item.en_route_status === 'arrived' ? '??' : '??';
      text += `${prodIcon}${routeIcon} ${item.name} ?${item.quantity}\n`;
    }
  }

  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  const orderPrefix = order.id.slice(0, 8);

  if (category === 'en_route_verification' || category === 'en_route') {
    for (const item of order.items) {
      if (item.en_route_status === 'en_route' || item.en_route_status === 'arrived') continue;
      rows.push([
        Markup.button.callback(`?? Mark en route ? ${item.name}`.slice(0, 60), `prd:i:${item.id.slice(0, 8)}:${orderPrefix}:e`),
      ]);
    }
  } else {
    for (const item of order.items) {
      if (item.production_status === 'finished') continue;
      if (item.production_status === 'in_progress') {
        rows.push([
          Markup.button.callback(`? Finish ? ${item.name}`.slice(0, 60), `prd:i:${item.id.slice(0, 8)}:${orderPrefix}:f`),
        ]);
      } else {
        rows.push([
          Markup.button.callback(`? Start ? ${item.name}`.slice(0, 60), `prd:i:${item.id.slice(0, 8)}:${orderPrefix}:s`),
        ]);
      }
    }
  }

  if (rows.length === 0 && category === 'en_route_verification') {
    rows.push([Markup.button.callback('?? All items are en route', 'noop')]);
  } else if (rows.length === 0 && category !== 'en_route') {
    rows.push([Markup.button.callback('? All production items finished', 'noop')]);
  }

  rows.push([Markup.button.callback(`? Back to ${categoryMeta.label}`, `prd:cat:${category}`)]);
  rows.push([Markup.button.callback('?? Production Dashboard', 'prd:list')]);

  return { text, keyboard: Markup.inlineKeyboard(rows) };
}

// /prod command ? show production dashboard + quick-actions keyboard
bot.command('prod', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  await showOrUpdatePanel(ctx, chatId);
  // Ensure the persistent quick-actions reply keyboard is shown
  await ctx.reply('⌨️ Quick actions:', { ...prodReplyKeyboard() }).catch(() => {});
});

// Also allow /production as alias
bot.command('production', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  await showOrUpdatePanel(ctx, chatId);
  await ctx.reply('⌨️ Quick actions:', { ...prodReplyKeyboard() }).catch(() => {});
});

// prd:list ? refresh/back to production dashboard
bot.action('prd:list', async (ctx) => {
  const orders = await fetchBoard();
  const { text, keyboard } = boardDashboard(orders);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard }).catch(() => {});
});

// prd:quick:produced ? quick action — pick an order to mark as produced
bot.action('prd:quick:produced', async (ctx) => {
  const orders = await fetchBoard();
  const pending = orders.filter((o) => boardCategory(o) === 'in_progress' || boardCategory(o) === 'pending_start');
  if (pending.length === 0) {
    await ctx.answerCbQuery('? No orders pending production').catch(() => {});
    return;
  }
  const buttons = pending.slice(0, 20).map((o) => [
    Markup.button.callback(
      `${o.quotation_number ?? o.id.slice(0, 8)} ? ${o.client_name ?? '?'}`.slice(0, 58),
      `prd:o:${o.id.slice(0, 8)}`,
    ),
  ]);
  buttons.push([Markup.button.callback('? Back to Dashboard', 'prd:list')]);
  await ctx.editMessageText('? *Mark Produced*\n\nSelect an order to view and mark items as produced:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  }).catch(() => {});
});

// prd:quick:en_route ? quick action — pick an order to mark as en route
bot.action('prd:quick:en_route', async (ctx) => {
  const orders = await fetchBoard();
  const ready = orders.filter((o) => boardCategory(o) === 'en_route_verification' || boardCategory(o) === 'en_route');
  if (ready.length === 0) {
    await ctx.answerCbQuery('? No orders ready for en route').catch(() => {});
    return;
  }
  const buttons = ready.slice(0, 20).map((o) => [
    Markup.button.callback(
      `${o.quotation_number ?? o.id.slice(0, 8)} ? ${o.client_name ?? '?'}`.slice(0, 58),
      `prd:o:${o.id.slice(0, 8)}`,
    ),
  ]);
  buttons.push([Markup.button.callback('? Back to Dashboard', 'prd:list')]);
  await ctx.editMessageText('?? *Mark En Route*\n\nSelect an order to view and mark items as en route:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  }).catch(() => {});
});

// prd:cat:{category} ? show a section list
bot.action(/^prd:cat:(pending_start|in_progress|en_route_verification|en_route)$/, async (ctx) => {
  const category = ctx.match[1] as BoardCategory;
  const orders = await fetchBoard();
  const { text, keyboard } = boardOrderList(orders, category);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard }).catch(() => {});
});

// prd:o:{orderId8} ? show items for a specific order
bot.action(/^prd:o:(.{8})$/, async (ctx) => {
  const prefix = ctx.match[1];
  const orders = await fetchBoard();
  const order = orders.find((o) => o.id.startsWith(prefix));
  if (!order) {
    await ctx.editMessageText('?? Order not found. It may have moved to inventory or another stage.').catch(() => {});
    return;
  }
  const { text, keyboard } = boardItemView(order);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard }).catch(() => {});
});

// prd:i:{itemId8}:{orderId8}:{status} ? update item status
// status: f=production finished, s=production in_progress, p=production pending, e=item en_route
bot.action(/^prd:i:(.{8}):(.{8}):(f|s|p|e)$/, async (ctx) => {
  const itemPrefix = ctx.match[1];
  const orderPrefix = ctx.match[2];
  const statusCode = ctx.match[3];
  const isEnRouteUpdate = statusCode === 'e';
  const statusMap: Record<string, string> = { f: 'finished', s: 'in_progress', p: 'pending', e: 'finished' };
  const status = statusMap[statusCode];

  try {
    const res = await fetch(`${apiBaseUrl}/production/board/item`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        order_id_prefix: orderPrefix,
        item_id_prefix: itemPrefix,
        area: isEnRouteUpdate ? 'en_route' : 'production',
        status,
      }),
    });

    if (!res.ok) {
      await ctx.answerCbQuery('? Update failed').catch(() => {});
      return;
    }

    const data = await res.json() as { ok: boolean; item: string; all_done: boolean; all_en_route: boolean };
    const label = isEnRouteUpdate
      ? `?? ${data.item} marked en route`
      : status === 'finished'
        ? `? ${data.item} finished`
        : `?? ${data.item} in progress`;
    await ctx.answerCbQuery(label).catch(() => {});

    const orders = await fetchBoard();
    const order = orders.find((o) => o.id.startsWith(orderPrefix));
    if (!order) {
      await ctx.editMessageText('? Updated. Order has moved out of production monitoring.').catch(() => {});
      return;
    }
    const { text, keyboard } = boardItemView(order);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard }).catch(() => {});
  } catch (err) {
    console.error('[bot] Board item update error:', err);
    await ctx.answerCbQuery('? Request failed').catch(() => {});
  }
});

bot.action('assistant:cancel', async (ctx) => {
  await ctx.editMessageText('Okay, no changes made.').catch(() => {});
});

// assistant:mark_produced:{orderId}:{quotationNumber}:{itemId1,itemId2,...}
bot.action(/^assistant:mark_produced:([^:]+):([^:]+):(.+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const itemIds = ctx.match[3].split(',').filter(Boolean);

  await ctx.editMessageText(`⏳ Marking ${itemIds.length} item(s) as produced for ${quotationNumber}...`).catch(() => {});

  let successCount = 0;
  for (const itemId of itemIds) {
    try {
      const res = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ production_status: 'finished' }),
      });
      if (res.ok) successCount++;
    } catch {
      // continue with remaining items
    }
  }

  await ctx.editMessageText(
    successCount === itemIds.length
      ? `✅ Marked ${successCount} item(s) as produced for ${quotationNumber}.`
      : `⚠️ Marked ${successCount}/${itemIds.length} item(s) for ${quotationNumber}. Check the dashboard for any failures.`
  ).catch(() => {});
});

// assistant:en_route:{orderId}:{quotationNumber}
bot.action(/^assistant:en_route:([^:]+):(.+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];
  await ctx.editMessageText(`⏳ Confirming en route for ${quotationNumber}...`).catch(() => {});
  try {
    const res = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(orderId)}/start-en-route-tracking`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ estimated_inventory_arrival_days: 28 }),
    });
    if (res.ok) {
      await ctx.editMessageText(`✅ ${quotationNumber} — en route tracking started. Midpoint check at day 14, arrival check at day 28 in the inventory group.`).catch(() => {});
    } else {
      await ctx.editMessageText(`❌ Failed to start en route tracking. Use the dashboard or /produce command instead.`).catch(() => {});
    }
  } catch {
    await ctx.editMessageText(`❌ Request failed. Use the dashboard or /produce command instead.`).catch(() => {});
  }
});

// Production status callback
bot.action(/^produce:(yes|no):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const status = ctx.match[1];
  const rest = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  // Support both formats:
  //   produce:yes:orderId:quotationNumber (from reminder scheduler)
  //   produce:yes:quotationNumber (from /produce command)
  const parts = rest.split(':');
  const orderId = parts.length > 1 ? parts[0] : undefined;
  const quotationNumber = parts.length > 1 ? parts.slice(1).join(':') : rest;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `produce:${status}:${rest}`,
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
    await logAction({ chatId, userId, username, label: 'Production Not Yet Started', quotationNumber });
    resetStep(chatId);
    await ctx.editMessageText(
      `✅ Noted. Production for *${quotationNumber}* has not started yet. Reminders will continue.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } else {
    // Ask when production actually started — calendar date picker (optional)
    const orderIdPart = orderId ? orderId.slice(0, 8) : '';
    setStep(chatId, { action: 'awaiting_produce_date', quotationNumber, orderId });
    await ctx.editMessageText(
      `📅 *When did production start?* — ${quotationNumber}\n\nChoose a date or skip to use the current time.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📅 Today', `produce:date:today:${orderIdPart}:${quotationNumber}`)],
          [Markup.button.callback('📅 Yesterday', `produce:date:yesterday:${orderIdPart}:${quotationNumber}`)],
          [Markup.button.callback('📅 Monday', `produce:date:monday:${orderIdPart}:${quotationNumber}`)],
          [Markup.button.callback('✏️ Custom date', `produce:date:custom:${orderIdPart}:${quotationNumber}`)],
          [Markup.button.callback('⏭️ Skip (use now)', `produce:date:skip:${orderIdPart}:${quotationNumber}`)],
        ]),
      }
    );
  }
});

// ── advance:production_pending — Advance order to production_pending stage ──
// Used when deposit is verified and the team confirms the order should proceed
// to the production workflow stage (not marking physical production as started).
// Callback: advance:production_pending:{quotationNumber}
bot.action(/^advance:production_pending:(?!no:)(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const quotationNumber = ctx.match[1];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `advance:production_pending:${quotationNumber}`,
    direction: 'incoming',
  });

  await ctx.editMessageText(`⏳ Advancing *${quotationNumber}* to Production Workflow...`, { parse_mode: 'Markdown' });

  try {
    await postJson('/stage-updates', {
      quotation_number: quotationNumber,
      stage: 'production_pending',
      status: 'yes',
      remarks: 'Deposit verified, advancing to production workflow',
      updated_by: ctx.from?.username ?? String(ctx.from?.id),
    });
    await logAction({ chatId, userId, username, label: 'Advanced to Production Workflow', quotationNumber });
    resetStep(chatId);
    await ctx.editMessageText(
      `✅ *${quotationNumber}* has been advanced to the Production Workflow stage.\n\nThis only acknowledges the workflow handoff. A separate reminder will ask when actual production has started.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } catch (err: any) {
    await ctx.editMessageText(
      `❌ Error advancing *${quotationNumber}*: ${err.message}`,
      { parse_mode: 'Markdown', ...cancelButton() }
    );
  }
});

// Production workflow handoff not yet started.
// Callback: advance:production_pending:no:{quotationNumber}
bot.action(/^advance:production_pending:no:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const quotationNumber = ctx.match[1];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `advance:production_pending:no:${quotationNumber}`,
    direction: 'incoming',
  });

  await logAction({ chatId, userId, username, label: 'Production Workflow Not Started', quotationNumber });
  resetStep(chatId);
  await ctx.editMessageText(
    `Noted. The production workflow for *${quotationNumber}* has not started yet. Reminders will continue.`,
    { parse_mode: 'Markdown', ...mainMenuKeyboard() }
  );
});

// ── produce:date — Date picker for when production actually started ──
// Called after user taps "Yes, started" — asks when it actually began.
// Callback: produce:date:{today|yesterday|monday|custom|skip}:{orderId}:{quotationNumber}
bot.action(/^produce:date:(today|yesterday|monday|custom|skip):([^:]*):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const dateType = ctx.match[1];
  const orderIdPart = ctx.match[2] || undefined;
  const quotationNumber = ctx.match[3];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const session = getSession(chatId);

  botLog({ chatId, userId, username, messageType: 'callback_query', content: `produce:date:${dateType}:${orderIdPart}:${quotationNumber}`, direction: 'incoming' });

  let startedAt: string | undefined;

  if (dateType === 'skip') {
    // No date — API will use NOW()
    startedAt = undefined;
  } else if (dateType === 'today') {
    startedAt = new Date().toISOString();
  } else if (dateType === 'yesterday') {
    startedAt = new Date(Date.now() - 86_400_000).toISOString();
  } else if (dateType === 'monday') {
    const now = new Date();
    const day = now.getDay(); // 0=Sun, 1=Mon
    const diff = day === 0 ? -6 : 1 - day;
    startedAt = new Date(now.getTime() + diff * 86_400_000).toISOString();
  } else if (dateType === 'custom') {
    setStep(chatId, { action: 'awaiting_produce_custom_date_text', quotationNumber, orderId: orderIdPart });
    await ctx.editMessageText(
      `📅 Enter the date production started for *${quotationNumber}*\n\nExamples:\`Jun 15\` \`June 15\` \`2026-06-15\``,
      { parse_mode: 'Markdown', ...cancelButton() }
    );
    return;
  }

  // Proceed to ask for production duration
  setStep(chatId, { action: 'awaiting_produce_custom_days', quotationNumber, orderId: orderIdPart, startedAt });
  const orderIdPrefx = orderIdPart ? orderIdPart.slice(0, 8) : '';
  const startLabel = startedAt
    ? `Started: ${new Date(startedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}\n\n`
    : '';
  await ctx.editMessageText(
    `🏭 *Production Timeline* — ${quotationNumber}\n\n${startLabel}How long is production?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(`📅 28 days ${startedAt ? '(standard)' : ''}`, `produce:days:28:${orderIdPrefx}:${quotationNumber}`)],
        [Markup.button.callback('✏️ Enter custom days/date', `produce:custom:${orderIdPrefx}:${quotationNumber}`)],
        [Markup.button.callback('❌ Cancel', 'action:cancel')],
      ]),
    }
  );
});

// ── produce:days — Standard / quick production days selection ────────
// Callback: produce:days:{days}:{orderIdPrefix}:{quotationNumber}
bot.action(/^produce:days:(\d+):([^:]*):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const days = parseInt(ctx.match[1], 10);
  const orderIdPrefix = ctx.match[2];
  const quotationNumber = ctx.match[3];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({ chatId, userId, username, messageType: 'callback_query', content: `produce:days:${days}:${orderIdPrefix}:${quotationNumber}`, direction: 'incoming' });

  resetStep(chatId);
  await ctx.editMessageText(`⏳ Recording production start (${days} days)...`, { parse_mode: 'Markdown' });

  // Check if user provided a start date
  const session = getSession(chatId);
  const startedAt = session.step?.action === 'awaiting_produce_custom_days'
    ? (session.step as any).startedAt
    : undefined;
  // Clean up session after reading
  if (startedAt) delete (session.step as any).startedAt;

  try {
    const order: any = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    const payload: any = {
      production_started: true,
      estimated_production_days: days,
    };
    if (startedAt) payload.started_at = startedAt;
    await postJson(`/orders/${order.id}/set-production`, payload);

    // Also mark all order items as in_progress so they appear in Production In Progress
    try {
      const itemsRes = await fetch(`${apiBaseUrl}/orders/${order.id}/items`);
      const itemsData = await itemsRes.json();
      const items: any[] = itemsData?.items ?? [];
      if (items.length > 0) {
        await Promise.all(items.map((item: any) =>
          patchJson(`/orders/${order.id}/items/${item.id}`, {
            production_status: 'in_progress',
            estimated_production_days: days,
          })
        ));
      }
    } catch { /* non-fatal — items may not exist */ }

    await logAction({ chatId, userId, username, label: 'Production Started', quotationNumber, details: `Timeline: ${days} day(s)` });
    await ctx.editMessageText(
      `✅ *Production Started* — ${quotationNumber}\n\nTimeline: *${days} days*\n\nA midpoint check will be sent in *${Math.max(1, Math.floor(days / 2))} days* to confirm if production is on time, early, or delayed. A due reminder will follow at the end of the production window.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Main Menu', 'menu:main')],
        ]),
      }
    );
  } catch (err: any) {
    await ctx.editMessageText(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// ── produce:custom — Prompt for custom days/date ─────────────────────
// Callback: produce:custom:{orderIdPrefix}:{quotationNumber}
bot.action(/^produce:custom:([^:]*):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderIdPrefix = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({ chatId, userId, username, messageType: 'callback_query', content: `produce:custom:${orderIdPrefix}:${quotationNumber}`, direction: 'incoming' });

  setStep(chatId, { action: 'awaiting_produce_custom_days', quotationNumber, orderId: orderIdPrefix });
  await ctx.editMessageText(
    `✏️ *Custom Production Timeline* — ${quotationNumber}\n\nEnter the number of days (e.g. \`45\`) or a target date (e.g. \`Jul 15\`):`,
    { parse_mode: 'Markdown', ...cancelButton() }
  );
});

// Partial production: ask for missing items
bot.action(/^produce:partial:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const rest = ctx.match[1];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  // Support both formats:
  //   produce:partial:orderId:quotationNumber (from reminder scheduler)
  //   produce:partial:quotationNumber (from /produce command)
  const parts = rest.split(':');
  const orderId = parts.length > 1 ? parts[0] : undefined;
  const quotationNumber = parts.length > 1 ? parts.slice(1).join(':') : rest;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `produce:partial:${rest}`,
    direction: 'incoming',
  });

  try {
    const order = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);

    // Try to fetch item-level data first — show clickable item buttons if available
    const itemsRes = await fetch(`${apiBaseUrl}/orders/${order.id}/items`);
    const itemsData = await itemsRes.json();
    const items: any[] = itemsData?.items ?? [];

    if (items.length > 0) {
      // Item-level tracking exists — show process-of-elimination with inline buttons
      // Find the first unfinished item
      const unfinishedItem = items.find(
        (item: any) => item.production_status !== 'finished'
      );

      if (!unfinishedItem) {
        // All items already finished
        resetStep(chatId);
        await ctx.editMessageText(
          `✅ All items are already marked as produced for *${quotationNumber}*.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
        return;
      }

      const finishedCount = items.filter((i: any) => i.production_status === 'finished').length;
      const totalCount = items.length;

      const startedCount = items.filter((i: any) => i.production_status !== 'pending').length;
      let msg = `⚠️ *Partial Production — ${quotationNumber}*\n\n`;
      msg += `Item-level tracking is available. Let's go through each item:\n\n`;
      msg += `Items: ${finishedCount}/${totalCount} finished, ${startedCount}/${totalCount} started\n\n`;
      msg += `*Process of Elimination:*\n`;
      msg += `Next item: *${unfinishedItem.name}* x${unfinishedItem.quantity}\n\n`;
      msg += `Has *${unfinishedItem.name}* started or finished production?`;

      // Context-aware keyboard based on item status
      const kb = unfinishedItem.production_status === 'pending'
        ? [
            [Markup.button.callback(`🚀 ${unfinishedItem.name} — Started`, `item_prod:in_progress:${unfinishedItem.id.slice(0, 8)}:${quotationNumber}`)],
            [Markup.button.callback(`⏳ ${unfinishedItem.name} — Not Yet`, `item_prod:pending:${unfinishedItem.id.slice(0, 8)}:${quotationNumber}`)],
          ]
        : [
            [Markup.button.callback(`✅ ${unfinishedItem.name} — Finished`, `item_prod:finished:${unfinishedItem.id.slice(0, 8)}:${quotationNumber}`)],
            [Markup.button.callback(`🟢 ${unfinishedItem.name} — On Time`, `item_prod:ontime:${unfinishedItem.id.slice(0, 8)}:${quotationNumber}`)],
            [Markup.button.callback(`🔴 ${unfinishedItem.name} — Delayed`, `item_prod:delayed:${unfinishedItem.id.slice(0, 8)}:${quotationNumber}`)],
          ];
      await ctx.editMessageText(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(kb),
      });
    } else {
      // No item-level data — fall back to free-text input (legacy flow)
      setStep(chatId, { action: 'awaiting_partial_missing_items', orderId: order.id, quotationNumber });
      await ctx.editMessageText(
        `⚠️ *Partial Production — ${quotationNumber}*\n\nWhich items are NOT yet produced or ordered?\n\nList them comma-separated or one per line:\n\nExample:\n\`chairs, tables, shelves\``,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
    }
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

    // Prefer item-level tracking if order_items exist
    const itemsRes = await fetch(`${apiBaseUrl}/orders/${order.id}/items`);
    const itemsData = itemsRes.ok ? await itemsRes.json() : { items: [] };
    const orderItems: any[] = Array.isArray(itemsData?.items) ? itemsData.items : [];

    if (orderItems.length > 0) {
      // Item-level path: route to process-of-elimination
      const pendingItem = orderItems.find((i: any) => i.production_status === 'pending');

      if (!pendingItem) {
        resetStep(chatId);
        await ctx.editMessageText(
          `✅ All items have started production for *${quotationNumber}*. Order will advance to Production In Progress shortly.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
        return;
      }

      const finishedCount = orderItems.filter((i: any) => i.production_status === 'finished').length;
      const startedCount = orderItems.filter((i: any) => i.production_status !== 'pending').length;
      const totalCount = orderItems.length;

      const statusLines = orderItems.map((i: any) => {
        const icon = i.production_status === 'finished' ? '✅' : i.production_status === 'in_progress' ? '🔄' : '⏳';
        return `${icon} ${i.name} ×${i.quantity}`;
      }).join('\n');

      let msg = `⏳ *Partial Production — ${quotationNumber}*\n\n`;
      msg += `${startedCount}/${totalCount} items started, ${finishedCount}/${totalCount} finished:\n${statusLines}\n\n`;
      msg += `*Next pending:* *${pendingItem.name}* ×${pendingItem.quantity}\n\n`;
      msg += `Has *${pendingItem.name}* started production?`;

      await ctx.editMessageText(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`🚀 ${pendingItem.name} — Started`, `item_prod:in_progress:${pendingItem.id.slice(0, 8)}:${quotationNumber}`)],
          [Markup.button.callback(`⏳ ${pendingItem.name} — Not Yet`, `item_prod:pending:${pendingItem.id.slice(0, 8)}:${quotationNumber}`)],
        ]),
      });
      return;
    }

    // Legacy JSONB path: free-text update
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
    setStep(chatId, { action: 'awaiting_partial_items_update', orderId: order.id, quotationNumber, remainingItems });
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
    const order: any = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    const currentStage = order?.current_stage;

    // If the order is still in balance collection, these payment-status buttons should not
    // jump to payment_received/payment_confirmed. Ask for the balance amount instead.
    if (!order?.balance_paid && ['balance_due', 'inventory_arrived', 'delivery_scheduled', 'balance_verification'].includes(currentStage)) {
      // Fetch actual remaining balance from payments API for accuracy
      let remainingBalance = 0;
      try {
        const paymentsRes = await fetch(`${apiBaseUrl}/orders/${order.id}/payments`);
        if (paymentsRes.ok) {
          const paymentsData = await paymentsRes.json();
          remainingBalance = paymentsData.totals?.remaining_balance ?? 0;
        }
      } catch { /* fallback below */ }
      if (remainingBalance <= 0) {
        const totalAmount = Number(order?.total_amount ?? 0);
        const depositAmount = Number(order?.deposit_amount ?? 0);
        remainingBalance = Math.max(totalAmount - depositAmount, 0);
      }
      setStep(chatId, { action: 'awaiting_paybalance_amount', quotationNumber });
      await ctx.editMessageText(
        `*Balance Payment for ${escapeMarkdown(quotationNumber)}*\n\n` +
        `This order is still at *Balance Due*. Enter the amount the client paid in PHP.\n\n` +
        (remainingBalance > 0 ? `Remaining balance: *PHP ${remainingBalance.toLocaleString()}*\n\n` : '') +
        `Example: \`15000\``,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
      return;
    }

    const targetStage = status === 'confirmed' ? 'payment_confirmed' : 'payment_received';
    const allowedPaymentStages = ['delivered', 'countered', 'payment_received', 'payment_confirmed'];
    if (!allowedPaymentStages.includes(currentStage)) {
      await ctx.editMessageText(
        `Payment status cannot be recorded from the current stage: ${currentStage ?? 'unknown'}.\n\n` +
        `If this is a balance payment, use Pay Balance first. If the item was delivered, mark it delivered first.`,
        mainMenuKeyboard()
      );
      return;
    }

    if (status === 'confirmed') {
      // Use confirmPayment API which mirrors verify-balance behavior
      await postJson(`/orders/${encodeURIComponent(orderId)}/confirm-payment`, {
        confirmed_by: ctx.from?.username ?? String(ctx.from?.id),
      });
    } else {
      await postJson('/stage-updates', {
        quotation_number: quotationNumber,
        stage: targetStage,
        status,
        remarks: 'Payment received, pending confirmation',
        updated_by: ctx.from?.username ?? String(ctx.from?.id),
      });
    }
    await logAction({ chatId, userId, username, label: status === 'confirmed' ? 'Payment Confirmed' : 'Payment Received', quotationNumber });
    resetStep(chatId);
    const msg = status === 'confirmed'
      ? `*Payment Confirmed*\n\nOrder: *${escapeMarkdown(quotationNumber)}*\n\nOrder is now complete.`
      : `*Payment Received*\n\nOrder: *${escapeMarkdown(quotationNumber)}*\n\nAwaiting confirmation.`;
    await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
  } catch (err: any) {
    console.error('[payment callback] Error:', err);
    await ctx.editMessageText(`Error processing payment button: ${err.message ?? String(err)}`, mainMenuKeyboard());
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
  const orderIdPrefix = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `production:ontime:${orderIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    // Resolve full orderId from quotationNumber (callback uses 8-char prefix)
    const orderData = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    const orderId = orderData.id;
    // Report on-time status to API
    // Fetch order to get estimated_production_days for midpoint calculation
    const order = orderData;
    const totalDays = order.estimated_production_days ?? 28;
    const elapsedDays = order.production_started_at
      ? Math.floor((Date.now() - new Date(order.production_started_at).getTime()) / (1000 * 60 * 60 * 24))
      : Math.floor(totalDays / 2);
    const remainingDays = Math.max(1, totalDays - elapsedDays);

    await postJson(`/orders/${orderId}/report-production-status`, {
      on_time: true,
      delay_days: 0,
    });
    await logAction({ chatId, userId, username, label: 'Production On Time', quotationNumber });
    resetStep(chatId);
    // Ask how many days left to finish — default is the remaining days
    setStep(chatId, { action: 'awaiting_remaining_production_days', orderId, quotationNumber });
    await ctx.editMessageText(
      `✅ *On Time* — ${quotationNumber}\n\nProduction is on schedule.\n\nHow many days left to finish production?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`📅 ${remainingDays} days (estimated)`, `prod_remaining:${remainingDays}:${orderId.slice(0, 8)}:${quotationNumber}`)],
          [Markup.button.callback('✏️ Enter custom days', `prod_remaining:custom:${orderId.slice(0, 8)}:${quotationNumber}`)],
        ]),
      }
    );
  } catch (err: any) {
    await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// Midpoint check: Delayed
bot.action(/^production:delayed:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderIdPrefix = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `production:delayed:${orderIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    // Resolve full orderId from quotationNumber (callback uses 8-char prefix)
    const orderData = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    const orderId = orderData.id;
    // Set step to ask for delay days
    setStep(chatId, { action: 'awaiting_delay_days', orderId, quotationNumber });
    await ctx.editMessageText(
      `⚠️ *Delayed* — ${quotationNumber}\n\nHow many days is the delay? (Enter a number)\n\nAfter that, you'll be asked how many days remain to finish production.`,
      { parse_mode: 'Markdown', ...cancelButton() }
    );
  } catch (err: any) {
    await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// ── prod_remaining — User confirms remaining days to finish production ──
// Callback: prod_remaining:{days}:{orderIdPrefix}:{quotationNumber}
// Callback: prod_remaining:custom:{orderIdPrefix}:{quotationNumber}
bot.action(/^prod_remaining:(\d+|custom):([^:]*):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const daysOrCustom = ctx.match[1];
  const orderIdPrefix = ctx.match[2];
  const quotationNumber = ctx.match[3];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `prod_remaining:${daysOrCustom}:${orderIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  if (daysOrCustom === 'custom') {
    // Ask user to type the number of days
    try {
      const orderData = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
      const orderId = orderData.id;
      setStep(chatId, { action: 'awaiting_remaining_production_days', orderId, quotationNumber });
      await ctx.editMessageText(
        `✏️ *Remaining Days* — ${quotationNumber}\n\nEnter the number of days left to finish production:`,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
    } catch (err: any) {
      await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
    }
    return;
  }

  const remainingDays = parseInt(daysOrCustom, 10);
  try {
    const orderData = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    const orderId = orderData.id;
    // Record remaining days and schedule a due reminder
    await postJson(`/orders/${orderId}/recalc-production-reminders`, {
      remaining_production_days: remainingDays,
    });
    await logAction({ chatId, userId, username, label: 'Production Remaining Days Set', quotationNumber, details: `${remainingDays} day(s) left` });
    resetStep(chatId);
    await ctx.editMessageText(
      `✅ *Noted* — ${quotationNumber}\n\n*${remainingDays} days* remaining to finish production.\n\nA reminder will be sent when the production window ends to confirm if production has finished.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } catch (err: any) {
    await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// Production due: Finished
bot.action(/^production:finished:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderIdPrefix = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `production:finished:${orderIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    // Resolve full orderId from quotationNumber (callback uses 8-char prefix)
    const orderData = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    const orderId = orderData.id;
    // Ask for delivery timeline (how many days until available for delivery)
    setStep(chatId, { action: 'awaiting_delivery_timeline', orderId, quotationNumber });
    await ctx.editMessageText(
      `✅ *Production Finished* — ${quotationNumber}\n\nHow long until it's available for delivery?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📦 Standard (4 weeks)', `production:delivery_standard:${orderId.slice(0, 8)}:${quotationNumber}`)],
          [Markup.button.callback('📦 Custom', `production:delivery_custom:${orderId.slice(0, 8)}:${quotationNumber}`)],
          [Markup.button.callback('❌ Cancel', 'action:cancel')],
        ]),
      }
    );
  } catch (err: any) {
    await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// Production due: Not Yet Finished
bot.action(/^production:not_finished:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderIdPrefix = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `production:not_finished:${orderIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  // Re-create the production_due reminder for tomorrow
  try {
    const orderRes = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
    const order = await orderRes.json();
    // Resolve full orderId from order lookup (callback uses 8-char prefix)
    const orderId = order.id;
    const groupChatId = process.env.PRODUCTION_GROUP_CHAT_ID ?? process.env.PURCHASING_GROUP_ID;
    if (groupChatId && order) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      await postJson('/reminders', {
        order_id: orderId,
        stage: 'production_due',
        group_chat_id: groupChatId,
        message: `🏭 *Production Due* — ${quotationNumber} (${order.client_name ?? 'Unknown'})\nThe production window is now complete.\nDownpayment deposit has been confirmed and verified. Has the production started?`,
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

// NOTE: callback_data format uses first 8 chars of item UUID + quotation_number
// to stay within Telegram's 64-byte limit. The handler resolves the quotation_number
// to the full order UUID before making API calls.
bot.action(/^item_prod:(finished|in_progress|pending|ontime|delayed):([^:]+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const newStatus = ctx.match[1];
  const itemIdPrefix = ctx.match[2];
  const quotationNumber = ctx.match[3];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `item_prod:${newStatus}:${itemIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    // Resolve quotation_number to full order UUID
    const orderRes = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
    if (!orderRes.ok) {
      await ctx.editMessageText(`❌ Order #${quotationNumber} not found.`, { parse_mode: 'Markdown' });
      return;
    }
    const orderData = await orderRes.json();
    const orderId = orderData.id;

    // Fetch items for this order
    const itemsRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items`);
    const itemsData = await itemsRes.json();
    const items = itemsData?.items ?? [];

    // Find the item matching the prefix
    const targetItem = items.find((item: any) => item.id?.startsWith(itemIdPrefix));
    if (!targetItem) {
      await ctx.editMessageText('❌ Item not found. It may have been removed.', { parse_mode: 'Markdown' });
      return;
    }
    const itemId = targetItem.id;

    // ── Handle On Time / Delayed (no status change, just log/ack) ──
    if (newStatus === 'ontime') {
      await postJson(`/orders/${orderId}/production-logs`, {
        order_item_id: itemId,
        note: `🟢 Item "${targetItem.name}" production confirmed on time`,
        log_type: 'user',
        created_by: username ?? `user_${userId}`,
      });
      await ctx.editMessageText(
        `🟢 *On Time* — ${quotationNumber}\n\nItem *${targetItem.name}* is on track.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
      return;
    }

    if (newStatus === 'delayed') {
      setStep(chatId, { action: 'awaiting_item_prod_delay_days', itemId, orderId, quotationNumber });
      await ctx.editMessageText(
        `🔴 *Delayed* — ${quotationNumber}\n\nItem: *${targetItem.name}*\n\nHow many *additional* days are needed?`,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
      return;
    }

    // Track items the user has already said "Not Yet" to in this session
    // so we can skip them and avoid bouncing between the same items
    const skipSet: Set<string> = (ctx as any).__prodSkipSet ?? new Set();
    (ctx as any).__prodSkipSet = skipSet;

    // If user clicks "Not Yet" on an item already pending, add it to skip set
    // so we move to the next item instead of bouncing back
    if (newStatus === 'pending' && targetItem.production_status === 'pending') {
      skipSet.add(itemId);
    }

    // Update the item's production status via API (only if status actually changed)
    if (newStatus !== 'pending' || targetItem.production_status !== 'pending') {
      await patchJson(`/orders/${orderId}/items/${itemId}`, {
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
        log_type: 'user',
        created_by: username ?? `user_${userId}`,
      });
    }

    // ── If item just started and has no estimated days, prompt for them ──
    if (newStatus === 'in_progress' && !targetItem.estimated_production_days) {
      setStep(chatId, { action: 'awaiting_item_prod_days', itemId, orderId, quotationNumber });
      await ctx.editMessageText(
        `🚀 *Production Started* — ${quotationNumber}\n\nItem: *${targetItem.name}*\n\nHow many days to finish this item?`,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
      return;
    }

    // Fetch updated completion
    const completionRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items/completion`);
    const completion = await completionRes.json();

    // Refetch items to get fresh statuses after patch
    const updatedItemsRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items`);
    const updatedItemsData = await updatedItemsRes.json();
    const updatedItems = updatedItemsData?.items ?? items;

    // Determine state: finished, pending (unasked), or in-progress
    const allFinished = updatedItems.every((item: any) => item.production_status === 'finished');
    const nextPendingItem = updatedItems.find(
      (item: any) => item.production_status === 'pending' && !skipSet.has(item.id)
    );

    if (allFinished) {
      // All items finished! Call finish-production and start item-level en route verification
      await postJson(`/orders/${orderId}/production-logs`, {
        order_item_id: null,
        note: `✅ All items production finished (${completion?.production_pct ?? 100}% complete). Starting en route verification.`,
        log_type: 'user',
        created_by: username ?? `user_${userId}`,
      });

      // Advance order to en_route stage so the production agent can assist with reminders
      await postJson(`/orders/${orderId}/finish-production`, {
        delivery_estimated_days: 28,
      });
      await logAction({ chatId, userId, username, label: 'All Items Production Finished', details: `Order #${quotationNumber}` });

      // Immediately start item-level en route verification (don't wait for agent)
      await showItemLevelEnRoute(ctx, orderId, quotationNumber, updatedItems, true);
    } else if (!nextPendingItem) {
      // No more pending items to ask about
      if (skipSet.size > 0) {
        await ctx.editMessageText(
          `⏳ *All items reviewed.*\n\nOrder #${quotationNumber}\n${completion?.production_pct ?? 0}% complete.\n\nItems marked "Not Yet" will be tracked. Use the dashboard to update individual items.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } else {
        await ctx.editMessageText(
          `🔄 *All items have started production.*\n\nOrder #${quotationNumber}\n${completion?.production_pct ?? 0}% complete.\n\nUse the production dashboard to mark items as finished when ready.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      }
    } else {
      // ── Advance order to partial_production if any item is pending ──
      const hasPendingItem = updatedItems.some(
        (item: any) => item.production_status === 'pending'
      );

      if (hasPendingItem) {
        if (orderData.current_stage === 'production_pending') {
          // Collect names of pending items
          const pendingItems = updatedItems
            .filter((item: any) => item.production_status === 'pending')
            .map((item: any) => item.name);

          // Advance to partial production via API
          await postJson(`/orders/${orderId}/partial-production`, {
            missing_items: pendingItems,
          });

          await postJson(`/orders/${orderId}/production-logs`, {
            order_item_id: null,
            note: `⏳ Items pending production: ${pendingItems.join(', ')}. Order advanced to partial production.`,
            log_type: 'user',
            created_by: username ?? `user_${userId}`,
          });
        }
      }

      // Ask about the next unfinished item (process of elimination)
      const unfinishedItem = nextPendingItem;
      const finishedCount = updatedItems.filter((i: any) => i.production_status === 'finished').length;
      const totalCount = updatedItems.length;
      const prodPct = completion?.production_pct ?? 0;
      const finishedNotEnRoute = updatedItems.some(
        (i: any) => i.production_status === 'finished' && i.en_route_status === 'not_yet'
      );

      const progressBar = '█'.repeat(Math.round(prodPct / 10)) + '░'.repeat(10 - Math.round(prodPct / 10));

      let msg = `🏗️ *Item-Level Production*\n\n`;
      msg += `Progress: ${prodPct}% complete ${progressBar}\n`;
      msg += `Items: ${finishedCount}/${totalCount} finished\n\n`;
      msg += `*Process of Elimination:*\n`;
      msg += `Next item: *${unfinishedItem.name}* x${unfinishedItem.quantity}\n\n`;
      msg += `Has *${unfinishedItem.name}* started production?`;

      const keyboardRows: any[] = [
        [Markup.button.callback(`🚀 ${unfinishedItem.name} — Started`, `item_prod:in_progress:${unfinishedItem.id.slice(0, 8)}:${quotationNumber}`)],
        [Markup.button.callback(`⏳ ${unfinishedItem.name} — Not Yet`, `item_prod:pending:${unfinishedItem.id.slice(0, 8)}:${quotationNumber}`)],
      ];
      if (finishedNotEnRoute) {
        keyboardRows.push([Markup.button.callback(`🚚 Dispatch Finished Items`, `dispatch_ready:${quotationNumber}`)]);
      }

      await ctx.editMessageText(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(keyboardRows),
      });
    }
  } catch (err: any) {
    await ctx.reply(`❌ Error updating item production: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// ── Dispatch Ready Callback ──────────────────────────────────────────────
// Fires when user clicks "🚚 Dispatch Finished Items" from the production
// tracking flow. Starts item-level en-route for finished items only.

bot.action(/^dispatch_ready:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const quotationNumber = ctx.match[1];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `dispatch_ready:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    const orderData = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    const orderId = orderData.id;

    const itemsRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items`);
    const itemsData = await itemsRes.json();
    const items = itemsData?.items ?? [];

    const finishedNotEnRoute = items.filter(
      (i: any) => i.production_status === 'finished' && i.en_route_status === 'not_yet'
    );

    if (finishedNotEnRoute.length === 0) {
      await ctx.editMessageText(
        `✅ *No finished items waiting for dispatch.*\n\nOrder #${quotationNumber}\nAll finished items are already en route or arrived.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
      return;
    }

    await logAction({ chatId, userId, username, label: 'Dispatch Finished Items', details: `Order #${quotationNumber} — ${finishedNotEnRoute.length} item(s) ready` });
    await showItemLevelEnRoute(ctx, orderId, quotationNumber, items, true);
  } catch (err: any) {
    const safeMsg = err.message.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
    await ctx.reply(`❌ Error starting dispatch: ${safeMsg}`, { parse_mode: 'MarkdownV2', ...cancelButton() });
  }
});

// ── Item-Level En Route Callback Handlers ────────────────────────────────
// These handle the process-of-elimination item-by-item en-route tracking.
// Callback format: item_en_route:{status}:{itemId}:{orderId}
//   status = yes | no | arrived

// NOTE: callback_data format uses first 8 chars of item UUID + quotation_number
// to stay within Telegram's 64-byte limit.
bot.action(/^item_en_route:(yes|no|arrived|not_arrived):([^:]+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const newStatus = ctx.match[1];
  const itemIdPrefix = ctx.match[2];
  const quotationNumber = ctx.match[3];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `item_en_route:${newStatus}:${itemIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    // Resolve quotation_number to full order UUID
    const orderRes = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
    if (!orderRes.ok) {
      await ctx.editMessageText(`❌ Order #${quotationNumber} not found.`, { parse_mode: 'Markdown' });
      return;
    }
    const orderData = await orderRes.json();
    const orderId = orderData.id;

    // Fetch items for this order
    const itemsRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items`);
    const itemsData = await itemsRes.json();
    const items = itemsData?.items ?? [];

    const targetItem = items.find((item: any) => item.id?.startsWith(itemIdPrefix));
    if (!targetItem) {
      await ctx.editMessageText('❌ Item not found. It may have been removed.', { parse_mode: 'Markdown' });
      return;
    }
    const itemId = targetItem.id;

    // "yes" → don't mark en_route yet, ask how many days first
    if (newStatus === 'yes') {
      await ctx.editMessageText(
        `🚚 *${targetItem.name}* is en route!\n\nHow many days until it arrives at the inventory?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📅 28 days (standard)', `item_arr:28:${itemIdPrefix}:${quotationNumber}`)],
            [Markup.button.callback('✏️ Custom days', `item_arr:custom:${itemIdPrefix}:${quotationNumber}`)],
          ]),
        }
      );
      return;
    }

    // "not_arrived" → just acknowledge, agent will ask again on next run
    if (newStatus === 'not_arrived') {
      await ctx.editMessageText(
        `⏳ Noted — *${targetItem.name}* has not arrived yet.\n\nI'll check again when the arrival window passes.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
      return;
    }


    // Map remaining statuses (no, arrived) to en_route_status value
    const statusMap: Record<string, string> = {
      no: 'not_yet',
      arrived: 'arrived',
    };
    const enRouteStatus = statusMap[newStatus];

    // Track items the user has already said "Not Yet" to in this session
    // so we can skip them and avoid bouncing between the same items
    const skipKey = `en_route_skip:${chatId}:${orderId}`;
    const skipSet: Set<string> = (ctx as any).__enRouteSkipSet ?? new Set();
    (ctx as any).__enRouteSkipSet = skipSet;

    // If user clicks "Not Yet" on an item already not_yet, add it to skip set
    // so we move to the next item instead of bouncing back
    if (newStatus === 'no' && targetItem.en_route_status === 'not_yet') {
      skipSet.add(itemId);
    }

    // Update the item's en_route status via API (only if status actually changed)
    if (newStatus !== 'no' || targetItem.en_route_status !== 'not_yet') {
      await patchJson(`/orders/${orderId}/items/${itemId}`, {
        en_route_status: enRouteStatus,
      });

      const statusLabels: Record<string, string> = {
        no: '⏳ Not Yet En Route',
        arrived: '📦 Arrived at Inventory',
      };
      await postJson(`/orders/${orderId}/production-logs`, {
        order_item_id: itemId,
        note: `Item en-route status updated to: ${statusLabels[newStatus]}`,
        log_type: 'user',
        created_by: username ?? `user_${userId}`,
      });
    }

    // Fetch updated items (re-fetch to get fresh statuses after patch)
    const updatedItemsRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items`);
    const updatedItemsData = await updatedItemsRes.json();
    const updatedItems = updatedItemsData?.items ?? [];

    // Calculate en-route % based on FINISHED items only
    const finishedItems = updatedItems.filter((i: any) => i.production_status === 'finished');
    const totalQty = finishedItems.reduce((sum: number, i: any) => sum + (i.quantity ?? 1), 0);
    const enRouteQty = finishedItems
      .filter((i: any) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived')
      .reduce((sum: number, i: any) => sum + (i.quantity ?? 1), 0);
    const enRoutePct = totalQty > 0 ? Math.round((enRouteQty / totalQty) * 100) : 0;
    const thresholdMet = enRoutePct > 50;
    const allItemsFinished = updatedItems.length > 0 && updatedItems.every((i: any) => i.production_status === 'finished');

    // Find the next FINISHED item not yet en route, skipping items the user already said "Not Yet" to
    const notEnRouteItem = finishedItems.find(
      (item: any) => item.en_route_status === 'not_yet' && !skipSet.has(item.id)
    );

    if (!notEnRouteItem) {
      // Check if user said "Not Yet" to all remaining items (skip set has items)
      // If so, don't auto-advance — just acknowledge
      if (skipSet.size > 0) {
        await ctx.editMessageText(
          `⏳ *All remaining finished items marked as not yet en route.*\n\nOrder #${quotationNumber}\n${enRoutePct}% of finished qty en route.\n\nThe order will advance once all finished items are confirmed en route.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } else {
        // All finished items en route! Start timed tracking only if all items are finished
        const maxDays = Math.max(...finishedItems.map((i: any) => i.estimated_arrival_days ?? 28));
        if (allItemsFinished) {
          await postJson(`/orders/${orderId}/production-logs`, {
            order_item_id: null,
            note: `✅ All items en route (${enRoutePct}% of qty). En route tracking started — arrival in ${maxDays} days.`,
            log_type: 'user',
            created_by: username ?? `user_${userId}`,
          });

          await postJson(`/orders/${orderId}/start-en-route-tracking`, {
            estimated_inventory_arrival_days: maxDays,
          });
        }
        await logAction({ chatId, userId, username, label: 'All Finished Items En Route', details: `Order #${quotationNumber} — ${maxDays} days to arrival` });

        const statusLine = allItemsFinished
          ? `All items en route (${enRoutePct}% of qty).`
          : `All finished items en route (${enRoutePct}% of finished qty). Production still in progress.`;
        await ctx.editMessageText(
          `✅ *All Finished Items En Route!*\n\nOrder #${quotationNumber}\n${statusLine}\n\n📅 Midpoint check at day ${Math.floor(maxDays / 2)}.\n📦 Arrival check in the inventory group on the estimated arrival date.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      }
    } else {
      // Ask about the next not-en-route item (process of elimination)
      const enRouteCount = updatedItems.filter((i: any) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived').length;
      const totalCount = updatedItems.length;

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
          [Markup.button.callback(`🚚 Yes, En Route`, `item_en_route:yes:${notEnRouteItem.id.slice(0, 8)}:${quotationNumber}`)],
          [Markup.button.callback(`❌ Not Yet`, `item_en_route:no:${notEnRouteItem.id.slice(0, 8)}:${quotationNumber}`)],
        ]),
      });
    }
  } catch (err: any) {
    const safeMsg = err.message.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
    await ctx.reply(`❌ Error updating item en route: ${safeMsg}`, { parse_mode: 'MarkdownV2', ...cancelButton() });
  }
});

// ── Item En Route: Arrival Days Selection ────────────────────────────────────
// Fires after user taps "Yes, En Route" for an item and picks arrival days.

bot.action(/^item_arr:(28|custom):([^:]+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const daysChoice = ctx.match[1];
  const itemIdPrefix = ctx.match[2];
  const quotationNumber = ctx.match[3];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `item_arr:${daysChoice}:${itemIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    // Custom days → prompt for text input
    if (daysChoice === 'custom') {
      const orderData = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
      setStep(chatId, {
        action: 'awaiting_en_route_item_days',
        itemId: itemIdPrefix,
        orderId: orderData.id,
        quotationNumber,
      });
      await ctx.editMessageText(
        `✏️ How many days until this item arrives?\n\nEnter the number (e.g., \`14\`, \`45\`):`,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
      return;
    }

    // Standard 28 days → mark item en_route immediately
    const arrivalDays = 28;
    const orderData = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    const orderId = orderData.id;

    const itemsRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items`);
    const itemsData = await itemsRes.json();
    const items = itemsData?.items ?? [];
    const targetItem = items.find((item: any) => item.id?.startsWith(itemIdPrefix));
    if (!targetItem) {
      await ctx.editMessageText('❌ Item not found. It may have been removed.', { parse_mode: 'Markdown' });
      return;
    }
    const itemId = targetItem.id;

    await patchJson(`/orders/${orderId}/items/${itemId}`, {
      en_route_status: 'en_route',
      estimated_arrival_days: arrivalDays,
    });
    await postJson(`/orders/${orderId}/production-logs`, {
      order_item_id: itemId,
      note: `🚚 ${targetItem.name} marked en route — estimated arrival: ${arrivalDays} days`,
      log_type: 'user',
      created_by: username ?? `user_${userId}`,
    });

    // Re-fetch updated items to show next in process of elimination
    const updatedItemsRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items`);
    const updatedItemsData = await updatedItemsRes.json();
    const updatedItems = updatedItemsData?.items ?? [];

    const totalQty = updatedItems.reduce((sum: number, i: any) => sum + (i.quantity ?? 1), 0);
    const enRouteQty = updatedItems
      .filter((i: any) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived')
      .reduce((sum: number, i: any) => sum + (i.quantity ?? 1), 0);
    const enRoutePct = totalQty > 0 ? Math.round((enRouteQty / totalQty) * 100) : 0;

    const notEnRouteItem = updatedItems.find((i: any) => i.en_route_status === 'not_yet');

    if (!notEnRouteItem) {
      const maxDays = Math.max(...updatedItems.map((i: any) => i.estimated_arrival_days ?? 28));
      await postJson(`/orders/${orderId}/start-en-route-tracking`, { estimated_inventory_arrival_days: maxDays });
      await logAction({ chatId, userId, username, label: 'All Items En Route — Tracking Started', details: `Order #${quotationNumber} — arrival in ${maxDays} days` });
      await ctx.editMessageText(
        `✅ *All Items En Route!*\n\nOrder #${quotationNumber}\nAll items en route (${enRoutePct}% of qty).\n\n📅 Midpoint check at day ${Math.floor(maxDays / 2)}.\n📦 Arrival check in the inventory group on the estimated arrival date.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
    } else {
      const enRouteCount = updatedItems.filter((i: any) => i.en_route_status === 'en_route' || i.en_route_status === 'arrived').length;
      const progressBar = '█'.repeat(Math.round(enRoutePct / 10)) + '░'.repeat(10 - Math.round(enRoutePct / 10));

      let msg = `✅ *${targetItem.name}* is en route — arriving in *${arrivalDays} days*!\n\n`;
      msg += `🚚 *Item-Level En Route* — ${enRouteCount}/${updatedItems.length} items (${enRoutePct}%) ${progressBar}\n\n`;
      msg += `*Process of Elimination:*\n`;
      msg += `Next item: *${notEnRouteItem.name}* x${notEnRouteItem.quantity}\n\n`;
      msg += `Is *${notEnRouteItem.name}* en route yet?`;

      await ctx.editMessageText(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`🚚 Yes, En Route`, `item_en_route:yes:${notEnRouteItem.id.slice(0, 8)}:${quotationNumber}`)],
          [Markup.button.callback(`❌ Not Yet`, `item_en_route:no:${notEnRouteItem.id.slice(0, 8)}:${quotationNumber}`)],
        ]),
      });
    }
  } catch (err: any) {
    await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// ── Item Arrival Check: On Time / Delayed ────────────────────────────────────
// Sent by the production agent at the halfway point.

bot.action(/^item_arr_check:(ontime|delayed):([^:]+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const checkResult = ctx.match[1];
  const itemIdPrefix = ctx.match[2];
  const quotationNumber = ctx.match[3];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `item_arr_check:${checkResult}:${itemIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    if (checkResult === 'ontime') {
      await ctx.editMessageText(
        `✅ Great! Noted — the item is on track to arrive on time.\n\nI'll ask again when the arrival date comes.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
    } else {
      // Delayed — ask for new estimated days
      setStep(chatId, {
        action: 'awaiting_en_route_item_new_days',
        itemId: itemIdPrefix,
        quotationNumber,
      });
      await ctx.editMessageText(
        `⚠️ Noted — item is delayed.\n\nHow many *total days* do you now estimate for arrival? (e.g., \`42\`):`,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
    }
  } catch (err: any) {
    await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// ── En Route Midpoint & Arrival Check Callbacks ───────────────────────────────
// Fired by reminders created in start-en-route-tracking.

// Midpoint: still on track
bot.action(/^en_route_mid:ontime:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const quotationNumber = ctx.match[1];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  botLog({ chatId, userId, username, messageType: 'callback_query', content: `en_route_mid:ontime:${quotationNumber}`, direction: 'incoming' });
  await ctx.editMessageText(
    `✅ *Still On Track* — ${quotationNumber}\n\nGreat! The shipment is on track. I'll check again when the estimated arrival date comes.`,
    { parse_mode: 'Markdown', ...mainMenuKeyboard() }
  );
  await logAction({ chatId, userId, username, label: 'En Route Midpoint: On Track', quotationNumber });
});

// Midpoint: delayed — ask for new total days
bot.action(/^en_route_mid:delay:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const quotationNumber = ctx.match[1];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  botLog({ chatId, userId, username, messageType: 'callback_query', content: `en_route_mid:delay:${quotationNumber}`, direction: 'incoming' });
  try {
    const orderData = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    setStep(chatId, { action: 'awaiting_en_route_midpoint_new_days', orderId: orderData.id, quotationNumber });
    await ctx.editMessageText(
      `⚠️ *Delayed — ${quotationNumber}*\n\nHow many total days do you now estimate for arrival? (e.g., \`42\`):`,
      { parse_mode: 'Markdown', ...cancelButton() }
    );
  } catch (err: any) {
    await ctx.editMessageText(`❌ Error: ${err.message}`, { parse_mode: 'Markdown' });
  }
});

// Arrival check: arrived — advance to inventory_arrived
bot.action(/^en_route_arr:yes:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const quotationNumber = ctx.match[1];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  botLog({ chatId, userId, username, messageType: 'callback_query', content: `en_route_arr:yes:${quotationNumber}`, direction: 'incoming' });
  await ctx.editMessageText(`📦 Confirming arrival for *${quotationNumber}*...`, { parse_mode: 'Markdown' }).catch(() => {});
  try {
    await postJson('/stage-updates', {
      quotation_number: quotationNumber,
      stage: 'inventory_arrived',
      status: 'arrived',
      remarks: 'Inventory arrived — confirmed via en route arrival reminder',
      updated_by: ctx.from?.username ?? `user_${userId}`,
    });
    await logAction({ chatId, userId, username, label: 'Inventory Arrived (Arrival Reminder)', quotationNumber });
    await ctx.editMessageText(
      `📦 *Inventory Arrived!* — ${quotationNumber}\n\nOrder advanced to Inventory Arrived stage.\n\nBalance due process will now begin.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } catch (err: any) {
    await ctx.editMessageText(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// Arrival check: not yet — ask for how many more days
bot.action(/^en_route_arr:no:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const quotationNumber = ctx.match[1];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  botLog({ chatId, userId, username, messageType: 'callback_query', content: `en_route_arr:no:${quotationNumber}`, direction: 'incoming' });
  try {
    const orderData = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    setStep(chatId, { action: 'awaiting_en_route_arrival_not_yet_days', orderId: orderData.id, quotationNumber });
    await ctx.editMessageText(
      `⏳ *Not Yet* — ${quotationNumber}\n\nHow many more days until the inventory arrives? (e.g., \`7\`):`,
      { parse_mode: 'Markdown', ...cancelButton() }
    );
  } catch (err: any) {
    await ctx.editMessageText(`❌ Error: ${err.message}`, { parse_mode: 'Markdown' });
  }
});

// ── En Route Verification Reminder Handlers ──────────────────────────────
// En Route Verification: yes — all items arrived, advance to inventory_verification
bot.action(/^en_route_verif:yes:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const quotationNumber = ctx.match[1];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  botLog({ chatId, userId, username, messageType: 'callback_query', content: `en_route_verif:yes:${quotationNumber}`, direction: 'incoming' });
  await ctx.editMessageText(`🔎 Confirming all items arrived for *${quotationNumber}*...`, { parse_mode: 'Markdown' }).catch(() => {});
  try {
    await postJson('/stage-updates', {
      quotation_number: quotationNumber,
      stage: 'inventory_verification',
      status: 'arrived',
      remarks: 'All items arrived — confirmed via en route verification reminder',
      updated_by: ctx.from?.username ?? `user_${userId}`,
    });
    await logAction({ chatId, userId, username, label: 'All Items Arrived (En Route Verification)', quotationNumber });
    const inventoryVerifLink = `${process.env.DASHBOARD_URL ?? 'https://track.homeatelier.ph'}/inventory/verification/${encodeURIComponent(quotationNumber)}`;
    await ctx.editMessageText(
      `✅ *All Items Arrived!* — ${quotationNumber}\n\nOrder advanced to Inventory Verification stage.\n\nInventory team will now verify the items.\n\n🔍 [Open Inventory Verification](${inventoryVerifLink})`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } catch (err: any) {
    await ctx.editMessageText(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// En Route Verification: no — not yet arrived, ask for more days
bot.action(/^en_route_verif:no:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const quotationNumber = ctx.match[1];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  botLog({ chatId, userId, username, messageType: 'callback_query', content: `en_route_verif:no:${quotationNumber}`, direction: 'incoming' });
  try {
    const orderData = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    setStep(chatId, { action: 'awaiting_en_route_verif_not_yet_days', orderId: orderData.id, quotationNumber });
    await ctx.editMessageText(
      `⏳ *Not Yet* — ${quotationNumber}\n\nHow many more days until all items arrive? (e.g., \`7\`):`,
      { parse_mode: 'Markdown', ...cancelButton() }
    );
  } catch (err: any) {
    await ctx.editMessageText(`❌ Error: ${err.message}`, { parse_mode: 'Markdown' });
  }
});

// En Route Verification: check — show item-level status
bot.action(/^en_route_verif:check:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const quotationNumber = ctx.match[1];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  botLog({ chatId, userId, username, messageType: 'callback_query', content: `en_route_verif:check:${quotationNumber}`, direction: 'incoming' });
  try {
    const orderData = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    if (!orderData || !orderData.items || orderData.items.length === 0) {
      await ctx.editMessageText(
        `📋 *Item Status* — ${quotationNumber}\n\nNo item-level tracking found for this order. Use the dashboard to update item statuses.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
      return;
    }
    const itemsList = orderData.items
      .map((i: any) => {
        const icon = i.en_route_status === 'arrived' ? '✅' : i.en_route_status === 'en_route' ? '🚚' : '⏳';
        return `${icon} ${i.name} ×${i.quantity} — ${i.en_route_status ?? 'not_yet'}`;
      })
      .join('\n');
    const inventoryVerifLink = `${process.env.DASHBOARD_URL ?? 'https://track.homeatelier.ph'}/inventory/verification/${encodeURIComponent(quotationNumber)}`;
    await ctx.editMessageText(
      `📋 *Item Arrival Status* — ${quotationNumber}\n\n${itemsList}\n\n💡 Items marked ✅ arrived can be verified early:\n[🔍 Open Inventory Verification](${inventoryVerifLink})\n\nUse the dashboard to update individual item statuses.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } catch (err: any) {
    await ctx.editMessageText(`❌ Error: ${err.message}`, { parse_mode: 'Markdown' });
  }
});

// Delivery timeline: Standard (4 weeks)
bot.action(/^production:delivery_standard:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderIdPrefix = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `production:delivery_standard:${orderIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    // Resolve full orderId from quotationNumber (callback uses 8-char prefix)
    const orderData = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    const orderId = orderData.id;
    // Finish production with standard 4 weeks (28 days) delivery estimate
    await postJson(`/orders/${orderId}/finish-production`, {
      delivery_estimated_days: 28,
    });
    await logAction({ chatId, userId, username, label: 'Production Finished', quotationNumber, details: 'Delivery in: 28 days (standard)' });

    // For item-level orders, start per-item en route verification
    const itemsRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items`);
    const itemsData = await itemsRes.json();
    if (itemsData?.items?.length > 0) {
      await showItemLevelEnRoute(ctx, orderId, quotationNumber, itemsData.items, true);
    } else {
      // Legacy order-level flow
      setStep(chatId, { action: 'awaiting_en_route', orderId, quotationNumber });
      await ctx.editMessageText(
        `✅ *Delivery Timeline Set* — ${quotationNumber}\n\nProduction is finished. Estimated delivery availability: *4 weeks (28 days)*.\n\n🚚 Is the order en route to the client?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Yes, it\'s en route', `en_route:yes:${orderId.slice(0, 8)}:${quotationNumber}`)],
            [Markup.button.callback('❌ Not yet', `en_route:no:${orderId.slice(0, 8)}:${quotationNumber}`)],
          ]),
        }
      );
    }
  } catch (err: any) {
    await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// Delivery timeline: Custom
bot.action(/^production:delivery_custom:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderIdPrefix = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `production:delivery_custom:${orderIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    // Resolve full orderId from quotationNumber (callback uses 8-char prefix)
    const orderData = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    const orderId = orderData.id;
    // Ask for custom delivery days
    setStep(chatId, { action: 'awaiting_custom_delivery_days', orderId, quotationNumber });
    await ctx.editMessageText(
      `📦 *Custom Delivery Timeline* — ${quotationNumber}\n\nEnter the number of days until available for delivery:`,
      { parse_mode: 'Markdown', ...cancelButton() }
    );
  } catch (err: any) {
    await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// ── En Route Callback Handlers ────────────────────────────────────────
// After production is finished, the bot asks "Is the order en route?"
// If yes → ask for estimated arrival days (28 days default or custom)
// If no → daily reminder will keep asking

// En Route: Yes — ask for estimated arrival days
bot.action(/^en_route:yes:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderIdPrefix = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `en_route:yes:${orderIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    // Resolve full orderId from quotationNumber (callback uses 8-char prefix)
    const orderData = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    const orderId = orderData.id;

    setStep(chatId, { action: 'awaiting_en_route_arrival_days', orderId, quotationNumber });
    await ctx.editMessageText(
      `🚚 *En Route Confirmed* — ${quotationNumber}\n\nHow many days estimated for inventory to arrive?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📦 28 days (Standard)', `en_route:arrival_standard:${orderId.slice(0, 8)}:${quotationNumber}`)],
          [Markup.button.callback('📦 Custom days', `en_route:arrival_custom:${orderId.slice(0, 8)}:${quotationNumber}`)],
          [Markup.button.callback('❌ Cancel', 'action:cancel')],
        ]),
      }
    );
  } catch (err: any) {
    await ctx.editMessageText(`❌ Order #${quotationNumber} not found.`, { parse_mode: 'Markdown' });
  }
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
  const orderIdPrefix = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `en_route:arrival_standard:${orderIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    // Resolve full orderId from quotationNumber (callback uses 8-char prefix)
    const orderData = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    const orderId = orderData.id;

    await postJson(`/orders/${orderId}/start-en-route-tracking`, {
      estimated_inventory_arrival_days: 28,
    });
    await logAction({ chatId, userId, username, label: 'En Route Tracking Started', quotationNumber, details: 'Arrival in: 28 days (standard)' });
    resetStep(chatId);
    await ctx.editMessageText(
      `✅ *En Route Tracking Started* — ${quotationNumber}\n\nEstimated arrival: *28 days*.\n\n📅 Midpoint check at day 14.\n📦 Arrival check will fire in the inventory group on the estimated arrival date.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } catch (err: any) {
    await ctx.reply(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// En Route: Custom arrival days
bot.action(/^en_route:arrival_custom:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderIdPrefix = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `en_route:arrival_custom:${orderIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    // Resolve full orderId from quotationNumber (callback uses 8-char prefix)
    const orderData = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    const orderId = orderData.id;

    setStep(chatId, { action: 'awaiting_en_route_arrival_days', orderId, quotationNumber });
    await ctx.editMessageText(
      `📦 *Custom Arrival Days* — ${quotationNumber}\n\nEnter the number of days estimated for inventory to arrive:`,
      { parse_mode: 'Markdown', ...cancelButton() }
    );
  } catch (err: any) {
    await ctx.editMessageText(`❌ Order #${quotationNumber} not found.`, { parse_mode: 'Markdown' });
  }
});

// ── Inventory Arrived Callback Handlers ──────────────────────────────

function truncateButtonLabel(value: string, max = 38): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

async function getOrderByQuotation(quotationNumber: string): Promise<any> {
  const orderRes = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
  if (!orderRes.ok) throw new Error(`Order #${quotationNumber} not found`);
  return orderRes.json();
}

async function getOrderItems(orderId: string): Promise<any[]> {
  const itemsRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items`);
  if (!itemsRes.ok) throw new Error(`Unable to load order items (${itemsRes.status})`);
  const itemsData = await itemsRes.json();
  return itemsData?.items ?? [];
}

function inventoryReadyKeyboard(orderId: string, quotationNumber: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Upload Photos', 'menu:upload')],
    [Markup.button.callback('Ready for Delivery', `inv_ready:${quotationNumber}`)],
    [Markup.button.callback('Still Waiting', `inv_wait:${quotationNumber}`)],
  ]);
}

// ── Stock Preparation Callbacks (from_stock orders) ──────────────────────

bot.action(/^stock_prep:ready:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const quotationNumber = ctx.match[1];

  botLog({ chatId, userId, username, messageType: 'callback_query', content: `stock_prep:ready:${quotationNumber}`, direction: 'incoming' });
  await ctx.editMessageText(`⏳ Marking stock as ready for *${quotationNumber}*...`, { parse_mode: 'Markdown' });

  try {
    const ordersRes = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
    if (!ordersRes.ok) throw new Error(`Order ${quotationNumber} not found`);
    const orderData = await ordersRes.json();
    const orderId = orderData.id;

    const res = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(orderId)}/stock-ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deduct_inventory: true, updated_by: username ?? userId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'API error' }));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    await ctx.editMessageText(
      `✅ *Stock Ready — ${quotationNumber}*\n\n` +
      `Inventory deducted. Order advanced to *Balance Due* stage.\n\n` +
      `Please collect the balance payment from the client.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } catch (err: any) {
    await ctx.editMessageText(`❌ Failed to mark stock ready: ${err.message}`, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
  }
});

bot.action(/^stock_prep:delay:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const quotationNumber = ctx.match[1];

  botLog({ chatId, userId, username, messageType: 'callback_query', content: `stock_prep:delay:${quotationNumber}`, direction: 'incoming' });
  await ctx.editMessageText(
    `⏳ *Stock Not Ready Yet — ${quotationNumber}*\n\n` +
    `Understood. The reminder will continue until the stock is prepared.\n\n` +
    `Mark ready from the dashboard or via the next reminder.`,
    { parse_mode: 'Markdown', ...mainMenuKeyboard() }
  );
});

// Top-level Yes / No / Partial arrival GUI.
// Partial lists extracted quotation items; each item click marks it arrived, so future reminders
// only ask about the remaining not-arrived items (process of elimination).
bot.action(/^inv_arr:(yes|no|partial):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const choice = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `inv_arr:${choice}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    const orderData = await getOrderByQuotation(quotationNumber);
    const orderId = orderData.id;
    const items = await getOrderItems(orderId);
    const pendingItems = items.filter((item: any) => item.en_route_status !== 'arrived');

    if (choice === 'no') {
      await postJson(`/orders/${orderId}/production-logs`, {
        order_item_id: null,
        note: 'Inventory arrival marked: none arrived yet. Reminders remain active.',
        log_type: 'user',
        created_by: username ?? `user_${userId}`,
      });

      await ctx.editMessageText(
        `*Inventory Not Arrived* - ${quotationNumber}\n\nNoted. No items were marked arrived. The bot will keep reminding for this inventory stage.`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('Main Menu', 'menu:main')]]) }
      );
      return;
    }

    if (choice === 'yes') {
      for (const item of pendingItems) {
        await patchJson(`/orders/${orderId}/items/${item.id}`, { en_route_status: 'arrived' });
      }

      await postJson(`/orders/${orderId}/production-logs`, {
        order_item_id: null,
        note: `All inventory items marked arrived via Telegram (${pendingItems.length} updated).`,
        log_type: 'user',
        created_by: username ?? `user_${userId}`,
      });

      await ctx.editMessageText(
        `*All Inventory Arrived* - ${quotationNumber}\n\n${items.length ? `Marked ${items.length} extracted item(s) as arrived.` : 'No extracted item rows were found, but inventory was confirmed as arrived.'}\n\nUpload inventory photos if needed, then confirm delivery readiness.`,
        { parse_mode: 'Markdown', ...inventoryReadyKeyboard(orderId, quotationNumber) }
      );
      return;
    }

    if (pendingItems.length === 0) {
      await ctx.editMessageText(
        `*All Items Already Arrived* - ${quotationNumber}\n\nThere are no remaining extracted items to choose.`,
        { parse_mode: 'Markdown', ...inventoryReadyKeyboard(orderId, quotationNumber) }
      );
      return;
    }

    const rows = pendingItems.slice(0, 20).map((item: any) => [
      Markup.button.callback(
        `${truncateButtonLabel(item.name ?? 'Item')} x${item.quantity ?? 1}`,
        `item_inventory:arrived:${String(item.id).slice(0, 8)}:${quotationNumber}`
      ),
    ]);
    rows.push([Markup.button.callback('None of these arrived', `inv_arr:no:${quotationNumber}`)]);

    let msg = `*Partial Inventory Arrival* - ${quotationNumber}\n\n`;
    msg += 'Choose the extracted quotation item(s) that arrived. Each click marks that item arrived; the next reminders will only ask about items still not arrived.\n\n';
    msg += `Showing ${Math.min(pendingItems.length, 20)}/${pendingItems.length} not-arrived item(s).`;

    await ctx.editMessageText(msg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(rows),
    });
  } catch (err: any) {
    await ctx.reply(`Error handling inventory arrival: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// Short callback variant used by new keyboards to stay below Telegram's 64-byte callback_data limit.
bot.action(/^inv_ready:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const quotationNumber = ctx.match[1];

  botLog({ chatId, userId, username, messageType: 'callback_query', content: `inv_ready:${quotationNumber}`, direction: 'incoming' });

  try {
    const order = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    const isBalanceVerified = order?.balance_verified === true;
    const nextStage = isBalanceVerified ? 'delivery_pending' : 'balance_due';
    const remarks = isBalanceVerified
      ? 'Inventory arrived - ready for delivery, balance already verified'
      : 'Inventory arrived - ready for delivery, balance payment required';
    const actionLabel = isBalanceVerified ? 'Inventory Ready - Delivery Pending' : 'Inventory Ready - Balance Due';

    await postJson('/stage-updates', {
      quotation_number: quotationNumber,
      stage: nextStage,
      status: 'auto_advanced',
      remarks,
      updated_by: 'delivery-agent',
    });
    await logAction({ chatId, userId, username, label: actionLabel, quotationNumber });

    const INVENTORY_GROUP_CHAT_ID = process.env.INVENTORY_GROUP_CHAT_ID;
    if (INVENTORY_GROUP_CHAT_ID && String(INVENTORY_GROUP_CHAT_ID) !== chatId) {
      try {
        const groupMessage = isBalanceVerified
          ? `<b>Inventory Arrival Confirmed (Telegram Bot)</b>\n\nQuotation: <b>${quotationNumber}</b>\nAll inventory has been confirmed as arrived via Telegram bot.\nOrder is now in Delivery Pending stage.`
          : `<b>Inventory Arrival Confirmed (Telegram Bot)</b>\n\nQuotation: <b>${quotationNumber}</b>\nAll inventory has been confirmed as arrived via Telegram bot.\nOrder is now in Balance Due stage.`;
        await ctx.telegram.sendMessage(
          INVENTORY_GROUP_CHAT_ID,
          groupMessage,
          { parse_mode: 'HTML' }
        );
      } catch { /* best-effort */ }
    }

    if (isBalanceVerified) {
      await ctx.editMessageText(
        `*Inventory Ready* - ${quotationNumber}\n\nStage advanced to *Delivery Pending*.\n\nBalance has already been verified.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Main Menu', 'menu:main')],
          ]),
        }
      );
    } else {
      await ctx.editMessageText(
        `*Inventory Ready* - ${quotationNumber}\n\nStage advanced to *Balance Due*.\n\nPlease collect the balance payment from the client.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Pay Balance', `pick:paybalance:${quotationNumber}`)],
            [Markup.button.callback('Main Menu', 'menu:main')],
          ]),
        }
      );
    }
  } catch (err: any) {
    await ctx.editMessageText(`Error updating order: ${err.message}`, { parse_mode: 'Markdown' });
  }
});

bot.action(/^inv_wait:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const quotationNumber = ctx.match[1];

  botLog({ chatId, userId, username, messageType: 'callback_query', content: `inv_wait:${quotationNumber}`, direction: 'incoming' });
  await logAction({ chatId, userId, username, label: 'Inventory Still Waiting', quotationNumber });

  await ctx.editMessageText(
    `*Still Waiting* - ${quotationNumber}\n\nNoted. The bot will check again tomorrow. Please update once the inventory is ready for delivery.`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('Main Menu', 'menu:main')]]) }
  );
});

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
    const order = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    const isBalanceVerified = order?.balance_verified === true;
    const nextStage = isBalanceVerified ? 'delivery_pending' : 'balance_due';
    const remarks = isBalanceVerified
      ? 'Inventory arrived — ready for delivery, balance already verified'
      : 'Inventory arrived — ready for delivery, balance payment required';
    const actionLabel = isBalanceVerified ? 'Inventory Ready — Delivery Pending' : 'Inventory Ready — Balance Due';

    // Advance to the appropriate stage via /stage-updates (accepts quotation_number)
    await postJson('/stage-updates', {
      quotation_number: quotationNumber,
      stage: nextStage,
      status: 'auto_advanced',
      remarks,
      updated_by: 'delivery-agent',
    });
    await logAction({ chatId, userId, username, label: actionLabel, quotationNumber });

    // Notify inventory group chat about the arrival confirmation
    const INVENTORY_GROUP_CHAT_ID = process.env.INVENTORY_GROUP_CHAT_ID;
    if (INVENTORY_GROUP_CHAT_ID && String(INVENTORY_GROUP_CHAT_ID) !== chatId) {
      try {
        const groupMessage = isBalanceVerified
          ? `✅ <b>Inventory Arrival Confirmed (Telegram Bot)</b>\n\n` +
            `Quotation: <b>${quotationNumber}</b>\n` +
            `All inventory has been confirmed as arrived via Telegram bot.\n` +
            `Order is now in Delivery Pending stage.`
          : `✅ <b>Inventory Arrival Confirmed (Telegram Bot)</b>\n\n` +
            `Quotation: <b>${quotationNumber}</b>\n` +
            `All inventory has been confirmed as arrived via Telegram bot.\n` +
            `Order is now in Balance Due stage.`;
        await ctx.telegram.sendMessage(
          INVENTORY_GROUP_CHAT_ID,
          groupMessage,
          { parse_mode: 'HTML' }
        );
      } catch { /* non-fatal — group notification is best-effort */ }
    }

    if (isBalanceVerified) {
      await ctx.editMessageText(
        `✅ *Inventory Ready* — ${quotationNumber}\n\n` +
        `Stage advanced to 🚚 *Delivery Pending*.\n\n` +
        `Balance has already been verified.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🏠 Main Menu', 'menu:main')],
          ]),
        }
      );
    } else {
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
    }
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

// ── Inventory Verification Callback Handlers ──────────────────────────

/**
 * inv_verify:all — Mark item as fully verified (all quantity confirmed)
 * inv_verify:partial — Mark item as partially verified (user enters qty)
 * inv_verify:not_yet — Mark item as not yet verified
 *
 * Callback format: inv_verify:{action}:{itemId}:{orderId}
 */
bot.action(/^inv_verify:(all|partial|not_yet):([^:]+):([^:]+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const action = ctx.match[1];
  const itemIdPrefix = ctx.match[2];
  const orderIdPrefix = ctx.match[3];
  const quotationNumber = ctx.match[4];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `inv_verify:${action}:${itemIdPrefix}:${orderIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    // Resolve full UUID from quotation number
    let orderId: string;
    try {
      const orderData = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
      orderId = orderData.id;
    } catch (_) {
      await ctx.editMessageText(`❌ Error: Could not resolve order. Please try again from the inventory verification menu.`, { parse_mode: 'Markdown', ...cancelButton() });
      return;
    }

    // Resolve short item ID prefix to full UUID
    const resolveItemsRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items`);
    const resolveItemsData = await resolveItemsRes.json();
    const resolveItems = resolveItemsData?.items ?? [];
    const targetItem = resolveItems.find((item: any) => item.id?.startsWith(itemIdPrefix));
    console.log(`[bot inv_verify callback] action=${action} itemPrefix=${itemIdPrefix} resolved=${targetItem?.id ?? 'NOT_FOUND'} items=${resolveItems.length}`);
    if (!targetItem) {
      await ctx.editMessageText('❌ Item not found. It may have been removed or already verified.', { parse_mode: 'Markdown', ...cancelButton() });
      return;
    }
    const itemId = targetItem.id;

    if (action === 'partial') {
      // For partial, we need to ask the user to enter the quantity
      const session = getSession(chatId);
      session.step = {
        action: 'awaiting_inv_verify_qty',
        data: { itemId, orderId, quotationNumber },
      };
      await ctx.editMessageText(
        `📦 *Enter Verified Quantity*\n\nItem: *${targetItem.name}*\nOrdered: ${targetItem.quantity}\nAlready verified: ${targetItem.verified_qty ?? 0}\n\nHow many units can you confirm?`,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
      return;
    }

    // For 'all' and 'not_yet', call the API directly
    const result = await postJson(`/orders/${orderId}/inventory-verify-item`, {
      item_id: itemId,
      action,
    });

    // Fetch updated items to show next question
    const itemsRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items`);
    const items = await itemsRes.json();

    // Find the next not-fully-verified item (process of elimination)
    const notVerifiedItem = items.items?.find(
      (item: any) => (item.verified_qty ?? 0) < item.quantity
    );

    if (!notVerifiedItem) {
      // All items fully verified! Offer to complete verification
      await ctx.editMessageText(
        `✅ *All Items Fully Verified!*\n\nOrder #${orderId.slice(0, 8)}\nAll items and quantities verified (${result.verification_pct}% of qty).\n\nReady to complete inventory verification and proceed to inventory arrival?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Complete Verification', `inv_v:comp:${orderId}:${orderId.slice(0, 8)}`)],
            [Markup.button.callback('⏳ Review Again', `inv_v:rev:${orderId}:${orderId.slice(0, 8)}`)],
          ]),
        }
      );
    } else {
      // Ask about the next not-fully-verified item
      const verifiedCount = items.items.filter((i: any) => (i.verified_qty ?? 0) >= i.quantity).length;
      const totalCount = items.items.length;
      const remainingQty = notVerifiedItem.quantity - (notVerifiedItem.verified_qty ?? 0);

      const progressBar = '█'.repeat(Math.round(result.verification_pct / 10)) + '░'.repeat(10 - Math.round(result.verification_pct / 10));

      let msg = `🔍 *Inventory Verification*\n\n`;
      msg += `Verified: ${result.verification_pct}% ${progressBar}\n`;
      msg += `Items: ${verifiedCount}/${totalCount} fully verified\n\n`;
      msg += `*Process of Elimination:*\n`;
      msg += `Next item: *${notVerifiedItem.name}* x${notVerifiedItem.quantity}\n`;
      msg += `Already verified: ${notVerifiedItem.verified_qty ?? 0} | Remaining: ${remainingQty}\n\n`;
      msg += `Has *${notVerifiedItem.name}* arrived? How many units can you confirm?`;

      await ctx.editMessageText(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`✅ ${notVerifiedItem.name} — All ${notVerifiedItem.quantity} Verified`, `inv_verify:all:${notVerifiedItem.id.slice(0, 8)}:${orderId.slice(0, 8)}:${quotationNumber}`)],
          [Markup.button.callback(`📦 ${notVerifiedItem.name} — Partial (Enter Qty)`, `inv_verify:partial:${notVerifiedItem.id.slice(0, 8)}:${orderId.slice(0, 8)}:${quotationNumber}`)],
          [Markup.button.callback(`⏳ ${notVerifiedItem.name} — Not Yet`, `inv_verify:not_yet:${notVerifiedItem.id.slice(0, 8)}:${orderId.slice(0, 8)}:${quotationNumber}`)],
        ]),
      });
    }
  } catch (err: any) {
    await ctx.reply(`❌ Error updating inventory verification: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// Handle "Complete Verification" button
// Supports two callback_data formats:
//   inv_v:comp:{fullUUID}:{8charPrefix} (55 bytes — from bot.ts inline buttons)
//   inv_verify:complete:{8charPrefix}:{quotationNumber} (from escalationAgent.ts)
bot.action(/^(?:inv_v:comp|inv_verify:complete):(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const rawOrderId = ctx.match[1]; // Full UUID (new format) or 8-char prefix (old format)
  const secondSegment = ctx.match[2]; // 8-char prefix or quotation number
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  // Determine if this is the new format (full UUID) or old format (8-char prefix)
  const isFullUuid = rawOrderId.includes('-');
  let orderId: string;
  let displayRef: string;

  if (isFullUuid) {
    // New format: inv_v:comp:{fullUUID}:{8charPrefix}
    orderId = rawOrderId;
    displayRef = secondSegment;
  } else {
    // Old format: inv_verify:complete:{8charPrefix}:{quotationNumber}
    // Need to look up the full UUID by quotation number
    displayRef = rawOrderId;
    try {
      const orderRes = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(secondSegment)}`);
      if (orderRes.ok) {
        const orderData = await orderRes.json();
        orderId = orderData.id;
      } else {
        throw new Error('Order not found');
      }
    } catch (_) {
      await ctx.reply(`❌ Error: Could not resolve order. Please try again from the inventory verification menu.`, { parse_mode: 'Markdown', ...cancelButton() });
      return;
    }
  }

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `inv_verify:complete:${displayRef}`,
    direction: 'incoming',
  });

  try {
    await postJson(`/orders/${orderId}/complete-inventory-verification`, {});

    await logAction({ chatId, userId, username, label: 'Inventory Verification Complete', details: `Order #${displayRef}` });
    await ctx.editMessageText(
      `✅ *Inventory Verification Complete!*\n\nOrder #${displayRef}\nAll items verified. Proceeding to inventory arrival check.\n\nClick below to start checking item arrival status:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📦 Start Arrival Check', `inv_v:rev:${orderId}:${displayRef}`)],
          [Markup.button.callback('🏠 Main Menu', 'menu:main')],
        ]),
      }
    );
  } catch (err: any) {
    await ctx.reply(`❌ Error completing inventory verification: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// Handle "Review Again" button — re-triggers the inventory agent
// Supports two callback_data formats:
//   inv_v:rev:{fullUUID}:{8charPrefix} (54 bytes — from bot.ts inline buttons)
//   inv_verify:review:{8charPrefix}:{quotationNumber} (from bot.ts inline buttons)
bot.action(/^(?:inv_v:rev|inv_verify:review):(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const rawOrderId = ctx.match[1]; // Full UUID (new format) or 8-char prefix (old format)
  const secondSegment = ctx.match[2]; // 8-char prefix or quotation number
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  // Determine if this is the new format (full UUID) or old format (8-char prefix)
  const isFullUuid = rawOrderId.includes('-');
  let orderId: string;
  let displayRef: string;

  if (isFullUuid) {
    // New format: inv_v:rev:{fullUUID}:{8charPrefix}
    orderId = rawOrderId;
    displayRef = secondSegment;
  } else {
    // Old format: inv_verify:review:{8charPrefix}:{quotationNumber}
    displayRef = rawOrderId;
    try {
      const orderRes = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(secondSegment)}`);
      if (orderRes.ok) {
        const orderData = await orderRes.json();
        orderId = orderData.id;
      } else {
        throw new Error('Order not found');
      }
    } catch (_) {
      await ctx.reply(`❌ Error: Could not resolve order. Please try again from the inventory verification menu.`, { parse_mode: 'Markdown', ...cancelButton() });
      return;
    }
  }

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `inv_verify:review:${displayRef}`,
    direction: 'incoming',
  });

  try {
    // Re-trigger the inventory agent for this order
    await postJson(`/agents/inventory`, { order_id: orderId });

    await ctx.editMessageText(
      `🔄 *Reviewing Inventory Verification...*\n\nOrder #${displayRef}\nThe inventory agent will re-check all items and quantities. Please wait for the updated status.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err: any) {
    await ctx.reply(`❌ Error re-triggering inventory agent: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// Handle "Not Yet" from escalation reminders — acknowledge and keep reminding
bot.action(/^inv_verify:pending:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2] ?? orderId.slice(0, 8);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `inv_verify:pending:${orderId}:${quotationNumber}`,
    direction: 'incoming',
  });

  await logAction({ chatId, userId, username, label: 'Inventory Verification Pending', quotationNumber, details: 'Acknowledged via escalation reminder' });

  await ctx.editMessageText(
    `⏳ *Inventory Verification Remains Pending*\n\nOrder #${quotationNumber}\nNoted. The bot will continue daily reminders until verification is completed.`,
    { parse_mode: 'Markdown', ...mainMenuKeyboard() }
  );
});

// NOTE: callback_data format uses first 8 chars of item UUID + quotation_number
// to stay within Telegram's 64-byte limit.
bot.action(/^item_inventory:(arrived|en_route|not_yet):([^:]+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const newStatus = ctx.match[1];
  const itemIdPrefix = ctx.match[2];
  const quotationNumber = ctx.match[3];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `item_inventory:${newStatus}:${itemIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    // Resolve quotation_number to full order UUID
    const orderRes = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
    if (!orderRes.ok) {
      await ctx.editMessageText(`❌ Order #${quotationNumber} not found.`, { parse_mode: 'Markdown' });
      return;
    }
    const orderData = await orderRes.json();
    const orderId = orderData.id;

    // Fetch items for this order
    const itemsRes = await fetch(`${apiBaseUrl}/orders/${orderId}/items`);
    const itemsData = await itemsRes.json();
    const items = itemsData?.items ?? [];

    const targetItem = items.find((item: any) => item.id?.startsWith(itemIdPrefix));
    if (!targetItem) {
      await ctx.editMessageText('❌ Item not found. It may have been removed.', { parse_mode: 'Markdown' });
      return;
    }
    const itemId = targetItem.id;

    // Update the item's en_route_status via API
    await patchJson(`/orders/${orderId}/items/${itemId}`, {
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
      log_type: 'user',
      created_by: username ?? `user_${userId}`,
    });

    // Refetch items after the update so process-of-elimination uses current status.
    const updatedItems = await getOrderItems(orderId);

    // Calculate inventory % based on quantity
    const totalQty = updatedItems.reduce((sum: number, i: any) => sum + (i.quantity ?? 1), 0);
    const arrivedQty = updatedItems
      .filter((i: any) => i.en_route_status === 'arrived')
      .reduce((sum: number, i: any) => sum + (i.quantity ?? 1), 0);
    const inventoryPct = totalQty > 0 ? Math.round((arrivedQty / totalQty) * 100) : 0;

    // Find the next item not yet arrived (process of elimination)
    const notArrivedItem = updatedItems.find(
      (item: any) => item.en_route_status !== 'arrived'
    );

    if (!notArrivedItem) {
      // All items arrived! Notify ready for delivery — include photo upload prompt
      await postJson(`/orders/${orderId}/production-logs`, {
        order_item_id: null,
        note: `✅ All items arrived at inventory (${inventoryPct}% of qty). Ready for delivery confirmation.`,
        log_type: 'user',
        created_by: username ?? `user_${userId}`,
      });

      await ctx.editMessageText(
        `✅ *All Items Arrived at Inventory!*\n\nOrder #${quotationNumber}\nAll items arrived (${inventoryPct}% of qty).\n\n📸 *Upload photos* of the inventory using the button below, then confirm delivery readiness:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📸 Upload Photos', `menu:upload`)],
            [Markup.button.callback('✅ Ready for Delivery', `inventory:ready:${orderId.slice(0, 8)}:${quotationNumber}`)],
            [Markup.button.callback('⏳ Still Waiting', `inventory:waiting:${orderId.slice(0, 8)}:${quotationNumber}`)],
          ]),
        }
      );
    } else {
      // Ask about the next not-arrived item (process of elimination)
      const arrivedCount = updatedItems.filter((i: any) => i.en_route_status === 'arrived').length;
      const totalCount = updatedItems.length;

      const progressBar = '█'.repeat(Math.round(inventoryPct / 10)) + '░'.repeat(10 - Math.round(inventoryPct / 10));

      let msg = `📦 *Item-Level Inventory Check*\n\n`;
      msg += `Order: #${quotationNumber}\n`;
      msg += `Inventory: ${inventoryPct}% arrived ${progressBar}\n`;
      msg += `Items: ${arrivedCount}/${totalCount} arrived\n\n`;
      msg += `*Process of Elimination:*\n`;
      msg += `Next item: *${notArrivedItem.name}* x${notArrivedItem.quantity}\n\n`;

      // Include estimated arrival date if available
      if (notArrivedItem.estimated_arrival_days) {
        const now = new Date();
        const estDate = new Date(now);
        estDate.setDate(estDate.getDate() + notArrivedItem.estimated_arrival_days);
        msg += `📅 *Estimated arrival:* ~${notArrivedItem.estimated_arrival_days} day(s) from now\n\n`;
      }

      msg += `Has *${notArrivedItem.name}* arrived at inventory?`;

      await ctx.editMessageText(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`📦 ${notArrivedItem.name} — Arrived`, `item_inventory:arrived:${notArrivedItem.id.slice(0, 8)}:${quotationNumber}`)],
          [Markup.button.callback(`🚚 ${notArrivedItem.name} — En Route`, `item_inventory:en_route:${notArrivedItem.id.slice(0, 8)}:${quotationNumber}`)],
          [Markup.button.callback(`⏳ ${notArrivedItem.name} — Not Yet`, `item_inventory:not_yet:${notArrivedItem.id.slice(0, 8)}:${quotationNumber}`)],
        ]),
      });
    }
  } catch (err: any) {
    await ctx.reply(`❌ Error updating item inventory: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// ── Item-Level Reminder Callback Handlers ─────────────────────────────
// These handle inline button clicks from item-level reminders sent by the
// reminder scheduler. They update the item status and complete/keep the reminder.
//
// Format: reminder:item_prod:{status}:{itemId}:{orderId}
//   status = finished | in_progress | pending
//
// Format: reminder:item_en_route:{status}:{itemId}:{orderId}
//   status = en_route | arrived | not_yet

async function resolveReminderItem(orderId: string, itemIdPrefix: string): Promise<any> {
  const items = await getOrderItems(orderId);
  const item = items.find((candidate: any) => String(candidate.id ?? '').startsWith(itemIdPrefix));
  if (!item) {
    throw new Error(`Item not found for prefix ${itemIdPrefix}. It may have been removed or already updated.`);
  }
  return item;
}

// Item-level production reminder: user clicked a button
bot.action(/^reminder:item_prod:(finished|in_progress|pending|ontime|delayed):([^:]*):([^:]+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const newStatus = ctx.match[1];
  const itemId = ctx.match[2];
  const orderIdPrefix = ctx.match[3];
  const quotationNumber = ctx.match[4];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `reminder:item_prod:${newStatus}:${itemId}:${orderIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    if (!itemId) {
      await ctx.editMessageText('❌ Cannot update: item ID is missing.', { parse_mode: 'Markdown' });
      return;
    }

    // Resolve full order UUID from quotation number
    let orderId: string;
    try {
      const orderData = await getOrderByQuotation(quotationNumber);
      orderId = orderData.id;
    } catch (_) {
      await ctx.editMessageText(`❌ Error: Could not resolve order from quotation #${quotationNumber}.`, { parse_mode: 'Markdown' });
      return;
    }

    const fullItem = await resolveReminderItem(orderId, itemId);

    // ── Handle On Time / Delayed (no status change) ──
    if (newStatus === 'ontime') {
      await postJson(`/orders/${orderId}/production-logs`, {
        order_item_id: fullItem.id,
        note: `🟢 Item "${fullItem.name}" production confirmed on time (from reminder)`,
        log_type: 'user',
        created_by: username ?? `user_${userId}`,
      });
      await ctx.editMessageText(
        `🟢 *On Time* — ${quotationNumber}\n\nItem *${fullItem.name}* is on track.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
      return;
    }

    if (newStatus === 'delayed') {
      setStep(chatId, { action: 'awaiting_item_prod_delay_days', itemId: fullItem.id, orderId, quotationNumber });
      await ctx.editMessageText(
        `🔴 *Delayed* — ${quotationNumber}\n\nItem: *${fullItem.name}*\n\nHow many *additional* days are needed?`,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
      return;
    }

    // Update the item's production status via API. Reminder callback data only
    // carries an 8-char item prefix; the API requires PATCH + the full UUID.
    await patchJson(`/orders/${orderId}/items/${fullItem.id}`, {
      production_status: newStatus,
    });

    // Add a production update log
    const statusLabels: Record<string, string> = {
      finished: '✅ Finished (from reminder)',
      in_progress: '🔄 In Progress (from reminder)',
      pending: '⏳ Still Pending (from reminder)',
    };
    await postJson(`/orders/${orderId}/production-logs`, {
      order_item_id: fullItem.id,
      note: `Item production status updated via reminder to: ${statusLabels[newStatus]}`,
      log_type: 'user',
      created_by: username ?? `user_${userId}`,
    });

    // ── If item just started and has no estimated days, prompt for them ──
    if (newStatus === 'in_progress' && !fullItem.estimated_production_days) {
      setStep(chatId, { action: 'awaiting_item_prod_days', itemId: fullItem.id, orderId, quotationNumber });
      await ctx.editMessageText(
        `🚀 *Production Started* — ${quotationNumber}\n\nItem: *${fullItem.name}*\n\nHow many days to finish this item?`,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
      return;
    }

    if (newStatus === 'finished') {
      // Item finished — complete the reminder (handled by PATCH endpoint)
      await logAction({ chatId, userId, username, label: 'Item Production Finished (Reminder)', details: `Order #${orderId.slice(0, 8)} item ${fullItem.id}` });
      await ctx.editMessageText(
        `✅ *Item Production Updated via Reminder*\n\nItem marked as *Finished*.\nThe reminder for this item has been completed.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
    } else if (newStatus === 'in_progress') {
      // Item in progress — keep reminder active
      await ctx.editMessageText(
        `🔄 *Item Production Updated via Reminder*\n\nItem marked as *In Progress*.\nThe reminder will continue until the item is finished.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
    } else {
      // Still pending — keep reminder active
      await ctx.editMessageText(
        `⏳ *Item Production Updated via Reminder*\n\nItem still marked as *Pending*.\nThe reminder will continue until the item is finished.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
    }
  } catch (err: any) {
    await ctx.reply(`❌ Error updating item from reminder: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// Item-level en route reminder: user clicked a button
bot.action(/^reminder:item_en_route:(en_route|arrived|not_yet):([^:]*):([^:]+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const newStatus = ctx.match[1];
  const itemId = ctx.match[2];
  const orderIdPrefix = ctx.match[3];
  const quotationNumber = ctx.match[4];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `reminder:item_en_route:${newStatus}:${itemId}:${orderIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    if (!itemId) {
      await ctx.editMessageText('❌ Cannot update: item ID is missing.', { parse_mode: 'Markdown' });
      return;
    }

    // Resolve full order UUID from quotation number
    let orderId: string;
    try {
      const orderData = await getOrderByQuotation(quotationNumber);
      orderId = orderData.id;
    } catch (_) {
      await ctx.editMessageText(`❌ Error: Could not resolve order from quotation #${quotationNumber}.`, { parse_mode: 'Markdown' });
      return;
    }

    const fullItem = await resolveReminderItem(orderId, itemId);

    // Update the item's en_route status via API. Reminder callback data only
    // carries an 8-char item prefix; the API requires PATCH + the full UUID.
    await patchJson(`/orders/${orderId}/items/${fullItem.id}`, {
      en_route_status: newStatus,
    });

    // Add a production update log
    const statusLabels: Record<string, string> = {
      en_route: '🚚 En Route (from reminder)',
      arrived: '📦 Arrived (from reminder)',
      not_yet: '⏳ Not Yet (from reminder)',
    };
    await postJson(`/orders/${orderId}/production-logs`, {
      order_item_id: fullItem.id,
      note: `Item en-route status updated via reminder to: ${statusLabels[newStatus]}`,
      log_type: 'user',
      created_by: username ?? `user_${userId}`,
    });

    if (newStatus === 'arrived') {
      // Item arrived — complete the reminder (handled by PATCH endpoint)
      await logAction({ chatId, userId, username, label: 'Item Arrived at Inventory (Reminder)', details: `Order #${orderId.slice(0, 8)} item ${fullItem.id}` });
      await ctx.editMessageText(
        `📦 *Item En Route Updated via Reminder*\n\nItem marked as *Arrived*.\nThe reminder for this item has been completed.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
    } else if (newStatus === 'en_route') {
      // Item en route — keep reminder active until arrived
      await ctx.editMessageText(
        `🚚 *Item En Route Updated via Reminder*\n\nItem marked as *En Route*.\nThe reminder will continue until the item arrives.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
    } else {
      // Not yet — keep reminder active
      await ctx.editMessageText(
        `⏳ *Item En Route Updated via Reminder*\n\nItem still marked as *Not Yet*.\nThe reminder will continue until the item is en route.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
    }
  } catch (err: any) {
    const safeMsg = err.message.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
    await ctx.reply(`❌ Error updating item from reminder: ${safeMsg}`, { parse_mode: 'MarkdownV2', ...cancelButton() });
  }
});

// Item-level inventory arrival reminder: user clicked a button
bot.action(/^reminder:item_inventory:(arrived|en_route|not_yet):([^:]*):([^:]+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const newStatus = ctx.match[1];
  const itemId = ctx.match[2];
  const orderIdPrefix = ctx.match[3];
  const quotationNumber = ctx.match[4];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `reminder:item_inventory:${newStatus}:${itemId}:${orderIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    if (!itemId) {
      await ctx.editMessageText('❌ Cannot update: item ID is missing.', { parse_mode: 'Markdown' });
      return;
    }

    // Resolve full order UUID from quotation number
    let orderId: string;
    try {
      const orderData = await getOrderByQuotation(quotationNumber);
      orderId = orderData.id;
    } catch (_) {
      await ctx.editMessageText(`❌ Error: Could not resolve order from quotation #${quotationNumber}.`, { parse_mode: 'Markdown' });
      return;
    }

    const fullItem = await resolveReminderItem(orderId, itemId);

    // Update the item's en_route_status via API. Reminder callback data only
    // carries an 8-char item prefix; the API requires PATCH + the full UUID.
    await patchJson(`/orders/${orderId}/items/${fullItem.id}`, {
      en_route_status: newStatus,
    });

    // Add a production update log
    const statusLabels: Record<string, string> = {
      arrived: '📦 Arrived at Inventory (from reminder)',
      en_route: '🚚 En Route to Inventory (from reminder)',
      not_yet: '⏳ Not Yet Arrived (from reminder)',
    };
    await postJson(`/orders/${orderId}/production-logs`, {
      order_item_id: fullItem.id,
      note: `Item inventory arrival status updated via reminder to: ${statusLabels[newStatus]}`,
      log_type: 'user',
      created_by: username ?? `user_${userId}`,
    });

    if (newStatus === 'arrived') {
      await logAction({ chatId, userId, username, label: 'Item Arrived at Inventory (Reminder)', details: `Order #${orderId.slice(0, 8)} item ${fullItem.id}` });
      await ctx.editMessageText(
        `📦 *Item Inventory Updated via Reminder*\n\nItem marked as *Arrived* at inventory.\nThe reminder for this item has been completed.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
    } else if (newStatus === 'en_route') {
      await ctx.editMessageText(
        `🚚 *Item Inventory Updated via Reminder*\n\nItem marked as *En Route*.\nThe reminder will continue until the item arrives at inventory.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
    } else {
      await ctx.editMessageText(
        `⏳ *Item Inventory Updated via Reminder*\n\nItem still marked as *Not Yet* arrived.\nThe reminder will continue until the item arrives at inventory.`,
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
    }
  } catch (err: any) {
    const safeMsg = err.message.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
    await ctx.reply(`❌ Error updating item from reminder: ${safeMsg}`, { parse_mode: 'MarkdownV2', ...cancelButton() });
  }
});

// ── Balance Payment Callback Handlers ────────────────────────────────

bot.action(/^deposit:type:(deposit|full):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const paymentType = ctx.match[1] as 'deposit' | 'full';
  const quotationNumber = ctx.match[2];
  setStep(chatId, { action: 'awaiting_deposit_amount', quotationNumber, paymentType });
  await ctx.editMessageText(
    `💳 *${paymentTypeLabel(paymentType)} for ${quotationNumber}*\n\nEnter the amount in PHP:\n\nExample: \`5000\``,
    { parse_mode: 'Markdown', ...cancelButton() }
  );
});

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

// User chose to skip proof upload and enter amount manually
bot.action(/^paybalance:skip:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const quotationNumber = ctx.match[1];
  setStep(chatId, { action: 'awaiting_paybalance_amount', quotationNumber });
  await ctx.editMessageText(
    `💰 *Balance Payment for ${quotationNumber}*\n\nEnter the amount the client paid in PHP:\n\nExample: \`15000\``,
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
// User clicked "Schedule Delivery" from delivery_pending notification
bot.action(/^delivery:schedule:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const quotationNumber = ctx.match[2];

  try {
    const order = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    await showDeliveryDatePicker(ctx, chatId, quotationNumber, order, true);
  } catch {
    await ctx.editMessageText(
      `❌ Order *${quotationNumber}* not found.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  }
});

bot.action(/^delivery:yes:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const orderIdPrefix = ctx.match[1]; // 8-char prefix — not used for API calls
  const quotationNumber = ctx.match[2];

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `delivery:yes:${orderIdPrefix}:${quotationNumber}`,
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
    await logAction({ chatId, userId, username, label: 'Delivery Confirmed', quotationNumber });
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

// User said item has NOT been delivered yet — ask for new date
bot.action(/^delivery:no:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const orderIdPrefix = ctx.match[1];
  const quotationNumber = ctx.match[2];

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `delivery:no:${orderIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    const order = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    await showDeliveryDatePicker(ctx, chatId, quotationNumber, order, true);
  } catch {
    await ctx.editMessageText(
      `❌ Order *${quotationNumber}* not found.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  }
});

// Day-before check: user confirmed ready for tomorrow
bot.action(/^delivery:ready:(.+):(.+)$/, async (ctx) => {
  const quotationNumber = ctx.match[2];
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `✅ *Ready for Tomorrow* — ${quotationNumber}\n\nGreat! Delivery is confirmed for tomorrow. Good luck! 🚚`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 Main Menu', 'menu:main')]]) }
  );
});

// Day-before check: delivery is delayed — show date picker for new schedule
bot.action(/^delivery:delayed:(.+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  const orderIdPrefix = ctx.match[1];
  const quotationNumber = ctx.match[2];

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `delivery:delayed:${orderIdPrefix}:${quotationNumber}`,
    direction: 'incoming',
  });

  try {
    const order = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
    await showDeliveryDatePicker(ctx, chatId, quotationNumber, order, true);
  } catch {
    await ctx.editMessageText(
      `❌ Order *${quotationNumber}* not found.`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  }
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
  const userId = String(ctx.from?.id ?? '');
  console.log(`[vision:type_quotation] START chat=${chatId} user=${userId} session=${session.step.action}`);

  if (session.step.action !== 'awaiting_vision_document_type') {
    console.log(`[vision:type_quotation] EXPIRED chat=${chatId} session=${session.step.action}`);
    return ctx.editMessageText(
      '⏳ *Session Expired*\n\n' +
      'The previous session was lost, possibly due to a bot restart.\n\n' +
      '📤 Please send the file again to restart the AI extraction process.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Main Menu', 'menu:main')],
        ]),
      }
    );
  }

  console.log(`[vision:type_quotation] OK chat=${chatId} session=${session.step.action}`);
  const { imageBase64, mimeType, fileName } = session.step;

  // Store data for next step (same as vision:process_yes)
  setStep(chatId, {
    action: 'awaiting_vision_extract',
    imageBase64,
    mimeType,
    fileName,
  });

  try {
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
    console.log(`[vision:type_quotation] EDITED chat=${chatId}`);
  } catch (err: any) {
    console.error(`[vision:type_quotation] EDIT-FAILED chat=${chatId} err=${err.message}`);
    throw err;
  }
});

// User said the document is a Deposit Slip/Payment — go directly to extraction
bot.action('vision:type_deposit', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);
  const userId = String(ctx.from?.id ?? '');
  console.log(`[vision:type_deposit] START chat=${chatId} user=${userId} session=${session.step.action}`);

  if (session.step.action !== 'awaiting_vision_document_type') {
    return ctx.editMessageText(
      '⏳ *Session Expired*\n\n' +
      'The previous session was lost, possibly due to a bot restart.\n\n' +
      '📤 Please send the file again to restart the AI extraction process.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Main Menu', 'menu:main')],
        ]),
      }
    );
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
    return ctx.editMessageText(
      '⏳ *Session Expired*\n\n' +
      'The previous session was lost, possibly due to a bot restart.\n\n' +
      '📤 Please send the file again to restart the AI extraction process.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Main Menu', 'menu:main')],
        ]),
      }
    );
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
  try {
    await ctx.answerCbQuery('🤖 Analyzing...');
  } catch {
    // Callback query may have expired — non-critical, continue processing
  }
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  if (session.step.action !== 'awaiting_vision_extract') {
    return ctx.editMessageText(
      '⏳ *Session Expired*\n\n' +
      'The previous session was lost, possibly due to a bot restart.\n\n' +
      '📤 Please send the file again to restart the AI extraction process.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Main Menu', 'menu:main')],
        ]),
      }
    );
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

    // Build the extracted payload — include ALL data (quotation, payment, items, raw text)
    const extractedPayload: Record<string, unknown> = {};
    if (data.quotation) {
      Object.assign(extractedPayload, data.quotation);
    }
    if (data.payment) {
      Object.assign(extractedPayload, data.payment);
    }
    if (data.inventory) {
      extractedPayload.items = data.inventory;
    }
    // Also include top-level items if present (from autoExtract)
    if (data.quotation?.items) {
      extractedPayload.items = data.quotation.items;
    }

    // Store the extracted data + image via the share endpoint
    const shareRes = await fetch(`${apiBaseUrl}/vision/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: imageBase64,
        mime_type: mimeType,
        file_name: fileName,
        extracted: extractedPayload,
        type: data.type,
        confidence: data.confidence,
        raw_text: data.raw_text || '',
      }),
    });

    if (!shareRes.ok) {
      const shareErrText = await shareRes.text().catch(() => '');
      console.error(`[vision] Share failed (HTTP ${shareRes.status}): ${shareErrText}`);
      throw new Error(`Failed to create share link (HTTP ${shareRes.status})`);
    }

    const shareData = await shareRes.json();
    const token = shareData.token;

    // Build dashboard URL
    const dashboardBase = process.env.DASHBOARD_BASE_URL ?? 'https://track.homeatelier.ph';
    const visionUrl = `${dashboardBase}/vision?token=${token}`;

    resetStep(chatId);

    // If the user has a linked order, also save the file to the order's file viewer
    // so it appears in the dashboard's file viewer across all tabs.
    if (session.linkedOrder) {
      uploadFileAndRecord({
        chatId,
        imageBase64,
        mimeType,
        fileName,
        quotationNumber: session.linkedOrder,
        uploadedBy: username ?? userId,
        fileType: 'quotation',
      }).catch((err: any) => console.error('[vision] Failed to save file to order:', err));
    }

    // Log successful extraction
    botLog({
      chatId, userId, username,
      messageType: 'vision',
      content: `extracted: ${data.type} (${data.confidence})`,
      metadata: { fileName, type: data.type, confidence: data.confidence, token },
      status: 'success',
    });

    // Build items list for display (works for quotation, inventory, or any type with items)
    const allItems = data.quotation?.items || data.inventory || [];
    const itemsList = Array.isArray(allItems) && allItems.length > 0
      ? allItems.map((item: any, i: number) =>
          `${i + 1}. ${item.product_name || 'Unknown'} — x${item.quantity || 1}`
        ).join('\n')
      : null;

    // Always show the dashboard link — regardless of type
    const typeLabel = data.type === 'payment' ? '💳 Payment' :
                      data.type === 'inventory' ? '📦 Inventory' :
                      data.type === 'quotation' ? '📋 Quotation' :
                      '📄 Document';

    const fields = [
      `${typeLabel} *Extracted Info:*`,
      data.quotation?.quotation_number ? `🔢 Number: \`${data.quotation.quotation_number}\`` : null,
      data.quotation?.client_name ? `👤 Client: ${data.quotation.client_name}` : null,
      data.quotation?.sales_agent ? `🧑‍💼 Agent: ${data.quotation.sales_agent}` : null,
      data.quotation?.total_amount ? `💰 Amount: ₱${Number(data.quotation.total_amount).toLocaleString()}` : null,
      data.payment?.amount ? `💰 Amount: ₱${Number(data.payment.amount).toLocaleString()}` : null,
      data.payment?.reference_number ? `🔖 Ref: \`${data.payment.reference_number}\`` : null,
      data.payment?.paid_by ? `👤 Paid by: ${data.payment.paid_by}` : null,
      itemsList ? `\n📦 *Items (${allItems.length}):*\n${itemsList}` : null,
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

    // If it's a payment with amount, also try deposit/balance matching
    if (data.type === 'payment' && data.payment) {
      const p = data.payment;
      const depositAmount = p.amount ? Number(p.amount) : 0;
      const paymentDate: string | undefined = p.payment_date ?? undefined;

      if (depositAmount > 0) {
        // Try to match this deposit to an order
        try {
          const matchRes = await fetch(`${apiBaseUrl}/deposits/match-and-record`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: depositAmount, deposit_paid_at: paymentDate ?? null }),
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
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];

  await ctx.editMessageText(
    `?? *Payment Before Production*

Order: *${quotationNumber}*

Is this proof for a downpayment or full payment?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('?? Downpayment', `deposit:photo_type:deposit:${orderId}:${quotationNumber}`)],
        [Markup.button.callback('? Full Payment', `deposit:photo_type:full:${orderId}:${quotationNumber}`)],
        [Markup.button.callback('? Cancel', 'action:cancel')],
      ]),
    }
  );
});

bot.action(/^deposit:photo_type:(deposit|full):([^:]+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const paymentType = ctx.match[1] as 'deposit' | 'full';
  const orderId = ctx.match[2];
  const quotationNumber = ctx.match[3];

  await ctx.editMessageText(
    `📸 *${paymentTypeLabel(paymentType)} Slip Upload*\n\n` +
    `Please upload a photo of the ${paymentTypeLabel(paymentType).toLowerCase()} proof for *${quotationNumber}*.\n\n` +
    `The bot will automatically extract the payment information and record it to the order.`,
    { parse_mode: 'Markdown' }
  );

  setStep(chatId, {
    action: 'awaiting_deposit_slip_photo',
    orderId,
    quotationNumber,
    paymentType,
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

// ── Deposit Verified → Production Workflow Start ─────────────────────
// Called from server.ts after deposit is verified on the dashboard.
// Asks the production team if they've started the production workflow.

// User clicked "Yes, started" — advance to production_pending
bot.action(/^deposit:start_production:yes:([^:]+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({ chatId, userId, username, messageType: 'callback_query', content: `deposit:start_production:yes:${orderId.slice(0, 8)}:${quotationNumber}`, direction: 'incoming' });

  await ctx.editMessageText(
    `⏳ Advancing *${quotationNumber}* to production pending...`,
    { parse_mode: 'Markdown' }
  );

  try {
    // Advance stage to production_pending via stage-updates endpoint
    await postJson('/stage-updates', {
      quotation_number: quotationNumber,
      stage: 'production_pending',
      status: 'ready',
      remarks: 'Deposit verified — production workflow started.',
      updated_by: username ?? String(ctx.from?.id),
    });

    await logAction({ chatId, userId, username, label: 'Production Workflow Started', quotationNumber, details: 'After deposit verification' });

    await ctx.editMessageText(
      `✅ *Production Workflow Started* — ${quotationNumber}\n\n` +
      `The order has been moved to production pending.\n\n` +
      `Use /produce to start production tracking when ready.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Main Menu', 'menu:main')],
        ]),
      }
    );
  } catch (err: any) {
    await ctx.editMessageText(`❌ Error: ${err.message}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
});

// User clicked "Not yet" — acknowledge and continue reminders
bot.action(/^deposit:start_production:no:([^:]+):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const orderId = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({ chatId, userId, username, messageType: 'callback_query', content: `deposit:start_production:no:${orderId.slice(0, 8)}:${quotationNumber}`, direction: 'incoming' });

  await logAction({ chatId, userId, username, label: 'Production Workflow Not Started', quotationNumber, details: 'After deposit verification' });

  await ctx.editMessageText(
    `⏳ Noted. Production workflow for *${quotationNumber}* has not started yet.\n\n` +
    `The purchasing agent will continue to send reminders. When production is ready, use /produce to start tracking.`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🏠 Main Menu', 'menu:main')],
      ]),
    }
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
    return ctx.editMessageText(
      '⏳ *Session Expired*\n\n' +
      'The previous session was lost, possibly due to a bot restart.\n\n' +
      '📤 Please send the deposit slip photo again to restart the process.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Main Menu', 'menu:main')],
        ]),
      }
    );
  }

  const { depositAmount, imageBase64, mimeType, fileName, paymentDate } = session.step;

  await ctx.editMessageText(`💳 Recording deposit of ₱${depositAmount.toLocaleString()} for *${quotationNumber}*...`, {
    parse_mode: 'Markdown',
  });

  try {
    // Record the deposit via the existing /deposits endpoint
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

    // Upload the deposit slip image to the file store so it appears in the dashboard file records
    if (imageBase64) {
      try {
        await uploadFileAndRecord({
          chatId,
          imageBase64,
          mimeType: mimeType ?? 'image/jpeg',
          fileName: fileName ?? `deposit-${quotationNumber}.jpg`,
          quotationNumber,
          fileType: 'deposit',
        });
      } catch (uploadErr) {
        // Non-blocking — deposit was already recorded; log the error but don't fail
        console.error('[deposit] File upload error (non-blocking):', uploadErr);
        botLog({
          chatId, userId, username,
          messageType: 'deposit',
          content: `deposit_file_upload_error: ${quotationNumber}`,
          metadata: { quotationNumber, errorMessage: String(uploadErr) },
          status: 'error',
        });
      }
    }

    resetStep(chatId);

    botLog({
      chatId, userId, username,
      messageType: 'deposit',
      content: `deposit_recorded: ${quotationNumber} ₱${depositAmount}`,
      metadata: { quotationNumber, amount: depositAmount },
      status: 'success',
    });
    await logAction({ chatId, userId, username, label: 'Deposit Slip Confirmed', quotationNumber, details: `₱${depositAmount.toLocaleString()}` });

    const successMsg =
      `✅ *Downpayment paid and verified*\n\n` +
      `📋 Order: *${quotationNumber}*\n` +
      `💰 Amount: ₱${depositAmount.toLocaleString()}\n` +
      `📎 Deposit slip saved to order files.\n\n` +
      `🏭 Production can proceed. Do you want to start the production workflow?`;

    await ctx.editMessageText(successMsg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Yes, start production workflow', `advance:production_pending:${quotationNumber}`)],
        [Markup.button.callback('❌ No, not yet', `advance:production_pending:no:${quotationNumber}`)],
      ]),
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
    const errorMsg = error.message ?? String(error);
    // Provide a fallback: let the user try manual entry or record via dashboard
    const dashboardBase = process.env.DASHBOARD_BASE_URL ?? 'https://track.homeatelier.ph';
    await ctx.editMessageText(
      `❌ *Failed to record deposit*\n\n` +
      `Order: *${quotationNumber}*\n` +
      `Amount: ₱${depositAmount.toLocaleString()}\n\n` +
      `Error: ${escapeMarkdown(errorMsg)}\n\n` +
      `You can try again or record this deposit manually on the dashboard:\n` +
      `🔗 ${dashboardBase}/orders/${encodeURIComponent(quotationNumber)}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Try Again', `deposit:confirm_yes:${quotationNumber}`)],
          [Markup.button.callback('🏠 Main Menu', 'menu:main')],
        ]),
      }
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
    return ctx.editMessageText(
      '⏳ *Session Expired*\n\n' +
      'The previous session was lost, possibly due to a bot restart.\n\n' +
      '📤 Please send the payment slip photo again to restart the process.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Main Menu', 'menu:main')],
        ]),
      }
    );
  }

  const { depositAmount, imageBase64, mimeType, fileName } = session.step;

  await ctx.editMessageText(`⚖️ Recording balance payment of ₱${depositAmount.toLocaleString()} for *${quotationNumber}*...`, {
    parse_mode: 'Markdown',
  });

  try {
    // Record the balance payment via /pay-balance
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

    // Upload the payment slip image to the file store so it appears in the dashboard file records
    if (imageBase64) {
      try {
        await uploadFileAndRecord({
          chatId,
          imageBase64,
          mimeType: mimeType ?? 'image/jpeg',
          fileName: fileName ?? `payment-${quotationNumber}.jpg`,
          quotationNumber,
          fileType: 'balance_proof',
        });
      } catch (uploadErr) {
        // Non-blocking — balance was already recorded
        console.error('[balance] File upload error (non-blocking):', uploadErr);
        botLog({
          chatId, userId, username,
          messageType: 'balance',
          content: `balance_file_upload_error: ${quotationNumber}`,
          metadata: { quotationNumber, errorMessage: String(uploadErr) },
          status: 'error',
        });
      }
    }

    resetStep(chatId);

    botLog({
      chatId, userId, username,
      messageType: 'balance',
      content: `balance_recorded: ${quotationNumber} ₱${depositAmount}`,
      metadata: { quotationNumber, amount: depositAmount },
      status: 'success',
    });
    await logAction({ chatId, userId, username, label: 'Balance Payment Confirmed (via slip)', quotationNumber, details: `₱${depositAmount.toLocaleString()}` });

    const successMsg =
      `✅ *Balance Payment Recorded Successfully!*\n\n` +
      `📋 Order: *${quotationNumber}*\n` +
      `💰 Amount: ₱${depositAmount.toLocaleString()}\n` +
      `📎 Payment slip saved to order files.\n` +
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
    return ctx.editMessageText(
      '⏳ *Session Expired*\n\n' +
      'The previous session was lost, possibly due to a bot restart.\n\n' +
      '📤 Please send the deposit slip photo again to restart the process.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Main Menu', 'menu:main')],
        ]),
      }
    );
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
bot.action(/^verify:deposit:(?:[0-9a-f]{8}:)?(.+)$/i, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  // match[1] strips the optional 8-char orderId prefix added by reminderScheduler/escalationAgent
  const quotationNumber = ctx.match[1];

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `verify:deposit:${quotationNumber}`,
    direction: 'incoming',
  });

  await ctx.editMessageText(
    `🔍 *Verifying Deposit* — ${quotationNumber}\n\nPlease wait...`,
    { parse_mode: 'Markdown' }
  );

  try {
    // Look up the order by quotation number to get its UUID
    const ordersRes = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
    if (!ordersRes.ok) throw new Error(`Order ${quotationNumber} not found`);
    const orderData = await ordersRes.json();
    const orderId = orderData.id;

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
      metadata: { quotationNumber, errorMessage: String(error.message ?? error) },
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
bot.action(/^verify:balance:(?:[0-9a-f]{8}:)?(.+)$/i, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  // match[1] strips the optional 8-char orderId prefix added by reminderScheduler/escalationAgent
  const quotationNumber = ctx.match[1];

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `verify:balance:${quotationNumber}`,
    direction: 'incoming',
  });

  await ctx.editMessageText(
    `🔍 *Verifying Balance Payment* — ${quotationNumber}\n\nPlease wait...`,
    { parse_mode: 'Markdown' }
  );

  try {
    // Look up the order by quotation number to get its UUID
    const ordersRes = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
    if (!ordersRes.ok) throw new Error(`Order ${quotationNumber} not found`);
    const orderData = await ordersRes.json();
    const orderId = orderData.id;

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
      metadata: { quotationNumber, errorMessage: String(error.message ?? error) },
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
      quotationNumber: session.linkedOrder,
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

/**
 * schedule_vision:extract — User wants to extract calendar schedule info from an image.
 * Calls Gemini Vision to extract structured schedule data, then asks for confirmation.
 */
bot.action('schedule_vision:extract', async (ctx) => {
  try {
    await ctx.answerCbQuery('🤖 Analyzing image...');
  } catch {
    // Non-critical
  }
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  if (session.step.action !== 'awaiting_schedule_vision_choice') {
    return ctx.editMessageText('⏳ Session expired. Please send the image again.', {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  }

  const { imageBase64, mimeType, fileName } = session.step;

  botLog({
    chatId, userId, username,
    messageType: 'vision',
    content: `schedule_vision:extract: ${fileName}`,
    metadata: { mimeType, fileName },
    direction: 'incoming',
  });

  await ctx.editMessageText(`🤖 Analyzing image with AI Vision to extract schedule info...`);

  try {
    // Call Gemini Vision to extract schedule data
    const visionResult: any = await postJson('/vision/extract', {
      image_base64: imageBase64,
      mime_type: mimeType,
      mode: 'auto',
    });

    const extractedText = visionResult?.raw_text ?? visionResult?.description ?? '';

    if (extractedText) {
      setStep(chatId, {
        action: 'awaiting_schedule_vision_extract',
        imageBase64,
        mimeType,
        fileName,
        extractedText, // Store extracted text so downstream handlers can use it
      });

      await ctx.reply(
        `📅 *Extracted Text from Image:*\n\n${escapeMarkdown(extractedText.substring(0, 1000))}\n\n` +
        `What would you like to do with this?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📅 Create Calendar Schedule', 'schedule_vision:create_schedule')],
            [Markup.button.callback('📝 Add as Calendar Note', 'schedule_vision:create_note')],
            [Markup.button.callback('❌ Cancel', 'action:cancel')],
          ]),
        }
      );
    } else {
      // No text extracted — ask user to type manually
      setStep(chatId, {
        action: 'awaiting_schedule_vision_extract',
        imageBase64,
        mimeType,
        fileName,
        extractedText: '', // Store empty so downstream handlers know extraction failed
      });

      await ctx.reply(
        `⚠️ Could not extract any text from the image.\n\n` +
        `Please type the schedule details manually (e.g., \`Meeting with client on Monday at 2pm\`)`,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
    }
  } catch (err: any) {
    console.error('[schedule_vision] Extract error:', err);
    setStep(chatId, {
      action: 'awaiting_schedule_vision_extract',
      imageBase64,
      mimeType,
      fileName,
      extractedText: '', // Store empty so downstream handlers know extraction failed
    });
    await ctx.reply(
      `⚠️ AI Vision analysis failed: ${err.message}\n\n` +
      `Please type the schedule details manually (e.g., \`Meeting with client on Monday at 2pm\`)`,
      { parse_mode: 'Markdown', ...cancelButton() }
    );
  }
});

/**
 * schedule_vision:note — User wants to add the image content as a calendar note.
 * Extracts text from the image and creates a calendar note.
 */
bot.action('schedule_vision:note', async (ctx) => {
  try {
    await ctx.answerCbQuery('📝 Adding as note...');
  } catch {
    // Non-critical
  }
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  if (session.step.action !== 'awaiting_schedule_vision_choice') {
    return ctx.editMessageText('⏳ Session expired. Please send the image again.', {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  }

  const { imageBase64, mimeType, fileName } = session.step;

  botLog({
    chatId, userId, username,
    messageType: 'vision',
    content: `schedule_vision:note: ${fileName}`,
    metadata: { mimeType, fileName },
    direction: 'incoming',
  });

  await ctx.editMessageText(`🤖 Analyzing image with AI Vision to extract text for calendar note...`);

  try {
    // Call Gemini Vision to extract text
    const visionResult: any = await postJson('/vision/extract', {
      image_base64: imageBase64,
      mime_type: mimeType,
      mode: 'auto',
    });

    const extractedText = visionResult?.raw_text ?? visionResult?.description ?? '';

    if (extractedText) {
      setStep(chatId, {
        action: 'awaiting_schedule_vision_notes',
        imageBase64,
        mimeType,
        fileName,
        extractedText,
      });

      await ctx.reply(
        `📝 *Extracted Text:*\n\n${escapeMarkdown(extractedText.substring(0, 1000))}\n\n` +
        `Please provide a *title* for this calendar note, or type \`cancel\` to skip.`,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
    } else {
      // No text extracted — ask user to type manually
      setStep(chatId, {
        action: 'awaiting_schedule_vision_notes',
        imageBase64,
        mimeType,
        fileName,
        extractedText: '',
      });

      await ctx.reply(
        `⚠️ Could not extract any text from the image.\n\n` +
        `Please type the note content manually, or type \`cancel\` to skip.`,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
    }
  } catch (err: any) {
    console.error('[schedule_vision] Note error:', err);
    setStep(chatId, {
      action: 'awaiting_schedule_vision_notes',
      imageBase64,
      mimeType,
      fileName,
      extractedText: '',
    });
    await ctx.reply(
      `⚠️ AI Vision analysis failed: ${err.message}\n\n` +
      `Please type the note content manually, or type \`cancel\` to skip.`,
      { parse_mode: 'Markdown', ...cancelButton() }
    );
  }
});

/**
 * schedule_vision:create_schedule — User confirmed extracted text should become a schedule.
 * Transitions to the schedule text parsing flow with the extracted text.
 */
bot.action('schedule_vision:create_schedule', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);
  await ctx.answerCbQuery('📅 Creating schedule...');

  if (session.step.action !== 'awaiting_schedule_vision_extract') {
    return ctx.editMessageText('⏳ Session expired. Please send the image again.', {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  }

  const { imageBase64, mimeType, fileName, extractedText } = session.step;

  // Pass the extracted text from vision as the schedule text
  const scheduleText = extractedText || 'Schedule from image';

  setStep(chatId, {
    action: 'awaiting_schedule_date',
    scheduleText,
  });

  await ctx.editMessageText(
    `📅 *Create Calendar Schedule*\n\n` +
    `Extracted text: ${escapeMarkdown(scheduleText.substring(0, 200))}\n\n` +
    `Please type the *date* for this schedule (e.g., \`today\`, \`tomorrow\`, \`2026-06-15\`, \`Monday\`)\n` +
    `Or type the full schedule details to re-parse.`,
    { parse_mode: 'Markdown', ...cancelButton() }
  );
});

/**
 * schedule_vision:create_note — User confirmed extracted text should become a calendar note.
 * Creates the note directly with the extracted text.
 */
bot.action('schedule_vision:create_note', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);
  await ctx.answerCbQuery('📝 Creating note...');

  if (session.step.action !== 'awaiting_schedule_vision_extract') {
    return ctx.editMessageText('⏳ Session expired. Please send the image again.', {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  }

  // Pass the extracted text from vision as the note content
  const extractedText = session.step.extractedText || '';

  setStep(chatId, {
    action: 'awaiting_schedule_vision_notes',
    imageBase64: session.step.imageBase64,
    mimeType: session.step.mimeType,
    fileName: session.step.fileName,
    extractedText,
  });

  await ctx.editMessageText(
    `📝 *Add Calendar Note*\n\n` +
    `Extracted text: ${escapeMarkdown(extractedText.substring(0, 200))}\n\n` +
    `Please type the *title* for this note, or type \`cancel\` to skip.`,
    { parse_mode: 'Markdown', ...cancelButton() }
  );
});

// Retry extraction after a vision API failure
bot.action('vision:retry_extract', async (ctx) => {
  try {
    await ctx.answerCbQuery('🤖 Retrying...');
  } catch {
    // Callback query may have expired — non-critical, continue processing
  }
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

    // Build the extracted payload — include ALL data (quotation, payment, items, raw text)
    const extractedPayload: Record<string, unknown> = {};
    if (data.quotation) {
      Object.assign(extractedPayload, data.quotation);
    }
    if (data.payment) {
      Object.assign(extractedPayload, data.payment);
    }
    if (data.inventory) {
      extractedPayload.items = data.inventory;
    }
    // Also include top-level items if present (from autoExtract)
    if (data.quotation?.items) {
      extractedPayload.items = data.quotation.items;
    }

    // Store the extracted data + image via the share endpoint
    const shareRes = await fetch(`${apiBaseUrl}/vision/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: imageBase64,
        mime_type: mimeType,
        file_name: fileName,
        extracted: extractedPayload,
        type: data.type,
        confidence: data.confidence,
        raw_text: data.raw_text || '',
      }),
    });

    if (!shareRes.ok) {
      const shareErrText = await shareRes.text().catch(() => '');
      console.error(`[vision] Retry share failed (HTTP ${shareRes.status}): ${shareErrText}`);
      throw new Error(`Failed to create share link (HTTP ${shareRes.status})`);
    }

    const shareData = await shareRes.json();
    const token = shareData.token;

    // Build dashboard URL
    const dashboardBase = process.env.DASHBOARD_BASE_URL ?? 'https://track.homeatelier.ph';
    const visionUrl = `${dashboardBase}/vision?token=${token}`;

    resetStep(chatId);

    // If the user has a linked order, also save the file to the order's file viewer
    if (session.linkedOrder) {
      uploadFileAndRecord({
        chatId,
        imageBase64,
        mimeType,
        fileName,
        quotationNumber: session.linkedOrder,
        uploadedBy: username ?? userId,
        fileType: 'quotation',
      }).catch((err: any) => console.error('[vision:retry] Failed to save file to order:', err));
    }

    // Log successful retry extraction
    botLog({
      chatId, userId, username,
      messageType: 'vision',
      content: `retry_extracted: ${data.type} (${data.confidence})`,
      metadata: { fileName, type: data.type, confidence: data.confidence, token, retry: true },
      status: 'success',
    });

    // Build items list for display (works for quotation, inventory, or any type with items)
    const allItems = data.quotation?.items || data.inventory || [];
    const itemsList = Array.isArray(allItems) && allItems.length > 0
      ? allItems.map((item: any, i: number) =>
          `${i + 1}. ${item.product_name || 'Unknown'} — x${item.quantity || 1}`
        ).join('\n')
      : null;

    // Always show the dashboard link — regardless of type
    const typeLabel = data.type === 'payment' ? '💳 Payment' :
                      data.type === 'inventory' ? '📦 Inventory' :
                      data.type === 'quotation' ? '📋 Quotation' :
                      '📄 Document';

    const fields = [
      `${typeLabel} *Extracted Info:*`,
      data.quotation?.quotation_number ? `🔢 Number: \`${data.quotation.quotation_number}\`` : null,
      data.quotation?.client_name ? `👤 Client: ${data.quotation.client_name}` : null,
      data.quotation?.sales_agent ? `🧑‍💼 Agent: ${data.quotation.sales_agent}` : null,
      data.quotation?.total_amount ? `💰 Amount: ₱${Number(data.quotation.total_amount).toLocaleString()}` : null,
      data.payment?.amount ? `💰 Amount: ₱${Number(data.payment.amount).toLocaleString()}` : null,
      data.payment?.reference_number ? `🔖 Ref: \`${data.payment.reference_number}\`` : null,
      data.payment?.paid_by ? `👤 Paid by: ${data.payment.paid_by}` : null,
      itemsList ? `\n📦 *Items (${allItems.length}):*\n${itemsList}` : null,
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
  console.log(`[photo-handler] START chat=${chatId} user=${userId} session=${session.step.action} owner=${session.ownerUserId}`);

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
    console.log(`[photo-handler] DOWNLOADED chat=${chatId} file=${fileName} size=${fileBuffer.length} session=${session.step.action}`);

    console.log(`[photo-handler] CHECK-FLOWS chat=${chatId} session=${session.step.action}`);

    // ── Auto-detect deposit slip in collection group ─────────────────────
    // If the photo is sent to the collection group chat and the session is
    // idle (no active flow), automatically treat it as a deposit slip and
    // run the AI extraction directly — no button clicks required.
    const collectionGroupChatId = process.env.COLLECTION_GROUP_CHAT_ID || process.env.COLLECTION_GROUP_ID;
    if (
      collectionGroupChatId &&
      chatId === collectionGroupChatId &&
      (session.step.action === 'idle' || !session.step.action)
    ) {
      console.log(`[photo-handler] AUTO-DETECT deposit slip in collection group chat=${chatId}`);

      const isProcessable = /^image\//.test(mimeType) || mimeType === 'application/pdf';
      if (isProcessable) {
        await ctx.reply(`🔍 Scanning deposit slip with AI Vision...`);

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
            // Try to match this deposit to an order
            try {
              const matchRes = await fetch(`${apiBaseUrl}/deposits/match-and-record`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: depositAmount, deposit_paid_at: paymentDate ?? null }),
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

                await ctx.reply(
                  `💳 *Deposit Detected!*\n\n` +
                  `💰 Amount: ₱${depositAmount.toLocaleString()}\n` +
                  (paymentDate ? `📅 Date: ${paymentDate}\n` : '') +
                  `\n🔍 *Deposit Matching*\n\n` +
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
                return;
              }
            } catch (matchErr: any) {
              console.error('[photo-handler] Deposit match error:', matchErr);
            }

            // No deposit match — try balance matching
            try {
              const balanceRes = await fetch(`${apiBaseUrl}/deposits/match-balance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: depositAmount }),
              });
              const balanceData = await balanceRes.json();

              if (balanceData.ok && balanceData.matched && balanceData.candidates && balanceData.candidates.length > 0) {
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
                  `💳 *Deposit Detected!*\n\n` +
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
              console.error('[photo-handler] Balance match error:', balanceErr);
            }

            // No match found — ask user to enter client name
            setStep(chatId, {
              action: 'awaiting_deposit_client_name',
              imageBase64,
              mimeType,
              fileName,
              depositAmount,
              paymentDate,
            });

            await ctx.reply(
              `💳 *Deposit Detected!*\n\n` +
              `💰 Amount: ₱${depositAmount.toLocaleString()}\n` +
              (paymentDate ? `📅 Date: ${paymentDate}\n` : '') +
              `\n🔍 *Payment Matching*\n\n` +
              `This amount (₱${depositAmount.toLocaleString()}) does not closely match any order.\n\n` +
              `Please type the *client name* this deposit is for, or type *cancel* to skip.`,
              { parse_mode: 'Markdown', ...cancelButton() }
            );
          } else {
            // Vision couldn't extract amount — ask user to enter manually
            setStep(chatId, {
              action: 'awaiting_deposit_client_name',
              imageBase64,
              mimeType,
              fileName,
              depositAmount: 0,
            });
            await ctx.reply(
              `⚠️ Could not automatically detect the deposit amount from the image.\n\n` +
              `💰 Please enter the deposit amount in PHP manually:\n\nExample: \`15000\``,
              { parse_mode: 'Markdown', ...cancelButton() }
            );
          }
        } catch (err: any) {
          console.error('[photo-handler] Vision extraction error:', err);
          // Vision API failed — fall back to manual entry
          setStep(chatId, {
            action: 'awaiting_deposit_client_name',
            imageBase64,
            mimeType,
            fileName,
            depositAmount: 0,
          });
          await ctx.reply(
            `⚠️ Could not process the image: ${err.message}\n\n` +
            `💰 Please enter the deposit amount in PHP manually:\n\nExample: \`15000\``,
            { parse_mode: 'Markdown', ...cancelButton() }
          );
        }
      } else {
        // Non-image file sent to collection group
        await ctx.reply(
          `❌ Please send a **photo** of the deposit slip (JPEG/PNG).`,
          { parse_mode: 'Markdown', ...cancelButton() }
        );
      }
      return;
    }

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

            // Save the proof of payment image to the order's files
            uploadFileAndRecord({
              chatId,
              imageBase64,
              mimeType,
              fileName: `balance_proof_${quotationNumber}_${Date.now()}.${mimeType.includes('pdf') ? 'pdf' : 'jpg'}`,
              quotationNumber,
              telegramMessageId: messageId,
              uploadedBy: from,
              fileType: 'balance_proof',
            }).catch((err: any) => console.error('[balance-proof] Failed to save image:', err));

            resetStep(chatId);

            let msg;
            if (payResult.is_fully_paid) {
              msg = `✅ *Balance Fully Paid!*\n\n`;
              msg += `Order: *${quotationNumber}*\n`;
              msg += `Amount: ₱${Number(paymentAmount).toLocaleString()}`;
              if (paymentDate) {
                msg += `\nDate: ${paymentDate}`;
              }
              if (payResult.overpayment > 0) {
                msg += `\n⚠️ Overpayment of ₱${Number(payResult.overpayment).toLocaleString()}`;
              }
              msg += `\n\n🚚 You can now schedule delivery.`;
            } else {
              msg = `✅ *Partial Balance Recorded!*\n\n`;
              msg += `Order: *${quotationNumber}*\n`;
              msg += `This payment: ₱${Number(paymentAmount).toLocaleString()}\n`;
              msg += `Total paid: ₱${Number(payResult.balance_total).toLocaleString()} / ₱${Number(payResult.expected_balance).toLocaleString()}\n`;
              msg += `Remaining: ₱${Number(payResult.remaining_balance).toLocaleString()}\n\n`;
              msg += `💡 The client still has a remaining balance. Record another payment when they pay more.`;
            }

            await ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
          } else {
            // Vision couldn't extract amount — preserve image, ask user to enter manually
            const safeFileName = `balance_proof_${quotationNumber}_${Date.now()}.${mimeType.includes('pdf') ? 'pdf' : 'jpg'}`;
            setStep(chatId, { action: 'awaiting_paybalance_amount', quotationNumber, imageBase64: imageBase64 ?? undefined, mimeType, fileName: safeFileName });
            await ctx.reply(
              `⚠️ Could not automatically detect the payment amount from the image.\n\n` +
              `💰 Please enter the balance amount in PHP manually:\n\nExample: \`15000\``,
              { parse_mode: 'Markdown', ...cancelButton() }
            );
          }
        } catch (err: any) {
          // Vision API failed — preserve image, fall back to manual entry
          const safeFileName = `balance_proof_${quotationNumber}_${Date.now()}.${mimeType.includes('pdf') ? 'pdf' : 'jpg'}`;
          setStep(chatId, { action: 'awaiting_paybalance_amount', quotationNumber, imageBase64: imageBase64 ?? undefined, mimeType, fileName: safeFileName });
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
      const { orderId, quotationNumber, paymentType } = session.step;

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
            if (paymentType === 'full') {
              await recordPreProductionPayment({
                quotationNumber,
                amount: Number(depositAmount),
                paymentType: 'full',
                paymentDate,
                updatedBy: from,
              });

              uploadFileAndRecord({
                chatId,
                imageBase64,
                mimeType,
                fileName: `full_payment_${quotationNumber}_${Date.now()}.${mimeType.includes('pdf') ? 'pdf' : 'jpg'}`,
                quotationNumber,
                telegramMessageId: messageId,
                uploadedBy: from,
                fileType: 'full_payment',
              }).catch((err: any) => console.error('[full-payment-slip] Failed to save image:', err));

              resetStep(chatId);
              let msg = `✅ *Full Payment Recorded!*\n\n`;
              msg += `Order: *${quotationNumber}*\n`;
              msg += `Amount: PHP ${Number(depositAmount).toLocaleString()}`;
              if (paymentDate) msg += `\nDate: ${paymentDate}`;
              msg += `\n\nThe full payment was recorded before production and is awaiting verification.`;
              await ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
              return;
            }

            // Try to match this deposit to the specific order
            try {
              const matchRes = await fetch(`${apiBaseUrl}/deposits/match-and-record`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: depositAmount, quotation_number: quotationNumber, deposit_paid_at: paymentDate ?? null }),
              });
              const matchData = await matchRes.json();

              if (matchData.ok && matchData.matched) {
                // Deposit recorded successfully — save the deposit slip image to the order's files
                uploadFileAndRecord({
                  chatId,
                  imageBase64,
                  mimeType,
                  fileName: `deposit_slip_${quotationNumber}_${Date.now()}.${mimeType.includes('pdf') ? 'pdf' : 'jpg'}`,
                  quotationNumber,
                  telegramMessageId: messageId,
                  uploadedBy: from,
                  fileType: 'deposit',
                }).catch((err: any) => console.error('[deposit-slip] Failed to save image:', err));

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
            setStep(chatId, { action: 'awaiting_deposit_amount', quotationNumber, paymentType });
            await ctx.reply(
              `⚠️ Could not automatically detect the ${paymentTypeLabel(paymentType).toLowerCase()} amount from the image.\n\n` +
              `💰 Please enter the amount in PHP manually:\n\nExample: \`15000\``,
              { parse_mode: 'Markdown', ...cancelButton() }
            );
          }
        } catch (err: any) {
          // Vision API failed — fall back to manual entry
          setStep(chatId, { action: 'awaiting_deposit_amount', quotationNumber, paymentType });
          await ctx.reply(
            `⚠️ Could not process the image: ${err.message}\n\n` +
            `💰 Please enter the amount in PHP manually:\n\nExample: \`15000\``,
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

    // If user explicitly chose "Upload File", bypass vision workflow and upload directly
    if (session.step.action === 'awaiting_file_upload') {
      const quotationNumber = session.linkedOrder;
      await ctx.reply(`📤 Uploading file...`);

      try {
        const uploadResult = await uploadFileAndRecord({
          chatId,
          imageBase64,
          mimeType,
          fileName,
          quotationNumber,
          telegramMessageId: messageId,
          uploadedBy: from,
        });

        botLog({
          chatId, userId, username: from,
          messageType: 'upload',
          content: fileName,
          metadata: {
            fileId, mimeType, messageId,
            quotationNumber,
          },
          status: 'success',
        });

        resetStep(chatId);
        await ctx.reply(
          `✅ *File uploaded!*
📄 ${escapeMarkdown(fileName)}` +
            (quotationNumber ? `
📦 Linked to order: ${escapeMarkdown(quotationNumber)}` : ''),
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (error: any) {
        console.error('Upload error:', error);
        botLog({
          chatId, userId, username: from,
          messageType: 'upload',
          content: fileName,
          metadata: {
            fileId, mimeType, messageId,
            quotationNumber,
            errorMessage: String(error.message ?? error),
          },
          status: 'error',
        });
        setStep(chatId, {
          action: 'awaiting_upload_retry',
          imageBase64,
          mimeType,
          fileName,
          quotationNumber,
          telegramMessageId: messageId,
          uploadedBy: from,
        });
        await ctx.reply(`❌ Upload failed: ${String(error.message ?? error)}

Tap Retry upload to try again.`, {
          ...retryUploadKeyboard(),
        });
      }
      return;
    }

    // ── Schedule group: vision for calendar entries ──────────────────
    // When a photo is sent to the schedule group, offer to extract info
    // for the calendar (as a schedule entry) or add as notes.
    const SCHEDULE_CHAT_ID = process.env.SCHEDULE_GROUP_CHAT_ID ?? process.env.SCHEDULE_GROUP_ID ?? '';
    const isScheduleChat = SCHEDULE_CHAT_ID && chatId === SCHEDULE_CHAT_ID;

    if (isScheduleChat && (session.step.action === 'idle' || !session.step.action)) {
      const isProcessable = /^image\//.test(mimeType) || mimeType === 'application/pdf';
      if (isProcessable) {
        setStep(chatId, {
          action: 'awaiting_schedule_vision_choice',
          imageBase64: imageBase64!,
          mimeType,
          fileName,
        });

        await ctx.reply(
          `📎 *Image received:* ${escapeMarkdown(fileName)}

What would you like to do with this?`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📅 Extract for Calendar Schedule', 'schedule_vision:extract')],
              [Markup.button.callback('📝 Add as Calendar Note', 'schedule_vision:note')],
              [Markup.button.callback('❌ Cancel', 'action:cancel')],
            ]),
          }
        );
      } else {
        await ctx.reply(
          `❌ Please send a **photo** or **PDF** for schedule-related content.`,
          { parse_mode: 'Markdown' }
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
    console.error(`[photo-handler] ERROR chat=${chatId} file=${fileName} error=${error.message}`);
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
    '/unlink — Clear linked order for uploads\n' +
    '/brain — Query the CentralBrain AI knowledge base\n' +
    '/ask — Ask anything about orders, production, delivery, payments\n\n' +
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
    'https://track.homeatelier.ph\n\n' +
    '*Group Setup Tips:*\n' +
    '• Disable *privacy mode* in @BotFather so the bot can see messages and files in groups.\n' +
    '• Only one user can interact at a time per group. If busy, wait for the current user to finish or tap Cancel.\n' +
    '• Only group admins can DM the bot privately.\n\n' +
    '*Available Commands:*\n' +
    '/start — Show main menu\n' +
    '/commands — List all features\n' +
    '/help — Show this detailed guide\n' +
    '/brain — Query the CentralBrain AI knowledge base\n' +
    '/ask — Ask anything about orders, production, delivery, payments\n' +
    '/bug — Report a bug to the development team\n' +
    '/unlink — Clear linked order for uploads';

  await safeReply(ctx, text, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard().reply_markup });
});

// ── CentralBrain /brain Command ────────────────────────────────────────
// Queries the persistent lesson database for relevant knowledge.
// Usage: /brain <question> — e.g. "/brain how to handle delivery exception"
bot.command('brain', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  resetStep(chatId);
  botLog({ chatId, userId, username, messageType: 'command', content: '/brain', direction: 'incoming' });

  // Check if there's text after /brain
  const text = ctx.message?.text?.trim() ?? '';
  const query = text.replace(/^\/brain(@\w+)?\s*/, '').trim();

  if (!query) {
    await safeReply(
      ctx,
      '🧠 *CentralBrain Knowledge Base*\n\n' +
      'Search the AI learning layer for lessons, fixes, and best practices.\n\n' +
      'Usage:\n' +
      '`/brain <your question>` — e.g.\n' +
      '• `/brain how to handle delivery exception`\n' +
      '• `/brain production tracking issues`\n' +
      '• `/brain telegram 409 error`\n' +
      '• `/brain docker memory`\n\n' +
      '_Results include confidence level, related files, and source._',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await safeReply(ctx, '🔍 *Searching CentralBrain…*', { parse_mode: 'Markdown' });

  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(`${apiBaseUrl}/brain/search?q=${encoded}&limit=5`);
    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[bot] /brain search failed (${res.status}): ${errBody}`);
      await safeReply(ctx, '❌ Brain search failed. Try again later.');
      return;
    }

    const data = await res.json() as {
      lessons: Array<{
        title: string;
        summary: string | null;
        content: string;
        tags: string[];
        confidence: string;
        source: string;
        source_ref: string | null;
        related_files: string[];
        similarity?: number;
        created_at: string;
      }>;
      total: number;
      search_time_ms: number;
    };

    if (!data.lessons || data.lessons.length === 0) {
      await safeReply(
        ctx,
        `🤷 *No lessons found* for "${query}".\n\n` +
        `Try different keywords or check the dashboard Brain tab to add knowledge.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Format results
    let response = `🧠 *CentralBrain Results* (${data.total} found, ${data.search_time_ms}ms)\n\n`;
    response += `Query: _${query}_\n\n`;

    for (let i = 0; i < Math.min(data.lessons.length, 5); i++) {
      const l = data.lessons[i];
      const sim = l.similarity != null ? ` (${Math.round(l.similarity * 100)}% match)` : '';
      const confIcon = l.confidence === 'high' ? '🟢' : l.confidence === 'medium' ? '🟡' : '🔴';
      const tags = l.tags?.length > 0 ? l.tags.slice(0, 3).join(', ') : '';
      const files = l.related_files?.slice(0, 2).join(', ') || '—';

      response += `${i + 1}. ${confIcon} *${l.title}*${sim}\n`;
      if (l.summary) response += `   📝 ${l.summary}\n`;
      response += `   🏷️ ${tags || '—'}\n`;
      response += `   📁 ${files}\n\n`;
    }

    // Truncate if too long (Telegram max 4096)
    if (response.length > 3900) {
      response = response.substring(0, 3850) + '\n\n_…truncated. Be more specific._';
    }

    await safeReply(ctx, response, { parse_mode: 'Markdown' });
  } catch (err: any) {
    console.error('[bot] /brain error:', err);
    await safeReply(ctx, '❌ Brain search failed. Is the API server running?');
  }
});

// ── OpenClaw /ask Command — Universal Order Intelligence ───────────────
// Ask anything about orders, production, delivery, payments, clients.
// Routes through OpenClaw which queries live data + CentralBrain + AI.
// Usage: /ask what's the status of QTN-2026-001
//        /ask when will discovery chairs be delivered
//        /ask show me delayed orders
bot.command('ask', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  resetStep(chatId);
  botLog({ chatId, userId, username, messageType: 'command', content: '/ask', direction: 'incoming' });

  const text = ctx.message?.text?.trim() ?? '';
  const query = text.replace(/^\/ask(@\w+)?\s*/, '').trim();

  if (!query) {
    await safeReply(
      ctx,
      '🤖 *OpenClaw Order Intelligence*\n\n' +
      'Ask me anything about your orders:\n\n' +
      '• `/ask status of QTN-2026-001` — Full order status with ETA\n' +
      '• `/ask what\'s up with discovery chairs` — Search by order name\n' +
      '• `/ask when will QTN-2026-005 arrive` — Delivery ETA\n' +
      '• `/ask show delayed orders` — List overdue orders\n' +
      '• `/ask how many in production` — Production pipeline\n' +
      '• `/ask all about Juan dela Cruz` — Client info + orders\n\n' +
      '_I\'ll search live data and the CentralBrain knowledge base._',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await safeReply(ctx, '🔍 *Thinking…*', { parse_mode: 'Markdown' });

  try {
    const res = await fetch(`${apiBaseUrl}/openclaw/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: query,
        username: username ?? null,
        chat_type: ctx.chat?.type ?? 'private',
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[bot] /ask failed (${res.status}): ${errBody}`);
      await safeReply(ctx, '❌ Query failed. Try again later.');
      return;
    }

    const result = await res.json() as {
      reply: string;
      formatted_reply?: string;
      order_id?: string;
      quotation_number?: string;
      suggested_actions?: Array<{ label: string; callback_data: string }>;
      confidence: string;
      data_source: string;
    };

    let keyboard;
    if (result.suggested_actions && result.suggested_actions.length > 0) {
      keyboard = Markup.inlineKeyboard(
        result.suggested_actions.map((a) => [Markup.button.callback(a.label, a.callback_data)])
      );
    }

    await safeReply(ctx, result.formatted_reply ?? result.reply, {
      parse_mode: 'HTML',
      ...(keyboard ? keyboard : {}),
    });
  } catch (err: any) {
    console.error('[bot] /ask error:', err);
    await safeReply(ctx, '❌ OpenClaw query failed. Is the API server running?');
  }
});

// ── Bug Report Command ─────────────────────────────────────────────────
bot.command('bug', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  resetStep(chatId);
  botLog({
    chatId, userId, username,
    messageType: 'command',
    content: '/bug',
    direction: 'incoming',
  });

  // Check if there's text after /bug
  const text = ctx.message?.text?.trim() ?? '';
  const args = text.replace(/^\/bug(@\w+)?\s*/, '').trim();

  if (args) {
    // Format: /bug <title> | <description> | <order_ref>
    const parts = args.split('|').map((s) => s.trim());
    const title = parts[0] || 'Bug Report';
    const description = parts[1] || args;
    const orderReference = parts[2] || null;

    try {
      await postJson('/bug-reports', {
        title,
        description,
        source: 'telegram',
        reporter_name: username ?? null,
        reporter_contact: userId,
        order_reference: orderReference,
      });
      await safeReply(
        ctx,
        `✅ *Bug Report Submitted*\n\nTitle: ${title}\n\nThank you! The development team has been notified.`,
        { parse_mode: 'Markdown' }
      );
    } catch (err: any) {
      console.error('[bot] Failed to submit bug report:', err);
      await safeReply(ctx, '❌ Failed to submit bug report. Please try again later.');
    }
  } else {
    // No args — start interactive flow
    setStep(chatId, { action: 'awaiting_bug_title' });
    await safeReply(
      ctx,
      '🐛 *Report a Bug*\n\nPlease enter the *title* of the bug:',
      { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
    );
  }
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

// ── Status Command — Quick order status with Gantt intelligence ────────
bot.command('status', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;
  resetStep(chatId);
  botLog({ chatId, userId, username, messageType: 'command', content: '/status', direction: 'incoming' });

  const text = ctx.message?.text?.trim() ?? '';
  const args = text.replace(/^\/status(@\w+)?\s*/, '').trim();

  if (!args) {
    await ctx.reply(
      '📋 *Check Order Status*\n\nUsage: `/status QTN-2026-001`\n\nOr just type the quotation number in any group chat.',
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
    return;
  }

  // Normalize quotation number
  const qtn = args.replace(/\s+/g, '-').replace(/^qtn/i, 'QTN').replace(/(\d{4})-(\d+)/, '$1-$2');

  try {
    const res = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(qtn)}`);
    if (!res.ok) {
      await ctx.reply(`❌ Order *${qtn}* not found.`, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
      return;
    }
    const order = await res.json();

    let clientInfo = '';
    const client = order.client_name ? await lookupClient(order.client_name).catch(() => null) : null;
    if (client) {
      const info = formatClientInfo(client);
      if (info) clientInfo = `🚚 *Delivery Info:*\n${info}`;
    } else if (order.delivery_address) {
      clientInfo = `🚚 *Delivery Info:*\n📍 ${escapeMarkdown(order.delivery_address)}`;
      if (order.contact_number) clientInfo += `\n📞 ${escapeMarkdown(order.contact_number)}`;
      if (order.authorized_receiver_name) clientInfo += `\n👤 *Auth. Receiver:* ${escapeMarkdown(order.authorized_receiver_name)}`;
    }

    const summary = buildGanttStatusSummary(order, clientInfo);
    await safeReply(ctx, summary.text, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard().reply_markup });
  } catch (err: any) {
    await ctx.reply(`❌ Error: ${escapeMarkdown(err.message)}`, { parse_mode: 'Markdown', ...cancelButton() });
  }
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
  // track.homeatelier.ph proxies /api/telegram-webhook -> http://api:8080/telegram-webhook
  // The API server then forwards to http://telegram-bot:WEBHOOK_PORT/
  const publicWebhookUrl =
    process.env.PUBLIC_WEBHOOK_BASE_URL ??
    process.env.DASHBOARD_BASE_URL ??
    'https://track.homeatelier.ph';
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
        void logSystemBotError(err, 'webhook_parse', {
          bodyPreview: body.slice(0, 500),
          contentLength: req.headers['content-length'],
        });
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
      await logSystemBotError(err, 'launch', { attempt, maxRetries });
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

launchWithRetry().catch(async (err) => {
  console.error('[bot] Failed to launch after all retries:', err);
  await logSystemBotError(err, 'launch_final');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[bot] Unhandled promise rejection:', reason);
  void logSystemBotError(reason, 'unhandled_rejection');
});

process.on('uncaughtException', async (err) => {
  console.error('[bot] Uncaught exception:', err);
  await logSystemBotError(err, 'uncaught_exception');
  process.exit(1);
});

process.once('SIGINT', () => {
  try {
    bot.stop('SIGINT');
  } catch {
    // Bot may already be stopped — ignore
  }
});
process.once('SIGTERM', () => {
  try {
    bot.stop('SIGTERM');
  } catch {
    // Bot may already be stopped — ignore
  }
});
