'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
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
  ExternalLink,
  Sparkles,
  BookOpen,
  RefreshCw,
} from 'lucide-react';

// ── Markdown-like rendering ────────────────────────────────────────────

function renderMessageContent(content: string): React.ReactNode[] {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let inList = false;
  let listItems: React.ReactNode[] = [];
  let listIndex = 0;

  function flushList() {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`list-${listIndex++}`} className="mb-3 space-y-1">
          {listItems}
        </ul>
      );
      listItems = [];
      inList = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Headers
    if (line.startsWith('### ')) {
      flushList();
      elements.push(
        <h3 key={`h3-${i}`} className="mb-2 mt-3 text-sm font-semibold text-gray-800">
          {line.slice(4)}
        </h3>
      );
      continue;
    }
    if (line.startsWith('## ')) {
      flushList();
      elements.push(
        <h2 key={`h2-${i}`} className="mb-2 mt-4 text-base font-bold text-gray-900">
          {line.slice(3)}
        </h2>
      );
      continue;
    }
    if (line.startsWith('# ')) {
      flushList();
      elements.push(
        <h1 key={`h1-${i}`} className="mb-2 mt-4 text-lg font-bold text-gray-900">
          {line.slice(2)}
        </h1>
      );
      continue;
    }

    // Horizontal rule
    if (line.startsWith('---') || line.startsWith('***')) {
      flushList();
      elements.push(<hr key={`hr-${i}`} className="my-3 border-gray-200" />);
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      flushList();
      elements.push(
        <blockquote key={`bq-${i}`} className="mb-2 border-l-4 border-[#2490ef] bg-blue-50 py-2 pl-3 pr-2 text-sm text-gray-700 italic">
          {renderInline(line.slice(2))}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (line.startsWith('- ') || line.startsWith('* ')) {
      inList = true;
      listItems.push(
        <li key={`li-${i}`} className="flex items-start gap-2 text-sm text-gray-700">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2490ef]" />
          <span>{renderInline(line.slice(2))}</span>
        </li>
      );
      continue;
    }

    // Ordered list
    const orderedMatch = line.match(/^\d+\.\s+(.*)/);
    if (orderedMatch) {
      flushList();
      elements.push(
        <div key={`ol-${i}`} className="mb-2 flex items-start gap-2 text-sm text-gray-700">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2490ef] text-xs font-medium text-white">
            {orderedMatch[1].charAt(0)}
          </span>
          <span>{renderInline(orderedMatch[1])}</span>
        </div>
      );
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      flushList();
      continue;
    }

    // Regular paragraph
    flushList();
    elements.push(
      <p key={`p-${i}`} className="mb-2 text-sm leading-relaxed text-gray-700">
        {renderInline(line)}
      </p>
    );
  }

  flushList();
  return elements;
}

