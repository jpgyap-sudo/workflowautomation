-- Migration 025: Item-Level Reminders
-- Adds item_id column to reminders table so each item can have its own reminder.
-- Modifies the UNIQUE constraint from (order_id, stage) to (order_id, stage, item_id).
-- This enables the bot to create reminders for specific items that are pending
-- production or en route, and keep reminding until the item status is resolved.

-- Step 1: Drop the existing UNIQUE constraint on (order_id, stage)
ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_order_id_stage_key;

-- Step 2: Add item_id column (nullable — existing reminders without item_id remain valid)
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES order_items(id) ON DELETE CASCADE;

-- Step 3: Add a partial UNIQUE index for item-level reminders (item_id IS NOT NULL)
-- and a partial UNIQUE index for order-level reminders (item_id IS NULL).
-- PostgreSQL UNIQUE constraints treat all NULLs as distinct, so we need two partial indexes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_order_stage_item ON reminders(order_id, stage, item_id) WHERE item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_order_stage_null ON reminders(order_id, stage) WHERE item_id IS NULL;

-- Step 4: Create an index for efficient lookup by item_id
CREATE INDEX IF NOT EXISTS idx_reminders_item_id ON reminders(item_id);

-- Step 5: Create a helper function to create/complete item-level reminders
-- This will be called from the API when item status changes

CREATE OR REPLACE FUNCTION create_item_reminder(
  p_order_id UUID,
  p_item_id UUID,
  p_stage TEXT,
  p_group_chat_id TEXT,
  p_message TEXT,
  p_frequency TEXT DEFAULT 'daily'
) RETURNS UUID AS $$
DECLARE
  v_first_run TIMESTAMPTZ;
  v_reminder_id UUID;
BEGIN
  -- Calculate next run time (next 10:00 AM or 4:00 PM PHT)
  v_first_run := CASE
    WHEN EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Asia/Manila') < 10 THEN
      (DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Manila') + INTERVAL '10 hours') AT TIME ZONE 'Asia/Manila'
    WHEN EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Asia/Manila') < 16 THEN
      (DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Manila') + INTERVAL '16 hours') AT TIME ZONE 'Asia/Manila'
    ELSE
      (DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Manila') + INTERVAL '1 day' + INTERVAL '10 hours') AT TIME ZONE 'Asia/Manila'
  END;

  INSERT INTO reminders (order_id, item_id, stage, group_chat_id, message, frequency, next_run_at, status)
  VALUES (p_order_id, p_item_id, p_stage, p_group_chat_id, p_message, p_frequency, v_first_run, 'active')
  ON CONFLICT (order_id, stage, item_id) WHERE item_id IS NOT NULL
  DO UPDATE SET
    group_chat_id = EXCLUDED.group_chat_id,
    message = EXCLUDED.message,
    frequency = EXCLUDED.frequency,
    next_run_at = EXCLUDED.next_run_at,
    status = 'active',
    escalation_level = 0,
    updated_at = NOW()
  RETURNING id INTO v_reminder_id;

  RETURN v_reminder_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION complete_item_reminder(
  p_order_id UUID,
  p_item_id UUID,
  p_stage TEXT
) RETURNS VOID AS $$
BEGIN
  UPDATE reminders
  SET status = 'completed', updated_at = NOW()
  WHERE order_id = p_order_id
    AND item_id = p_item_id
    AND stage = p_stage
    AND status = 'active';
END;
$$ LANGUAGE plpgsql;
