-- ── Monitor Error Ingestion ──────────────────────────────────────────
-- Captures client-side errors (from dashboard error boundary + fetch wrapper)
-- and server-side exceptions so the monitor agent can analyze patterns.
CREATE TABLE IF NOT EXISTS monitor_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  error_type TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  source_url TEXT,
  component TEXT,
  metadata JSONB DEFAULT '{}',
  user_agent TEXT,
  screen_size TEXT,
  severity TEXT DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  acknowledged BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_monitor_errors_created_at ON monitor_errors(created_at DESC);
CREATE INDEX idx_monitor_errors_severity ON monitor_errors(severity);
CREATE INDEX idx_monitor_errors_type ON monitor_errors(error_type);

-- ── System Health Snapshots ──────────────────────────────────────────
-- Periodic snapshots taken by the monitor agent to track system health
-- over time and detect regressions.
CREATE TABLE IF NOT EXISTS monitor_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_type TEXT NOT NULL,          -- 'periodic', 'manual', 'on_error'
  summary TEXT NOT NULL,                -- Human-readable summary
  details JSONB DEFAULT '{}',           -- Full diagnostic data
  health_score SMALLINT CHECK (health_score BETWEEN 0 AND 100),
  agent_error_count INT DEFAULT 0,
  slow_query_count INT DEFAULT 0,
  stuck_order_count INT DEFAULT 0,
  bug_report_count INT DEFAULT 0,
  error_count INT DEFAULT 0,
  warnings JSONB DEFAULT '[]',          -- Array of warning strings stored as JSONB (pg driver compat)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_monitor_snapshots_created_at ON monitor_snapshots(created_at DESC);
CREATE INDEX idx_monitor_snapshots_score ON monitor_snapshots(health_score);

-- ── Allow monitor as a valid bug_reports source ─────────────────────
ALTER TABLE bug_reports DROP CONSTRAINT IF EXISTS bug_reports_source_check;
ALTER TABLE bug_reports ADD CONSTRAINT bug_reports_source_check
  CHECK (source IN ('dashboard', 'telegram', 'monitor'));
