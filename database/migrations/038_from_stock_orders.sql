-- Migration 036: From-stock order support
-- Adds stock_prep_days and stock_prep_ready_at to orders table.
-- These are only set when order_type = 'from_stock'.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS stock_prep_days INTEGER,
  ADD COLUMN IF NOT EXISTS stock_prep_ready_at TIMESTAMPTZ;

-- Index for the new stock_preparation stage queries
CREATE INDEX IF NOT EXISTS idx_orders_stock_preparation
  ON orders (current_stage)
  WHERE current_stage = 'stock_preparation' AND status = 'active';
