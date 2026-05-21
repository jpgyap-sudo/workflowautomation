import { query } from '../db.js';
import { addAgentNote } from './agentRunner.js';

// ── Configuration ──────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const HERMES_MODEL = process.env.HERMES_MODEL ?? 'gemini-2.0-flash';
const HERMES_TIMEOUT_MS = parseInt(process.env.HERMES_TIMEOUT_MS ?? '30000', 10);
const HERMES_TEMPERATURE = parseFloat(process.env.HERMES_TEMPERATURE ?? '0.3');
const HERMES_MAX_TOKENS = parseInt(process.env.HERMES_MAX_TOKENS ?? '1024', 10);
const FILE_STORE_URL = process.env.FILE_STORE_URL ?? 'http://file-store:8090';

const API_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${HERMES_MODEL}`;

// ── OpenRouter Fallback Configuration ──────────────────────────────────

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? 'google/gemini-2.0-flash-001';
const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1/chat/completions';

// ── Types ──────────────────────────────────────────────────────────────

export interface HermesProductionContext {
  quotation_number: string | null;
  client_name: string | null;
  sales_agent: string | null;
  stage: string;
  production_started: boolean | null;
  production_started_at: string | null;
  estimated_production_days: number | null;
  production_delayed: boolean | null;
  production_finished: boolean | null;
  production_finished_at: string | null;
  en_route_confirmed: boolean | null;
  estimated_arrival_days: number | null;
  days_in_stage: number;
  pct_elapsed: number;
  is_overdue: boolean;
  escalation_level: number;
  /** Quotation text fetched from file-store for Hermes agent reference */
  quotation_text: string | null;
}

export interface HermesAnalysis {
  /** A concise, human-readable status message (1-3 sentences) */
  message: string;
  /** A short insight label — e.g. "on_track", "at_risk", "overdue", "stalled" */
  insight: string;
  /** Suggested action for the team */
  suggested_action: string | null;
  /** Whether the agent should escalate */
  should_escalate: boolean;
  /** Any anomaly detected (null if none) */
  anomaly: string | null;
}

// ── Past Context Retrieval ─────────────────────────────────────────────

interface AgentNoteRow {
  note: string;
  created_at: string;
  agent_name: string;
}

/**
 * Fetch recent agent notes for a given order to provide context to Hermes.
 */
async function getRecentNotes(orderId: string, limit = 5): Promise<AgentNoteRow[]> {
  return query<AgentNoteRow>(
    `SELECT note, created_at, agent_name
     FROM agent_notes
     WHERE order_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [orderId, limit],
  );
}

/**
 * Fetch quotation text from the file-store for a given quotation number.
 * Returns null if not found or if file-store is unreachable.
 */
