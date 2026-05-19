CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_number TEXT UNIQUE,
  client_name TEXT,
  sales_agent TEXT,
  total_amount NUMERIC(14,2),
  computed_amount NUMERIC(14,2),
  math_status TEXT DEFAULT 'pending',
  current_stage TEXT DEFAULT 'quotation_received',
  status TEXT DEFAULT 'active',
  google_drive_folder_id TEXT,
  deposit_paid BOOLEAN DEFAULT FALSE,
  deposit_amount NUMERIC(14,2),
  deposit_image_url TEXT,
  balance_paid BOOLEAN DEFAULT FALSE,
  balance_paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
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
