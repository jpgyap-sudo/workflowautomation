# Update Log

> Real-time log of what each coding extension is currently working on.
> All extensions (Roo, Claude, Codex, Kimi) should update this file when starting and completing work.

---

## How to use

When you **start** working:
```markdown
| YYYY-MM-DD HH:mm | Roo | Investigating: sales.homeu login cache issue | 🔴 Active |
```

When you **finish**:
```markdown
| YYYY-MM-DD HH:mm | Roo | Fixed: sales.homeu login cache issue — SW cache name bump + hard refresh | ✅ Done |
```

**Status**: `🔴 Active` / `✅ Done` / `⏸️ Blocked` / `🔄 In Progress`

---

## Current Status

| Timestamp | Extension | Task | Status |
|-----------|-----------|------|--------|
| 2026-05-25 08:10 | Roo (Code) | Feat: add Tab Access control in Settings → User Management + calendar tab action buttons (stage advance, create reminder, notify Telegram) | 🔴 Active |
| 2026-05-25 07:51 | Codex | Fix: E2E inventory verification API returned no verified_qty on permanent item record; validated builds and deployed routes | Done |
| 2026-05-25 07:51 | Roo (Code) | Feat: add requesting user name to escalation group verification code notifications + collections page manual buttons (countered→payment_received→payment_confirmed→completed) + purchasing page Mark Deposit Paid button + stage-to-group mappings | ✅ Done |
| 2026-05-25 07:39 | Codex | Fix: inventory verification permanent link Telegram completion details and item update notification | Done |
| 2026-05-24 20:10 | Roo (Code) | Deploy: Codex features — inventory accountability, item production dates, early inventory verification, production finished tracking | ✅ Done |
| 2026-05-24 20:32 | Roo (Code) | Feat: replace Production Finished Actions column with notes input — users can add/view notes per order | ✅ Done |
| 2026-05-25 07:42 | Roo (Code) | Feat: add all delivery tab manual button gaps — Balance Verification, Payment Received, Payment Confirmed sections + skip-payment buttons + OTP handlers + Telegram notifications | ✅ Done |
| 2026-05-24 19:58 | Codex | Update: item-level inventory verification with arrival dates and inventory/delivery accountability | ✅ Done |
| 2026-05-24 19:30 | Codex | Update: add manual Proceed to Inventory Verification action for early arrivals | Done |
| 2026-05-24 19:10 | Codex | Update: add per-item production finished date to Production Finished expandable item list | Done |
| 2026-05-24 19:04 | Codex | Update: Production Finished orders are expandable and show per-item estimated inventory arrival dates | Done |
| 2026-05-24 18:44 | Codex | Update: Production Finished section tracks any order with at least one finished item until inventory arrival verification, with estimated inventory arrival date | Done |
| 2026-05-24 18:00 | Codex | Update: make item production Telegram reminders context-aware with Started vs Finished/On Time/Delayed flow | Done |
| 2026-05-24 17:44 | Codex | Fix: auto-finish production when all partial-production items are finished and trigger en-route Telegram workflow | Done |
| 2026-05-24 15:35 | Codex | Fix: include payment verification fields in orders list API for dashboard sync | Done |
| 2026-05-24 15:10 | Codex | Update: add balance payment date and payment verification columns to order tables | Done |
| 2026-05-24 14:30 | Codex | Fix: split production workflow acknowledgement from actual production start in dashboard and Telegram | Done |
| 2026-05-24 12:45 | Codex | Fix: restore En Route Verification in stage pipeline tab after `ada6e80` regression | Done |
| 2026-05-24 12:18 | Codex | Fix: restore VPS API container to resolve dashboard OTP 502 Bad Gateway | ? Done |
| 2026-05-24 12:01 | Codex | Audit/fix: inventory/delivery workflow tabs and Telegram reminder item sync gaps | ? Done |
| 2026-05-24 11:37 | Codex | Test: validate cross-extension logging files and `.clinerules` references | ? Done |
| 2026-05-24 11:29 | Roo (Code) | Verified all services deployed at `ada6e80`, created changelog/bug/update log system | ✅ Done |
| 2026-05-24 11:58 | Roo (Code) | Deploy: 2 pending commits — en_route_verification stage + bot fix | ✅ Done |
| 2026-05-24 14:19 | Roo (Code) | Fix: deposit sync failure — removed mandatory action_token requirement from POST /deposits, added OTP modals to all deposit flows, fixed recordDepositWithFile() to pass action_token | ✅ Done |
| 2026-05-24 14:39 | Roo (Code) | Fix: auto-detect deposit slip when photo sent to collection group chat — no button clicks required | ✅ Done |
| 2026-05-24 14:44 | Roo (Code) | Fix: add client_name and actor_name to stage_updates table for traceability | ✅ Done |
| 2026-05-24 15:31 | Roo (Code) | Fix: add manual stage advancement buttons on order detail page + manual production status editing on purchasing page — Telegram-independent dashboard progression | ✅ Done |
| 2026-05-24 15:39 | Roo (Code) | Deploy: gap fixes — en_route_verification/inventory/balance/delivery reminder creation, stageToGroup map, manual production status on purchasing page, stage advancement on order detail page | ✅ Done |

