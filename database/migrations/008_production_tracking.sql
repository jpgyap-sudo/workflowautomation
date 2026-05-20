-- Production Tracking
-- Adds columns to track production lifecycle: started, midpoint check, finished, delivery readiness

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS production_started BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS estimated_production_days INTEGER,
  ADD COLUMN IF NOT EXISTS production_delayed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS production_delay_days INTEGER,
  ADD COLUMN IF NOT EXISTS production_finished BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS production_finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_estimated_days INTEGER;
