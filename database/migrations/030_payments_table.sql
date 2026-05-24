-- Migration 030: Create payments table for multi-payment / installment support
-- Problem: orders table only stores one deposit and one balance per order.
-- This migration adds a payments table to track individual payment records.

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('deposit', 'balance')),
  amount NUMERIC(14,2) NOT NULL,
  reference_number TEXT,
  paid_by TEXT,
  payment_date TIMESTAMPTZ,
  image_url TEXT,
  source TEXT DEFAULT 'manual',
  verified BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  verified_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payments_order_id ON payments(order_id);
CREATE INDEX idx_payments_type ON payments(type);

-- Migrate existing deposits into payments table
INSERT INTO payments (order_id, type, amount, payment_date, image_url, verified, verified_at, verified_by)
SELECT
  id,
  'deposit',
  deposit_amount,
  deposit_paid_at,
  deposit_image_url,
  deposit_verified,
  deposit_verified_at,
  deposit_verified_by
FROM orders
WHERE deposit_paid = TRUE
  AND deposit_amount IS NOT NULL;

-- Migrate existing balance payments into payments table
-- Balance amount = total_amount - deposit_amount (computed)
INSERT INTO payments (order_id, type, amount, payment_date, verified, verified_at, verified_by)
SELECT
  id,
  'balance',
  total_amount - deposit_amount,
  balance_paid_at,
  balance_verified,
  balance_verified_at,
  balance_verified_by
FROM orders
WHERE balance_paid = TRUE
  AND total_amount IS NOT NULL
  AND deposit_amount IS NOT NULL
  AND total_amount >= deposit_amount;
