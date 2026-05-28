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

| Date | Extension | Description | Status |
|------|-----------|-------------|--------|
| 2026-05-27 03:56 | Roo (Code) | Comprehensive gap analysis across all features — fixed stageToGroup (added production_in_progress, stock_preparation), VALID_TRANSITIONS (added stock_preparation), AGENT_TRIGGER_MAP (added collection-agent to stock_preparation), STAGE_ORDER (added partial_production, stock_preparation, removed duplicate), removed stale finish-production-pending endpoint, updated telegram page mappings, added missing inline keyboard handlers in reminderScheduler.ts for production_in_progress and stock_preparation | ✅ Done |
| 2026-05-27 09:28 | Roo (Code) | Fix: OTP error in verify all — Bug #1: verify-deposit now checks if balance is also paid (full payment) and advances to balance_verification instead of skipping past it. Bug #2: PATCH /payments/:id/verify now advances order stage when all payments verified. Bug #3: removed dead import of verifyPayment from order detail page. | ✅ Done |
| 2026-05-27 15:43 | Roo (Code) | Committed + deployed: guides page updates, package updates, memory files, new capture-screenshots script. All services rebuilt and restarted on VPS. | ✅ Done |
| 2026-05-27 16:11 | Roo (Code) | Delivery tab: made "₱X due" amount clickable — opens deposit slip upload + AI extraction modal (same as upload button). | ✅ Done |
| 2026-05-27 16:29 | Roo (Code) | Fix: acknowledgement receipt gap — balance payments now only get receipts after verification. Server: SQL filter excludes unverified balance payments from receipts list; PDF endpoint rejects unverified balance payments. Dashboard: unverified balance payments shown with "Pending Verification" badge and no download link. | ✅ Done |
| 2026-05-27 18:07 | Roo (Code) | Feat: excess arrival → inventory stock — when actual arrived quantity exceeds ordered quantity, excess is auto-added to inventory stock. Migration 040 adds arrived_qty column to order_items. Server: adjustInventoryForOrderItem supports excess_arrival movement type; bulk-inventory-verify and inventory-verify-item accept arrived_qty, auto-add excess to stock. Dashboard: "Arrived Qty" column with per-item input + warehouse icon button, bulk "Set Arrived" input, excess badges (+X → stock), green highlight on verified_qty when excess exists. | ✅ Done |
| 2026-05-27 18:33 | Roo (Code) | Fix: full downpayment order no longer skips production — verify-deposit now advances full-payment standard orders to purchasing_pending instead of balance_verification. Non-from-stock orders must go through production workflow even when fully paid. Balance verification happens naturally after delivery. | ✅ Done |
| 2026-05-28 02:23 | Roo (Code) | Feat: Special Case on Balance Due — new "Special Case" button on balance_due orders (non-exception) that skips balance payment and advances to countered → payment_received → payment_confirmed → completed. Migration 043 adds special_case columns + payment_counter table. Server: POST /orders/special-case, POST/GET /orders/:id/payment-counter endpoints. Dashboard: Special Case button, Countered section (between Delivered and Payment Received), Payment Counter modal (invoice status, dates, file uploads). Guard added for balance_due → countered requiring special_case or delivery_exception. | ✅ Done |
| 2026-05-28 12:59 | Roo (Code) | Feat: production tab gap fix — removed "Complete (Partial)" buttons, let items progress individually using item-level buttons. Orders stay visible until ALL items advance. | ✅ Done |
| 2026-05-28 13:00 | Roo (Code) | Feat: early inventory verification for arrived items at en_route_verification stage — server endpoints relaxed (5 endpoints), inventory verification page allows en_route_verification, InventoryVerificationSection shows en_route_verification orders with arrived items + "Early verification" badge, production page adds "Verify in Inventory" link on arrived items, telegram notifications and reminders updated with inventory verification links | ✅ Done |
| 2026-05-28 13:34 | Roo (Code) | Feat: MN Design Studio gap fix — special case now advances to delivery_pending instead of directly to countered. New "Verify Countered" button in countered section creates payment_counter record. Renamed "Delivery Invoice" to "Delivery Receipt" in payment counter modal. | ✅ Done |
| 2026-05-28 01:54 | Roo (Code) | Feat: partial production finish, partial dispatch, partial en-route arrival — added 3 new API endpoints (complete-production-partial, complete-dispatch-partial, complete-arrival-partial), API client functions, "Complete (Partial)" buttons in OrderRow and ProductionItemSection, OTP handlers, wired into all relevant sections. | ✅ Done |
| 2026-05-28 00:54 | Roo (Code) | Fix: draggable chatbox — two bugs fixed: (1) click-outside handler now skips during drag via dragRef.current.isDragging check; (2) transform: translate() moved from outer container to chat panel only, so floating button always stays at bottom-6 right-6 | ✅ Done |
| 2026-05-28 00:42 | Roo (Code) | Feat: auto-fill sales agent — NewOrderModal and VisionPageContent now auto-fill salesAgent from useAuth().user.name when a sub-user (Mariella/Cathlyn) is logged in. Acknowledgement receipt already renders the order's sales_agent field, no change needed. | ✅ Done |
| 2026-05-28 00:44 | Roo (Code) | Feat: AI chatbox draggable — ChatFloatingIcon now supports mouse/touch drag via the header. Uses CSS transform translate() for smooth repositioning. | ✅ Done |
| 2026-05-27 21:02 | Roo (Code) | Feat: AI Assistant Chat + Update Logs page — created tutorial agent (agents/tutorial-agent/agent.md), knowledge base ingestion pipeline (pgvector + OpenAI embeddings), chat API (Fastify routes + OpenAI gpt-4o-mini), chat UI page (/chat) with conversation management, update logs page (/update-logs, admin-only), migration 041 (knowledge_base.sql), docker-compose postgres image changed to pgvector/pgvector:pg16. Wired into sidebar + auth system. | ✅ Done |
| 2026-05-27 22:09 | Roo (Code) | Feat: Replace sidebar AI Assistant link with floating chat icon — created ChatFloatingIcon.tsx (floating bubble bottom-right, 380x520px panel, conversation management, message rendering, QAS WelcomeScreen, click-outside-to-close). Wired into AuthGuard.tsx. Removed /chat link from Sidebar.tsx. | ✅ Done |
| 2026-05-27 22:31 | Roo (Code) | Fix: AI chat box knowledge base — changed embedding model from text-embedding-004 (404 error) to text-embedding-005, removed inaccessible Guides Page source from KNOWLEDGE_SOURCES. Committed + deploying to VPS. | ✅ Done |
| 2026-05-27 22:46 | Roo (Code) | Feat: full payment deposit skips balance due/verification — verify-deposit auto-verifies balance when deposit >= total for non-from_stock orders. confirm-inventory-arrived sees balance_verified=TRUE and advances to delivery_pending. Dashboard shows "Balance auto-verified" badge and updated verification banner text. Commit d31677d. | ✅ Done |
| 2026-05-27 23:32 | Roo (Code) | Feat: production tab — added estimated arrival date display + bulk en-route item selection. Updated "Arrival Est." card to show computed date. Added inline "Est. Arrival" badge with color coding. Added bulk en-route item checkboxes + "En Route Selected (N)" button in ProductionInfoCards. Committed `56267ac`, pushed to GitHub, deployed to VPS. All 7 containers healthy. | ✅ Done |
| 2026-05-27 23:52 | Roo (Code) | Fix: acknowledgement receipt shows wrong amount (₱750 instead of ₱1,500) when full payment recorded via dashboard — getReceiptAmount now returns total_amount when balance_paid or deposit_is_full_payment is TRUE. Same fix applied to receipts list endpoint. | ✅ Done |
| 2026-05-28 01:13 | Roo (Code) | Feat: partial inventory verification + partial delivery — migration 041_partial_delivery.sql adds partial_delivery_count, remaining_qty, last_partial_delivery_at to order_items; partial_delivery, partial_delivery_notes to orders; partial_delivery_logs table; get_delivery_completion_pct function. Server: complete-inventory-verification-partial, partial-delivery, delivery-progress endpoints. Dashboard: inventory verification page shows "Complete (Partial)" button; delivery page shows "Partial Delivery" button + modal with item selection, summary stats, delivery note, OTP confirmation; production page shows "Partial Delivery" badge on orders with partial delivery enabled. Telegram notifications sent for partial verification and partial delivery events. | ✅ Done |
| 2026-05-28 01:44 | Roo (Code) | Fix: E2E gap analysis — 4 gaps fixed: (1) confirm-inventory-arrived now preserves inventory_verification_pct for partial delivery orders instead of overwriting to 100; (2) removed stale Partial Delivery button from Stock Prep section (dead code, stock_preparation not in allowed stages); (3) added en_route_verification to allowed stages for partial delivery; (4) remaining_qty now set for ALL items in partial completion (including fully-verified items get 0). Commit `6908a3f`. | ✅ Done |
| 2026-05-28 14:29 | Roo (Code) | Feat: purchasing tab production exception — deposit slip upload + AI extraction + mark balance paid with upload. Delivery tab redesign — simplified delivery section (only "Mark as Countered"), restructured countered section ("Mark Payment Received" + upload delivery receipt/sales invoice), "Order Complete" button in payment confirmed. Gap 3: migration 044 rename delivery_invoice → delivery_receipt. Gap 4: hide "Verify Countered" when counter exists. Gap analysis: all features + Telegram reminders confirmed compatible. | ✅ Done |
| 2026-05-28 17:06 | Roo (Code) | Investigating: website slowness — checked VPS resources (1.9GB RAM, 615MB swap used, 44% disk), Docker stats, API response times (fast), found separate PM2 process (trading-signal-bot at /root/xsjprd55/) consuming 161MB RAM with 263 restarts in 2 days | ✅ Done |
| 2026-05-28 17:14 | Roo (Code) | Feat: itemized progression across production tab — converted Dispatch Pending, En Route — In Transit, Arrival Verification from OrderSection (order-level) to ProductionItemSection (item-level). Added EnRouteStatusBadge component, en route status column in table, filtered variables for enRouteVerificationOrders and enRouteTrackingOrders. Inventory and delivery tabs already had itemized progression. | ✅ Done |

---

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md)

## Bug Log

See [`BUG_LOG.md`](./BUG_LOG.md)
