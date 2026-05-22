# Workflow

## Overview

The system automates the full order lifecycle from quotation to payment collection using:
- **Telegram Bot** — Team members interact via simple commands and inline keyboard buttons
- **API Server** — Manages orders, stages, files, and reminders
- **Google Drive** — Stores all uploaded files per order
- **Dashboard** — Web UI for real-time order tracking
- **Built-in Agent System** — Automated agents run on schedules to check stages, send reminders, and escalate stalled orders

## Stage Flow

```txt
order_confirmation_received → math_verified → purchasing_pending →
production_pending → production_confirmed → deposit_pending →
deposit_verification → en_route → inventory_verification →
inventory_arrived → balance_due → balance_verification →
delivery_pending → delivery_scheduled → delivered → countered →
payment_received → payment_confirmed → completed
```

## 1. Order Confirmation Received

Sales forwards approved quotation to the Telegram bot (document/photo).

Bot:
- uploads file to **Google Drive**,
- creates order record in database (`current_stage = 'order_confirmation_received'`),
- triggers the **Quotation Checker** agent immediately to verify math,
- sends a stage transition notification to the Stage Progress group.

The **Quotation Checker** agent (runs every 5 min, also triggered immediately on new order):
- Extracts quotation items via AI (Gemini Vision / OpenRouter),
- Verifies math (item total vs `total_amount`),
- If math matches → auto-advances to `math_verified`,
- If math mismatch → sends alert to the group with details.

## 2. Math Verified

When math is verified, the **Purchasing Agent** is triggered automatically.

The agent sends a notification to the Purchasing group with inline buttons:

**Inline buttons**: `✅ Yes, started` / `⚠️ Partial` / `⏳ Not yet`

- **Yes, started** → Bot asks for estimated production days → stage moves to `production_pending`.
- **Partial** → Bot asks for partial details → stage moves to `production_pending`.
- **Not yet** → Bot acknowledges, continues reminders.

## 3. Purchasing / Production

### 3a. Purchasing Pending

Built-in reminder scheduler sends daily message to Purchasing group with inline buttons:

> ⏰ *Reminder* — *QTN-2026-001* (Client Name)
> Stage: 🛒 Purchasing Pending
> Has production or purchasing started?

**Inline buttons**: `✅ Yes, started` / `⚠️ Partial` / `⏳ Not yet`

If Yes → Bot asks for estimated production days → stage moves to `production_pending`.

### 3b. Production Pending

Stage moves to `production_pending` after purchasing confirms start.

The **Purchasing Agent** continues monitoring. When production is ready to begin, the stage advances to `production_confirmed`.

### 3c. Production Confirmed

The **Production Agent** takes over (runs every 60 min):

- Monitors production progress at item level,
- Sends midpoint check reminders (at estimated_days / 2),
- Sends due check reminders (at estimated_days).

**Midpoint Inline buttons**: `✅ On Time` / `⚠️ Delayed`
- If Delayed → Bot asks how many days delay.

**Due Inline buttons**: `✅ Finished` / `❌ Not Yet`
- If Finished → Bot asks delivery timeline (standard 4 weeks or custom days).

When production is finished → stage advances to `en_route`.

### 3d. En Route

The **Production Agent** monitors en-route status:

- Tracks item-level en-route progress,
- Sends reminders with inline buttons for each item.

**Inline buttons**: `✅ Yes` / `❌ No` / `📦 Arrived`

When all items arrive → stage advances to `inventory_verification`.

## 4. Inventory Verification

When items arrive, the **Inventory Agent** verifies each item against the order.

**Inline buttons**: `🔍 Verify All` / `⚠️ Partial` / `⏳ Not Yet`

- **Verify All** → All items marked as verified, stage advances to `inventory_arrived`.
- **Partial** → Bot asks for quantity per item, marks partial verification.
- **Not Yet** → Bot acknowledges, continues reminders.

A progress bar shows verification percentage (e.g., "60% verified").

## 5. Inventory Arrival

Inventory sends arrival photos/files to the bot.

Built-in reminder scheduler sends daily message with inline buttons:

**Inline buttons**: `✅ Ready for Delivery` / `⏳ Still Waiting`

- **Ready** → Stage advances to `balance_due`. Old inventory reminders are auto-completed.
- **Still Waiting** → Bot acknowledges, continues daily reminders.

## 6. Deposit Payment

