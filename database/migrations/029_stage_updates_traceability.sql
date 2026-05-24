-- Add client_name and actor_name columns to stage_updates for traceability
-- This allows tracking which client and which user performed each stage transition

ALTER TABLE stage_updates
  ADD COLUMN IF NOT EXISTS client_name TEXT,
  ADD COLUMN IF NOT EXISTS actor_name TEXT;

-- Backfill existing rows with client_name from the orders table
UPDATE stage_updates su
SET client_name = o.client_name
FROM orders o
WHERE su.order_id = o.id
  AND su.client_name IS NULL;
