# Tailscale Deploy Script — Quotation Automation System
# Run this from your local machine after GitHub Actions builds the images.
# Usage: .\scripts\deploy-tailscale.ps1

$ErrorActionPreference = "Stop"

$TAILSCALE_IP = "100.86.182.7"
$SSH_KEY = "$env:USERPROFILE\.ssh\id_ed25519_roo"
$SSH_TARGET = "root@${TAILSCALE_IP}"
$SSH_OPTS = "-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -i `"${SSH_KEY}`""

Write-Host "=== Tailscale Deploy: Quotation Automation System ===" -ForegroundColor Cyan
Write-Host "Target: ${SSH_TARGET} (Tailscale)" -ForegroundColor Cyan
Write-Host ""

# Step 1: Test Tailscale connectivity
Write-Host "=== Step 1: Testing Tailscale connectivity ===" -ForegroundColor Yellow
ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -i "${SSH_KEY}" root@${TAILSCALE_IP} "echo 'Tailscale SSH OK' && hostname && tailscale ip -4"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Cannot reach VPS via Tailscale. Check Tailscale status." -ForegroundColor Red
    exit 1
}
Write-Host ""

# Step 2: Pull latest images from ghcr.io
Write-Host "=== Step 2: Pulling latest Docker images ===" -ForegroundColor Yellow
ssh ${SSH_OPTS} ${SSH_TARGET} @"
set -e
echo 'Pulling API image...'
docker pull ghcr.io/jpgyap-sudo/workflowautomation/api:latest
echo 'Pulling Dashboard image...'
docker pull ghcr.io/jpgyap-sudo/workflowautomation/dashboard:latest
echo 'Pulling Telegram Bot image...'
docker pull ghcr.io/jpgyap-sudo/workflowautomation/telegram-bot:latest
echo 'All images pulled successfully.'
"@
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to pull images." -ForegroundColor Red
    exit 1
}
Write-Host ""

# Step 3: Restart containers with new images
Write-Host "=== Step 3: Restarting containers ===" -ForegroundColor Yellow
ssh ${SSH_OPTS} ${SSH_TARGET} @"
set -e
cd /opt/quotation-automation
echo 'Recreating API...'
docker-compose up -d --force-recreate --no-deps api
echo 'Recreating Dashboard...'
docker-compose up -d --force-recreate --no-deps dashboard
echo 'Recreating Telegram Bot...'
docker-compose up -d --force-recreate --no-deps telegram-bot
echo 'All containers restarted.'
"@
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to restart containers." -ForegroundColor Red
    exit 1
}
Write-Host ""

# Step 4: Verify deployment
Write-Host "=== Step 4: Verifying deployment ===" -ForegroundColor Yellow
Start-Sleep -Seconds 5
ssh ${SSH_OPTS} ${SSH_TARGET} @"
echo '--- Running Containers ---'
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
echo ''
echo '--- API Health Check ---'
curl -s -o /dev/null -w 'API: HTTP %{http_code}\n' --connect-timeout 5 http://localhost:8080/dashboard/stats
echo ''
echo '--- Nginx Check ---'
systemctl is-active nginx
echo ''
echo '--- Cleanup Old Images ---'
docker image prune -f
echo 'Done.'
"@
Write-Host ""

Write-Host "=== Deployment Complete ===" -ForegroundColor Green
Write-Host "Website: https://track.abcx124.xyz" -ForegroundColor Green
