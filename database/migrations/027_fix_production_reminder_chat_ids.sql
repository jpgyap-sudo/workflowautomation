-- Fix production reminders that were incorrectly assigned to the deposit/quotation group chat.
--
-- Root cause:
--   production_pending reminders were created by copying group_chat_id from the
--   deposit_verification reminder (which belongs to the quotation/finance group).
--   production_midpoint and production_due reminders used PURCHASING_GROUP_ID
--   instead of PRODUCTION_GROUP_CHAT_ID.
--
-- This migration reassigns all active/pending production-stage reminders to the
-- production group chat. It uses the PRODUCTION_GROUP_CHAT_ID env var at runtime;
-- if it isn't set the UPDATE is a no-op (sets to NULL, which the scheduler skips).

UPDATE reminders
SET    group_chat_id = current_setting('app.production_group_chat_id', true),
       updated_at    = NOW()
WHERE  stage IN ('production_pending', 'production_midpoint', 'production_due')
  AND  status IN ('active', 'pending')
  AND  current_setting('app.production_group_chat_id', true) IS NOT NULL
  AND  current_setting('app.production_group_chat_id', true) != '';
