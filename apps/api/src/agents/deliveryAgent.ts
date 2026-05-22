import {
  type AgentResult,
  type OrderRow,
  logAgentAction,
  sendTelegramMessage,
  buildAgentMessage,
  inlineKeyboard,
  createReminder,
  getActiveOrdersByStage,
  getEscalationLevel,
  getGroupChatId,
} from '../services/agentRunner.js';
import { query } from '../db.js';

/**
 * delivery-agent
 *
 * Role: Tracks delivery scheduling and delivery status.
 * - Checks orders at delivery_pending stage — asks if delivery has been scheduled yet
 * - Checks orders at delivery_scheduled stage:
 *   - 1 day before delivery: asks "Are we ready for delivery tomorrow?"
 *   - On delivery day: asks "Has the item been delivered?"
 *   - If not delivered: asks for new schedule
 *
 * NOTE: Inventory arrival confirmation is handled by the Inventory Agent.
 *       Balance collection is handled by the Collection Agent.
 */
export async function runDeliveryAgent(): Promise<AgentResult[]> {
  const results: AgentResult[] = [];

  // Check orders at delivery_pending stage — needs delivery date input
  const pendingOrders = await getActiveOrdersByStage('delivery_pending');
  for (const order of pendingOrders) {
    const result = await checkDeliveryPending(order);
    if (result.reminder_needed) {
      const groupChatId = getGroupChatId('delivery-agent');
      if (groupChatId) {
        await createReminder(order.id, 'delivery_pending', groupChatId, result.message);
        await notifyDelivery(groupChatId, order, result);
      }
    }
    results.push(result);
  }

  // Check orders at delivery_scheduled stage
  const scheduledOrders = await getActiveOrdersByStage('delivery_scheduled');
  for (const order of scheduledOrders) {
    const result = await checkScheduledDelivery(order);
    if (result.reminder_needed) {
      const groupChatId = getGroupChatId('delivery-agent');
      if (groupChatId) {
        await createReminder(order.id, 'delivery_scheduled', groupChatId, result.message);
        await notifyDelivery(groupChatId, order, result);
      }
    }
    results.push(result);
  }

  return results;
}

/**
 * Check orders at delivery_pending stage.
 * These are orders where balance has been verified but no delivery date has been set yet.
 * The agent asks the team to input the estimated delivery date.
 */
