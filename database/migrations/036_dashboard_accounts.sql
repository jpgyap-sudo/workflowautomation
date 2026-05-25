-- Store dashboard account metadata (tab access, sub-users) server-side
-- so changes sync across browsers/devices.
CREATE TABLE IF NOT EXISTS dashboard_accounts (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'editor',
  allowed_tabs JSONB,
  sub_users JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_accounts_role ON dashboard_accounts(role);
