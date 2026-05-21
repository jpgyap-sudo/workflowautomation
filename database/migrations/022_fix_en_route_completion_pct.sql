-- Fix get_en_route_completion_pct to include 'arrived' status
-- Previously only counted 'en_route', missing items that are already 'arrived'

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
    WHERE order_id = p_order_id AND en_route_status IN ('en_route', 'arrived');

    RETURN ROUND((en_route_qty::NUMERIC / total_qty::NUMERIC) * 100);
END;
$$ LANGUAGE plpgsql;
