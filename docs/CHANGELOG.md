# Changelog

> Unified commit & deployment log for all coding extensions working on this project.
> Each entry records: **commit hash**, **date**, **authoring extension**, **description**, and **deployment status**.

---

## 2026-05-26

| Commit | Extension | Description | Deployed |
|--------|-----------|-------------|----------|
| `0fc0c87` | Roo (Code) | feat: contribute 5 lessons to SuperRoo Central Brain learning layer + local memory/lessons-learned.md | ❌ |
| `8c9a531` | Roo (Code) | fix: remove Finish button from Production Pending section — add production_pending stage guard to ProductionInfoCards and OrderRow | ❌ |
| `7576af0` | Roo (Code) | fix: remove Production Confirmed section from production page — redundant with Production In Progress section | ❌ |
| `c7c9287` | Roo (Code) | feat: add item-level Start button inside ProductionInfoCards for Production Pending items — prompts for production days via window.prompt, saves estimated_production_days, then triggers OTP for production_status change | ❌ |
| `8b041c9` | Roo (Code) | fix: item-level Start also sets production_started on order for agent reminders; remove unused imports and variable | ❌ |

## 2026-05-25

| Commit | Extension | Description | Deployed |
|--------|-----------|-------------|----------|
| `ed3d58d` | Roo (Code) | fix: Add OTP verification for item-level tracking edits (save edit, production status, en route status, manual item creation) + Telegram notifications for item tracking edits and manual item creation. Syncing gap found: quotation edit (PATCH /orders/:id) already had OTP + Telegram notification — no gap. | ✅ VPS `ed3d58d` |
| `4054a11` | Codex | feat: Acknowledgement Receipts section on Collection page — new AcknowledgementReceiptsSection component with full table (receipt #, order #, client, payment type, amount, date, status, Download PDF button). Integrated refresh calls after every payment action. | ✅ VPS `4054a11` |
| `4779f5a` | Roo (Code) | fix: 3 E2E gaps in Matching Verification — (1) stock-ready endpoint now uses matched_inventory_item_id before name fallback, (2) MatchingVerificationSection filters to from-stock orders only, (3) handleConfirmMatch calls onUpdated() to refresh parent, (4) loadedOrderIds guard prevents re-fetch on every render cycle | ✅ VPS `4779f5a` |
| `5f97856` | Roo (Code) | feat: Matching Verification — new section on Stock Prep page for from-stock orders. Auto-suggests nearest inventory match per order item via local fuzzy matching algorithm. Manual search with search tabs. One-click confirm. Visual stock indicator. New API endpoints: GET /inventory/search, POST /inventory/match, PATCH /orders/:order_id/items/:item_id/match-inventory. Migration 039 adds matched_inventory_item_id + inventory_match_verified to order_items. | ✅ VPS `5f97856` |
| `ed3dc55` | Roo (Code) | fix: order detail page React hooks violation — useEffect after conditional return caused "This page couldn't load" error. Moved useEffect before conditional returns with null guard. | ✅ VPS `ed3dc55` |
| `e334c67` | Roo (Code) | feat: Bulk Delete Clients — POST /clients/bulk-delete API endpoint with force-unlink support, bulkDeleteClients() API function, and full dashboard UI with checkboxes, select-all, force-delete confirmation, and OTP verification | ✅ VPS `e334c67` |
| `963018d` | Roo (Code) | feat: remove auto-advance to production_finished, add production_in_progress stage — all items start → production_in_progress (not production_confirmed). Production finished is manual only. New section on production page. | ✅ VPS `963018d` |
| `65a8b31` | Roo (Code) | feat: redesign Partial Production and Production In Progress sections — Partial Production shows only pending items with Start button + "Pending Production" status badge; Production In Progress shows only started/finished items with Finish/Delayed buttons + "Production Started" status badge. Same order# can appear in both sections. Per-item Start Production modal with production days input and estimated finish date column. | ✅ VPS `65a8b31` |
| `897bc02` | Claude Sonnet 4.6 | fix: 8 E2E balance flow gaps — optional proof photo in bot paybalance, paybalance:skip action, preserve image on vision fallback, fix verify:balance + verify:deposit regex (strip 8-char orderId prefix), balance_verification stale check now includes current_stage | ✅ VPS `59cc9bd` |
| `d94c009` | Claude Sonnet 4.6 | feat: support multiple deposit slips in New Order modal — dynamic slip list with per-slip file upload, AI extraction, amount, and date; loops recordDepositWithFile for each valid entry on submit | ✅ VPS `420cca9` |
| `b97193c` | Roo (Code) | feat: add Tab Access control in Settings → User Management (Lock button + 21-tab toggle modal) + calendar tab action buttons (13 stage-advance transitions, create reminder, notify Telegram) + POST /telegram/notify API endpoint | ✅ VPS `b97193c` |
| `339c22b` | Roo (Code) | feat: add Schedule Group Chat — calendar_schedules table (migration 035), CRUD API endpoints, schedule events in calendar aggregation, schedule group chat handler with AI parsing (/agents/run/schedule-parser via Gemini 2.0 Flash), AI Vision for image→schedule/note extraction, schedule reminder scheduler, schedule API functions in dashboard, schedule type in calendar legend | ✅ VPS `339c22b` |
| `647441a`–`111511c` | Claude Sonnet 4.6 | feat: stock replenishment order type — new `order_type` DB column, `POST /orders/stock-replenishment` endpoint (AI extraction from CSV/PDF/image), dashboard modal on Production page, `inventory_arrived` → `completed` path for replenishment orders | ✅ VPS `a865dae` |
| `45a144b` | Roo (Code) | feat: add all delivery tab manual button gaps — Balance Verification, Payment Received, Payment Confirmed sections + skip-payment buttons + OTP handlers + Telegram notifications | ✅ VPS `45a144b` |
| `2a15dcf` | Codex | fix: send permanent inventory verification link and verified item quantities in Telegram completion notifications | ? VPS `2a15dcf` |
| `4dbf72a` | Roo (Code) | feat: add requesting user name to escalation group verification code notifications + collections page manual buttons (countered→payment_received→payment_confirmed→completed) + purchasing page Mark Deposit Paid button + stage-to-group mappings (deposit_pending, deposit_verification, purchasing_pending) | ✅ VPS `4dbf72a` |
| `786087a` | Roo (Code) | fix: resolve 8 E2E gaps in schedule group chat feature (wrong API endpoint for schedule:reminder, fake action_token in PATCH, OpenRouter fallback for schedule-parser, lost extractedText in vision flows, schedule management UI on dashboard, docker-compose env vars) | ✅ VPS `786087a` |
| `957807c` | Roo (Code) | feat: add schedule dots to calendar grid cells (small squares with schedule color, between note dots and event dots) | ✅ VPS `957807c` |
| `420cca9` | Roo (Code) | fix: rename GET /calendar/schedules/:date → /calendar/schedules/by-date/:date to resolve Fastify duplicate-route crash | ✅ VPS `420cca9` |
| `1714399` | Roo (Code) | fix: delivery tab Record Payment — remove redundant recordStageUpdate() call that reused consumed action_token (payBalance already advances stage) | ✅ VPS `1714399` |
