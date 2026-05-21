-- Item-Level Production Tracking
-- Adds per-item tracking for orders with % completion support

-- ── Order Items Table ──────────────────────────────────────────────────
-- Tracks each item in an order individually with production and delivery status.
-- Items are extracted from quotation text via Hermes AI (Gemini Vision).

CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    production_status TEXT NOT NULL DEFAULT 'pending',
    -- pending, in_progress, finished
    en_route_status TEXT NOT NULL DEFAULT 'not_yet',
    -- not_yet, en_route, arrived
    estimated_arrival_days INTEGER,
    -- standard 28 days or custom (per-item delivery estimate)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_production_status ON order_items(production_status);
CREATE INDEX IF NOT EXISTS idx_order_items_en_route_status ON order_items(en_route_status);

-- ── Production Update Logs Table ───────────────────────────────────────
-- Flexible notes and logs for production tracking per item and per order.
-- Both Hermes agents and users can add/edit logs.

CREATE TABLE IF NOT EXISTS production_update_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_item_id UUID REFERENCES order_items(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    log_type TEXT NOT NULL DEFAULT 'user',
    -- user, agent, system
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_logs_order_item_id ON production_update_logs(order_item_id);
CREATE INDEX IF NOT EXISTS idx_production_logs_order_id ON production_update_logs(order_id);

-- ── Helper function: calculate production completion % for an order ────
CREATE OR REPLACE FUNCTION get_production_completion_pct(p_order_id UUID)
RETURNS INTEGER AS $$
DECLARE
    total_qty INTEGER;
    finished_qty INTEGER;
BEGIN
    SELECT COALESCE(SUM(quantity), 0) INTO total_qty
    FROM order_items
    WHERE order_id = p_order_id;

    IF total_qty = 0 THEN
        RETURN 0;
    END IF;

    SELECT COALESCE(SUM(quantity), 0) INTO finished_qty
    FROM order_items
    WHERE order_id = p_order_id AND production_status = 'finished';

    RETURN ROUND((finished_qty::NUMERIC / total_qty::NUMERIC) * 100);
END;
$$ LANGUAGE plpgsql;

-- ── Helper function: calculate en-route completion % for an order ──────
CREATE OR REPLACE FUNCTION get_en_route_completion_pct(p_order_id UUID)
RETURNS INTEGER AS $$
DECLARE
    total_qty INTEGER;
    en_route_qty INTEGER;
BEGIN
    SELECT COALESCE(SUM(quantity), 0) INTO total_qty
    FROM order_items
    WHERE order_id = p_order_id;

    IF total_qty = 0 THEN
        RETURN 0;
    END IF;

    SELECT COALESCE(SUM(quantity), 0) INTO en_route_qty
    FROM order_items
    WHERE order_id = p_order_id AND en_route_status = 'en_route';

    RETURN ROUND((en_route_qty::NUMERIC / total_qty::NUMERIC) * 100);
END;
$$ LANGUAGE plpgsql;

-- ── Helper function: calculate inventory arrival completion % ──────────
CREATE OR REPLACE FUNCTION get_inventory_completion_pct(p_order_id UUID)
RETURNS INTEGER AS $$
DECLARE
    total_qty INTEGER;
    arrived_qty INTEGER;
BEGIN
    SELECT COALESCE(SUM(quantity), 0) INTO total_qty
    FROM order_items
    WHERE order_id = p_order_id;

    IF total_qty = 0 THEN
        RETURN 0;
    END IF;

    SELECT COALESCE(SUM(quantity), 0) INTO arrived_qty
    FROM order_items
    WHERE order_id = p_order_id AND en_route_status = 'arrived';

    RETURN ROUND((arrived_qty::NUMERIC / total_qty::NUMERIC) * 100);
END;
$$ LANGUAGE plpgsql;
