import {
  type AgentResult,
  type OrderRow,
  logAgentAction,
  sendTelegramMessage,
  buildAgentMessage,
  createReminder,
  advanceStage,
  getActiveOrdersByStage,
  getEscalationLevel,
  getGroupChatId,
} from '../services/agentRunner.js';
import { query } from '../db.js';

/**
 * inventory-agent
 *
 * Role: Tracks inventory arrival for orders at inventory_arrived stage.
 * - Checks if inventory photos/files have been uploaded
 * - Sends reminders if inventory hasn't arrived yet
 * - Escalates after repeated reminders
 * - Auto-advances to balance_due when inventory files are uploaded
 */
export async function runInventoryAgent(): Promise<AgentResult[]> {
  const results: AgentResult[] = [];

  // Check orders at inventory_arrived stage
  const orders = await getActiveOrdersByStage('inventory_arrived');

  for (const order of orders) {
    const result = await checkInventory(order);
    // Create reminder if needed
    if (result.reminder_needed) {
      const groupChatId = getGroupChatId('inventory-agent');
      if (groupChatId) {
        await createReminder(order.id, 'inventory_arrived', groupChatId, result.message);
        await notifyInventory(groupChatId, order, result);
      }
    }
    results.push(result);
  }

  return results;
}

export async function checkInventory(order: OrderRow): Promise<AgentResult> {
  const input = {
    quotation_number: order.quotation_number,
    current_stage: order.current_stage,
  };

  try {
    const escalationLevel = await getEscalationLevel(order.id, 'inventory_arrived');

    // Check if files have been uploaded for this order (inventory photos)
    const files = await getOrderFiles(order.id, 'inventory');

    if (files.length > 0) {
      // Inventory has arrived — auto-advance to balance_due
      await advanceStage(
        order.id,
        'balance_due',
        order.quotation_number ?? order.id,
        `Inventory arrived — ${files.length} file(s) uploaded. Auto-advanced to balance due.`,
      );

      const result: AgentResult = {
        status: 'ok',
        message: `📦 Inventory arrived — ${files.length} file(s) uploaded. Auto-advanced to balance due stage.`,
        next_stage: 'balance_due',
        reminder_needed: false,
        escalation_level: 0,
      };

      await logAgentAction('inventory-agent', input, result, 'success', order.id);
      return result;
    }

    // No inventory files yet
    if (escalationLevel >= 3) {
      const result: AgentResult = {
        status: 'blocked',
        message: `🔴 Inventory not yet arrived after ${escalationLevel} reminders. Manager intervention required.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };

      await logAgentAction('inventory-agent', input, result, 'blocked', order.id);
      return result;
    }

    const result: AgentResult = {
      status: 'needs_review',
      message: `Has the inventory arrived? Please upload photos/files of the received items.`,
      next_stage: null,
      reminder_needed: true,
      escalation_level: escalationLevel,
    };

    await logAgentAction('inventory-agent', input, result, 'needs_review', order.id);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const result: AgentResult = {
      status: 'blocked',
      message: `❌ Error checking inventory for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
      next_stage: null,
      reminder_needed: true,
      escalation_level: 0,
    };

    await logAgentAction('inventory-agent', input, result, 'error', order.id, errorMsg);
    return result;
  }
}

async function getOrderFiles(orderId: string, fileType: string): Promise<any[]> {
  return query(
    `SELECT id, original_filename, google_drive_file_id, created_at
     FROM files WHERE order_id = $1 AND file_type = $2
     ORDER BY created_at DESC`,
    [orderId, fileType],
  );
}

export async function notifyInventory(
  groupChatId: string,
  order: OrderRow,
  result: AgentResult,
): Promise<void> {
  const msg = buildAgentMessage(
    'Inventory Agent',
    order,
    result.message,
    result.escalation_level,
  );
  await sendTelegramMessage(groupChatId, msg);
}
