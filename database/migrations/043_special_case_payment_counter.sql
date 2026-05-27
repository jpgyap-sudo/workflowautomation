-- Add special case (skip balance payment) fields to orders table
-- Policy: A special case allows the order to proceed to delivery without paying the balance.
-- The order goes through: countered → payment_received → payment_confirmed → completed
-- Payment counter tracks sales invoice and delivery invoice status.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS special_case BOOLEAN DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS special_case_notes TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS special_case_granted_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS special_case_granted_by TEXT;

-- Payment counter table: tracks invoice status for special case orders
CREATE TABLE IF NOT EXISTS payment_counter (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sales_invoice_status TEXT NOT NULL DEFAULT 'pending',
  delivery_invoice_status TEXT NOT NULL DEFAULT 'pending',
  received_date TIMESTAMPTZ,
  delivery_date TIMESTAMPTZ,
  sales_invoice_file_id UUID,
  delivery_invoice_file_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(order_id)
);