### 6a. Deposit Pending

Before production can proceed, a deposit payment is required.

Built-in reminder scheduler sends daily message to the group:

> ⏰ *Reminder* — *QTN-2026-001* (Client Name)
> Stage: 💳 Deposit Pending
> Deposit payment required before production can continue.

**Inline buttons**: `✅ Upload Deposit Slip` / `⏳ Not Yet`

Team records the deposit:

```txt
/deposit QTN-2026-001 5000
```

Or sends a deposit slip image (photo/document) after linking the order:

```txt
/link QTN-2026-001
```
*(then send the deposit slip image)*

Stage moves to `deposit_verification` after deposit is recorded.

### 6b. Deposit Verification

The **Collection Agent** monitors deposit verification (runs every 60 min).

**Inline buttons**: `🔍 Verify Deposit`

- **Verify Deposit** → Bot marks deposit as verified, stage advances to `en_route` (or next appropriate stage).

## 7. Balance Payment (Before Delivery)

### 7a. Balance Due

Before delivery can be scheduled, the remaining balance must be paid.

Built-in reminder scheduler sends daily message with inline buttons:

> ⏰ *Reminder* — *QTN-2026-001* (Client Name)
> Stage: ⚖️ Balance Due
> The remaining balance is due before delivery can proceed.

**Inline buttons**: `✅ Yes, Client Paid` / `❌ Not Yet`

- **Yes, Client Paid** → Bot asks for a photo of the deposit slip or proof of payment. The AI (Gemini Vision) scans the image to extract the amount and date. If successful, the balance is auto-recorded via `/pay-balance` API and the stage advances to `balance_verification`. If the AI cannot extract the amount, the user is prompted to enter the amount manually.
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

### 7b. Balance Verification

The **Collection Agent** monitors balance verification.

**Inline buttons**: `🔍 Verify Balance`

- **Verify Balance** → Bot marks balance as verified, stage advances to `delivery_pending`.

## 8. Delivery

### 8a. Delivery Pending

After balance is verified, the **Delivery Agent** takes over.

Stage moves to `delivery_scheduled` when a delivery date is set.

### 8b. Schedule Delivery

Team replies with delivery date:

```txt
/deliverydate QTN-2026-001 May 22 2026
```

The bot first checks if the balance has been paid. If not, it blocks delivery scheduling and shows the lacking amount.

Stage moves to `delivery_scheduled`. A new daily reminder starts for the delivery team.

### 8c. Delivery Scheduled

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

## 9. Collection

### 9a. Delivered / Countered

Built-in reminder scheduler sends daily message with inline buttons:

**Inline buttons**: `💵 Record Payment`

- **Record Payment** → Bot asks for payment amount, stage advances to `payment_received`.

### 9b. Payment Received

**Inline buttons**: `✅ Confirm Payment` / `⏳ Still Pending`

- **Confirm Payment** → Stage advances to `payment_confirmed` → `completed`. All reminders are disabled.
- **Still Pending** → Bot acknowledges, continues daily reminders.

Team can also update payment status manually:

```txt
/payment QTN-2026-001 confirmed
```

Stage moves to `payment_confirmed` → `completed`. All reminders are disabled.

### 9c. Payment Confirmed / Completed

Order is fully complete. All reminders are disabled.

## Inline Keyboard Summary

| Stage | Inline Buttons | Action on Yes | Action on No |
|-------|---------------|---------------|--------------|
| `purchasing_pending` | ✅ Yes, started / ⚠️ Partial / ⏳ Not yet | Ask production days | Acknowledge |
| `production_confirmed` (midpoint) | ✅ On Time / ⚠️ Delayed | Continue reminders | Ask delay days |
| `production_confirmed` (due) | ✅ Finished / ❌ Not Yet | Ask delivery timeline | Acknowledge |
| `en_route` (item level) | ✅ Yes / ❌ No / 📦 Arrived | Mark item arrived | Acknowledge |
| `inventory_verification` | 🔍 Verify All / ⚠️ Partial / ⏳ Not Yet | Advance to `inventory_arrived` | Acknowledge |
| `inventory_arrived` | ✅ Ready for Delivery / ⏳ Still Waiting | Advance to `balance_due` | Acknowledge |
| `deposit_pending` | ✅ Upload Deposit Slip / ⏳ Not Yet | Record deposit | Acknowledge |
| `deposit_verification` | 🔍 Verify Deposit | Mark deposit verified | — |
| `balance_due` | ✅ Yes, Client Paid / ❌ Not Yet | Ask proof photo → AI extract → advance to `balance_verification` | Acknowledge |
| `balance_verification` | 🔍 Verify Balance | Mark balance verified | — |
| `delivery_scheduled` | ✅ Yes, Delivered / ❌ Not Yet | Advance to `delivered` | Acknowledge |
| `delivered` / `countered` | 💵 Record Payment | Ask payment amount → advance to `payment_received` | — |
| `payment_received` | ✅ Confirm Payment / ⏳ Still Pending | Advance to `payment_confirmed` → `completed` | Acknowledge |

