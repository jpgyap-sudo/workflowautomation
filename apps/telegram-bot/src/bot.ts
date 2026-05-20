import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import { uploadToDrive } from './services/googleDrive.js';
import { AsyncLocalStorage } from 'async_hooks';

const token = process.env.TELEGRAM_BOT_TOKEN;
const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:8080';

if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const bot = new Telegraf(token);

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
  | { action: 'awaiting_delivery_day_check'; orderId: string; quotationNumber: string };

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
  const fileBuffer = Buffer.from(params.imageBase64, 'base64');
  const driveResult = await uploadToDrive(fileBuffer, params.fileName, params.mimeType);

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
  return driveResult;
}

// ── Inline Keyboard Builders ───────────────────────────────────────────

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📋 Check Order Status', 'menu:status')],
    [Markup.button.callback('🛒 Purchasing / Production', 'menu:produce')],
    [Markup.button.callback('💳 Record Deposit', 'menu:deposit')],
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
      setStep(chatId, { action: 'awaiting_order_number_for_status' });
      await ctx.editMessageText(
        '📋 *Check Order Status*\n\nPlease enter the quotation number:\n\nExample: `QTN-2026-001`',
        { parse_mode: 'Markdown', ...cancelButton() }
      ).catch(() =>
        ctx.reply(
          '📋 *Check Order Status*\n\nPlease enter the quotation number:\n\nExample: `QTN-2026-001`',
          { parse_mode: 'Markdown', ...cancelButton() }
        )
      );
      break;

    case 'produce':
      setStep(chatId, { action: 'awaiting_order_number_for_produce', status: 'yes' });
      await ctx.editMessageText(
        '🛒 *Purchasing / Production*\n\nPlease enter the quotation number:\n\nExample: `QTN-2026-001`',
        { parse_mode: 'Markdown', ...cancelButton() }
      ).catch(() =>
        ctx.reply(
          '🛒 *Purchasing / Production*\n\nPlease enter the quotation number:\n\nExample: `QTN-2026-001`',
          { parse_mode: 'Markdown', ...cancelButton() }
        )
      );
      break;

    case 'deposit':
      setStep(chatId, { action: 'awaiting_order_number_for_deposit' });
      await ctx.editMessageText(
        '💳 *Record Deposit*\n\nPlease enter the quotation number:\n\nExample: `QTN-2026-001`',
        { parse_mode: 'Markdown', ...cancelButton() }
      ).catch(() =>
        ctx.reply(
          '💳 *Record Deposit*\n\nPlease enter the quotation number:\n\nExample: `QTN-2026-001`',
          { parse_mode: 'Markdown', ...cancelButton() }
        )
      );
      break;

    case 'paybalance':
      setStep(chatId, { action: 'awaiting_order_number_for_paybalance' });
      await ctx.editMessageText(
        '💰 *Pay Balance*\n\nPlease enter the quotation number:\n\nExample: `QTN-2026-001`',
        { parse_mode: 'Markdown', ...cancelButton() }
      ).catch(() =>
        ctx.reply(
          '💰 *Pay Balance*\n\nPlease enter the quotation number:\n\nExample: `QTN-2026-001`',
          { parse_mode: 'Markdown', ...cancelButton() }
        )
      );
      break;

    case 'deliverydate':
      setStep(chatId, { action: 'awaiting_order_number_for_delivered' });
      await ctx.editMessageText(
        '🚚 *Schedule Delivery*\n\nPlease enter the quotation number:\n\nExample: `QTN-2026-001`',
        { parse_mode: 'Markdown', ...cancelButton() }
      ).catch(() =>
        ctx.reply(
          '🚚 *Schedule Delivery*\n\nPlease enter the quotation number:\n\nExample: `QTN-2026-001`',
          { parse_mode: 'Markdown', ...cancelButton() }
        )
      );
      break;

    case 'delivered':
      setStep(chatId, { action: 'awaiting_order_number_for_mark_delivered' });
      await ctx.editMessageText(
        '✅ *Mark as Delivered*\n\nPlease enter the quotation number:\n\nExample: `QTN-2026-001`',
        { parse_mode: 'Markdown', ...cancelButton() }
      ).catch(() =>
        ctx.reply(
          '✅ *Mark as Delivered*\n\nPlease enter the quotation number:\n\nExample: `QTN-2026-001`',
          { parse_mode: 'Markdown', ...cancelButton() }
        )
      );
      break;

    case 'payment':
      setStep(chatId, { action: 'awaiting_order_number_for_payment' });
      await ctx.editMessageText(
        '💵 *Record Payment*\n\nPlease enter the quotation number:\n\nExample: `QTN-2026-001`',
        { parse_mode: 'Markdown', ...cancelButton() }
      ).catch(() =>
        ctx.reply(
          '💵 *Record Payment*\n\nPlease enter the quotation number:\n\nExample: `QTN-2026-001`',
          { parse_mode: 'Markdown', ...cancelButton() }
        )
      );
      break;

    case 'link':
      setStep(chatId, { action: 'awaiting_order_number_for_link' });
      await ctx.editMessageText(
        '🔗 *Link Order*\n\nPlease enter the quotation number to link for file uploads:\n\nExample: `QTN-2026-001`',
        { parse_mode: 'Markdown', ...cancelButton() }
      ).catch(() =>
        ctx.reply(
          '🔗 *Link Order*\n\nPlease enter the quotation number to link for file uploads:\n\nExample: `QTN-2026-001`',
          { parse_mode: 'Markdown', ...cancelButton() }
        )
      );
      break;

    case 'upload':
      {
        const session = getSession(chatId);
        if (!session.linkedOrder) {
          setStep(chatId, { action: 'awaiting_order_number_for_link' });
          await ctx.editMessageText(
            '📎 *Upload File*\n\nNo order is linked yet. Please enter the quotation number first:\n\nExample: `QTN-2026-001`',
            { parse_mode: 'Markdown', ...cancelButton() }
          ).catch(() =>
            ctx.reply(
              '📎 *Upload File*\n\nNo order is linked yet. Please enter the quotation number first:\n\nExample: `QTN-2026-001`',
              { parse_mode: 'Markdown', ...cancelButton() }
            )
          );
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
        '👤 *Clients*\n\nEnter a client name to search their delivery details, or type *list* to see all clients:',
        { parse_mode: 'Markdown', ...cancelButton() }
      ).catch(() =>
        ctx.reply(
          '👤 *Clients*\n\nEnter a client name to search their delivery details, or type *list* to see all clients:',
          { parse_mode: 'Markdown', ...cancelButton() }
        )
      );
      break;

    default:
      await ctx.answerCbQuery('Unknown option');
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
          `Deposit: ${order.deposit_paid ? `✅ ₱${depositAmount.toLocaleString()}` : '⏳ Pending'}\n` +
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
        await ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
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
        `💳 *Deposit for ${quotationNumber}*\n\nEnter the deposit amount in PHP:\n\nExample: \`5000\``,
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
          `✅ *Deposit Recorded*\n\nOrder: *${quotationNumber}*\nAmount: ₱${amount.toLocaleString()}\n\nProduction can now proceed.`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (err: any) {
        await ctx.reply(`❌ Error recording deposit: ${err.message}`, {
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
      setStep(chatId, { action: 'awaiting_delivery_date', quotationNumber });

      // Auto-detect client delivery info
      let clientInfo = '';
      const client = order.client_name ? await lookupClient(order.client_name) : null;
      if (client || order.delivery_address || order.contact_number) {
        clientInfo = `\n\n🚚 *Detected Delivery Info:*`;
        if (client) {
          const info = formatClientInfo(client);
          if (info) clientInfo += `\n${info}`;
        } else {
          if (order.delivery_address) clientInfo += `\n📍 *Address:* ${order.delivery_address}`;
          if (order.contact_number) clientInfo += `\n📞 *Contact:* ${order.contact_number}`;
          if (order.authorized_receiver_name) clientInfo += `\n👤 *Auth. Receiver:* ${order.authorized_receiver_name}${order.authorized_receiver_contact ? ` (${order.authorized_receiver_contact})` : ''}`;
        }
        clientInfo += `\n\n_If the details above look wrong, you can update them in the dashboard Clients tab._\n`;
      }

      await ctx.reply(
        `🚚 *Schedule Delivery for ${quotationNumber}*${clientInfo}\nEnter the delivery date:\n\nExample: \`May 22 2026\``,
        { parse_mode: 'Markdown', ...cancelButton() }
      );
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
        `✅ *Mark as Delivered — ${quotationNumber}*\n\nEnter any delivery remarks (e.g., recipient name, notes), or send \`-\` to skip:`,
        { parse_mode: 'Markdown', ...cancelButton() }
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
        // Step 1: Upload deposit slip to Google Drive
        let depositImageUrl: string | null = null;
        try {
          const fileBuffer = Buffer.from(imageBase64, 'base64');
          const driveResult = await uploadToDrive(fileBuffer, fileName, mimeType);
          depositImageUrl = driveResult.webViewLink;
        } catch (driveErr) {
          console.error('[deposit] Drive upload error (non-fatal):', driveErr);
        }

        // Step 2: Record deposit via match-and-record with image_url
        const res = await fetch(`${apiBaseUrl}/deposits/match-and-record`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: depositAmount,
            client_name: clientName,
            image_url: depositImageUrl,
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
          `✅ *Deposit Recorded Successfully!*\n\n` +
          `👤 Client: *${escapeMarkdown(data.client_name)}*\n` +
          `📋 Order: *${data.quotation_number}*\n` +
          `💰 Amount: ₱${depositAmount.toLocaleString()}\n` +
          (data.expected_deposit
            ? `💵 Expected Deposit (50%): ₱${Number(data.expected_deposit).toLocaleString()}\n`
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
          await ctx.reply(
            `👤 *${escapeMarkdown(client.client_name)}*\n\n${info || 'No delivery details on file.'}`,
            { parse_mode: 'Markdown', ...mainMenuKeyboard() }
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
      stage: 'purchasing_pending',
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
bot.action(/^payment:(confirmed|pending):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const status = ctx.match[1];
  const quotationNumber = ctx.match[2];
  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username;

  botLog({
    chatId, userId, username,
    messageType: 'callback_query',
    content: `payment:${status}:${quotationNumber}`,
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
    // Advance to balance_due stage
    await postJson('/stage-updates', {
      order_id: orderId,
      stage: 'balance_due',
      status: 'auto_advanced',
      remarks: 'Inventory arrived — ready for delivery, balance payment required',
      updated_by: 'delivery-agent',
    });

    // Update order stage
    const res = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
    if (res.ok) {
      await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ current_stage: 'balance_due' }),
      });
    }

    await ctx.editMessageText(
      `✅ *Inventory Ready* — ${quotationNumber}\n\n` +
      `Stage advanced to ⚖️ *Balance Due*.\n\n` +
      `Please ask the client for the balance payment. ` +
      `You can use /paybalance command or send a photo of the deposit slip.`,
      { parse_mode: 'Markdown' }
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
    `⏳ *Still Waiting* — ${quotationNumber}\n\n` +
    `Noted. The bot will ask again tomorrow. ` +
    `Please update once the inventory is ready for delivery.`,
    { parse_mode: 'Markdown' }
  );
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
    `⏳ *Payment Pending* — ${quotationNumber}\n\n` +
    `Noted. The bot will ask again tomorrow. ` +
    `Please remind the client about the balance payment.`,
    { parse_mode: 'Markdown' }
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
      const err = await res.json().catch(() => ({ error: 'Vision API error' }));
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
            // No close match found — ask user to type client name
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
    // Step 1: Upload deposit slip to Google Drive in the client's folder
    let depositImageUrl: string | null = null;
    try {
      const fileBuffer = Buffer.from(imageBase64, 'base64');
      const driveResult = await uploadToDrive(fileBuffer, fileName, mimeType);
      depositImageUrl = driveResult.webViewLink;

      // Also record in the API's drive/upload for DB tracking (non-blocking)
      postJson('/drive/upload', {
        quotation_number: quotationNumber,
        file_type: mimeType,
        original_filename: `deposit_${fileName}`,
        mime_type: mimeType,
        file_data: imageBase64,
        uploaded_by: username ?? userId,
      }).catch(() => {});
    } catch (driveErr) {
      console.error('[deposit] Drive upload error (non-fatal):', driveErr);
      // Non-fatal — proceed with recording deposit even if Drive upload fails
    }

    // Step 2: Record the deposit via the existing /deposits endpoint (handles balance_due reminder)
    const depositRes = await fetch(`${apiBaseUrl}/deposits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quotation_number: quotationNumber,
        amount: depositAmount,
        image_url: depositImageUrl,
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
      metadata: { quotationNumber, amount: depositAmount, driveLink: depositImageUrl },
      status: 'success',
    });

    const successMsg =
      `✅ *Deposit Recorded Successfully!*\n\n` +
      `📋 Order: *${quotationNumber}*\n` +
      `💰 Amount: ₱${depositAmount.toLocaleString()}\n` +
      (depositImageUrl ? `🔗 [View Deposit Slip](${depositImageUrl})\n` : '') +
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
      const err = await res.json().catch(() => ({ error: 'Vision API error' }));
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

          if (visionResult?.amount && visionResult?.amount > 0) {
            // Record the balance payment
            const payResult: any = await postJson('/pay-balance', {
              quotation_number: quotationNumber,
              amount: visionResult.amount,
              payment_date: visionResult.date ?? null,
              updated_by: from,
            });

            resetStep(chatId);

            let msg = `✅ *Balance Payment Recorded!*\n\n`;
            msg += `Order: *${quotationNumber}*\n`;
            msg += `Amount: ₱${Number(visionResult.amount).toLocaleString()}`;
            if (visionResult.date) {
              msg += `\nDate: ${visionResult.date}`;
            }
            if (payResult.overpayment > 0) {
              msg += `\n⚠️ Overpayment of ₱${Number(payResult.overpayment).toLocaleString()}`;
            }
            msg += `\n\n🚚 You can now schedule delivery using the /deliverydate command.`;

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

// Help Command
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
  await ctx.reply(
    '📖 *Quotation Automation Bot — Help*\n\n' +
    'This bot uses *buttons*, not commands. Just tap and follow the prompts.\n\n' +
    '🔍 *Check Order Status* — View current stage, deposit, balance, delivery info\n' +
    '🏭 *Purchasing/Production* — Mark items as purchased or in production\n' +
    '💰 *Record Deposit* — Log a deposit payment\n' +
    '💳 *Pay Balance* — Record balance payment before delivery\n' +
    '📅 *Schedule Delivery* — Set a delivery date (balance must be paid first)\n' +
    '✅ *Mark as Delivered* — Confirm delivery with remarks\n' +
    '💵 *Record Payment* — Log payment received or confirmed\n' +
    '👤 *Clients* — Search client delivery details\n' +
    '🔗 *Link Order* — Associate an order for file uploads\n' +
    '📎 *Upload File* — Send a document/photo linked to an order\n\n' +
    '*Group Setup:*\n' +
    '• The bot must have *privacy mode disabled* in @BotFather to see messages and files in groups.\n' +
    '• Only one user can use the bot at a time per group. If busy, wait for the current user to finish.\n\n' +
    '*Direct Messages:*\n' +
    '• Only group admins can DM the bot.\n\n' +
    'Available commands:\n' +
    '/start — Show main menu\n' +
    '/help — Show this message\n' +
    '/unlink — Clear linked order for uploads\n\n' +
    '_Tip: You can also send a file anytime — if an order is linked, it will be uploaded automatically._',
    { parse_mode: 'Markdown', ...mainMenuKeyboard() }
  );
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
async function launchWithRetry(maxRetries = 30, baseDelayMs = 5000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Reset any lingering polling lock before each attempt
      await (bot.telegram as any).callApi('close').catch(() => {});
      // Clear any lingering webhook before each attempt
      await bot.telegram.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
      await bot.launch();
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
