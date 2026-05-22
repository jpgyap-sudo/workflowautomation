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
 * - Checks orders at inventory_arrived stage — reminds that inventory arrived, quotation ready for delivery
 * - Checks orders at balance_due stage — asks daily if client paid balance
 * - Checks orders at delivery_scheduled stage — reminds if delivery date is approaching/passed
 * - Checks orders at delivered stage — reminds to confirm delivery
 */
export async function runDeliveryAgent(): Promise<AgentResult[]> {
  const results: AgentResult[] = [];

  // Check orders at inventory_arrived stage
  // NOTE: Balance collection is handled by the Collection Agent
  const inventoryArrivedOrders = await getActiveOrdersByStage('inventory_arrived');
  for (const order of inventoryArrivedOrders) {
    const result = await checkInventoryArrived(order);
    if (result.reminder_needed) {
      const groupChatId = getGroupChatId('delivery-agent');
      if (groupChatId) {
        await createReminder(order.id, 'inventory_arrived', groupChatId, result.message);
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
 * Check orders at inventory_arrived stage.
 * Notifies the delivery group that all items are complete and ready for delivery.
 * Balance collection is handled by the Collection Agent — delivery just coordinates.
 */
export async function checkInventoryArrived(order: OrderRow): Promise<AgentResult> {
  const input = {
    quotation_number: order.quotation_number,
    current_stage: order.current_stage,
  };

  try {
    const escalationLevel = await getEscalationLevel(order.id, 'inventory_arrived');

    if (escalationLevel >= 3) {
      const result: AgentResult = {
        status: 'blocked',
        message: `🔴 Inventory arrived but delivery not yet scheduled after ${escalationLevel} reminders. Manager intervention required.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };

      await logAgentAction('delivery-agent', input, result, 'blocked', order.id);
      return result;
    }

    const result: AgentResult = {
      status: 'needs_review',
      message: `📦 All items for quotation #${order.quotation_number ?? 'unknown'} are complete and ready for delivery.\n\n` +
        `Please coordinate with the **Collection Team** for balance payment collection and verification.\n` +
        `Once balance is confirmed, proceed with delivery scheduling.`,
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
      message: `❌ Error checking inventory arrival for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
      next_stage: null,
      reminder_needed: true,
      escalation_level: 0,
    };

    await logAgentAction('delivery-agent', input, result, 'error', order.id, errorMsg);
    return result;
  }
}

export async function checkScheduledDelivery(order: OrderRow): Promise<AgentResult> {
  const input = {
    quotation_number: order.quotation_number,
    current_stage: order.current_stage,
  };

  try {
    const escalationLevel = await getEscalationLevel(order.id, 'delivery_scheduled');

    // Check stage_updates for delivery date info
    const stageUpdates = await getStageUpdates(order.id, 'delivery_scheduled');
    const latestUpdate = stageUpdates[0];

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

    const dateInfo = latestUpdate?.remarks
      ? ` (Remarks: ${latestUpdate.remarks})`
      : '';

    const result: AgentResult = {
      status: 'needs_review',
      message: `Has the delivery been completed? Scheduled delivery is pending${dateInfo}.`,
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
  const msg = buildAgentMessage('Delivery Agent', order, result.message, result.escalation_level);
  const qn = order.quotation_number;
  const id = order.id;

  let keyboard: Record<string, unknown> | undefined;
  if (qn && result.status === 'needs_review') {
    switch (order.current_stage) {
      case 'inventory_arrived':
        keyboard = inlineKeyboard([
          [
            { text: '✅ Ready for Delivery', callback_data: `inventory:ready:${id}:${qn}` },
            { text: '⏳ Still Waiting', callback_data: `inventory:waiting:${id}:${qn}` },
          ],
        ]);
        break;
      case 'delivery_scheduled':
        keyboard = inlineKeyboard([
          [
            { text: '✅ Yes, Delivered!', callback_data: `delivery:yes:${id}:${qn}` },
            { text: '❌ Not Yet', callback_data: `delivery:no:${id}:${qn}` },
          ],
        ]);
        break;

    }
  }

  await sendTelegramMessage(groupChatId, msg, keyboard);
}
