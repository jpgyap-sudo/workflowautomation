-- Excess Arrival → Inventory Stock
-- When the actual arrived quantity exceeds the ordered quantity, the excess
-- is automatically added to inventory stock.
-- Adds arrived_qty column to order_items for tracking actual arrived quantity.

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS arrived_qty INTEGER;

-- Add excess_arrival movement type comment for documentation
COMMENT ON COLUMN order_items.arrived_qty IS 'Actual quantity that arrived (can exceed ordered quantity). Excess goes to inventory stock.';
