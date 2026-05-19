import {
  type AgentResult,
  type OrderRow,
  logAgentAction,
  sendTelegramMessage,
  buildAgentMessage,
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
 * - Checks orders at delivery_scheduled stage — reminds if delivery date is approaching/passed
 * - Checks orders at delivered stage — reminds to confirm delivery
 */
export async function runDeliveryAgent(): Promise<AgentResult[]> {
  const results: AgentResult[] = [];

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

  // Check orders at delivered stage
  const deliveredOrders = await getActiveOrdersByStage('delivered');
  for (const order of deliveredOrders) {
    const result = await checkDelivered(order);
    if (result.reminder_needed) {
      const groupChatId = getGroupChatId('delivery-agent');
      if (groupChatId) {
        await createReminder(order.id, 'delivered', groupChatId, result.message);
        await notifyDelivery(groupChatId, order, result);
      }
    }
    results.push(result);
  }

  return results;
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
      message: `Has the delivery been completed? Scheduled delivery is pending${dateInfo}. Please confirm with /delivered.`,
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

export async function checkDelivered(order: OrderRow): Promise<AgentResult> {
  const input = {
    quotation_number: order.quotation_number,
    current_stage: order.current_stage,
  };

  try {
    const escalationLevel = await getEscalationLevel(order.id, 'delivered');

    if (escalationLevel >= 3) {
      const result: AgentResult = {
        status: 'blocked',
        message: `🔴 Delivered but payment not yet received after ${escalationLevel} reminders. Manager intervention required.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };

      await logAgentAction('delivery-agent', input, result, 'blocked', order.id);
      return result;
    }

    const result: AgentResult = {
      status: 'needs_review',
      message: `Item has been delivered. Has payment been received? Please update with /payment.`,
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
      message: `❌ Error checking delivery status for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
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
  const msg = buildAgentMessage(
    'Delivery Agent',
    order,
    result.message,
    result.escalation_level,
  );
  await sendTelegramMessage(groupChatId, msg);
}
