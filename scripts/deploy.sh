#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Deploy Script
# Runs a database backup, then builds and deploys all services.
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Step 1: Database Backup ==="
"$SCRIPT_DIR/backup-db.sh"
echo ""

echo "=== Step 2: Pull latest images ==="
docker compose pull
echo ""

echo "=== Step 3: Rebuild and restart services ==="
docker compose up -d --build
echo ""

echo "=== Step 4: Verify running containers ==="
docker compose ps
echo ""

echo "=== Deployment complete ==="
