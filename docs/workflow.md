# Workflow

## Overview

The system automates the full order lifecycle from quotation to payment collection using:
- **Telegram Bot** — Team members interact via simple commands and inline keyboard buttons
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

Built-in reminder scheduler sends daily message to Purchasing group with inline buttons:

> ⏰ *Reminder* — *QTN-2026-001* (Client Name)
> Stage: 🛒 Purchasing Pending
> Has production or purchasing started?

**Inline buttons**: `✅ Yes` / `❌ No`

If Yes → bot asks for estimated production days → stage moves to `production_confirmed`.

### Production Midpoint Check

At midpoint (estimated_days / 2), a reminder is sent with:

**Inline buttons**: `✅ On Time` / `⚠️ Delayed`

If Delayed → bot asks how many days delay.

### Production Due Check

When production is due, a reminder is sent with:

**Inline buttons**: `✅ Finished` / `❌ Not Yet`

If Finished → bot asks delivery timeline (standard 4 weeks or custom days).

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

Built-in reminder scheduler sends daily message with inline buttons:

**Inline buttons**: `✅ Ready for Delivery` / `⏳ Still Waiting`

- **Ready** → Stage advances to `balance_due`. Old inventory reminders are auto-completed.
- **Still Waiting** → Bot acknowledges, continues daily reminders.

### 4a. Balance Payment (Before Delivery)

Before delivery can be scheduled, the remaining balance must be paid.

Built-in reminder scheduler sends daily message with inline buttons:

> ⏰ *Reminder* — *QTN-2026-001* (Client Name)
> Stage: ⚖️ Balance Due
> The remaining balance is due before delivery can proceed.

**Inline buttons**: `✅ Yes, Client Paid` / `❌ Not Yet`

- **Yes, Client Paid** → Bot asks for a photo of the deposit slip or proof of payment. The AI (Gemini Vision) scans the image to extract the amount and date. If successful, the balance is auto-recorded via `/pay-balance` API and the stage advances to `delivery_scheduled`. If the AI cannot extract the amount, the user is prompted to enter the amount manually.
- **Not Yet** → Bot acknowledges, continues daily reminders.

The system computes the balance automatically:

```
balance = total_amount - deposit_amount
```

Team can also record the balance payment manually:

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

Built-in reminder scheduler sends daily message with inline buttons:

**Inline buttons**: `✅ Yes, Delivered` / `❌ Not Yet`

- **Yes, Delivered** → Stage advances to `delivered`. Old delivery reminders are auto-completed.
- **Not Yet** → Bot acknowledges, continues daily reminders.

Team can also update delivery status manually:

```txt
/delivered QTN-2026-001 yes countered
```

- If **countered**: stage moves to `countered`, collection reminder starts
- If **not countered**: reminders continue until countered

## 6. Collection

Built-in reminder scheduler sends daily message with inline buttons for `countered` stage:

**Inline buttons**: `💰 Payment Received` / `⏳ Still Waiting`

- **Payment Received** → Stage advances to `payment_received`.
- **Still Waiting** → Bot acknowledges, continues daily reminders.

For `payment_received` stage:

**Inline buttons**: `✅ Confirm Payment` / `⏳ Still Pending`

- **Confirm Payment** → Stage advances to `payment_confirmed` → `completed`. All reminders are disabled.
- **Still Pending** → Bot acknowledges, continues daily reminders.

Team can also update payment status manually:

```txt
/payment QTN-2026-001 confirmed
```

Stage moves to `payment_confirmed` → `completed`. All reminders are disabled.

## Inline Keyboard Summary

| Stage | Inline Buttons | Action on Yes | Action on No |
|-------|---------------|---------------|--------------|
| `purchasing_pending` | ✅ Yes / ❌ No | Ask production days | Acknowledge |
| `production_midpoint` | ✅ On Time / ⚠️ Delayed | Continue reminders | Ask delay days |
| `production_due` | ✅ Finished / ❌ Not Yet | Ask delivery timeline | Acknowledge |
| `en_route_reminder` | ✅ Yes / ❌ No | Ask arrival days | Acknowledge |
| `inventory_arrived` | ✅ Ready / ⏳ Still Waiting | Advance to `balance_due` | Acknowledge |
| `balance_due` | ✅ Yes, Paid / ❌ Not Yet | Ask proof photo → AI extract → advance to `delivery_scheduled` | Acknowledge |
| `delivery_scheduled` | ✅ Yes, Delivered / ❌ Not Yet | Advance to `delivered` | Acknowledge |
| `countered` | 💰 Payment Received / ⏳ Still Waiting | Advance to `payment_received` | Acknowledge |
| `payment_received` | ✅ Confirm Payment / ⏳ Still Pending | Advance to `payment_confirmed` → `completed` | Acknowledge |

## Reminder Escalation

If a stage is not updated after multiple reminders, the scheduler auto-escalates:

| Reminder # | Escalation Level | Message |
|-----------|-----------------|---------|
| 1st | Level 0 | Normal reminder |
| 2nd | Level 1 | 🔴 Slight urgency |
| 3rd | Level 2 | 🔴🔴 Higher urgency |
| 4th+ | Level 3+ | 🔴🔴🔴 Critical |

At Level 3+, the agent sends a "Manager intervention required" message.

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
| **Telegram Bot** | Order updates via commands, inline keyboards, file uploads, AI vision extraction |
| **API Server** | Business logic, database, reminder scheduler, agent system |
| **Google Drive** | File storage per order |
| **Dashboard** | Real-time order tracking (port 3000) |
| **Reminder Scheduler** | Built-in, runs every 60s, no external dependency |
| **Delivery Agent** | Checks inventory_arrived, balance_due, delivery_scheduled, delivered stages every 60 min |
| **Collection Agent** | Checks countered, payment_received stages every 60 min |
| **n8n (optional)** | Visual workflow editor if needed |
