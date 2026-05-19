# Quotation Automation System — Agent Instructions

## Learning Layer (Mandatory)

This project uses the SuperRoo cross-project learning layer. Lessons from ALL SuperRoo projects are searchable.

### Before Coding — Query Relevant Lessons

Always query the learning layer before starting substantial work:

```bash
# Query lessons relevant to your task (across ALL projects)
superroo-learn query "quotation PDF parsing"
superroo-learn query "Telegram bot n8n integration"
superroo-learn query "Google Drive upload pattern"

# Query lessons specific to this project
superroo-learn query "workflowautomation" "workflowautomation"

# Check learning layer health
superroo-learn health
```

### After Coding — Record Lessons

After completing any task, record a lesson:

```bash
# Manual store
superroo-learn store "Quotation PDF parser — handle missing supplier name" "Added null guard for supplier_name field in PDF parser. Root cause: supplier field was assumed present but some PDFs omit it. Fix: added optional chaining with fallback to 'Unknown Supplier'."

# Or just commit — the global post-commit hook auto-extracts lessons:
git commit -m "fix: resolve null pointer in quotation PDF parser when supplier name is missing"
```

### Lesson Format

Every lesson should capture:
1. **What was accomplished** — the task summary
2. **What went wrong** — the bug cause (if applicable)
3. **How it was fixed** — the fix applied
4. **Reusable takeaway** — the lesson learned
5. **Tags** — quotation, pdf, parser, telegram, n8n, etc.

## Project Overview

- **Telegram + n8n + Google Drive + PostgreSQL** automation for quotation → purchasing → inventory → delivery → collection workflow
- **Apps**: `apps/api/`, `apps/dashboard/`, `apps/telegram-bot/`, `apps/n8n/`
- **Agents**: `agents/quotation-checker/`, `agents/purchasing-agent/`, `agents/inventory-agent/`, `agents/delivery-agent/`, `agents/collection-agent/`, `agents/escalation-agent/`
- **Database**: PostgreSQL via `database/schema.sql`
- **Deployment**: Docker Compose (`docker-compose.yml`)
- **Backup**: Supabase Storage via `scripts/backup-to-supabase.sh`

## Architecture

| Layer | Technology | Location |
|-------|-----------|----------|
| API | Node.js/Express | `apps/api/` |
| Dashboard | Next.js | `apps/dashboard/` |
| Telegram Bot | node-telegram-bot-api | `apps/telegram-bot/` |
| Workflow Automation | n8n | `apps/n8n/` |
| Business Agents | Node.js scripts | `agents/*/` |
| Database | PostgreSQL | `database/schema.sql` |
| File Storage | Google Drive | Via n8n + service account |

## MVP Flow

1. Sales forwards approved quotation to Purchasing Telegram group
2. Bot receives file → sends to API
3. API records order/file → calls Quotation Checker Agent
4. n8n/Telegram bot uploads to Google Drive
5. Daily reminders until each department replies with status
6. Dashboard provides real-time visibility

## Key Rules

- **Secrets**: Use `.env` file (see `.env.example`), never hardcode tokens
- **Shell scripts**: Use POSIX-compatible syntax (`/bin/sh`, `.` not `source`)
- **Docker**: Use `--shamefully-hoist` for pnpm in Docker builds
- **Backup**: Supabase Storage with `scripts/backup-to-supabase.sh`
