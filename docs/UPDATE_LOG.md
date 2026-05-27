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

| Date | Extension | Description | Status |
|------|-----------|-------------|--------|
| 2026-05-27 03:56 | Roo (Code) | Comprehensive gap analysis across all features — fixed stageToGroup (added production_in_progress, stock_preparation), VALID_TRANSITIONS (added stock_preparation), AGENT_TRIGGER_MAP (added collection-agent to stock_preparation), STAGE_ORDER (added partial_production, stock_preparation, removed duplicate), removed stale finish-production-pending endpoint, updated telegram page mappings, added missing inline keyboard handlers in reminderScheduler.ts for production_in_progress and stock_preparation | ✅ Done |
| 2026-05-27 09:28 | Roo (Code) | Fix: OTP error in verify all — Bug #1: verify-deposit now checks if balance is also paid (full payment) and advances to balance_verification instead of skipping past it. Bug #2: PATCH /payments/:id/verify now advances order stage when all payments verified. Bug #3: removed dead import of verifyPayment from order detail page. | ✅ Done |
| 2026-05-27 15:43 | Roo (Code) | Committed + deployed: guides page updates, package updates, memory files, new capture-screenshots script. All services rebuilt and restarted on VPS. | ✅ Done |
| 2026-05-27 16:11 | Roo (Code) | Delivery tab: made "₱X due" amount clickable — opens deposit slip upload + AI extraction modal (same as upload button). | ✅ Done |
| 2026-05-27 16:29 | Roo (Code) | Fix: acknowledgement receipt gap — balance payments now only get receipts after verification. Server: SQL filter excludes unverified balance payments from receipts list; PDF endpoint rejects unverified balance payments. Dashboard: unverified balance payments shown with "Pending Verification" badge and no download link. | ✅ Done |
| 2026-05-27 18:07 | Roo (Code) | Feat: excess arrival → inventory stock — when actual arrived quantity exceeds ordered quantity, excess is auto-added to inventory stock. Migration 040 adds arrived_qty column to order_items. Server: adjustInventoryForOrderItem supports excess_arrival movement type; bulk-inventory-verify and inventory-verify-item accept arrived_qty, auto-add excess to stock. Dashboard: "Arrived Qty" column with per-item input + warehouse icon button, bulk "Set Arrived" input, excess badges (+X → stock), green highlight on verified_qty when excess exists. | ✅ Done |
| 2026-05-27 18:33 | Roo (Code) | Fix: full downpayment order no longer skips production — verify-deposit now advances full-payment standard orders to purchasing_pending instead of balance_verification. Non-from-stock orders must go through production workflow even when fully paid. Balance verification happens naturally after delivery. | ✅ Done |
| 2026-05-28 00:42 | Roo (Code) | Feat: auto-fill sales agent — NewOrderModal and VisionPageContent now auto-fill salesAgent from useAuth().user.name when a sub-user (Mariella/Cathlyn) is logged in. Acknowledgement receipt already renders the order's sales_agent field, no change needed. | 🔴 Active |
| 2026-05-27 21:02 | Roo (Code) | Feat: AI Assistant Chat + Update Logs page — created tutorial agent (agents/tutorial-agent/agent.md), knowledge base ingestion pipeline (pgvector + OpenAI embeddings), chat API (Fastify routes + OpenAI gpt-4o-mini), chat UI page (/chat) with conversation management, update logs page (/update-logs, admin-only), migration 041 (knowledge_base.sql), docker-compose postgres image changed to pgvector/pgvector:pg16. Wired into sidebar + auth system. | ✅ Done |
| 2026-05-27 22:09 | Roo (Code) | Feat: Replace sidebar AI Assistant link with floating chat icon — created ChatFloatingIcon.tsx (floating bubble bottom-right, 380x520px panel, conversation management, message rendering, QAS WelcomeScreen, click-outside-to-close). Wired into AuthGuard.tsx. Removed /chat link from Sidebar.tsx. | ✅ Done |
| 2026-05-27 22:31 | Roo (Code) | Fix: AI chat box knowledge base — changed embedding model from text-embedding-004 (404 error) to text-embedding-005, removed inaccessible Guides Page source from KNOWLEDGE_SOURCES. Committed + deploying to VPS. | ✅ Done |
| 2026-05-27 22:46 | Roo (Code) | Feat: full payment deposit skips balance due/verification — verify-deposit auto-verifies balance when deposit >= total for non-from_stock orders. confirm-inventory-arrived sees balance_verified=TRUE and advances to delivery_pending. Dashboard shows "Balance auto-verified" badge and updated verification banner text. Commit d31677d. | ✅ Done |
| 2026-05-27 23:32 | Roo (Code) | Feat: production tab — added estimated arrival date display + bulk en-route item selection. Updated "Arrival Est." card to show computed date. Added inline "Est. Arrival" badge with color coding. Added bulk en-route item checkboxes + "En Route Selected (N)" button in ProductionInfoCards. Committed `56267ac`, pushed to GitHub, deployed to VPS. All 7 containers healthy. | ✅ Done |
| 2026-05-27 23:52 | Roo (Code) | Fix: acknowledgement receipt shows wrong amount (₱750 instead of ₱1,500) when full payment recorded via dashboard — getReceiptAmount now returns total_amount when balance_paid or deposit_is_full_payment is TRUE. Same fix applied to receipts list endpoint. | 🔴 Active |

---

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md)

## Bug Log

See [`BUG_LOG.md`](./BUG_LOG.md)
