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
echo "Note:       Backups are kept forever — no automatic deletion"

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
    -d "{\"name\":\"${SUPABASE_BACKUP_BUCKET}\",\"public\":false}" \
    "${SUPABASE_URL}/storage/v1/buckets")
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

# ── Cleanup temp files ───────────────────────────────────────
rm -rf "$TEMP_DIR"

echo ""
echo "=== Supabase Backup completed: $(date) ==="
echo "Backup file: ${BACKUP_FILENAME}"
echo "Bucket:      ${SUPABASE_BACKUP_BUCKET}"
echo ""
