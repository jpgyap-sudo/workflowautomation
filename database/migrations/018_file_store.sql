-- Migration 018: Local file store for Hermes agent quotation reference
-- Adds fields for local file storage, order completion tracking, and retention

-- Add order completion/delivery timestamps
ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- Add local file storage fields to files table
ALTER TABLE files ADD COLUMN IF NOT EXISTS storage_backend TEXT DEFAULT 'google_drive';
ALTER TABLE files ADD COLUMN IF NOT EXISTS local_file_path TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS extracted_text TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ;

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_files_retention_until ON files(retention_until) WHERE retention_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_completed_at ON orders(completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_delivered_at ON orders(delivered_at) WHERE delivered_at IS NOT NULL;
