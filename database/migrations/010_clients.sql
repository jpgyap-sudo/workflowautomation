-- Client Database for delivery purposes
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name TEXT NOT NULL UNIQUE,
  delivery_address TEXT,
  contact_number TEXT,
  authorized_receiver_name TEXT,
  authorized_receiver_contact TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(client_name);
CREATE INDEX IF NOT EXISTS idx_clients_name_trgm ON clients USING gin (client_name gin_trgm_ops);

-- Link orders to clients for auto-fill
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS contact_number TEXT,
  ADD COLUMN IF NOT EXISTS authorized_receiver_name TEXT,
  ADD COLUMN IF NOT EXISTS authorized_receiver_contact TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_client_id ON orders(client_id);
