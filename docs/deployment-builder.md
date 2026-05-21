# Single-Builder Deployment Workflow

This project can be edited by multiple AI coding apps, but **production deploys must be owned by one builder agent only**.

The goal is to prevent mixed container state, where one agent syncs files, another rebuilds an image, and production ends up running a combination of different commits.

## Golden Rule

> Coding agents may create branches, commits, and PRs. Only the single-builder deploy agent may deploy to production.

Production deploys must always use:

1. A clean local git worktree.
2. A commit SHA that already exists on a remote branch.
3. A remote deploy lock.
4. A git archive of that exact SHA.
5. One-service-at-a-time Docker rebuild/recreate.
6. Post-deploy health checks.

## Deploy Command

From the repo root:

```powershell
node scripts/single-builder-deploy.mjs
```

Deploy a specific commit:

```powershell
node scripts/single-builder-deploy.mjs --sha a379e1d4343b8c051edd008a658a1d9e112814bd
```

If `.env` or `credentials/*` changed and must be copied to the VPS:

```powershell
node scripts/single-builder-deploy.mjs --sync-secrets
```

For an emergency deploy where checks have already passed in CI:

```powershell
node scripts/single-builder-deploy.mjs --skip-local-checks
```

## What the Builder Enforces

The deploy agent refuses to deploy if:

- There are local uncommitted or untracked files.
- The target commit is not present on a remote branch.
- Another deployment is already running on the VPS.
- API health or dashboard checks fail after deployment.

## VPS Lock

The lock directory is:

```txt
/opt/quotation-automation/.deploy.lock
```

If a deployment is interrupted, inspect it:

```bash
cat /opt/quotation-automation/.deploy.lock/info
```

Only remove it after confirming no deploy is running:

```bash
rm -rf /opt/quotation-automation/.deploy.lock
```

## Docker Compose v1 Safety

The VPS uses Docker Compose v1, which can fail with `KeyError: 'ContainerConfig'` when recreating containers from newer images.

The builder avoids this by deploying each app service like this:

```bash
docker-compose build api
docker-compose stop api || true
docker-compose rm -f api || true
docker-compose up -d --no-deps api
```

The same pattern is applied to:

- `api`
- `dashboard`
- `telegram-bot`

Database services (`postgres`, `redis`) are not recreated by the app deploy.

## Image Tagging

After each service is built, the builder tags the resulting image with the deployed SHA:

```txt
ghcr.io/jpgyap-sudo/workflowautomation/api:<sha>
ghcr.io/jpgyap-sudo/workflowautomation/dashboard:<sha>
ghcr.io/jpgyap-sudo/workflowautomation/telegram-bot:<sha>
```

The compose file still uses the configured image names for runtime, but SHA tags provide an audit trail for which image was built from which commit.

## Required Post-Deploy Checks

The builder checks:

```bash
curl -fsS http://127.0.0.1:8080/health
curl -fsS -o /dev/null http://127.0.0.1:3001/
docker-compose ps api dashboard telegram-bot
```

Optional extra checks after major releases:

```powershell
# Browser crawl from local machine
# See the latest E2E notes in memory/lessons-learned.md
```

## Team Rules for Multiple AI Coding Apps

1. Do not run `docker-compose up --build` manually on production.
2. Do not deploy uncommitted local changes.
3. Do not deploy from a dirty working tree.
4. Do not let multiple agents deploy concurrently.
5. If an agent changes code, it must commit and push first.
6. The builder deploys only by commit SHA.

## Current Production Target

| Property | Value |
|---|---|
| Website | configured via `DASHBOARD_BASE_URL` in `.env` |
| VPS IP | configured via `QAS_VPS_HOST` env var or team docs |
| SSH user | configured in deploy scripts |
| SSH key | `~/.ssh/` — set `QAS_DEPLOY_KEY` env var to override |
| Remote path | `/opt/quotation-automation` |
