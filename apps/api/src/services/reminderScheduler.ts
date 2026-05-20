import { query } from '../db.js';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

interface Reminder {
  id: string;
  order_id: string;
  stage: string;
  group_chat_id: string;
  message: string;
  frequency: string;
  next_run_at: string;
  status: string;
  escalation_level: number;
  quotation_number?: string;
  client_name?: string;
  partial_production_items?: string[];
}

/**
 * Send a Telegram message to a group chat.
 */
async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) return false;
  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Send a Telegram message with an inline keyboard.
 */
async function sendTelegramInlineKeyboard(
  chatId: string,
  text: string,
  buttons: { text: string; callback_data: string }[][],
): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) return false;
  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Check all active reminders and send those that are due.
 * Runs every minute via setInterval.
 */
export async function processDueReminders(): Promise<number> {
  const now = new Date().toISOString();

  // Fetch all active reminders where next_run_at <= now
  const dueReminders = await query(
    `SELECT r.*, o.quotation_number, o.client_name,
            COALESCE(o.partial_production_items, '[]'::jsonb) AS partial_production_items
     FROM reminders r
     JOIN orders o ON o.id = r.order_id
     WHERE r.status = 'active'
       AND r.next_run_at <= $1
     ORDER BY r.next_run_at ASC
     LIMIT 20`,
    [now]
  );

  if (!dueReminders || dueReminders.length === 0) return 0;

  let sent = 0;

  for (const reminder of dueReminders as Reminder[]) {
    // Build the reminder message
    const orderRef = reminder.quotation_number
      ? `*${reminder.quotation_number}*`
      : `Order #${reminder.order_id.slice(0, 8)}`;
    const client = reminder.client_name ? ` (${reminder.client_name})` : '';

    const stageLabels: Record<string, string> = {
      order_confirmation_received: '📄 Order Confirmation Received',
      math_verified: '✅ Math Verified',
      purchasing_pending: '🛒 Purchasing Pending',
      production_confirmed: '🏭 Production Confirmed',
      production_midpoint: '🏭 Production Midpoint Check',
      production_due: '🏭 Production Due',
      deposit_pending: '💳 Deposit Pending',
      en_route: '🚚 En Route',
      en_route_reminder: '🚚 En Route',
      inventory_arrived: '📦 Inventory Arrived',
      balance_due: '⚖️ Balance Due',
      delivery_scheduled: '🚚 Delivery Scheduled',
      delivered: '✅ Delivered',
      countered: '🔄 Countered',
      payment_received: '💰 Payment Received',
      payment_confirmed: '💵 Payment Confirmed',
      partial_production: '🏭 Partial Production',
    };

    const stageLabel = stageLabels[reminder.stage] ?? reminder.stage;
    let text = `⏰ *Reminder* — ${orderRef}${client}\n`;
    text += `Stage: ${stageLabel}\n`;
    text += `${reminder.message}\n\n`;

    // Add escalation note
    if (reminder.escalation_level > 0) {
      const level = '🔴'.repeat(Math.min(reminder.escalation_level, 3));
      text += `${level} *Escalation Level ${reminder.escalation_level}*\n`;
    }

    text += `_Use /status ${reminder.quotation_number ?? ''} to check details._`;

    // Determine if this reminder needs inline keyboard buttons
    const quotationNumber = reminder.quotation_number ?? '';
    const orderId = reminder.order_id;

    let ok = false;

    if (reminder.stage === 'production_midpoint') {
      // Midpoint check: ask if on time or delayed
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
        [
          { text: '✅ On Time', callback_data: `production:ontime:${orderId}:${quotationNumber}` },
          { text: '⚠️ Delayed', callback_data: `production:delayed:${orderId}:${quotationNumber}` },
        ],
      ]);
    } else if (reminder.stage === 'production_due') {
      // Production due: ask if finished
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
        [
          { text: '✅ Finished', callback_data: `production:finished:${orderId}:${quotationNumber}` },
          { text: '❌ Not Yet', callback_data: `production:not_finished:${orderId}:${quotationNumber}` },
        ],
      ]);
    } else if (reminder.stage === 'en_route_reminder') {
      // En route check: ask if order is en route
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
        [
          { text: '✅ Yes', callback_data: `en_route:yes:${orderId}:${quotationNumber}` },
          { text: '❌ No', callback_data: `en_route:no:${orderId}:${quotationNumber}` },
        ],
      ]);
    } else if (reminder.stage === 'partial_production') {
      // Partial production: list pending items and offer update button
      const items: string[] = Array.isArray(reminder.partial_production_items)
        ? reminder.partial_production_items
        : [];
      const itemsList = items.length > 0
        ? `\n\nItems still pending production:\n${items.map(i => `• ${i}`).join('\n')}`
        : '\n\nNo items listed — all may have been produced.';
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text + itemsList, [
        [
          { text: '📝 Update Items Produced', callback_data: `partial_production:update:${orderId}:${quotationNumber}` },
        ],
      ]);
    } else if (reminder.stage === 'inventory_arrived') {
      // Inventory arrived: ask if ready for delivery / balance payment
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
        [
          { text: '✅ Ready for Delivery', callback_data: `inventory:ready:${orderId}:${quotationNumber}` },
          { text: '⏳ Still Waiting', callback_data: `inventory:waiting:${orderId}:${quotationNumber}` },
        ],
      ]);
    } else if (reminder.stage === 'balance_due') {
      // Balance due: ask if client has paid
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
        [
          { text: '✅ Yes, Client Paid', callback_data: `balance:paid:${orderId}:${quotationNumber}` },
          { text: '❌ Not Yet', callback_data: `balance:not_paid:${orderId}:${quotationNumber}` },
        ],
      ]);
    } else {
      // Standard reminder — plain text
      ok = await sendTelegramMessage(reminder.group_chat_id, text);
    }

    if (ok) {
      sent++;

      // For production midpoint and due reminders with 'once' frequency, mark as completed after sending
      // (they will be re-created if needed by the bot callback handlers)
      if (reminder.stage === 'production_midpoint' || reminder.stage === 'production_due') {
        await query(
          `UPDATE reminders SET status = 'completed', updated_at = NOW() WHERE id = $1`,
          [reminder.id]
        );
      } else {
        // Calculate next run time based on frequency
        const nextRun = new Date();
        switch (reminder.frequency) {
          case 'hourly':
            nextRun.setHours(nextRun.getHours() + 1);
            break;
          case 'daily':
          default:
            nextRun.setDate(nextRun.getDate() + 1);
            break;
        }

        // Escalate if overdue (after 3 reminders without update)
        const newEscalation = reminder.escalation_level + 1;

        await query(
          `UPDATE reminders
           SET next_run_at = $1,
               escalation_level = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [nextRun.toISOString(), newEscalation, reminder.id]
        );
      }
    }
  }

  return sent;
}

/**
 * Create a reminder for an order when it enters a new stage.
 */
export async function createStageReminder(
  orderId: string,
  stage: string,
  groupChatId: string,
  message: string,
  frequency: string = 'daily'
): Promise<void> {
  const now = new Date();

  // Start first reminder 1 hour from now (give time for manual update)
  const firstRun = new Date(now.getTime() + 60 * 60 * 1000);

  await query(
    `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')
     ON CONFLICT DO NOTHING`,
    [orderId, stage, groupChatId, message, frequency, firstRun.toISOString()]
  );
}

/**
 * Complete/disable all active reminders for an order.
 * Called when an order moves to a new stage or is completed.
 */
export async function completeOrderReminders(orderId: string): Promise<void> {
  await query(
    `UPDATE reminders SET status = 'completed', updated_at = NOW() WHERE order_id = $1 AND status = 'active'`,
    [orderId]
  );
}

/**
 * Start the reminder scheduler loop.
 * Checks for due reminders every 60 seconds.
 */
export function startReminderScheduler(intervalMs: number = 60_000): NodeJS.Timeout {
  console.log(`[ReminderScheduler] Started — checking every ${intervalMs / 1000}s`);

  // Run immediately on start
  processDueReminders().then((count) => {
    if (count > 0) console.log(`[ReminderScheduler] Sent ${count} reminder(s) on startup`);
  });

  // Then run on interval
  return setInterval(async () => {
    try {
      const count = await processDueReminders();
      if (count > 0) {
        console.log(`[ReminderScheduler] Sent ${count} reminder(s)`);
      }
    } catch (err) {
      console.error('[ReminderScheduler] Error:', err);
    }
  }, intervalMs);
}
