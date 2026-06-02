-- Migration 047: Add item-level stage tracking
-- Each order_item now tracks its own stage independently of the order's stage.
-- This enables proper item-level progress tracking through the pipeline:
--   production_pending → production_in_progress → production_finished →
--   en_route → arrived → inventory_verified → delivered

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS item_stage TEXT NOT NULL DEFAULT 'production_pending';

-- Backfill item_stage based on existing item-level statuses
UPDATE order_items
SET item_stage = CASE
  WHEN COALESCE(delivered_qty, 0) >= quantity THEN 'delivered'
  WHEN inventory_verified_at IS NOT NULL THEN 'inventory_verified'
  WHEN en_route_status = 'arrived' THEN 'arrived'
  WHEN en_route_status = 'en_route' THEN 'en_route'
  WHEN production_status = 'finished' THEN 'production_finished'
  WHEN production_status = 'in_progress' THEN 'production_in_progress'
  ELSE 'production_pending'
END
WHERE item_stage = 'production_pending';

-- Add index for item_stage queries
CREATE INDEX IF NOT EXISTS idx_order_items_item_stage ON order_items (item_stage);
