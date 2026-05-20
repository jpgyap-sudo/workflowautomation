-- Vision Uploads table
-- Stores extracted vision data shared from Telegram bot to dashboard.
-- Data persists for 48 hours (configurable via cleanup interval).
-- This replaces the in-memory Map<string, VisionShareEntry> which had only 30min TTL
-- and didn't survive API restarts or work across devices.

CREATE TABLE IF NOT EXISTS vision_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  image_base64 TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  extracted JSONB NOT NULL DEFAULT '{}',
  type TEXT NOT NULL DEFAULT 'unknown' CHECK (type IN ('quotation', 'payment', 'unknown')),
  confidence TEXT NOT NULL DEFAULT 'low' CHECK (confidence IN ('high', 'medium', 'low')),
  raw_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours')
);

-- Index for fast token lookup
CREATE INDEX IF NOT EXISTS idx_vision_uploads_token ON vision_uploads(token);

-- Index for listing recent uploads (ordered by creation time)
CREATE INDEX IF NOT EXISTS idx_vision_uploads_created_at ON vision_uploads(created_at DESC);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_vision_uploads_expires_at ON vision_uploads(expires_at);
