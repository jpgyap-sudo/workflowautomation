-- Inventory Management Tables
-- Supports single entry, image extraction, bulk upload with draft review

CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name TEXT NOT NULL,
  description TEXT,
  dimension TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
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
  source_type TEXT NOT NULL, -- 'image', 'csv', 'pdf', 'manual'
  source_filename TEXT,
  status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_name ON inventory_items(product_name);
CREATE INDEX IF NOT EXISTS idx_inventory_drafts_status ON inventory_drafts(status);
CREATE INDEX IF NOT EXISTS idx_inventory_drafts_created_at ON inventory_drafts(created_at DESC);
