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
 * Check all active reminders and send those that are due.
 * Runs every minute via setInterval.
 */
export async function processDueReminders(): Promise<number> {
  const now = new Date().toISOString();

  // Fetch all active reminders where next_run_at <= now
  const dueReminders = await query(
    `SELECT r.*, o.quotation_number, o.client_name
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
      deposit_pending: '💳 Deposit Pending',
      inventory_arrived: '📦 Inventory Arrived',
      balance_due: '⚖️ Balance Due',
      delivery_scheduled: '🚚 Delivery Scheduled',
      delivered: '✅ Delivered',
      countered: '🔄 Countered',
      payment_received: '💰 Payment Received',
      payment_confirmed: '💵 Payment Confirmed',
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

    // Send the message
    const ok = await sendTelegramMessage(reminder.group_chat_id, text);

    if (ok) {
      sent++;

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
