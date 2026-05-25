-- Calendar Schedules: Schedule entries created via Telegram group chat or website
-- Each schedule represents a dated event/reminder that appears on the calendar.
-- Supports bi-directional sync: entries created in Telegram appear on the website
-- and vice versa.

CREATE TABLE IF NOT EXISTS calendar_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  schedule_date DATE NOT NULL,
  schedule_time TIME,
  end_time TIME,
  is_all_day BOOLEAN DEFAULT FALSE,
  color TEXT DEFAULT '#f59e0b',
  category TEXT DEFAULT 'general',
  created_by TEXT,
  created_by_chat_id TEXT,
  telegram_message_id TEXT,
  reminder_at TIMESTAMPTZ,
  reminder_sent BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_schedules_date ON calendar_schedules(schedule_date);
CREATE INDEX IF NOT EXISTS idx_calendar_schedules_status ON calendar_schedules(status);
CREATE INDEX IF NOT EXISTS idx_calendar_schedules_reminder ON calendar_schedules(reminder_at, reminder_sent) WHERE reminder_at IS NOT NULL AND reminder_sent = FALSE;
