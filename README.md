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
| **Clients** | Client database with delivery addresses & authorized receivers |
| **Stage Pipeline** | Kanban-style pipeline across all 11 stages |
| **Agent Logs** | Quotation checker & agent execution logs |

## VPS

**Production VPS:** `<your-vps-ip>` (deploy user, SSH key: configured in `~/.ssh/`)

**Repo path on VPS:** `/opt/quotation-automation`

**Website:** `https://<your-domain>`

## Single-Builder Deployment

This repo may be edited by multiple AI coding apps, but production deploys must go through **one builder agent** to avoid mixed Docker image/container state.

Use this from the repo root after code is committed and pushed:

```powershell
node scripts/single-builder-deploy.mjs
```

Deploy a specific commit SHA:

```powershell
node scripts/single-builder-deploy.mjs --sha <commit-sha>
```

Only sync `.env` and credentials when those secrets actually changed:

```powershell
node scripts/single-builder-deploy.mjs --sync-secrets
```

The builder agent enforces:

- clean local git worktree
- commit exists on a remote branch
- remote deployment lock at `/opt/quotation-automation/.deploy.lock`
- exact git archive of the target SHA
- one-service-at-a-time rebuild/recreate for `api`, `dashboard`, and `telegram-bot`
- API/dashboard/container health verification

Full details: [`docs/deployment-builder.md`](docs/deployment-builder.md)

**Deprecated manual deploy:** Use only for emergency investigation; do not use when multiple agents are active.

```bash
ssh <deploy-user>@<your-vps-ip>
cd /opt/quotation-automation
git fetch origin && git reset --hard origin/master
docker-compose ps
```

Open:

| Service | URL |
|---|---|
| Dashboard | `https://<your-domain>` |
| n8n | `http://<your-vps-ip>:5678` |
| API health | `http://<your-vps-ip>:8080/health` |

## Database Migrations

Migrations run **automatically** when the API container starts. Place new `.sql` files in `database/migrations/` and they will execute in order on the next deploy.

```
database/migrations/
├── 001_initial.sql
├── 002_indexes_and_cache.sql
├── 003_balance_payment.sql
├── 004_agent_indexes.sql
├── 005_calendar_notes.sql
├── 006_bot_logs.sql
├── 007_vision_uploads.sql
├── 008_production_tracking.sql
├── 009_date_fields.sql
└── 010_clients.sql
```

- Files are executed in **alphanumeric order** (001 → 002 → ...)
- SQL is **idempotent** — `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` are safe to rerun
- If a migration fails, the API logs the error but **continues to start**
- The migrations directory is mounted read-only into the API container via `docker-compose.yml`

**To add a new migration:**

1. Create `database/migrations/011_your_change.sql`
2. Rebuild & restart the API container
3. Watch the API logs for `[migrations] ✓ 011_your_change.sql`

No manual `psql` required.

## Automated Database Backup (Supabase)

The database is automatically backed up to **Supabase Storage** every **24 hours** via the `supabase-backup` agent.

- **Backup schedule:** Every 24 hours (runs inside the API process via agent scheduler)
- **Storage:** Supabase Storage bucket `db-backups`
- **Retention:** 30 days (old backups are automatically cleaned up)
- **Manual trigger:** `POST /agents/run/supabase-backup`
- **Script fallback:** `sh scripts/backup-to-supabase.sh` (runs via shell, useful for cron)

**Supabase project:** configured via `SUPABASE_URL` in `.env`

## MVP flow

1. Sales forwards approved quotation to Purchasing Telegram group.
2. Bot receives file and sends it to API.
3. API records the order/file and calls Quotation Checker Agent.
4. n8n or Telegram bot uploads to Google Drive.
5. Daily reminders continue until each department replies with status.
6. Dashboard provides real-time visibility into every stage.
7. Database is automatically backed up to Supabase Storage every 24 hours.

## Suggested production domain

Set your domain in `.env` as `PUBLIC_WEBHOOK_BASE_URL` and `DASHBOARD_BASE_URL`.
