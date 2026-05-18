-- Migration 002: Performance indexes and cache support
-- Run: psql $DATABASE_URL -f database/migrations/002_indexes_and_cache.sql

-- Additional indexes for query performance
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_quotation_number ON orders(quotation_number);
CREATE INDEX IF NOT EXISTS idx_orders_stage_status ON orders(current_stage, status);
CREATE INDEX IF NOT EXISTS idx_stage_updates_order_id ON stage_updates(order_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_created_at ON agent_logs(created_at DESC);

-- Composite index for dashboard stats queries
CREATE INDEX IF NOT EXISTS idx_orders_status_stage ON orders(status, current_stage);

-- Index for reminder overdue queries
CREATE INDEX IF NOT EXISTS idx_reminders_status_next_run ON reminders(status, next_run_at);
