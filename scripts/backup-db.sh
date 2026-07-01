#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Automated PostgreSQL Backup Script
# Usage: ./scripts/backup-db.sh [--rotate N]
#   --rotate N  Keep only the last N backups (default: 7)
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env if present
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_DIR/.env"
  set +a
fi

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
CONTAINER="${CONTAINER:-qas_postgres}"
DB_USER="${POSTGRES_USER:-n8n}"
DB_NAME="${POSTGRES_DB:-quotation_automation}"

# Parse --rotate flag (overrides RETENTION_DAYS)
if [[ "${1:-}" == "--rotate" && -n "${2:-}" ]]; then
  RETENTION_DAYS="$2"
  shift 2
fi

mkdir -p "$BACKUP_DIR"

STAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/db_${STAMP}.sql.gz"
LATEST_LINK="${BACKUP_DIR}/db_latest.sql.gz"

echo "=== Backup started: $(date) ==="
echo "Container: $CONTAINER"
echo "Database:  $DB_NAME"
echo "Output:    $BACKUP_FILE"

# Dump and compress in one step
docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"

# Update latest symlink (use cp on Windows-friendly systems, ln -sf on Unix)
if command -v ln &>/dev/null; then
  ln -sf "$(basename "$BACKUP_FILE")" "$LATEST_LINK"
else
  cp "$BACKUP_FILE" "$LATEST_LINK"
fi

echo "Backup size: $(du -h "$BACKUP_FILE" | cut -f1)"

# Rotate old backups
echo "Cleaning backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -name 'db_*.sql.gz' -type f -mtime "+$RETENTION_DAYS" -delete

# Count remaining backups
COUNT=$(find "$BACKUP_DIR" -name 'db_*.sql.gz' -type f | wc -l)
echo "Backups retained: $COUNT"
echo "=== Backup completed: $(date) ==="
