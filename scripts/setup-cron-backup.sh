#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Cron Backup Setup Script
# Installs a daily cron job for automated PostgreSQL backups.
#
# Usage:
#   ./scripts/setup-cron-backup.sh              # Daily at 3:00 AM
#   ./scripts/setup-cron-backup.sh --interval 6  # Every 6 hours
#   ./scripts/setup-cron-backup.sh --remove      # Remove the cron job
# ============================================================

CRON_DIR="./cron"
CRON_FILE="${CRON_DIR}/backup-crontab"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup-db.sh"

mkdir -p "$CRON_DIR"

if [[ "${1:-}" == "--remove" ]]; then
  echo "Removing backup cron job..."
  crontab -l 2>/dev/null | grep -v "$BACKUP_SCRIPT" | crontab -
  echo "Done. Cron job removed."
  exit 0
fi

INTERVAL="${2:-24}"  # default: every 24 hours (daily)

if [[ "$INTERVAL" -lt 1 ]]; then
  echo "Error: Interval must be at least 1 hour."
  exit 1
fi

if [[ "$INTERVAL" -eq 24 ]]; then
  # Daily at 3:00 AM
  CRON_SCHEDULE="0 3 * * *"
  SCHEDULE_DESC="daily at 3:00 AM"
elif [[ "$INTERVAL" -eq 12 ]]; then
  # Twice daily at 3:00 AM and 3:00 PM
  CRON_SCHEDULE="0 3,15 * * *"
  SCHEDULE_DESC="twice daily (3:00 AM, 3:00 PM)"
elif [[ $((24 % INTERVAL)) -eq 0 ]]; then
  # Even intervals (e.g. every 6h, 8h, 12h)
  HOURS=$((24 / INTERVAL))
  HOURS_LIST=""
  for ((i = 0; i < 24; i += INTERVAL)); do
    if [ -n "$HOURS_LIST" ]; then HOURS_LIST="$HOURS_LIST,"; fi
    HOURS_LIST="${HOURS_LIST}${i}"
  done
  CRON_SCHEDULE="0 ${HOURS_LIST} * * *"
  SCHEDULE_DESC="every ${INTERVAL} hours (at minute 0)"
else
  # Custom interval via */N syntax
  CRON_SCHEDULE="0 */${INTERVAL} * * *"
  SCHEDULE_DESC="every ${INTERVAL} hours"
fi

# Write the cron file
cat > "$CRON_FILE" << EOF
# PostgreSQL backup for Quotation Automation System
# Schedule: ${SCHEDULE_DESC}
# Installed: $(date '+%Y-%m-%d %H:%M:%S')
${CRON_SCHEDULE} cd ${PROJECT_DIR} && ${BACKUP_SCRIPT} --rotate 7 >> ${PROJECT_DIR}/logs/backup.log 2>&1
EOF

echo "=== Cron Backup Setup ==="
echo "Schedule:  ${SCHEDULE_DESC}"
echo "Script:    ${BACKUP_SCRIPT}"
echo "Retention: 7 days"
echo "Log:       ${PROJECT_DIR}/logs/backup.log"
echo ""

# Install the cron job (append, avoiding duplicates)
(
  crontab -l 2>/dev/null | grep -v "$BACKUP_SCRIPT"
  cat "$CRON_FILE"
) | crontab -

echo "Cron job installed successfully."
echo "Verify with: crontab -l"
echo ""
echo "To remove:  ./scripts/setup-cron-backup.sh --remove"