export async function checkDeliveryPending(order: OrderRow): Promise<AgentResult> {
  const input = {
    quotation_number: order.quotation_number,
    current_stage: order.current_stage,
  };

  try {
    const escalationLevel = await getEscalationLevel(order.id, 'delivery_pending');

    if (escalationLevel >= 3) {
      const result: AgentResult = {
        status: 'blocked',
        message: `🔴 Delivery date not set after ${escalationLevel} reminders. Manager intervention required.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };

      await logAgentAction('delivery-agent', input, result, 'blocked', order.id);
      return result;
    }

    const result: AgentResult = {
      status: 'needs_review',
      message: `Has the delivery been scheduled yet? Please input the estimated delivery date so we can schedule delivery.`,
      next_stage: null,
      reminder_needed: true,
      escalation_level: escalationLevel,
    };

    await logAgentAction('delivery-agent', input, result, 'needs_review', order.id);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const result: AgentResult = {
      status: 'blocked',
      message: `❌ Error checking delivery pending for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
      next_stage: null,
      reminder_needed: true,
      escalation_level: 0,
    };

    await logAgentAction('delivery-agent', input, result, 'error', order.id, errorMsg);
    return result;
  }
}

/**
 * Check orders at delivery_scheduled stage.
 * - 1 day before delivery: asks "Are we ready for delivery tomorrow?"
 * - On delivery day: asks "Has the item been delivered?"
 * - If delivery date is past due: asks for new schedule
 */
export async function checkScheduledDelivery(order: OrderRow): Promise<AgentResult> {
  const input = {
    quotation_number: order.quotation_number,
    current_stage: order.current_stage,
  };

  try {
    const escalationLevel = await getEscalationLevel(order.id, 'delivery_scheduled');

    if (escalationLevel >= 3) {
      const result: AgentResult = {
        status: 'blocked',
        message: `🔴 Delivery scheduled but not yet delivered after ${escalationLevel} reminders. Manager intervention required.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };

      await logAgentAction('delivery-agent', input, result, 'blocked', order.id);
      return result;
    }

    // Check if there's a delivery_date set on the order
    const orderWithDate = await query(
      `SELECT delivery_date FROM orders WHERE id = $1`,
      [order.id]
    );
    const deliveryDate = orderWithDate[0]?.delivery_date;

    if (!deliveryDate) {
      // No delivery date set — this shouldn't happen if we go through delivery_pending,
      // but handle it gracefully
      const result: AgentResult = {
        status: 'needs_review',
        message: `Delivery is scheduled but no delivery date has been set. Please input the estimated delivery date.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };

      await logAgentAction('delivery-agent', input, result, 'needs_review', order.id);
      return result;
    }

    // Calculate days until delivery
    const now = new Date();
    const deliveryDateObj = new Date(deliveryDate);
    const diffTime = deliveryDateObj.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 1) {
      // More than 1 day away — no reminder needed yet
      const result: AgentResult = {
        status: 'ok',
        message: `Delivery scheduled for ${deliveryDateObj.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })} (${diffDays} days away). No action needed yet.`,
        next_stage: null,
        reminder_needed: false,
        escalation_level: escalationLevel,
      };

      await logAgentAction('delivery-agent', input, result, 'ok', order.id);
      return result;
    }

    if (diffDays === 1) {
      // 1 day before delivery — ask "Are we ready for delivery tomorrow?"
      const result: AgentResult = {
        status: 'needs_review',
        message: `Delivery is scheduled for <b>tomorrow</b> (${deliveryDateObj.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })}). Are we ready for the delivery schedule tomorrow?`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };

      await logAgentAction('delivery-agent', input, result, 'needs_review', order.id);
      return result;
    }

    if (diffDays === 0) {
      // On delivery day — ask "Has the item been delivered?"
      const result: AgentResult = {
        status: 'needs_review',
        message: `Delivery is scheduled for <b>today</b> (${deliveryDateObj.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })}). Has the item been delivered?`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };

      await logAgentAction('delivery-agent', input, result, 'needs_review', order.id);
      return result;
    }

    // Past due — ask for new schedule
    const result: AgentResult = {
      status: 'needs_review',
      message: `Delivery was scheduled for ${deliveryDateObj.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })} but has not been delivered yet (${Math.abs(diffDays)} day(s) overdue). Please provide a new delivery schedule.`,
      next_stage: null,
      reminder_needed: true,
      escalation_level: escalationLevel,
    };

    await logAgentAction('delivery-agent', input, result, 'needs_review', order.id);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const result: AgentResult = {
      status: 'blocked',
      message: `❌ Error checking delivery for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
      next_stage: null,
      reminder_needed: true,
      escalation_level: 0,
    };

    await logAgentAction('delivery-agent', input, result, 'error', order.id, errorMsg);
    return result;
  }
}

async function getStageUpdates(orderId: string, stage: string): Promise<any[]> {
  return query(
    `SELECT remarks, created_at FROM stage_updates
     WHERE order_id = $1 AND stage = $2
     ORDER BY created_at DESC LIMIT 5`,
    [orderId, stage],
  );
}

export async function notifyDelivery(
  groupChatId: string,
  order: OrderRow,
  result: AgentResult,
): Promise<void> {
  // Build delivery info suffix with address/contact details
  let deliveryInfo = '';
  if ((order as any).delivery_address || (order as any).contact_number) {
    const parts: string[] = [];
    if ((order as any).delivery_address) parts.push(`📍 *Address:* ${(order as any).delivery_address}`);
    if ((order as any).contact_number) parts.push(`📞 *Contact:* ${(order as any).contact_number}`);
    if ((order as any).authorized_receiver_name) {
      let receiver = `👤 *Receiver:* ${(order as any).authorized_receiver_name}`;
      if ((order as any).authorized_receiver_contact) receiver += ` (${(order as any).authorized_receiver_contact})`;
      parts.push(receiver);
    }
    deliveryInfo = `\n🚚 ${parts.join(' | ')}`;
  }

  const msg = buildAgentMessage('Delivery Agent', order, result.message + deliveryInfo, result.escalation_level);
  const qn = order.quotation_number;
  const id = order.id;

  let keyboard: Record<string, unknown> | undefined;
  if (qn && result.status === 'needs_review') {
    if (order.current_stage === 'delivery_pending') {
      // Delivery pending — ask to schedule delivery
      keyboard = inlineKeyboard([
        [
          { text: '📅 Schedule Delivery', callback_data: `delivery:schedule:${id}:${qn}` },
        ],
      ]);
    } else if (order.current_stage === 'delivery_scheduled') {
      // Check if it's delivery day or past due
      keyboard = inlineKeyboard([
        [
          { text: '✅ Yes, Delivered!', callback_data: `delivery:yes:${id}:${qn}` },
          { text: '❌ Not Yet', callback_data: `delivery:no:${id}:${qn}` },
        ],
      ]);
    }
  }

  await sendTelegramMessage(groupChatId, msg, keyboard);
}
