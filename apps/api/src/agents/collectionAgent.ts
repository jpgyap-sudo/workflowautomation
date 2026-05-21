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
  getGroupChatId,
} from '../services/agentRunner.js';

/**
 * collection-agent
 *
 * Role: Tracks payment collection for all stages.
 * - Checks orders at quotation_received → production_pending stages
 *   where deposit hasn't been paid
 *   → Sends reminders to the collection group to collect deposit
 * - Checks orders at delivered or countered stage where payment hasn't been received
 *   → Sends reminders to collect final payment
 * - Escalates after repeated reminders
 */
export async function runCollectionAgent(): Promise<AgentResult[]> {
  const results: AgentResult[] = [];

  // ── Phase 1: Deposit Collection (order_confirmation_received → production_pending without deposit) ──
  const depositOrders = await getActiveOrdersByStages([
    'quotation_received',
    'order_confirmation_received',
    'math_verified',
    'purchasing_pending',
    'production_pending',
  ]);
  for (const order of depositOrders) {
    // Only process orders that haven't paid deposit yet
    if (order.deposit_paid) continue;

    const result = await checkDepositCollection(order);
    if (result.reminder_needed) {
      const groupChatId = getGroupChatId('collection-agent');
      if (groupChatId) {
        await createReminder(order.id, 'deposit_pending', groupChatId, result.message);
        await notifyCollection(groupChatId, order, result);
      }
    }
    results.push(result);
  }

  // ── Phase 2: Final Payment Collection (delivered/countered) ──
  const paymentOrders = await getActiveOrdersByStages(['delivered', 'countered']);
  for (const order of paymentOrders) {
    // Skip if balance already paid (e.g., full payment upfront or paid at inventory_arrived stage)
    if (order.balance_paid) continue;

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

/**
 * Check an order at purchasing_pending stage for deposit collection.
 * Sends a reminder asking if the deposit has been collected.
 */
export async function checkDepositCollection(order: OrderRow): Promise<AgentResult> {
  const input = {
    quotation_number: order.quotation_number,
    current_stage: order.current_stage,
    total_amount: order.total_amount,
    deposit_paid: order.deposit_paid,
  };

  try {
    const escalationLevel = await getEscalationLevel(order.id, 'deposit_pending');
    const total = order.total_amount ? Number(order.total_amount) : null;
    const expectedDeposit = total !== null ? total / 2 : null;

    if (escalationLevel >= 3) {
      const result: AgentResult = {
        status: 'blocked',
        message: `🔴 Downpayment not yet collected after ${escalationLevel} reminders. Manager intervention required. Expected downpayment: ${expectedDeposit !== null ? `₱${expectedDeposit.toLocaleString()}` : 'N/A'}.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };

      await logAgentAction('collection-agent', input, result, 'blocked', order.id);
      return result;
    }

    const depositInfo = expectedDeposit !== null
      ? `Expected downpayment (50%): ₱${expectedDeposit.toLocaleString()}`
      : 'Total amount not yet set';

    const result: AgentResult = {
      status: 'needs_review',
      message: `Downpayment collection pending. ${depositInfo}. Please upload the deposit slip to record payment.`,
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
      message: `❌ Error checking deposit collection for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
      next_stage: null,
      reminder_needed: true,
      escalation_level: 0,
    };

    await logAgentAction('collection-agent', input, result, 'error', order.id, errorMsg);
    return result;
  }
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
    // If balance is already paid, no reminder needed
    if (order.balance_paid) {
      const result: AgentResult = {
        status: 'complete',
        message: `✅ Balance already paid for #${order.quotation_number ?? 'unknown'}. No collection action needed.`,
        next_stage: null,
        reminder_needed: false,
        escalation_level: 0,
      };

      await logAgentAction('collection-agent', input, result, 'completed', order.id);
      return result;
    }

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
      message: `Payment collection pending. ${paymentInfo}.`,
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
  const msg = buildAgentMessage('Collection Agent', order, result.message, result.escalation_level);
  const qn = order.quotation_number;
  const id = order.id;

  let keyboard: Record<string, unknown> | undefined;
  if (qn && result.status === 'needs_review') {
    if (!order.deposit_paid) {
      keyboard = inlineKeyboard([
        [
          { text: '✅ Upload Deposit Slip', callback_data: `deposit:yes:${id}:${qn}` },
          { text: '⏳ Not Yet', callback_data: `deposit:no:${id}:${qn}` },
        ],
      ]);
    } else if (!order.balance_paid) {
      keyboard = inlineKeyboard([
        [{ text: '💵 Record Payment', callback_data: `pick:payment:${qn}` }],
      ]);
    }
    // If both deposit_paid and balance_paid are true, no buttons needed — payment is complete
  }

  await sendTelegramMessage(groupChatId, msg, keyboard);
}
