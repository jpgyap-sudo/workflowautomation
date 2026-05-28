# Chat Widget — Architecture & Reference

> Reference document for the QAS AI Assistant chat system.
> Covers the floating widget, full chat page, API, knowledge base, and data flow.

## System Overview

```
User clicks bubble → ChatFloatingIcon opens panel
  → User types message
    → sendChatMessage(conversationId, content, userEmail, userName, userRole, pathname)
      → POST /chat/conversations/:id/messages
        → chatService.ts processes:
          1. Save user message to DB
          2. Query knowledge base (pgvector + OpenAI embeddings)
          3. Call LLM (Gemini → OpenRouter fallback → KB fallback)
          4. Save assistant response to DB
          5. Return { user_message, assistant_message, conversation }
    → Widget renders both messages (optimistic user message first, then full response)
```

## File Inventory

| File | Lines | Purpose |
|------|-------|---------|
| [`apps/dashboard/src/components/ChatFloatingIcon.tsx`](../../apps/dashboard/src/components/ChatFloatingIcon.tsx) | ~800 | Floating chat widget (draggable bubble) |
| [`apps/dashboard/src/app/chat/page.tsx`](../../apps/dashboard/src/app/chat/page.tsx) | ~750 | Full-page chat at `/chat` route |
| [`apps/dashboard/src/lib/api.ts`](../../apps/dashboard/src/lib/api.ts) | ~2060 | API client (chat functions at lines ~1970-2020) |
| [`apps/api/src/server.ts`](../../apps/api/src/server.ts) | ~12784 | Server routes (chat endpoints at lines ~10180-10260) |
| [`apps/api/src/services/chatService.ts`](../../apps/api/src/services/chatService.ts) | — | Chat processing logic |
| [`apps/api/src/services/knowledgeBase.ts`](../../apps/api/src/services/knowledgeBase.ts) | — | pgvector + OpenAI embeddings + RAG |
| [`apps/api/src/services/hermesClaw.ts`](../../apps/api/src/services/hermesClaw.ts) | — | Hermes Claw integration for context |
| [`agents/tutorial-agent/agent.md`](../../agents/tutorial-agent/agent.md) | — | Agent instructions for answering QAS questions |
| [`database/migrations/041_knowledge_base.sql`](../../database/migrations/041_knowledge_base.sql) | — | Knowledge base schema (pgvector) |
| [`database/migrations/042_knowledge_base_3072d.sql`](../../database/migrations/042_knowledge_base_3072d.sql) | — | 3072-dimension vector support |

## API Endpoints

### `POST /chat/conversations`

Create a new chat conversation.

**Request:**
```json
{
  "user_email": "user@example.com",
  "user_name": "User Name"
}
```

**Response:**
```json
{
  "id": "uuid",
  "user_email": "user@example.com",
  "user_name": "User Name",
  "message_count": 0,
  "created_at": "ISO timestamp",
  "updated_at": "ISO timestamp"
}
```

### `GET /chat/conversations?email=user@example.com`

List conversations for a user, ordered by most recent first.

### `GET /chat/conversations/:id/messages`

Get all messages in a conversation, ordered by creation time.

### `POST /chat/conversations/:id/messages`

Send a message and get AI response.

**Request:**
```json
{
  "content": "How do I create a new order?",
  "user_email": "user@example.com",
  "user_name": "User Name",
  "user_role": "admin",
  "pathname": "/production"
}
```

**Response:**
```json
{
  "user_message": { "id": "uuid", "role": "user", "content": "...", ... },
  "assistant_message": { "id": "uuid", "role": "assistant", "content": "...", "sources": [...], ... },
  "conversation": { "id": "uuid", "message_count": 3, "updated_at": "..." }
}
```

### `POST /chat/conversations/:id/reset`

Delete a conversation and all its messages.

## Data Flow

### Message Processing Pipeline

