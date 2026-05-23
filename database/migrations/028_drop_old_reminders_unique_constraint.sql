-- Migration 028: Drop old reminders unique constraint
-- Migration 004 created uq_reminders_order_stage UNIQUE (order_id, stage)
-- Migration 025 dropped reminders_order_id_stage_key but NOT uq_reminders_order_stage
-- This left two overlapping constraints, causing duplicate key violations
-- when create_item_reminder() tries to insert a reminder for the same
-- (order_id, stage) but different item_id.

ALTER TABLE reminders
  DROP CONSTRAINT IF EXISTS uq_reminders_order_stage;
