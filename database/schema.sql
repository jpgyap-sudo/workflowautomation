CREATE EXTENSION IF NOT EXISTS pgcrypto;
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

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_number TEXT UNIQUE,
  client_name TEXT,
  sales_agent TEXT,
  total_amount NUMERIC(14,2),
  computed_amount NUMERIC(14,2),
  math_status TEXT DEFAULT 'pending',
  total_amount_changed BOOLEAN DEFAULT FALSE,
  previous_total_amount NUMERIC(14,2),
  amount_change_reason TEXT,
  amount_changed_at TIMESTAMPTZ,
  amount_changed_by TEXT,
  current_stage TEXT DEFAULT 'order_confirmation_received',
  status TEXT DEFAULT 'active',
  google_drive_folder_id TEXT,
  deposit_paid BOOLEAN DEFAULT FALSE,
  deposit_amount NUMERIC(14,2),
  deposit_image_url TEXT,
  balance_paid BOOLEAN DEFAULT FALSE,
  balance_paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Client delivery info
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  delivery_address TEXT,
  contact_number TEXT,
  authorized_receiver_name TEXT,
  authorized_receiver_contact TEXT,
  -- Production / inventory transit info
  production_started BOOLEAN DEFAULT FALSE,
  production_started_at TIMESTAMPTZ,
  estimated_production_days INTEGER,
  production_delayed BOOLEAN DEFAULT FALSE,
  production_delay_days INTEGER,
  production_finished BOOLEAN DEFAULT FALSE,
  production_finished_at TIMESTAMPTZ,
  delivery_estimated_days INTEGER,
  estimated_inventory_arrival_days INTEGER,
  inventory_en_route_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  file_type TEXT NOT NULL,
  telegram_group TEXT,
  telegram_chat_id TEXT,
  telegram_message_id TEXT,
  original_filename TEXT,
  google_drive_file_id TEXT,
  file_url TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stage_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  remarks TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  item_id UUID REFERENCES order_items(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  group_chat_id TEXT NOT NULL,
  message TEXT NOT NULL,
  frequency TEXT DEFAULT 'daily',
  next_run_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active',
  escalation_level INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_order_stage_item ON reminders(order_id, stage, item_id) WHERE item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_order_stage_null ON reminders(order_id, stage) WHERE item_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_reminders_item_id ON reminders(item_id);

CREATE TABLE IF NOT EXISTS agent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL,
  input JSONB,
  output JSONB,
  status TEXT DEFAULT 'success',
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_stage ON orders(current_stage);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_quotation_number ON orders(quotation_number);
CREATE INDEX IF NOT EXISTS idx_orders_stage_status ON orders(current_stage, status);
CREATE INDEX IF NOT EXISTS idx_files_order_id ON files(order_id);
CREATE INDEX IF NOT EXISTS idx_reminders_next_run ON reminders(next_run_at, status);
CREATE INDEX IF NOT EXISTS idx_stage_updates_order_id ON stage_updates(order_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_created_at ON agent_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(client_name);
CREATE INDEX IF NOT EXISTS idx_clients_name_trgm ON clients USING gin (client_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_orders_client_id ON orders(client_id);

CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name TEXT NOT NULL,
  description TEXT,
  dimension TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name TEXT,
  description TEXT,
  dimension TEXT,
  quantity INTEGER,
  image_url TEXT,
  category TEXT,
  source_type TEXT NOT NULL,
  source_filename TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_name ON inventory_items(product_name);
CREATE INDEX IF NOT EXISTS idx_inventory_drafts_status ON inventory_drafts(status);
CREATE INDEX IF NOT EXISTS idx_inventory_drafts_created_at ON inventory_drafts(created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  quantity_change INTEGER NOT NULL,
  quantity_after INTEGER,
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_item_id ON inventory_movements(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_order_id ON inventory_movements(order_id);
