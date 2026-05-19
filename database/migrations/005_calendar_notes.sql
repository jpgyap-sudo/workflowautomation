-- Calendar Notes: Allow users to add manual notes on calendar days
CREATE TABLE IF NOT EXISTS calendar_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_date DATE NOT NULL,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  color TEXT DEFAULT '#2490ef',
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_notes_date ON calendar_notes(note_date);
