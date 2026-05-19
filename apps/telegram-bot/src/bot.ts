import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import { uploadToDrive } from './services/googleDrive.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:8080';

if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const bot = new Telegraf(token);

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

// ── State Machine ──────────────────────────────────────────────────────
// Tracks multi-step interactions per chat so users don't need /commands

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
  | { action: 'awaiting_vision_process'; imageBase64: string; mimeType: string; fileName: string }
  | { action: 'awaiting_vision_extract'; imageBase64: string; mimeType: string; fileName: string };

interface UserSession {
  step: UserStep;
  linkedOrder: string | null; // quotation_number linked for file uploads
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
  session.step = step;
}

function resetStep(chatId: string) {
  const session = getSession(chatId);
  session.step = { action: 'idle' };
}

function escapeMarkdown(value: unknown): string {
  return String(value ?? '').replace(/([_*`[\]\\])/g, '\\$1');
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
  resetStep(chatId);
  await ctx.reply(
    '👋 *Welcome to Quotation Automation Bot!*\n\n' +
    'Use the buttons below to manage orders. No need to type commands — just tap and follow the prompts.',
    { parse_mode: 'Markdown', ...mainMenuKeyboard() }
  );
});

// ── Action: Cancel ─────────────────────────────────────────────────────

bot.action('action:cancel', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  resetStep(chatId);
  await ctx.editMessageText(
    '❌ Cancelled. What would you like to do next?',
    { parse_mode: 'Markdown', ...mainMenuKeyboard() }
  ).catch(() => ctx.reply('❌ Cancelled.', mainMenuKeyboard()));
});

// ── Menu Router ────────────────────────────────────────────────────────

bot.action(/^menu:(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const action = ctx.match[1];

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
      setStep(chatId, { action: 'awaiting_order_number_for_delivered' });
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
        const msg =
          `📋 *${order.quotation_number}*\n` +
          `Stage: ${order.current_stage}\n` +
          `Status: ${order.status}\n` +
          `Math: ${order.math_status}\n` +
          `Total: ₱${totalAmount.toLocaleString()}\n` +
          `Deposit: ${order.deposit_paid ? `✅ ₱${depositAmount.toLocaleString()}` : '⏳ Pending'}\n` +
          `Balance: ${order.balance_paid ? '✅ Paid' : `⏳ ₱${balance.toLocaleString()}`}`;
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
      const remarks = text;
      try {
        await postJson('/stage-updates', {
          quotation_number: quotationNumber,
          stage: 'production_confirmed',
          status,
          remarks,
          updated_by: ctx.from?.username ?? String(ctx.from?.id),
        });
        resetStep(chatId);
        await ctx.reply(
          `✅ *Production Confirmed*\n\nOrder: *${quotationNumber}*\nTimeline: ${remarks}`,
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
      try {
        const order: any = await getJson(`/orders/${encodeURIComponent(quotationNumber)}`);
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
      await ctx.reply(
        `🚚 *Schedule Delivery for ${quotationNumber}*\n\nEnter the delivery date:\n\nExample: \`May 22 2026\``,
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

    default:
      resetStep(chatId);
      await ctx.reply(
        '🏠 *Main Menu*\nChoose an action below:',
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
  }
});

// ── Inline Callback Handlers ───────────────────────────────────────────

// Production status callback
bot.action(/^produce:(yes|no):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const status = ctx.match[1];
  const quotationNumber = ctx.match[2];

  if (status === 'no') {
    await postJson('/stage-updates', {
      quotation_number: quotationNumber,
      stage: 'production_confirmed',
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

// Payment status callback
bot.action(/^payment:(confirmed|pending):(.+)$/, async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const status = ctx.match[1];
  const quotationNumber = ctx.match[2];

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

// ── Gemini Vision Callback Handlers ──────────────────────────────────
// Workflow:
//   1. User sends image/PDF → bot asks "Process this order?" (Yes/No)
//   2. If Yes → bot asks "Extract info from image/PDF?" (Yes/No)
//   3. If Yes to extract → Gemini extracts → share link to dashboard GUI
//   4. If No to extract → upload to Drive
//   5. If No to process → do nothing

// Step 1: User said Yes to "Process this order?" → ask about extraction
bot.action('vision:process_yes', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);

  if (session.step.action !== 'awaiting_vision_process') {
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
  resetStep(chatId);
  await ctx.editMessageText('✅ File ignored. Nothing was uploaded.', {
    parse_mode: 'Markdown',
    ...mainMenuKeyboard(),
  });
});

// Step 2: User said Yes to extract → call Gemini Vision, share to dashboard
bot.action('vision:extract_yes', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);

  if (session.step.action !== 'awaiting_vision_extract') {
    return ctx.editMessageText('⏳ This session has expired. Please upload the file again.', {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  }

  const { imageBase64, mimeType, fileName } = session.step;
  await ctx.editMessageText(`🤖 Analyzing with AI Vision...`);

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
    console.error('[vision] Extraction error:', error);
    resetStep(chatId);
    await ctx.editMessageText(`❌ Vision analysis failed: ${error.message}`, {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  }
});

// Fallback: upload to Drive (used from multiple steps)
bot.action('vision:upload', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const session = getSession(chatId);

  if (session.step.action !== 'awaiting_vision_process' && session.step.action !== 'awaiting_vision_extract') {
    return ctx.editMessageText('⏳ Session expired.', {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  }

  const { imageBase64, mimeType, fileName } = session.step;
  const fileBuffer = Buffer.from(imageBase64, 'base64');

  try {
    await ctx.editMessageText(`📤 Uploading to Google Drive...`);

    const driveResult = await uploadToDrive(fileBuffer, fileName, mimeType);

    const payload: Record<string, unknown> = {
      file_type: mimeType,
      original_filename: fileName,
      mime_type: mimeType,
      file_data: imageBase64,
      telegram_chat_id: chatId,
      uploaded_by: ctx.from?.username ?? String(ctx.from?.id),
    };

    await fetch(`${apiBaseUrl}/drive/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    resetStep(chatId);
    await ctx.editMessageText(
      `✅ *File uploaded to Google Drive!*\n📄 ${escapeMarkdown(fileName)}\n🔗 ${escapeMarkdown(driveResult.webViewLink)}`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } catch (error: any) {
    console.error('[vision] Upload error:', error);
    resetStep(chatId);
    await ctx.editMessageText(`❌ Upload failed: ${String(error.message ?? error)}`, {
      ...mainMenuKeyboard(),
    });
  }
});

// Do nothing
bot.action('vision:ignore', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  resetStep(chatId);
  await ctx.editMessageText('✅ File ignored. Nothing was uploaded.', {
    parse_mode: 'Markdown',
    ...mainMenuKeyboard(),
  });
});

// ── File Upload Handler ──────────────────────────────────────────────
// Handles documents (PDFs, images, etc.) and photos sent to the bot.
// For images, asks the user if they want Gemini Vision to extract data.

bot.on(['document', 'photo'], async (ctx) => {
  const chatId = String(ctx.chat!.id);
  const messageId = String(ctx.message.message_id);
  const from = ctx.from?.username ?? String(ctx.from?.id);
  const session = getSession(chatId);

  // Determine file info using type-safe narrowing
  let fileId: string;
  let fileName: string;
  let mimeType: string;

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
    return ctx.reply('❌ Unsupported file type.');
  }

  await ctx.reply(`📎 Downloading ${fileName}...`);

  try {
    // Step 1: Download file from Telegram
    const link = await ctx.telegram.getFileLink(fileId);
    const response = await fetch(link.href);
    if (!response.ok) throw new Error(`Telegram download failed: ${response.status}`);
    const fileBuffer = Buffer.from(await response.arrayBuffer());
    const imageBase64 = fileBuffer.toString('base64');

    // Step 2: Ask user if they want to process this file
      // For images and PDFs, offer the vision workflow
      const isProcessable = /^image\//.test(mimeType) || mimeType === 'application/pdf';
      if (isProcessable) {
        setStep(chatId, {
          action: 'awaiting_vision_process',
          imageBase64,
          mimeType,
          fileName,
        });

        await ctx.reply(
          `📎 *File received:* ${escapeMarkdown(fileName)}\n\nDo you want me to process this order?`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('✅ Yes, process this order', 'vision:process_yes')],
              [Markup.button.callback('❌ No, do nothing', 'vision:process_no')],
            ]),
          }
        );
      } else {
        // Non-image/PDF: just upload to Drive as before
        await ctx.reply(`📤 Uploading to Google Drive...`);
        const quotationNumber = session.linkedOrder;
        const driveResult = await uploadToDrive(fileBuffer, fileName, mimeType);

        const payload: Record<string, unknown> = {
          file_type: mimeType,
          original_filename: fileName,
          mime_type: mimeType,
          file_data: imageBase64,
          telegram_chat_id: chatId,
          telegram_message_id: messageId,
          uploaded_by: from,
        };
        if (quotationNumber) payload.quotation_number = quotationNumber;
        await postJson('/drive/upload', payload);

        await ctx.reply(
          `✅ *File uploaded to Google Drive!*\n📄 ${escapeMarkdown(fileName)}\n🔗 ${escapeMarkdown(driveResult.webViewLink)}` +
            (quotationNumber ? `\n📦 Linked to order: ${escapeMarkdown(quotationNumber)}` : ''),
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      }
    } catch (error: any) {
    console.error('Upload error:', error);
    await ctx.reply(`❌ Upload failed: ${String(error.message ?? error)}`, {
      ...cancelButton(),
    });
  }
});

// ── Help Command ──────────────────────────────────────────────────────
bot.command('help', async (ctx) => {
  const chatId = String(ctx.chat!.id);
  resetStep(chatId);
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
    '🔗 *Link Order* — Associate an order for file uploads\n' +
    '📎 *Upload File* — Send a document/photo linked to an order\n\n' +
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
  const session = getSession(chatId);
  session.linkedOrder = null;
  await ctx.reply('🔗 Order context cleared. Files will not be linked to any order.', mainMenuKeyboard());
});

// ── Start ─────────────────────────────────────────────────────────────

bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
