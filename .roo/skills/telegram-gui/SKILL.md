---
name: telegram-gui
description: Build, extend, and maintain Telegram inline keyboard GUIs using Telegraf. Covers callback_data patterns, multi-step workflows, session management, UUID shortening, agent-driven notifications, and vision extraction flows.
---

# Telegram GUI Skill — Telegraf Inline Keyboard Patterns

## When To Use

Use this skill when working with the Telegram bot at [`apps/telegram-bot/src/bot.ts`](apps/telegram-bot/src/bot.ts) or any Telegraf-based inline keyboard GUI. This covers:

- Adding new inline keyboard buttons and callback handlers
- Creating multi-step text input workflows
- Fixing `BUTTONDATAINVALID` errors (callback_data > 64 bytes)
- Wiring agent-driven notifications with inline keyboards
- Implementing vision extraction flows (document/photo → AI extract → confirm)

## Architecture Overview

The bot uses a **single-file** architecture at [`apps/telegram-bot/src/bot.ts`](apps/telegram-bot/src/bot.ts) (~5954 lines) with:

| Layer | Description |
|-------|-------------|
| **Global middleware** | `answerCbQuery`, error handler, `editMessageText` safety patch, group chat guard, rate limiting |
| **Session management** | In-memory `Map<chatId, UserSession>` with `setStep()` / `resetStep()` |
| **Menu navigation** | `menu:(action)` handler dispatches to sub-menus |
| **Order picker** | `pick:(action):(quotationNumber)` — reusable order selection |
| **Callback handlers** | 56+ `bot.action()` regex handlers for inline keyboard buttons |
| **Text handlers** | 24 `case 'awaiting_*'` states in the `message('text')` handler |
| **File handlers** | `document` and `photo` handlers for uploads + vision extraction |
| **Webhook** | HTTP server receiving Telegram updates, with retry logic |

## Critical Rules

### 1. callback_data MUST be ≤ 64 bytes

Telegram enforces a **hard 64-byte limit** on `callback_data`. Every character = 1 byte. Calculate before writing:

```typescript
// ❌ BAD — full UUID is 36 chars, total > 64 bytes
callback_data: `item_prod:finished:${itemId}:${orderId}`
// item_prod:finished:xxxxxxxx:yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy = 73 bytes ❌

// ✅ GOOD — use 8-char UUID prefix + quotation number for resolution
callback_data: `item_prod:finished:${itemId.slice(0, 8)}:${quotationNumber}`
// item_prod:finished:xxxxxxxx:QTN-2026-001 = ~45 bytes ✅
```

**UUID shortening pattern**: Always use `.slice(0, 8)` for UUIDs in callback_data. Include the `quotationNumber` as the last segment so the handler can resolve the full UUID via `getOrderByQuotation()`.

### 2. Callback Data Format Convention

Use **colon-separated segments** with a clear prefix hierarchy:

```
action:subaction:itemIdShort:orderIdShort:quotationNumber
```

| Segment | Description | Max Length |
|---------|-------------|------------|
| `action` | Top-level action group (e.g., `inv_verify`, `item_prod`) | variable |
| `subaction` | Specific action (e.g., `all`, `partial`, `finished`) | variable |
| `itemIdShort` | 8-char UUID prefix for the item | 8 |
| `orderIdShort` | 8-char UUID prefix for the order | 8 |
| `quotationNumber` | Human-readable order reference (e.g., `QTN-2026-001`) | variable |

**Regex pattern**: Always use `[^:]+` for segments that don't contain colons, and `.+` for the last segment (quotation number).

```typescript
// 3-segment: action:subaction:quotationNumber
bot.action(/^inv_arr:(yes|no|partial):(.+)$/, handler)

// 4-segment: action:subaction:itemIdShort:quotationNumber
bot.action(/^item_prod:(finished|in_progress|pending):([^:]+):(.+)$/, handler)

// 5-segment: action:subaction:itemIdShort:orderIdShort:quotationNumber
bot.action(/^inv_verify:(all|partial|not_yet):([^:]+):([^:]+):(.+)$/, handler)
```

### 3. UUID Resolution Pattern

When you shorten a UUID in callback_data, the handler must resolve the full UUID before making API calls:

```typescript
bot.action(/^item_prod:(finished|in_progress|pending):([^:]+):(.+)$/, async (ctx) => {
  const newStatus = ctx.match[1];
  const itemId = ctx.match[2];       // 8-char prefix
  const quotationNumber = ctx.match[3];

  // Resolve full order UUID
  const orderData = await getOrderByQuotation(quotationNumber);
  const orderId = orderData.id;       // full 36-char UUID

  // Now use full UUID for API calls
  await postJson(`/orders/${orderId}/items/${itemId}`, { ... });
});
```

The helper function at line 2995:
```typescript
async function getOrderByQuotation(quotationNumber: string): Promise<any> {
  const orderRes = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(quotationNumber)}`);
  if (!orderRes.ok) throw new Error(`Order #${quotationNumber} not found`);
  return orderRes.json();
}
```

### 4. Multi-Step Workflow Pattern

For workflows requiring text input after a button click, use the **session step** pattern:

```typescript
// Step 1: Button handler sets the step
bot.action(/^my_action:(.+)$/, async (ctx) => {
  const quotationNumber = ctx.match[1];
  setStep(chatId, {
    action: 'awaiting_my_input',
    data: { quotationNumber },
  });
  await ctx.reply('Please type your input:', { parse_mode: 'Markdown', ...cancelButton() });
});

