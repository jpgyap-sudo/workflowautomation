#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# PostgreSQL Restore Script
# Usage:
#   ./scripts/restore-db.sh backups/db_20260516_030000.sql.gz
#   ./scripts/restore-db.sh backups/db_latest.sql.gz
#
# WARNING: This will DROP and recreate the database.
# ============================================================

if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup-file>"
  echo ""
  echo "Available backups:"
  ls -lh backups/db_*.sql.gz 2>/dev/null || echo "  (no backups found)"
  exit 1
fi

BACKUP_FILE="$1"
CONTAINER="${CONTAINER:-qas_postgres}"
DB_USER="${POSTGRES_USER:-quotation_user}"
DB_NAME="${POSTGRES_DB:-quotation_automation}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "=== WARNING: This will REPLACE the database '$DB_NAME' ==="
echo "Container: $CONTAINER"
echo "Backup:    $BACKUP_FILE"
echo ""
read -rp "Type 'yes' to proceed: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Restore cancelled."
  exit 0
fi

echo ""
echo "=== Step 1: Dropping existing connections ==="
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "
  SELECT pg_terminate_backend(pg_stat_activity.pid)
  FROM pg_stat_activity
  WHERE pg_stat_activity.datname = '$DB_NAME'
    AND pid <> pg_backend_pid();
" 2>/dev/null || echo "(no connections to terminate)"

echo "=== Step 2: Dropping and recreating database ==="
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$DB_NAME\";"
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$DB_NAME\";"

echo "=== Step 3: Restoring from backup ==="
if [[ "$BACKUP_FILE" == *.gz ]]; then
  gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME"
else
  docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$BACKUP_FILE"
fi

echo ""
echo "=== Restore complete ==="
