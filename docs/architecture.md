# Architecture

## System overview

```txt
Telegram Groups
  Purchasing / Inventory / Delivery / Collection
        ↓
Telegram Bot + n8n Triggers
        ↓
API Backend
        ↓
PostgreSQL + Google Drive + Redis
        ↓
Specialized Agents
```

## Responsibility split

### n8n
- Watches Telegram groups.
- Routes files/messages to the correct workflow.
- Uploads documents to Google Drive.
- Runs scheduled reminders.
- Calls API endpoints.

### API
- Stores orders, files, reminders, and stage updates.
- Exposes endpoints for n8n and Telegram bot.
- Calls agents.

### Agents
- Quotation Checker Agent: OCR/math checking.
- Purchasing Agent: production/procurement follow-up.
- Inventory Agent: item-arrival matching.
- Delivery Agent: delivery/countering tracking.
- Collection Agent: payment proof and confirmation.
- Escalation Agent: overdue reminders and manager escalation.

## Deployment

Use Docker Compose on the VPS. Keep this repo separate from SuperRoo, for example:

```bash
/opt/quotation-automation-system
```
