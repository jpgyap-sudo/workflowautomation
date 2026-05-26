ma# Update Log

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
| 2026-05-26 13:08 | Roo (Code) | Fix: Bulk Start Production bug — API sets `current_stage = 'production_confirmed'` but Production Confirmed section was removed. Changed to `production_in_progress` in setProduction, report-production-status, production board, item update auto-advance, stage transition map, AGENT_TRIGGER_MAP, and productionAgent.ts (6 locations). Commit 3bf26c4 pushed to GitHub. Deployed to VPS via public IP SSH. | ✅ Done |
| 2026-05-26 08:07 | Roo (Code) | Learning Layer: Checked all existing lessons (10710 lines, ~40+ lessons in memory/lessons-learned.md, 3 in Central Brain). Contributed 5 new lessons to SuperRoo Central Brain + local memory/lessons-learned.md: (1) OTP callback wiring pattern for nested React components, (2) Tailscale SSH recovery — tailscale up --reset, (3) MCP stdio server JSON-RPC communication, (4) SSH command construction bug — space before @, (5) Production tab gap analysis — 7 security/UX gaps. All stored locally (Brain v2 API offline). | ✅ Done |
| 2026-05-26 08:52 | Roo (Code) | Fix: Remove Finish button from Production Pending section — added `order.current_stage !== 'production_pending'` guard to ProductionInfoCards (item-level Finished status button) and OrderRow (order-level Finish Production button). Commit 8c9a531 pushed to GitHub. | ✅ Done |
| 2026-05-26 17:47 | Roo (Code) | Fix clients tab gaps: (1) Linked orders in expanded row now clickable (Link to order detail page), (2) Client autocomplete in NewOrderModal, (3) Client filter in production/delivery/collection/purchasing tabs. Build compiles successfully. | 🔴 Active |
| 2026-05-26 10:08 | Roo (Code) | Fix: Remove Production Confirmed section from production page — redundant with Production In Progress section. Commit 7576af0 pushed to GitHub. | ✅ Done |
| 2026-05-26 10:12 | Roo (Code) | Feat: Add item-level Start button inside ProductionInfoCards for Production Pending items — each item now shows a "▶ Start" button that prompts for production days via window.prompt, saves estimated_production_days, then triggers OTP for production_status change. Commit c7c9287 pushed to GitHub. | ✅ Done |
| 2026-05-26 09:19 | Roo (Code) | Fix: Remove Production Confirmed section from production page — redundant with Production In Progress section. Removed OrderSection block and inProgressOrders variable. | ✅ Done |
| 2026-05-25 22:38 | Roo (Code) | Feat: Matching Verification — new section on Stock Prep page for from-stock orders. Auto-suggests nearest inventory match per order item via local fuzzy matching algorithm (no AI cost). Manual search with search tabs (All/By Name/By Description). One-click confirm. Visual stock indicator (green if sufficient, red if insufficient). New API endpoints: GET /inventory/search, POST /inventory/match, PATCH /orders/:order_id/items/:item_id/match-inventory. Migration 039 adds matched_inventory_item_id + inventory_match_verified to order_items. | ✅ Done |
| 2026-05-25 23:03 | Roo (Code) | E2E test: found 4 gaps in Matching Verification feature — (1) stock-ready endpoint used name-based lookup instead of matched_inventory_item_id, (2) MatchingVerificationSection loaded all stock_preparation orders instead of only from-stock, (3) handleConfirmMatch didn't call onUpdated() to refresh parent, (4) useEffect re-fetched on every render cycle. Fixed all 4, committed as 4779f5a, rebuilt API + dashboard on VPS. All containers healthy. | ✅ Done |
| 2026-05-25 23:17 | Roo (Code) | Continue Codex work: Acknowledgement Receipts section on Collection page — new AcknowledgementReceiptsSection component with full table (receipt #, order #, client, payment type, amount, date, status, Download PDF button). Integrated refresh calls after every payment action. Built clean. | ✅ Done |
| 2026-05-25 23:36 | Roo (Code) | Fix: Add OTP verification for item-level tracking edits (save edit, production status, en route status, manual item creation) + Telegram notifications for item tracking edits and manual item creation. Syncing gap found: quotation edit (PATCH /orders/:id) already had OTP + Telegram notification — no gap. | ✅ Done |
| 2026-05-25 21:52 | Roo (Code) | Feat: redesign Partial Production and Production In Progress sections — Partial Production shows only pending items with Start button + "Pending Production" status badge; Production In Progress shows only started/finished items with Finish/Delayed buttons + "Production Started" status badge. Same order# can appear in both sections if it has mixed item statuses. Per-item Start Production modal with production days input and estimated finish date column. | ✅ Done |
| 2026-05-25 20:36 | Roo (Code) | Feat: Bulk Delete Clients — new POST /clients/bulk-delete API endpoint with force-unlink support, bulkDeleteClients() API function, and full dashboard UI with checkboxes, select-all, force-delete confirmation, and OTP verification | ✅ Done |
| | 2026-05-25 14:55 | Roo (Code) | Fix: order detail page React hooks violation — useEffect placed after conditional return caused "This page couldn't load" error. Moved useEffect before conditional returns with null guard. | ✅ Done |
| 2026-05-25 13:21 | Roo (Code) | Feat: add sub-user management UI in Settings → User Management — modal with add/edit/delete entry codes (code + name) for each account, persists via updateAccount() | ✅ Done |
| 2026-05-25 09:08 | Roo (Code) | Feat: add Schedule Group Chat — calendar_schedules table (migration 035), CRUD API endpoints, schedule events in calendar aggregation, schedule group chat handler with AI parsing (/agents/run/schedule-parser via Gemini 2.0 Flash), AI Vision for image→schedule/note extraction, schedule reminder scheduler, schedule API functions in dashboard, schedule type in calendar legend | ✅ Done |
| 2026-05-25 09:59 | Roo (Code) | Fix: E2E gap analysis — found 8 bugs (wrong API endpoint for schedule:reminder, fake action_token in PATCH, missing OpenRouter fallback for schedule-parser, lost extractedText in vision flows, no schedule management UI on dashboard, missing SCHEDULE_GROUP env vars in docker-compose). Fixed all 8, built clean, deployed to VPS. | ✅ Done |
| 2026-05-25 10:55 | Roo (Code) | Feat: add schedule dots to calendar grid cells (small squares with schedule color, positioned between note dots and event dots, up to 2 slots, overflow count includes schedules) | ✅ Done |
| 2026-05-25 11:08 | Roo (Code) | Fix: rebuild api container with by-date route fix (commit 420cca9) — old image had duplicate GET /calendar/schedules/:date route causing Fastify crash on startup | ✅ Done |
| 2026-05-25 11:26 | Roo (Code) | Fix: delivery tab Record Payment — removed redundant recordStageUpdate() call that reused consumed action_token (payBalance already advances stage). Commit 1714399 deployed to VPS. | ✅ Done |
| 2026-05-25 12:04 | Roo (Code) | Fix: delivery schedule OTP error — PATCH /orders/:id now records stage update internally when delivery_date is set, removing double-token consumption. Commit a9c538a deployed to VPS. | ✅ Done |
| 2026-05-25 12:14 | Roo (Code) | Crawl: systematic audit of all dashboard pages for double-token-consumption bug pattern — checked collection, delivery, purchasing, production, orders, orders/[quotationNumber], actions, calendar pages. Found no new bugs (2 already fixed). Minor fix: remove stale action_token from deposit calls in orders page handleVerified() since createOrder already consumed it. Commit 8e71212 deployed to VPS. | ✅ Done |
| 2026-05-25 12:58 | Roo (Code) | Audit: full inventory + collection group notification wiring audit — checked all server endpoints, Telegram bot handlers, reminder scheduler stages, dashboard pages, and agents. Found 2 minor gaps: (1) balance_proof file type didn't notify COLLECTION_CHAT_ID in server.ts, (2) bot.ts balance confirm handler used fileType 'deposit' instead of 'balance_proof'. Both fixed. | ✅ Done |
| 2026-05-25 09:04 | Codex | Fix: E2E build gaps ? recordDepositWithFile import, createOrder items typing, Telegram bug order state union | Done |
| 2026-05-25 08:12 | Codex | Feat: optional balance proof/deposit slip upload with AI extraction in Balance Due payment flow | Done |
| 2026-05-25 08:10 | Roo (Code) | Feat: add Tab Access control in Settings → User Management + calendar tab action buttons (stage advance, create reminder, notify Telegram) | ✅ Done |
| 2026-05-25 07:51 | Codex | Fix: E2E inventory verification API returned no verified_qty on permanent item record; validated builds and deployed routes | Done |
| 2026-05-25 07:51 | Roo (Code) | Feat: add requesting user name to escalation group verification code notifications + collections page manual buttons (countered→payment_received→payment_confirmed→completed) + purchasing page Mark Deposit Paid button + stage-to-group mappings | ✅ Done |
| 2026-05-25 07:39 | Codex | Fix: inventory verification permanent link Telegram completion details and item update notification | Done |
| 2026-05-24 20:10 | Roo (Code) | Deploy: Codex features — inventory accountability, item production dates, early inventory verification, production finished tracking | ✅ Done |
| 2026-05-24 20:32 | Roo (Code) | Feat: replace Production Finished Actions column with notes input — users can add/view notes per order | ✅ Done |
| 2026-05-25 07:42 | Roo (Code) | Feat: add all delivery tab manual button gaps — Balance Verification, Payment Received, Payment Confirmed sections + skip-payment buttons + OTP handlers + Telegram notifications | ✅ Done |
| 2026-05-24 19:58 | Codex | Update: item-level inventory verification with arrival dates and inventory/delivery accountability | ✅ Done |
| 2026-05-24 19:30 | Codex | Update: add manual Proceed to Inventory Verification action for early arrivals | Done |
| 2026-05-26 16:44 | Roo (Code) | Feat: add deposit slip upload + AI extract modal to Balance Due section in Delivery page (replacing inline payment form). Fix: 401 error when marking selected items en route — new POST /orders/:id/bulk-en-route-selected endpoint. E2E health scan: all 7 containers healthy, API 200, Dashboard 200, DB+Redis connected. Commit 7e3a0c3 deployed to VPS. | ✅ Done |
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
| 2026-05-26 11:24 | Roo (Code) | E2E gap analysis: fix item-level Start to also set production_started on order for agent reminders; remove unused imports/variable | ✅ Done |
| 2026-05-26 11:27 | Roo (Code) | Deploy: git pull + docker compose up -d --build on VPS (commits 8b041c9, e6a0632) | ✅ Done |
| 2026-05-26 18:15 | Roo (Code) | Fix: remove separate Finish Production Pending section — add Finish Production button directly inside Production In Progress section header row | ✅ Done |
| 2026-05-26 20:42 | Roo (Code) | Fix: QTN Florence inventory arrival date not showing — order-level estimated_arrival_days was null for item-level tracking orders. Updated advanceToEnRouteIfAllDispatched to propagate item-level estimated_arrival_days to order level + backfilled QTN Florence data + flushed Redis cache | ✅ Done |
| 2026-05-26 23:56 | Roo (Code) | Fix: 401 error when marking selected items en route in Production Finished section — action token consumed on first item PATCH call, failed on subsequent items. Created new POST /orders/:id/bulk-en-route-selected endpoint + bulkEnRouteSelected() API function. Updated handleBulkEnRouteSelectedVerified to use single API call instead of Promise.all with individual updateOrderItem calls. | ✅ Done |
| 2026-05-27 01:03 | Roo (Code) | Fix: add delivery date to Telegram notification for delivery_scheduled stage updates — both persistent reminder and Stage Update message now show the scheduled delivery date | ✅ Done |
