import {
  type AgentResult,
  type OrderRow,
  logAgentAction,
  sendTelegramMessage,
  buildAgentMessage,
  createReminder,
  getActiveOrdersByStages,
  getEscalationLevel,
  getGroupChatId,
} from '../services/agentRunner.js';

/**
 * collection-agent
 *
 * Role: Tracks payment collection for delivered/countered orders.
 * - Checks orders at delivered or countered stage where payment hasn't been received
 * - Sends reminders to collect payment
 * - Escalates after repeated reminders
 */
export async function runCollectionAgent(): Promise<AgentResult[]> {
  const results: AgentResult[] = [];

  // Check orders at delivered or countered stage (payment pending)
  const orders = await getActiveOrdersByStages(['delivered', 'countered']);

  for (const order of orders) {
    const result = await checkCollection(order);
    if (result.reminder_needed) {
      const groupChatId = getGroupChatId('collection-agent');
      if (groupChatId) {
        await createReminder(order.id, order.current_stage, groupChatId, result.message);
        await notifyCollection(groupChatId, order, result);
      }
    }
    results.push(result);
  }

  return results;
}

export async function checkCollection(order: OrderRow): Promise<AgentResult> {
  const input = {
    quotation_number: order.quotation_number,
    current_stage: order.current_stage,
    total_amount: order.total_amount,
    deposit_amount: order.deposit_amount,
    balance_paid: order.balance_paid,
  };

  try {
    const escalationLevel = await getEscalationLevel(order.id, order.current_stage);

    // Calculate expected payment
    const total = order.total_amount ? Number(order.total_amount) : null;
    const deposit = order.deposit_amount ? Number(order.deposit_amount) : 0;
    const balanceDue = total !== null ? total - deposit : null;

    if (escalationLevel >= 3) {
      const result: AgentResult = {
        status: 'blocked',
        message: `🔴 Payment not yet collected after ${escalationLevel} reminders. Manager intervention required. Balance due: ${balanceDue !== null ? `₱${balanceDue.toLocaleString()}` : 'N/A'}.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };

      await logAgentAction('collection-agent', input, result, 'blocked', order.id);
      return result;
    }

    const paymentInfo = balanceDue !== null
      ? `Balance due: ₱${balanceDue.toLocaleString()}`
      : 'Total amount not yet set';

    const result: AgentResult = {
      status: 'needs_review',
      message: `Payment collection pending. ${paymentInfo}. Please update with /payment when received.`,
      next_stage: null,
      reminder_needed: true,
      escalation_level: escalationLevel,
    };

    await logAgentAction('collection-agent', input, result, 'needs_review', order.id);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const result: AgentResult = {
      status: 'blocked',
      message: `❌ Error checking collection for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
      next_stage: null,
      reminder_needed: true,
      escalation_level: 0,
    };

    await logAgentAction('collection-agent', input, result, 'error', order.id, errorMsg);
    return result;
  }
}

export async function notifyCollection(
  groupChatId: string,
  order: OrderRow,
  result: AgentResult,
): Promise<void> {
  const msg = buildAgentMessage(
    'Collection Agent',
    order,
    result.message,
    result.escalation_level,
  );
  await sendTelegramMessage(groupChatId, msg);
}
