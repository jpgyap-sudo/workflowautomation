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
import { cacheDeletePattern } from '../cache.js';
import { broadcastSSE } from '../sse.js';
import {
  analyzeProductionOrder,
  type HermesProductionContext,
  isHermesAvailable,
} from '../services/hermesClaw.js';

/**
 * inventory-agent (Hermes Claw)
 *
 * Role: Tracks inventory arrival for orders at inventory_verification and inventory_arrived stages.
 *
 * inventory_verification stage:
 * - Checks when estimated arrival days have been met
 * - Asks about each item + quantity one by one (process of elimination)
 * - Tracks verified_qty on order_items and inventory_verification_pct on orders
 * - When all items and quantities verified → advances to inventory_arrived
 *
 * inventory_arrived stage:
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
  verified_qty: number;
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


function buildInventoryVerificationUrl(quotationNumber: string): string {
  return `https://track.abcx124.xyz/inventory/verification/${encodeURIComponent(quotationNumber)}`;
}

function formatVerificationItemList(items: OrderItemRow[], mode: 'pending' | 'verified' = 'pending'): string {
  const lines = items
    .map((item) => {
      const qty = Number(item.quantity ?? 0);
      const verified = Math.min(Number(item.verified_qty ?? 0), qty);
      const remaining = Math.max(qty - verified, 0);
      if (mode === 'verified') {
        return `- ${item.name}: ${verified}/${qty} verified`;
      }
      if (remaining <= 0) return null;
      return `- ${item.name}: ${remaining} remaining (${verified}/${qty} verified)`;
    })
    .filter(Boolean) as string[];

  if (!lines.length) {
    return mode === 'verified' ? '- No item quantities recorded' : '- No pending items';
  }

  return lines.join('\n');
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

  // ── Phase 1: Check orders at inventory_verification stage ──────────
  const verificationOrders = await getActiveOrdersByStage('inventory_verification');

  for (const order of verificationOrders) {
    const itemResult = await checkInventoryVerification(order);
    if (itemResult) {
      if (itemResult.reminder_needed) {
        const groupChatId = getGroupChatId(AGENT_NAME);
        if (groupChatId) {
          await createReminder(order.id, 'inventory_verification', groupChatId, itemResult.message);
          // NOTE: checkInventoryVerification already sends the inline-keyboard message.
          // notifyInventory is skipped here to avoid duplicate spam.
        }
      }
      results.push(itemResult);
    }
  }

  // ── Phase 2: Check orders at inventory_arrived stage ──────────────
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

// ── Inventory Verification (Hermes Claw) ──────────────────────────────

/**
 * Check inventory verification for orders at inventory_verification stage.
 *
 * Strategy:
 * 1. Check if estimated arrival days have been met (based on en_route_confirmed_at)
 * 2. If arrival days not yet met → skip (not yet due)
 * 3. If arrival days met → start process of elimination for each item + qty
 * 4. Calculate verification % based on verified_qty vs total quantity
 * 5. Ask about each item one by one: "Has [item] x[qty] arrived? How many verified?"
 * 6. When all items fully verified → advance to inventory_arrived
 * 7. Uses Hermes Claw AI for smarter messaging when available
 */
