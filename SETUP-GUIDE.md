# Quotation Automation System — Setup Guide

## Prerequisites

- A **Superoo VPS** (or any Linux server with Docker)
- A **Telegram account** to create the bot and groups
- An **OpenAI API key** (for OCR / math checking)

---

## Step 1 — Prepare `.env` File

Copy the example file:

```bash
cp .env.example .env
```

Then edit `.env` with your real values. Below is a checklist of every variable:

| Variable | What to put | How to get it |
|---|---|---|
| `POSTGRES_PASSWORD` | A strong random password | Use a password generator |
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather | See Step 2 |
| `PURCHASING_GROUP_ID` | Telegram group chat ID | See Step 2 |
| `INVENTORY_GROUP_ID` | Telegram group chat ID | See Step 2 |
| `DELIVERY_GROUP_ID` | Telegram group chat ID | See Step 2 |
| `COLLECTION_GROUP_ID` | Telegram group chat ID | See Step 2 |
| `OPENAI_API_KEY` | OpenAI API key (optional) | From platform.openai.com |

---

## Step 2 — Set Up Telegram Bot

### 2.1 Create the bot

1. Open Telegram and search for **[@BotFather](https://t.me/botfather)**
2. Send `/newbot` and follow the prompts
3. Choose a name (e.g. `Quotation Automation Bot`)
4. Choose a username (e.g. `QuotationAutomationBot`)
5. BotFather will give you a **token** — copy it into `TELEGRAM_BOT_TOKEN` in `.env`

### 2.2 Create the 4 groups

Create these Telegram groups (you can name them anything):

| Group | Purpose |
|---|---|
| **Purchasing Team** | Sales forwards quotations here |
| **Inventory Team** | Stock arrival updates |
| **Delivery Team** | Delivery scheduling & confirmation |
| **Collection Team** | Payment collection updates |

### 2.3 Add bot to groups

1. Add the bot as a **member** of each group
2. Promote the bot to **Administrator** (at minimum: "Send Messages" permission)
3. This allows the bot to read messages and reply

### 2.4 Get group chat IDs

Method A — Use a helper bot:
1. Add **[@getidsbot](https://t.me/getidsbot)** to each group
2. It will reply with the chat ID (e.g. `-1001234567890`)
3. Copy each ID into the corresponding `.env` variable

Method B — Check bot logs:
1. Start the bot (see Step 4)
2. Send a message in each group
3. Check the bot's console logs — it prints `chatId`

---

## Step 3 — Install Dependencies (Local Dev)

If you want to run the API and bot locally (not in Docker) for development:

```bash
# API
cd apps/api
npm install

# Telegram Bot
cd ../telegram-bot
npm install
```

---

## Step 4 — Deploy to VPS

### 4.1 Copy files to VPS

```bash
# Option A: git clone on the VPS
git clone <your-repo-url> /opt/quotation-automation
cd /opt/quotation-automation

# Option B: SCP from local machine
scp -r .env docker-compose.yml apps/ database/ workflows/ scripts/ \
  user@your-vps-ip:/opt/quotation-automation/
```

### 4.2 Start everything

```bash
cd /opt/quotation-automation
docker compose up -d --build
```

This starts 5 services:

| Service | Port | Purpose |
|---|---|---|
| **postgres** | 5433 | Database |
| **redis** | 6380 | Queue / caching |
| **api** | 8080 | Backend REST API |
| **dashboard** | 3000 | Web dashboard (Next.js) |
| **telegram-bot** | — | Telegram bot (no exposed port) |

### 4.3 Check that everything is running

```bash
docker compose ps
```

All services should show `Up` status.

---

## Step 5 — Built-in Reminder Scheduler

The API server includes a built-in reminder scheduler ([`apps/api/src/services/reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts)) that:

- Checks for due reminders every 60 seconds
- Sends Telegram messages to the configured group chats
- Auto-escalates if no update is received after multiple reminders
- Supports hourly and daily frequencies

### Reminder API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/reminders` | List all active reminders |
| `GET` | `/reminders/overdue` | List overdue reminders |
| `POST` | `/reminders` | Create a new reminder |
| `PATCH` | `/reminders/:id/complete` | Mark a reminder as completed |
| `POST` | `/reminders/process` | Manually trigger reminder processing |

### How Reminders Work

1. When an order enters a stage (e.g., `purchasing_pending`), a reminder is created
2. The scheduler sends a Telegram message to the appropriate group chat
3. If no update is received, the reminder repeats daily with escalating urgency
4. When the team updates the order via bot commands (`/produce`, `/deliverydate`, etc.), the reminders for that stage are completed

---

## Step 6 — Telegram Bot Commands Reference

The Telegram bot supports the following commands for managing orders and file uploads:

| Command | Usage | Description |
|---------|-------|-------------|
| `/status QTN-2026-001` | `/status QTN-2026-001` | Check order status, stage, and math status |
| `/produce QTN-2026-001 yes 10 days` | `/produce QTN-2026-001 <status> [remarks]` | Update production confirmation |
| `/deliverydate QTN-2026-001 May 22 2026` | `/deliverydate QTN-2026-001 <date>` | Set delivery schedule |
| `/delivered QTN-2026-001 yes countered` | `/delivered QTN-2026-001 [remarks]` | Mark order as delivered |
| `/payment QTN-2026-001 confirmed` | `/payment QTN-2026-001 [remarks]` | Update payment status |
| `/link QTN-2026-001` | `/link <quotation_number>` | Link chat to an order (files uploaded after this will be attached to the order) |
| `/unlink` | `/unlink` | Clear the order link (files won't be attached to any order) |

### File Upload

When you send a **document** (PDF, image, etc.) or **photo** to the bot:

1. If you've used `/link QTN-2026-001` first, the file is attached to that order
2. If no order is linked, the file is stored without an order association
3. The file is stored locally via the file-store service
4. The file reference is stored in the database (`files` table)

---

## Step 6 — Test the System

### 6.1 Test API health

```bash
curl http://YOUR_VPS_IP:8080/health
```

Expected response:
```json
{"ok":true,"service":"quotation-automation-api"}
```

### 6.2 Test Telegram bot

Send `/start` to your bot on Telegram. It should reply: `Quotation Automation Bot is active.`

### 6.3 Test a quotation flow

1. In the **Purchasing** Telegram group, send a quotation document (PDF/image)
2. The bot should reply: `📎 File received...`
3. Check the order via API:
   ```bash
   curl http://YOUR_VPS_IP:8080/orders/pending
   ```

### 6.4 Test stage updates

In any group, try:
- `/status QTN-2026-001` — check order status
- `/produce QTN-2026-001 yes 10 days` — confirm production
- `/deliverydate QTN-2026-001 May 22 2026` — schedule delivery
- `/delivered QTN-2026-001 yes` — mark delivered
- `/payment QTN-2026-001 confirmed` — mark payment confirmed

---

## Step 7 — Production Hardening (Recommended)

### 7.1 Set up HTTPS with a reverse proxy

Install **Caddy** or **Nginx** on the VPS to handle SSL:

```bash
# Example with Caddy (automatic HTTPS)
sudo apt install caddy
```

Create `/etc/caddy/Caddyfile`:
```
automation.yourdomain.com {
    reverse_proxy localhost:5678
}
```

### 7.2 Configure firewall

```bash
# Allow only necessary ports
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP (for cert renewal)
sudo ufw allow 443/tcp     # HTTPS
sudo ufw deny 5678         # Block direct n8n access
sudo ufw deny 8080         # Block direct API access
sudo ufw enable
```

### 7.3 Set up local backups

The [`scripts/backup-db.sh`](scripts/backup-db.sh) script can be scheduled via cron:

```bash
crontab -e
# Add: 0 3 * * * /opt/quotation-automation/scripts/backup-db.sh
```

### 7.4 Set up Supabase cloud backup (recommended)

The system includes a Supabase Storage backup script that uploads your database dump to Supabase for off-site disaster recovery.

**Step 1 — Create a Supabase project**

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your **Project ID** from the dashboard URL (e.g. `your-supabase-project-id`)
3. Go to **Project Settings → API** and copy:
   - **Project URL** (e.g. `https://your-supabase-project-id.supabase.co`)
   - **`service_role` key** (NOT the anon/public key)

**Step 2 — Configure `.env`**

Add these to your `.env` file:

```bash
SUPABASE_URL=https://your-supabase-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
SUPABASE_BACKUP_BUCKET=db-backups
BACKUP_RETENTION_DAYS=30
```

**Step 3 — Update VPS `.env` remotely**

If your VPS is already deployed, use the update script:

```bash
node scripts/update-supabase-env.mjs
```

This SSHes into the VPS and updates the `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`.

**Step 4 — Test the backup**

```bash
node scripts/test-supabase-backup.mjs
```

Or run the backup script directly on the VPS:

```bash
ssh root@your-vps-ip "cd /opt/quotation-automation && sh scripts/backup-to-supabase.sh"
```

**Step 5 — Schedule automated backups**

Add a cron job to run the Supabase backup daily:

```bash
crontab -e
# Add: 0 4 * * * cd /opt/quotation-automation && sh scripts/backup-to-supabase.sh >> logs/supabase-backup.log 2>&1
```

**How it works**

The [`scripts/backup-to-supabase.sh`](scripts/backup-to-supabase.sh) script:
1. Dumps the PostgreSQL database via `docker exec` + `pg_dump`
2. Compresses it with `gzip`
3. Uploads to Supabase Storage (`db-backups` bucket)
4. Automatically cleans up backups older than `BACKUP_RETENTION_DAYS` (default: 30)
5. Uses the `service_role` key for admin-level storage access

**Restoring from a Supabase backup**

```bash
# List available backups
curl -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "https://your-supabase-project-id.supabase.co/storage/v1/object/list/db-backups"

# Download a specific backup
curl -o db_backup.sql.gz \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "https://your-supabase-project-id.supabase.co/storage/v1/object/db-backups/db_20260519_030000.sql.gz"

# Restore to local database
gunzip -c db_backup.sql.gz | docker exec -i qas_postgres psql -U n8n -d quotation_automation
```

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Bot doesn't reply | Wrong token or bot not admin in group | Check `TELEGRAM_BOT_TOKEN` and group permissions |
| API returns 500 | Database not ready or wrong `DATABASE_URL` | Check Postgres container logs: `docker compose logs postgres` |
| n8n can't connect to DB | Wrong Postgres credentials in `.env` | Verify `POSTGRES_USER`/`POSTGRES_PASSWORD` match |
| Container won't start | Port already in use | Change host port in `docker-compose.yml` (e.g. `8081:8080`) |

---

## Useful Commands

```bash
# View logs for a service
docker compose logs -f api
docker compose logs -f telegram-bot
docker compose logs -f n8n

# Restart a single service
docker compose restart api

# Rebuild and restart
docker compose up -d --build api

# Stop everything
docker compose down

# Stop and delete volumes (WARNING: deletes all data)
docker compose down -v

# Access Postgres directly
docker compose exec postgres psql -U n8n -d quotation_automation
```
