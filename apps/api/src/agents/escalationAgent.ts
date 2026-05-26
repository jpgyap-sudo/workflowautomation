import {
  type AgentResult,
  type OrderRow,
  logAgentAction,
  sendTelegramMessage,
  buildAgentMessage,
  inlineKeyboard,
  createReminder,
  getActiveOrdersByStages,
  getEscalationLevel,
  daysSince,
  getGroupChatId,
} from '../services/agentRunner.js';

/**
 * escalation-agent
 *
 * Role: Monitors all active orders for stalled stages and escalates when
 * reminders have been ignored for too long.
 *
 * This agent runs independently and checks ALL active orders, not just
 * specific stages. It looks for orders where:
 * 1. Escalation level >= 3 (3+ reminders sent with no update)
 * 2. Order has been in the same stage for > 7 days
 *
 * Excludes terminal stages: payment_received, payment_confirmed, completed
 */
export async function runEscalationAgent(): Promise<AgentResult[]> {
  const results: AgentResult[] = [];

  // Check ALL active orders across all non-terminal stages
  const stages = [
    'order_confirmation_received',
    'math_verified',
    'purchasing_pending',
    'production_pending',
    'production_in_progress',
    'en_route',
    'en_route_verification',
    'inventory_verification',
    'deposit_pending',
    'deposit_verification',
    'inventory_arrived',
    'balance_due',
    'balance_verification',
    'delivery_pending',
    'delivery_scheduled',
    'delivered',
    'countered',
  ];

  const orders = await getActiveOrdersByStages(stages);

  for (const order of orders) {
    const result = await checkEscalation(order);
    if (result.reminder_needed) {
      const groupChatId = getGroupChatId('escalation-agent');
      if (groupChatId) {
        await createReminder(order.id, order.current_stage, groupChatId, result.message);
        await notifyEscalation(groupChatId, order, result);
      }
    }
    results.push(result);
  }

  return results;
}

export async function checkEscalation(order: OrderRow): Promise<AgentResult> {
  const input = {
    quotation_number: order.quotation_number,
    current_stage: order.current_stage,
    days_in_stage: daysSince(order.updated_at),
  };

  try {
    const escalationLevel = await getEscalationLevel(order.id, order.current_stage);
    const daysInStage = daysSince(order.updated_at);

    // Check if order has been stuck for too long
    if (daysInStage >= 7 && escalationLevel >= 3) {
      // Critical escalation — notify manager
      const result: AgentResult = {
        status: 'blocked',
        message: `🚨 *CRITICAL ESCALATION* — Order has been at "${order.current_stage}" for ${daysInStage} days with ${escalationLevel} reminders sent. Immediate manager attention required!`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };

      await logAgentAction('escalation-agent', input, result, 'blocked', order.id);
      return result;
    }

    // Check if order has been stuck for a while but not yet escalated
    if (daysInStage >= 5 && escalationLevel < 3) {
      const result: AgentResult = {
        status: 'needs_review',
        message: `⚠️ Order has been at "${order.current_stage}" for ${daysInStage} days. Please provide an update or escalate if blocked.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };

      await logAgentAction('escalation-agent', input, result, 'needs_review', order.id);
      return result;
    }

    // Everything is within normal bounds
    const result: AgentResult = {
      status: 'ok',
      message: `Order progressing normally at "${order.current_stage}" (${daysInStage} days). No escalation needed.`,
      next_stage: null,
      reminder_needed: false,
      escalation_level: 0,
    };

    await logAgentAction('escalation-agent', input, result, 'success', order.id);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const result: AgentResult = {
      status: 'blocked',
      message: `❌ Error checking escalation for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
      next_stage: null,
      reminder_needed: true,
      escalation_level: 0,
    };

    await logAgentAction('escalation-agent', input, result, 'error', order.id, errorMsg);
    return result;
  }
}

export async function notifyEscalation(
  groupChatId: string,
  order: OrderRow,
  result: AgentResult,
): Promise<void> {
  const msg = buildAgentMessage(
    'Escalation Agent',
    order,
    result.message,
    result.escalation_level,
  );

  const qn = order.quotation_number;
  const id = order.id;

  let keyboard: Record<string, unknown> | undefined;
  if (qn && result.status !== 'ok') {
    switch (order.current_stage) {
      case 'purchasing_pending':
        keyboard = inlineKeyboard([
          [
            { text: '✅ Yes, started', callback_data: `produce:yes:${qn}` },
            { text: '⚠️ Partial', callback_data: `produce:partial:${qn}` },
            { text: '⏳ Not yet', callback_data: `produce:no:${qn}` },
          ],
        ]);
        break;
      case 'deposit_pending':
        keyboard = inlineKeyboard([
          [
            { text: '✅ Upload Deposit Slip', callback_data: `deposit:yes:${id.slice(0, 8)}:${qn}` },
            { text: '⏳ Not Yet', callback_data: `deposit:no:${id.slice(0, 8)}:${qn}` },
          ],
        ]);
        break;
      case 'deposit_verification':
        keyboard = inlineKeyboard([
          [
            { text: '🔍 Verify Deposit', callback_data: `verify:deposit:${id.slice(0, 8)}:${qn}` },
          ],
        ]);
        break;
      case 'inventory_verification':
        keyboard = inlineKeyboard([
          [
            { text: '✅ Complete Verification', callback_data: `inv_verify:complete:${id.slice(0, 8)}:${qn}` },
          ],
          [
            { text: '⏳ Not Yet', callback_data: `inv_verify:pending:${id.slice(0, 8)}:${qn}` },
          ],
        ]);
        break;
      case 'inventory_arrived':
        keyboard = inlineKeyboard([
          [
            { text: '✅ Ready for Delivery', callback_data: `inventory:ready:${id.slice(0, 8)}:${qn}` },
            { text: '⏳ Still Waiting', callback_data: `inventory:waiting:${id.slice(0, 8)}:${qn}` },
          ],
        ]);
        break;
      case 'balance_due':
        keyboard = inlineKeyboard([
          [
            { text: '✅ Client Paid Balance', callback_data: `balance:paid:${id.slice(0, 8)}:${qn}` },
            { text: '❌ Not Yet', callback_data: `balance:not_paid:${id.slice(0, 8)}:${qn}` },
          ],
        ]);
        break;
      case 'balance_verification':
        keyboard = inlineKeyboard([
          [
            { text: '🔍 Verify Balance', callback_data: `verify:balance:${id.slice(0, 8)}:${qn}` },
          ],
        ]);
        break;
      case 'delivery_scheduled':
        keyboard = inlineKeyboard([
          [
            { text: '✅ Yes, Delivered!', callback_data: `delivery:yes:${id.slice(0, 8)}:${qn}` },
            { text: '❌ Not Yet', callback_data: `delivery:no:${id.slice(0, 8)}:${qn}` },
          ],
        ]);
        break;
      case 'delivered':
      case 'countered':
        keyboard = inlineKeyboard([
          [{ text: '💵 Record Payment', callback_data: `pick:payment:${qn}` }],
        ]);
        break;
    }
  }

  await sendTelegramMessage(groupChatId, msg, keyboard);
}
