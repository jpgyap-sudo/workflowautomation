'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import {
  createChatConversation,
  getUserChatConversations,
  getChatMessages,
  sendChatMessage,
  resetChatConversation,
  type ChatConversation,
  type ChatMessage,
} from '@/lib/api';
import {
  MessageSquare,
  Send,
  Plus,
  Trash2,
  Bot,
  User,
  Loader2,
  ChevronLeft,
  Sparkles,
  RefreshCw,
  X,
  ExternalLink,
} from 'lucide-react';

// ── Markdown-like rendering ────────────────────────────────────────────

function renderMessageContent(content: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const lines = content.split('\n');
  let inList = false;
  let listItems: React.ReactNode[] = [];

  function flushList() {
    if (listItems.length > 0) {
      nodes.push(
        <ul key={`ul-${nodes.length}`} className="my-2 list-disc space-y-1 pl-5">
          {listItems}
        </ul>
      );
      listItems = [];
    }
    inList = false;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code block
    if (trimmed.startsWith('```')) {
      flushList();
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      nodes.push(
        <pre key={`code-${i}`} className="my-2 overflow-x-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Bullet list
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      inList = true;
      listItems.push(
        <li key={`li-${i}`} className="text-sm text-gray-700">
          {renderInline(trimmed.slice(2))}
        </li>
      );
      continue;
    }

    // Numbered list
    if (/^\d+[.)]\s/.test(trimmed)) {
      flushList();
      const match = trimmed.match(/^\d+[.)]\s(.*)/);
      nodes.push(
        <ol key={`ol-${i}`} className="my-2 list-decimal space-y-1 pl-5">
          <li className="text-sm text-gray-700">{renderInline(match ? match[1] : trimmed)}</li>
        </ol>
      );
      continue;
    }

    flushList();

    // Empty line
    if (!trimmed) {
      nodes.push(<div key={`empty-${i}`} className="h-2" />);
      continue;
    }

    // Bold heading
    if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      nodes.push(
        <p key={`p-${i}`} className="text-sm font-semibold text-gray-800">
          {renderInline(trimmed.slice(2, -2))}
        </p>
      );
      continue;
    }

    // Regular paragraph
    nodes.push(
      <p key={`p-${i}`} className="text-sm text-gray-700">
        {renderInline(trimmed)}
      </p>
    );
  }
  flushList();

  return nodes;
}

