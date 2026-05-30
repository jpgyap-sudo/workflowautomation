-- Add projected_lead_time (in days) to orders table
-- This tracks the estimated lead time for the entire order from creation to delivery.
-- The Gantt chart on the order detail page uses this to visualize stage progress vs expected timeline.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS projected_lead_time INTEGER,
  ADD COLUMN IF NOT EXISTS projected_lead_time_started_at TIMESTAMPTZ;
