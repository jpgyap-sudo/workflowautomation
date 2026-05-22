-- Add production exception (special case) fields to orders table
-- Policy: Production normally requires downpayment verification, unless a special exception is granted

ALTER TABLE orders ADD COLUMN IF NOT EXISTS production_exception BOOLEAN DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS production_exception_notes TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS production_exception_granted_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS production_exception_granted_by TEXT;