function renderInline(text: string): React.ReactNode {
  // Bold: **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>;
    }
    // Inline code: `code`
    const codeParts = part.split(/(`[^`]+`)/g);
    return codeParts.map((cp, j) => {
      if (cp.startsWith('`') && cp.endsWith('`')) {
        return (
          <code key={`${i}-${j}`} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-[#2490ef]">
            {cp.slice(1, -1)}
          </code>
        );
      }
      // Links: [text](url)
      const linkParts = cp.split(/(\[[^\]]+\]\([^)]+\))/g);
      return linkParts.map((lp, k) => {
        const linkMatch = lp.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          return (
            <a
              key={`${i}-${j}-${k}`}
              href={linkMatch[2]}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 font-medium text-[#2490ef] hover:underline"
            >
              {linkMatch[1]}
              <ExternalLink className="h-3 w-3" />
            </a>
          );
        }
        return lp;
      });
    });
  });
}

// ── Chat Message Bubble ────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? 'bg-[#2490ef] text-white'
            : isAssistant
            ? 'bg-gradient-to-br from-[#2490ef] to-[#6366f1] text-white'
            : 'bg-gray-200 text-gray-500'
        }`}
      >
        {isUser ? (
          <User className="h-4 w-4" />
        ) : (
          <Bot className="h-4 w-4" />
        )}
      </div>

      {/* Content */}
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div
          className={`rounded-2xl px-4 py-3 ${
            isUser
              ? 'bg-[#2490ef] text-white rounded-tr-md'
              : isAssistant
              ? 'bg-white border border-gray-200 rounded-tl-md shadow-sm'
              : 'bg-gray-100 text-gray-600 rounded-tl-md'
          }`}
        >
          {isUser ? (
            <p className="text-sm leading-relaxed">{message.content}</p>
          ) : (
            <div className="prose prose-sm max-w-none">
              {renderMessageContent(message.content)}
            </div>
          )}
        </div>

        {/* Sources */}
        {isAssistant && message.sources && message.sources.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5 px-1">
            {message.sources.map((source, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600"
              >
                <BookOpen className="h-2.5 w-2.5" />
                {source.title}
              </span>
            ))}
          </div>
        )}

        {/* Suggestions */}
        {isAssistant && message.suggestions && message.suggestions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 px-1">
            {message.suggestions.map((suggestion, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 bg-gray-50 px-2.5 py-1 text-[11px] text-gray-500"
              >
                <Sparkles className="h-2.5 w-2.5" />
                {suggestion}
              </span>
            ))}
          </div>
        )}

        <span className={`mt-1 px-1 text-[10px] text-gray-400 ${isUser ? 'text-right' : ''}`}>
          {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
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
  onSend: (message: string) => void;
  disabled: boolean;
  placeholder?: string;
}) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput('');
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
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? 'Ask me how to use the platform...'}
        rows={1}
        disabled={disabled}
        className="max-h-[120px] min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2 text-sm text-gray-700 outline-none placeholder:text-gray-400 disabled:opacity-50"
      />
      <button
        onClick={handleSubmit}
        disabled={disabled || !input.trim()}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#2490ef] text-white transition-all hover:bg-[#1a7ad9] disabled:opacity-40 disabled:hover:bg-[#2490ef]"
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

// ── Conversation Sidebar ───────────────────────────────────────────────

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
      <div className="flex items-center justify-between border-b border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-800">Conversations</h2>
        <button
          onClick={onNew}
          className="flex items-center gap-1.5 rounded-lg bg-[#2490ef] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1a7ad9] transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <MessageSquare className="mb-2 h-8 w-8 text-gray-300" />
            <p className="text-xs text-gray-400">No conversations yet</p>
            <p className="mt-1 text-[10px] text-gray-300">Start a new chat to get help</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {conversations.map((conv) => (
              <li key={conv.id}>
                <button
                  onClick={() => onSelect(conv.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                    activeId === conv.id
                      ? 'bg-[#e8f4fd] text-[#2490ef] font-medium'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <MessageSquare className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{conv.title}</span>
                  <span className="text-[10px] text-gray-400">{conv.message_count}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(conv.id);
                    }}
                    className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </button>
              </li>
            ))}
          </ul>
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
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2490ef] to-[#6366f1] shadow-lg">
        <Bot className="h-8 w-8 text-white" />
      </div>
      <h1 className="mb-2 text-xl font-bold text-gray-900">QAS Tutorial Assistant</h1>
      <p className="mb-8 max-w-md text-sm text-gray-500">
        Ask me anything about using the Quotation Automation System. I can guide you through
        every feature step by step.
      </p>

      <div className="grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestedQuestions.map((q, i) => (
          <button
            key={i}
            onClick={() => onSuggestedQuestion(q)}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left text-sm text-gray-600 transition-all hover:border-[#2490ef] hover:bg-blue-50 hover:text-[#2490ef]"
          >
            <Sparkles className="h-4 w-4 shrink-0 text-[#2490ef]" />
            <span>{q}</span>
          </button>
        ))}
      </div>

      <div className="mt-8 flex items-center gap-4 text-[11px] text-gray-400">
        <span>Powered by AI</span>
        <span className="h-1 w-1 rounded-full bg-gray-300" />
        <span>Knowledge base updated</span>
      </div>
    </div>
  );
}

