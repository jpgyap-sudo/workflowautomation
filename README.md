# Quotation Automation System

Telegram + n8n + Google Drive + PostgreSQL automation for tracking quotation → purchasing → inventory arrival → delivery → collection.

## What this repo contains

- `docker-compose.yml` — local/VPS deployment for n8n, Postgres, Redis, API, and Telegram bot.
- `apps/api` — central backend API for orders, files, stage updates, and agent calls.
- `apps/telegram-bot` — Telegram bot entrypoint for group messages and commands.
- `agents/*` — small specialized business agents.
- `workflows/*` — starter n8n workflow templates.
- `database/schema.sql` — database schema.
- `docs/*` — architecture, workflow, Telegram group guide.
- `scripts/*` — setup and deployment helpers.

## Quick start on VPS

```bash
cp .env.example .env
openssl rand -hex 32
# paste generated key into N8N_ENCRYPTION_KEY

docker compose up -d --build
```

Open:

```txt
http://YOUR_VPS_IP:5678
```

API health:

```bash
curl http://YOUR_VPS_IP:8080/health
```

## MVP flow

1. Sales forwards approved quotation to Purchasing Telegram group.
2. Bot receives file and sends it to API.
3. API records the order/file and calls Quotation Checker Agent.
4. n8n or Telegram bot uploads to Google Drive.
5. Daily reminders continue until each department replies with status.

## Suggested production domain

```txt
automation.abcx124.xyz
```

or

```txt
ops.homeu.ph
```
