import { query } from '../db.js';
import { semanticSearch, type SearchResult } from './knowledgeBase.js';
import { openRouterChat, isOpenRouterConfigured, openAiChat, isOpenAiConfigured } from './openRouterService.js';
import { readFile } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// ── Configuration ──────────────────────────────────────────────────────

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY   ?? '',
  process.env.GEMINI_API_KEY_2 ?? '',
  process.env.GEMINI_API_KEY_3 ?? '',
].filter(Boolean);
const CHAT_MODEL = process.env.CHAT_MODEL ?? 'gemini-2.0-flash';
const CHAT_TEMPERATURE = parseFloat(process.env.CHAT_TEMPERATURE ?? '0.3');
const CHAT_MAX_TOKENS = parseInt(process.env.CHAT_MAX_TOKENS ?? '1024', 10);
const MAX_HISTORY = parseInt(process.env.CHAT_MAX_HISTORY ?? '20', 10);
const CHAT_TIMEOUT_MS = parseInt(process.env.CHAT_TIMEOUT_MS ?? '30000', 10);
const API_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}`;

// ── Types ──────────────────────────────────────────────────────────────

export interface ChatMessage {
  id?: string;
  conversation_id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: { title: string; url: string | null }[];
  suggestions?: string[];
  created_at?: string;
}

export interface Conversation {
  id: string;
  user_email: string;
  user_name: string | null;
  title: string;
  message_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ── System Prompt ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the **QAS Tutorial Assistant**, a friendly and knowledgeable guide for the Quotation Automation System (QAS) platform.

Your role is to help users learn how to use every feature of the platform through step-by-step guidance, accurate answers, and up-to-date knowledge.

## Guidelines
1. **Be helpful and concise** — Use bullet points and numbered steps for clarity.
2. **Cite your sources** — When providing information, reference where it came from (e.g., "According to the Guides page..." or "Per the latest changelog...").
3. **Never fabricate features** — Only answer based on the knowledge base provided below. If you don't know, say so.
4. **Respect roles** — Do not reveal admin-only information (bug logs, internal updates) to non-admin users unless they identify as admin.
5. **Link to pages** — When relevant, suggest the user visit specific dashboard pages (e.g., /orders, /production).
6. **Offer follow-ups** — After answering, suggest 2-3 related questions the user might want to ask next.

## Knowledge Base Context
The following information was retrieved from the platform's knowledge base to help answer the user's question. Use it to provide accurate, up-to-date answers.

{knowledge_context}

## User Role
The user's role is: {user_role}

## Current Dashboard Page (if known)
The user is currently on: {current_page}`;

// ── Follow-up Suggestions ──────────────────────────────────────────────

const DEFAULT_SUGGESTIONS = [
  'How do I create a new order?',
  'What are the different order stages?',
  'How does the production workflow work?',
  'How do I record a payment?',
  'What is the Telegram bot for?',
];

function generateSuggestions(query: string, results: SearchResult[]): string[] {
  // Generate context-aware suggestions based on the search results
  const sources = [...new Set(results.map((r) => r.source))];
  const suggestions: string[] = [];

  if (sources.includes('Guides Page') || sources.includes('CHANGELOG')) {
    suggestions.push('What are the latest platform updates?');
    suggestions.push('How do I use the Guides page?');
  }

  if (sources.some((s) => s.toLowerCase().includes('order'))) {
    suggestions.push('How do I track an order through the pipeline?');
    suggestions.push('What happens at each stage of an order?');
  }

  if (sources.some((s) => s.toLowerCase().includes('production'))) {
    suggestions.push('How do I start production on an order?');
    suggestions.push('What is item-level production tracking?');
  }

  if (sources.some((s) => s.toLowerCase().includes('payment') || s.toLowerCase().includes('collection'))) {
    suggestions.push('How do I record a deposit payment?');
    suggestions.push('How does payment verification work?');
  }

  if (sources.some((s) => s.toLowerCase().includes('inventory'))) {
    suggestions.push('How does inventory verification work?');
    suggestions.push('How do I match inventory items to orders?');
  }

  // Add generic suggestions if we don't have enough
  if (suggestions.length < 2) {
    suggestions.push(...DEFAULT_SUGGESTIONS);
  }

  return suggestions.slice(0, 3);
}

// ── Format Knowledge Context ───────────────────────────────────────────

function formatKnowledgeContext(results: SearchResult[]): string {
  if (results.length === 0) return 'No relevant knowledge base entries found.';

  return results
    .map(
      (r, i) =>
        `[Source ${i + 1}: ${r.title}${r.source_url ? ` (${r.source_url})` : ''}]\n${r.chunk_text}`
    )
    .join('\n\n');
}

// ── Call Gemini Chat API (tries all keys in sequence) ─────────────────

