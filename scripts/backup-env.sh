#!/usr/bin/env bash
# ============================================================
# Backup .env to a safe, persistent location
# This runs as a cron job and also on every deploy
# ============================================================
set -euo pipefail

ENV_FILE="/opt/quotation-automation/.env"
BACKUP_DIR="/opt/quotation-automation/env-backups"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/.env.backup.${TIMESTAMP}"

mkdir -p "${BACKUP_DIR}"

if [ -f "${ENV_FILE}" ]; then
    cp "${ENV_FILE}" "${BACKUP_FILE}"
    echo "✅ .env backed up to ${BACKUP_FILE}"

    # Keep only last 10 backups, delete older ones
    ls -t "${BACKUP_DIR}"/.env.backup.* 2>/dev/null | tail -n +11 | xargs -r rm
    echo "   Pruned old backups (keeping last 10)"
else
    echo "⚠️  No .env file found at ${ENV_FILE}"
fi

# Also keep a stable copy that deploy scripts can reference
cp "${ENV_FILE}" "${BACKUP_DIR}/.env.current" 2>/dev/null || true
