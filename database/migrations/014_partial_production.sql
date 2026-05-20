-- Add partial_production_items column to track items not yet produced
ALTER TABLE orders ADD COLUMN IF NOT EXISTS partial_production_items JSONB DEFAULT '[]';
