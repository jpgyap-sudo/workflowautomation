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
import { query } from '../db.js';

/**
 * collection-agent
 *
 * Role: Tracks payment collection for all stages.
 * Phase 1: Deposit Collection — reminds team to collect downpayment
 * Phase 2: Deposit Verification — reminds team to verify submitted deposit
 * Phase 3: Final Payment Collection — reminds team to collect balance
 * Phase 4: Balance Verification — reminds team to verify submitted balance payment
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
    // Stock replenishment orders never need a deposit — skip entirely
    if ((order as any).order_type === 'stock_replenishment') continue;

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

  // ── Phase 2: Deposit Verification (deposit_paid=TRUE, deposit_verified=FALSE) ──
  const unverifiedDeposits = await query<OrderRow>(
    `SELECT * FROM orders
     WHERE deposit_paid = TRUE AND deposit_verified = FALSE AND status = 'active'
     ORDER BY updated_at ASC`,
  );
  for (const order of unverifiedDeposits) {
    const result = await checkDepositVerification(order);
    if (result.reminder_needed) {
      const groupChatId = getGroupChatId('collection-agent');
      if (groupChatId) {
        await createReminder(order.id, 'deposit_verification', groupChatId, result.message);
        await notifyCollection(groupChatId, order, result);
      }
    }
    results.push(result);
  }

  // ── Phase 3: Final Payment Collection (balance_due, delivered, countered) ──
  // NOTE: inventory_arrived stage is handled by the Inventory Agent.
  //       Collection agent only starts balance collection once the stage advances to balance_due.
  const paymentOrders = await getActiveOrdersByStages(['balance_due', 'delivered', 'countered']);
  for (const order of paymentOrders) {
    // Skip if balance already paid or verified (e.g., full payment upfront, paid at inventory_arrived, or verified but stage stuck)
    if (order.balance_paid || order.balance_verified) continue;

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

  // ── Phase 4: Balance Verification (balance_paid=TRUE, balance_verified=FALSE) ──
  const unverifiedBalances = await query<OrderRow>(
    `SELECT * FROM orders
     WHERE balance_paid = TRUE AND balance_verified = FALSE AND status = 'active'
     ORDER BY updated_at ASC`,
  );
  for (const order of unverifiedBalances) {
    const result = await checkBalanceVerification(order);
    if (result.reminder_needed) {
      const groupChatId = getGroupChatId('collection-agent');
      if (groupChatId) {
        await createReminder(order.id, 'balance_verification', groupChatId, result.message);
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

/**
 * Check orders where deposit_paid=TRUE but deposit_verified=FALSE.
 * Reminds the collection group to verify the deposit payment.
 */
export async function checkDepositVerification(order: OrderRow): Promise<AgentResult> {
  const input = {
    quotation_number: order.quotation_number,
    current_stage: order.current_stage,
    deposit_paid: order.deposit_paid,
    deposit_verified: order.deposit_verified,
    deposit_amount: order.deposit_amount,
  };

  try {
    const escalationLevel = await getEscalationLevel(order.id, 'deposit_verification');

    if (escalationLevel >= 3) {
      const result: AgentResult = {
        status: 'blocked',
        message: `🔴 Deposit not yet verified after ${escalationLevel} reminders. Manager intervention required. Deposit amount: ${order.deposit_amount ? `₱${Number(order.deposit_amount).toLocaleString()}` : 'N/A'}.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };

      await logAgentAction('collection-agent', input, result, 'blocked', order.id);
      return result;
    }

    const depositInfo = order.deposit_amount
      ? `₱${Number(order.deposit_amount).toLocaleString()}`
      : 'Amount not recorded';

    const result: AgentResult = {
      status: 'needs_review',
      message: `🔍 Deposit verification pending for #${order.quotation_number ?? 'unknown'}. A downpayment of ${depositInfo} has been submitted but NOT yet verified. Please check if the payment went through and verify via the dashboard.`,
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
      message: `❌ Error checking deposit verification for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
      next_stage: null,
      reminder_needed: true,
      escalation_level: 0,
    };

    await logAgentAction('collection-agent', input, result, 'error', order.id, errorMsg);
    return result;
  }
}

/**
 * Check orders where balance_paid=TRUE but balance_verified=FALSE.
 * Reminds the collection group to verify the balance payment.
 */
export async function checkBalanceVerification(order: OrderRow): Promise<AgentResult> {
  const input = {
    quotation_number: order.quotation_number,
    current_stage: order.current_stage,
    balance_paid: order.balance_paid,
    balance_verified: order.balance_verified,
    total_amount: order.total_amount,
    deposit_amount: order.deposit_amount,
  };

  try {
    const escalationLevel = await getEscalationLevel(order.id, 'balance_verification');

    if (escalationLevel >= 3) {
      const result: AgentResult = {
        status: 'blocked',
        message: `🔴 Balance not yet verified after ${escalationLevel} reminders. Manager intervention required.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };

      await logAgentAction('collection-agent', input, result, 'blocked', order.id);
      return result;
    }

    const total = order.total_amount ? Number(order.total_amount) : null;
    const deposit = order.deposit_amount ? Number(order.deposit_amount) : 0;
    const balanceDue = total !== null ? total - deposit : null;
    const balanceInfo = balanceDue !== null ? `₱${balanceDue.toLocaleString()}` : 'Amount not recorded';

    const result: AgentResult = {
      status: 'needs_review',
      message: `🔍 Balance verification pending for #${order.quotation_number ?? 'unknown'}. A balance payment of ${balanceInfo} has been submitted but NOT yet verified. Please check if the payment went through and verify via the dashboard.`,
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
      message: `❌ Error checking balance verification for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
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

  let keyboard: Record<string, unknown> | undefined;
  if (qn && result.status === 'needs_review') {
    if (!order.deposit_paid) {
      // Phase 1: Deposit not yet paid — show upload deposit slip button
      // Use short id (first 8 chars) to keep callback_data under Telegram's 64-byte limit
      keyboard = inlineKeyboard([
        [
          { text: '✅ Upload Deposit Slip', callback_data: `deposit:yes:${order.id.slice(0, 8)}:${qn}` },
          { text: '⏳ Not Yet', callback_data: `deposit:no:${order.id.slice(0, 8)}:${qn}` },
        ],
      ]);
    } else if (order.deposit_paid && !order.deposit_verified) {
      // Phase 2: Deposit paid but not verified — show verify button
      // Use quotation number only (no UUID) to stay under 64-byte limit
      keyboard = inlineKeyboard([
        [
          { text: '🔍 Verify Deposit', callback_data: `verify:deposit:${qn}` },
        ],
      ]);
    } else if (!order.balance_paid) {
      // Phase 3: Balance not yet paid — show record payment button
      keyboard = inlineKeyboard([
        [{ text: '💵 Record Payment', callback_data: `pick:payment:${qn}` }],
      ]);
    } else if (order.balance_paid && !order.balance_verified) {
      // Phase 4: Balance paid but not verified — show verify button
      // Use quotation number only (no UUID) to stay under 64-byte limit
      keyboard = inlineKeyboard([
        [
          { text: '🔍 Verify Balance', callback_data: `verify:balance:${qn}` },
        ],
      ]);
    }
  }

  await sendTelegramMessage(groupChatId, msg, keyboard);
}
