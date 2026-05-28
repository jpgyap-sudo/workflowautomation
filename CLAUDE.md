# quotation-automation-system — Project Instructions

## Deployment Rule: Always Build Locally First

**Before any deployment, all Docker images must be built and verified locally.**

```bash
# From project root
docker compose build --parallel
docker compose up -d
# Verify all services are healthy before pushing/deploying
docker compose ps
```

Only push or deploy to the VPS after a successful local build with no errors.

This applies to all agents and coding assistants (Claude Code VS Code extension, any CI agent, etc.).

## Stack

| Layer | Tech |
|---|---|
| Services | api, telegram-bot, dashboard, backup-agent, file-store |
| DB | PostgreSQL 16 (pgvector) + Redis 7 |
| Registry | ghcr.io/jpgyap-sudo/workflowautomation |
| Deployment | VPS via Docker Compose (Tailscale 100.86.182.7) |
| Deploy method | MCP VPS tool or deploy agent — NEVER GitHub Actions, NEVER Vercel |

## Docker Notes

- WSL 2 is required for Docker Desktop on this machine (installed: WSL 2.7.3)
- Docker Desktop must be running before any `docker` or `docker compose` commands
- Images are tagged as `ghcr.io/jpgyap-sudo/workflowautomation/<service>:latest`
