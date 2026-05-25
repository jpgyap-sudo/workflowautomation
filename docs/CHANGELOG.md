# Changelog

> Unified commit & deployment log for all coding extensions working on this project.
> Each entry records: **commit hash**, **date**, **authoring extension**, **description**, and **deployment status**.

---

## 2026-05-25

| Commit | Extension | Description | Deployed |
|--------|-----------|-------------|----------|
| `ed3dc55` | Roo (Code) | fix: order detail page React hooks violation — useEffect after conditional return caused "This page couldn't load" error. Moved useEffect before conditional returns with null guard. | ✅ VPS `ed3dc55` |
| `e334c67` | Roo (Code) | feat: Bulk Delete Clients — POST /clients/bulk-delete API endpoint with force-unlink support, bulkDeleteClients() API function, and full dashboard UI with checkboxes, select-all, force-delete confirmation, and OTP verification | ✅ VPS `e334c67` |
| | Roo (Code) | feat: remove auto-advance to production_finished, add production_in_progress stage — all items start → production_in_progress (not production_confirmed). Production finished is manual only. New section on production page. | ❌ Pending |
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
| `a9c538a` | Roo (Code) | fix: delivery schedule OTP error — PATCH /orders/:id now records stage update internally when delivery_date is set, removing double-token consumption | ✅ VPS `a9c538a` |
| `8e71212` | Roo (Code) | fix: remove stale action_token from deposit calls in orders page handleVerified() — token already consumed by createOrder | ✅ VPS `8e71212` |
| `59cc9bd` | Roo (Code) | fix: add balance_proof notification to COLLECTION_CHAT_ID in server.ts + fix bot.ts balance confirm handler fileType from 'deposit' to 'balance_proof' | ✅ VPS `59cc9bd` |
| `21dee5d` | Roo (Code) | fix: update sales.homeu password to Homeu@888 (subUsers 777=Mariella, 888=Cathlyn already configured) | ✅ VPS `21dee5d` |
| `30abe22` | Roo (Code) | feat: add sub-user management UI in Settings → User Management — modal with add/edit/delete entry codes (code + name) per account, persists via updateAccount() | ✅ VPS `30abe22` |
| `35c8cd1` | Roo (Code) | fix: bump SW cache from v3 to v4 — force fresh dashboard JS load for updated password | ✅ VPS `35c8cd1` |
| `c236895` | Roo (Code) | fix: sync password from DEFAULT_ACCOUNTS into stored accounts on load — getStoredAccounts() now updates password when source changes | ✅ VPS `c236895` |

## 2026-05-24

