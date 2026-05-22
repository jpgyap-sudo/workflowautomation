import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
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
  | { action: 'awaiting_client_search' };

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

  await postJson('/files/upload', payload);
  return { ok: true };
}
