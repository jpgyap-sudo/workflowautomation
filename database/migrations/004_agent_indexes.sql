-- Migration 004: Agent performance indexes and constraints
-- Adds composite indexes for agent queries, agent_name index on agent_logs,
-- and unique constraint on reminders to prevent duplicates.

-- Composite index for agent queries filtering by stage + status + date
-- Used by all agents to find active orders efficiently
CREATE INDEX IF NOT EXISTS idx_orders_stage_status_created
  ON orders (current_stage, status, created_at DESC);

-- Index for agent_logs queries filtering by agent name
-- Used by the Agent Logs dashboard and agent scheduler
CREATE INDEX IF NOT EXISTS idx_agent_logs_agent_name
  ON agent_logs (agent_name, created_at DESC);

-- Unique constraint to prevent duplicate reminders for the same order+stage
-- The ON CONFLICT DO NOTHING in createReminder() relies on this
ALTER TABLE reminders
  DROP CONSTRAINT IF EXISTS uq_reminders_order_stage;

ALTER TABLE reminders
  ADD CONSTRAINT uq_reminders_order_stage
  UNIQUE (order_id, stage);
