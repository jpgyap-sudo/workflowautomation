-- Add delivery exception (special case) fields to orders table
-- Policy: Payment is required before delivery, unless a special exception is granted

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_exception BOOLEAN DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_exception_notes TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_exception_granted_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_exception_granted_by TEXT;
