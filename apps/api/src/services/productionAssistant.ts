/**
 * Production Assistant — Natural Language Understanding
 *
 * Interprets free-text messages from the production group chat using Gemini.
 * Returns a human reply + an optional structured action the bot can execute.
 *
 * Supported intents:
 *   mark_produced   — "qtn-discovery chairs are done" / "all items finished"
 *   mark_en_route   — "qtn-abc has shipped" / "items are on the way"
 *   status_query    — "what's the status of discovery?" / "how far along is qtn-abc"
 *   list_orders     — "what's still in production?" / "show active orders"
 *   general_question — anything else production-related
 *   ignore          — chit-chat with no production relevance → no reply
 */

import { query } from '../db.js';

// Reuse the same Gemini config as hermesClaw
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY ?? '';
const HERMES_MODEL    = process.env.HERMES_MODEL ?? 'gemini-2.0-flash';
const GEMINI_BASE     = `https://generativelanguage.googleapis.com/v1beta/models/${HERMES_MODEL}`;

// ── Types ──────────────────────────────────────────────────────────────────

interface OrderRow {
  id: string;
  quotation_number: string | null;
  client_name: string | null;
  current_stage: string;
  production_started: boolean | null;
  production_finished: boolean | null;
  estimated_production_days: number | null;
  production_started_at: string | null;
}

interface ItemRow {
  id: string;
  order_id: string;
  name: string;
  quantity: number;
  production_status: 'pending' | 'in_progress' | 'finished';
}

export interface AssistantAction {
  type: 'mark_items_produced' | 'confirm_en_route';
  orderId: string;
  quotationNumber: string;
  /** Only for mark_items_produced — item IDs to set to finished */
  itemIds?: string[];
}

