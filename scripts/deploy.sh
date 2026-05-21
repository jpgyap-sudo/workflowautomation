#!/usr/bin/env bash
# ============================================================
# Safe Deploy Script — Run on VPS after git pull
# Backs up DB, rebuilds services one-at-a-time to avoid
# docker-compose v1 ContainerConfig bugs, verifies health,
# and provides rollback instructions on failure.
#
# Usage: ./scripts/deploy.sh [--skip-backup] [--skip-pull]
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HEALTH_TIMEOUT=120
ROLLBACK_TAG="pre-deploy-$(date +%Y%m%d-%H%M%S)"
FAILED=0
SKIP_BACKUP=0
SKIP_PULL=0

for arg in "$@"; do
  case "$arg" in
    --skip-backup) SKIP_BACKUP=1 ;;
    --skip-pull)   SKIP_PULL=1   ;;
  esac
done

cd "$PROJECT_DIR"

echo "=========================================="
echo "  Quotation Automation System — Deploy"
echo "  $(date -Iseconds)"
echo "=========================================="
echo ""

# ── Pre-flight checks ──
echo "=== Pre-flight checks ==="
if ! docker info >/dev/null 2>&1; then
  echo "❌ Docker is not running."
  exit 1
fi
if [ ! -f .env ]; then
  echo "❌ .env file not found. Copy from .env.example and fill in values."
  exit 1
fi
# Verify docker-compose is available (v1 or v2)
COMPOSE_CMD=""
if command -v docker-compose &>/dev/null; then
  COMPOSE_CMD="docker-compose"
elif docker compose version &>/dev/null; then
  COMPOSE_CMD="docker compose"
else
  echo "❌ Neither docker-compose nor docker compose found."
  exit 1
fi
echo "  Using: $COMPOSE_CMD"
echo "  Project: $PROJECT_DIR"
echo ""

# ── Step 0: Pull latest code ──
if [ "$SKIP_PULL" -eq 0 ] && [ -d .git ]; then
  echo "=== Step 0: Pulling latest code ==="
  git pull origin master || git pull origin main || true
  echo ""
fi

# ── Step 1: Tag current images for rollback ──
echo "=== Step 1: Tag current images for rollback ==="
for svc in api telegram-bot dashboard; do
  img=$(docker inspect --format='{{.Config.Image}}' "qas_${svc}" 2>/dev/null || true)
  if [ -n "$img" ]; then
    docker tag "$img" "${img}:${ROLLBACK_TAG}" 2>/dev/null || true
    echo "  Tagged qas_${svc} → ${ROLLBACK_TAG}"
  fi
done
echo ""

# ── Step 2: Database Backup ──
if [ "$SKIP_BACKUP" -eq 0 ]; then
  echo "=== Step 2: Database Backup ==="
  if "$SCRIPT_DIR/backup-db.sh"; then
    echo "  Backup OK"
  else
    echo "  ⚠️  Backup failed — continuing anyway"
  fi
  echo ""
fi

# ── Step 3: Build all images ──
echo "=== Step 3: Building images ==="
$COMPOSE_CMD -f "$PROJECT_DIR/docker-compose.yml" build
echo ""

# ── Step 4: Recreate services one-at-a-time ──
echo "=== Step 4: Recreating services ==="

recreate_service() {
  local svc="$1"
  local container="$2"
  local health_url="${3:-}"

  echo "  --- $svc ($container) ---"

  # Stop and remove old container first (avoids docker-compose v1 ContainerConfig bug)
  $COMPOSE_CMD -f "$PROJECT_DIR/docker-compose.yml" stop "$svc" 2>/dev/null || true
  $COMPOSE_CMD -f "$PROJECT_DIR/docker-compose.yml" rm -f "$svc" 2>/dev/null || true
  docker rm -f "$container" 2>/dev/null || true

  # Start fresh
  $COMPOSE_CMD -f "$PROJECT_DIR/docker-compose.yml" up -d --no-deps "$svc"

  # Wait for health
  if [ -n "$health_url" ]; then
    local elapsed=0
    while [ $elapsed -lt $HEALTH_TIMEOUT ]; do
      if curl -sf "$health_url" >/dev/null 2>&1; then
        echo "  ✅ $svc is healthy"
        return 0
      fi
      sleep 3
      elapsed=$((elapsed + 3))
      if [ $((elapsed % 9)) -eq 0 ]; then
        echo "  $svc waiting... (${elapsed}s)"
      fi
    done
    echo "  ❌ $svc did not become healthy within ${HEALTH_TIMEOUT}s"
    return 1
  fi
}

# Recreate in dependency order: postgres & redis stay up, then api, dashboard, telegram-bot
# postgres and redis are data services — only recreate if their images changed
recreate_service "api"           "qas_api"           "http://127.0.0.1:8080/health" || FAILED=1
if [ $FAILED -eq 0 ]; then
  recreate_service "dashboard"     "qas_dashboard"     "http://127.0.0.1:3001/"        || FAILED=1
fi
if [ $FAILED -eq 0 ]; then
  recreate_service "telegram-bot"  "qas_telegram_bot"  ""                               || FAILED=1
fi
echo ""

# ── Step 5: Verify full stack ──
if [ $FAILED -eq 0 ]; then
  echo "=== Step 5: Verify full stack ==="
  echo "  Containers:"
  $COMPOSE_CMD -f "$PROJECT_DIR/docker-compose.yml" ps
  echo ""
  echo "  API health:"
  curl -sf http://127.0.0.1:8080/health | python3 -m json.tool 2>/dev/null || curl -sf http://127.0.0.1:8080/health || echo "  (unavailable)"
  echo ""
fi

# ── Step 6: Cleanup old images ──
if [ $FAILED -eq 0 ]; then
  echo "=== Step 6: Cleanup old images ==="
  docker image prune -f --filter "until=168h" 2>/dev/null || true
  echo ""
fi

# ── Result ──
if [ $FAILED -eq 0 ]; then
  echo "=== ✅ Deployment complete ==="
  exit 0
else
  echo "=== ❌ Deployment failed ==="
  echo ""
  echo "To rollback to the previous working state:"
  echo "  docker stop qas_api qas_dashboard qas_telegram_bot 2>/dev/null; docker rm qas_api qas_dashboard qas_telegram_bot 2>/dev/null"
  echo "  docker run -d --name qas_api       --restart unless-stopped --network quotation-automation_default ghcr.io/jpgyap-sudo/workflowautomation/api:${ROLLBACK_TAG}"
  echo "  docker run -d --name qas_dashboard  --restart unless-stopped --network quotation-automation_default ghcr.io/jpgyap-sudo/workflowautomation/dashboard:${ROLLBACK_TAG}"
  echo "  docker run -d --name qas_telegram_bot --restart unless-stopped --network quotation-automation_default --env-file .env ghcr.io/jpgyap-sudo/workflowautomation/telegram-bot:${ROLLBACK_TAG}"
  echo ""
  $COMPOSE_CMD -f "$PROJECT_DIR/docker-compose.yml" ps
  echo ""
  echo "Last 50 lines of API logs:"
  $COMPOSE_CMD -f "$PROJECT_DIR/docker-compose.yml" logs --tail=50 api 2>/dev/null || docker logs qas_api --tail 50 2>/dev/null || true
  exit 1
fi
