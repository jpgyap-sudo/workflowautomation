-- Migration 032: Add per-item production finished timestamp
-- Tracks when each order item was marked finished in production.

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS production_finished_at TIMESTAMPTZ;

-- Preserve a usable date for existing finished items. This is a best-effort
-- backfill using the last item update timestamp because older rows did not
-- store a dedicated finished timestamp.
UPDATE order_items
SET production_finished_at = COALESCE(production_finished_at, updated_at, NOW())
WHERE production_status = 'finished'
  AND production_finished_at IS NULL;
