-- Migration 041: Knowledge Base & Chat System
-- Creates tables for the tutorial agent's knowledge base (pgvector),
-- chat conversations, and update logs access.

-- ── Enable pgvector extension (if not already enabled) ─────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Knowledge Documents ────────────────────────────────────────────────────
-- Stores raw knowledge base documents that get embedded for semantic search.
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  source        TEXT NOT NULL,            -- e.g. 'changelog', 'guide', 'agent-md', 'architecture'
  source_url    TEXT,                     -- e.g. '/guides#orders', '/docs/CHANGELOG.md'
  doc_type      TEXT NOT NULL DEFAULT 'markdown',  -- 'markdown', 'code', 'config'
  tags          TEXT[] DEFAULT '{}',
  checksum      TEXT,                     -- MD5 hash of content for dedup
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_source ON knowledge_documents(source);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_doc_type ON knowledge_documents(doc_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_documents_checksum ON knowledge_documents(checksum) WHERE checksum IS NOT NULL;

-- ── Knowledge Embeddings ───────────────────────────────────────────────────
-- Stores vector embeddings for semantic search (pgvector).
CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_index   INT NOT NULL DEFAULT 0,   -- Which chunk of the document this is
  chunk_text    TEXT NOT NULL,             -- The text chunk that was embedded
  embedding     VECTOR(768),              -- Gemini text-embedding-004 (768d)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_document_id ON knowledge_embeddings(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_embedding ON knowledge_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ── Chat Conversations ─────────────────────────────────────────────────────
-- Tracks conversation sessions per user.
CREATE TABLE IF NOT EXISTS chat_conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email    TEXT NOT NULL,
  user_name     TEXT,
  title         TEXT DEFAULT 'New Conversation',
  message_count INT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_email ON chat_conversations(user_email);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_active ON chat_conversations(is_active) WHERE is_active = true;

-- ── Chat Messages ──────────────────────────────────────────────────────────
-- Stores individual messages within conversations.
CREATE TABLE IF NOT EXISTS chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         TEXT NOT NULL,
  sources         JSONB DEFAULT '[]',     -- [{ title, url }] for assistant messages
  suggestions     JSONB DEFAULT '[]',     -- Follow-up question suggestions
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, created_at);

-- ── Knowledge Ingestion Log ────────────────────────────────────────────────
-- Tracks when the knowledge base was last ingested and what changed.
CREATE TABLE IF NOT EXISTS knowledge_ingestion_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status        TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  documents_added   INT NOT NULL DEFAULT 0,
  documents_updated INT NOT NULL DEFAULT 0,
  documents_removed INT NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

-- ── Update Logs Access ─────────────────────────────────────────────────────
-- Tracks which admin/bot users have accessed the update logs.
CREATE TABLE IF NOT EXISTS update_log_access (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email    TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('viewed', 'exported')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_update_log_access_user ON update_log_access(user_email);