| Commit | Extension | Description | Deployed |
|--------|-----------|-------------|----------|
| `16eec73` | Roo (Code) | fix: add missing stock replenishment migration (order_type column) � resolves API 500 error | ? VPS `16eec73` |
| `a871000` | Roo (Code) | feat: replace Production Finished Actions column with notes input � users can add/view notes per order | ? VPS `a871000` |
| `7166d8c` | Roo (Code) | deploy: Codex features � inventory accountability, item production dates, early inventory verification, production finished tracking | ? VPS `7166d8c` |
| `7c77bca` | Codex | feat: add item-level inventory verification accountability | ? VPS `7166d8c` |
| `188f941` | Codex | feat: add early-arrival proceed to inventory verification action | ? VPS `7166d8c` |
| `87dfc24` | Codex | feat: track and display item production finished dates | ? VPS `7166d8c` |
| `bb26c61` | Claude Sonnet 4.6 | fix: E2E gaps � en_route_verification stale check + dashboard section + purchasing_pending deposit guard + inventory_verification dashboard link | ? VPS `7166d8c` |
| `57c7dba` | Roo (Code) | docs: mark production auto-finish deployed | ✅ VPS `57c7dba` |
| `ff25dee` | Roo (Code) | fix: refine item production Telegram prompts | ✅ VPS `57c7dba` |
| `3a2263b` | Roo (Code) | fix: auto-finish completed item production | ✅ VPS `57c7dba` |
| `6ef6d10` | Claude Sonnet 4.6 | fix: partial-production dashboard endpoint missing partial_production stage orders | ✅ VPS `57c7dba` |
| `9a68b00` | Claude Sonnet 4.6 | fix: purchasing_pending orders never got Telegram notification to start production workflow | ✅ VPS `57c7dba` |
| `c5fb6fb` | Claude Sonnet 4.6 | fix: deploy-agent — delegate container management to deploy.sh --skip-pull to avoid Docker Compose v1 [yN] hang | ✅ VPS `57c7dba` |
| `a5909bc` | Roo (Code) | fix: add en_route_verification/inventory/balance/delivery reminder creation + stageToGroup map + manual production status on purchasing page + stage advancement on order detail page — Telegram-independent dashboard progression | ✅ VPS `a5909bc` |
| `3b6a178` | Codex | fix: sync payment verification fields in orders list API | ? VPS `e9c72b5` |
| `f24d0ad` | Codex | feat: show balance payment date and payment verification columns in orders table | ? VPS `3a3cf11` |
| `3b7767e` | Codex | fix: split production workflow handoff from actual production start | ? VPS `bb32b09` |
| `ee87c55` | Roo (Code) | fix: deposit sync failure — remove mandatory action_token from POST /deposits, add OTP modals to all deposit flows | ✅ VPS `ee87c55` |
| `a86fd7c` | Roo (Code) | fix: auto-detect deposit slip when photo sent to collection group chat — no button clicks required | ✅ VPS `a86fd7c` |
| `3a67ee6` | Roo (Code) | feat: add client_name and actor_name to stage_updates table for traceability | ✅ VPS `3a67ee6` |
| `1749ed9` | Claude Sonnet 4.6 | fix: production workflow — partial_production end-to-end (auto-advance, item-level tracking, Telegram + dashboard + reminders + agent) | ✅ VPS `8993820` |
| `029adcd` | Codex | fix: restore en_route_verification in dashboard stage pipeline | ✅ VPS `8993820` |
| `9af8ae5` | Codex | chore: record OTP 502 recovery lessons and logs | ✅ Not deployed (docs/memory only; VPS recovery already verified) |
| `1749ed9` | Roo (Code) | fix: reminder scheduler gaps for en_route_verification stage | ✅ VPS `1749ed9` |
| `f51564b` | Roo (Code) | docs: update UPDATE_LOG — Roo deploying en_route_verification stage | ✅ VPS `f51564b` |
| `7e17451` | jpgyap-sudo | chore: auto-commit before deploy | ✅ VPS `f51564b` |
| `4803927` | Claude Sonnet 4.6 | fix: wire en_route_verification stage end-to-end + fix workflow gaps | ✅ VPS `f51564b` |
| `ada6e80` | Roo (Code) | chore: auto-commit before deploy | ✅ VPS `ada6e80` |
| `a75e793` | Roo (Code) | feat: add `reminder:item_inventory` callback handler for Telegram bot | ✅ |
| `d2ed12f` | Roo (Code) | feat: add `en_route_verification` to AGENT_TRIGGER_MAP | ✅ |
| `83ce0ae` | Roo (Code) | feat: add item production/en route status editing to order detail page | ✅ |
| `2ba8f69` | Roo (Code) | feat: split En Route section into En Route Verification and En Route on production dashboard | ✅ |
| `75f50b5` | Roo (Code) | chore: auto-learned lessons from inventory_verification flow fix | ✅ |
| `80b880e` | Roo (Code) | fix: route item-level orders through inventory_verification + close remaining gaps | ✅ |
| `10be05e` | Roo (Code) | chore: auto-learned lessons from SIGTERM crash fix | ✅ |
| `aaa257a` | Roo (Code) | fix: wrap bot.stop() in try/catch to prevent uncaught exception crash on SIGTERM | ✅ |
| `af2f51a` | Roo (Code) | feat: add en_route_verification stage to pipeline | ✅ |
| `863228d` | Roo (Code) | chore: auto-learned lessons from sync gap fixes | ✅ |
| `16738da` | Roo (Code) | fix: close dashboard-telegram sync gaps (part 2) | ✅ |
| `25354a5` | Roo (Code) | fix: close dashboard-telegram sync gaps | ✅ |
| `2f44e62` | Roo (Code) | chore: auto-learned lessons from session expiry message fix | ✅ |
| `78e1978` | Roo (Code) | fix: improve session expired messages with clearer instructions and Main Menu button | ✅ |
| `3d40ed1` | Roo (Code) | chore: improve vision handler session expiry messages | ✅ |
| `7f13e1f` | Roo (Code) | chore: auto-learned lessons from previous session | ✅ |
| `76173dd` | Roo (Code) | feat(telegram-bot): add en route verification section + close item-level gaps | ✅ |
| `fb79f5b` | Roo (Code) | feat: item-level en route verification after production finished | ✅ |
| `3abb26b` | Roo (Code) | fix: wrap answerCbQuery in try/catch to handle expired callback queries in vision handlers | ✅ |
| `0174c12` | Roo (Code) | feat: add AI extraction fallback buttons in order file viewer modal | ✅ |
| `ff21964` | Roo (Code) | fix(telegram-bot): item-level production stuck on same item | ✅ |
| `c30496b` | Roo (Code) | fix: save deposit slip to order file viewer when recording deposit by client name | ✅ |
| `d700e4a` | Roo (Code) | feat: auto-save uploaded quotation files to order file viewer when AI extracts data from Telegram | ✅ |
| `8624f16` | Roo (Code) | feat(telegram-bot): add reply keyboard quick actions for /prod command | ✅ |
| `c8a5bd6` | Roo (Code) | fix: normalize Content-Type header in fetchJson to avoid duplicate headers causing 415 | ✅ |
| `ccca267` | Roo (Code) | chore: update memory lessons | ✅ |
| `2c8a6fc` | Roo (Code) | feat: persistent control panel with quick-action buttons in production chat | ✅ |
| `5acb443` | Roo (Code) | feat: redesign en-route flow with timed midpoint + arrival checks | ✅ |
| `eeab435` | Roo (Code) | feat: auto-show production dashboard in production group chat on any message | ✅ |
| `006e446` | Roo (Code) | fix: skip slash commands in text handler so /prod and /production reach bot.command() handlers | ✅ |
| `0b4c1b0` | Roo (Code) | chore: record item production lesson | ✅ |
| `5ef3782` | Roo (Code) | fix: skip-set check before auto-advance in item_prod handler | ✅ |
| `2e02124` | Roo (Code) | chore: record production flow lesson | ✅ |
| `b5cc797` | Roo (Code) | fix: refine production telegram flow | ✅ |
| `3bd02cb` | Roo (Code) | feat: add production telegram dashboard | ✅ |
| `624fecc` | Roo (Code) | fix: replace early-return with skip-set to allow progressing through remaining items | ✅ |
| `dd63058` | Roo (Code) | fix: stop infinite loop when clicking 'Not Yet' on already-not_yet items | ✅ |
| `9270afb` | Roo (Code) | fix: infinite loop in item_prod handler + skip confirmation for item status toggles | ✅ |
| `b1a1683` | Roo (Code) | fix: infinite loop when clicking 'Not Yet' on already-not_yet item in en-route flow | ✅ |
| `d591e9e` | Roo (Code) | fix: escape Markdown special chars in reminder:item_en_route error handler | ✅ |
| `31146cc` | Roo (Code) | fix: drop duplicate reminders unique constraint and escape Markdown in error messages | ✅ |
| `f6f65a9` | Roo (Code) | chore: add png to gitignore, commit memory lessons and screenshot script | ✅ |
| `cc46f2d` | Roo (Code) | feat: add day-before delivery check buttons and reschedule on delay/not-yet | ✅ |
| `97ad8ce` | Roo (Code) | fix: delivery_scheduled reminder must not fire before delivery date | ✅ |
| `0fd0bff` | Roo (Code) | chore: commit pending changes — .clinerules deployment docs, .dockerignore fix, memory updates | ✅ |
| `911cbb2` | Roo (Code) | fix: restore process of elimination GUI buttons, add dashboard link as alternative | ✅ |
| `038e330` | Roo (Code) | feat: extend inline Confirm/Cancel to ALL telegram bot action buttons | ✅ |
| `e81386d` | Roo (Code) | feat: move en route confirmation and 888 passcode to inline GUI buttons | ✅ |
| `a50e7c7` | Roo (Code) | fix: advance to production_pending stage instead of marking production started | ✅ |
| `f41b816` | Roo (Code) | fix: copy package.json to runner stage for ESM module resolution | ✅ |
| `f383b4b` | Roo (Code) | update tsx to latest in api and telegram-bot lockfiles | ✅ |
| `4c2edc6` | Roo (Code) | fix dashboard .dockerignore: keep tsconfig.json and next.config.ts for build | ✅ |
| `50bf114` | Roo (Code) | fix: use npm install for file-store (lockfile not tracked in git) | ✅ |
| `e77edaa` | Roo (Code) | fix: use npm install for backup-agent (no lockfile), fix file-store npm ci flag | ✅ |
| `a44ba31` | Roo (Code) | fix .dockerignore: keep tsconfig.json in build context | ✅ |
| `901f28d` | Roo (Code) | optimize Dockerfiles: multi-stage builds, .dockerignore, npm ci, cache cleanup | ✅ |

