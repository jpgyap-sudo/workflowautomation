# Quotation Automation System — Project Context

## VPS Deployment

**⚠️ CRITICAL: This project's VPS is 165.22.110.111 — NOT 104.248.225.250**

| Property | Value |
|----------|-------|
| Public IP | `165.22.110.111` |
| Tailscale IP | `100.86.182.7` |
| SSH User | `root` |
| SSH Key | `id_ed25519_roo` |
| Repo Path | `/opt/quotation-automation` |
| Website | `https://track.abcx124.xyz` |
| Docker Compose | v1 (use `down --remove-orphans` before `up -d`) |

### SSH Commands

```bash
# Direct (preferred)
ssh -i ~/.ssh/id_ed25519_roo root@165.22.110.111

# Via Tailscale
ssh -i ~/.ssh/id_ed25519_roo root@100.86.182.7
```

### Deploy Steps

```bash
ssh -i ~/.ssh/id_ed25519_roo root@165.22.110.111
cd /opt/quotation-automation
git fetch origin && git reset --hard origin/master
docker pull ghcr.io/jpgyap-sudo/workflowautomation/dashboard:latest
docker pull ghcr.io/jpgyap-sudo/workflowautomation/api:latest
docker pull ghcr.io/jpgyap-sudo/workflowautomation/telegram-bot:latest
docker-compose down --remove-orphans && docker-compose up -d
```

### Wrong VPS (DO NOT USE)

| Property | Value |
|----------|-------|
| IP | `104.248.225.250` |
| SSH User | `superroo` |
| SSH Key | `id_superroo_vps` |
| Purpose | SuperRoo Cloud Dashboard (different project) |

## Nginx

The site `track.abcx124.xyz` is served by nginx on the VPS. Config is at `/etc/nginx/sites-enabled/track.abcx124.xyz`. The dashboard container runs on port 3001 (mapped to container port 3000).

## Domain

- **Dashboard:** https://track.abcx124.xyz
- **API:** https://track.abcx124.xyz/api
- **Health:** https://track.abcx124.xyz/api/health
