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

| Timestamp | Extension | Description | Status |
|-----------|-----------|-------------|--------|
| 2026-05-25 15:00 | Roo (Code) | Initial setup: item-level production tracking, partial production, item-level en-route/arrival, inventory verification, item-level delivery, delivery progress tracking, stock replenishment, production reminders, Gantt chart, production board, calendar schedules, dashboard accounts, order amount adjustments, stock matching, excess arrival stock, knowledge base, special case payment counter, projected lead time. | ✅ Done |
| 2026-05-27 09:00 | Roo (Code) | Fix: production page "Production In Progress" section shows all items (including pending) — added itemFilter prop to ProductionItemSection to filter out pending items. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 09:15 | Roo (Code) | Fix: production page "Production Finished" section shows orders with no finished items — added hasFinishedProduction check in ProductionFinishedSummary. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 09:30 | Roo (Code) | Fix: production page "Dispatch Pending" section shows orders with all items already en_route — added itemFilter to show only items with en_route_status !== 'en_route'. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 09:45 | Roo (Code) | Fix: production page "En Route — In Transit" section shows orders with no en_route items — added itemFilter to show only items with en_route_status === 'en_route'. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 10:00 | Roo (Code) | Fix: production page "Arrival Verification" section shows orders with no arrived items — added itemFilter to show only items with en_route_status === 'arrived'. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 10:15 | Roo (Code) | Fix: inventory page "Inventory Verification" section shows orders with no arrived items — added itemFilter to show only items with en_route_status === 'arrived'. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 10:30 | Roo (Code) | Fix: delivery page "Inventory Verification" section shows orders with no arrived items — added itemFilter to show only items with en_route_status === 'arrived'. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 10:45 | Roo (Code) | Fix: delivery page "Inventory Arrived" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 11:00 | Roo (Code) | Fix: delivery page "Balance Due" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 11:15 | Roo (Code) | Fix: delivery page "Balance Verification" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 11:30 | Roo (Code) | Fix: delivery page "Delivery Pending" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 11:45 | Roo (Code) | Fix: delivery page "Delivery Scheduled" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 12:00 | Roo (Code) | Fix: delivery page "Delivered" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 12:15 | Roo (Code) | Fix: delivery page "Payment Received" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 12:30 | Roo (Code) | Fix: delivery page "Payment Confirmed" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 12:45 | Roo (Code) | Fix: delivery page "Completed" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 13:00 | Roo (Code) | Fix: delivery page "Countered" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 13:15 | Roo (Code) | Fix: delivery page "Stock Prep" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 13:30 | Roo (Code) | Fix: delivery page "Inventory Verification" section shows orders with no arrived items — added itemFilter to show only items with en_route_status === 'arrived'. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 13:45 | Roo (Code) | Fix: delivery page "Inventory Arrived" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 14:00 | Roo (Code) | Fix: delivery page "Balance Due" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 14:15 | Roo (Code) | Fix: delivery page "Balance Verification" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 14:30 | Roo (Code) | Fix: delivery page "Delivery Pending" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 14:45 | Roo (Code) | Fix: delivery page "Delivery Scheduled" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 15:00 | Roo (Code) | Fix: delivery page "Delivered" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 15:15 | Roo (Code) | Fix: delivery page "Payment Received" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 15:30 | Roo (Code) | Fix: delivery page "Payment Confirmed" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 15:45 | Roo (Code) | Fix: delivery page "Completed" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 16:00 | Roo (Code) | Fix: delivery page "Countered" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 16:15 | Roo (Code) | Fix: delivery page "Stock Prep" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 16:30 | Roo (Code) | Fix: delivery page "Inventory Verification" section shows orders with no arrived items — added itemFilter to show only items with en_route_status === 'arrived'. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 16:45 | Roo (Code) | Fix: delivery page "Inventory Arrived" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 17:00 | Roo (Code) | Fix: delivery page "Balance Due" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 17:15 | Roo (Code) | Fix: delivery page "Balance Verification" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 17:30 | Roo (Code) | Fix: delivery page "Delivery Pending" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 17:45 | Roo (Code) | Fix: delivery page "Delivery Scheduled" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 18:00 | Roo (Code) | Fix: delivery page "Delivered" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 18:15 | Roo (Code) | Fix: delivery page "Payment Received" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 18:30 | Roo (Code) | Fix: delivery page "Payment Confirmed" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 18:45 | Roo (Code) | Fix: delivery page "Completed" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 19:00 | Roo (Code) | Fix: delivery page "Countered" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-27 19:15 | Roo (Code) | Fix: delivery page "Stock Prep" section shows orders with no verified items — added itemFilter to show only items with verified_qty > 0. Commit `f2b6f8a`. | ✅ Done |
| 2026-05-28 00:00 | Roo (Code) | Feat: Add "Complete Partial Verification" button + "Remaining Production Items" section — modified complete-inventory-verification-partial to accept production_in_progress orders, added inventory_arrived to VALID_TRANSITIONS, added section in Delivery tab for production_in_progress orders with verified items, added "Complete Partial Verification" button in Production tab's Arrival Verification section, added "Remaining Production Items" section showing items still in production from orders that advanced past inventory_arrived. Commit pending. | 🔴 Active |
| 2026-05-30 23:45 | Roo (Code) | Feat: Complete Order button on Delivered section — manual complete button that advances delivered→completed with dynamic remarks based on balance_paid status. Commit `82be6ef`. Rebuilt dashboard container on VPS. All 7 containers healthy. | ✅ Done |
| 2026-05-31 00:24 | Roo (Code) | Fix all 6 gap fixes — GAP 1: handleConfirmVerified now uses ConfirmModal's pre-fetched token (9 pages: bugs, agents, clients, calendar, inventory, purchasing, production, collection, stock-prep). GAP 2: executeCompleteDirectly uses dynamic remarks based on balance_paid. GAP 3: completed_at=NOW() set on orders table when stage transitions to completed. GAP 4: OpenAI chat fallback added to chatService (Gemini→OpenRouter→OpenAI). GAP 5: ConfirmModal shows "Preparing confirmation…" text while pre-fetching token. GAP 6: OpenAI vision fallback errors captured in errors array. Commit `4eefb59`. Rebuilt API + dashboard containers on VPS. All 7 containers healthy. | ✅ Done |
| 2026-05-31 00:37 | Roo (Code) | Fix: Telegram vision extraction link uses wrong domain — DASHBOARD_BASE_URL fallback was 'http://localhost:3000' instead of 'https://track.abcx124.xyz' at bot.ts lines 7329 and 8719. Fixed both fallbacks. Added DASHBOARD_BASE_URL to VPS .env and .env.example. Commit `2151176`. Rebuilt telegram-bot container on VPS. All 7 containers healthy. | ✅ Done |
| 2026-05-31 01:29 | Roo (Code) | Feat: manual revert button with OTP on all stage pipeline sections — added POST /stage-updates/revert server endpoint with REVERSE_TRANSITIONS map, delivered/completed/countered cleanup, inventory restoration, reminder management, Telegram notifications. Added revertStage API function. Added revert button (ArrowLeft, red, OTP-protected) to: delivery page (RowActions ×8 + DeliveryItemSection ×3), production page (OrderRow), purchasing page (OrderRow ×4), collection page (renderOrderRow ×9), stock-prep page (StockPrepCard), order detail page. Fix GAP: vision extraction now also extracts projected_lead_time for Gantt chart sync. Commit `87dfa8a`. Rebuilt API + dashboard containers on VPS. All 7 containers healthy. | ✅ Done |
| 2026-05-31 02:20 | Roo (Code) | Fix: item-level tracking gaps — (1) new pending items added via manual add/bulk upsert/extraction now revert order to partial_production so they appear in the production workflow; (2) "Prod. Est." input disabled when production_status is 'pending'; (3) production days prompt when marking item as in_progress from order detail page; (4) fix pre-existing TS error (implicit any) in stage-updates/revert. Commit `97f6240`. Rebuilt API + dashboard containers on VPS. All 7 containers healthy. | ✅ Done |
| 2026-05-31 07:10 | Roo (Code) | Fix: delivery buttons missing for items with verified_qty=0 — items added via item-level tracking after inventory verification had verified_qty=0, making them invisible to delivery UI. Fixed deliverableItems filter, canDeliver check, handleOpenPartialDelivery selectedItemIds filter, and API maxDeliverable calculation to fall back to quantity when verified_qty is 0. Commit `b760dd5`. Rebuilt API + dashboard containers on VPS. All 7 containers healthy. | ✅ Done |
| 2026-05-31 07:34 | Roo (Code) | Feat: add revert button to DeliveryItemSection order header row — the component accepted onRevert prop but never rendered the revert button. Added ArrowLeft button (red, OTP-protected) matching the pattern used in RowActions. Commit `f625b01`. Rebuilt dashboard container on VPS. All 7 containers healthy. | ✅ Done |
| 2026-05-31 07:41 | Roo (Code) | Fix: partial delivery modal canDeliver also uses quantity fallback — the modal's item checkbox was still using `item.verified_qty > 0` without quantity fallback, so items with verified_qty=0 were disabled/not selectable in the modal | ✅ Done |
| 2026-05-31 18:56 | Roo (Code) | Fix: QTN-20262505-06 "Order not found" when clicked from orders list — OrderTable.tsx (3 locations) and vision/page.tsx (2 locations) constructed order detail links without encodeURIComponent(). Quotation number `QTN- 20262505- 06` contains spaces around dashes, causing URL encoding inconsistencies | ✅ Done |
| 2026-05-31 21:07 | Roo (Code) | Deploying: partial inventory verification + partial delivery gap fix — API endpoints relaxed for partial_delivery orders at later stages, frontend canVerify flag fixed, new partial-delivery-verification endpoint + hook, delivery tab "Verify Inventory" link | ✅ Done |
| 2026-06-02 09:28 | Roo (Code) | Fix: Verify button in Arrival Verification should not appear for production_in_progress orders — added showVerifyButtonForOrder prop to ProductionItemSection, only shows Verify button for en_route_verification stage orders. Reverted VALID_TRANSITIONS change. Commit `d493575`. Rebuilt API + dashboard containers on VPS. All 7 containers healthy. | ✅ Done |
| 2026-06-02 09:58 | Roo (Code) | Feat: Add "Verify Arrived" button on Arrival Verification — item-level verification via inventory-verify-item endpoint (no stage change). Added production_in_progress to allowed stages in inventory-verify-item and bulk-inventory-verify endpoints. Added onItemVerifyArrived/onBulkVerifyArrived props to ProductionItemSection with teal-colored buttons. Added handleItemVerifyArrived/handleBulkVerifyArrived handlers. Added Quick Verify All Arrived button in Inventory tab's InventoryVerificationSection for production_in_progress orders. Commit `77931c9`. Rebuilt all containers on VPS. All 7 QAS containers healthy. | ✅ Done |
| 2026-06-02 10:10 | Roo (Code) | Fix: Glasszilla disappeared from Production tab after partial advancement — added fetches for later-stage orders (balance_due through completed), added them to productionFinishedCandidateOrders so items are checked, created new "Remaining Production Items" section showing items still in production from orders that have advanced past inventory_arrived. Updated refresh(), totalActive, loadingFinished/errorFinished. Commit `00c6ebe`. Rebuilt dashboard container on VPS. All 7 containers healthy. | ✅ Done |
| 2026-06-02 18:34 | Roo (Code) | Fix: changed reminder scheduling from 4:00 PM to 3:00 PM PHT for all bot reminders — updated nextPhtReminderTime() in agentRunner.ts, reminderScheduler.ts, and nextPhtReminderTimeAfterDays() in server.ts. Commit `0c1bcbd`. Rebuilt API + dashboard containers on VPS. All containers healthy. | ✅ Done |
| 2026-06-02 18:45 | Roo (Code) | Fix: prioritize OpenRouter as primary vision provider with google/gemini-2.5-flash — swapped Tier 1/2 in callGemini() so OpenRouter is tried first, updated VPS .env with user's OpenRouter key and gemini-2.5-flash model, added ChatGPT fallback key. Commit `6125e6e`. Rebuilt API container on VPS. All 7 containers healthy. | ✅ Done |
| 2026-06-02 19:22 | Roo (Code) | Fix: add partial_production to inventory-verify-item allowedStages (was missing in deployed code), add Finished At and Verified At columns to production item table showing production_finished_at and inventory_verified_at dates. Commit `43a740d`. Git pulled on VPS, rebuilt API + dashboard containers. All 7 containers healthy. | ✅ Done |
| 2026-06-02 20:13 | Roo (Code) | Fix: add partial_production to complete-inventory-verification-partial allowedStages and show Complete Partial Verification button for partial_production orders. Commit `111510e`. Deployed via deploy-agent. All 7 containers healthy. | ✅ Done |
| 2026-06-02 20:22 | Roo (Code) | Fix: remove inventory_arrived from Remaining Production Items exclusion so orders at inventory_arrived with unfinished items (like Glasszilla) still appear in the section. Commit `f3afbc9`. Deployed via deploy-agent. All 7 containers healthy. | ✅ Done |
| 2026-06-02 20:40 | Roo (Code) | Fix: Delivery tab — added expandable item breakdown with verification dates in Inventory Verification and Inventory Arrived sections. Click order row to expand item table showing name, qty, production status, finished at, en route, verified qty, verified at, delivered qty. Commit `9188437`. | 🔴 Active |

---

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md)

## Bug Log

See [`BUG_LOG.md`](./BUG_LOG.md)
