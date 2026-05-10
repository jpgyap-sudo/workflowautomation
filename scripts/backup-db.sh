#!/usr/bin/env bash
set -euo pipefail

mkdir -p backups
STAMP=$(date +%Y%m%d_%H%M%S)
docker exec qas_postgres pg_dump -U "${POSTGRES_USER:-n8n}" "${POSTGRES_DB:-quotation_automation}" > "backups/db_$STAMP.sql"
echo "Backup written to backups/db_$STAMP.sql"
