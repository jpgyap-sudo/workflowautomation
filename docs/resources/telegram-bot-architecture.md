# Telegram Bot Architecture

> Architecture reference for the Quotation Automation System Telegram bot at [`apps/telegram-bot/src/bot.ts`](apps/telegram-bot/src/bot.ts)

## Overview

The bot is a **single-file TypeScript application** (~5954 lines) using the [Telegraf](https://github.com/telegraf/telegraf) framework. It runs via `tsx` (TypeScript execute) inside a Docker container on the VPS.

**Key characteristics:**
- Single file — all handlers, middleware, and utilities in one place
- In-memory session state (no persistence across restarts)
- Webhook-based (receives updates from Telegram via HTTP)
- Communicates with the API server at `http://api:8080` (Docker internal network)

## File Structure

```
apps/telegram-bot/
├── Dockerfile          # Builds with tsx (no tsc compilation needed)
├── package.json        # Dependencies: telegraf, zod
├── tsconfig.json       # TypeScript config
└── src/
    └── bot.ts          # Single-file application (~5954 lines)
```

## Application Flow

```
Telegram User
    │
    ▼
Telegram API Server
    │  (webhook POST)
    ▼
nginx (reverse proxy, port 443 → 8443)
    │
    ▼
bot.ts HTTP Server (port 8443)
    │  Telegraf processes update
    ▼
Middleware Chain:
    1. answerCbQuery (auto-answer all callback queries)
    2. Global error handler
    3. editMessageText safety patch
    4. Group chat guard + DM admin check
    5. Rate limiting
    │
    ▼
Handler Resolution:
    ├── bot.action(regex, handler)  → Inline keyboard callbacks
    ├── bot.on('text', handler)      → Text messages (with session routing)
    ├── bot.on(['document','photo']) → File uploads + vision extraction
    ├── bot.command('...')           → Slash commands
    └── bot.start()                  → /start command
    │
    ▼
API Server (http://api:8080)
    ├── POST/GET/PATCH /orders/*
    ├── POST /deposits/*
    ├── POST /pay-balance
    ├── POST /vision/*
    └── POST /bot-logs
```

## Middleware Stack (in order)

### 1. Global Callback Answer (line 15)
```typescript
bot.use(async (ctx, next) => {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  return next();
});
```
Prevents Telegram's "loading spinner" on all inline keyboard buttons.

### 2. Global Error Handler (line 24)
Catches unhandled errors in any handler and replies with a generic error message.

### 3. editMessageText Safety Patch (line 47)
Swallows the harmless `"message is not modified"` error that occurs when editing a message to the same content.

### 4. Group Chat Guard + Rate Limiting (line 65)
- Only responds in configured group chat IDs (from environment variables)
- Rate limits: max 5 requests per 10 seconds per user
- Admin-only commands are guarded by `isUserAdmin()` check

## Session Management

In-memory session store using a `Map<chatId, UserSession>`:

```typescript
interface UserSession {
  step: UserStep | null;  // Current workflow step
  lock?: boolean;         // Concurrency lock
  // ... other session data
}

type UserStep =
  | { action: 'awaiting_order_number_for_status'; data?: any }
  | { action: 'awaiting_inv_verify_qty'; data: { itemId: string; orderId: string; quotationNumber: string } }
  | // ... 24+ states
```

**Key functions:**
- `getSession(chatId)` — Get or create session
- `setStep(chatId, step)` — Set current workflow step
- `resetStep(chatId)` — Clear current step

**IMPORTANT**: Sessions are in-memory only. A bot restart clears all sessions. Users will need to restart their workflow.

## Handler Categories

### 1. Menu Navigation (lines 758-888)
The `menu:(action)` handler dispatches to sub-menus. Each sub-menu either:
- Shows an order picker (`pick:action:quotationNumber`)
- Directly performs an action

### 2. Order Picker (lines 899-1100)
Reusable pattern: shows up to 5 recent orders as buttons, with a fallback to type the quotation number manually.

### 3. Callback Handlers (lines 739-4998)
56+ `bot.action()` handlers for inline keyboard buttons. See [`telegram-callback-data.md`](telegram-callback-data.md) for the complete reference.

### 4. Text Input Handlers (lines 1222-2110)
The `message('text')` handler uses a switch on `session.step.action` to route text input to the correct workflow step.

### 5. File/Photo Handlers (lines 5161-5622)
Handles document and photo uploads with:
- Google Drive upload
- Gemini Vision extraction (quotation items, deposit amounts)
- Balance proof photo processing

### 6. Slash Commands (lines 5625-5802)
- `/commands` — List available commands
- `/help` — Show help text
- `/bug` — Report a bug (interactive flow)
- `/unlink` — Unlink Telegram chat from order

## API Communication

The bot communicates with the API server via HTTP:

```typescript
const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:8080';

// Helper functions:
async function getJson(path: string)     // GET request
async function postJson(path: string, body: unknown)  // POST with JSON body
async function patchJson(path: string, body: unknown) // PATCH with JSON body
```

**Docker network**: The bot accesses the API at `http://api:8080` (Docker Compose service name).

## Webhook Setup

The bot runs its own HTTP server (line 5829) that:
1. Listens on port 8443
2. Receives webhook POSTs from Telegram
3. Passes them to Telegraf's `handleUpdate()`
4. Returns 200 OK

**nginx reverse proxy** (on the VPS):
```
https://track.abcx124.xyz/telegram-webhook → http://localhost:8443
```

## Deployment

The bot is deployed as a Docker container:

```bash
# Build and deploy
docker compose build --no-cache telegram-bot
docker compose up -d --force-recreate telegram-bot
```

**Dockerfile** uses `tsx` to run TypeScript directly (avoids OOM from `tsc` on low-memory VPS):
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
CMD ["npx", "tsx", "src/bot.ts"]
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather |
| `API_BASE_URL` | API server URL (default: `http://localhost:8080`) |
| `QUOTATION_GROUP_CHAT_ID` | Stage transition group |
| `PURCHASING_GROUP_CHAT_ID` | Purchasing agent group |
| `INVENTORY_GROUP_CHAT_ID` | Inventory agent group |
| `DELIVERY_GROUP_CHAT_ID` | Delivery agent group |
| `COLLECTION_GROUP_CHAT_ID` | Collection agent group |
| `ESCALATION_GROUP_CHAT_ID` | Escalation agent group |
| `PRODUCTION_GROUP_CHAT_ID` | Production agent group |
| `WEBHOOK_PORT` | Internal webhook port (default: 8443) |
| `WEBHOOK_URL` | Public webhook URL for Telegram API registration |
| `BOT_LOG_CHAT_ID` | Chat ID for bot activity logs |
| `ADMIN_USER_IDS` | Comma-separated Telegram user IDs with admin access |

## Agent-Driven Notifications

Agents (running in the API container) send notifications with inline keyboards by calling the Telegram Bot API directly. The callback_data is defined in the agent files:

1. Agent detects a stage needs attention
2. Agent calls `sendTelegramInlineKeyboard()` with buttons
3. User clicks a button → Telegram sends callback to bot webhook
4. `bot.action()` handler processes the callback
5. Handler calls API endpoints to update order state

**Important**: The callback_data format in agent files MUST match the regex in `bot.ts` handlers exactly. When adding new agent-driven buttons, always add the handler in `bot.ts` first.

## Logging

The bot logs all activity to:
1. **Console** — `console.log` / `console.error` (visible in Docker logs)
2. **Bot logs API** — `POST /bot-logs` with structured log entries
3. **Action logs** — `logAction()` for important user actions

## Known Limitations

1. **In-memory sessions**: Lost on restart. Consider Redis persistence for production.
2. **Single file**: ~5954 lines makes navigation difficult. Consider splitting into modules.
3. **No TypeScript compilation**: Uses `tsx` at runtime, which is slower than compiled JS.
4. **No automated tests**: The bot has no test suite. Manual testing required.
