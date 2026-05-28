-- 045: Backfill order_confirmed_at for existing orders
-- Orders created before this migration have NULL order_confirmed_at,
-- causing the "Order Date" column on the All Orders tab to appear blank.
-- This migration sets order_confirmed_at = created_at::date for those orders.

UPDATE orders
SET order_confirmed_at = created_at::date,
    updated_at = NOW()
WHERE order_confirmed_at IS NULL;