// ── Main Chat Page ─────────────────────────────────────────────────────

export default function ChatPage() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

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

  // Create new conversation
  const handleNewConversation = useCallback(async () => {
    if (!user?.email) return;
    try {
      const conv = await createChatConversation(user.email, user.name);
      setConversations((prev) => [conv, ...prev]);
      setActiveConversationId(conv.id);
      setMessages([]);
      setShowSidebar(false);
    } catch (err) {
      console.error('[chat] Failed to create conversation:', err);
    }
  }, [user?.email, user?.name]);

  // Send message
  const handleSend = useCallback(
    async (content: string) => {
      if (!user?.email) return;

      // Auto-create conversation if none active
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
        // Add optimistic user message
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
          window.location.pathname
        );

        // Replace optimistic message with real one and add assistant response
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== optimisticMsg.id),
          result.user_message,
          result.assistant_message,
        ]);

        // Update conversation list
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
    [user, activeConversationId]
  );

  // Handle suggested question click
  const handleSuggestedQuestion = useCallback(
    (question: string) => {
      handleSend(question);
    },
    [handleSend]
  );

  // Reset conversation
  const handleReset = useCallback(async () => {
    if (!activeConversationId) return;
    try {
      await resetChatConversation(activeConversationId);
      setMessages([]);
    } catch (err) {
      console.error('[chat] Failed to reset conversation:', err);
    }
  }, [activeConversationId]);

  // Select conversation
  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
    setShowSidebar(false);
  }, []);

  // Delete conversation
  const handleDeleteConversation = useCallback(
    async (id: string) => {
      try {
        // Reset the conversation (soft delete)
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
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
      {/* Conversation Sidebar */}
      <div
        className={`${
          showSidebar ? 'flex' : 'hidden'
        } w-72 shrink-0 flex-col border-r border-gray-200 bg-white lg:flex`}
      >
        <ConversationList
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={handleSelectConversation}
          onNew={handleNewConversation}
          onDelete={handleDeleteConversation}
          loading={loadingConversations}
        />
      </div>

      {/* Main Chat Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Chat Header */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 lg:hidden"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div>
              <h2 className="text-sm font-semibold text-gray-800">
                {activeConversation?.title ?? 'Tutorial Assistant'}
              </h2>
              <p className="text-[11px] text-gray-400">
                {activeConversation
                  ? `${activeConversation.message_count} messages`
                  : 'Ask me anything about the platform'}
              </p>
            </div>
          </div>
          {activeConversationId && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
              title="Clear conversation"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4">
          {!activeConversationId ? (
            <WelcomeScreen onSuggestedQuestion={handleSuggestedQuestion} />
          ) : loadingMessages ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Bot className="mb-3 h-10 w-10 text-gray-300" />
              <p className="text-sm text-gray-500">Start the conversation by asking a question below.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              {sending && (
                <div className="flex items-center gap-2 pl-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#2490ef] to-[#6366f1]">
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                  <div className="flex items-center gap-1 rounded-2xl bg-white px-4 py-3 shadow-sm">
                    <div className="flex gap-1">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-[#2490ef]" style={{ animationDelay: '0ms' }} />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-[#2490ef]" style={{ animationDelay: '150ms' }} />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-[#2490ef]" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-gray-200 bg-white p-4">
          <ChatInput
            onSend={handleSend}
            disabled={sending}
            placeholder={
              activeConversationId
                ? 'Ask a follow-up question...'
                : 'Ask me how to use the platform...'
            }
          />
          <p className="mt-2 text-center text-[10px] text-gray-400">
            The assistant uses AI and may not be perfect. Always verify critical information.
          </p>
        </div>
      </div>
    </div>
  );
}
