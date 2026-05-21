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
  addAgentNote,
  inlineKeyboard,
} from '../services/agentRunner.js';
import { query } from '../db.js';
import {
  analyzeProductionOrder,
  type HermesProductionContext,
  isHermesAvailable,
} from '../services/hermesClaw.js';

/**
 * inventory-agent (Hermes Claw)
 *
 * Role: Tracks inventory arrival for orders at inventory_arrived stage.
 * - Checks if inventory photos/files have been uploaded
 * - Sends reminders if inventory hasn't arrived yet
 * - When files are uploaded, reminds inventory group to verify all products arrived
 * - Item-level tracking: asks about each item's arrival one by one (process of elimination)
 * - Tracks % completion of inventory per order
 * - When all items arrived → notifies that order is ready for delivery
 * - Inventory group confirms via "Ready for Delivery" button (advances to balance_due)
 * - Escalates after repeated reminders
 */

// ── Item-level tracking types ─────────────────────────────────────────

interface OrderItemRow {
  id: string;
  order_id: string;
  name: string;
  quantity: number;
  production_status: 'pending' | 'in_progress' | 'finished';
  en_route_status: 'not_yet' | 'en_route' | 'arrived';
  estimated_arrival_days: number | null;
}

const AGENT_NAME = 'inventory-agent';

// ── Helper: Fetch order_items ─────────────────────────────────────────

