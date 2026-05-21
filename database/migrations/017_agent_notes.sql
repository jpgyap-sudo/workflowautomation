-- Agent Notes
-- Free-form notes with timestamps that any agent (Hermes, collection, delivery, etc.)
-- can attach to orders for communication, updates, and flexible task tracking.
-- Unlike agent_logs (structured input/output), agent_notes are human-readable
-- messages that agents write for themselves and for cross-agent coordination.

CREATE TABLE IF NOT EXISTS agent_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_notes_order_id ON agent_notes(order_id);
CREATE INDEX IF NOT EXISTS idx_agent_notes_created_at ON agent_notes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_notes_agent_name ON agent_notes(agent_name);
