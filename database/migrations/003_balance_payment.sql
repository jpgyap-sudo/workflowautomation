-- Migration 003: Add balance payment columns to orders table
-- Adds balance_paid and balance_paid_at to track remaining balance payment
-- before delivery can be scheduled.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS balance_paid BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS balance_paid_at TIMESTAMPTZ;