export interface AssistantResponse {
  /** null means "ignore this message — don't reply" */
  reply: string | null;
  action?: AssistantAction;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function daysAgo(iso: string | null): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function estimatedFinish(order: OrderRow): string {
  if (!order.production_started_at || !order.estimated_production_days) return 'unknown';
  const finish = new Date(order.production_started_at);
  finish.setDate(finish.getDate() + order.estimated_production_days);
  return finish.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Main entry point ───────────────────────────────────────────────────────

export async function handleProductionChat(
  text: string,
  username: string | null,
): Promise<AssistantResponse> {
  if (!GEMINI_API_KEY) {
    return { reply: 'Production assistant is not configured (missing GEMINI_API_KEY).' };
  }

  // 1. Load active production orders + their items
  const orders = await query<OrderRow>(
    `SELECT id, quotation_number, client_name, current_stage,
            production_started, production_finished, estimated_production_days, production_started_at
     FROM orders
     WHERE current_stage IN ('production_pending', 'production_confirmed', 'purchasing_pending')
       AND status = 'active'
     ORDER BY updated_at DESC
     LIMIT 30`,
  );

  const items = orders.length > 0
    ? await query<ItemRow>(
        `SELECT id, order_id, name, quantity, production_status
         FROM order_items
         WHERE order_id = ANY($1::uuid[])`,
        [orders.map((o) => o.id)],
      )
    : [];

  // Map items to their orders
  const itemsByOrder = new Map<string, ItemRow[]>();
  for (const item of items) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrder.set(item.order_id, list);
  }

  // 2. Build a compact context for the prompt
  const orderSummaries = orders.map((o) => {
    const orderItems = itemsByOrder.get(o.id) ?? [];
    const finishedCount = orderItems.filter((i) => i.production_status === 'finished').length;
    return {
      qn: o.quotation_number,
      client: o.client_name,
      stage: o.current_stage,
      started: o.production_started ?? false,
      finished: o.production_finished ?? false,
      days_in_stage: daysAgo(o.production_started_at),
      est_finish: estimatedFinish(o),
      items: orderItems.map((i) => ({ name: i.name, qty: i.quantity, status: i.production_status })),
      items_progress: orderItems.length > 0 ? `${finishedCount}/${orderItems.length} produced` : 'no item list',
    };
  });

  // 3. Prompt Gemini
  const prompt = `You are a production assistant for a furniture/manufacturing business.
You help the production team by understanding their natural language updates and questions in a Telegram group chat.

ACTIVE PRODUCTION ORDERS:
${JSON.stringify(orderSummaries, null, 2)}

A team member${username ? ` (@${username})` : ''} sent this message:
"${text}"

Respond ONLY with a JSON object using this exact structure:
{
  "intent": "<one of: mark_produced | mark_en_route | status_query | list_orders | general_question | ignore>",
  "quotation_number": "<the qtn-xxx mentioned, or null>",
  "item_names": ["<items mentioned as done/finished, empty array if all items or none specified>"],
  "reply": "<your reply in plain text, no markdown, 1-3 sentences. null if intent is ignore>",
  "confidence": "<high | medium | low>"
}

Intent guide:
- mark_produced: user says items/order is done, finished, produced, completed, ready
- mark_en_route: user says items shipped, dispatched, on the way, en route
- status_query: user asks how far along, ETA, progress, is X done
- list_orders: user asks what's pending, what orders exist in production
- general_question: other production questions
- ignore: casual chat, greetings, unrelated topics — set reply to null

Important rules:
- Reply in plain text only (no asterisks, no markdown)
- Keep replies short and friendly
- If a quotation number is mentioned, include it in quotation_number even if slightly misspelled
- If user says "all done" or "everything finished" without specifying items, item_names = []
- If order is not found in the active list, say so clearly in the reply`;

  try {
    const res = await fetch(
      `${GEMINI_BASE}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generation_config: {
            temperature: 0.1,
            max_output_tokens: 512,
            response_mime_type: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!res.ok) throw new Error(`Gemini ${res.status}`);

    const data = (await res.json()) as any;
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    const parsed = JSON.parse(raw) as {
      intent: string;
      quotation_number: string | null;
      item_names: string[];
      reply: string | null;
      confidence: string;
    };

    // 4. intent = ignore → no reply
    if (parsed.intent === 'ignore' || !parsed.reply) {
      return { reply: null };
    }

    // 5. For action intents, find the matching order
    if (
      (parsed.intent === 'mark_produced' || parsed.intent === 'mark_en_route') &&
      parsed.quotation_number
    ) {
      const matchedOrder = orders.find(
        (o) => o.quotation_number?.toLowerCase() === parsed.quotation_number!.toLowerCase(),
      );

      if (matchedOrder) {
        const orderItems = itemsByOrder.get(matchedOrder.id) ?? [];

        if (parsed.intent === 'mark_en_route') {
          return {
            reply: parsed.reply,
            action: {
              type: 'confirm_en_route',
              orderId: matchedOrder.id,
              quotationNumber: matchedOrder.quotation_number!,
            },
          };
        }

        // mark_produced — find which item IDs to update
        const pendingItems = orderItems.filter((i) => i.production_status !== 'finished');
        const targetItems =
          parsed.item_names.length > 0
            ? pendingItems.filter((i) =>
                parsed.item_names.some((name) =>
                  i.name.toLowerCase().includes(name.toLowerCase()),
                ),
              )
            : pendingItems; // all pending items

        if (targetItems.length > 0) {
          return {
            reply: parsed.reply,
            action: {
              type: 'mark_items_produced',
              orderId: matchedOrder.id,
              quotationNumber: matchedOrder.quotation_number!,
              itemIds: targetItems.map((i) => i.id),
            },
          };
        }
      }
    }

    // 6. Informational reply only (status_query, list_orders, general_question)
    return { reply: parsed.reply };
  } catch (err) {
    console.error('[productionAssistant] Gemini error:', err);
    return {
      reply: 'I had trouble processing that. Use /produce to mark production updates.',
    };
  }
}
