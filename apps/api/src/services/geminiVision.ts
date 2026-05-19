/**
 * Gemini Vision Service
 *
 * Uses Google Gemini 2.0 Flash (vision) to extract structured data
 * from uploaded images — quotation screenshots, order confirmations,
 * payment receipts, etc.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const MODEL = 'gemini-2.0-flash';
const API_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}`;

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

async function callGemini(
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
