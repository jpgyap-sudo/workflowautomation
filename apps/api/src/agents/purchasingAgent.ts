import {
  type AgentResult,
  type OrderRow,
  logAgentAction,
  sendTelegramMessage,
  buildAgentMessage,
  createReminder,
  getActiveOrdersByStage,
  getEscalationLevel,
  daysSince,
  getGroupChatId,
} from '../services/agentRunner.js';

/**
 * purchasing-agent
 *
 * Role: Tracks purchasing/production status for orders at purchasing_pending stage.
 * - Sends daily reminders to the purchasing group
 * - Escalates after 3 reminders with no update
 * - Auto-advances when team confirms via /produce command (handled by bot.ts)
 * - Monitors production midpoint and due reminders for orders with production tracking
 */
export async function runPurchasingAgent(): Promise<AgentResult[]> {
  const results: AgentResult[] = [];

  // Check orders stuck at purchasing_pending
  const orders = await getActiveOrdersByStage('purchasing_pending');

  for (const order of orders) {
    const result = await checkPurchasing(order);
    // Create reminder if needed
    if (result.reminder_needed) {
      const groupChatId = getGroupChatId('purchasing-agent');
      if (groupChatId) {
        await createReminder(order.id, 'purchasing_pending', groupChatId, result.message);
        await notifyPurchasing(groupChatId, order, result);
      }
    }
    results.push(result);
  }

  return results;
}

export async function checkPurchasing(order: OrderRow): Promise<AgentResult> {
  const input = {
    quotation_number: order.quotation_number,
    current_stage: order.current_stage,
    days_since_creation: daysSince(order.created_at),
    production_started: order.production_started,
    production_started_at: order.production_started_at,
    estimated_production_days: order.estimated_production_days,
    production_delayed: order.production_delayed,
    production_delay_days: order.production_delay_days,
    production_finished: order.production_finished,
    production_finished_at: order.production_finished_at,
  };

  try {
    const escalationLevel = await getEscalationLevel(order.id, 'purchasing_pending');
    const daysWaiting = daysSince(order.created_at);

    // If production is finished → stop reminding entirely
    if (order.production_finished === true) {
      const result: AgentResult = {
        status: 'complete',
        message: `✅ Production for #${order.quotation_number ?? 'unknown'} is finished. No further purchasing reminders needed.`,
        next_stage: null,
        reminder_needed: false,
        escalation_level: escalationLevel,
      };
      await logAgentAction('purchasing-agent', input, result, 'complete', order.id);
      return result;
    }

    // If production was reported as delayed → log it and keep reminding
    if (order.production_delayed === true) {
      const delayMsg = order.production_delay_days
        ? ` (${order.production_delay_days} days delay reported)`
        : '';
      const result: AgentResult = {
        status: 'needs_review',
        message: `⚠️ Production for #${order.quotation_number ?? 'unknown'} is delayed${delayMsg}. Estimated ${order.estimated_production_days ?? '?'} days total.`,
        next_stage: null,
        reminder_needed: false,
        escalation_level: escalationLevel,
      };
      await logAgentAction('purchasing-agent', input, result, 'needs_review', order.id);
      return result;
    }

    // If production_started is true and estimated_production_days is set → production is fully tracked, stop reminding
    // The midpoint and due reminders are handled by the reminder scheduler + bot.ts callbacks
    if (order.production_started === true && order.estimated_production_days != null) {
      const result: AgentResult = {
        status: 'complete',
        message: `✅ Production for #${order.quotation_number ?? 'unknown'} has started and estimated at ${order.estimated_production_days} days. Midpoint and due reminders are active.`,
        next_stage: null,
        reminder_needed: false,
        escalation_level: escalationLevel,
      };
      await logAgentAction('purchasing-agent', input, result, 'complete', order.id);
      return result;
    }

    // If production_started is true but estimated_production_days is not set → ask about duration
    if (order.production_started === true && order.estimated_production_days == null) {
      const result: AgentResult = {
        status: 'needs_review',
        message: `🏭 Production has started for this order. How long is the estimated production time? (Standard: 4 weeks, or enter custom days)`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };
      await logAgentAction('purchasing-agent', input, result, 'needs_review', order.id);
      return result;
    }

    // If escalated 3+ times, flag for manager attention
    if (escalationLevel >= 3) {
      const result: AgentResult = {
        status: 'blocked',
        message: `🔴 Order stuck at purchasing for ${daysWaiting} days with ${escalationLevel} reminders sent. Manager intervention required.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };

      await logAgentAction('purchasing-agent', input, result, 'blocked', order.id);
      return result;
    }

    // production_started is false or null → keep reminding daily
    const result: AgentResult = {
      status: 'needs_review',
      message: `Has production started for this order? It's been ${daysWaiting} days since creation. Please confirm Yes or No.`,
      next_stage: null,
      reminder_needed: true,
      escalation_level: escalationLevel,
    };

    await logAgentAction('purchasing-agent', input, result, 'needs_review', order.id);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const result: AgentResult = {
      status: 'blocked',
      message: `❌ Error checking purchasing for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
      next_stage: null,
      reminder_needed: true,
      escalation_level: 0,
    };

    await logAgentAction('purchasing-agent', input, result, 'error', order.id, errorMsg);
    return result;
  }
}

export async function notifyPurchasing(
  groupChatId: string,
  order: OrderRow,
  result: AgentResult,
): Promise<void> {
  const msg = buildAgentMessage(
    'Purchasing Agent',
    order,
    result.message,
    result.escalation_level,
  );
  await sendTelegramMessage(groupChatId, msg);
}