async function getOrderItems(orderId: string): Promise<OrderItemRow[]> {
  return query<OrderItemRow>(
    `SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
    [orderId],
  );
}

// ── Helper: Add production update log ─────────────────────────────────

async function addProductionLog(
  orderItemId: string | null,
  orderId: string,
  note: string,
  logType: string = 'agent',
  createdBy: string = AGENT_NAME,
): Promise<void> {
  await query(
    `INSERT INTO production_update_logs (order_item_id, order_id, note, log_type, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [orderItemId, orderId, note, logType, createdBy],
  );
}

// ── Helper: Calculate inventory completion % ──────────────────────────

function calculateInventoryPct(items: OrderItemRow[]): number {
  const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
  if (totalQty === 0) return 0;
  const arrivedQty = items
    .filter((i) => i.en_route_status === 'arrived')
    .reduce((sum, i) => sum + i.quantity, 0);
  return Math.round((arrivedQty / totalQty) * 100);
}

// ── Helper: Build progress bar ────────────────────────────────────────

function buildProgressBar(pct: number, width: number = 10): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

// ── Main Runner ───────────────────────────────────────────────────────

export async function runInventoryAgent(): Promise<AgentResult[]> {
  const results: AgentResult[] = [];

  const hermesAvailable = isHermesAvailable();
  if (hermesAvailable) {
    console.log('[InventoryAgent] 🧠 Hermes Claw AI is active — using Gemini for smarter analysis');
  } else {
    console.log('[InventoryAgent] Hermes Claw AI unavailable — using rule-based fallback');
  }

  // Check orders at inventory_arrived stage
  const orders = await getActiveOrdersByStage('inventory_arrived');

  for (const order of orders) {
    // First try item-level inventory tracking
    const itemResult = await checkItemLevelInventory(order);
    if (itemResult) {
      if (itemResult.reminder_needed) {
        const groupChatId = getGroupChatId(AGENT_NAME);
        if (groupChatId) {
          await createReminder(order.id, 'inventory_arrived', groupChatId, itemResult.message);
          await notifyInventory(groupChatId, order, itemResult);
        }
      }
      results.push(itemResult);
      continue; // Skip legacy check if item-level tracking handled it
    }

    // Fall back to legacy file-based check if no order_items
    const result = await checkInventory(order);
    if (result.reminder_needed) {
      const groupChatId = getGroupChatId(AGENT_NAME);
      if (groupChatId) {
        await createReminder(order.id, 'inventory_arrived', groupChatId, result.message);
        await notifyInventory(groupChatId, order, result);
      }
    }
    results.push(result);
  }

  return results;
}

// ── Item-Level Inventory Tracking (Hermes Claw) ───────────────────────

/**
 * Check item-level inventory arrival tracking with process of elimination.
 *
 * Strategy:
 * 1. Fetch all order_items for the order
 * 2. Calculate inventory completion % based on quantity
 * 3. Find the first item not yet arrived (process of elimination)
 * 4. Ask about that specific item
 * 5. If all items arrived → notify that order is ready for delivery
 * 6. If no items exist → return null (fall back to legacy check)
 */
async function checkItemLevelInventory(order: OrderRow): Promise<AgentResult | null> {
  const input = {
    quotation_number: order.quotation_number,
    stage: order.current_stage,
  };

  try {
    // Only run for inventory_arrived stage
    if (order.current_stage !== 'inventory_arrived') return null;

    // Fetch items
    const items = await getOrderItems(order.id);
    if (items.length === 0) return null; // No items to track — fall back to legacy

    const inventoryPct = calculateInventoryPct(items);
    const escalationLevel = await getEscalationLevel(order.id, 'inventory_arrived');

    // Find the first item not yet arrived (process of elimination)
    const notArrivedItem = items.find(
      (item) => item.en_route_status !== 'arrived',
    );

    const arrivedCount = items.filter((i) => i.en_route_status === 'arrived').length;
    const totalCount = items.length;

    // If all items have arrived — notify ready for delivery
    if (!notArrivedItem) {
      const qn = order.quotation_number ?? 'unknown';
      const client = order.client_name ?? 'Unknown';

      // Log the completion
      await addProductionLog(null, order.id, `✅ All items arrived at inventory (${inventoryPct}% of qty). Order ready for delivery.`, 'agent', AGENT_NAME);
      await addAgentNote(order.id, AGENT_NAME, `All ${items.length} item(s) arrived at inventory. Ready for delivery confirmation.`);

      // Send notification to inventory group
      const groupChatId = getGroupChatId(AGENT_NAME);
      if (groupChatId) {
        const msg = `📦 <b>All Items Arrived at Inventory</b>\n\nOrder #${qn} (${client})\nAll ${items.length} item(s) arrived (${inventoryPct}% of qty).\n\nReady for delivery! Please confirm below:`;

        const keyboard = inlineKeyboard([
          [
            { text: '✅ Ready for Delivery', callback_data: `inventory:ready:${order.id}:${qn}` },
            { text: '⏳ Still Waiting', callback_data: `inventory:waiting:${order.id}:${qn}` },
          ],
        ]);

        await sendTelegramMessage(groupChatId, msg, keyboard);
      }

      const result: AgentResult = {
        status: 'complete',
        message: `✅ All items arrived at inventory for #${qn} (${inventoryPct}% of qty). Ready for delivery confirmation.`,
        next_stage: null, // Don't auto-advance — wait for user confirmation
        reminder_needed: true,
        escalation_level: escalationLevel,
      };
      await logAgentAction(AGENT_NAME, input, result, 'complete', order.id);
      return result;
    }

    // ── Process of elimination: ask about the next not-arrived item ──
    const qn = order.quotation_number ?? 'unknown';
    const client = order.client_name ?? 'Unknown';
    const progressBar = buildProgressBar(inventoryPct);

    // Build Hermes context for smarter messaging
    const hermesCtx: HermesProductionContext = {
      quotation_number: order.quotation_number,
      client_name: order.client_name,
      sales_agent: order.sales_agent,
      stage: order.current_stage,
      production_started: order.production_started,
      production_started_at: order.production_started_at,
      estimated_production_days: order.estimated_production_days,
      production_delayed: order.production_delayed,
      production_finished: order.production_finished,
      production_finished_at: order.production_finished_at,
      en_route_confirmed: order.en_route_confirmed,
      quotation_text: null,
      estimated_arrival_days: order.estimated_arrival_days,
      days_in_stage: 0,
      pct_elapsed: inventoryPct,
      is_overdue: false,
      escalation_level: escalationLevel,
    };
    const hermesAnalysis = await analyzeProductionOrder(hermesCtx, order.id);

    let message = `📦 <b>Item-Level Inventory Check</b>\n`;
    message += `Order: #${qn} (${client})\n`;
    message += `Inventory: ${inventoryPct}% arrived ${progressBar}\n`;
    message += `Items: ${arrivedCount}/${totalCount} arrived\n\n`;

    if (hermesAnalysis) {
      message += `${hermesAnalysis.message}\n\n`;
    }

    message += `<b>Process of Elimination:</b>\n`;
    message += `Next item: <b>${notArrivedItem.name}</b> x${notArrivedItem.quantity}\n\n`;
    message += `Has <b>${notArrivedItem.name}</b> arrived at inventory?`;

    // Build inline keyboard for this specific item
    const keyboard = inlineKeyboard([
      [
        { text: `📦 ${notArrivedItem.name} — Arrived`, callback_data: `item_inventory:arrived:${notArrivedItem.id}:${order.id}` },
      ],
      [
        { text: `🚚 ${notArrivedItem.name} — En Route`, callback_data: `item_inventory:en_route:${notArrivedItem.id}:${order.id}` },
      ],
      [
        { text: `⏳ ${notArrivedItem.name} — Not Yet`, callback_data: `item_inventory:not_yet:${notArrivedItem.id}:${order.id}` },
      ],
    ]);

    // Send the message to the inventory group chat
    const groupChatId = getGroupChatId(AGENT_NAME);
    if (groupChatId) {
      await sendTelegramMessage(groupChatId, message, keyboard);
    }

    const result: AgentResult = {
      status: 'needs_review',
      message: `Item-level inventory check for #${qn}: ${arrivedCount}/${totalCount} arrived (${inventoryPct}% of qty). Asking about "${notArrivedItem.name}".`,
      next_stage: null,
      reminder_needed: true,
      escalation_level: escalationLevel,
    };
    await logAgentAction(AGENT_NAME, input, result, 'needs_review', order.id);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const result: AgentResult = {
      status: 'blocked',
      message: `❌ Error checking item-level inventory for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
      next_stage: null,
      reminder_needed: false,
      escalation_level: 0,
    };
    await logAgentAction(AGENT_NAME, input, result, 'error', order.id, errorMsg);
    return result;
  }
}

// ── Legacy File-Based Inventory Check ─────────────────────────────────

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
      // Inventory files have been uploaded — do NOT auto-advance.
      // Instead, remind the inventory group to verify all products arrived
      // and confirm via the "Ready for Delivery" button.

      if (escalationLevel >= 3) {
        const result: AgentResult = {
          status: 'blocked',
          message: `🔴 Inventory photos uploaded but not yet confirmed ready after ${escalationLevel} reminders. Manager intervention required. Please verify all products have arrived and click ✅ Ready for Delivery.`,
          next_stage: null,
          reminder_needed: true,
          escalation_level: escalationLevel,
        };

        await logAgentAction(AGENT_NAME, input, result, 'blocked', order.id);
        return result;
      }

      const result: AgentResult = {
        status: 'needs_review',
        message: `📦 Inventory photos uploaded (${files.length} file(s)) for quotation #${order.quotation_number ?? 'unknown'}. Please verify all products have arrived. Once confirmed, click ✅ Ready for Delivery to proceed to balance payment.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };

      await logAgentAction(AGENT_NAME, input, result, 'needs_review', order.id);
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

      await logAgentAction(AGENT_NAME, input, result, 'blocked', order.id);
      return result;
    }

    const result: AgentResult = {
      status: 'needs_review',
      message: `Has the inventory arrived? Please upload photos/files of the received items.`,
      next_stage: null,
      reminder_needed: true,
      escalation_level: escalationLevel,
    };

    await logAgentAction(AGENT_NAME, input, result, 'needs_review', order.id);
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

    await logAgentAction(AGENT_NAME, input, result, 'error', order.id, errorMsg);
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
