---
name: chat-widget
description: Build, extend, and maintain the QAS floating AI chat widget (ChatFloatingIcon) and full chat page (/chat). Covers drag implementation, message rendering, conversation management, knowledge base integration, and React Rules of Hooks patterns.
---

# Chat Widget Skill — QAS AI Assistant

## When To Use

Use this skill when working with the QAS AI Assistant chat system. This covers:

- The **floating chat widget** at [`apps/dashboard/src/components/ChatFloatingIcon.tsx`](../../apps/dashboard/src/components/ChatFloatingIcon.tsx) (~800 lines)
- The **full chat page** at [`apps/dashboard/src/app/chat/page.tsx`](../../apps/dashboard/src/app/chat/page.tsx) (~750 lines)
- The **chat API** at [`apps/api/src/server.ts`](../../apps/api/src/server.ts) (lines ~10180-10260)
- The **chat API client** at [`apps/dashboard/src/lib/api.ts`](../../apps/dashboard/src/lib/api.ts) (lines ~1970-2020)
- The **knowledge base** (pgvector + OpenAI embeddings) at [`apps/api/src/services/knowledgeBase.ts`](../../apps/api/src/services/knowledgeBase.ts)

## Architecture Overview

| Layer | File | Purpose |
|-------|------|---------|
| **Floating widget** | [`ChatFloatingIcon.tsx`](../../apps/dashboard/src/components/ChatFloatingIcon.tsx) | Draggable floating bubble, shown on all pages except `/chat` |
| **Full chat page** | [`chat/page.tsx`](../../apps/dashboard/src/app/chat/page.tsx) | Full-page chat experience at `/chat` route |
| **API client** | [`api.ts`](../../apps/dashboard/src/lib/api.ts) | `createChatConversation`, `getUserChatConversations`, `getChatMessages`, `sendChatMessage`, `resetChatConversation` |
| **Server endpoints** | [`server.ts`](../../apps/api/src/server.ts) | `POST /chat/conversations`, `GET /chat/conversations`, `GET /chat/conversations/:id/messages`, `POST /chat/conversations/:id/messages`, `POST /chat/conversations/:id/reset` |
| **Knowledge base** | [`knowledgeBase.ts`](../../apps/api/src/services/knowledgeBase.ts) | pgvector + OpenAI embeddings + RAG for answering questions |
| **Tutorial agent** | [`agents/tutorial-agent/agent.md`](../../agents/tutorial-agent/agent.md) | Agent instructions for answering QAS feature questions |

## Key Patterns

### 1. Drag Implementation (ChatFloatingIcon)

The drag system uses a **stable-ref pattern** to avoid stale closures:

```typescript
// ── Drag state ────────────────────────────────────────────────────────
const [position, setPosition] = useState({ x: 0, y: 0 });
const positionRef = useRef({ x: 0, y: 0 });
const dragRef = useRef({ isDragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });

// Keep positionRef in sync with position state
useEffect(() => {
  positionRef.current = position;
}, [position]);

const onDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
  e.preventDefault();  // CRITICAL: prevent browser default drag behavior
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
  const curPos = positionRef.current;  // Read from ref, not state
  dragRef.current = {
    isDragging: true,
    startX: clientX,
    startY: clientY,
    origX: curPos.x,
    origY: curPos.y,
  };
  document.addEventListener('mousemove', onDragMoveRef.current);
  document.addEventListener('mouseup', onDragEndRef.current);
  document.addEventListener('touchmove', onDragMoveRef.current, { passive: false });
  document.addEventListener('touchend', onDragEndRef.current);
}, []);  // Empty deps — uses refs, not state

const onDragMove = useCallback((e: MouseEvent | TouchEvent) => {
  const d = dragRef.current;
  if (!d.isDragging) return;
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
  setPosition({
    x: d.origX + (clientX - d.startX),
    y: d.origY + (clientY - d.startY),
  });
}, []);

const onDragEnd = useCallback(() => {
  dragRef.current.isDragging = false;
  document.removeEventListener('mousemove', onDragMoveRef.current);
  document.removeEventListener('mouseup', onDragEndRef.current);
  document.removeEventListener('touchmove', onDragMoveRef.current);
  document.removeEventListener('touchend', onDragEndRef.current);
}, []);

// Stable refs so document event listeners always call the latest callbacks
const onDragMoveRef = useRef(onDragMove);
const onDragEndRef = useRef(onDragEnd);
onDragMoveRef.current = onDragMove;
onDragEndRef.current = onDragEnd;

// Cleanup document listeners on unmount (safety net)
useEffect(() => {
  return () => {
    document.removeEventListener('mousemove', onDragMoveRef.current);
    document.removeEventListener('mouseup', onDragEndRef.current);
    document.removeEventListener('touchmove', onDragMoveRef.current);
    document.removeEventListener('touchend', onDragEndRef.current);
  };
}, []);
```