async function callGeminiWithKey(
  messages: { role: string; content: string }[],
  systemPrompt: string,
  apiKey: string
): Promise<string> {
  const contents = [
    { role: 'user', parts: [{ text: `${systemPrompt}\n\n---\n\nPlease answer the following questions based on the above instructions.` }] },
    { role: 'model', parts: [{ text: 'I understand. I will follow those guidelines carefully.' }] },
    ...messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
  ];

  const url = `${API_BASE}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generation_config: { temperature: CHAT_TEMPERATURE, max_output_tokens: CHAT_MAX_TOKENS },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned empty response');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini(
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<string | null> {
  if (GEMINI_KEYS.length === 0) {
    console.warn('[chatService] No Gemini API keys configured');
    return null;
  }

  for (const [i, key] of GEMINI_KEYS.entries()) {
    try {
      return await callGeminiWithKey(messages, systemPrompt, key);
    } catch (err: any) {
      console.warn(`[chatService] Gemini key${i + 1} failed: ${err.message}`);
    }
  }

  console.warn('[chatService] All Gemini keys exhausted');
  return null;
}

// ── Call OpenRouter (Fallback) Chat API — via openRouterService ────────

async function callOpenRouter(
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<string | null> {
  if (!isOpenRouterConfigured()) {
    console.warn('[chatService] OPENROUTER_API_KEY not set — no fallback available');
    return null;
  }

  try {
    const orMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...messages.map(m => ({
        role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.content,
      })),
    ];
    return await openRouterChat(orMessages, undefined, {
      temperature: CHAT_TEMPERATURE,
      max_tokens: CHAT_MAX_TOKENS,
      timeoutMs: CHAT_TIMEOUT_MS,
    });
  } catch (err: any) {
    console.error(`[chatService] OpenRouter (Kimi) fallback failed: ${err.message}`);
    return null;
  }
}

// ── Call OpenAI Chat (Tier 3 Fallback) ─────────────────────────────────

async function callOpenAI(
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<string | null> {
  if (!isOpenAiConfigured()) {
    console.warn('[chatService] OPENAI_API_KEY not set — no OpenAI fallback available');
    return null;
  }

  try {
    const oaiMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...messages.map(m => ({
        role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.content,
      })),
    ];
    return await openAiChat(oaiMessages, undefined, {
      temperature: CHAT_TEMPERATURE,
      max_tokens: CHAT_MAX_TOKENS,
      timeoutMs: CHAT_TIMEOUT_MS,
    });
  } catch (err: any) {
    console.error(`[chatService] OpenAI fallback failed: ${err.message}`);
    return null;
  }
}

// ── Call AI with Gemini → OpenRouter → OpenAI fallback ─────────────────

async function callChatAPI(
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<string | null> {
  // Try Gemini first
  const geminiResult = await callGemini(messages, systemPrompt);
  if (geminiResult !== null) {
    return geminiResult;
  }

  // Fallback to OpenRouter if Gemini fails (quota exhausted, rate-limited, etc.)
  console.log('[chatService] Gemini unavailable, trying OpenRouter fallback...');
  const openRouterResult = await callOpenRouter(messages, systemPrompt);
  if (openRouterResult !== null) {
    return openRouterResult;
  }

  // Fallback to OpenAI if OpenRouter also fails
  console.log('[chatService] OpenRouter unavailable, trying OpenAI fallback...');
  const openAiResult = await callOpenAI(messages, systemPrompt);
  if (openAiResult !== null) {
    return openAiResult;
  }

  console.warn('[chatService] All AI providers (Gemini, OpenRouter, OpenAI) failed — using fallback response');
  return null;
}

// ── Create Conversation ────────────────────────────────────────────────

export async function createConversation(
  userEmail: string,
  userName: string | null,
  title?: string
): Promise<Conversation> {
  const result = await query(
    `INSERT INTO chat_conversations (user_email, user_name, title)
     VALUES ($1, $2, $3) RETURNING *`,
    [userEmail, userName, title ?? 'New Conversation']
  );
  return result[0] as unknown as Conversation;
}

// ── Get User Conversations ─────────────────────────────────────────────

export async function getUserConversations(userEmail: string): Promise<Conversation[]> {
  return query<Conversation>(
    `SELECT * FROM chat_conversations
     WHERE user_email = $1
     ORDER BY updated_at DESC
     LIMIT 20`,
    [userEmail]
  );
}

// ── Get Conversation Messages ──────────────────────────────────────────

export async function getConversationMessages(conversationId: string): Promise<ChatMessage[]> {
  return query<ChatMessage>(
    `SELECT * FROM chat_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId]
  );
}

// ── Send Message ───────────────────────────────────────────────────────

export interface SendMessageResult {
  user_message: ChatMessage;
  assistant_message: ChatMessage;
  conversation: Conversation;
}