## Agent System

The system uses automated agents that run on schedules to check orders and send reminders:

| Agent | Schedule | Stages Monitored |
|-------|----------|-----------------|
| **Quotation Checker** | Every 5 min | `order_confirmation_received` |
| **Purchasing Agent** | Every 60 min | `math_verified`, `purchasing_pending`, `production_pending` |
| **Production Agent** | Every 60 min | `production_confirmed`, `en_route` |
| **Inventory Agent** | Every 60 min | `inventory_verification`, `inventory_arrived` |
| **Collection Agent** | Every 60 min | `deposit_pending`, `deposit_verification`, `balance_due`, `balance_verification`, `delivered`, `countered`, `payment_received`, `payment_confirmed` |
| **Delivery Agent** | Every 60 min | `inventory_arrived`, `balance_due`, `delivery_pending`, `delivery_scheduled`, `delivered` |
| **Escalation Agent** | Every 4 hours | All non-terminal stages |

### Agent Triggers

When an order enters a stage, the corresponding agent(s) are triggered immediately:

| Stage | Triggered Agent(s) |
|-------|-------------------|
| `order_confirmation_received` | Quotation Checker |
| `math_verified` | Purchasing Agent |
| `purchasing_pending` | Purchasing Agent |
| `production_pending` | Purchasing Agent |
| `production_confirmed` | Production Agent |
| `en_route` | Production Agent, Inventory Agent |
| `inventory_verification` | Inventory Agent |
| `inventory_arrived` | Inventory Agent |
| `balance_due` | Collection Agent, Delivery Agent |
| `deposit_pending` | Collection Agent |
| `deposit_verification` | Collection Agent |
| `balance_verification` | Collection Agent |
| `delivery_pending` | Delivery Agent |
| `delivery_scheduled` | Delivery Agent |
| `delivered` | Collection Agent |
| `countered` | Collection Agent |
| `payment_received` | Collection Agent |
| `payment_confirmed` | Collection Agent |
| `completed` | Collection Agent |

## Reminder Escalation

If a stage is not updated after multiple reminders, the scheduler auto-escalates:

| Reminder # | Escalation Level | Message |
|-----------|-----------------|---------|
| 1st | Level 0 | Normal reminder |
| 2nd | Level 1 | 🔴 Slight urgency |
| 3rd | Level 2 | 🔴🔴 Higher urgency |
| 4th+ | Level 3+ | 🔴🔴🔴 Critical |

At Level 3+, the agent sends a "Manager intervention required" message.

## Automation Summary

| Component | Role |
|-----------|------|
| **Telegram Bot** | Order updates via commands, inline keyboards, file uploads, AI vision extraction |
| **API Server** | Business logic, database, reminder scheduler, agent system |
| **Google Drive** | File storage per order |
| **Dashboard** | Real-time order tracking (port 3000) |
| **Agent Scheduler** | Built-in, runs every 60s, triggers agents on their schedules |
| **Reminder Scheduler** | Built-in, runs every 60s, sends daily reminders for stalled stages |
| **Quotation Checker Agent** | Verifies math on new orders every 5 min |
| **Purchasing Agent** | Monitors purchasing/production handoff every 60 min |
| **Production Agent** | Tracks production progress and en-route status every 60 min |
| **Inventory Agent** | Monitors inventory verification and arrival every 60 min |
| **Collection Agent** | Monitors deposit, balance, and payment collection every 60 min |
| **Delivery Agent** | Monitors delivery scheduling and completion every 60 min |
| **Escalation Agent** | Detects stalled orders and escalates every 4 hours |
| **n8n (optional)** | Visual workflow editor if needed |
