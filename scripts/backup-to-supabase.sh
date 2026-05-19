#!/bin/sh
set -eu

# ============================================================
# Supabase Storage Backup Script
# Dumps the PostgreSQL database and uploads to Supabase Storage.
#
# Prerequisites:
#   - curl, gzip, docker
#   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env or environment
#
# Usage:
#   ./scripts/backup-to-supabase.sh
#
# Environment variables (can be set in .env or exported):
#   SUPABASE_URL             — https://<project>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY — service_role key (NOT anon key)
#   SUPABASE_BACKUP_BUCKET   — bucket name (default: db-backups)
#   BACKUP_RETENTION_DAYS    — days to keep remote backups (default: 30)
#   POSTGRES_USER            — DB user (default: from .env or n8n)
#   POSTGRES_DB              — DB name (default: from .env or quotation_automation)
#   CONTAINER                — Postgres container name (default: qas_postgres)
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env if present
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  . "$PROJECT_DIR/.env"
  set +a
fi

# ── Configuration ────────────────────────────────────────────
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
SUPABASE_BACKUP_BUCKET="${SUPABASE_BACKUP_BUCKET:-db-backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
CONTAINER="${CONTAINER:-qas_postgres}"
DB_USER="${POSTGRES_USER:-n8n}"
DB_NAME="${POSTGRES_DB:-quotation_automation}"

# ── Validation ───────────────────────────────────────────────
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set."
  echo "Add them to your .env file or export them as environment variables."
  echo ""
  echo "  SUPABASE_URL=https://<project>.supabase.co"
  echo "  SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>"
  exit 1
fi

# ── Timestamp ────────────────────────────────────────────────
STAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILENAME="db_${STAMP}.sql.gz"
TEMP_DIR=$(mktemp -d)
TEMP_BACKUP="${TEMP_DIR}/${BACKUP_FILENAME}"

echo "=== Supabase Backup started: $(date) ==="
echo "Container:  $CONTAINER"
echo "Database:   $DB_NAME"
echo "Bucket:     $SUPABASE_BACKUP_BUCKET"
echo "Retention:  $BACKUP_RETENTION_DAYS days"

# ── Step 1: Dump database ────────────────────────────────────
echo ""
echo "── Step 1: Dumping database ──"
docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$TEMP_BACKUP"
BACKUP_SIZE=$(stat -c%s "$TEMP_BACKUP" 2>/dev/null || stat -f%z "$TEMP_BACKUP" 2>/dev/null || echo "unknown")
echo "Backup size: $BACKUP_SIZE bytes"

# ── Step 2: Ensure bucket exists ─────────────────────────────
echo ""
echo "── Step 2: Ensuring bucket exists ──"
BUCKET_CHECK=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "${SUPABASE_URL}/storage/v1/buckets/${SUPABASE_BACKUP_BUCKET}" 2>/dev/null || echo "000")

if [ "$BUCKET_CHECK" = "200" ]; then
  echo "Bucket '$SUPABASE_BACKUP_BUCKET' already exists."
elif [ "$BUCKET_CHECK" = "404" ]; then
  echo "Creating bucket '$SUPABASE_BACKUP_BUCKET'..."
  CREATE_RESP=$(curl -s -X POST \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${SUPABASE_BACKUP_BUCKET}\",\"public\":false,\"file_size_limit\":104857600}" \
    "${SUPABASE_URL}/storage/v1/bucket")
  echo "Bucket creation response: $CREATE_RESP"
else
  echo "Warning: Could not verify bucket (HTTP $BUCKET_CHECK). Will attempt upload anyway."
fi

# ── Step 3: Upload backup ────────────────────────────────────
echo ""
echo "── Step 3: Uploading backup ──"
UPLOAD_RESP=$(curl -s -X POST \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/gzip" \
  --data-binary @"$TEMP_BACKUP" \
  "${SUPABASE_URL}/storage/v1/object/${SUPABASE_BACKUP_BUCKET}/${BACKUP_FILENAME}")

echo "Upload response: $UPLOAD_RESP"

# Verify upload
VERIFY_CHECK=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "${SUPABASE_URL}/storage/v1/object/info/${SUPABASE_BACKUP_BUCKET}/${BACKUP_FILENAME}" 2>/dev/null || echo "000")

if [ "$VERIFY_CHECK" = "200" ]; then
  echo "✓ Backup uploaded successfully: ${BACKUP_FILENAME}"
else
  echo "⚠ Upload verification returned HTTP $VERIFY_CHECK"
fi

# ── Step 4: Cleanup old remote backups ───────────────────────
echo ""
echo "── Step 4: Cleaning old backups (older than ${BACKUP_RETENTION_DAYS} days) ──"

# List all objects in the bucket
LIST_RESP=$(curl -s -X POST \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"prefix\":\"\"}" \
  "${SUPABASE_URL}/storage/v1/object/list/${SUPABASE_BACKUP_BUCKET}")

# Parse and delete old backups
CUTOFF=$(date -d "${BACKUP_RETENTION_DAYS} days ago" +%s 2>/dev/null || \
         date -j -v-${BACKUP_RETENTION_DAYS}d +%s 2>/dev/null || \
         echo "0")

DELETED=0
if command -v jq &>/dev/null; then
  # Use jq if available for proper JSON parsing
  for row in $(echo "$LIST_RESP" | jq -c '.[] // empty'); do
    NAME=$(echo "$row" | jq -r '.name // empty')
    CREATED=$(echo "$row" | jq -r '.created_at // empty')
    if [ -n "$NAME" ] && [ -n "$CREATED" ] && [ "$CUTOFF" != "0" ]; then
      CREATED_TS=$(date -d "$CREATED" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "$CREATED" +%s 2>/dev/null || echo "0")
      if [ "$CREATED_TS" -lt "$CUTOFF" ] 2>/dev/null; then
        echo "Deleting old backup: $NAME"
        curl -s -X DELETE \
          -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
          "${SUPABASE_URL}/storage/v1/object/${SUPABASE_BACKUP_BUCKET}/${NAME}" > /dev/null
        DELETED=$((DELETED + 1))
      fi
    fi
  done
  echo "Deleted $DELETED old backup(s)."
else
  echo "jq not found — skipping remote cleanup. Install jq to enable automatic rotation."
  echo "  apt-get install jq   # Debian/Ubuntu"
  echo "  brew install jq      # macOS"
fi

# ── Cleanup temp files ───────────────────────────────────────
rm -rf "$TEMP_DIR"

echo ""
echo "=== Supabase Backup completed: $(date) ==="
echo "Backup file: ${BACKUP_FILENAME}"
echo "Bucket:      ${SUPABASE_BACKUP_BUCKET}"
echo ""
