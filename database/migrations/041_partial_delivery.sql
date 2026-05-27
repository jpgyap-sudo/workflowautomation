-- Partial Inventory Verification & Partial Delivery
-- Allows completing inventory verification even when some items haven't arrived yet,
-- and supports delivering only the items that have arrived while tracking remaining items.

-- ── order_items: Add delivery tracking columns ──────────────────────────

-- partial_delivery_count: tracks how many times this item has been partially delivered
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS partial_delivery_count INTEGER NOT NULL DEFAULT 0;

-- remaining_qty: tracks how many units still need to be delivered
-- When an item is fully delivered, remaining_qty = 0
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS remaining_qty INTEGER;

-- last_partial_delivery_at: timestamp of the most recent partial delivery
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS last_partial_delivery_at TIMESTAMPTZ;

-- ── orders: Add partial delivery tracking columns ───────────────────────

-- partial_delivery: whether this order has partial delivery enabled
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS partial_delivery BOOLEAN DEFAULT FALSE;

-- partial_delivery_notes: notes about which items are pending
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS partial_delivery_notes TEXT;

-- ── Partial Delivery Logs Table ─────────────────────────────────────────
-- Tracks each partial delivery event with which items were delivered
CREATE TABLE IF NOT EXISTS partial_delivery_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
    item_name TEXT NOT NULL,
    quantity_delivered INTEGER NOT NULL,
    quantity_remaining INTEGER NOT NULL DEFAULT 0,
    delivery_note TEXT,
    delivered_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partial_delivery_logs_order_id ON partial_delivery_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_partial_delivery_logs_item_id ON partial_delivery_logs(item_id);

-- ── Helper function: calculate delivery completion % for an order ──────
CREATE OR REPLACE FUNCTION get_delivery_completion_pct(p_order_id UUID)
RETURNS INTEGER AS $$
DECLARE
    total_qty INTEGER;
    delivered_qty INTEGER;
BEGIN
    SELECT COALESCE(SUM(quantity), 0) INTO total_qty
    FROM order_items
    WHERE order_id = p_order_id;

    IF total_qty = 0 THEN
        RETURN 0;
    END IF;

    SELECT COALESCE(SUM(delivered_qty), 0) INTO delivered_qty
    FROM order_items
    WHERE order_id = p_order_id;

    RETURN ROUND((delivered_qty::NUMERIC / total_qty::NUMERIC) * 100);
END;
$$ LANGUAGE plpgsql;