async function fetchQuotationText(quotationNumber: string | null): Promise<string | null> {
  if (!quotationNumber) return null;
  try {
    const res = await fetch(`${FILE_STORE_URL}/files/${encodeURIComponent(quotationNumber)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean; text?: string };
    return data.text ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch recent notes for the same client across different orders.
 */
async function getClientHistory(clientName: string, limit = 3): Promise<AgentNoteRow[]> {
  return query<AgentNoteRow>(
    `SELECT an.note, an.created_at, an.agent_name
     FROM agent_notes an
     JOIN orders o ON o.id = an.order_id
     WHERE o.client_name = $1
     ORDER BY an.created_at DESC
     LIMIT $2`,
    [clientName, limit],
  );
}

// ── Gemini API Call ────────────────────────────────────────────────────

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
}

async function callGemini(prompt: string): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const url = `${API_BASE}:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generation_config: {
      temperature: HERMES_TEMPERATURE,
      max_output_tokens: HERMES_MAX_TOKENS,
      response_mime_type: 'application/json',
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HERMES_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown error');
      throw new Error(`Gemini API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Gemini returned empty response');
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

// ── OpenRouter Fallback ────────────────────────────────────────────────

interface OpenRouterResponse {
  choices?: {
    message?: {
      content?: string;
    };
  }[];
}

/**
 * Call Gemini via OpenRouter as a fallback when the direct Gemini API
 * is rate-limited (free tier quota exhausted).
 */
async function callOpenRouter(prompt: string): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  const body = {
    model: OPENROUTER_MODEL,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: HERMES_TEMPERATURE,
    max_tokens: HERMES_MAX_TOKENS,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HERMES_TIMEOUT_MS);

  try {
    const res = await fetch(OPENROUTER_API_BASE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown error');
      throw new Error(`OpenRouter API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as OpenRouterResponse;
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error('OpenRouter returned empty response');
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Parse JSON from LLM response ───────────────────────────────────────

function parseAnalysis(raw: string): HermesAnalysis | null {
  try {
    return JSON.parse(raw) as HermesAnalysis;
  } catch {
    // Try extracting JSON from markdown code block
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim()) as HermesAnalysis;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ── Prompt Builder ─────────────────────────────────────────────────────

function buildProductionPrompt(
  ctx: HermesProductionContext,
  recentNotes: AgentNoteRow[],
  clientNotes: AgentNoteRow[],
): string {
  const notesSection = recentNotes.length > 0
    ? `\nRecent notes for this order:\n${recentNotes.map(n => `[${n.created_at}] ${n.agent_name}: ${n.note}`).join('\n')}`
    : '';

  const clientSection = clientNotes.length > 0
    ? `\nClient history (other orders):\n${clientNotes.map(n => `[${n.created_at}] ${n.agent_name}: ${n.note}`).join('\n')}`
    : '';

  const quotationSection = ctx.quotation_text
    ? `\nQUOTATION REFERENCE:\n${ctx.quotation_text.slice(0, 2000)}`
    : '';

  return `You are Hermes Claw, the production monitoring AI for a quotation automation system.

Analyze this production order and provide a concise status update.

ORDER CONTEXT:
- Quotation: ${ctx.quotation_number ?? 'N/A'}
- Client: ${ctx.client_name ?? 'N/A'}
- Sales Agent: ${ctx.sales_agent ?? 'N/A'}
- Current Stage: ${ctx.stage}
- Production Started: ${ctx.production_started ? 'Yes' : 'No'}${ctx.production_started_at ? ` (${ctx.production_started_at})` : ''}
- Estimated Production Days: ${ctx.estimated_production_days ?? 'Not set'}
- Production Delayed: ${ctx.production_delayed ? 'Yes' : 'No'}
- Production Finished: ${ctx.production_finished ? 'Yes' : 'No'}${ctx.production_finished_at ? ` (${ctx.production_finished_at})` : ''}
- En Route Confirmed: ${ctx.en_route_confirmed ? 'Yes' : 'No'}
- Estimated Arrival Days: ${ctx.estimated_arrival_days ?? 'Not set'}
- Days in Current Stage: ${ctx.days_in_stage}
- Timeline Elapsed: ${ctx.pct_elapsed}%
- Overdue: ${ctx.is_overdue ? 'Yes' : 'No'}
- Escalation Level: ${ctx.escalation_level}
${notesSection}${clientSection}${quotationSection}

Provide your analysis as JSON with these fields:
{
  "message": "A concise, human-readable status update (1-3 sentences). Be specific about dates, days elapsed/remaining, and actionable info. Use emoji sparingly.",
  "insight": "One of: on_track, at_risk, overdue, stalled, completed, needs_attention",
  "suggested_action": "A specific action the team should take, or null if none needed",
  "should_escalate": true/false,
  "anomaly": "Describe any anomaly detected (e.g. production started but no timeline set, finished but not en route, overdue without update), or null if everything looks normal"
}`;
}

// ── Main Analysis Function ─────────────────────────────────────────────

/**
 * Try calling an AI model, falling back through providers:
 * 1. Gemini direct (free tier)
 * 2. OpenRouter (paid, same model)
 * 3. Rule-based fallback
 */
async function callAiWithFallback(prompt: string): Promise<string | null> {
  // Try 1: Gemini direct
  if (GEMINI_API_KEY) {
    try {
      return await callGemini(prompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[HermesClaw] Gemini direct failed: ${msg}`);
      // If it's a 429 (rate limit), try OpenRouter next
      if (!msg.includes('429') && !msg.includes('RESOURCE_EXHAUSTED')) {
        // Non-rate-limit error — don't try OpenRouter, return null for rule-based
        return null;
      }
    }
  }

  // Try 2: OpenRouter fallback
  if (OPENROUTER_API_KEY) {
    try {
      console.log('[HermesClaw] Falling back to OpenRouter...');
      return await callOpenRouter(prompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[HermesClaw] OpenRouter fallback also failed: ${msg}`);
    }
  }

  return null;
}

/**
 * Analyze a production order using Hermes Claw (Gemini API with OpenRouter fallback).
 * Returns a structured analysis with message, insight, and suggested action.
 * Falls back to a basic analysis if all AI providers are unavailable.
 */
export async function analyzeProductionOrder(
  ctx: HermesProductionContext,
  orderId: string,
): Promise<HermesAnalysis> {
  // If no AI provider is configured at all, skip straight to rule-based
  if (!GEMINI_API_KEY && !OPENROUTER_API_KEY) {
    return fallbackAnalysis(ctx);
  }

  try {
    // Fetch quotation text from file-store for Hermes agent reference
    const quotationText = await fetchQuotationText(ctx.quotation_number);

    // Gather context from past notes
    const [recentNotes, clientNotes] = await Promise.all([
      getRecentNotes(orderId),
      ctx.client_name ? getClientHistory(ctx.client_name) : Promise.resolve([]),
    ]);

    // Include quotation text in context for the prompt
    const enrichedCtx: HermesProductionContext = {
      ...ctx,
      quotation_text: quotationText,
    };

    const prompt = buildProductionPrompt(enrichedCtx, recentNotes, clientNotes);
    const raw = await callAiWithFallback(prompt);

    // If all AI providers failed, use rule-based
    if (!raw) {
      console.warn('[HermesClaw] All AI providers failed — using rule-based fallback');
      return fallbackAnalysis(ctx);
    }

    const analysis = parseAnalysis(raw);
    if (!analysis) {
      console.warn('[HermesClaw] Failed to parse AI response — using fallback. Raw:', raw.slice(0, 200));
      return fallbackAnalysis(ctx);
    }

    // Write Hermes Claw's insight to agent_notes for future context
    const noteParts: string[] = [];
    noteParts.push(`🧠 Hermes Claw insight: ${analysis.insight}`);
    noteParts.push(`Message: ${analysis.message}`);
    if (analysis.suggested_action) noteParts.push(`Action: ${analysis.suggested_action}`);
    if (analysis.anomaly) noteParts.push(`Anomaly: ${analysis.anomaly}`);

    await addAgentNote(orderId, 'production-agent', noteParts.join('\n')).catch((err) => {
      console.error('[HermesClaw] Failed to write agent note:', err);
    });

    return analysis;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[HermesClaw] Unexpected error: ${errorMsg} — using fallback`);
    return fallbackAnalysis(ctx);
  }
}

// ── Fallback Analysis (rule-based, no AI needed) ───────────────────────

function fallbackAnalysis(ctx: HermesProductionContext): HermesAnalysis {
  // Production confirmed stage
  if (ctx.stage === 'production_confirmed') {
    if (ctx.production_finished) {
      return {
        message: `✅ Production finished for #${ctx.quotation_number ?? 'unknown'}. Ready for en_route confirmation.`,
        insight: 'completed',
        suggested_action: 'Confirm en_route status for this order.',
        should_escalate: false,
        anomaly: null,
      };
    }
    if (!ctx.production_started || !ctx.estimated_production_days) {
      return {
        message: `⚠️ Production confirmed but no timeline set for #${ctx.quotation_number ?? 'unknown'}. Please provide estimated production days.`,
        insight: 'needs_attention',
        suggested_action: 'Set estimated production days and start date.',
        should_escalate: ctx.days_in_stage > 3,
        anomaly: 'Production confirmed but no timeline configured.',
      };
    }
    if (ctx.is_overdue) {
      const overdueDays = Math.round((ctx.pct_elapsed - 100) / 100 * (ctx.estimated_production_days ?? 1));
      return {
        message: `🔴 OVERDUE — #${ctx.quotation_number ?? 'unknown'} is ${overdueDays} day(s) past its ${ctx.estimated_production_days}-day estimate. Needs immediate status update.`,
        insight: 'overdue',
        suggested_action: 'Contact production team for immediate status update.',
        should_escalate: true,
        anomaly: `Order is ${overdueDays} days overdue without completion update.`,
      };
    }
    return {
      message: `🟢 #${ctx.quotation_number ?? 'unknown'} — ${ctx.pct_elapsed}% through ${ctx.estimated_production_days}-day estimate. ${ctx.production_delayed ? '⚠️ Previously flagged as delayed.' : 'On track.'}`,
      insight: ctx.pct_elapsed >= 80 ? 'at_risk' : 'on_track',
      suggested_action: ctx.pct_elapsed >= 80 ? 'Check in with production team proactively.' : null,
      should_escalate: false,
      anomaly: ctx.production_delayed ? 'Previously flagged as delayed — verify current status.' : null,
    };
  }

  // En route stage
  if (ctx.stage === 'en_route') {
    if (ctx.is_overdue) {
      return {
        message: `🔴 #${ctx.quotation_number ?? 'unknown'} is past estimated arrival. Has inventory arrived?`,
        insight: 'overdue',
        suggested_action: 'Confirm if inventory has arrived or provide updated ETA.',
        should_escalate: true,
        anomaly: 'En route overdue without arrival confirmation.',
      };
    }
    return {
      message: `🚚 #${ctx.quotation_number ?? 'unknown'} en route — ${ctx.pct_elapsed}% of estimated ${ctx.estimated_arrival_days ?? 28}-day window elapsed.`,
      insight: ctx.pct_elapsed >= 80 ? 'at_risk' : 'on_track',
      suggested_action: ctx.pct_elapsed >= 80 ? 'Proactively check arrival status.' : null,
      should_escalate: false,
      anomaly: null,
    };
  }

  // Default fallback
  return {
    message: `📋 #${ctx.quotation_number ?? 'unknown'} in stage "${ctx.stage}" — ${ctx.days_in_stage} day(s) in stage.`,
    insight: 'needs_attention',
    suggested_action: null,
    should_escalate: false,
    anomaly: null,
  };
}

/**
 * Check if Hermes Claw (Gemini) is available/configured.
 */
export function isHermesAvailable(): boolean {
  return GEMINI_API_KEY.length > 0;
}
