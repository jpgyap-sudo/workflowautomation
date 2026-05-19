# supabase-backup-agent

Purpose: automated database backup agent that uploads PostgreSQL dumps to Supabase Storage for off-site disaster recovery.

## Input

Environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POSTGRES_USER, POSTGRES_DB) and the running PostgreSQL container.

## Output

Structured JSON with:
- status
- message
- backup_file
- file_size_bytes
- bucket
- retention_days
- deleted_old_backups

## Schedule

Runs every 24 hours (86,400,000 ms) via the agent scheduler.

## Implementation

Implemented as an API function in `apps/api/src/agents/supabaseBackupAgent.ts`. Uses:
- `docker exec` to run pg_dump inside the Postgres container
- `gzip` for compression
- Supabase Storage REST API for upload
- Automatic bucket creation if it doesn't exist
- Automatic cleanup of backups older than retention period

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/agents/run/supabase-backup` | Manually trigger a backup |
| `GET`  | `/agents` | List all agents (includes supabase-backup) |

## Restore Procedure

```bash
# List available backups
curl -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "https://zetmxacmioodgxxmursa.supabase.co/storage/v1/object/list/db-backups"

# Download a specific backup
curl -o db_backup.sql.gz \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "https://zetmxacmioodgxxmursa.supabase.co/storage/v1/object/db-backups/db_20260519_030000.sql.gz"

# Restore to local database
gunzip -c db_backup.sql.gz | docker exec -i qas_postgres psql -U n8n -d quotation_automation
```
