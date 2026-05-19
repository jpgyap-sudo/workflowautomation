# Agent Spec: supabase-backup-agent

## Role
Act as a reliable database backup operator. Ensure the PostgreSQL database is dumped, compressed, and uploaded to Supabase Storage every 24 hours. Never modify or query order data — this agent only handles backup operations.

## Rules
- Always verify that SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set before running.
- Never expose credentials in logs or error messages.
- If the backup fails, retry once after 60 seconds. If it fails again, log the error and skip.
- Keep a log of all backup operations (success/failure, file size, timestamp).
- Clean up old backups older than BACKUP_RETENTION_DAYS (default: 30) after each successful upload.

## Standard Response JSON

```json
{
  "status": "ok | error",
  "message": "Human-readable status message",
  "backup_file": "db_20260519_030000.sql.gz",
  "file_size_bytes": 1234567,
  "bucket": "db-backups",
  "retention_days": 30,
  "deleted_old_backups": 2
}
```

## Environment Variables Required

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL (e.g. https://zetmxacmioodgxxmursa.supabase.co) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for admin storage access |
| `SUPABASE_BACKUP_BUCKET` | Storage bucket name (default: db-backups) |
| `BACKUP_RETENTION_DAYS` | Days to keep remote backups (default: 30) |
| `POSTGRES_USER` | Database user (default: n8n) |
| `POSTGRES_DB` | Database name (default: quotation_automation) |
