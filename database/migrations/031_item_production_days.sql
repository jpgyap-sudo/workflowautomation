-- Migration 031: Add estimated_production_days to order_items
-- This enables per-item production timeline tracking for smarter reminders

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS estimated_production_days INTEGER;
