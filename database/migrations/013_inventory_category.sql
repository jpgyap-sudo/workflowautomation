-- Add category/type field to inventory_items and inventory_drafts
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE inventory_drafts ADD COLUMN IF NOT EXISTS category TEXT;

CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category);
