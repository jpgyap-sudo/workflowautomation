import { query } from '../db.js';
import {
  type AgentResult,
  type OrderRow,
  logAgentAction,
  sendTelegramMessage,
  buildAgentMessage,
  advanceStage,
  createReminder,
  getActiveOrdersByStage,
  getGroupChatId,
} from '../services/agentRunner.js';

/**
 * quotation-checker agent
 *
 * Role: Checks quotation math when a new order is created.
 * Compares total_amount (quoted) vs computed_amount (computed from line items).
 * If they match → auto-advance to math_verified.
 * If they differ → flag for human review and create a reminder.
 */
export async function runQuotationChecker(): Promise<AgentResult[]> {
  const results: AgentResult[] = [];

  // Find orders at quotation_received stage that haven't been math-checked yet
  const orders = await getActiveOrdersByStage('quotation_received');

  for (const order of orders) {
    const result = await checkQuotation(order);
    // Create reminder if math needs review
    if (result.reminder_needed) {
      const groupChatId = getGroupChatId('quotation-checker');
      if (groupChatId) {
        await createReminder(order.id, 'quotation_received', groupChatId, result.message);
        await notifyQuotationCheck(groupChatId, order, result);
      }
    }
    results.push(result);
  }

  return results;
}

/**
 * Check a single order's quotation math.
 * Exposed as a separate function so it can also be called on-demand via API.
 */
export async function checkQuotation(order: OrderRow): Promise<AgentResult> {
  const input = {
    quotation_number: order.quotation_number,
    total_amount: order.total_amount,
    computed_amount: order.computed_amount,
  };

  try {
    const total = order.total_amount ? Number(order.total_amount) : null;
    const computed = order.computed_amount ? Number(order.computed_amount) : null;

    // If no computed_amount yet, we can't check — mark as needs_review
    if (total === null || computed === null) {
      const result: AgentResult = {
        status: 'needs_review',
        message: `Quotation #${order.quotation_number ?? 'unknown'} is missing amount data. Total: ${total !== null ? `₱${total.toLocaleString()}` : 'N/A'}, Computed: ${computed !== null ? `₱${computed.toLocaleString()}` : 'N/A'}. Manual review required.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: 0,
      };

      await logAgentAction('quotation-checker', input, result, 'needs_review', order.id);
      return result;
    }

    const difference = total - computed;
    const tolerance = 0.01; // Allow 1 centavo rounding difference
    const match = Math.abs(difference) <= tolerance;

    if (match) {
      // Math checks out — auto-advance to math_verified
      await advanceStage(order.id, 'math_verified', order.quotation_number ?? order.id, 'Quotation math verified automatically');

      const result: AgentResult = {
        status: 'ok',
        message: `✅ Math verified! Quoted: ₱${total.toLocaleString()}, Computed: ₱${computed.toLocaleString()}. Match confirmed.`,
        next_stage: 'math_verified',
        reminder_needed: false,
        escalation_level: 0,
      };

      await logAgentAction('quotation-checker', input, result, 'success', order.id);
      return result;
    }

    // Math mismatch — flag for review
    const result: AgentResult = {
      status: 'needs_review',
      message: `⚠️ Math mismatch! Quoted: ₱${total.toLocaleString()}, Computed: ₱${computed.toLocaleString()}, Difference: ₱${difference.toLocaleString()}. Manual review required.`,
      next_stage: null,
      reminder_needed: true,
      escalation_level: 0,
    };

    await logAgentAction('quotation-checker', input, result, 'needs_review', order.id);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const result: AgentResult = {
      status: 'blocked',
      message: `❌ Error checking quotation #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
      next_stage: null,
      reminder_needed: true,
      escalation_level: 0,
    };

    await logAgentAction('quotation-checker', input, result, 'error', order.id, errorMsg);
    return result;
  }
}

/**
 * Send a Telegram notification about a quotation check result.
 */
export async function notifyQuotationCheck(
  groupChatId: string,
  order: OrderRow,
  result: AgentResult,
): Promise<void> {
  const msg = buildAgentMessage(
    'Quotation Checker',
    order,
    result.message,
    result.escalation_level,
  );
  await sendTelegramMessage(groupChatId, msg);
}
