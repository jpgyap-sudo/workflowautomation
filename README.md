# Quotation Automation System

Telegram + n8n + Google Drive + PostgreSQL automation for tracking quotation → purchasing → inventory arrival → delivery → collection.

## What this repo contains

- `docker-compose.yml` — local/VPS deployment for n8n, Postgres, Redis, API, Telegram bot, and Dashboard.
- `apps/api` — central backend API for orders, files, stage updates, and agent calls.
- `apps/dashboard` — Next.js web dashboard (ERPNext-inspired UI) for tracking orders through the full workflow.
- `apps/telegram-bot` — Telegram bot entrypoint for group messages and commands.
- `agents/*` — small specialized business agents.
- `workflows/*` — starter n8n workflow templates.
- `database/schema.sql` — database schema.
- `docs/*` — architecture, workflow, Telegram group guide.
- `scripts/*` — setup and deployment helpers.

## Dashboard

The web dashboard provides a full ERPNext-style interface for managing the quotation workflow:

| Page | Description |
|---|---|
| **Dashboard** | Stats cards + stage pipeline bar chart + recent orders |
| **All Orders** | Full order list with stage/math status filters |
| **Order Detail** | Single order view with stage progress timeline |
| **Purchasing** | Purchasing pending & production confirmed orders |
| **Inventory** | Inventory arrival tracking |
| **Delivery** | Scheduled & delivered order tracking |
| **Collection** | Counter, payment received, confirmed & completed orders |
| **Stage Pipeline** | Kanban-style pipeline across all 11 stages |
| **Agent Logs** | Quotation checker & agent execution logs |

## VPS

**Production VPS:** `165.22.110.111` (root user, SSH key: `id_ed25519_roo`)

**Repo path on VPS:** `/opt/quotation-automation`

**Website:** `https://track.abcx124.xyz`

**Deploy:** Push to GitHub → GHCR image auto-builds via GitHub Actions → SSH in and run:

```bash
ssh -i ~/.ssh/id_ed25519_roo root@165.22.110.111
cd /opt/quotation-automation
git fetch origin && git reset --hard origin/master
docker pull ghcr.io/jpgyap-sudo/workflowautomation/dashboard:latest
docker pull ghcr.io/jpgyap-sudo/workflowautomation/api:latest
docker pull ghcr.io/jpgyap-sudo/workflowautomation/telegram-bot:latest
docker-compose down --remove-orphans && docker-compose up -d
```

Open:

| Service | URL |
|---|---|
| Dashboard | `https://track.abcx124.xyz` |
| n8n | `http://165.22.110.111:5678` |
| API health | `http://165.22.110.111:8080/health` |

## MVP flow

1. Sales forwards approved quotation to Purchasing Telegram group.
2. Bot receives file and sends it to API.
3. API records the order/file and calls Quotation Checker Agent.
4. n8n or Telegram bot uploads to Google Drive.
5. Daily reminders continue until each department replies with status.
6. Dashboard provides real-time visibility into every stage.

## Suggested production domain

```txt
automation.abcx124.xyz
```

or

```txt
ops.homeu.ph
```
"# Hook test - verifying lesson extraction"  