---

## History

| Timestamp | Extension | Task | Status |
|-----------|-----------|------|--------|
| 2026-05-24 11:22 | Roo (Code) | Deploy: git pull + rebuild all services on VPS | ✅ Done |
| 2026-05-24 11:20 | Roo (Code) | Fix: VPS divergent branch — reset to origin/master | ✅ Done |
| 2026-05-24 11:15 | Roo (Code) | Check: git status clean, VPS behind by 5 commits | ✅ Done |
| 2026-05-23 23:44 | Roo (Code) | Fix: sales.homeu "Invalid email address" — SW cache name bump to v3 | ✅ Done |
| 2026-05-23 23:30 | Roo (Code) | Fix: sales.homeu sub-users not showing — merge subUsers in getStoredAccounts() | ✅ Done |
| 2026-05-23 22:00 | Roo (Code) | Deploy: sub-user login flow + all pending changes | ✅ Done |
| 2026-05-23 21:00 | Roo (Code) | Fix: Docker stale image references — down --remove-orphans then rebuild | ✅ Done |
| 2026-05-22 | Roo (Code) | Feat: sub-user login flow for shared accounts | ✅ Done |
| 2026-05-22 | Roo (Code) | Feat: 888 passcode guard for Telegram bot GUI actions | ✅ Done |
| 2026-05-22 | Roo (Code) | Feat: role-based route guard in AuthGuard | ✅ Done |
| 2026-05-21 | Roo (Code) | Feat: production tracking lifecycle (midpoint, due, delivery timeline) | ✅ Done |
| 2026-05-21 | Roo (Code) | Feat: Hermes Claw (Gemini API) integration for production agent | ✅ Done |
| 2026-05-21 | Roo (Code) | Feat: OTP gate for all dashboard edits/deletes | ✅ Done |
| 2026-05-21 | Roo (Code) | Feat: agent notes system with API + dashboard UI | ✅ Done |
| 2026-05-21 | Roo (Code) | Feat: Telegram UX overhaul — inline buttons, smart order picker, PHT reminders | ✅ Done |
| 2026-05-21 | Roo (Code) | Security: remove all hardcoded credentials from public files | ✅ Done |
| 2026-05-20 | Roo (Code) | Feat: clients page with address/contact propagation, order history | ✅ Done |
| 2026-05-20 | Roo (Code) | Feat: inventory overhaul — category/type, en route tracking | ✅ Done |
| 2026-05-20 | Roo (Code) | Feat: delivery gap fixes + delivery_date column | ✅ Done |
| 2026-05-20 | Roo (Code) | Feat: collection tab overhaul — For Payment Before Delivery, delivery exception | ✅ Done |
| 2026-05-20 | Roo (Code) | Feat: Google Drive upload with retry + token refresh | ✅ Done |
| 2026-05-20 | Roo (Code) | Fix: Telegram bot 409/429 on restart — close + retry logic | ✅ Done |
| 2026-05-20 | Roo (Code) | Fix: Dashboard Docker OOM — use npm install instead of npm ci | ✅ Done |
