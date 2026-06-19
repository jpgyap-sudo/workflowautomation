-- ============================================================
-- CentralBrain — Persistent Learning Layer with pgvector
-- Stores lessons, embeddings, and metadata for semantic search
-- across all AI coding extensions (SuperRoo, Claude, Codex, Kimi)
-- ============================================================

-- Enable pgvector (safe — extension already exists in pgvector image)
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- ── Core Lessons Table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS brain_lessons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  summary       TEXT,
  tags          TEXT[] DEFAULT '{}',
  agent         TEXT DEFAULT 'superroo',
  project_id    TEXT DEFAULT 'workflowautomation',
  confidence    TEXT DEFAULT 'medium'
                  CHECK (confidence IN ('high', 'medium', 'low')),
  embedding     vector(768),                   -- nomic-embed-text: 768-dim
  related_files TEXT[] DEFAULT '{}',
  source        TEXT DEFAULT 'manual',         -- 'commit' | 'manual' | 'auto-extract'
  source_ref    TEXT,                          -- commit hash or reference
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_brain_lessons_tags
  ON brain_lessons USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_brain_lessons_related_files
  ON brain_lessons USING GIN (related_files);

CREATE INDEX IF NOT EXISTS idx_brain_lessons_created_at
  ON brain_lessons (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_brain_lessons_project_agent
  ON brain_lessons (project_id, agent);

-- IVFFlat index for approximate nearest-neighbor search on embeddings
-- lists=100 is good for up to ~1M rows; adjust as data grows
CREATE INDEX IF NOT EXISTS idx_brain_lessons_embedding
  ON brain_lessons USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ── Auto-update trigger ──────────────────────────────────────
CREATE OR REPLACE FUNCTION update_brain_lessons_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_brain_lessons_updated_at ON brain_lessons;
CREATE TRIGGER trg_brain_lessons_updated_at
  BEFORE UPDATE ON brain_lessons
  FOR EACH ROW
  EXECUTE FUNCTION update_brain_lessons_updated_at();

-- ── Seed Lessons (demonstration / bootstrap) ─────────────────
INSERT INTO brain_lessons (title, summary, content, tags, agent, confidence, source, source_ref, related_files)
SELECT * FROM (VALUES
  (
    'Telegram bot 409 Conflict fix — deleteWebhook before launch',
    'Call deleteWebhook() before bot.launch() to prevent 409 Conflict on restart',
    'When initializing a Telegram bot, always call deleteWebhook() before bot.launch() to clear any stale webhook from a previous session. This ensures idempotent restarts and prevents 409 conflicts.',
    ARRAY['telegram-bot', 'deployment', 'startup'],
    'superroo', 'high', 'commit', '40c0c4f',
    ARRAY['apps/telegram-bot/src/bot.ts']
  ),
  (
    'Switch Telegram parse_mode from Markdown to HTML',
    'Use HTML parse_mode to avoid entity parsing errors with special characters in user-generated content',
    'Telegram MarkdownV2 requires strict escaping of reserved characters. User-generated content often contains these characters without proper escaping, causing Telegram to reject messages. HTML is more forgiving and reduces silent message failures.',
    ARRAY['telegram-bot', 'api', 'formatting'],
    'superroo', 'high', 'commit', '7df5c1e',
    ARRAY['apps/api/src/server.ts', 'apps/api/src/services/agentRunner.ts', 'apps/api/src/services/reminderScheduler.ts']
  ),
  (
    'pgvector embeddings for semantic lesson search',
    'Store nomic-embed-text 768-dim vectors in brain_lessons.embedding for cosine similarity search',
    'The CentralBrain system stores AI-generated embeddings (768-dim from nomic-embed-text) alongside each lesson. Queries are converted to embeddings server-side via Ollama, then matched via cosine similarity using pgvector IVFFlat indexes. This enables "find similar lessons" without exact keyword matching.',
    ARRAY['brain', 'pgvector', 'embeddings', 'search'],
    'superroo', 'high', 'manual', NULL,
    ARRAY['database/migrations/047_brain_lessons.sql']
  ),
  (
    'Docker memory — prefer tsx over compiled Node.js bundles',
    'Use tsx TypeScript runtime instead of node dist/index.js to avoid OOM on low-memory VPS',
    'For resource-constrained environments (e.g., small VPS, low-memory containers), prefer running TypeScript directly with tsx over pre-compiled Node.js bundles. The lazy module loading of tsx reduces memory pressure, especially during startup.',
    ARRAY['docker', 'vps', 'deployment', 'memory'],
    'superroo', 'high', 'commit', '6324c6f',
    ARRAY['apps/api/Dockerfile']
  ),
  (
    'Add --dns-result-order=ipv4first to fix Telegram ETIMEDOUT from undici',
    'Set NODE_OPTIONS=--dns-result-order=ipv4first in Docker containers without IPv6 support',
    'When running Node.js applications in Docker environments without IPv6 support, explicitly set --dns-result-order=ipv4first in NODE_OPTIONS environment variable or Node.js startup flags. This forces DNS resolution to prefer IPv4, preventing silent timeouts caused by IPv6 fallback behavior in modern HTTP clients like undici.',
    ARRAY['docker', 'api', 'telegram', 'networking'],
    'superroo', 'high', 'commit', 'ed57617',
    ARRAY['apps/api/Dockerfile']
  )
) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM brain_lessons WHERE title = v.column1
);