function renderInline(text: string): React.ReactNode {
  // Bold
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    // Inline code
    const codeParts = part.split(/(`[^`]+`)/g);
    return codeParts.map((cp, j) => {
      if (cp.startsWith('`') && cp.endsWith('`')) {
        return (
          <code key={`${i}-${j}`} className="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono text-pink-600">
            {cp.slice(1, -1)}
          </code>
        );
      }
      // Links
      const linkParts = cp.split(/(\[[^\]]+\]\([^)]+\))/g);
      return linkParts.map((lp, k) => {
        const linkMatch = lp.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (linkMatch) {
          return (
            <a
              key={`${i}-${j}-${k}`}
              href={linkMatch[2]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#2490ef] hover:underline"
            >
              {linkMatch[1]}
            </a>
          );
        }
        return <span key={`${i}-${j}-${k}`}>{lp}</span>;
      });
    });
  });
}

// ── Message Bubble ─────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? 'bg-gray-200'
            : 'bg-gradient-to-br from-[#2490ef] to-[#6366f1]'
        }`}
      >
        {isUser ? (
          <User className="h-4 w-4 text-gray-600" />
        ) : (
          <Bot className="h-4 w-4 text-white" />
        )}
      </div>
      <div className={`max-w-[85%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div
          className={`rounded-2xl px-4 py-2.5 ${
            isUser
              ? 'bg-[#2490ef] text-white'
              : 'bg-white shadow-sm border border-gray-100'
          }`}
        >
          {isUser ? (
            <p className="text-sm">{message.content}</p>
          ) : (
            <div className="space-y-1">{renderMessageContent(message.content)}</div>
          )}
        </div>

        {/* Sources */}
        {message.sources && message.sources.length > 0 && !isUser && (
          <div className="mt-1.5 flex flex-wrap gap-1.5 px-1">
            {message.sources.map((source, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-600"
              >
                <ExternalLink className="h-2.5 w-2.5" />
                {source.title}
              </span>
            ))}
          </div>
        )}

        {/* Suggestions */}
        {message.suggestions && message.suggestions.length > 0 && !isUser && (
          <div className="mt-2 flex flex-wrap gap-1.5 px-1">
            {message.suggestions.map((suggestion, i) => (
              <span
                key={i}
                className="cursor-pointer rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] text-gray-500 transition-colors hover:border-[#2490ef] hover:text-[#2490ef]"
              >
                {suggestion}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Chat Input ─────────────────────────────────────────────────────────

function ChatInput({
  onSend,
  disabled,
  placeholder,
}: {
  onSend: (content: string) => void;
  disabled: boolean;
  placeholder: string;
}) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [text]);

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex items-end gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-sm transition-shadow focus-within:border-[#2490ef] focus-within:shadow-md">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        disabled={disabled}
        className="max-h-[120px] min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-gray-700 outline-none placeholder:text-gray-400 disabled:opacity-50"
      />
      <button
        onClick={handleSubmit}
        disabled={!text.trim() || disabled}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#2490ef] text-white transition-all hover:bg-[#1a7ad9] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {disabled ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

// ── Conversation List ──────────────────────────────────────────────────

function ConversationList({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  loading,
}: {
  conversations: ChatConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  loading: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2.5">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Conversations</span>
        <button
          onClick={onNew}
          className="flex items-center gap-1 rounded-lg bg-[#2490ef] px-2.5 py-1.5 text-xs text-white transition-colors hover:bg-[#1a7ad9]"
        >
          <Plus className="h-3 w-3" />
          New
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <MessageSquare className="mx-auto mb-2 h-8 w-8 text-gray-200" />
            <p className="text-xs text-gray-400">No conversations yet</p>
          </div>
        ) : (
          <div className="space-y-0.5 p-1.5">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                  conv.id === activeId
                    ? 'bg-blue-50 text-[#2490ef]'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
                onClick={() => onSelect(conv.id)}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 truncate text-xs">{conv.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(conv.id);
                  }}
                  className="shrink-0 rounded p-0.5 text-gray-300 opacity-0 transition-all hover:text-red-500 group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Welcome Screen ─────────────────────────────────────────────────────

function WelcomeScreen({ onSuggestedQuestion }: { onSuggestedQuestion: (q: string) => void }) {
  const suggestedQuestions = [
    'How do I create a new order?',
    'How does the production workflow work?',
    'How do I record a payment?',
    'What are the different order stages?',
    'How does inventory verification work?',
    'How do I use the Telegram bot?',
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2490ef] to-[#6366f1] shadow-lg">
        <Bot className="h-6 w-6 text-white" />
      </div>
      <h2 className="mb-1 text-base font-bold text-gray-900">QAS Tutorial Assistant</h2>
      <p className="mb-6 max-w-sm text-xs text-gray-500">
        Ask me anything about using the Quotation Automation System.
      </p>

      <div className="grid w-full max-w-sm grid-cols-1 gap-1.5">
        {suggestedQuestions.map((q, i) => (
          <button
            key={i}
            onClick={() => onSuggestedQuestion(q)}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left text-xs text-gray-600 transition-all hover:border-[#2490ef] hover:bg-blue-50 hover:text-[#2490ef]"
          >
            <Sparkles className="h-3 w-3 shrink-0 text-[#2490ef]" />
            <span>{q}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main Floating Chat Widget ──────────────────────────────────────────

export default function ChatFloatingIcon() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const widgetRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  // ── Drag state ────────────────────────────────────────────────────────
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const dragRef = useRef({ isDragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  function onDragStart(e: React.MouseEvent | React.TouchEvent) {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragRef.current = {
      isDragging: true,
      startX: clientX,
      startY: clientY,
      origX: position.x,
      origY: position.y,
    };
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);
  }

  function onDragMove(e: MouseEvent | TouchEvent) {
    const d = dragRef.current;
    if (!d.isDragging) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setPosition({
      x: d.origX + (clientX - d.startX),
      y: d.origY + (clientY - d.startY),
    });
  }

  function onDragEnd() {
    dragRef.current.isDragging = false;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('touchend', onDragEnd);
  }

  // Don't render on chat page itself
  if (pathname === '/chat') return null;

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load conversations on mount
  useEffect(() => {
    if (!user?.email || initializedRef.current) return;
    initializedRef.current = true;

    async function load() {
      if (!user?.email) return;
      setLoadingConversations(true);
      try {
        const convs = await getUserChatConversations(user.email);
        setConversations(convs);
      } catch (err) {
        console.error('[chat] Failed to load conversations:', err);
      } finally {
        setLoadingConversations(false);
      }
    }
    load();
  }, [user?.email]);

  // Load messages when conversation changes
  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      return;
    }

    async function load() {
      if (!activeConversationId) return;
      setLoadingMessages(true);
      try {
        const msgs = await getChatMessages(activeConversationId);
        setMessages(msgs);
      } catch (err) {
        console.error('[chat] Failed to load messages:', err);
      } finally {
        setLoadingMessages(false);
      }
    }
    load();
  }, [activeConversationId]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (widgetRef.current && !widgetRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    // Delay to avoid immediate close from the toggle click
    const timer = setTimeout(() => document.addEventListener('click', handleClick), 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClick);
    };
  }, [isOpen]);

  // Create new conversation
  const handleNewConversation = useCallback(async () => {
    if (!user?.email) return;
    try {
      const conv = await createChatConversation(user.email, user.name);
      setConversations((prev) => [conv, ...prev]);
      setActiveConversationId(conv.id);
      setMessages([]);
    } catch (err) {
      console.error('[chat] Failed to create conversation:', err);
    }
  }, [user?.email, user?.name]);

  // Send message
  const handleSend = useCallback(
    async (content: string) => {
      if (!user?.email) return;

      let convId = activeConversationId;
      if (!convId) {
        try {
          const conv = await createChatConversation(user.email, user.name);
          setConversations((prev) => [conv, ...prev]);
          convId = conv.id;
          setActiveConversationId(conv.id);
        } catch (err) {
          console.error('[chat] Failed to create conversation:', err);
          return;
        }
      }

      setSending(true);
      try {
        const optimisticMsg: ChatMessage = {
          id: `temp-${Date.now()}`,
          conversation_id: convId,
          role: 'user',
          content,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, optimisticMsg]);

        const result = await sendChatMessage(
          convId,
          content,
          user.email,
          user.name,
          user.role,
          pathname
        );

        setMessages((prev) => [
          ...prev.filter((m) => m.id !== optimisticMsg.id),
          result.user_message,
          result.assistant_message,
        ]);

        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? { ...c, message_count: result.conversation.message_count, updated_at: result.conversation.updated_at }
              : c
          )
        );
      } catch (err) {
        console.error('[chat] Failed to send message:', err);
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            conversation_id: convId!,
            role: 'assistant',
            content: 'Sorry, I encountered an error. Please try again.',
            created_at: new Date().toISOString(),
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [user, activeConversationId, pathname]
  );

  const handleSuggestedQuestion = useCallback(
    (question: string) => {
      handleSend(question);
    },
    [handleSend]
  );

  const handleReset = useCallback(async () => {
    if (!activeConversationId) return;
    try {
      await resetChatConversation(activeConversationId);
      setMessages([]);
    } catch (err) {
      console.error('[chat] Failed to reset conversation:', err);
    }
  }, [activeConversationId]);

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
  }, []);

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      try {
        await resetChatConversation(id);
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (activeConversationId === id) {
          setActiveConversationId(null);
          setMessages([]);
        }
      } catch (err) {
        console.error('[chat] Failed to delete conversation:', err);
      }
    },
    [activeConversationId]
  );

  const activeConversation = conversations.find((c) => c.id === activeConversationId);

  return (
    <div
      ref={widgetRef}
      className="fixed bottom-6 right-6 z-50"
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
        transition: dragRef.current.isDragging ? 'none' : 'transform 0.15s ease-out',
      }}
    >
      {/* Chat Widget Panel */}
      {isOpen && (
        <div className="absolute bottom-16 right-0 mb-2 flex h-[520px] w-[380px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
          {/* Header — drag handle */}
          <div
            ref={headerRef}
            onMouseDown={onDragStart}
            onTouchStart={onDragStart}
            className="flex cursor-grab items-center justify-between border-b border-gray-200 bg-gradient-to-r from-[#2490ef] to-[#6366f1] px-4 py-3 active:cursor-grabbing select-none"
          >
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-white" />
              <div>
                <h3 className="text-sm font-semibold text-white">QAS Assistant</h3>
                <p className="text-[10px] text-white/70">Ask me anything</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {activeConversationId && (
                <button
                  onClick={handleReset}
                  className="rounded-lg p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  title="Clear conversation"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex flex-1 overflow-hidden">
            {/* Conversation Sidebar */}
            <div className="w-36 shrink-0 border-r border-gray-100 bg-gray-50">
              <ConversationList
                conversations={conversations}
                activeId={activeConversationId}
                onSelect={handleSelectConversation}
                onNew={handleNewConversation}
                onDelete={handleDeleteConversation}
                loading={loadingConversations}
              />
            </div>

            {/* Chat Area */}
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-3">
                {!activeConversationId ? (
                  <WelcomeScreen onSuggestedQuestion={handleSuggestedQuestion} />
                ) : loadingMessages ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Bot className="mb-2 h-8 w-8 text-gray-200" />
                    <p className="text-xs text-gray-400">Start the conversation below.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map((msg) => (
                      <MessageBubble key={msg.id} message={msg} />
                    ))}
                    {sending && (
                      <div className="flex items-center gap-2 pl-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[#2490ef] to-[#6366f1]">
                          <Bot className="h-3 w-3 text-white" />
                        </div>
                        <div className="flex items-center gap-1 rounded-2xl bg-white px-3 py-2 shadow-sm">
                          <div className="flex gap-1">
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#2490ef]" style={{ animationDelay: '0ms' }} />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#2490ef]" style={{ animationDelay: '150ms' }} />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#2490ef]" style={{ animationDelay: '300ms' }} />
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="border-t border-gray-100 bg-white p-2">
                <ChatInput
                  onSend={handleSend}
                  disabled={sending}
                  placeholder="Ask a question..."
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#2490ef] to-[#6366f1] text-white shadow-lg transition-all hover:shadow-xl hover:scale-105 active:scale-95"
      >
        {isOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <MessageSquare className="h-6 w-6" />
        )}
      </button>
    </div>
  );
}
