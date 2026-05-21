-- Migration 019: Add payment verification status columns
-- 
-- Changes:
-- 1. Adds deposit_verified / balance_verified columns to orders table
-- 2. Adds deposit_verified_at / balance_verified_at timestamps
-- 3. Adds deposit_verified_by / balance_verified_by to track who verified
-- 4. Adds unique constraint on reminders(order_id, stage) if not exists
--
-- New payment flow:
--   deposit_paid=TRUE, deposit_verified=FALSE → Collection agent reminds to verify
--   deposit_verified=TRUE → Production/delivery reminders can proceed
--   balance_paid=TRUE, balance_verified=FALSE → Collection agent reminds to verify
--   balance_verified=TRUE → Order can proceed to completion

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS deposit_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deposit_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deposit_verified_by TEXT,
  ADD COLUMN IF NOT EXISTS balance_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS balance_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS balance_verified_by TEXT;

-- Add unique constraint on reminders(order_id, stage) if not exists
-- (some tables may already have this, use DO block to be safe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'reminders_order_id_stage_key'
  ) THEN
    ALTER TABLE reminders ADD CONSTRAINT reminders_order_id_stage_key UNIQUE (order_id, stage);
  END IF;
END $$;

-- Index for finding unverified payments
CREATE INDEX IF NOT EXISTS idx_orders_unverified_deposits 
  ON orders(id) 
  WHERE deposit_paid = TRUE AND deposit_verified = FALSE AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_orders_unverified_balances 
  ON orders(id) 
  WHERE balance_paid = TRUE AND balance_verified = FALSE AND status = 'active';
