-- En Route stage: after production_finished, before inventory_arrived
-- The order enters "en_route" stage when production is finished.
-- The bot asks "Is the order en route?" and if yes, asks for estimated arrival days.
-- If no, a daily reminder keeps asking until confirmed.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS estimated_inventory_arrival_days INTEGER,
  ADD COLUMN IF NOT EXISTS inventory_en_route_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS en_route_confirmed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS en_route_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estimated_arrival_days INTEGER;
