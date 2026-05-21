#!/usr/bin/env bash
# ============================================================
# Quick Deploy — One-command safe deployment
# Run this on your VPS after pulling code changes.
#
# Usage: ./scripts/quick-deploy.sh [--skip-backup]
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=========================================="
echo "  Quotation Automation System — Deploy"
echo "=========================================="
echo ""

# Check if docker is running
if ! docker info >/dev/null 2>&1; then
  echo "❌ Docker is not running. Start it first:"
  echo "   sudo systemctl start docker"
  exit 1
fi

# Check .env exists
if [ ! -f .env ]; then
  echo "❌ .env file not found. Copy from .env.example and fill in values."
  exit 1
fi

# Validate required env vars
echo "=== Validating .env ==="
REQUIRED_VARS=(
  "TELEGRAM_BOT_TOKEN"
  "POSTGRES_USER" "POSTGRES_PASSWORD" "POSTGRES_DB"
  "PURCHASING_GROUP_CHAT_ID" "PRODUCTION_GROUP_CHAT_ID"
  "INVENTORY_GROUP_CHAT_ID" "DELIVERY_GROUP_CHAT_ID"
  "COLLECTION_GROUP_CHAT_ID" "ESCALATION_GROUP_CHAT_ID"
  "QUOTATION_GROUP_CHAT_ID"
  "PURCHASING_GROUP_ID" "INVENTORY_GROUP_ID"
  "DELIVERY_GROUP_ID" "COLLECTION_GROUP_ID"
  "PUBLIC_WEBHOOK_BASE_URL"
)
MISSING=0
for var in "${REQUIRED_VARS[@]}"; do
  val=$(grep -E "^${var}=" .env | cut -d= -f2- | head -1 || true)
  if [ -z "$val" ] || [ "$val" = "replace_me" ] || [ "$val" = "change_this_strong_password" ] || [[ "$val" == *"your-domain"* ]] || [[ "$val" == *"your-project"* ]]; then
    echo "  ⚠️  $var is missing or still has placeholder value"
    MISSING=1
  fi
done
if [ "$MISSING" -eq 1 ]; then
  echo "  ⚠️  Some env vars have placeholder values — deploy may not work correctly."
  echo "  Continuing in 3 seconds... (Ctrl+C to abort)"
  sleep 3
else
  echo "  ✅ All required env vars present"
fi
echo ""

# Run the safe deploy
echo "🚀 Starting safe deployment..."
echo ""
"$SCRIPT_DIR/deploy.sh" "$@"