1. **User sends message** → `POST /chat/conversations/:id/messages`
2. **Save user message** → Insert into `chat_messages` table
3. **Query knowledge base** → Vector similarity search on `knowledge_base` table (pgvector, OpenAI `text-embedding-005`)
4. **Build context** → Combine KB results + conversation history + user role/pathname
5. **Call LLM** → Primary: Gemini API → Fallback: OpenRouter → Fallback: return KB results directly
6. **Save assistant response** → Insert into `chat_messages` table
7. **Return both messages** → Widget renders user message optimistically, then replaces with full response

### Knowledge Base Ingestion

The knowledge base is populated from the tutorial agent at [`agents/tutorial-agent/agent.md`](../../agents/tutorial-agent/agent.md). Each section is chunked, embedded with `text-embedding-005`, and stored in the `knowledge_base` table with a 3072-dimension pgvector index.

## Component Architecture

### ChatFloatingIcon (Floating Widget)

```
┌─────────────────────────────────────┐
│ ChatFloatingIcon (fixed bottom-6 right-6) │
│  ├── Floating button (MessageSquare icon) │
│  └── Chat panel (when isOpen)            │
│       ├── Header (drag handle)           │
│       │   ├── Title + Bot icon           │
│       │   ├── Reset button               │
│       │   └── Close button               │
│       ├── ConversationList (sidebar)     │
│       │   ├── New Conversation button    │
│       │   └── Conversation items         │
│       ├── Message area                   │
│       │   ├── WelcomeScreen (no conv)    │
│       │   ├── Loading spinner            │
│       │   └── MessageBubble[]            │
│       └── ChatInput                     │
│           └── Textarea + Send button     │
└─────────────────────────────────────┘
```

### Chat Page (`/chat`)

Same structure as the floating widget but:
- Full-page layout (not floating)
- No drag functionality
- No click-outside-to-close
- Always visible (no toggle button)
- Wider message area

## Key States

| State | Variable | Location |
|-------|----------|----------|
| Panel open/closed | `isOpen` | `ChatFloatingIcon` |
| Active conversation | `activeConversationId` | Both |
| Messages array | `messages` | Both |
| Sending in progress | `sending` | Both |
| Loading conversations | `loadingConversations` | Both |
| Loading messages | `loadingMessages` | Both |
| Drag position | `position` | `ChatFloatingIcon` only |
| Drag in progress | `dragRef.current.isDragging` | `ChatFloatingIcon` only |

## Drag Implementation Details

See the [chat-widget skill](../.roo/skills/chat-widget/SKILL.md) for the complete drag pattern.

Key points:
- Uses `transform: translate()` on the chat panel only (not the floating button)
- `positionRef` syncs with `position` state via `useEffect`
- `onDragMoveRef` / `onDragEndRef` are stable refs updated synchronously
- Cleanup `useEffect` removes document listeners on unmount
- Click-outside handler skips during drag via `dragRef.current.isDragging` check

## Common Issues & Fixes

### Issue: Chat widget doesn't appear on any page
- Check if `pathname === '/chat'` — widget is intentionally hidden on the full chat page
- Verify the early return is placed AFTER all hooks (React Rules of Hooks)

### Issue: Drag doesn't work or feels janky
- Verify `e.preventDefault()` is called in `onDragStart`
- Check that `positionRef.current` is read (not `position` state) inside drag handlers
- Verify document event listeners use stable refs (`.current`), not the callback directly

### Issue: Click-outside closes during drag
- Check that `dragRef.current.isDragging` is checked in the click handler
- Verify `isDragging` is set to `true` in `onDragStart` and `false` in `onDragEnd`

### Issue: Messages not rendering
- Check the `renderMessageContent` function for unclosed markdown syntax
- Verify the API response format matches `ChatMessage` interface

## Related Resources

- [Telegram Bot Architecture](./telegram-bot-architecture.md) — Telegram-side chat integration
- [Architecture Overview](../architecture.md) — System-wide architecture
- [Tutorial Agent](../../agents/tutorial-agent/agent.md) — Knowledge base source content
