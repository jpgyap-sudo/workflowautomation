# Quotation Automation System

Telegram + PostgreSQL + AI automation for tracking quotation → purchasing → inventory arrival → delivery → collection.

## What this repo contains

- [`docker-compose.yml`](docker-compose.yml) — VPS deployment for Postgres, Redis, API, Telegram bot, and Dashboard.
- [`apps/api`](apps/api) — central backend API for orders, files, stage updates, and agent calls.
- [`apps/dashboard`](apps/dashboard) — Next.js web dashboard (ERPNext-inspired UI) for tracking orders through the full workflow.
- [`apps/telegram-bot`](apps/telegram-bot) — Telegram bot entrypoint for group messages and commands.
- [`agents/*`](agents) — small specialized business agents.
- [`database/schema.sql`](database/schema.sql) — database schema.
- [`docs/*`](docs) — architecture, workflow, Telegram group guide.
- [`scripts/*`](scripts) — setup and deployment helpers.

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

---

## Deployment

### Production VPS

| Detail | Value |
|--------|-------|
| **Host** | `100.86.182.7` (Tailscale IP) |
| **User** | `root` |
| **SSH Key** | `~/.ssh/id_ed25519_roo` |
| **Repo path** | `/opt/quotation-automation` |
| **Dashboard** | [`https://track.abcx124.xyz`](https://track.abcx124.xyz) |
| **API health** | [`https://track.abcx124.xyz/api/health`](https://track.abcx124.xyz/api/health) |

### Option 1: Deploy from local machine (PowerShell)

Run this from the repo root on your local machine. It SSHs into the VPS via Tailscale and runs the deploy there.

```powershell
# Full deploy (pull latest code, backup DB, rebuild, restart)
.\scripts\deploy-tailscale.ps1

# Quick rebuild (skip backup + skip git pull — use local code already on VPS)
.\scripts\deploy-tailscale.ps1 -Quick

# Sync .env and credentials from local machine to VPS first, then deploy
.\scripts\deploy-tailscale.ps1 -SyncSecrets

# Just check status
.\scripts\deploy-tailscale.ps1 -StatusOnly

# View recent logs
.\scripts\deploy-tailscale.ps1 -Logs
```

### Option 2: Deploy directly on VPS (SSH in)

```bash
# SSH into VPS
ssh root@100.86.182.7

# Go to project
cd /opt/quotation-automation

# Pull latest code
git pull origin master

# Run deploy
bash scripts/quick-deploy.sh
```

### Option 3: Single-Builder Deploy Agent (Node.js)

This repo may be edited by multiple AI coding apps, but production deploys must go through **one builder agent** to avoid mixed Docker image/container state.

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

### Option 4: GitHub Actions CI/CD (automated)

Every push to `master`/`main` automatically deploys to the VPS via Tailscale.

**To enable:**
1. Add the following secrets to your GitHub repo (Settings → Secrets and variables → Actions):

| Secret | Description |
|--------|-------------|
| `TAILSCALE_OAUTH_CLIENT_ID` | Tailscale OAuth client ID (from Tailscale admin console) |
| `TAILSCALE_OAUTH_SECRET` | Tailscale OAuth secret |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `POSTGRES_USER` | `n8n` |
| `POSTGRES_PASSWORD` | PostgreSQL password |
| `POSTGRES_DB` | `quotation_automation` |
| `PUBLIC_WEBHOOK_BASE_URL` | `https://track.abcx124.xyz` |
| `PURCHASING_GROUP_CHAT_ID` through `QUOTATION_GROUP_CHAT_ID` | All 7 group chat IDs |
| `PURCHASING_GROUP_ID` through `QUOTATION_GROUP_ID` | All 7 group IDs |
| `GEMINI_API_KEY` | Gemini API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `OPENROUTER_MODEL` | `google/gemini-2.0-flash-001` |
| `SMTP_USER` | Gmail address for email notifications |
| `SMTP_PASS` | Gmail App Password |
| `DASHBOARD_BASE_URL` | `https://track.abcx124.xyz` |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |

2. The workflow file is at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)

### What the deploy does

1. **Pre-flight checks** — Docker running, `.env` exists, required vars validated
2. **Tag current images** for rollback (`pre-deploy-YYYYMMDD-HHMMSS`)
3. **Database backup** via [`scripts/backup-db.sh`](scripts/backup-db.sh)
4. **Build** all Docker images
5. **Recreate services one-at-a-time** (avoids `docker-compose` v1 `ContainerConfig` bug):
   - `api` → wait for `/health` endpoint
   - `dashboard` → wait for HTTP 200
   - `telegram-bot` → start (no health endpoint, check logs)
6. **Verify** full stack
7. **Cleanup** old images (>7 days)

### Rollback

If a deploy fails, the script prints rollback commands. Quick rollback:

```bash
# On VPS:
cd /opt/quotation-automation
docker images | grep pre-deploy   # find the rollback tag
# Then run the rollback commands printed by the deploy script
```

---

## Database Migrations

Migrations run **automatically** when the API container starts. Place new `.sql` files in `database/migrations/` and they will execute in order on the next deploy.

```
database/migrations/
├── 001_initial.sql
├── 002_indexes_and_cache.sql
├── ...
└── 017_agent_notes.sql
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

---

## Automated Database Backup (Supabase)

The database is automatically backed up to **Supabase Storage** every **24 hours** via the `supabase-backup` agent.

- **Backup schedule:** Every 24 hours (runs inside the API process via agent scheduler)
- **Storage:** Supabase Storage bucket `db-backups`
- **Retention:** 30 days (old backups are automatically cleaned up)
- **Manual trigger:** `POST /agents/run/supabase-backup`
- **Script fallback:** `sh scripts/backup-to-supabase.sh` (runs via shell, useful for cron)

**Supabase project:** configured via `SUPABASE_URL` in `.env`

---

## MVP flow

1. Sales forwards approved quotation to Purchasing Telegram group.
2. Bot receives file and sends it to API.
3. API records the order/file and calls Quotation Checker Agent.
4. API uploads to Google Drive.
5. Daily reminders continue until each department replies with status.
6. Dashboard provides real-time visibility into every stage.
7. Database is automatically backed up to Supabase Storage every 24 hours.

---

## Environment Variables

See [`.env.example`](.env.example) for all required and optional environment variables.

Key variables:

| Variable | Purpose |
|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot authentication |
| `PUBLIC_WEBHOOK_BASE_URL` | Public URL for Telegram webhook (`https://track.abcx124.xyz`) |
| `PURCHASING_GROUP_CHAT_ID` through `QUOTATION_GROUP_CHAT_ID` | Agent notification targets (7 groups) |
| `PURCHASING_GROUP_ID` through `QUOTATION_GROUP_ID` | Telegram bot authorization (7 groups) |
| `GEMINI_API_KEY` | Primary AI provider (free tier) |
| `OPENROUTER_API_KEY` | Fallback AI provider (when Gemini rate-limited) |
| `SMTP_USER` / `SMTP_PASS` | Email notifications via Gmail App Password |
