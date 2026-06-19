/**
 * OpenClaw — Universal Order Intelligence Engine
 *
 * Processes natural language queries about ANY aspect of the business:
 * - Order status ("what's the status of QTN-2026-001?")
 * - Production progress ("is discovery chairs done?")
 * - Delivery ETA ("when will QTN-2026-005 arrive?")
 * - Payment status ("has client paid the balance?")
 * - Client info ("show me everything about Juan")
 * - Cross-order queries ("what orders are delayed?")
 *
 * Architecture:
 * 1. Parse query -> extract intent + entities (order ref, client, stage, date)
 * 2. Fetch live data from DB
 * 3. Search CentralBrain for relevant lessons
 * 4. Build context-aware prompt for Gemini/OpenRouter
 * 5. Return structured response with buttons
 */

import { query } from '../db.js';
import { searchLessons } from './brainService.js';
import { STAGE_LABELS } from './agentRunner.js';

// ── Constants ──────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const GEMINI_MODEL = process.env.OPENCLAW_MODEL ?? 'gemini-2.0-flash';
const GEMINI_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}`;

/**
 * Stage -> human-readable label with emoji
 */
const STAGE_EMOJI: Record<string, string> = {
  order_confirmation_received: '📋',
  quotation_received: '📄',
  math_verified: '✅',
  deposit_pending: '💳',
  deposit_verification: '🔍',
  purchasing_pending: '🛒',
  production_pending: '🏭',
  production_in_progress: '⚙️',
  partial_production: '🔧',
  en_route: '🚚',
  en_route_verification: '📦',
  inventory_verification: '📋',
  inventory_arrived: '📥',
  balance_due: '💰',
  balance_verification: '🔍',
  delivery_pending: '🚛',
  delivery_scheduled: '📅',
  delivered: '✅',
  payment_received: '💵',
  payment_confirmed: '✅',
  completed: '🎉',
  countered: '🔄',
};

const STAGE_ORDER = [
  'order_confirmation_received', 'quotation_received', 'math_verified',
  'deposit_pending', 'deposit_verification',
  'purchasing_pending', 'production_pending', 'production_in_progress',
  'partial_production', 'en_route', 'en_route_verification',
  'inventory_verification', 'inventory_arrived',
  'balance_due', 'balance_verification',
  'delivery_pending', 'delivery_scheduled', 'delivered',
  'payment_received', 'payment_confirmed', 'completed', 'countered',
];

// ── Types ──────────────────────────────────────────────────────────

export interface OpenClawResult {
  reply: string;
  formatted_reply?: string; // HTML-formatted version for Telegram
  order_id?: string;
  quotation_number?: string;
  suggested_actions?: Array<{
    label: string;
    callback_data: string;
  }>;
  confidence: 'high' | 'medium' | 'low';
  data_source: 'live_order' | 'brain_lesson' | 'general';
  source_lesson?: {
    title: string;
    summary: string;
  };
}

interface OrderContext {
  id: string;
  quotation_number: string | null;
  client_name: string | null;
  sales_agent: string | null;
  total_amount: number | null;
  current_stage: string;
  status: string;
  deposit_paid: boolean;
  deposit_amount: number | null;
  deposit_verified: boolean;
  balance_paid: boolean;
  balance_amount?: number | null;
  production_started: boolean | null;
  production_started_at: string | null;
  estimated_production_days: number | null;
  production_finished: boolean | null;
  production_finished_at: string | null;
  delivery_estimated_days: number | null;
  en_route_confirmed: boolean | null;
  estimated_arrival_days: number | null;
  delivery_date: string | null;
  completed_at: string | null;
  item_count?: number;
  finished_item_count?: number;
  stage_updates_count?: number;
  days_in_stage?: number;
  projected_lead_time?: number | null;
  projected_lead_time_started_at?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────

function daysAgo(iso: string | null): number {
  if (!iso) return -1;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function stageProgress(currentStage: string): string {
  const idx = STAGE_ORDER.indexOf(currentStage);
  if (idx === -1) return '';
  const total = STAGE_ORDER.length;
  const blocks = Math.round((idx / total) * 10);
  return '#'.repeat(blocks) + '-'.repeat(10 - blocks) + ` [${idx}/${total}]`;
}

function formatAmount(amount: number | null): string {
  if (amount == null) return '-';
  return `PHP ${Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

function getStageEmoji(stage: string): string {
  return STAGE_EMOJI[stage] ?? '📌';
}

// ── Data Fetching ─────────────────────────────────────────────────

async function findOrderByQuery(queryText: string): Promise<OrderContext | null> {
  // Try exact quotation number match
  const qtnMatch = queryText.match(/qtn[-\s]?(\d{4,})/i);
  if (qtnMatch) {
    const qtnNumber = qtnMatch[1];
    const possibleMatches = [
      `QTN-${qtnNumber}`,
      `qtn-${qtnNumber}`,
      queryText.match(/qtn[-\s]?(\w+)/i)?.[0]?.toUpperCase(),
    ].filter(Boolean) as string[];

    for (const q of possibleMatches) {
      const rows = await query<OrderContext>(
        `SELECT o.*,
          (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count,
          (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND production_status = 'finished') AS finished_item_count,
          (SELECT COUNT(*) FROM stage_updates WHERE order_id = o.id) AS stage_updates_count
        FROM orders o
        WHERE REPLACE(LOWER(o.quotation_number), ' ', '') = REPLACE(LOWER($1), ' ', '')
        LIMIT 1`,
        [q],
      );
      if (rows[0]) {
        const r = rows[0] as any;
        r.days_in_stage = daysAgo(r.production_started_at ?? r.created_at);
        return r as OrderContext;
      }
    }
  }

  // Try client name match
  const words = queryText.split(/\s+/).filter(w => w.length > 2);
  for (const word of words) {
    const rows = await query<OrderContext>(
      `SELECT o.*,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND production_status = 'finished') AS finished_item_count,
        (SELECT COUNT(*) FROM stage_updates WHERE order_id = o.id) AS stage_updates_count
      FROM orders o
      WHERE LOWER(o.client_name) LIKE LOWER($1)
      ORDER BY o.created_at DESC
      LIMIT 1`,
      [`%${word}%`],
    );
    if (rows[0]) {
      const r = rows[0] as any;
      r.days_in_stage = daysAgo(r.production_started_at ?? r.created_at);
      return r as OrderContext;
    }
  }

  return null;
}

async function findMultipleOrdersByQuery(queryText: string): Promise<OrderContext[]> {
  // "all orders" / "what orders" / "list orders"
  const isListQuery = /\b(all|list|show|what|every)\b/i.test(queryText);
  const hasDelayed = /\b(delayed|overdue|late|behind)\b/i.test(queryText);
  const hasProduction = /\b(production|produce|manufactur)\b/i.test(queryText);
  const hasDelivery = /\b(delivery|deliver|ship|arrive)\b/i.test(queryText);
  const hasClientWord = /\b(client|customer)\b/i.test(queryText);

  let stageFilter = '';
  if (hasDelayed) {
    // Orders still in production beyond estimated days
    const rows = await query<OrderContext>(
      `SELECT o.*,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND production_status = 'finished') AS finished_item_count,
        (SELECT COUNT(*) FROM stage_updates WHERE order_id = o.id) AS stage_updates_count
      FROM orders o
      WHERE o.status = 'active'
        AND o.estimated_production_days IS NOT NULL
        AND o.production_started IS TRUE
        AND o.production_finished IS NOT TRUE
        AND (o.production_delayed IS TRUE OR o.created_at + (o.estimated_production_days || ' days')::INTERVAL < NOW())
      ORDER BY o.created_at DESC
      LIMIT 10`,
    );
    return rows as OrderContext[];
  }

  if (hasProduction) {
    stageFilter = `o.current_stage IN ('production_pending', 'production_in_progress', 'partial_production')`;
  } else if (hasDelivery) {
    stageFilter = `o.current_stage IN ('delivery_pending', 'delivery_scheduled', 'en_route', 'en_route_verification')`;
  }

  const rows = stageFilter
    ? await query<OrderContext>(
        `SELECT o.*,
          (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count,
          (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND production_status = 'finished') AS finished_item_count,
          (SELECT COUNT(*) FROM stage_updates WHERE order_id = o.id) AS stage_updates_count
        FROM orders o
        WHERE o.status = 'active' AND ${stageFilter}
        ORDER BY o.created_at DESC
        LIMIT 5`,
      )
    : await query<OrderContext>(
        `SELECT o.*,
          (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count,
          (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND production_status = 'finished') AS finished_item_count,
          (SELECT COUNT(*) FROM stage_updates WHERE order_id = o.id) AS stage_updates_count
        FROM orders o
        WHERE o.status = 'active'
        ORDER BY o.created_at DESC
        LIMIT 8`,
      );

  return rows as OrderContext[];
}

// ── Response Formatting ───────────────────────────────────────────

function formatOrderDetail(order: OrderContext, lessonContext?: string): string {
  const emoji = getStageEmoji(order.current_stage);
  const stageLabel = STAGE_LABELS[order.current_stage] ?? order.current_stage;
  const progress = stageProgress(order.current_stage);

  // Production ETA
  let etaLine = '';
  if (order.production_started && order.estimated_production_days && !order.production_finished) {
    const started = new Date(order.production_started_at!);
    const estFinish = new Date(started.getTime() + order.estimated_production_days * 86_400_000);
    const remaining = Math.round((estFinish.getTime() - Date.now()) / 86_400_000);
    const daysInProd = daysAgo(order.production_started_at);
    if (remaining > 0) {
      etaLine = `\nEst. production finish: ${estFinish.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} (${remaining} day(s) remaining)`;
    } else {
      etaLine = `\nProduction overdue by ${Math.abs(remaining)} day(s)`;
    }
    etaLine += ` (${daysInProd} day(s) in production)`;
  }

  // Production finished -> delivery ETA
  let deliveryEtaLine = '';
  if (order.production_finished && order.delivery_estimated_days) {
    const finishedAt = new Date(order.production_finished_at!);
    const estDelivery = new Date(finishedAt.getTime() + order.delivery_estimated_days * 86_400_000);
    deliveryEtaLine = `\nEst. delivery: ${estDelivery.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} (${order.delivery_estimated_days} day(s) from finish)`;
  }

  // Gantt projected deadline (from projected_lead_time)
  let deadlineLine = '';
  if (order.projected_lead_time && order.projected_lead_time_started_at) {
    const startedAt = new Date(order.projected_lead_time_started_at);
    const deadline = new Date(startedAt.getTime() + order.projected_lead_time * 86_400_000);
    const remainingDays = Math.round((deadline.getTime() - Date.now()) / 86_400_000);
    const isDelayed = remainingDays < 0;
    const statusIcon = isDelayed ? '🔴' : remainingDays <= Math.ceil(order.projected_lead_time * 0.15) ? '🟡' : '🟢';
    deadlineLine = `\n${statusIcon} Gantt deadline: ${deadline.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    if (isDelayed) {
      deadlineLine += ` (Overdue by ${Math.abs(remainingDays)} day(s))`;
    } else {
      deadlineLine += ` (${remainingDays} day(s) remaining)`;
    }
  }

  // Delivery date
  let deliveryDateLine = '';
  if (order.delivery_date) {
    deliveryDateLine = `\nScheduled delivery: ${new Date(order.delivery_date).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}`;
  }

  // Items
  let itemLine = '';
  if (order.item_count != null && order.item_count > 0) {
    itemLine = `\nItems: ${order.finished_item_count ?? 0}/${order.item_count} produced`;
  }

  // Payment
  let paymentLine = '';
  if (order.deposit_paid) {
    paymentLine += `\nDownpayment: ${order.deposit_amount ? formatAmount(order.deposit_amount) : 'Yes'}${order.deposit_verified ? ' (Verified)' : ' (Pending)'}`;
  }
  if (order.balance_paid) {
    paymentLine += `\nBalance: Paid`;
  }

  // Completed
  let completedLine = '';
  if (order.completed_at) {
    completedLine = `\nCompleted: ${new Date(order.completed_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  const ref = order.quotation_number ?? order.id.slice(0, 8);

  return (
    `${emoji} <b>${ref}</b> - ${order.client_name ?? 'Unknown'}\n` +
    `──────────────────\n` +
    `📊 Stage: <b>${stageLabel}</b>\n` +
    `${progress}\n` +
    `Sales: ${order.sales_agent ?? '-'}\n` +
    `Amount: ${formatAmount(order.total_amount)}\n` +
    itemLine +
    deadlineLine +
    etaLine +
    deliveryEtaLine +
    deliveryDateLine +
    paymentLine +
    completedLine +
    (lessonContext ? `\n\n💡 <i>${lessonContext}</i>` : '')
  );
}

function formatOrderBrief(order: OrderContext): string {
  const emoji = getStageEmoji(order.current_stage);
  const stageLabel = STAGE_LABELS[order.current_stage] ?? order.current_stage;
  const ref = order.quotation_number ?? order.id.slice(0, 8);
  return `${emoji} <b>${ref}</b> - ${order.client_name ?? 'Unknown'} -> <b>${stageLabel}</b>`;
}

// ── Main Query Handler ────────────────────────────────────────────

export async function handleOpenClawQuery(
  text: string,
  options: {
    username?: string | null;
    chatType?: string; // 'group' | 'private'
    currentGroupStage?: string | null; // if in a specific group chat
  } = {},
): Promise<OpenClawResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      reply: 'Please type a question like "status of QTN-2026-001" or "what orders are in production?"',
      confidence: 'high',
      data_source: 'general',
    };
  }

  // ── Phase 1: Try to find a specific order ──────────────────────────
  const order = await findOrderByQuery(trimmed);

  if (order) {
    // Search CentralBrain for relevant lessons
    let lessonContext = '';
    try {
      const brainResults = await searchLessons(
        `${order.current_stage} ${order.client_name ?? ''}`,
        { limit: 1, min_confidence: 'high' },
      );
      if (brainResults.lessons.length > 0) {
        const l = brainResults.lessons[0];
        lessonContext = l.summary ?? l.title;
      }
    } catch {
      // Non-fatal - lessons are optional
    }

    const reply = formatOrderDetail(order, lessonContext);

    // Suggested actions based on stage
    const actions: Array<{ label: string; callback_data: string }> = [];
    if (order.current_stage === 'deposit_pending' && !order.deposit_paid) {
      actions.push({ label: '💳 Record Downpayment', callback_data: `deposit:${order.id}:${order.quotation_number ?? ''}` });
    }
    if (order.current_stage === 'production_pending' || order.current_stage === 'purchasing_pending') {
      actions.push({ label: '🏭 Start Production', callback_data: `production:start:${order.id}:${order.quotation_number ?? ''}` });
    }
    if (order.current_stage === 'balance_due' && order.deposit_paid && !order.balance_paid) {
      actions.push({ label: '💰 Record Balance Payment', callback_data: `balance:pay:${order.id}:${order.quotation_number ?? ''}` });
    }
    if (order.current_stage === 'delivery_scheduled') {
      actions.push({ label: '✅ Mark Delivered', callback_data: `delivery:confirm:${order.id}:${order.quotation_number ?? ''}` });
    }

    return {
      reply,
      formatted_reply: reply,
      order_id: order.id,
      quotation_number: order.quotation_number ?? undefined,
      suggested_actions: actions.length > 0 ? actions : undefined,
      confidence: 'high',
      data_source: 'live_order',
      source_lesson: lessonContext
        ? { title: 'Related Lesson', summary: lessonContext }
        : undefined,
    };
  }

  // ── Phase 2: Multi-order queries ──────────────────────────────────
  const orders = await findMultipleOrdersByQuery(trimmed);

  if (orders.length > 0) {
    let reply = '📋 <b>Active Orders</b>\n──────────────────\n';
    for (const o of orders) {
      reply += formatOrderBrief(o) + '\n';
    }
    reply += `\n${orders.length} order(s) shown. Use a quotation number for details.`;

    return {
      reply,
      formatted_reply: reply,
      confidence: 'high',
      data_source: 'live_order',
    };
  }

  // ── Phase 3: CentralBrain fallback (no order found) ───────────────
  try {
    const brainResults = await searchLessons(trimmed, { limit: 3 });
    if (brainResults.lessons.length > 0) {
      let reply = '🧠 <b>CentralBrain Knowledge</b>\n\n';
      reply += `I couldn't find a specific order for "${trimmed.substring(0, 100)}", but here are relevant lessons:\n\n`;

      for (let i = 0; i < Math.min(brainResults.lessons.length, 3); i++) {
        const l = brainResults.lessons[i];
        const confIcon = l.confidence === 'high' ? '🟢' : l.confidence === 'medium' ? '🟡' : '🔴';
        reply += `${i + 1}. ${confIcon} <b>${l.title}</b>\n`;
        if (l.summary) reply += `   ${l.summary}\n`;
        reply += '\n';
      }

      return {
        reply,
        formatted_reply: reply,
        confidence: 'medium',
        data_source: 'brain_lesson',
      };
    }
  } catch {
    // Non-fatal
  }

  // ── Phase 4: AI Fallback (Gemini understanding of general questions) ──
  if (GEMINI_API_KEY) {
    try {
      const prompt = `You are OpenClaw, an AI assistant for a furniture quotation automation system.
A user asked: "${trimmed}"

I could not find any matching order or lesson in the database.

Respond helpfully with ONE of:
1. If the query seems to be about an order but no match was found, suggest checking the quotation number format (e.g., QTN-2026-001)
2. If it's a general business question, answer briefly
3. If it's unclear, ask clarifying questions

Keep it to 2-3 sentences. Plain text only.`;

      const res = await fetch(
        `${GEMINI_BASE}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generation_config: { temperature: 0.3, max_output_tokens: 256 },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (res.ok) {
        const data = (await res.json()) as any;
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'I could not find that order. Try using the format QTN-2026-001.';
        return {
          reply,
          formatted_reply: reply,
          confidence: 'medium',
          data_source: 'general',
        };
      }
    } catch {
      // Non-fatal
    }
  }

  // Final fallback
  return {
    reply: `I couldn't find any order matching "${trimmed.substring(0, 100)}". Try:\n- Checking the quotation number format (e.g., QTN-2026-001)\n- Using /brain for knowledge base queries\n- Typing the client name`,
    confidence: 'low',
    data_source: 'general',
  };
}
