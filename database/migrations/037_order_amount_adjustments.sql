-- Migration 037: Order total amount adjustment audit fields
-- Tracks manual dashboard changes to total_amount so edited totals can be
-- highlighted and reviewed with the required business reason.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS total_amount_changed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS previous_total_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS amount_change_reason TEXT,
  ADD COLUMN IF NOT EXISTS amount_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS amount_changed_by TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_total_amount_changed
  ON orders (total_amount_changed)
  WHERE total_amount_changed = TRUE;