// Step 2: Text handler processes the input
case 'awaiting_my_input': {
  const { quotationNumber } = session.step.data;
  const userInput = text;
  // Process input...
  resetStep(chatId);
}
```

**Session type definition** (line 391):
```typescript
type UserStep =
  | { action: 'awaiting_order_number_for_status'; data?: any }
  | { action: 'awaiting_inv_verify_qty'; data: { itemId: string; orderId: string; quotationNumber: string } }
  // ... add new steps here
```

### 5. Button Label Truncation

Button labels (the visible text) have no hard byte limit from Telegram, but keep them reasonable:

```typescript
// For order picker buttons, truncate to 60 chars
const label = `${o.quotation_number}${o.client_name ? ` — ${o.client_name}` : ''}`.substring(0, 60);
```

### 6. Agent-Driven Notifications

Agents (in [`apps/api/src/agents/`](apps/api/src/agents/)) send notifications with inline keyboards via the API. The callback_data is created in the agent files, not in `bot.ts`:

| Agent File | Callback Prefix | Handler in bot.ts |
|------------|----------------|-------------------|
| [`inventoryAgent.ts`](apps/api/src/agents/inventoryAgent.ts) | `inv_verify:*` | Line 3258 |
| [`productionAgent.ts`](apps/api/src/agents/productionAgent.ts) | `item_prod:*`, `item_en_route:*` | Lines 2514, 2660 |
| [`collectionAgent.ts`](apps/api/src/agents/collectionAgent.ts) | `deposit:*` | Lines 4448, 4469 |
| [`deliveryAgent.ts`](apps/api/src/agents/deliveryAgent.ts) | `delivery:*` | Lines 3844, 3859 |
| [`escalationAgent.ts`](apps/api/src/agents/escalationAgent.ts) | `inv_verify:complete:*` | Line 3360 |
| [`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts) | `reminder:*` | Lines 3641, 3717 |

**IMPORTANT**: When adding callback_data in agent files, you MUST also add the corresponding `bot.action()` handler in `bot.ts`. The callback_data format must match exactly between the agent and the handler regex.

### 7. Global Middleware (Always Present)

```typescript
// 1. Auto-answer all callback queries (prevents loading spinner)
bot.use(async (ctx, next) => {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  return next();
});

// 2. Global error handler for callback queries
bot.use(async (ctx, next) => {
  try { return await next(); }
  catch (err: any) { /* reply with error */ }
});

// 3. editMessageText safety patch (swallows "message is not modified")
bot.use(async (ctx, next) => { /* patch ctx.editMessageText */ });
```

### 8. Group Chat Guard

The bot only responds in configured group chats. Add new group IDs to the `ALLOWED_GROUP_IDS` set (line 67):

```typescript
const ALLOWED_GROUP_IDS = new Set<string>([
  process.env.QUOTATION_GROUP_CHAT_ID,
  process.env.PURCHASING_GROUP_CHAT_ID,
  // ... add new group env vars here
]);
```

### 9. Rate Limiting

Built-in rate limiter: max 5 requests per 10 seconds per user (line 91). Adjust `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX_REQUESTS` as needed.

### 10. Vision Extraction Flow

The document/photo handler (line 5161) follows this flow:
1. User sends a document or photo
2. Bot asks: "Is this a Quotation or Deposit Slip?"
3. User clicks: `vision:type_quotation` or `vision:type_deposit`
4. Bot calls Gemini Vision API to extract data
5. Bot shows extracted data and asks: "Process this order?"
6. User clicks: `vision:process_yes` or `vision:process_no`
7. If yes, bot creates the order and shows a dashboard link

## Common Patterns Reference

### Pattern: Simple Yes/No with Quotation Number

```typescript
// In agent file:
callback_data: `my_action:yes:${orderId.slice(0, 8)}:${quotationNumber}`

// In bot.ts handler:
bot.action(/^my_action:(yes|no):([^:]+):(.+)$/, async (ctx) => {
  const answer = ctx.match[1];
  const orderIdPrefix = ctx.match[2];
  const quotationNumber = ctx.match[3];
  // Resolve full UUID...
});
```

### Pattern: Item-Level Status Update

```typescript
// In agent file:
callback_data: `item_prod:finished:${item.id.slice(0, 8)}:${qn}`

// In bot.ts handler:
bot.action(/^item_prod:(finished|in_progress|pending):([^:]+):(.+)$/, async (ctx) => {
  const newStatus = ctx.match[1];
  const itemId = ctx.match[2];
  const quotationNumber = ctx.match[3];
  // Resolve orderId from quotationNumber
  // POST /orders/{orderId}/items/{itemId}
});
```

### Pattern: Multi-Item Process of Elimination

For inventory verification, items are presented one at a time. Each answer removes that item from the pending list:

```typescript
// After user answers for item N, check if more items remain
const remainingItems = orderItems.filter(i => i.id !== itemId && !i.verified_qty);
if (remainingItems.length > 0) {
  // Show next item
  const nextItem = remainingItems[0];
  // ... show buttons for nextItem
} else {
  // All items done — show Complete/Review buttons
}
```

## Validation Checklist

When adding a new callback handler:

- [ ] Calculate callback_data byte length (must be ≤ 64)
- [ ] Use `.slice(0, 8)` for all UUIDs in callback_data
- [ ] Include `quotationNumber` as the last segment for UUID resolution
- [ ] Add `getOrderByQuotation()` call in the handler to resolve full UUID
- [ ] Regex uses `[^:]+` for fixed-length segments, `.+` for last segment
- [ ] Handler regex matches the callback_data format exactly
- [ ] Session type updated in `UserStep` union if adding a new `awaiting_*` state
- [ ] `resetStep()` called after workflow completes
- [ ] Both `bot.ts` and the API project compile with `npx tsc --noEmit`
- [ ] Deploy both containers: `docker compose build --no-cache api telegram-bot && docker compose up -d --force-recreate api telegram-bot`
