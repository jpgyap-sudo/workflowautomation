# Bug Log

> Central record of bugs, their root causes, fixes, and which extension resolved them.
> All coding extensions (Roo, Claude, Codex, Kimi) should log bugs here.

---

## How to log a bug

```markdown
| YYYY-MM-DD | Short description | Root cause | Fix commit | Extension | Status |
```

- **Status**: `Open` / `Fixed` / `Verified`
- **Extension**: Which coding extension found and fixed it

---

## Active Bugs

*None currently.*

---

## Resolved Bugs

| Date | Bug | Root Cause | Fix | Extension | Status |
|------|-----|------------|-----|-----------|--------|
| 2026-05-24 | Partial-production order stayed Production Confirmed after all items were Finished | Manual/API item completion paths only treated all non-pending items as production started; the production board path moved stage without completing production reminders or triggering en-route agents, and stale `partial_production_items` still rendered as pending. | This commit - finalizes all-finished item orders to `en_route`, completes production reminders, triggers en-route agents/Telegram, and hides stale pending chips. | Codex | Verified local builds |
| 2026-05-24 | Downpayment Verified column showed Pending even after Telegram verification | `GET /orders` used `ORDER_LIST_SELECT` without `deposit_verified`, `deposit_verified_at`, `balance_verified`, or related verification fields, so the table received undefined values even though the database was verified. | [`3b6a178`](https://github.com/jpgyap-sudo/workflowautomation/commit/3b6a1789b564407a38ecd87cec01bdc00501340a) - added payment verification fields to the orders list select; API build passes. | Codex | Verified local build |
| 2026-05-24 | Purchasing dashboard marked actual production started too early | The Purchasing tab used `/set-production`, which set `production_started=true` and advanced directly to `production_confirmed`; Telegram purchasing reminders also reused `produce:no` for workflow-not-started responses. | [`3b7767e`](https://github.com/jpgyap-sudo/workflowautomation/commit/3b7767e4ab1e6e0d330628ffbc5638abb4424e64) - dashboard now starts only the production workflow (`production_pending`), and Telegram has separate workflow acknowledgement vs actual production-start reminders. | Codex | Verified local builds |
| 2026-05-24 | En Route Verification missing from Stage Pipeline tab | Commit `ada6e80` removed `en_route_verification` from dashboard `STAGE_CONFIG` and `STAGE_ORDER`, so `/stages` skipped the card between En Route and Inventory Verification. | [`029adcd`](https://github.com/jpgyap-sudo/workflowautomation/commit/029adcd38c14349855c2def7e3fe621a80f8923c) - restored dashboard stage config/order entry; `npm run build` passes. | Codex | Verified local build |
| 2026-05-24 | Dashboard OTP modal returned nginx 502 Bad Gateway while creating orders | VPS API container was missing/stuck after stale Docker Compose container conflict, so nginx could not proxy `/api/*` to port 8080. | [`9af8ae5`](https://github.com/jpgyap-sudo/workflowautomation/commit/9af8ae533c80843ed5a0910b09ad7787a382685d) — restored VPS Docker stack with `docker compose up -d`; verified public `/api/health` and `/api/auth/send-otp` returned 200. | Codex | ✅ Verified |
| 2026-05-24 | `sales.homeu@gmail.com` shows "Invalid email address" after login fix deployed | Browser Service Worker caching old JS bundle (cache name `v2`). SW cache name bump to `v3` deployed but browser needed hard refresh to pick up new SW. | [`e9daa2d`](https://github.com/jpgyap-sudo/workflowautomation/commit/e9daa2d) — bump SW cache name to v3. User did Ctrl+Shift+R to force refresh. | Roo (Code) | ✅ Verified |
| 2026-05-24 | `sales.homeu@gmail.com` sub-users not showing after login | `getStoredAccounts()` merge logic only updated `password` field from defaults, not `subUsers`. Existing localStorage accounts had no sub-users. | [`a5bb651`](https://github.com/jpgyap-sudo/workflowautomation/commit/a5bb651) — add `subUsers` field merge alongside password merge in `getStoredAccounts()`. | Roo (Code) | ✅ Verified |
| 2026-05-24 | Docker `No such image` / `KeyError: 'ContainerConfig'` on VPS rebuild | Stale image references in Docker Compose after containers were removed but old image hashes persisted in Compose state. | Run `docker-compose down --remove-orphans` then `docker-compose up -d --build` to clear stale state. | Roo (Code) | ✅ Workaround |
| 2026-05-24 | Telegram bot crashes on SIGTERM | `bot.stop()` throws uncaught exception when called during shutdown. | [`aaa257a`](https://github.com/jpgyap-sudo/workflowautomation/commit/aaa257a) — wrap `bot.stop()` in try/catch. | Roo (Code) | ✅ Verified |
| 2026-05-24 | Infinite loop in item_prod handler when clicking 'Not Yet' on already-not_yet items | Missing skip-set check before auto-advance. | [`9270afb`](https://github.com/jpgyap-sudo/workflowautomation/commit/9270afb) — add skip-set check before auto-advance. | Roo (Code) | ✅ Verified |
| 2026-05-24 | Infinite loop in en-route flow when clicking 'Not Yet' on already-not_yet item | Same pattern — missing skip-set check. | [`b1a1683`](https://github.com/jpgyap-sudo/workflowautomation/commit/b1a1683) — add skip-set check. | Roo (Code) | ✅ Verified |
| 2026-05-24 | 415 Content-Type error in fetchJson | Duplicate `Content-Type` headers when both default and custom headers set. | [`c8a5bd6`](https://github.com/jpgyap-sudo/workflowautomation/commit/c8a5bd6) — normalize Content-Type to avoid duplicates. | Roo (Code) | ✅ Verified |
| 2026-05-24 | Telegram bot 409 Conflict on restart | Previous bot instance still holding polling lock. | [`8d1d3ee`](https://github.com/jpgyap-sudo/workflowautomation/commit/8d1d3ee) — add `bot.telegram.callApi('close')` before launch. | Roo (Code) | ✅ Verified |
| 2026-05-24 | Telegram bot 429 rate-limit on launch | Too many rapid restart attempts. | [`b11d9b9`](https://github.com/jpgyap-sudo/workflowautomation/commit/b11d9b9) — handle 429 with retry logic. | Roo (Code) | ✅ Verified |
| 2026-05-24 | Dashboard Docker build OOM on VPS | `npm ci` uses too much memory on 1GB VPS. | [`214d454`](https://github.com/jpgyap-sudo/workflowautomation/commit/214d454) — use `npm install` instead of `npm ci`. | Roo (Code) | ✅ Verified |
| 2026-05-24 | Google Drive upload fails with expired token | No retry logic or token refresh on 401. | [`a57fb5d`](https://github.com/jpgyap-sudo/workflowautomation/commit/a57fb5d) — add `withRetry` wrapper with exponential backoff + token refresh. | Roo (Code) | ✅ Verified |
| 2026-05-23 | VPS MCP server ETIMEDOUT | Tailscale not usable from local machine. | Fall back to direct SSH via Tailscale IP. | Roo (Code) | ✅ Workaround |
| 2026-05-22 | Sub-user login flow missing from auth | `getStoredAccounts()` didn't propagate `subUsers` from DEFAULT_ACCOUNTS to localStorage. | [`a5bb651`](https://github.com/jpgyap-sudo/workflowautomation/commit/a5bb651) — merge subUsers field. | Roo (Code) | ✅ Verified |
| 2026-05-21 | Collection agent sends payment reminders when balance already paid | Missing balance check before sending reminder. | [`13675a5`](https://github.com/jpgyap-sudo/workflowautomation/commit/13675a5) — skip payment reminders when balance already paid. | Roo (Code) | ✅ Verified |
| 2026-05-21 | Gemini free tier rate-limited for Hermes Claw | No fallback when Gemini quota exceeded. | [`331d609`](https://github.com/jpgyap-sudo/workflowautomation/commit/331d609) — add OpenRouter fallback. | Roo (Code) | ✅ Verified |
| 2026-05-20 | Hardcoded credentials and infra details in public files | Security issue — credentials committed to git. | [`b195f5e`](https://github.com/jpgyap-sudo/workflowautomation/commit/b195f5e) — remove all hardcoded credentials. | Roo (Code) | ✅ Verified |
| 2026-05-20 | `react-hooks/purity` lint error in DaysInStage component | `Date.now()` called directly in render. | [`f457e03`](https://github.com/jpgyap-sudo/workflowautomation/commit/f457e03) — extract into DaysAgo component. | Roo (Code) | ✅ Verified |
| 2026-05-30 | QTN-MNDesign itemized arrival → verification gap — clicking "arrived" on an item did not progress to arrival verification or inventory verification | TWO bugs: (1) `advanceFromEnRouteToVerificationIfAllDispatched` required `allFinished` (all items production_status === 'finished') in addition to `allDispatched` — blocked en_route → en_route_verification. (2) `advanceToEnRouteIfAllDispatched` also required `allFinished` — blocked partial_production → en_route. Since the order never reached en_route, bug #1's fix could never trigger. | (1) Removed `allFinished` check from `advanceFromEnRouteToVerificationIfAllDispatched` (commit `5e1a4d9`). (2) Removed `allFinished` check from `advanceToEnRouteIfAllDispatched` (pending commit). | Roo (Code) | Fixed |
| 2026-05-20 | DELETE /orders/:id uses wrong table name | SQL references `order_files` instead of `files`. | [`4f4f380`](https://github.com/jpgyap-sudo/workflowautomation/commit/4f4f380) — correct table name. | Roo (Code) | ✅ Verified |

## 2026-05-25 07:51 - Inventory verification permanent page showed 0 verified qty

- **Found by:** Codex E2E test
- **Symptom:** `/orders/:id/items` returned item arrival timestamps but omitted `verified_qty`, so permanent inventory verification links could render verified records as `0/qty`.
- **Fix:** Include `COALESCE(verified_qty, 0) AS verified_qty` in the item API response.
- **Status:** Fixed; pending deploy verification.

## 2026-05-25 09:04 - E2E build gaps in dashboard/telegrambot after payment and schedule updates

- **Found by:** Codex E2E build test
- **Symptoms:** Dashboard build failed because `orders/page.tsx` used `recordDepositWithFile` without importing it and createOrder typing omitted `items`; Telegram bot build failed because `awaiting_bug_order_pick` was used but missing from the `UserStep` union.
- **Fix:** Added the missing dashboard import, typed `createOrder.items`, and added `awaiting_bug_order_pick` to the Telegram bot state union.
- **Status:** Fixed locally; builds pass.

## 2026-05-28 — Telegram OTP not working ("chat not found")

- **Found by:** User report
- **Symptom:** Dashboard OTP modal showed "Telegram unavailable" and fell back to email OTP. API logs showed `[action-code] Telegram send failed: {"ok":false,"error_code":400,"description":"Bad Request: chat not found"}` for escalation group chat `-5110641004`. Also affected agent notifications for delivery group (`-1003851332810`) and collection group (`-5206645324`).
- **Root cause:** The configured bot (@atelier88_bot, token `8972611688:AAEP...`) was **not a member** of the escalation, delivery, or collection group chats. The `ACTION_VERIFY_CHAT_ID` fallback chain resolved to `ESCALATION_CHAT_ID` = `-5110641004`, and Telegram returned 400 when the bot tried to send the OTP code to a chat it wasn't in.
- **Fix:** Updated `TELEGRAM_BOT_TOKEN` from `8972611688:AAEP...` (@atelier88_bot) to `8632443344:AAH8...` (@homeatelier88_bot — the correct bot that IS a member of all group chats) in both local `.env` and VPS `.env`. Restarted `api` and `telegram-bot` containers on VPS.
- **Extension:** Roo (Code)
- **Status:** ✅ Verified — no "chat not found" errors in API logs after restart. Bot launched successfully with webhook set.

## 2026-05-30 — "Start Production Workflow" button does nothing on purchasing page

- **Found by:** User report
- **Symptom:** Clicking "Start Production Workflow" on a pending purchase order shows the ConfirmModal, user clicks "Confirm Action", modal closes, but nothing happens — the order stays in purchasing_pending.
- **Root cause:** Race condition in `ConfirmModal` component. `handleConfirm` called `onVerified(result.actionToken)` then immediately called `onClose()`. The `onClose` handler in the purchasing page cleared `window.__pendingStartProductionWorkflowData = null` before `handleStartProductionWorkflowVerified` could read it. The function returned early at `if (!pending) return;` — silently doing nothing.
- **Fix:** Removed `onClose()` from `ConfirmModal`'s `handleConfirm` function. All page-level `handleConfirmVerified` handlers already close the modal themselves after processing the action token.
- **Extension:** Roo (Code)
- **Status:** ✅ Fixed — pending deploy verification.

## 2026-05-31 — "Start Production" button does nothing on production pending section

- **Found by:** User report
- **Symptom:** Clicking "Start Production" on a production_pending order (e.g., QTN-MNDesign) does nothing — no production days modal appears. The order row collapses instead.
- **Root cause:** The Start Production button at line 955 of `production/page.tsx` did not call `e.stopPropagation()`. When clicked, the click event bubbled to the parent `<button>` at line 828 (the row expand/collapse toggle), which called `setExpanded(false)`. In React 18, both state updates (`setProdDaysModal` and `setExpanded`) were batched, causing the row to collapse simultaneously. While the modal should still render (it's outside `OrderRow`), the row collapsing created a poor UX where the user perceived "nothing happened."
- **Fix:** Added `e.stopPropagation()` to the Start Production button's `onClick` handler so the event does not bubble to the parent toggle button.
- **Extension:** Roo (Code)
- **Status:** ✅ Fixed — pending deploy verification.

## 2026-05-31 — QTN-20262505-06 shows "Order not found" when clicked from orders list

- **Found by:** User report (Claude was working on this)
- **Symptom:** Clicking on order QTN-20262505-06 from the orders list navigates to the order detail page which shows "Order not found".
- **Root cause:** `OrderTable.tsx` and `vision/page.tsx` constructed order detail links without `encodeURIComponent()`. The quotation number `QTN- 20262505- 06` contains spaces around the dashes. When the browser navigated to `/orders/QTN- 20262505- 06` (with literal spaces), the URL encoding was inconsistent — the browser would encode spaces as `%20`, but Next.js's `useParams()` would decode them back. However, the SWR fetcher in `useOrder()` then called `encodeURIComponent()` on the already-decoded string, producing `/api/orders/QTN-%2020262505-%2006`. While the API itself handles this correctly, the inconsistent encoding between the `<Link>` href and the actual API call caused edge cases where the order detail page failed to load.
- **Fix:** Added `encodeURIComponent()` to all order detail links in `OrderTable.tsx` (3 locations: mobile view line 277, desktop view lines 562 and 703) and `vision/page.tsx` (2 locations: lines 1112 and 1172). This ensures the URL parameter is properly encoded from the start, matching the encoding used by the `useOrder()` hook.
- **Extension:** Roo (Code)
- **Status:** ✅ Fixed — pending deploy verification.