async function checkInventoryVerification(order: OrderRow): Promise<AgentResult | null> {
  const input = {
    quotation_number: order.quotation_number,
    stage: order.current_stage,
  };

  try {
    // Only run for inventory_verification stage
    if (order.current_stage !== 'inventory_verification') return null;

    // Fetch items
    const items = await getOrderItems(order.id);
    const escalationLevel = await getEscalationLevel(order.id, 'inventory_verification');

    if (items.length === 0) {
      // No items defined — remind inventory group to extract items
      const qn = order.quotation_number ?? 'unknown';
      const client = order.client_name ?? 'Unknown';
      const groupChatId = getGroupChatId(AGENT_NAME);
      if (groupChatId) {
        const msg = `🔍 <b>Inventory Verification</b>\n\nOrder: #${qn} (${client})\n\n⚠️ No items have been extracted for this order yet. Please extract items from the quotation image using the dashboard or Telegram bot before proceeding with inventory verification.`;
        await sendTelegramMessage(groupChatId, msg);
      }
      const result: AgentResult = {
        status: 'blocked',
        message: `Inventory verification for #${qn} blocked: no items extracted.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };
      await logAgentAction(AGENT_NAME, input, result, 'blocked', order.id);
      return result;
    }

    // Calculate verification % based on verified_qty vs total quantity
    const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
    const verifiedQty = items.reduce((sum, i) => sum + i.verified_qty, 0);
    const verificationPct = totalQty > 0 ? Math.round((verifiedQty / totalQty) * 100) : 0;

    // Update inventory_verification_pct on the order
    await query(
      `UPDATE orders SET inventory_verification_pct = $1, updated_at = NOW() WHERE id = $2`,
      [verificationPct, order.id]
    );

    // Broadcast SSE so dashboard sees the percentage update in real time
    broadcastSSE('order_updated', { id: order.id });
    broadcastSSE('invalidate', { keys: ['dashboard:*', 'orders:*', `order:detail:${order.quotation_number ?? ''}`] });

    // Check if estimated arrival days have been met
    if (order.en_route_confirmed_at) {
      const confirmedDate = new Date(order.en_route_confirmed_at);
      const arrivalDays = order.estimated_arrival_days ?? 0;
      const dueDate = new Date(confirmedDate);
      dueDate.setDate(dueDate.getDate() + arrivalDays);
      const now = new Date();

      if (now < dueDate) {
        // Not yet due for arrival — skip
        const daysRemaining = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const result: AgentResult = {
          status: 'ok',
          message: `⏳ Inventory verification for #${order.quotation_number ?? 'unknown'} not yet due. Estimated arrival in ${daysRemaining} day(s).`,
          next_stage: null,
          reminder_needed: false,
          escalation_level: escalationLevel,
        };
        await logAgentAction(AGENT_NAME, input, result, 'ok', order.id);
        return result;
      }
    }

    // ── Check if all items are fully verified ──
    const allVerified = items.every((item) => item.verified_qty >= item.quantity);
    const fullyVerifiedItems = items.filter((item) => item.verified_qty >= item.quantity).length;
    const totalItems = items.length;

    if (allVerified) {
      // All items verified — advance to inventory_arrived
      const qn = order.quotation_number ?? 'unknown';
      const client = order.client_name ?? 'Unknown';

      await addProductionLog(null, order.id, `✅ All items verified at inventory (${verificationPct}% of qty). Advancing to inventory_arrived.`, 'agent', AGENT_NAME);
      await addAgentNote(order.id, AGENT_NAME, `All ${items.length} item(s) verified at inventory (${verificationPct}% of qty). Moving to inventory_arrived.`);

      // Update order: set inventory_verified_at and advance stage
      await query(
        `UPDATE orders SET inventory_verified_at = NOW(), inventory_verification_pct = 100,
         current_stage = 'inventory_arrived', updated_at = NOW()
         WHERE id = $1`,
        [order.id]
      );

      // Record stage update
      await query(
        `INSERT INTO stage_updates (order_id, stage, status, remarks, updated_by)
         VALUES ($1, 'inventory_arrived', 'auto_advanced', 'All items verified at inventory. Proceeding to inventory arrival.', 'inventory-agent')`,
        [order.id]
      );

      // Complete reminders for inventory_verification
      await query(
        `UPDATE reminders SET status = 'completed', updated_at = NOW()
         WHERE order_id = $1 AND status = 'active' AND stage = 'inventory_verification'`,
        [order.id]
      );

      // Invalidate caches and broadcast SSE so dashboard reflects the stage change immediately
      const cachePatterns = ['dashboard:*', 'orders:*', `order:detail:${qn}`, 'calendar:*', 'sales:*'];
      for (const pattern of cachePatterns) {
        await cacheDeletePattern(pattern);
      }
      broadcastSSE('order_updated', { id: order.id });
      broadcastSSE('invalidate', { keys: cachePatterns });
      await cacheDeletePattern(`order:detail:${qn}`);

      // Notify inventory group with permanent record link and verified quantities
      const groupChatId = getGroupChatId(AGENT_NAME);
      if (groupChatId) {
        const dashboardUrl = buildInventoryVerificationUrl(qn);
        const verifiedList = formatVerificationItemList(items, 'verified');
        const msg = `?? <b>Inventory Verification Complete</b>

` +
          `Order: #${qn}
` +
          `Client: ${client}
` +
          `?? <a href="${dashboardUrl}">Permanent Verification Link</a>

` +
          `<b>Verified Items</b>
${verifiedList}

` +
          `? All items accounted for. Proceeding to inventory arrival check.`;

        await sendTelegramMessage(groupChatId, msg);
      }

      const result: AgentResult = {
        status: 'complete',
        message: `✅ All items verified at inventory for #${qn} (${verificationPct}% of qty). Advanced to inventory_arrived.`,
        next_stage: 'inventory_arrived',
        reminder_needed: false,
        escalation_level: escalationLevel,
      };
      await logAgentAction(AGENT_NAME, input, result, 'complete', order.id);
      return result;
    }

    // ── Process of elimination: ask about the next not-fully-verified item ──
    const notVerifiedItem = items.find(
      (item) => item.verified_qty < item.quantity,
    );

    if (!notVerifiedItem) {
      // Shouldn't happen since allVerified check above, but just in case
      return null;
    }

    const qn = order.quotation_number ?? 'unknown';
    const client = order.client_name ?? 'Unknown';
    const progressBar = buildProgressBar(verificationPct);
    const dashboardUrl = buildInventoryVerificationUrl(qn);

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
      pct_elapsed: verificationPct,
      is_overdue: false,
      escalation_level: escalationLevel,
    };
    const hermesAnalysis = await analyzeProductionOrder(hermesCtx, order.id);

    const remainingQty = notVerifiedItem.quantity - notVerifiedItem.verified_qty;

    let message = `🔍 <b>Inventory Verification</b>\n`;
    message += `Order: #${qn} (${client})\n`;
    message += `📊 <a href="${dashboardUrl}">View on Dashboard</a>\n`;
    message += `Verified: ${verificationPct}% ${progressBar}\n`;
    message += `Items: ${fullyVerifiedItems}/${totalItems} fully verified\n\n`;
    message += `<b>Items Not Yet Verified</b>\n${formatVerificationItemList(items, 'pending')}\n\n`;

    if (hermesAnalysis) {
      message += `${hermesAnalysis.message}\n\n`;
    }

    message += `<b>Process of Elimination:</b>\n`;
    message += `Next item: <b>${notVerifiedItem.name}</b>\n`;
    message += `Ordered: ${notVerifiedItem.quantity} | Already verified: ${notVerifiedItem.verified_qty}\n`;
    message += `Remaining to verify: ${remainingQty}\n\n`;
    message += `Has <b>${notVerifiedItem.name}</b> arrived? How many units can you confirm?`;

    // Build inline keyboard for this specific item
    // NOTE: Use first 8 chars of item UUID and order UUID to stay within Telegram's 64-byte callback_data limit
    const itemIdShort = notVerifiedItem.id.slice(0, 8);
    const orderIdShort = order.id.slice(0, 8);
    const keyboard = inlineKeyboard([
      [
        { text: `✅ ${notVerifiedItem.name} — All ${notVerifiedItem.quantity} Verified`, callback_data: `inv_verify:all:${itemIdShort}:${orderIdShort}:${qn}` },
      ],
      [
        { text: `📦 ${notVerifiedItem.name} — Partial (Enter Qty)`, callback_data: `inv_verify:partial:${itemIdShort}:${orderIdShort}:${qn}` },
      ],
      [
        { text: `⏳ ${notVerifiedItem.name} — Not Yet`, callback_data: `inv_verify:not_yet:${itemIdShort}:${orderIdShort}:${qn}` },
      ],
    ]);

    // Send the message to the inventory group chat
    const groupChatId = getGroupChatId(AGENT_NAME);
    if (groupChatId) {
      await sendTelegramMessage(groupChatId, message, keyboard);
    }

    const result: AgentResult = {
      status: 'needs_review',
      message: `Inventory verification for #${qn}: ${fullyVerifiedItems}/${totalItems} fully verified (${verificationPct}% of qty). Asking about "${notVerifiedItem.name}" (${remainingQty} remaining).`,
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
      message: `❌ Error checking inventory verification for #${order.quotation_number ?? 'unknown'}: ${errorMsg}`,
      next_stage: null,
      reminder_needed: false,
      escalation_level: 0,
    };
    await logAgentAction(AGENT_NAME, input, result, 'error', order.id, errorMsg);
    return result;
  }
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
            { text: '✅ Ready for Delivery', callback_data: `inv_ready:${qn}` },
            { text: '⏳ Still Waiting', callback_data: `inv_wait:${qn}` },
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
    const dashboardUrl = `https://track.abcx124.xyz/orders/${qn}`;

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
    message += `📊 <a href="${dashboardUrl}">View on Dashboard</a>\n`;
    message += `Inventory: ${inventoryPct}% arrived ${progressBar}\n`;
    message += `Items: ${arrivedCount}/${totalCount} arrived\n\n`;

    if (hermesAnalysis) {
      message += `${hermesAnalysis.message}\n\n`;
    }

    message += `<b>Process of Elimination:</b>\n`;
    message += `Next item: <b>${notArrivedItem.name}</b> x${notArrivedItem.quantity}\n\n`;

    // Include estimated arrival date if available
    if (notArrivedItem.estimated_arrival_days) {
      const arrivalNote = order.en_route_confirmed_at
        ? (() => {
            const confirmedDate = new Date(order.en_route_confirmed_at);
            const estDate = new Date(confirmedDate);
            estDate.setDate(estDate.getDate() + notArrivedItem.estimated_arrival_days!);
            const now = new Date();
            const daysRemaining = Math.ceil((estDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            if (daysRemaining > 0) {
              return `📅 Estimated arrival: ${estDate.toLocaleDateString('en-SG', { month: 'short', day: 'numeric' })} (${daysRemaining} day(s) remaining)`;
            } else if (daysRemaining === 0) {
              return `📅 Estimated arrival: Today`;
            } else {
              return `📅 Estimated arrival was ${Math.abs(daysRemaining)} day(s) ago — overdue`;
            }
          })()
        : `📅 Estimated arrival: ~${notArrivedItem.estimated_arrival_days} day(s) from en-route confirmation`;
      message += `${arrivalNote}\n\n`;
    }

    message += `Has <b>${notArrivedItem.name}</b> arrived at inventory?`;

    // Build inline keyboard for this specific item
    // NOTE: callback_data uses first 8 chars of item UUID + quotation_number (short)
    // to stay within Telegram's 64-byte limit for callback_data.
    const keyboard = inlineKeyboard([
      [
        { text: `📦 ${notArrivedItem.name} — Arrived`, callback_data: `item_inventory:arrived:${notArrivedItem.id.slice(0, 8)}:${qn}` },
      ],
      [
        { text: `🚚 ${notArrivedItem.name} — En Route`, callback_data: `item_inventory:en_route:${notArrivedItem.id.slice(0, 8)}:${qn}` },
      ],
      [
        { text: `⏳ ${notArrivedItem.name} — Not Yet`, callback_data: `item_inventory:not_yet:${notArrivedItem.id.slice(0, 8)}:${qn}` },
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

// ── Legacy Inventory Check (no item-level tracking) ───────────────────

export async function checkInventory(order: OrderRow): Promise<AgentResult> {
  const input = {
    quotation_number: order.quotation_number,
    current_stage: order.current_stage,
  };

  try {
    const escalationLevel = await getEscalationLevel(order.id, 'inventory_arrived');
    const qn = order.quotation_number ?? 'unknown';
    const client = order.client_name ?? 'Unknown';
    const dashboardUrl = `https://track.abcx124.xyz/orders/${qn}`;

    // No item-level tracking — ask the inventory group to confirm arrival
    if (escalationLevel >= 3) {
      const result: AgentResult = {
        status: 'blocked',
        message: `🔴 Inventory not yet confirmed arrived after ${escalationLevel} reminders for #${qn} (${client}). Manager intervention required. Please verify all products have arrived and click ✅ Ready for Delivery.`,
        next_stage: null,
        reminder_needed: true,
        escalation_level: escalationLevel,
      };

      await logAgentAction(AGENT_NAME, input, result, 'blocked', order.id);
      return result;
    }

    let message = `📦 <b>Inventory Arrival Check</b>\n`;
    message += `Order: #${qn} (${client})\n`;
    message += `📊 <a href="${dashboardUrl}">View on Dashboard</a>\n\n`;
    message += `Has the inventory arrived? Please confirm below:`;

    const result: AgentResult = {
      status: 'needs_review',
      message,
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
    `SELECT id, original_filename, created_at
     FROM files WHERE order_id = $1 AND file_type = $2
     ORDER BY created_at DESC`,
    [orderId, fileType],
  );
}

function inventoryArrivalKeyboard(order: OrderRow): Record<string, unknown> | undefined {
  if (order.current_stage !== 'inventory_arrived') return undefined;

  const qn = order.quotation_number ?? order.id.slice(0, 8);
  return inlineKeyboard([
    [
      { text: 'Yes, all arrived', callback_data: `inv_arr:yes:${qn}` },
      { text: 'No', callback_data: `inv_arr:no:${qn}` },
    ],
    [
      { text: 'Partial - choose items', callback_data: `inv_arr:partial:${qn}` },
    ],
  ]);
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
  await sendTelegramMessage(groupChatId, msg, inventoryArrivalKeyboard(order));
}
