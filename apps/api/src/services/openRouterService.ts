/**
 * OpenRouter Service
 *
 * Centralised client for OpenRouter API — text completion and vision (multimodal).
 * Free-tier models used by default:
 *   Vision : moonshotai/kimi-vl-a3b-thinking:free  (Kimi VL, dedicated vision)
 *   Chat   : moonshotai/kimi-k2.6:free             (Kimi K2.6, 262k ctx, multimodal)
 *
 * Rate limits on free tier: ~20 req/min, ~200 req/day — suitable as a fallback.
 */

const OPENROUTER_API_KEY   = process.env.OPENROUTER_API_KEY   ?? '';
const OPENROUTER_API_BASE  = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_SITE_URL  = process.env.DASHBOARD_BASE_URL   ?? 'https://track.abcx124.xyz';
const OPENROUTER_SITE_NAME = 'Quotation Automation System';

export const OPENROUTER_MODELS = {
  /** Default vision/multimodal model — free, 262k context */
  vision: process.env.OPENROUTER_VISION_MODEL ?? 'moonshotai/kimi-vl-a3b-thinking:free',
  /** Default chat/text model — free, 262k context, multimodal */
  chat:   process.env.OPENROUTER_CHAT_MODEL   ?? 'moonshotai/kimi-k2.6:free',
  /** Legacy single-model override (kept for backwards compatibility) */
  legacy: process.env.OPENROUTER_MODEL        ?? 'moonshotai/kimi-k2.6:free',
} as const;

// ── Types ────────────────────────────────────────────────────────────────────

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

interface OpenRouterRequestBody {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
}

interface OpenRouterResponse {
  choices?: { message?: { content?: string | ContentPart[] } }[];
  error?: { message?: string };
}

function extractText(content: string | ContentPart[] | undefined): string | undefined {
  if (typeof content === 'string') return content || undefined;
  if (Array.isArray(content)) {
    const text = content
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join('')
      .trim();
    return text || undefined;
  }
  return undefined;
}

// ── Core fetch ────────────────────────────────────────────────────────────────

async function request(
  body: OpenRouterRequestBody,
  timeoutMs = 30_000
): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  const res = await fetch(OPENROUTER_API_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': OPENROUTER_SITE_URL,
      'X-Title': OPENROUTER_SITE_NAME,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown error');
    throw new Error(`OpenRouter API error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as OpenRouterResponse;

  if (data.error?.message) {
    throw new Error(`OpenRouter error: ${data.error.message}`);
  }

  const text = extractText(data.choices?.[0]?.message?.content);
  if (!text) {
    throw new Error('OpenRouter returned empty response');
  }
  return text;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Text / chat completion.
 *
 * @param messages   Conversation history (system, user, assistant turns)
 * @param model      OpenRouter model ID — defaults to OPENROUTER_MODELS.chat
 * @param options    temperature, max_tokens, timeoutMs
 */
export async function openRouterChat(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  model = OPENROUTER_MODELS.chat,
  options: { temperature?: number; max_tokens?: number; timeoutMs?: number } = {}
): Promise<string> {
  return request(
    {
      model,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens:  options.max_tokens  ?? 1024,
    },
    options.timeoutMs
  );
}

/**
 * Vision / multimodal completion — sends an image alongside a text prompt.
 *
 * @param imageBase64  Base-64 encoded image data
 * @param mimeType     MIME type (e.g. "image/jpeg")
 * @param prompt       Text instruction
 * @param model        OpenRouter model ID — defaults to OPENROUTER_MODELS.vision
 * @param options      temperature, max_tokens, timeoutMs
 */
export async function openRouterVision(
  imageBase64: string,
  mimeType: string,
  prompt: string,
  model = OPENROUTER_MODELS.vision,
  options: { temperature?: number; max_tokens?: number; timeoutMs?: number } = {}
): Promise<string> {
  const messages: OpenRouterMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        {
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${imageBase64}` },
        },
      ],
    },
  ];

  return request(
    {
      model,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens:  options.max_tokens  ?? 1024,
    },
    options.timeoutMs
  );
}

/**
 * Check whether the OpenRouter key is configured.
 */
export function isOpenRouterConfigured(): boolean {
  return OPENROUTER_API_KEY.length > 0;
}