**Critical rules for drag:**
1. Always call `e.preventDefault()` in `onDragStart` — prevents text selection and native image drag
2. Use `useRef` for drag state (`dragRef`) and position (`positionRef`) — never read `position` state inside drag handlers
3. Use `useRef` for callback references (`onDragMoveRef`, `onDragEndRef`) — document event listeners need stable references
4. Update refs synchronously: `onDragMoveRef.current = onDragMove` (not in a `useEffect`)
5. Add cleanup `useEffect` with empty deps to remove document listeners on unmount
6. The widget uses `transform: translate()` on the chat panel only (not the floating button)

### 2. React Rules of Hooks — Early Return Placement

**CRITICAL**: The early return `if (pathname === '/chat') return null;` must be placed **after ALL hooks** (useState, useRef, useEffect, useCallback), just before the JSX `return` statement.

```typescript
export default function ChatFloatingIcon() {
  // 1. ALL hooks first (useState, useRef, useEffect, useCallback)
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  // ... all other hooks ...

  // 2. Early return — AFTER all hooks, BEFORE JSX return
  if (pathname === '/chat') return null;

  // 3. JSX return
  return ( ... );
}
```

**Wrong** (hooks-after-return violation):
```typescript
// ❌ BUG: early return between hooks
if (pathname === '/chat') return null;  // ← placed here
useEffect(() => { ... }, [messages]);    // ← this hook may be skipped!
```

### 3. Message Rendering

Both the widget and full page use the same markdown-like rendering functions:

- [`renderMessageContent`](../../apps/dashboard/src/components/ChatFloatingIcon.tsx:32) — converts markdown-like text to React nodes (bold `**text**`, code `` `code` ``, links `[text](url)`, lists)
- [`renderInline`](../../apps/dashboard/src/components/ChatFloatingIcon.tsx:125) — handles inline formatting within a single line
- [`MessageBubble`](../../apps/dashboard/src/components/ChatFloatingIcon.tsx:167) — renders a single message with role icon, content, sources, and suggestions

### 4. Conversation Management

```typescript
// Create conversation
const conv = await createChatConversation(user.email, user.name);

// List conversations
const convs = await getUserChatConversations(user.email);

// Get messages
const msgs = await getChatMessages(conversationId);

// Send message (returns both user_message and assistant_message)
const result = await sendChatMessage(conversationId, content, userEmail, userName, userRole, pathname);

// Reset/delete conversation
await resetChatConversation(conversationId);
```

### 5. Click-Outside-to-Close

The widget closes when clicking outside (skipped during drag):

```typescript
useEffect(() => {
  if (!isOpen) return;
  function handleClick(e: MouseEvent) {
    if (dragRef.current.isDragging) return;  // Skip during drag
    if (widgetRef.current && !widgetRef.current.contains(e.target as Node)) {
      setIsOpen(false);
    }
  }
  const timer = setTimeout(() => document.addEventListener('click', handleClick), 100);
  return () => {
    clearTimeout(timer);
    document.removeEventListener('click', handleClick);
  };
}, [isOpen]);
```

## Common Tasks

### Adding a New Suggestion Question

Edit the `suggestedQuestions` array in [`WelcomeScreen`](../../apps/dashboard/src/components/ChatFloatingIcon.tsx:368) (floating widget) or the equivalent in [`chat/page.tsx`](../../apps/dashboard/src/app/chat/page.tsx).

### Modifying the Knowledge Base

Edit the tutorial agent at [`agents/tutorial-agent/agent.md`](../../agents/tutorial-agent/agent.md) and re-ingest via the knowledge base pipeline at [`knowledgeBase.ts`](../../apps/api/src/services/knowledgeBase.ts).

### Adding a New Chat API Endpoint

1. Add the route in [`server.ts`](../../apps/api/src/server.ts) (search for `/chat/` endpoints)
2. Add the client function in [`api.ts`](../../apps/dashboard/src/lib/api.ts)
3. Wire into the widget or page component

## Validation

After changes to the chat widget:

1. **TypeScript**: `cd apps/dashboard && npx tsc --noEmit` — must pass with zero errors
2. **Drag test**: Open any page (not `/chat`), drag the chat widget by its header, verify smooth movement and no text selection
3. **Click-outside**: Open chat, click outside the panel, verify it closes
4. **Chat page guard**: Navigate to `/chat`, verify the floating widget does NOT appear
5. **Send message**: Type a message, verify optimistic rendering + response
6. **Conversation management**: Create new conversation, switch conversations, delete conversation
