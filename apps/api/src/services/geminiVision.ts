/**
 * Gemini Vision Service
 *
 * Uses Google Gemini 2.0 Flash (vision) to extract structured data
 * from uploaded images — quotation screenshots, order confirmations,
 * payment receipts, etc.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? 'google/gemini-2.0-flash-001';
const MODEL = 'gemini-2.0-flash';
const API_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}`;
const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1/chat/completions';

// ── Types ────────────────────────────────────────────────────────────────

export interface ExtractedQuotation {
  quotation_number?: string;
  client_name?: string;
  sales_agent?: string;
  total_amount?: number;
}

export interface ExtractedPayment {
  amount?: number;
  type?: 'deposit' | 'balance' | 'unknown';
  reference_number?: string;
  paid_by?: string;
}

export interface VisionExtractResult {
  type: 'quotation' | 'payment' | 'unknown';
  quotation?: ExtractedQuotation;
  payment?: ExtractedPayment;
  raw_text: string;
  confidence: 'high' | 'medium' | 'low';
}

// ── Core: call Gemini API ────────────────────────────────────────────────

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
}

interface OpenRouterResponse {
  choices?: {
    message?: {
      content?: OpenRouterContent;
    };
  }[];
}

type OpenRouterContent = string | { type?: string; text?: string }[];

async function callGeminiDirect(
  imageBase64: string,
  mimeType: string,
  prompt: string
): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const url = `${API_BASE}:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBase64,
            },
          },
        ],
      },
    ],
    generation_config: {
      temperature: 0.1,
      max_output_tokens: 1024,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
}

function openRouterTextContent(content: OpenRouterContent | undefined): string | undefined {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === 'text' || !part.type ? part.text ?? '' : ''))
      .join('')
      .trim();
  }
  return undefined;
}

async function callOpenRouter(
  imageBase64: string,
  mimeType: string,
  prompt: string
): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  const body = {
    model: OPENROUTER_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${imageBase64}`,
            },
          },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 1024,
  };

  const res = await fetch(OPENROUTER_API_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.DASHBOARD_BASE_URL ?? 'https://track.abcx124.xyz',
      'X-Title': 'Quotation Automation System',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown error');
    throw new Error(`OpenRouter API error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as OpenRouterResponse;
  const text = openRouterTextContent(data.choices?.[0]?.message?.content);
  if (!text) {
    throw new Error('OpenRouter returned empty response');
  }
  return text;
}

async function callGemini(
  imageBase64: string,
  mimeType: string,
  prompt: string
): Promise<string> {
  const errors: string[] = [];

  if (GEMINI_API_KEY) {
    try {
      return await callGeminiDirect(imageBase64, mimeType, prompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      console.warn('[vision] Gemini failed; trying OpenRouter fallback:', message);
    }
  } else {
    errors.push('GEMINI_API_KEY is not configured');
  }

  if (OPENROUTER_API_KEY) {
    return callOpenRouter(imageBase64, mimeType, prompt);
  }

  throw new Error(`No vision AI provider available. ${errors.join(' | ')}`);
}

// ── Extract JSON from Gemini text response ───────────────────────────────

function extractJson(text: string): Record<string, unknown> | null {
  // Try to find a JSON block between ```json and ```
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();

  try {
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    // Try to find the first { ... } in the text
    const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0]) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ── Extract Quotation Info ───────────────────────────────────────────────

const QUOTATION_PROMPT = `You are a data extraction assistant. Analyze the image and extract the following fields as JSON:

{
  "quotation_number": "string or null — the quotation/order number (e.g. QTN-2025-0001)",
  "client_name": "string or null — the client or customer name",
  "sales_agent": "string or null — the sales agent or person who prepared the quotation",
  "total_amount": "number or null — the total amount in PHP (numeric only, no currency symbol)"
}

Rules:
- Return ONLY valid JSON, no extra text.
- If a field is not visible in the image, set it to null.
- For total_amount, extract the numeric value only (e.g. 15000, not "₱15,000").
- Be as accurate as possible.`;

export async function extractQuotation(
  imageBase64: string,
  mimeType: string
): Promise<VisionExtractResult> {
  const rawText = await callGemini(imageBase64, mimeType, QUOTATION_PROMPT);
  const parsed = extractJson(rawText);

  if (!parsed) {
    return {
      type: 'unknown',
      raw_text: rawText,
      confidence: 'low',
    };
  }

  const quotation: ExtractedQuotation = {
    quotation_number: typeof parsed.quotation_number === 'string' ? parsed.quotation_number : undefined,
    client_name: typeof parsed.client_name === 'string' ? parsed.client_name : undefined,
    sales_agent: typeof parsed.sales_agent === 'string' ? parsed.sales_agent : undefined,
    total_amount: typeof parsed.total_amount === 'number' ? parsed.total_amount : undefined,
  };

  const hasFields = quotation.quotation_number || quotation.client_name || quotation.total_amount;
  const confidence: 'high' | 'medium' | 'low' =
    quotation.quotation_number && quotation.total_amount
      ? 'high'
      : hasFields
        ? 'medium'
        : 'low';

  return {
    type: 'quotation',
    quotation,
    raw_text: rawText,
    confidence,
  };
}

// ── Extract Payment Info ─────────────────────────────────────────────────

const PAYMENT_PROMPT = `You are a data extraction assistant. Analyze the image and extract the following fields as JSON:

{
  "amount": "number or null — the payment amount in PHP (numeric only)",
  "type": "string — one of: 'deposit', 'balance', or 'unknown'",
  "reference_number": "string or null — any reference/transaction number",
  "paid_by": "string or null — the name of the person who made the payment"
}

Rules:
- Return ONLY valid JSON, no extra text.
- If a field is not visible, set it to null.
- Determine if this is a deposit payment or balance payment from context.`;

export async function extractPayment(
  imageBase64: string,
  mimeType: string
): Promise<VisionExtractResult> {
  const rawText = await callGemini(imageBase64, mimeType, PAYMENT_PROMPT);
  const parsed = extractJson(rawText);

  if (!parsed) {
    return {
      type: 'unknown',
      raw_text: rawText,
      confidence: 'low',
    };
  }

  const payment: ExtractedPayment = {
    amount: typeof parsed.amount === 'number' ? parsed.amount : undefined,
    type: parsed.type === 'deposit' || parsed.type === 'balance' ? parsed.type : 'unknown',
    reference_number: typeof parsed.reference_number === 'string' ? parsed.reference_number : undefined,
    paid_by: typeof parsed.paid_by === 'string' ? parsed.paid_by : undefined,
  };

  const confidence: 'high' | 'medium' | 'low' =
    payment.amount && payment.type !== 'unknown'
      ? 'high'
      : payment.amount
        ? 'medium'
        : 'low';

  return {
    type: 'payment',
    payment,
    raw_text: rawText,
    confidence,
  };
}

// ── Auto-detect and extract ──────────────────────────────────────────────

const AUTO_PROMPT = `You are a data extraction assistant. Analyze the image and determine what type of document it is, then extract the relevant fields.

If it's a QUOTATION or ORDER CONFIRMATION, return:
{
  "type": "quotation",
  "quotation_number": "string or null",
  "client_name": "string or null",
  "sales_agent": "string or null",
  "total_amount": "number or null"
}

If it's a PAYMENT RECEIPT or DEPOSIT SLIP, return:
{
  "type": "payment",
  "amount": "number or null",
  "payment_type": "'deposit' | 'balance' | 'unknown'",
  "reference_number": "string or null",
  "paid_by": "string or null"
}

Rules:
- Return ONLY valid JSON, no extra text.
- Set unknown fields to null.
- For amounts, use numeric values only (e.g. 15000).`;

export async function autoExtract(
  imageBase64: string,
  mimeType: string
): Promise<VisionExtractResult> {
  const rawText = await callGemini(imageBase64, mimeType, AUTO_PROMPT);
  const parsed = extractJson(rawText);

  if (!parsed) {
    return {
      type: 'unknown',
      raw_text: rawText,
      confidence: 'low',
    };
  }

  const docType = parsed.type === 'payment' ? 'payment' : 'quotation';

  if (docType === 'payment') {
    const payment: ExtractedPayment = {
      amount: typeof parsed.amount === 'number' ? parsed.amount : undefined,
      type:
        parsed.payment_type === 'deposit' || parsed.payment_type === 'balance'
          ? parsed.payment_type
          : 'unknown',
      reference_number: typeof parsed.reference_number === 'string' ? parsed.reference_number : undefined,
      paid_by: typeof parsed.paid_by === 'string' ? parsed.paid_by : undefined,
    };
    return {
      type: 'payment',
      payment,
      raw_text: rawText,
      confidence: payment.amount ? 'medium' : 'low',
    };
  }

  const quotation: ExtractedQuotation = {
    quotation_number: typeof parsed.quotation_number === 'string' ? parsed.quotation_number : undefined,
    client_name: typeof parsed.client_name === 'string' ? parsed.client_name : undefined,
    sales_agent: typeof parsed.sales_agent === 'string' ? parsed.sales_agent : undefined,
    total_amount: typeof parsed.total_amount === 'number' ? parsed.total_amount : undefined,
  };

  const confidence: 'high' | 'medium' | 'low' =
    quotation.quotation_number && quotation.total_amount
      ? 'high'
      : quotation.quotation_number || quotation.client_name
        ? 'medium'
        : 'low';

  return {
    type: 'quotation',
    quotation,
    raw_text: rawText,
    confidence,
  };
}

// ── Extract Order Number (for reminders) ─────────────────────────────────

const ORDER_NUMBER_PROMPT = `You are a data extraction assistant. Analyze the image and extract any order number, quotation number, purchase order number, or reference number visible in the image.

Return ONLY valid JSON:
{
  "order_number": "string or null — the order/quotation/PO number found in the image",
  "client_name": "string or null — the client or customer name if visible",
  "has_number": true or false — whether a number was found
}

Rules:
- Return ONLY valid JSON, no extra text.
- If no order number is visible, set order_number to null and has_number to false.
- Look for patterns like QTN-2025-XXXX, PO-XXXX, INV-XXXX, or any numeric reference.`;

export async function extractOrderNumber(
  imageBase64: string,
  mimeType: string
): Promise<{ order_number: string | null; client_name: string | null; has_number: boolean }> {
  const rawText = await callGemini(imageBase64, mimeType, ORDER_NUMBER_PROMPT);
  const parsed = extractJson(rawText);

  if (!parsed) {
    return { order_number: null, client_name: null, has_number: false };
  }

  return {
    order_number: typeof parsed.order_number === 'string' && parsed.order_number ? parsed.order_number : null,
    client_name: typeof parsed.client_name === 'string' && parsed.client_name ? parsed.client_name : null,
    has_number: parsed.has_number === true,
  };
}