export async function sendMessage(
  conversationId: string,
  content: string,
  userEmail: string,
  userName: string | null,
  userRole: string,
  currentPage?: string
): Promise<SendMessageResult> {
  // 1. Save user message
  const userMsgResult = await query(
    `INSERT INTO chat_messages (conversation_id, role, content)
     VALUES ($1, 'user', $2) RETURNING *`,
    [conversationId, content]
  );
  const userMessage = userMsgResult[0] as unknown as ChatMessage;

  // 2. Search knowledge base
  const searchResults = await semanticSearch(content, 5);

  // 3. Get conversation history for context
  const history = await query<{ role: string; content: string }>(
    `SELECT role, content FROM chat_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [conversationId, MAX_HISTORY]
  );

  // 4. Build system prompt with knowledge context
  const knowledgeContext = formatKnowledgeContext(searchResults);
  const systemPrompt = SYSTEM_PROMPT
    .replace('{knowledge_context}', knowledgeContext)
    .replace('{user_role}', userRole)
    .replace('{current_page}', currentPage ?? 'unknown');

  // 5. Call AI
  const aiResponse = await callChatAPI(
    history.map((m) => ({ role: m.role, content: m.content })),
    systemPrompt
  );

  // 6. Generate response (fallback if AI fails)
  const responseContent = aiResponse ?? generateFallbackResponse(content, searchResults);

  // 7. Generate suggestions
  const suggestions = generateSuggestions(content, searchResults);

  // 8. Build sources list
  const sources = searchResults.map((r) => ({
    title: r.title,
    url: r.source_url,
  }));

  // 9. Save assistant message
  const assistantMsgResult = await query(
    `INSERT INTO chat_messages (conversation_id, role, content, sources, suggestions)
     VALUES ($1, 'assistant', $2, $3::jsonb, $4::jsonb) RETURNING *`,
    [conversationId, responseContent, JSON.stringify(sources), JSON.stringify(suggestions)]
  );
  const assistantMessage = assistantMsgResult[0] as unknown as ChatMessage;

  // 10. Update conversation
  const convResult = await query(
    `UPDATE chat_conversations
     SET message_count = message_count + 1, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [conversationId]
  );
  const conversation = convResult[0] as unknown as Conversation;

  return {
    user_message: userMessage,
    assistant_message: assistantMessage,
    conversation,
  };
}

// ── Fallback Response (when AI is unavailable) ─────────────────────────

function generateFallbackResponse(query: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `I'm sorry, I couldn't find any information about "${query}" in the platform's knowledge base. Here are some things you can try:

1. **Check the Guides page** — Visit the [/guides](/guides) page for step-by-step tutorials on all platform features.
2. **Search more specifically** — Try rephrasing your question with more specific terms.
3. **Contact support** — If you need further assistance, please reach out to your system administrator.`;
  }

  const topResult = results[0];
  return `Based on the platform documentation, here's what I found about your question:

> ${topResult.chunk_text.substring(0, 500)}${topResult.chunk_text.length > 500 ? '...' : ''}

*Source: ${topResult.title}${topResult.source_url ? ` — [View in dashboard](${topResult.source_url})` : ''}*

Would you like me to elaborate on any specific part of this information?`;
}

// ── Reset Conversation ─────────────────────────────────────────────────

export async function resetConversation(conversationId: string): Promise<void> {
  await query(
    `UPDATE chat_conversations SET is_active = false WHERE id = $1`,
    [conversationId]
  );
}

// ── Get Update Logs (admin/bot only) ───────────────────────────────────

export interface UpdateLogEntry {
  date: string;
  extension: string;
  description: string;
  status: string;
}

export async function getUpdateLogs(limit = 50): Promise<UpdateLogEntry[]> {
  // Try to read from the database-stored knowledge document first
  try {
    const docs = await query<{ content: string }>(
      `SELECT content FROM knowledge_documents WHERE source = 'UPDATE_LOG' LIMIT 1`
    );

    if (docs[0]) {
      return parseUpdateLogContent(docs[0].content, limit);
    }
  } catch {
    // Fall through to file-based reading
  }

  // Fallback: read directly from the UPDATE_LOG.md file
  try {
    const projectRoot = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..'));
    const filePath = join(projectRoot, 'docs', 'UPDATE_LOG.md');
    const content = await readFile(filePath, 'utf-8');
    return parseUpdateLogContent(content, limit);
  } catch (err: any) {
    console.error(`[chatService] Failed to read UPDATE_LOG.md: ${err.message}`);
    return [];
  }
}

function parseUpdateLogContent(content: string, limit: number): UpdateLogEntry[] {
  const entries: UpdateLogEntry[] = [];
  const lines = content.split('\n');

  let currentDate = '';
  for (const line of lines) {
    // Match date headers like "## 2026-05-27"
    const dateMatch = line.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      currentDate = dateMatch[1];
      continue;
    }

    // Match table rows like "| 2026-05-27 03:56 | Roo (Code) | Description | ✅ Done |"
    const rowMatch = line.match(/^\|\s*(\d{4}-\d{2}-\d{2}[^|]*)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/);
    if (rowMatch) {
      entries.push({
        date: currentDate || rowMatch[1].trim(),
        extension: rowMatch[2].trim(),
        description: rowMatch[3].trim(),
        status: rowMatch[4].trim(),
      });
    }
  }

  return entries.slice(0, limit);
}
