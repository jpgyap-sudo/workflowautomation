-- Migration 006: Bot Logs
-- Tracks all Telegram bot messages, uploads, errors, and interactions
-- for debugging and monitoring purposes.

CREATE TABLE IF NOT EXISTS bot_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id TEXT NOT NULL,
  user_id TEXT,
  username TEXT,
  message_type TEXT NOT NULL,       -- 'text', 'photo', 'document', 'callback_query', 'command', 'error', 'upload', 'vision'
  direction TEXT NOT NULL DEFAULT 'incoming',  -- 'incoming', 'outgoing', 'internal'
  content TEXT,                     -- message text or file name
  metadata JSONB,                   -- extra data (file_id, mime_type, order_number, error_message, etc.)
  status TEXT DEFAULT 'success',    -- 'success', 'error', 'pending'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_logs_chat_id ON bot_logs(chat_id);
CREATE INDEX IF NOT EXISTS idx_bot_logs_created_at ON bot_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_logs_message_type ON bot_logs(message_type);
CREATE INDEX IF NOT EXISTS idx_bot_logs_status ON bot_logs(status);
