-- Stock Matching Verification
-- Links order_items to inventory_items for from-stock orders
-- Enables per-item matching verification before marking stock ready

-- ── Add matched_inventory_item_id to order_items ──────────────────────
ALTER TABLE order_items
ADD COLUMN IF NOT EXISTS matched_inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_matched_inventory
ON order_items(matched_inventory_item_id);

-- ── Add inventory_match_verified flag ─────────────────────────────────
ALTER TABLE order_items
ADD COLUMN IF NOT EXISTS inventory_match_verified BOOLEAN DEFAULT FALSE;
