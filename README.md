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

## Quick start on VPS

```bash
cp .env.example .env
openssl rand -hex 32
# paste generated key into N8N_ENCRYPTION_KEY

docker compose up -d --build
```

Open:

| Service | URL |
|---|---|
| Dashboard | `http://YOUR_VPS_IP:3000` |
| n8n | `http://YOUR_VPS_IP:5678` |
| API health | `http://YOUR_VPS_IP:8080/health` |

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