## 2026-05-23

| Commit | Extension | Description | Deployed |
|--------|-----------|-------------|----------|
| `e9daa2d` | Roo (Code) | fix: bump SW cache name to v3 to force cache clear for sales.homeu login | ✅ VPS `ada6e80` |
| `a5bb651` | Roo (Code) | fix: merge subUsers field from defaults into stored accounts | ✅ |
| `7348a05` | Roo (Code) | feat: add sub-user login flow for shared accounts (Sales Team with Mariella/Cathlyn codes) | ✅ |

## 2026-05-22

| Commit | Extension | Description | Deployed |
|--------|-----------|-------------|----------|
| `76f07c5` | Roo (Code) | feat: add confirmation passcode guard (888) for consequential Telegram bot GUI actions | ✅ |
| `2061cef` | Roo (Code) | feat: add role-based route guard in AuthGuard for non-admin users | ✅ |
| *(other commits from this date — see git log)* | | | ✅ |

## 2026-05-21

| Commit | Extension | Description | Deployed |
|--------|-----------|-------------|----------|
| *(full production tracking, agent notes, OTP gate, Hermes Claw, VPS deployment system)* | | | ✅ |

## 2026-05-20

| Commit | Extension | Description | Deployed |
|--------|-----------|-------------|----------|
| *(clients page, inventory overhaul, delivery gap fixes, Telegram UX overhaul, Google Drive upload)* | | | ✅ |

---

## How to add entries

```markdown
| `abc1234` | Roo/Claude/Codex/Kimi | feat/fix/chore: description | ✅/❌ |
```

- **Extension**: Use `Roo`, `Claude`, `Codex`, `Kimi`, or `Manual`
- **Deployed**: `✅` if deployed to VPS, `❌` if committed but not yet deployed
- **VPS tag**: Add `✅ VPS <commit>` when the VPS is confirmed at a specific commit

| `this commit` | Codex | update: Production Finished table tracks partially finished orders through inventory arrival verification with estimated arrival date | pending deploy |
| `ff25dee` | Codex | update: context-aware item production Telegram reminder buttons and item production day prompts | deployed VPS `ff25dee` |
| `3a2263b` | Codex | fix: auto-finish item-level production when all partial items are finished, then trigger en-route Telegram workflow | deployed VPS `ff25dee` |

| `this commit` | Codex | update: make Production Finished orders expandable with item list and per-item inventory arrival dates | pending deploy |











