import { query } from '../db.js';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

/**
 * Returns the next reminder fire time: 10:00 AM or 4:00 PM PHT (UTC+8).
 * If current PHT time is already past 4 PM, returns tomorrow 10 AM PHT.
 */
function nextPhtReminderTime(): Date {
  const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
  const phtNow = new Date(Date.now() + PHT_OFFSET_MS);
  const phtHour = phtNow.getUTCHours();

  const target = new Date(phtNow.getTime());
  target.setUTCMinutes(0, 0, 0);

  if (phtHour < 10) {
    target.setUTCHours(10);
  } else if (phtHour < 16) {
    target.setUTCHours(16);
  } else {
    target.setUTCDate(target.getUTCDate() + 1);
    target.setUTCHours(10);
  }

  return new Date(target.getTime() - PHT_OFFSET_MS);
}

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
  item_id?: string | null;
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
        parse_mode: 'HTML',
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
        parse_mode: 'HTML',
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
    `SELECT r.*, o.quotation_number, o.client_name, o.current_stage, o.deposit_paid, o.balance_paid,
            o.deposit_verified, o.balance_verified, o.production_started, o.delivery_date,
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

  for (const reminder of dueReminders as (Reminder & { current_stage: string; deposit_paid: boolean; balance_paid: boolean; deposit_verified: boolean; balance_verified: boolean; production_started: boolean })[]) {
    // ── Auto-complete stale reminders ──────────────────────────────────
    // Skip + complete reminders that are no longer relevant based on order state
    let stale = false;
    if (reminder.stage === 'deposit_pending' && reminder.deposit_paid) stale = true;
    if (reminder.stage === 'deposit_verification' && reminder.deposit_paid && reminder.deposit_verified) stale = true;
    if ((reminder.stage === 'balance_due' || reminder.stage === 'delivered' || reminder.stage === 'countered') && reminder.balance_paid) stale = true;
    if (reminder.stage === 'balance_verification' && reminder.balance_paid && reminder.balance_verified) stale = true;
    if (reminder.stage === 'delivery_scheduled' && ['delivered', 'payment_received', 'payment_confirmed', 'completed'].includes(reminder.current_stage)) stale = true;
    if (reminder.stage === 'inventory_arrived' && ['balance_due', 'delivery_scheduled', 'delivered', 'payment_received', 'payment_confirmed', 'completed'].includes(reminder.current_stage)) stale = true;
    if (reminder.stage === 'en_route' && ['inventory_arrived', 'balance_due', 'delivery_scheduled', 'delivered', 'payment_received', 'payment_confirmed', 'completed'].includes(reminder.current_stage)) stale = true;
    if ((reminder.stage === 'production_confirmed' || reminder.stage === 'production_midpoint' || reminder.stage === 'production_due') && ['en_route', 'inventory_arrived', 'balance_due', 'delivery_scheduled', 'delivered', 'payment_received', 'payment_confirmed', 'completed'].includes(reminder.current_stage)) stale = true;
    if (reminder.stage === 'production_pending' && (reminder.production_started || ['production_confirmed', 'en_route', 'inventory_arrived', 'balance_due', 'delivery_scheduled', 'delivered', 'payment_received', 'payment_confirmed', 'completed'].includes(reminder.current_stage))) stale = true;
    if ((reminder.stage === 'purchasing_pending') && ['production_confirmed', 'production_pending', 'en_route', 'inventory_arrived', 'balance_due', 'delivery_scheduled', 'delivered', 'payment_received', 'payment_confirmed', 'completed'].includes(reminder.current_stage)) stale = true;
    // Item-level tracking reminders — stale if order has moved past the relevant stage
    if (reminder.stage === 'item_level_production' && ['en_route', 'inventory_arrived', 'balance_due', 'delivery_scheduled', 'delivered', 'payment_received', 'payment_confirmed', 'completed'].includes(reminder.current_stage)) stale = true;
    if (reminder.stage === 'item_level_en_route' && ['inventory_arrived', 'balance_due', 'delivery_scheduled', 'delivered', 'payment_received', 'payment_confirmed', 'completed'].includes(reminder.current_stage)) stale = true;
    // En route timed reminders — stale once order advances past en_route (for midpoint) or inventory_arrived (for arrival)
    if (reminder.stage === 'en_route_midpoint' && reminder.current_stage !== 'en_route') stale = true;
    if (reminder.stage === 'en_route_arrival' && ['inventory_arrived', 'balance_due', 'delivery_scheduled', 'delivered', 'payment_received', 'payment_confirmed', 'completed'].includes(reminder.current_stage)) stale = true;

    if (stale) {
      await query(
        `UPDATE reminders SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [reminder.id]
      );
      continue;
    }
    // Build the reminder message
    const orderRef = reminder.quotation_number
      ? `*${reminder.quotation_number}*`
      : `Order #${reminder.order_id.slice(0, 8)}`;
    const client = reminder.client_name ? ` (${reminder.client_name})` : '';

    const stageLabels: Record<string, string> = {
      order_confirmation_received: '📄 Order Confirmation Received',
      math_verified: '✅ Math Verified',
      purchasing_pending: '🛒 Purchasing Pending',
      production_pending: '🏭 Production Pending',
      production_confirmed: '🏭 Production Confirmed',
      production_midpoint: '🏭 Production Midpoint Check',
      production_due: '🏭 Production Due',
      deposit_pending: '💳 Deposit Pending',
      deposit_verification: '🔍 Deposit Verification',
      en_route: '🚚 En Route',
      en_route_reminder: '🚚 En Route',
      en_route_midpoint: '✅ En Route Midpoint Check',
      en_route_arrival: '📦 En Route Arrival Check',
      inventory_arrived: '📦 Inventory Arrived',
      balance_due: '⚖️ Balance Due',
      balance_verification: '🔍 Balance Verification',
      delivery_scheduled: '🚚 Delivery Scheduled',
      delivered: '✅ Delivered',
      countered: '🔄 Countered',
      payment_received: '💰 Payment Received',
      payment_confirmed: '💵 Payment Confirmed',
      partial_production: '🏭 Partial Production',
      item_level_production: '🏗️ Item Production',
      item_level_en_route: '🚚 Item En Route',
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

    // Determine if this reminder needs inline keyboard buttons
    const quotationNumber = reminder.quotation_number ?? '';
    const orderId = reminder.order_id;

    let ok = false;

    if (reminder.stage === 'purchasing_pending') {
      if (reminder.deposit_verified) {
        // Deposit verified — route to production group and ask them to start the workflow
        const prodChatId = process.env.PRODUCTION_GROUP_CHAT_ID ?? reminder.group_chat_id;
        ok = await sendTelegramInlineKeyboard(prodChatId, text, [
          [
            { text: '✅ Proceed to Production Workflow', callback_data: `advance:production_pending:${quotationNumber}` },
            { text: '⏳ Not yet', callback_data: `produce:no:${quotationNumber}` },
          ],
        ]);
      } else {
        // Deposit not yet verified — ask purchasing group if production has started
        ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
          [
            { text: '✅ Yes, started', callback_data: `produce:yes:${orderId.slice(0, 8)}:${quotationNumber}` },
            { text: '⚠️ Partial', callback_data: `produce:partial:${orderId.slice(0, 8)}:${quotationNumber}` },
          ],
          [{ text: '⏳ Not yet', callback_data: `produce:no:${orderId.slice(0, 8)}:${quotationNumber}` }],
        ]);
      }
    } else if (reminder.stage === 'production_midpoint') {
      // Midpoint check: ask if on time or delayed
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
        [
          { text: '✅ On Time', callback_data: `production:ontime:${orderId.slice(0, 8)}:${quotationNumber}` },
          { text: '⚠️ Delayed', callback_data: `production:delayed:${orderId.slice(0, 8)}:${quotationNumber}` },
        ],
      ]);
    } else if (reminder.stage === 'production_due') {
      // Production due: ask if production has started (not if finished)
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
        [
          { text: '✅ Yes, started', callback_data: `produce:yes:${orderId.slice(0, 8)}:${quotationNumber}` },
          { text: '⚠️ Partial', callback_data: `produce:partial:${orderId.slice(0, 8)}:${quotationNumber}` },
        ],
        [{ text: '⏳ Not yet', callback_data: `produce:no:${orderId.slice(0, 8)}:${quotationNumber}` }],
      ]);
    } else if (reminder.stage === 'en_route_reminder') {
      // En route check: ask if order is en route
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
        [
          { text: '✅ Yes', callback_data: `en_route:yes:${orderId.slice(0, 8)}:${quotationNumber}` },
          { text: '❌ No', callback_data: `en_route:no:${orderId.slice(0, 8)}:${quotationNumber}` },
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
          { text: '📝 Update Items Produced', callback_data: `partial_production:update:${orderId.slice(0, 8)}:${quotationNumber}` },
        ],
      ]);
    } else if (reminder.stage === 'production_pending') {
      // Production pending: ask if production has started
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
        [
          { text: '✅ Yes, started', callback_data: `produce:yes:${orderId.slice(0, 8)}:${quotationNumber}` },
          { text: '⚠️ Partial', callback_data: `produce:partial:${orderId.slice(0, 8)}:${quotationNumber}` },
        ],
        [{ text: '⏳ Not yet', callback_data: `produce:no:${orderId.slice(0, 8)}:${quotationNumber}` }],
      ]);
    } else if (reminder.stage === 'deposit_pending') {
      // Deposit pending: ask if deposit has been collected
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
        [
          { text: '✅ Yes, Upload Deposit Slip', callback_data: `deposit:yes:${orderId.slice(0, 8)}:${quotationNumber}` },
          { text: '❌ Not Yet', callback_data: `deposit:no:${orderId.slice(0, 8)}:${quotationNumber}` },
        ],
      ]);
    } else if (reminder.stage === 'deposit_verification') {
      // Deposit verification: ask team to verify the deposit
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
        [
          { text: '🔍 Verify Deposit', callback_data: `verify:deposit:${orderId.slice(0, 8)}:${quotationNumber}` },
        ],
      ]);
    } else if (reminder.stage === 'inventory_arrived') {
      // Inventory arrival: ask for all / none / partial so item reminders can eliminate arrived items.
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
        [
          { text: 'Yes, all arrived', callback_data: `inv_arr:yes:${quotationNumber}` },
          { text: 'No', callback_data: `inv_arr:no:${quotationNumber}` },
        ],
        [
          { text: 'Partial - choose items', callback_data: `inv_arr:partial:${quotationNumber}` },
        ],
      ]);
    } else if (reminder.stage === 'balance_due') {
      // Balance due: ask if client has paid
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
        [
          { text: '✅ Yes, Client Paid', callback_data: `balance:paid:${orderId.slice(0, 8)}:${quotationNumber}` },
          { text: '❌ Not Yet', callback_data: `balance:not_paid:${orderId.slice(0, 8)}:${quotationNumber}` },
        ],
      ]);
    } else if (reminder.stage === 'balance_verification') {
      // Balance verification: ask team to verify the balance payment
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
        [
          { text: '🔍 Verify Balance', callback_data: `verify:balance:${orderId.slice(0, 8)}:${quotationNumber}` },
        ],
      ]);
    } else if (reminder.stage === 'delivery_scheduled') {
      // Only fire this reminder when the delivery date has actually arrived.
      // If the delivery date is still in the future, snooze to the day before instead.
      const deliveryDate = (reminder as any).delivery_date;
      let deliveryDiffDays = 0; // default: treat as delivery day if no date set
      if (deliveryDate) {
        const pht = new Date(Date.now() + 8 * 60 * 60 * 1000);
        const deliveryPht = new Date(new Date(deliveryDate).getTime() + 8 * 60 * 60 * 1000);
        deliveryDiffDays = Math.ceil(
          (deliveryPht.setHours(0,0,0,0) - pht.setHours(0,0,0,0)) / 86_400_000
        );

        if (deliveryDiffDays > 1) {
          // Too early — snooze to 8 AM PHT the day before delivery
          const dayBefore = new Date(new Date(deliveryDate).getTime() - 24 * 60 * 60 * 1000);
          dayBefore.setUTCHours(0, 0, 0, 0); // midnight UTC = 8 AM PHT
          await query(
            `UPDATE reminders SET next_run_at = $1, updated_at = NOW() WHERE id = $2`,
            [dayBefore.toISOString(), reminder.id]
          );
          continue; // skip sending — not time yet
        }
      }

      // Day before: ask if ready; delivery day/overdue: ask if delivered
      if (deliveryDiffDays === 1) {
        ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
          [
            { text: '✅ Yes, Ready', callback_data: `delivery:ready:${orderId.slice(0, 8)}:${quotationNumber}` },
            { text: '⚠️ No, Delayed', callback_data: `delivery:delayed:${orderId.slice(0, 8)}:${quotationNumber}` },
          ],
        ]);
      } else {
        ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
          [
            { text: '✅ Yes, Delivered', callback_data: `delivery:yes:${orderId.slice(0, 8)}:${quotationNumber}` },
            { text: '❌ Not Yet', callback_data: `delivery:no:${orderId.slice(0, 8)}:${quotationNumber}` },
          ],
        ]);
      }
    } else if (reminder.stage === 'countered') {
      // Countered: ask if payment has been received
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
        [
          { text: '💰 Payment Received', callback_data: `payment:confirmed:${orderId.slice(0, 8)}:${quotationNumber}` },
          { text: '⏳ Still Waiting', callback_data: `payment:pending:${orderId.slice(0, 8)}:${quotationNumber}` },
        ],
      ]);
    } else if (reminder.stage === 'payment_received') {
      // Payment received: ask if payment is confirmed
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
        [
          { text: '✅ Confirm Payment', callback_data: `payment:confirmed:${orderId.slice(0, 8)}:${quotationNumber}` },
          { text: '⏳ Still Pending', callback_data: `payment:pending:${orderId.slice(0, 8)}:${quotationNumber}` },
        ],
      ]);
    } else if (reminder.stage === 'delivered') {
      // Delivered: prompt to record payment
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
        [{ text: '💵 Record Payment', callback_data: `pick:payment:${quotationNumber}` }],
      ]);
    } else if (reminder.stage === 'item_level_production') {
      // Item-level production reminder — fetch item name and show inline buttons
      let itemName = 'Unknown Item';
      let itemQty = 1;
      if (reminder.item_id) {
        const itemRows = await query(
          `SELECT name, quantity FROM order_items WHERE id = $1`,
          [reminder.item_id]
        );
        if (itemRows[0]) {
          itemName = itemRows[0].name;
          itemQty = itemRows[0].quantity;
        }
      }
      text += `*Item:* ${itemName} x${itemQty}\n\n`;
      text += `Has *${itemName}* started or finished production?`;
      const itemIdShort = (reminder.item_id ?? '').slice(0, 8);
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
        [
          { text: `✅ ${itemName} — Finished`, callback_data: `reminder:item_prod:finished:${itemIdShort}:${orderId.slice(0, 8)}:${quotationNumber}` },
          { text: `🔄 ${itemName} — In Progress`, callback_data: `reminder:item_prod:in_progress:${itemIdShort}:${orderId.slice(0, 8)}:${quotationNumber}` },
        ],
        [
          { text: `⏳ ${itemName} — Not Yet`, callback_data: `reminder:item_prod:pending:${itemIdShort}:${orderId.slice(0, 8)}:${quotationNumber}` },
        ],
      ]);
    } else if (reminder.stage === 'item_level_en_route') {
      // Item-level en route reminder — fetch item name and show inline buttons
      let itemName = 'Unknown Item';
      let itemQty = 1;
      if (reminder.item_id) {
        const itemRows = await query(
          `SELECT name, quantity FROM order_items WHERE id = $1`,
          [reminder.item_id]
        );
        if (itemRows[0]) {
          itemName = itemRows[0].name;
          itemQty = itemRows[0].quantity;
        }
      }
      text += `*Item:* ${itemName} x${itemQty}\n\n`;
      text += `Is *${itemName}* en route or has it arrived?`;
      const itemIdShort = (reminder.item_id ?? '').slice(0, 8);
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, text, [
        [
          { text: `🚚 ${itemName} — En Route`, callback_data: `reminder:item_en_route:en_route:${itemIdShort}:${orderId.slice(0, 8)}:${quotationNumber}` },
          { text: `📦 ${itemName} — Arrived`, callback_data: `reminder:item_en_route:arrived:${itemIdShort}:${orderId.slice(0, 8)}:${quotationNumber}` },
        ],
        [
          { text: `⏳ ${itemName} — Not Yet`, callback_data: `reminder:item_en_route:not_yet:${itemIdShort}:${orderId.slice(0, 8)}:${quotationNumber}` },
        ],
      ]);
    } else if (reminder.stage === 'en_route_midpoint') {
      // Midpoint check — sent to production group, asks if still on track
      const orderRows = await query(
        `SELECT inventory_en_route_at, estimated_inventory_arrival_days FROM orders WHERE id = $1`,
        [reminder.order_id]
      );
      const enRouteAt = orderRows[0]?.inventory_en_route_at;
      const totalDays = orderRows[0]?.estimated_inventory_arrival_days ?? 28;
      const estimatedArrival = enRouteAt
        ? new Date(new Date(enRouteAt).getTime() + totalDays * 86_400_000)
            .toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })
        : 'Unknown';
      const midpointText =
        `✅ <b>En Route Midpoint Check</b>\n\n` +
        `Quotation: <b>${quotationNumber}</b>\n` +
        `Client: ${reminder.client_name ?? 'Unknown'}\n\n` +
        `Estimated arrival: <b>${estimatedArrival}</b>\n\n` +
        `Is the shipment still on track? No delays expected?`;
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, midpointText, [
        [
          { text: '✅ Yes, on track', callback_data: `en_route_mid:ontime:${quotationNumber}` },
          { text: '⚠️ No, it\'s delayed', callback_data: `en_route_mid:delay:${quotationNumber}` },
        ],
      ]);
    } else if (reminder.stage === 'en_route_arrival') {
      // Arrival check — sent to delivery/inventory group
      const orderRows = await query(
        `SELECT inventory_en_route_at, estimated_inventory_arrival_days FROM orders WHERE id = $1`,
        [reminder.order_id]
      );
      const enRouteAt = orderRows[0]?.inventory_en_route_at;
      const totalDays = orderRows[0]?.estimated_inventory_arrival_days ?? 28;
      const estimatedArrival = enRouteAt
        ? new Date(new Date(enRouteAt).getTime() + totalDays * 86_400_000)
            .toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })
        : 'today';
      const arrivalText =
        `📦 <b>En Route Arrival Check</b>\n\n` +
        `Quotation: <b>${quotationNumber}</b>\n` +
        `Client: ${reminder.client_name ?? 'Unknown'}\n\n` +
        `Estimated arrival date: <b>${estimatedArrival}</b>\n\n` +
        `Has the inventory arrived?`;
      ok = await sendTelegramInlineKeyboard(reminder.group_chat_id, arrivalText, [
        [
          { text: '✅ Yes, arrived!', callback_data: `en_route_arr:yes:${quotationNumber}` },
          { text: '⏳ Not yet', callback_data: `en_route_arr:no:${quotationNumber}` },
        ],
      ]);
    } else {
      // Standard reminder — plain text
      ok = await sendTelegramMessage(reminder.group_chat_id, text);
    }

    if (ok) {
      sent++;

      // For once-frequency timed reminders, mark as completed after sending.
      // These will be re-created by the bot callback handlers if rescheduled.
      if (reminder.stage === 'production_midpoint' || reminder.stage === 'production_due' ||
          reminder.stage === 'en_route_midpoint' || reminder.stage === 'en_route_arrival') {
        await query(
          `UPDATE reminders SET status = 'completed', updated_at = NOW() WHERE id = $1`,
          [reminder.id]
        );
      } else {
        const nextRun = nextPhtReminderTime();
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
    } else {
      // Send failed — reschedule for 1 hour later to retry instead of leaving it stuck forever
      console.error(`[processDueReminders] Failed to send reminder ${reminder.id} (stage: ${reminder.stage}) to chat ${reminder.group_chat_id} — rescheduling in 1 hour`);
      const retryAt = new Date();
      retryAt.setHours(retryAt.getHours() + 1);
      await query(
        `UPDATE reminders
         SET next_run_at = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [retryAt.toISOString(), reminder.id]
      );
    }
  }

  return sent;
}

/**
 * Create a reminder for an order when it enters a new stage.
 * Uses ON CONFLICT DO NOTHING — will not overwrite an existing reminder.
 */
export async function createStageReminder(
  orderId: string,
  stage: string,
  groupChatId: string,
  message: string,
  frequency: string = 'daily'
): Promise<void> {
  const firstRun = nextPhtReminderTime();

  await query(
    `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')
     ON CONFLICT DO NOTHING`,
    [orderId, stage, groupChatId, message, frequency, firstRun.toISOString()]
  );
}

/**
 * Upsert a stage reminder — creates if missing, updates group_chat_id and message if existing.
 * Use when a stage change should ALWAYS route the reminder to a specific group
 * (e.g. deposit verified → reminder must go to production group, not purchasing group).
 */
export async function upsertStageReminder(
  orderId: string,
  stage: string,
  groupChatId: string,
  message: string,
  frequency: string = 'daily'
): Promise<void> {
  const firstRun = nextPhtReminderTime();

  await query(
    `INSERT INTO reminders (order_id, stage, group_chat_id, message, frequency, next_run_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')
     ON CONFLICT (order_id, stage) WHERE item_id IS NULL DO UPDATE SET
       group_chat_id = EXCLUDED.group_chat_id,
       message       = EXCLUDED.message,
       next_run_at   = CASE
                         WHEN reminders.next_run_at <= NOW() THEN EXCLUDED.next_run_at
                         ELSE LEAST(reminders.next_run_at, EXCLUDED.next_run_at)
                       END,
       updated_at    = NOW()`,
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

let reminderTimer: NodeJS.Timeout | null = null;
let reminderRunning = false;
let reminderShuttingDown = false;

function scheduleNext(intervalMs: number): void {
  if (reminderShuttingDown) return;
  reminderTimer = setTimeout(() => {
    runReminderTick(intervalMs);
  }, intervalMs);
}

async function runReminderTick(intervalMs: number): Promise<void> {
  if (reminderRunning || reminderShuttingDown) {
    scheduleNext(intervalMs);
    return;
  }
  reminderRunning = true;
  try {
    const count = await processDueReminders();
    if (count > 0) {
      console.log(`[ReminderScheduler] Sent ${count} reminder(s)`);
    }
  } catch (err) {
    console.error('[ReminderScheduler] Error:', err);
  } finally {
    reminderRunning = false;
    scheduleNext(intervalMs);
  }
}

/**
 * Start the reminder scheduler loop.
 * Checks for due reminders every 60 seconds.
 * Uses setTimeout instead of setInterval to prevent overlapping runs.
 */
export function startReminderScheduler(intervalMs: number = 60_000): void {
  console.log(`[ReminderScheduler] Started — checking every ${intervalMs / 1000}s`);
  reminderShuttingDown = false;

  // Run immediately on start
  processDueReminders().then((count) => {
    if (count > 0) console.log(`[ReminderScheduler] Sent ${count} reminder(s) on startup`);
  }).finally(() => {
    scheduleNext(intervalMs);
  });
}

export function stopReminderScheduler(): void {
  reminderShuttingDown = true;
  if (reminderTimer) {
    clearTimeout(reminderTimer);
    reminderTimer = null;
    console.log('[ReminderScheduler] Stopped');
  }
}

export async function waitForReminders(timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (!reminderRunning || Date.now() - start > timeoutMs) {
        if (reminderRunning) {
          console.warn('[ReminderScheduler] Still running after timeout — forcing shutdown');
        }
        resolve();
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });
}
