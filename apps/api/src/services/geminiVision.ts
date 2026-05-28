/**
 * Gemini Vision Service
 *
 * Uses Google Gemini 2.0 Flash (vision) to extract structured data
 * from uploaded images — quotation screenshots, order confirmations,
 * payment receipts, etc.
 */

import {
  CATEGORY_CLASSIFICATION_RULES,
} from './furnitureCategories.js';
import { openRouterVision, isOpenRouterConfigured } from './openRouterService.js';

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY   ?? '',
  process.env.GEMINI_API_KEY_2 ?? '',
  process.env.GEMINI_API_KEY_3 ?? '',
].filter(Boolean);
const MODEL = 'gemini-2.0-flash';
const API_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}`;

// ── Types ────────────────────────────────────────────────────────────────

export interface ExtractedQuotation {
  quotation_number?: string;
  client_name?: string;
  sales_agent?: string;
  total_amount?: number;
  order_date?: string;
  items?: ExtractedInventoryItem[];
}

export interface ExtractedPayment {
  amount?: number;
  type?: 'deposit' | 'balance' | 'unknown';
  reference_number?: string;
  paid_by?: string;
  payment_date?: string;
}

export interface ExtractedInventoryItem {
  product_name?: string;
  description?: string;
  dimension?: string;
  quantity?: number;
  category?: string;
}

export interface VisionExtractResult {
  type: 'quotation' | 'payment' | 'inventory' | 'unknown';
  quotation?: ExtractedQuotation;
  payment?: ExtractedPayment;
  inventory?: ExtractedInventoryItem[];
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

async function callGeminiDirect(
  imageBase64: string,
  mimeType: string,
  prompt: string,
  apiKey: string
): Promise<string> {
  const url = `${API_BASE}:generateContent?key=${apiKey}`;

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
    signal: AbortSignal.timeout(30_000),
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

async function callGemini(
  imageBase64: string,
  mimeType: string,
  prompt: string
): Promise<string> {
  const errors: string[] = [];

  for (const [i, key] of GEMINI_KEYS.entries()) {
    try {
      return await callGeminiDirect(imageBase64, mimeType, prompt, key);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`key${i + 1}: ${message}`);
      console.warn(`[vision] Gemini key${i + 1} failed:`, message);
    }
  }

  if (GEMINI_KEYS.length === 0) {
    errors.push('No GEMINI_API_KEY configured');
  }

  if (isOpenRouterConfigured()) {
    console.warn('[vision] All Gemini keys exhausted; falling back to OpenRouter (Kimi)');
    return openRouterVision(imageBase64, mimeType, prompt);
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
  "total_amount": "number or null — the total amount in PHP (numeric only, no currency symbol)",
  "order_date": "string or null — the date on the quotation/order confirmation document in ISO 8601 format (YYYY-MM-DD)",
  "items": "array of objects — list all products/items listed in the quotation, each with { product_name: string, quantity: number, category: string }"
}

${CATEGORY_CLASSIFICATION_RULES}

Rules:
- Return ONLY valid JSON, no extra text.
- If a field is not visible in the image, set it to null.
- For total_amount, extract the numeric value only (e.g. 15000, not "₱15,000").
- For order_date, look for any date printed on the document (issued date, quotation date, etc.) and format as YYYY-MM-DD.
- For items, extract EVERY product/item listed in the quotation with its name, quantity, and category. If quantity is not specified, default to 1.
- If no items are visible, set items to an empty array [].
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

  // Parse items from the response
  let items: ExtractedInventoryItem[] | undefined;
  if (Array.isArray(parsed.items)) {
    items = parsed.items
      .filter((item: any) => item && typeof item.product_name === 'string' && item.product_name.trim().length > 0)
      .map((item: any) => ({
        product_name: typeof item.product_name === 'string' ? item.product_name.trim() : undefined,
        quantity: typeof item.quantity === 'number' ? item.quantity : (typeof item.quantity === 'string' ? parseInt(item.quantity, 10) || 1 : 1),
        category: typeof item.category === 'string' ? item.category.trim() : undefined,
      }));
    if (items.length === 0) items = undefined;
  }

  const quotation: ExtractedQuotation = {
    quotation_number: typeof parsed.quotation_number === 'string' ? parsed.quotation_number : undefined,
    client_name: typeof parsed.client_name === 'string' ? parsed.client_name : undefined,
    sales_agent: typeof parsed.sales_agent === 'string' ? parsed.sales_agent : undefined,
    total_amount: typeof parsed.total_amount === 'number' ? parsed.total_amount : undefined,
    order_date: typeof parsed.order_date === 'string' ? parsed.order_date : undefined,
    items,
  };

  const hasFields = quotation.quotation_number || quotation.client_name || quotation.total_amount || (items && items.length > 0);
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
  "paid_by": "string or null — the name of the person who made the payment",
  "payment_date": "string or null — the date of payment as shown on the receipt/slip in ISO 8601 format (YYYY-MM-DD)"
}

Rules:
- Return ONLY valid JSON, no extra text.
- If a field is not visible, set it to null.
- Determine if this is a deposit payment or balance payment from context.
- For payment_date, look for transaction date, payment date, or any date printed on the receipt/slip.`;

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
    payment_date: typeof parsed.payment_date === 'string' ? parsed.payment_date : undefined,
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
  "total_amount": "number or null",
  "order_date": "string or null — the date on the document in YYYY-MM-DD format",
  "items": "array of objects — list all products/items listed in the quotation, each with { product_name: string, quantity: number, category: string }"
}

