-- 034_stock_replenishment.sql
-- Adds order_type to distinguish client orders from internal stock replenishment orders

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type VARCHAR(50) DEFAULT 'client_order';

COMMENT ON COLUMN orders.order_type IS 'Type of order: client_order (default) or stock_replenishment';
