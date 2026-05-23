# Quotation Automation System — Learning Workflow

## VPS Deployment

| Property | Value |
|----------|-------|
| Public IP | configured via `QAS_VPS_HOST` env var or team docs |
| SSH User | configured via `QAS_SSH_USER` env var or team docs |
| SSH Key | `~/.ssh/` — set `QAS_DEPLOY_KEY` env var to override |
| Repo Path | `/opt/quotation-automation` |
| Website | configured via `DASHBOARD_BASE_URL` in `.env` |
| Docker Compose | v1 (use `down --remove-orphans` before `up -d`) |

### SSH Commands

```bash
ssh <deploy-user>@<your-vps-ip>
```

### Deploy Steps

**Single-builder rule:** multiple AI coding apps may edit code, but only one builder/deploy agent may release production. Do not run ad-hoc `docker-compose up --build` on the VPS while other agents are active.

Preferred deploy from repo root after the target commit is pushed:

```powershell
node scripts/single-builder-deploy.mjs
```

Deploy a specific SHA:

```powershell
node scripts/single-builder-deploy.mjs --sha <commit-sha>
```

If secrets changed:

```powershell
node scripts/single-builder-deploy.mjs --sync-secrets
```

The builder script deploys an exact git SHA, takes `/opt/quotation-automation/.deploy.lock`, rebuilds/recreates `api`, `dashboard`, and `telegram-bot` one at a time, tags images with the SHA, then verifies API health and dashboard availability.

Manual SSH is for inspection only (replace with your VPS details):

```bash
ssh -i ~/.ssh/<your-key> root@<your-vps-ip>
cd /opt/quotation-automation
cat .deployed-sha
docker compose ps
curl -fsS http://127.0.0.1:8080/health
```

See [`docs/deployment-builder.md`](docs/deployment-builder.md).

## Nginx

The site is served by nginx on the VPS. The dashboard container runs on port 3001 (mapped to container port 3000).

## Learning Layer — Mandatory Lesson Recording

**⚠️ After EVERY task, you MUST record a lesson in `memory/lessons-learned.md`**

This is non-negotiable. Every completed task must produce a lesson entry.

### How to record

1. Append to [`memory/lessons-learned.md`](memory/lessons-learned.md) using the existing format
2. Then sync to the searchable index:
   ```bash
   superroo-learn store "Title" "Lesson content..."
   ```

### Lesson Format

Every lesson must capture:
1. **What was accomplished** — the task summary
2. **What went wrong** — the bug cause (if applicable)
3. **How it was fixed** — the fix applied
4. **Reusable takeaway** — the lesson learned
5. **Tags** — vps, deployment, docker, api, dashboard, etc.

### Query Before Starting

Before starting any task, query the learning layer:
```bash
superroo-learn query "relevant topic"
```

## Domain

Configured via `DASHBOARD_BASE_URL` and `PUBLIC_WEBHOOK_BASE_URL` in `.env`.
