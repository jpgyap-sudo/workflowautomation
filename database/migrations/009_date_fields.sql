-- Migration 009: Add date fields extracted from images
-- deposit_paid_at: date of payment as shown on the deposit slip image
-- order_confirmed_at: date of order confirmation as shown on the quotation image

ALTER TABLE orders ADD COLUMN IF NOT EXISTS deposit_paid_at DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_confirmed_at DATE;
