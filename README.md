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
ssh -i ~/.ssh/id_ed25519_roo root@165.22.110.111
cd /opt/quotation-automation
git fetch origin && git reset --hard origin/master
docker-compose ps
```

Open:

| Service | URL |
|---|---|
| Dashboard | `https://track.abcx124.xyz` |
| n8n | `http://165.22.110.111:5678` |
| API health | `http://165.22.110.111:8080/health` |

## Automated Database Backup (Supabase)

The database is automatically backed up to **Supabase Storage** every **24 hours** via the `supabase-backup` agent.

- **Backup schedule:** Every 24 hours (runs inside the API process via agent scheduler)
- **Storage:** Supabase Storage bucket `db-backups`
- **Retention:** 30 days (old backups are automatically cleaned up)
- **Manual trigger:** `POST /agents/run/supabase-backup`
- **Script fallback:** `sh scripts/backup-to-supabase.sh` (runs via shell, useful for cron)

**Supabase project:** [`zetmxacmioodgxxmursa`](https://supabase.com/dashboard/project/zetmxacmioodgxxmursa)

## MVP flow

1. Sales forwards approved quotation to Purchasing Telegram group.
2. Bot receives file and sends it to API.
3. API records the order/file and calls Quotation Checker Agent.
4. n8n or Telegram bot uploads to Google Drive.
5. Daily reminders continue until each department replies with status.
6. Dashboard provides real-time visibility into every stage.
7. Database is automatically backed up to Supabase Storage every 24 hours.

## Suggested production domain

```txt
automation.abcx124.xyz
```

or

```txt
ops.homeu.ph
```
"# Hook test - verifying lesson extraction"  
