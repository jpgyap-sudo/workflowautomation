-- Inventory Verification Stage
-- Adds inventory_verification stage between en_route and inventory_arrived
-- Adds verified_qty column to order_items for tracking quantity verification
-- Adds inventory_verification_pct for tracking % complete

-- Add verified_qty to order_items for tracking how many units of each item have been verified
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS verified_qty INTEGER DEFAULT 0;

-- Add inventory_verified_at to track when inventory verification was completed
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS inventory_verified_at TIMESTAMPTZ;

-- Add inventory_verification_pct to track % complete for inventory verification
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS inventory_verification_pct INTEGER DEFAULT 0;
