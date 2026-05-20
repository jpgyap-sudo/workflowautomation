# Deploy Script — builds directly on the VPS via SSH over Tailscale
# Usage: .\scripts\deploy-tailscale.ps1

$ErrorActionPreference = "Stop"

$TAILSCALE_IP = "100.86.182.7"
$SSH_KEY      = "$env:USERPROFILE\.ssh\id_ed25519_roo"
$SSH_TARGET   = "root@${TAILSCALE_IP}"
$SSH_OPTS     = "-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -i `"${SSH_KEY}`""

Write-Host "=== Deploy: Quotation Automation System ===" -ForegroundColor Cyan
Write-Host "Target: ${SSH_TARGET} (via Tailscale)" -ForegroundColor Cyan
Write-Host ""

# Step 1: Test connectivity
Write-Host "=== Step 1: Testing Tailscale connectivity ===" -ForegroundColor Yellow
ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -i "${SSH_KEY}" root@${TAILSCALE_IP} "echo 'SSH OK' && hostname"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Cannot reach VPS. Is Tailscale running?" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Step 2: Pull latest code + build + restart on VPS
Write-Host "=== Step 2: Pulling code and rebuilding on VPS ===" -ForegroundColor Yellow
ssh $SSH_OPTS.Split(" ") $SSH_TARGET @"
set -e
cd /opt/quotation-automation

echo '--- Pulling latest code ---'
git pull origin master

echo '--- Building and restarting containers ---'
docker compose up -d --build --remove-orphans

echo '--- Cleaning up old images ---'
docker image prune -f

echo 'Build and restart complete.'
"@
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build or restart failed. Check logs above." -ForegroundColor Red
    exit 1
}
Write-Host ""

# Step 3: Verify
Write-Host "=== Step 3: Verifying ===" -ForegroundColor Yellow
Start-Sleep -Seconds 5
ssh $SSH_OPTS.Split(" ") $SSH_TARGET @"
echo '--- Running Containers ---'
docker ps --format 'table {{.Names}}\t{{.Status}}'
echo ''
echo '--- API Health ---'
curl -sf http://localhost:8080/health | head -c 200 || echo 'API not responding yet'
echo ''
echo '--- Nginx ---'
systemctl is-active nginx
"@
Write-Host ""

Write-Host "=== Deployment Complete ===" -ForegroundColor Green
Write-Host "Website: https://track.abcx124.xyz" -ForegroundColor Green
