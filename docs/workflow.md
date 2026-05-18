# Workflow

## Overview

The system automates the full order lifecycle from quotation to payment collection using:
- **Telegram Bot** — Team members interact via simple commands
- **API Server** — Manages orders, stages, files, and reminders
- **Google Drive** — Stores all uploaded files per order
- **Dashboard** — Web UI for real-time order tracking
- **Built-in Reminder Scheduler** — Sends automatic daily reminders (no n8n required)

## 1. Quotation Received

Sales forwards approved quotation to Purchasing Telegram group.

Bot:
- uploads file to **Google Drive**,
- creates order record in database,
- checks quotation math (OCR),
- creates a daily reminder for purchasing.

## 2. Purchasing / Production

Built-in reminder scheduler sends daily message to Purchasing group:

> ⏰ *Reminder* — *QTN-2026-001* (Client Name)
> Stage: 🛒 Purchasing Pending
> Has production or purchasing started?

Team replies:

```txt
/produce QTN-2026-001 yes 10 days
```

Stage moves to `production_confirmed`. Reminders for this stage are completed.

## 3. Inventory Arrival

Inventory sends arrival photos/files to the bot.

Bot asks which order it belongs to.

Team replies with delivery date:

```txt
/deliverydate QTN-2026-001 May 22 2026
```

Stage moves to `delivery_scheduled`. A new daily reminder starts for the delivery team.

## 4. Delivery

Delivery team sends delivery photos/delivery receipt.

```txt
/delivered QTN-2026-001 yes countered
```

- If **countered**: stage moves to `countered`, collection reminder starts
- If **not countered**: reminders continue until countered

## 5. Collection

Collection team sends deposit slip/proof of payment.

```txt
/payment QTN-2026-001 confirmed
```

Stage moves to `payment_confirmed` → `completed`. All reminders are disabled.

## Reminder Escalation

If a stage is not updated after multiple reminders, the scheduler auto-escalates:

| Reminder # | Escalation Level | Message |
|-----------|-----------------|---------|
| 1st | Level 0 | Normal reminder |
| 2nd | Level 1 | 🔴 Slight urgency |
| 3rd | Level 2 | 🔴🔴 Higher urgency |
| 4th+ | Level 3+ | 🔴🔴🔴 Critical |

## Stages

```txt
quotation_received → math_verified → purchasing_pending →
production_confirmed → inventory_arrived → delivery_scheduled →
delivered → countered → payment_received → payment_confirmed → completed
```

## Automation Summary

| Component | Role |
|-----------|------|
| **Telegram Bot** | Order updates via commands, file uploads |
| **API Server** | Business logic, database, reminder scheduler |
| **Google Drive** | File storage per order |
| **Dashboard** | Real-time order tracking (port 3000) |
| **Reminder Scheduler** | Built-in, runs every 60s, no external dependency |
| **n8n (optional)** | Visual workflow editor if needed |
