# Deploy Script — builds directly on the VPS via SSH over Tailscale
# Usage:
#   .\scripts\deploy-tailscale.ps1                    # Full deploy
#   .\scripts\deploy-tailscale.ps1 -SkipBackup        # Skip DB backup
#   .\scripts\deploy-tailscale.ps1 -SkipPull          # Skip git pull (use local code)
#   .\scripts\deploy-tailscale.ps1 -SyncSecrets       # Copy local .env + credentials to VPS
#   .\scripts\deploy-tailscale.ps1 -Quick             # Skip backup + skip pull (fast rebuild)
#   .\scripts\deploy-tailscale.ps1 -StatusOnly        # Just show container status
#   .\scripts\deploy-tailscale.ps1 -Logs              # Show recent logs

param(
  [switch]$SkipBackup,
  [switch]$SkipPull,
  [switch]$SyncSecrets,
  [switch]$Quick,
  [switch]$StatusOnly,
  [switch]$Logs
)

$ErrorActionPreference = "Stop"

$TAILSCALE_IP = "100.86.182.7"
$SSH_KEY      = "$env:USERPROFILE\.ssh\id_ed25519_roo"
$SSH_TARGET   = "root@${TAILSCALE_IP}"
$SSH_OPTS     = "-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -i `"${SSH_KEY}`""

# ── Helpers ──
function Run-SSH($cmd, $label) {
  Write-Host "  → $label" -ForegroundColor DarkGray
  $result = ssh $SSH_OPTS.Split(" ") $SSH_TARGET $cmd 2>&1
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    Write-Host "  ❌ SSH command failed (exit $exitCode)" -ForegroundColor Red
    Write-Host $result -ForegroundColor Red
    throw "SSH command failed: $label"
  }
  return $result
}

function Write-Step($num, $title) {
  Write-Host ""
  Write-Host "=== Step ${num}: ${title} ===" -ForegroundColor Yellow
}

# ── Status-only mode ──
if ($StatusOnly) {
  Write-Host "=== Container Status ===" -ForegroundColor Cyan
  $result = Run-SSH "docker ps --format 'table {{.Names}}\t{{.Status}}'" "container status"
  Write-Host $result -ForegroundColor White
  Write-Host ""
  $result = Run-SSH "curl -sf http://localhost:8080/health 2>/dev/null | head -c 300 || echo '(API not responding)'" "API health"
  Write-Host "API health: " -NoNewline
  Write-Host $result -ForegroundColor Green
  exit 0
}

# ── Logs mode ──
if ($Logs) {
  Write-Host "=== Recent Logs ===" -ForegroundColor Cyan
  $result = Run-SSH "echo '--- API (last 20) ---' && docker logs qas_api --tail 20 2>&1 && echo '' && echo '--- Telegram Bot (last 10) ---' && docker logs telegram-bot --tail 10 2>&1 && echo '' && echo '--- Dashboard (last 5) ---' && docker logs qas_dashboard --tail 5 2>&1" "recent logs"
  Write-Host $result -ForegroundColor White
  exit 0
}

# ── Quick mode ──
if ($Quick) {
  $SkipBackup = $true
  $SkipPull = $true
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Quotation Automation System — Deploy" -ForegroundColor Cyan
Write-Host "  Target: ${SSH_TARGET} (via Tailscale)" -ForegroundColor Cyan
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss UTC')" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# ── Step 1: Test connectivity ──
Write-Step 1 "Testing Tailscale connectivity"
ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -i "${SSH_KEY}" root@${TAILSCALE_IP} "echo 'SSH OK' && hostname"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Cannot reach VPS. Is Tailscale running?" -ForegroundColor Red
    exit 1
}
Write-Host "  ✅ Connected to VPS" -ForegroundColor Green

# ── Step 2: Sync secrets (optional) ──
if ($SyncSecrets) {
  Write-Step 2 "Syncing secrets to VPS"
  $localEnv = Join-Path (Get-Location) ".env"
  if (Test-Path $localEnv) {
    Write-Host "  Copying .env to VPS..." -ForegroundColor DarkGray
    scp -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -i "${SSH_KEY}" $localEnv "${SSH_TARGET}:/opt/quotation-automation/.env"
    Write-Host "  ✅ .env synced" -ForegroundColor Green
  } else {
    Write-Host "  ⚠️  No local .env found" -ForegroundColor Yellow
  }
  $credsDir = Join-Path (Get-Location) "credentials"
  if (Test-Path $credsDir) {
    Write-Host "  Syncing credentials/..." -ForegroundColor DarkGray
    ssh $SSH_OPTS.Split(" ") $SSH_TARGET "mkdir -p /opt/quotation-automation/credentials"
    Get-ChildItem $credsDir | ForEach-Object {
      scp -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -i "${SSH_KEY}" $_.FullName "${SSH_TARGET}:/opt/quotation-automation/credentials/"
    }
    Write-Host "  ✅ Credentials synced" -ForegroundColor Green
  }
}

# ── Step 3: Run deploy on VPS ──
Write-Step 3 "Running deploy on VPS"
$deployArgs = @()
if ($SkipBackup) { $deployArgs += "--skip-backup" }
if ($SkipPull)   { $deployArgs += "--skip-pull"   }

$remoteCmd = "cd /opt/quotation-automation && bash scripts/quick-deploy.sh $($deployArgs -join ' ') 2>&1"
Write-Host "  Executing: $remoteCmd" -ForegroundColor DarkGray

# Stream output in real-time
ssh -tt $SSH_OPTS.Split(" ") $SSH_TARGET $remoteCmd
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
  Write-Host ""
  Write-Host "=== ❌ Deployment failed (exit code $exitCode) ===" -ForegroundColor Red
  Write-Host "Check the output above for details." -ForegroundColor Red
  Write-Host ""
  Write-Host "Quick rollback commands (SSH into VPS first):" -ForegroundColor Yellow
  Write-Host "  ssh ${SSH_TARGET}" -ForegroundColor Gray
  Write-Host "  cd /opt/quotation-automation" -ForegroundColor Gray
  Write-Host "  # Find the rollback tag:" -ForegroundColor Gray
  Write-Host "  docker images | grep pre-deploy" -ForegroundColor Gray
  exit 1
}

# ── Step 4: Verify ──
Write-Step 4 "Verifying deployment"
Start-Sleep -Seconds 3

$result = Run-SSH @"
echo '--- Running Containers ---'
docker ps --format 'table {{.Names}}\t{{.Status}}'
echo ''
echo '--- API Health ---'
curl -sf http://localhost:8080/health 2>/dev/null | head -c 300 || echo '(API not responding)'
echo ''
echo '--- Nginx ---'
systemctl is-active nginx
"@ "verification"

Write-Host $result -ForegroundColor White

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  ✅ Deployment Complete" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  Dashboard: https://track.homeatelier.ph" -ForegroundColor Green
Write-Host "  API:       https://track.homeatelier.ph/api/health" -ForegroundColor Green
Write-Host ""
Write-Host "Quick status check:" -ForegroundColor Gray
Write-Host "  .\scripts\deploy-tailscale.ps1 -StatusOnly" -ForegroundColor Gray
Write-Host "View logs:" -ForegroundColor Gray
Write-Host "  .\scripts\deploy-tailscale.ps1 -Logs" -ForegroundColor Gray
