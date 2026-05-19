# Workflow

## Overview

The system automates the full order lifecycle from quotation to payment collection using:
- **Telegram Bot** — Team members interact via simple commands
- **API Server** — Manages orders, stages, files, and reminders
- **Google Drive** — Stores all uploaded files per order
- **Dashboard** — Web UI for real-time order tracking
- **Built-in Reminder Scheduler** — Sends automatic daily reminders (no n8n required)

## 1. Order Confirmation Received

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

## 3. Deposit Payment

Before production can proceed, a deposit payment is required.

Built-in reminder scheduler sends daily message to the group:

> ⏰ *Reminder* — *QTN-2026-001* (Client Name)
> Stage: 💳 Deposit Pending
> Deposit payment required before production can continue.

Team records the deposit:

```txt
/deposit QTN-2026-001 5000
```

Or sends a deposit slip image (photo/document) after linking the order:

```txt
/link QTN-2026-001
```
*(then send the deposit slip image)*

Stage moves to `deposit_pending` → deposit recorded. Reminders for this stage are completed. The dashboard shows deposit status (paid/pending) and amount.

## 4. Inventory Arrival

Inventory sends arrival photos/files to the bot.

Bot asks which order it belongs to.

### 4a. Balance Payment (Before Delivery)

Before delivery can be scheduled, the remaining balance must be paid.

Built-in reminder scheduler sends daily message to the group:

> ⏰ *Reminder* — *QTN-2026-001* (Client Name)
> Stage: ⚖️ Balance Due
> The remaining balance is due before delivery can proceed.

The system computes the balance automatically:

```
balance = total_amount - deposit_amount
```

Team records the balance payment:

```txt
/paybalance QTN-2026-001 15000
```

The system validates that the amount covers the full balance. If insufficient, it rejects with the lacking amount.

Once balance is paid, delivery can be scheduled.

### 4b. Schedule Delivery

Team replies with delivery date:

```txt
/deliverydate QTN-2026-001 May 22 2026
```

The bot first checks if the balance has been paid. If not, it blocks delivery scheduling and shows the lacking amount.

Stage moves to `delivery_scheduled`. A new daily reminder starts for the delivery team.

## 5. Delivery

Delivery team sends delivery photos/delivery receipt.

```txt
/delivered QTN-2026-001 yes countered
```

- If **countered**: stage moves to `countered`, collection reminder starts
- If **not countered**: reminders continue until countered

## 6. Collection

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
order_confirmation_received → math_verified → purchasing_pending →
production_confirmed → deposit_pending → inventory_arrived →
balance_due → delivery_scheduled → delivered → countered →
payment_received → payment_confirmed → completed
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