${CATEGORY_CLASSIFICATION_RULES}

If it's a PAYMENT RECEIPT or DEPOSIT SLIP, return:
{
  "type": "payment",
  "amount": "number or null",
  "payment_type": "'deposit' | 'balance' | 'unknown'",
  "reference_number": "string or null",
  "paid_by": "string or null",
  "payment_date": "string or null — the date of payment in YYYY-MM-DD format"
}

Rules:
- Return ONLY valid JSON, no extra text.
- Set unknown fields to null.
- For amounts, use numeric values only (e.g. 15000).
- For dates, look for any date printed on the document and format as YYYY-MM-DD.
- For items, extract EVERY product/item listed in the quotation with its name and quantity. If quantity is not specified, default to 1.
- If no items are visible, set items to an empty array [].`;

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
      payment_date: typeof parsed.payment_date === 'string' ? parsed.payment_date : undefined,
    };
    return {
      type: 'payment',
      payment,
      raw_text: rawText,
      confidence: payment.amount ? 'medium' : 'low',
    };
  }

  // Parse items from the response
  let items: ExtractedInventoryItem[] | undefined;
  if (Array.isArray(parsed.items)) {
    items = parsed.items
      .filter((item: any) => item && typeof item.product_name === 'string' && item.product_name.trim().length > 0)
      .map((item: any) => ({
        product_name: typeof item.product_name === 'string' ? item.product_name.trim() : undefined,
        quantity: typeof item.quantity === 'number' ? item.quantity : (typeof item.quantity === 'string' ? parseInt(item.quantity, 10) || 1 : 1),
        category: typeof item.category === 'string' ? item.category.trim() : undefined,
      }));
    if (items.length === 0) items = undefined;
  }

  const quotation: ExtractedQuotation = {
    quotation_number: typeof parsed.quotation_number === 'string' ? parsed.quotation_number : undefined,
    client_name: typeof parsed.client_name === 'string' ? parsed.client_name : undefined,
    sales_agent: typeof parsed.sales_agent === 'string' ? parsed.sales_agent : undefined,
    total_amount: typeof parsed.total_amount === 'number' ? parsed.total_amount : undefined,
    order_date: typeof parsed.order_date === 'string' ? parsed.order_date : undefined,
    items,
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

// ── Extract Inventory Info ───────────────────────────────────────────────

const INVENTORY_PROMPT = `You are a data extraction assistant. Analyze the image or document and extract all inventory/product items visible. Return a JSON object with an "items" array. Each item should have:

{
  "items": [
    {
      "product_name": "string - the product name or title",
      "description": "string - detailed description if available, otherwise null",
      "dimension": "string - size, dimensions, or specifications (e.g. '10x20x5 cm', 'Large', 'XL'). Capture any measurement info.",
      "quantity": "number - quantity or stock count. Use 0 if out of stock, null if not visible.",
      "category": "string - the furniture category"
    }
  ]
}

${CATEGORY_CLASSIFICATION_RULES}

Rules:
- Return ONLY valid JSON, no extra text.
- If the image shows a single product, return an array with one object.
- If the image shows a table or list of products, extract ALL rows as separate items.
- For dimension, capture any size, measurement, or dimensional info in any format.
- For quantity, extract the numeric value only. If text says 'Out of Stock', use 0.
- If a field is not visible, set it to null.
- Be as accurate as possible.`;

export async function extractInventory(
  imageBase64: string,
  mimeType: string
): Promise<VisionExtractResult> {
  const rawText = await callGemini(imageBase64, mimeType, INVENTORY_PROMPT);
  const parsed = extractJson(rawText);

  if (!parsed) {
    return {
      type: 'unknown',
      raw_text: rawText,
      confidence: 'low',
    };
  }

  const itemsArr = Array.isArray(parsed.items) ? parsed.items : Array.isArray(parsed) ? parsed : [parsed];

  const inventory: ExtractedInventoryItem[] = itemsArr
    .map((item: any) => ({
      product_name: typeof item.product_name === 'string' ? item.product_name : undefined,
      description: typeof item.description === 'string' ? item.description : undefined,
      dimension: typeof item.dimension === 'string' ? item.dimension : undefined,
      quantity: typeof item.quantity === 'number' ? item.quantity : undefined,
      category: typeof item.category === 'string' ? item.category : undefined,
    }))
    .filter((item: ExtractedInventoryItem) => item.product_name || item.description || item.dimension || item.quantity !== undefined);

  const confidence: 'high' | 'medium' | 'low' =
    inventory.length > 0 && inventory.every((i) => i.product_name && i.quantity !== undefined)
      ? 'high'
      : inventory.length > 0
        ? 'medium'
        : 'low';

  return {
    type: 'inventory',
    inventory,
    raw_text: rawText,
    confidence,
  };
}
