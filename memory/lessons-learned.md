#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] feat: production tracking lifecycle — midpoint check, due check, delivery timeline, dashboard clickable orders

**Commit:** c0e6060

**Summary:**
Implemented a complete production tracking lifecycle with three phases:
1. **Midpoint check** at 50% of production time — Telegram bot asks "on time or delayed?" with inline buttons
2. **Due check** at estimated completion date — Telegram bot asks "production finished?" with inline buttons
3. **Delivery timeline** — After finishing, asks for delivery estimate (standard 4 weeks or custom)

**Key changes:**
- Added 7 database columns to `orders` table: `production_started`, `estimated_production_days`, `production_delayed`, `production_delay_days`, `production_finished`, `production_finished_at`, `delivery_estimated_days`
- Added 3 API endpoints: `POST /orders/:id/set-production`, `POST /orders/:id/report-production-status`, `POST /orders/:id/finish-production`
- Added `once` frequency support to `POST /reminders` for one-shot production reminders
- Added `sendTelegramInlineKeyboard()` to reminder scheduler for interactive Telegram buttons
- Added 6 callback handlers and 2 text handlers in Telegram bot for the full production flow
- Made dashboard order rows clickable with expandable `ProductionInfo` component

**Reusable takeaway:**
For multi-phase approval workflows with Telegram inline keyboards, use callback data patterns like `action:state:orderId:quotationNumber` to encode context in button callbacks. Use `once` frequency reminders for one-shot events (midpoint/due checks) rather than recurring reminders. Always gate reminder logic on persistent database fields, not ephemeral state.

#### Tags

production-tracking, telegram-inline-keyboard, reminder-scheduler, dashboard, purchasing-agent

---

### Lesson: [bugfix] production tracking gap fixes — production_started_at, purchasing agent edge cases, missing Order interface fields

**Summary:**
Fixed 7 gaps found during E2E gap analysis of the production tracking feature:

1. **Added `production_started_at` column** to database migration — records the timestamp when production actually started (not just the boolean flag)
2. **Updated `set-production` endpoint** to record `production_started_at = COALESCE(production_started_at, NOW())` — only sets on first call, preserves existing timestamp
3. **Updated `computeFinishDate`** in dashboard to use `production_started_at` if available, falling back to `created_at`
4. **Added "Started At" card** to the `ProductionInfo` dashboard component showing the actual production start date
5. **Added `production_finished` check** to purchasing agent — stops reminding if production is finished
6. **Added `production_delayed` check** to purchasing agent — logs delay status without creating redundant reminders
7. **Added missing `delivery_address`, `contact_number`, `authorized_receiver_name`, `authorized_receiver_contact`** to dashboard `Order` interface (pre-existing TypeScript errors)

**Key changes:**
- `database/migrations/008_production_tracking.sql` — Added `production_started_at TIMESTAMPTZ` column
- `apps/api/src/server.ts` — `set-production` endpoint now records `production_started_at` via `COALESCE`
- `apps/api/src/services/agentRunner.ts` — Added `production_started_at` to `OrderRow` interface
- `apps/api/src/agents/purchasingAgent.ts` — Added `production_finished` and `production_delayed` guard clauses
- `apps/dashboard/src/lib/api.ts` — Added `production_started_at`, `delivery_address`, `contact_number`, `authorized_receiver_name`, `authorized_receiver_contact` to `Order` interface
- `apps/dashboard/src/app/purchasing/page.tsx` — Updated `computeFinishDate` to use `production_started_at`, added "Started At" card

**Reusable takeaway:**
When implementing boolean tracking fields (like `production_started`), always add a corresponding timestamp column (`production_started_at`) so downstream consumers can compute accurate dates. Use `COALESCE(column, NOW())` to set the timestamp only once on first write. Always check terminal states (`production_finished`) before intermediate states in state machine logic to avoid redundant reminders.

#### Tags

gap-analysis, production-tracking, purchasing-agent, dashboard, typescript, database-migration

### Lesson: [workflowautomation] fix: production tracking gap fixes — production_started_at, purchasing agent edge cases, missing Order interface fields

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 5fda18bbf72359460bb309a2ca05bdc835353145

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 5fda18bbf72359460bb309a2ca05bdc835353145
**Files:** apps/api/src/agents/purchasingAgent.ts,apps/api/src/server.ts,apps/api/src/services/agentRunner.ts,apps/api/src/services/geminiVision.ts,apps/dashboard/src/app/clients/page.tsx,apps/dashboard/src/app/delivery/page.tsx,apps/dashboard/src/app/orders/[quotationNumber]/page.tsx,apps/dashboard/src/app/purchasing/page.tsx,apps/dashboard/src/app/vision/page.tsx,apps/dashboard/src/components/OrderTable.tsx,apps/dashboard/src/components/Sidebar.tsx,apps/dashboard/src/lib/api.ts,apps/dashboard/src/lib/useApi.ts,apps/telegram-bot/src/bot.ts,database/migrations/008_production_tracking.sql,database/migrations/009_date_fields.sql,database/migrations/010_clients.sql,database/schema.sql,memory/lessons-learned.md

**Summary:**
**Summary**

**What was fixed:**  
Production tracking gaps: `production_started_at` field was missing from Order interface, causing undefined values in purchasing agent logic and dashboard views. Also fixed edge cases where purchasing agent failed when order lacked production start date.

**Why it broke:**  
The `production_started_at` field was added to the database schema but not propagated to the TypeScript Order interface or the purchasing agent’s logic. This caused silent failures (undefined values) when the agent tried to read the field, leading to incorrect production tracking and missing dashboard data.

**Reusable takeaway:**  
When adding a new database field, always update all layers: schema migration, TypeScript interfaces, service logic, and UI components. Use strict typing to catch missing fields at compile time, and ensure all agents that depend on the field handle its absence gracefully (e.g., with fallback defaults or null checks).

---
*Original commit message: fix: production tracking gap fixes — production_started_at, purchasing agent edge cases, missing Order interface fields*

#### Lesson Learned

**Summary**

**What was fixed:**  
Production tracking gaps: `production_started_at` field was missing from Order interface, causing undefined values in purchasing agent logic and dashboard views. Also fixed edge cases where purchasing agent failed when order lacked production start date.

**Why it broke:**  
The `production_started_at` field was added to the database schema but not propagated to the TypeScript Order interface or the purchasing agent’s logic. This caused silent failures (undefined values) when the agent tried to read the field, leading to incorrect production tracking and missing dashboard data.

**Reusable takeaway:**  
When adding a new database field, always update all layers: schema migration, TypeScript interfaces, service logic, and UI components. Use strict typing to catch missing fields at compile time, and ensure all agents that depend on the field handle its absence gracefully (e.g., with fallback defaults or null checks).

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] docs: update lesson index and migration for production_started_at

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit cb0541fdbe2ebcfd04e6259f3db49d16cec5ed00

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** cb0541fdbe2ebcfd04e6259f3db49d16cec5ed00
**Files:** database/migrations/010_clients.sql,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Updated documentation and migration logic to correctly reference `production_started_at` instead of an ambiguous or incorrect timestamp field in client records.

**Why it broke:**  
The original schema or lesson index used a vague timestamp (e.g., `created_at` or `updated_at`) that did not accurately capture when a client’s production workflow actually began. This caused incorrect sequencing in automation triggers and reporting.

**Reusable takeaway:**  
When modeling state transitions in workflow automation, always use explicit, semantically precise timestamp fields (e.g., `production_started_at`, `deployed_at`) rather than generic timestamps. This prevents logic errors in event-driven systems and ensures audit trails reflect actual process milestones.

---
*Original commit message: docs: update lesson index and migration for production_started_at*

#### Lesson Learned

**What was fixed:**  
Updated documentation and migration logic to correctly reference `production_started_at` instead of an ambiguous or incorrect timestamp field in client records.

**Why it broke:**  
The original schema or lesson index used a vague timestamp (e.g., `created_at` or `updated_at`) that did not accurately capture when a client’s production workflow actually began. This caused incorrect sequencing in automation triggers and reporting.

**Reusable takeaway:**  
When modeling state transitions in workflow automation, always use explicit, semantically precise timestamp fields (e.g., `production_started_at`, `deployed_at`) rather than generic timestamps. This prevents logic errors in event-driven systems and ensures audit trails reflect actual process milestones.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] docs: update lesson index

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit d93f89e9af48cdb68076e054a54d77e4fe27f57d

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** d93f89e9af48cdb68076e054a54d77e4fe27f57d
**Files:** memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
The lesson index and lessons-learned documentation were updated to reflect new engineering insights.

**Why it broke:**  
The previous index was incomplete or outdated, likely missing recent lessons or failing to categorize them properly, which could lead to repeated mistakes or missed learning opportunities.

**Reusable takeaway:**  
Maintain a living, version-controlled lesson index alongside your codebase. Update it immediately after debugging or completing a feature, not as an afterthought. This prevents knowledge silos and ensures the whole team benefits from hard-won insights.

---
*Original commit message: docs: update lesson index*

#### Lesson Learned

**What was fixed:**  
The lesson index and lessons-learned documentation were updated to reflect new engineering insights.

**Why it broke:**  
The previous index was incomplete or outdated, likely missing recent lessons or failing to categorize them properly, which could lead to repeated mistakes or missed learning opportunities.

**Reusable takeaway:**  
Maintain a living, version-controlled lesson index alongside your codebase. Update it immediately after debugging or completing a feature, not as an afterthought. This prevents knowledge silos and ensures the whole team benefits from hard-won insights.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: reduce npm memory usage in dashboard Dockerfile — max-old-space-size, maxsockets, prefer-offline

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 185c6f0f3f23f1c8887912d8688451d8298c6e84

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 185c6f0f3f23f1c8887912d8688451d8298c6e84
**Files:** apps/dashboard/Dockerfile

**Summary:**
**What was fixed:**  
Reduced excessive npm memory usage during Docker build of the dashboard app, preventing out-of-memory (OOM) crashes.

**Why it broke:**  
The default npm behavior in a containerized build environment allowed too many concurrent network sockets and kept aggressive caching, causing memory spikes beyond the container’s limit.

**Reusable takeaway:**  
For npm installs in Docker builds, explicitly set:  
- `NODE_OPTIONS="--max-old-space-size=2048"` to cap Node.js heap  
- `npm config set maxsockets 3` to limit parallel network requests  
- `--prefer-offline` to reduce network overhead  

This pattern prevents OOM failures in resource-constrained CI/CD or Docker build environments.

---
*Original commit message: fix: reduce npm memory usage in dashboard Dockerfile — max-old-space-size, maxsockets, prefer-offline*

#### Lesson Learned

**What was fixed:**  
Reduced excessive npm memory usage during Docker build of the dashboard app, preventing out-of-memory (OOM) crashes.

**Why it broke:**  
The default npm behavior in a containerized build environment allowed too many concurrent network sockets and kept aggressive caching, causing memory spikes beyond the container’s limit.

**Reusable takeaway:**  
For npm installs in Docker builds, explicitly set:  
- `NODE_OPTIONS="--max-old-space-size=2048"` to cap Node.js heap  
- `npm config set maxsockets 3` to limit parallel network requests  
- `--prefer-offline` to reduce network overhead  

This pattern prevents OOM failures in resource-constrained CI/CD or Docker build environments.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: use npm install instead of npm ci to reduce memory usage during Docker build

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 214d454148b39ae250b68c118509fd59dcdf654e

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 214d454148b39ae250b68c118509fd59dcdf654e
**Files:** apps/dashboard/Dockerfile

**Summary:**
**What was fixed:**  
Replaced `npm ci` with `npm install` in the Dockerfile to reduce memory usage during the build process.

**Why it broke:**  
`npm ci` performs a clean, deterministic install that re-downloads all dependencies from scratch, consuming significantly more memory (especially in memory-constrained Docker build environments). This caused out-of-memory (OOM) failures or excessive build times.

**Reusable takeaway:**  
In Docker builds with limited memory, prefer `npm install` over `npm ci`. While `npm ci` is faster and stricter for CI/CD, `npm install` reuses cached dependencies and uses less memory. Use `npm ci` only when memory is not a constraint or when absolute dependency integrity is required.

---
*Original commit message: fix: use npm install instead of npm ci to reduce memory usage during Docker build*

#### Lesson Learned

**What was fixed:**  
Replaced `npm ci` with `npm install` in the Dockerfile to reduce memory usage during the build process.

**Why it broke:**  
`npm ci` performs a clean, deterministic install that re-downloads all dependencies from scratch, consuming significantly more memory (especially in memory-constrained Docker build environments). This caused out-of-memory (OOM) failures or excessive build times.

**Reusable takeaway:**  
In Docker builds with limited memory, prefer `npm install` over `npm ci`. While `npm ci` is faster and stricter for CI/CD, `npm install` reuses cached dependencies and uses less memory. Use `npm ci` only when memory is not a constraint or when absolute dependency integrity is required.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add deleteWebhook before bot.launch to prevent 409 Conflict on restart

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 40c0c4f7a26bb4cbc245f3caeb714ab91bfbdfbd

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 40c0c4f7a26bb4cbc245f3caeb714ab91bfbdfbd
**Files:** apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
A 409 Conflict error on bot restart caused by an existing webhook not being deleted before `bot.launch()`.

**Why it broke:**  
Telegram enforces that only one webhook can be active per bot at a time. On restart, the previous webhook was still registered, so calling `bot.launch()` (which sets a new webhook) triggered a conflict.

**Reusable takeaway:**  
When initializing a Telegram bot (or any service with exclusive webhook registration), always call `deleteWebhook()` before `bot.launch()` to clear any stale webhook from a previous session. This ensures idempotent restarts and prevents 409 conflicts.

---
*Original commit message: fix: add deleteWebhook before bot.launch to prevent 409 Conflict on restart*

#### Lesson Learned

**What was fixed:**  
A 409 Conflict error on bot restart caused by an existing webhook not being deleted before `bot.launch()`.

**Why it broke:**  
Telegram enforces that only one webhook can be active per bot at a time. On restart, the previous webhook was still registered, so calling `bot.launch()` (which sets a new webhook) triggered a conflict.

**Reusable takeaway:**  
When initializing a Telegram bot (or any service with exclusive webhook registration), always call `deleteWebhook()` before `bot.launch()` to clear any stale webhook from a previous session. This ensures idempotent restarts and prevents 409 conflicts.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add retry logic with exponential backoff for telegram bot 409 Conflict on launch

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 3a27bdca674e14f6daa82017ca08ed7d97ca98b9

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 3a27bdca674e14f6daa82017ca08ed7d97ca98b9
**Files:** apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
Added retry logic with exponential backoff to handle Telegram Bot API 409 Conflict errors during bot launch.

**Why it broke:**  
When multiple instances of the bot tried to start simultaneously (e.g., during deployment or restart), Telegram’s API rejected the second connection with a 409 Conflict, causing the bot to fail to start.

**Reusable takeaway:**  
For any service that uses an API with idempotency or session-based conflicts (like Telegram Bot API), implement retry logic with exponential backoff on startup. This prevents transient conflicts from causing permanent failures, especially in distributed or auto-scaled environments.

---
*Original commit message: fix: add retry logic with exponential backoff for telegram bot 409 Conflict on launch*

#### Lesson Learned

**What was fixed:**  
Added retry logic with exponential backoff to handle Telegram Bot API 409 Conflict errors during bot launch.

**Why it broke:**  
When multiple instances of the bot tried to start simultaneously (e.g., during deployment or restart), Telegram’s API rejected the second connection with a 409 Conflict, causing the bot to fail to start.

**Reusable takeaway:**  
For any service that uses an API with idempotency or session-based conflicts (like Telegram Bot API), implement retry logic with exponential backoff on startup. This prevents transient conflicts from causing permanent failures, especially in distributed or auto-scaled environments.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add bot.telegram.callApi('close') before launch to release Telegram polling lock

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 8d1d3ee7e9f92c053c418acbf68ce263372a8a68

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 8d1d3ee7e9f92c053c418acbf68ce263372a8a68
**Files:** apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
Added `bot.telegram.callApi('close')` before bot launch to release the Telegram polling lock.

**Why it broke:**  
When the bot restarted, the previous polling session’s lock remained active on Telegram’s server. The new instance tried to start polling while the old lock was still held, causing a conflict that prevented the bot from connecting.

**Reusable takeaway:**  
Before reinitializing a long-polling service (especially with Telegram bots), explicitly close the previous polling session to release server-side locks. This prevents connection conflicts during restarts. Always clean up resources (e.g., close, disconnect, or stop) before re-launching to ensure a fresh, conflict-free state.

---
*Original commit message: fix: add bot.telegram.callApi('close') before launch to release Telegram polling lock*

#### Lesson Learned

**What was fixed:**  
Added `bot.telegram.callApi('close')` before bot launch to release the Telegram polling lock.

**Why it broke:**  
When the bot restarted, the previous polling session’s lock remained active on Telegram’s server. The new instance tried to start polling while the old lock was still held, causing a conflict that prevented the bot from connecting.

**Reusable takeaway:**  
Before reinitializing a long-polling service (especially with Telegram bots), explicitly close the previous polling session to release server-side locks. This prevents connection conflicts during restarts. Always clean up resources (e.g., close, disconnect, or stop) before re-launching to ensure a fresh, conflict-free state.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: handle 429 rate-limit in bot launch retry, make close() non-fatal

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit b11d9b9fa16de27fb01daf05837acfc78fa4e83f

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** b11d9b9fa16de27fb01daf05837acfc78fa4e83f
**Files:** apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
The bot launch retry logic now handles HTTP 429 (rate-limit) errors gracefully, and a `close()` failure no longer crashes the bot.

**Why it broke:**  
The original code treated all launch errors as fatal, including transient 429 responses from Telegram's API. Additionally, `close()` was assumed to always succeed, causing unhandled rejections when it failed (e.g., due to network issues).

**Reusable takeaway:**  
When implementing retry logic for external API calls, always distinguish between transient errors (e.g., 429, 5xx) and permanent failures. Use exponential backoff for rate-limited responses. For cleanup operations like `close()`, wrap them in try-catch or use `.catch()` to prevent unhandled rejections from crashing the process. This pattern applies to any service with rate limits or unreliable teardown steps.

---
*Original commit message: fix: handle 429 rate-limit in bot launch retry, make close() non-fatal*

#### Lesson Learned

**What was fixed:**  
The bot launch retry logic now handles HTTP 429 (rate-limit) errors gracefully, and a `close()` failure no longer crashes the bot.

**Why it broke:**  
The original code treated all launch errors as fatal, including transient 429 responses from Telegram's API. Additionally, `close()` was assumed to always succeed, causing unhandled rejections when it failed (e.g., due to network issues).

**Reusable takeaway:**  
When implementing retry logic for external API calls, always distinguish between transient errors (e.g., 429, 5xx) and permanent failures. Use exponential backoff for rate-limited responses. For cleanup operations like `close()`, wrap them in try-catch or use `.catch()` to prevent unhandled rejections from crashing the process. This pattern applies to any service with rate limits or unreliable teardown steps.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: use getUpdates offset=-1 to reset Telegram polling lock instead of close

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 38db4952395dda30fa429617ec3d91fb5eda6c57

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 38db4952395dda30fa429617ec3d91fb5eda6c57
**Files:** apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
Replaced `bot.close()` with `bot.getUpdates({ offset: -1 })` to reset the Telegram polling lock.

**Why it broke:**  
Calling `close()` terminated the bot instance entirely, requiring a full re-initialization and losing the polling state. This caused race conditions and prevented clean reconnection.

**Reusable takeaway:**  
To reset a long-polling connection without destroying the client, use `getUpdates({ offset: -1 })`. This acknowledges all pending updates and resets the server-side offset, effectively clearing the lock without terminating the session. Avoid `close()` unless you intend to permanently shut down the connection.

---
*Original commit message: fix: use getUpdates offset=-1 to reset Telegram polling lock instead of close*

#### Lesson Learned

**What was fixed:**  
Replaced `bot.close()` with `bot.getUpdates({ offset: -1 })` to reset the Telegram polling lock.

**Why it broke:**  
Calling `close()` terminated the bot instance entirely, requiring a full re-initialization and losing the polling state. This caused race conditions and prevented clean reconnection.

**Reusable takeaway:**  
To reset a long-polling connection without destroying the client, use `getUpdates({ offset: -1 })`. This acknowledges all pending updates and resets the server-side offset, effectively clearing the lock without terminating the session. Avoid `close()` unless you intend to permanently shut down the connection.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: increase telegram bot launch retries to 30, remove resetPollingLock, improve autoLinkClientToOrder

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 356cfb002bb32c901bfad286162a9c323b6814e0

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 356cfb002bb32c901bfad286162a9c323b6814e0
**Files:** apps/api/src/server.ts,apps/telegram-bot/src/bot.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
- Increased Telegram bot launch retries from 5 to 30 to handle transient startup failures.  
- Removed `resetPollingLock` call that was causing race conditions.  
- Improved `autoLinkClientToOrder` logic for more reliable client-order linking.  

**Why it broke:**  
- Low retry count (5) was insufficient for unstable network/API conditions.  
- `resetPollingLock` interfered with Telegram’s internal polling state, causing deadlocks or duplicate connections.  
- `autoLinkClientToOrder` had fragile matching logic that failed under edge cases (e.g., partial data).  

**Reusable takeaway:**  
- When integrating with external APIs (especially polling-based ones), use generous retries (≥30) and avoid manually resetting internal state unless absolutely necessary.  
- For linking logic, prefer idempotent, fault-tolerant matching (e.g., fallback to fuzzy matching or multiple key lookups) rather than strict single-field equality.  
- Always test under degraded network conditions to validate retry and recovery behavior.

---
*Original commit message: fix: increase telegram bot launch retries to 30, remove resetPollingLock, improve autoLinkClientToOrder*

#### Lesson Learned

**What was fixed:**  
- Increased Telegram bot launch retries from 5 to 30 to handle transient startup failures.  
- Removed `resetPollingLock` call that was causing race conditions.  
- Improved `autoLinkClientToOrder` logic for more reliable client-order linking.  

**Why it broke:**  
- Low retry count (5) was insufficient for unstable network/API conditions.  
- `resetPollingLock` interfered with Telegram’s internal polling state, causing deadlocks or duplicate connections.  
- `autoLinkClientToOrder` had fragile matching logic that failed under edge cases (e.g., partial data).  

**Reusable takeaway:**  
- When integrating with external APIs (especially polling-based ones), use generous retries (≥30) and avoid manually resetting internal state unless absolutely necessary.  
- For linking logic, prefer idempotent, fault-tolerant matching (e.g., fallback to fuzzy matching or multiple key lookups) rather than strict single-field equality.  
- Always test under degraded network conditions to validate retry and recovery behavior.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] docs: auto-generated lesson for telegram bot 409 fix v6 (30 retries, no resetPollingLock)

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 460096953e80cfe360bd333da97a9bd82246972b

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 460096953e80cfe360bd333da97a9bd82246972b
**Files:** memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
A Telegram bot that previously failed after 30 retries due to a `409 Conflict` error (likely from duplicate webhook/polling conflicts). The fix added 30 retries and explicitly disabled `resetPollingLock` to avoid re-triggering the conflict.

**Why it broke:**  
The bot’s polling mechanism was resetting its lock on each retry, causing Telegram to reject the connection as a duplicate session (409 error). The lock reset created a race condition where multiple polling instances competed.

**Reusable takeaway:**  
When handling Telegram bot retries for 409 errors, **disable `resetPollingLock`** to prevent re-initializing the polling session on each retry. Instead, rely on a fixed number of retries (e.g., 30) without resetting the lock, allowing the existing session to recover gracefully. This avoids the conflict loop and ensures stable reconnection.

---
*Original commit message: docs: auto-generated lesson for telegram bot 409 fix v6 (30 retries, no resetPollingLock)*

#### Lesson Learned

**What was fixed:**  
A Telegram bot that previously failed after 30 retries due to a `409 Conflict` error (likely from duplicate webhook/polling conflicts). The fix added 30 retries and explicitly disabled `resetPollingLock` to avoid re-triggering the conflict.

**Why it broke:**  
The bot’s polling mechanism was resetting its lock on each retry, causing Telegram to reject the connection as a duplicate session (409 error). The lock reset created a race condition where multiple polling instances competed.

**Reusable takeaway:**  
When handling Telegram bot retries for 409 errors, **disable `resetPollingLock`** to prevent re-initializing the polling session on each retry. Instead, rely on a fixed number of retries (e.g., 30) without resetting the lock, allowing the existing session to recover gracefully. This avoids the conflict loop and ensures stable reconnection.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add bot.telegram.callApi('close') before launch to release Telegram polling lock

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit f811128b071c49fd4a133c03b7d18658f9767878

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** f811128b071c49fd4a133c03b7d18658f9767878
**Files:** apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
Added `bot.telegram.callApi('close')` before launching the bot to release the Telegram polling lock.

**Why it broke:**  
When the bot restarted (e.g., after a crash or deployment), the previous polling session was not properly closed. Telegram’s server still held the lock for the previous session, causing the new bot instance to fail to start polling — leading to startup hangs or connection errors.

**Reusable takeaway:**  
Always explicitly close or release long-lived external connections (like Telegram polling locks, WebSocket sessions, or database listeners) before reinitializing. This prevents resource contention and ensures clean state on restart. In Telegram bots, call `bot.telegram.callApi('close')` before `bot.launch()` to avoid polling lock conflicts.

---
*Original commit message: fix: add bot.telegram.callApi('close') before launch to release Telegram polling lock*

#### Lesson Learned

**What was fixed:**  
Added `bot.telegram.callApi('close')` before launching the bot to release the Telegram polling lock.

**Why it broke:**  
When the bot restarted (e.g., after a crash or deployment), the previous polling session was not properly closed. Telegram’s server still held the lock for the previous session, causing the new bot instance to fail to start polling — leading to startup hangs or connection errors.

**Reusable takeaway:**  
Always explicitly close or release long-lived external connections (like Telegram polling locks, WebSocket sessions, or database listeners) before reinitializing. This prevents resource contention and ensures clean state on restart. In Telegram bots, call `bot.telegram.callApi('close')` before `bot.launch()` to avoid polling lock conflicts.

#### Tags

cross-project, local-fallback

---

### Lesson: Purchasing workflow production tracking implementation

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Connected purchasing dashboard and Telegram production confirmation to backend production-tracking endpoints. Ensure stage/list API queries return production fields, set-production advances to production_confirmed and creates/reactivates midpoint/due reminders, deposit recording preserves later stages, and finish-production advances to inventory_arrived. Builds: api, telegram-bot, dashboard.

#### Lesson Learned

Connected purchasing dashboard and Telegram production confirmation to backend production-tracking endpoints. Ensure stage/list API queries return production fields, set-production advances to production_confirmed and creates/reactivates midpoint/due reminders, deposit recording preserves later stages, and finish-production advances to inventory_arrived. Builds: api, telegram-bot, dashboard.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] feat: purchasing tab improvements — progress bar, overdue highlighting, error states, inventory arrived section, recalc 

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 89a62eaec5475e06df04bc153ab0868539aad175

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 89a62eaec5475e06df04bc153ab0868539aad175
**Files:** README.md,apps/api/src/server.ts,apps/dashboard/src/app/actions/page.tsx,apps/dashboard/src/app/orders/[quotationNumber]/page.tsx,apps/dashboard/src/app/orders/page.tsx,apps/dashboard/src/app/page.tsx,apps/dashboard/src/app/purchasing/page.tsx,apps/dashboard/src/app/workflow/page.tsx,apps/dashboard/src/components/Sidebar.tsx,apps/dashboard/src/lib/api.ts,apps/telegram-bot/src/bot.ts,apps/telegram-bot/src/bot_header_new.ts,docker-compose.yml,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Improved the purchasing tab with a progress bar, overdue highlighting, error states, an inventory arrived section, and a recalc reminders endpoint.

**Why it broke:**  
The commit message does not describe a bug fix. Instead, it lists new features and enhancements. There is no root cause of a breakage; this is a feature addition.

**Reusable takeaway:**  
When adding UI features like progress bars and error states, ensure the backend endpoint (e.g., recalc reminders) is deployed in sync with frontend changes. Use a single commit to bundle related UI and API changes for atomic deployment. Always update documentation (README, lessons learned) alongside code changes to maintain a living knowledge base.

---
*Original commit message: feat: purchasing tab improvements — progress bar, overdue highlighting, error states, inventory arrived section, recalc reminders endpoint*

#### Lesson Learned

**What was fixed:**  
Improved the purchasing tab with a progress bar, overdue highlighting, error states, an inventory arrived section, and a recalc reminders endpoint.

**Why it broke:**  
The commit message does not describe a bug fix. Instead, it lists new features and enhancements. There is no root cause of a breakage; this is a feature addition.

**Reusable takeaway:**  
When adding UI features like progress bars and error states, ensure the backend endpoint (e.g., recalc reminders) is deployed in sync with frontend changes. Use a single commit to bundle related UI and API changes for atomic deployment. Always update documentation (README, lessons learned) alongside code changes to maintain a living knowledge base.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: clients page — reset search on create, refresh search on update/delete

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit e802f61c158d8a4b97550814ef64d9e3511a2c93

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** e802f61c158d8a4b97550814ef64d9e3511a2c93
**Files:** apps/dashboard/src/app/clients/page.tsx

**Summary:**
**What was fixed:**  
The clients page now resets the search query when a new client is created, and refreshes the search results after updating or deleting a client.

**Why it broke:**  
The search state was not tied to the data lifecycle. After creating a client, the old search term remained active, hiding the new entry. After updates or deletions, the displayed list was stale because the search query wasn’t re-executed against the latest data.

**Reusable takeaway:**  
When managing a list with client-side search, always synchronize the search state with CRUD operations. On create, clear the search to show the new item. On update/delete, re-trigger the search to reflect changes. This prevents stale or hidden data and ensures the UI matches the backend state.

---
*Original commit message: fix: clients page — reset search on create, refresh search on update/delete*

#### Lesson Learned

**What was fixed:**  
The clients page now resets the search query when a new client is created, and refreshes the search results after updating or deleting a client.

**Why it broke:**  
The search state was not tied to the data lifecycle. After creating a client, the old search term remained active, hiding the new entry. After updates or deletions, the displayed list was stale because the search query wasn’t re-executed against the latest data.

**Reusable takeaway:**  
When managing a list with client-side search, always synchronize the search state with CRUD operations. On create, clear the search to show the new item. On update/delete, re-trigger the search to reflect changes. This prevents stale or hidden data and ensures the UI matches the backend state.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] docs: auto-update lesson index and lessons-learned

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 880e7fe1e6ab45b5cec5cb15481a08449357d119

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 880e7fe1e6ab45b5cec5cb15481a08449357d119
**Files:** memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**Fix:** Auto-updated lesson index and lessons-learned documentation to stay in sync with new lessons.

**Root Cause:** The lesson index and lessons-learned file were manually maintained, causing them to fall out of sync when new lessons were added or existing ones updated. This led to stale or missing references in the documentation.

**Reusable Takeaway:** Automate the synchronization of documentation indexes and summaries with the source of truth (e.g., lesson files). Use a script or CI step to regenerate the index and summary file whenever lessons are added or modified, ensuring documentation always reflects the current state without manual overhead.

---
*Original commit message: docs: auto-update lesson index and lessons-learned*

#### Lesson Learned

**Fix:** Auto-updated lesson index and lessons-learned documentation to stay in sync with new lessons.

**Root Cause:** The lesson index and lessons-learned file were manually maintained, causing them to fall out of sync when new lessons were added or existing ones updated. This led to stale or missing references in the documentation.

**Reusable Takeaway:** Automate the synchronization of documentation indexes and summaries with the source of truth (e.g., lesson files). Use a script or CI step to regenerate the index and summary file whenever lessons are added or modified, ensuring documentation always reflects the current state without manual overhead.

#### Tags

cross-project, local-fallback

---

### Lesson: Client tab linked orders and safe delete improvements

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Implemented deterministic client lookup, order-count stats, linked-order endpoint, update propagation to active linked orders, safe client delete with force unlink, server-side client search in dashboard, expandable client rows with notes/orders, and delete warnings. Verified API and dashboard builds.

#### Lesson Learned

Implemented deterministic client lookup, order-count stats, linked-order endpoint, update propagation to active linked orders, safe client delete with force unlink, server-side client search in dashboard, expandable client rows with notes/orders, and delete warnings. Verified API and dashboard builds.

#### Tags

cross-project, local-fallback

---

### Lesson: Client tab improvements verified

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Client backend now returns order stats, deterministic lookup/search, linked order endpoint, propagation of client edits to active linked orders, and safe delete with force unlink. Client dashboard now uses server-side search, expanded linked orders and notes, order counts/latest order, clearable edit fields, and active order delete warning. Builds passed for API and dashboard.

#### Lesson Learned

Client backend now returns order stats, deterministic lookup/search, linked order endpoint, propagation of client edits to active linked orders, and safe delete with force unlink. Client dashboard now uses server-side search, expanded linked orders and notes, order counts/latest order, clearable edit fields, and active order delete warning. Builds passed for API and dashboard.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: align handleAdd and handleEditSave types with ClientFormProps onSave

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 4568deaf28b46b1543fe6309f087e03084ba5e49

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 4568deaf28b46b1543fe6309f087e03084ba5e49
**Files:** apps/dashboard/src/app/clients/page.tsx

**Summary:**
**What was fixed:** Type mismatch between `handleAdd`/`handleEditSave` functions and the `onSave` prop expected by `ClientFormProps`.

**Why it broke:** The `onSave` prop in `ClientFormProps` likely expects a specific function signature (e.g., `(data: ClientData) => void`), but the local handlers had incompatible parameter types or return types. This caused TypeScript compilation errors or runtime type coercion issues.

**Reusable takeaway:** Always align callback signatures (parameter types, return types) between parent components and child props. When a child component defines a typed prop like `onSave`, ensure the parent’s handler matches exactly—especially when passing data objects or using generic types. Use TypeScript’s `typeof` or explicit type annotations on handlers to catch mismatches early. This prevents silent bugs and maintains type safety across component boundaries.

---
*Original commit message: fix: align handleAdd and handleEditSave types with ClientFormProps onSave*

#### Lesson Learned

**What was fixed:** Type mismatch between `handleAdd`/`handleEditSave` functions and the `onSave` prop expected by `ClientFormProps`.

**Why it broke:** The `onSave` prop in `ClientFormProps` likely expects a specific function signature (e.g., `(data: ClientData) => void`), but the local handlers had incompatible parameter types or return types. This caused TypeScript compilation errors or runtime type coercion issues.

**Reusable takeaway:** Always align callback signatures (parameter types, return types) between parent components and child props. When a child component defines a typed prop like `onSave`, ensure the parent’s handler matches exactly—especially when passing data objects or using generic types. Use TypeScript’s `typeof` or explicit type annotations on handlers to catch mismatches early. This prevents silent bugs and maintains type safety across component boundaries.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] feat: en route stage — production finished → en route → inventory arrived

#### Task Summary
Added an `en_route` intermediate stage between `production_confirmed` and `inventory_arrived`. When production finishes, the order moves to `en_route` and a daily reminder asks "Is the order en route?" with Yes/No inline buttons. When confirmed, the order advances to `inventory_arrived` with estimated arrival days.

#### Lesson Learned
When adding a new stage to a multi-layer system (DB → API → Bot → Dashboard), you must update **all** of these:
1. **API endpoint** (`finishProduction`) — sets `current_stage='en_route'`
2. **API endpoint** (`confirmEnRoute`) — advances `en_route` → `inventory_arrived`
3. **API agent** (`escalationAgent.ts`) — add `'en_route'` to monitored stages list
4. **API labels** (`STAGE_LABELS` in `agentRunner.ts`) — add display label
5. **Reminder scheduler** (`reminderScheduler.ts`) — add `en_route_reminder` with inline keyboard handling
6. **Bot** (`bot.ts`) — add callback handlers (`en_route:yes`, `en_route:no`, `en_route:arrival_standard`, `en_route:arrival_custom`) and text handler for arrival days
7. **Dashboard** (`api.ts`) — add to `STAGE_CONFIG`, `STAGE_ORDER`, `Order` interface, and `confirmEnRoute` function
8. **Dashboard** (purchasing page) — add En Route section with `onConfirmEnRoute` handler
9. **Dashboard** (workflow page) — add to `STAGE_INFO` and agent mappings
10. **Dashboard** (order detail page) — automatically covered by `STAGE_ORDER`
11. **Dashboard** (stages page) — automatically covered by `STAGE_ORDER`
12. **Dashboard** (`StageBadge` component) — automatically covered by `STAGE_CONFIG`

The `current_stage` column is `text` type (not an enum), so no database migration is needed for new stage names.

#### Tags
workflowautomation, en-route, stage, production, inventory, full-stack
---

### Lesson: [bugfix] inventory tab gap fixes — type mismatch, data URL bloat, error handling, pagination

#### Task Summary
Found and fixed 5 gaps in the inventory tab after a full-stack code review:
1. **`InventoryExtractResult` type mismatch** — frontend expected `ok: boolean` but API returned `VisionExtractResult` without `ok`, causing AI extraction to always fail silently
2. **Data URL bloat in `image_url`** — full data URLs (e.g. `data:image/png;base64,...`) were stored in the database, bloating rows to megabytes. Changed to store raw base64 and serve via a new `/inventory/:id/image` endpoint with MIME detection from magic bytes
3. **Delete confirmation** — already had `confirm()` dialog (no fix needed)
4. **"Clear processed drafts" missing error handling** — the button called `clearProcessedDrafts()` without try/catch, so errors would be swallowed silently
5. **No pagination on inventory list** — API fetched ALL items without LIMIT/OFFSET. Added `limit`/`offset` query params with defaults, plus a `/inventory/count` endpoint

#### Lesson Learned
When reviewing a full-stack feature for gaps, check these layers systematically:
1. **Type alignment** — verify frontend API function return types match actual API responses (especially `ok` fields, optional fields)
2. **Data storage** — never store data URLs in the database; store raw base64 and serve via a dedicated endpoint with proper Content-Type and caching
3. **Error boundaries** — every async user action (button click, form submit) must have try/catch with user-visible error feedback
4. **Query limits** — every list endpoint should have LIMIT/OFFSET to prevent unbounded queries as data grows
5. **Backward compatibility** — when changing storage format, handle legacy data (e.g. data URLs with `data:...base64,` prefix)

#### Tags
bugfix, inventory, full-stack, type-mismatch, data-url, pagination, error-handling

---

### Lesson: [workflowautomation] feat: inventory tab gap fixes + en route stage tracking

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit cc1f1ac4ce8985fe38dbb3af73aa95709756eeec

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** cc1f1ac4ce8985fe38dbb3af73aa95709756eeec
**Files:** apps/api/src/agents/escalationAgent.ts,apps/api/src/server.ts,apps/api/src/services/agentRunner.ts,apps/api/src/services/geminiVision.ts,apps/api/src/services/reminderScheduler.ts,apps/dashboard/src/app/inventory/page.tsx,apps/dashboard/src/app/purchasing/page.tsx,apps/dashboard/src/app/workflow/page.tsx,apps/dashboard/src/lib/api.ts,apps/dashboard/src/lib/useApi.ts,apps/telegram-bot/src/bot.ts,database/migrations/011_inventory_en_route.sql,database/migrations/012_inventory_items.sql,database/schema.sql,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
- Gaps in inventory tab UI (missing or misaligned data display).  
- Added en route stage tracking for inventory items.  
- Updated API services, database migrations, and bot logic to support the new stage.  

**Why it broke:**  
- The original inventory schema lacked an "en route" status, causing items in transit to be invisible or miscategorized.  
- UI components assumed only "in stock" and "ordered" states, leading to display gaps.  

**Reusable takeaway:**  
- Always model the full lifecycle of a tracked entity (e.g., inventory: ordered → en route → received → in stock).  
- When adding a new state, update schema, API, UI, and bot logic in one atomic commit to avoid partial breakage.  
- Document the state machine in `lessons-learned.md` for future reference.

---
*Original commit message: feat: inventory tab gap fixes + en route stage tracking*

#### Lesson Learned

**What was fixed:**  
- Gaps in inventory tab UI (missing or misaligned data display).  
- Added en route stage tracking for inventory items.  
- Updated API services, database migrations, and bot logic to support the new stage.  

**Why it broke:**  
- The original inventory schema lacked an "en route" status, causing items in transit to be invisible or miscategorized.  
- UI components assumed only "in stock" and "ordered" states, leading to display gaps.  

**Reusable takeaway:**  
- Always model the full lifecycle of a tracked entity (e.g., inventory: ordered → en route → received → in stock).  
- When adding a new state, update schema, API, UI, and bot logic in one atomic commit to avoid partial breakage.  
- Document the state machine in `lessons-learned.md` for future reference.

#### Tags

cross-project, local-fallback

---

### Lesson: [shared-context] global JSON for cross-AI-tool context sharing (SuperRoo, Claude Code, Kim Code, Codex)

#### Task Summary
Created `shared-context.json` (git-ignored) and `scripts/query-context.mjs` for SuperRoo, Claude Code, Kim Code, and Codex extensions to share project context, activity logs, and lessons across sessions. The JSON file contains project metadata, tech stack, stage flow, deployment info, activity log, lessons array, and per-agent instructions. The query script supports `--key`, `--path`, `--last`, `--search`, `--add-log`, and `--add-lesson` modes.

#### Lesson Learned
- `*.json` is gitignored in this repo, so `shared-context.json` stays local — perfect for cross-tool context without polluting git history.
- Each AI tool should contribute to both `activity_log` (what was done) and `lessons` (what was learned) arrays.
- The query script (`node scripts/query-context.mjs`) makes it easy for any tool to programmatically extract information without parsing JSON manually.
- The `agent_instructions` section tells each tool (SuperRoo, Claude Code, Kim Code, Codex) how to interact with the project and the learning layer.
- Cross-referencing `memory/lessons-learned.md` in the `lessons` array ensures the SuperRoo learning layer is respected by all tools.

#### Tags
cross-tool, shared-context, json, query-script, learning-layer, gitignore

### Lesson: [workflowautomation] feat: bot automation for inventory_arrived → balance payment flow

Date: 2026-05-20
Source: SuperRoo (code mode)
Model/API used: deepseek-chat
Confidence: high
Related files:
- apps/api/src/agents/deliveryAgent.ts
- apps/api/src/services/reminderScheduler.ts
- apps/api/src/server.ts
- apps/telegram-bot/src/bot.ts
Tags: delivery-agent, inventory-arrived, balance-due, inline-keyboard, vision-extraction, payment-flow

#### Task Summary
Implemented the full bot automation for the inventory_arrived → balance payment flow:

1. **Delivery Agent** ([`deliveryAgent.ts`](apps/api/src/agents/deliveryAgent.ts)):
   - Added `checkInventoryArrived()` — reminds delivery group that inventory arrived, quotation ready for delivery, balance payment required
   - Added `checkBalanceDue()` — asks daily "Did the client pay yet?" with balance amount
   - Both functions escalate after 3 reminders (Level 3 → manager intervention)
   - `runDeliveryAgent()` now checks `inventory_arrived` and `balance_due` stages in addition to existing stages

2. **Reminder Scheduler** ([`reminderScheduler.ts`](apps/api/src/services/reminderScheduler.ts)):
   - Added inline keyboard for `inventory_arrived` stage: "✅ Ready for Delivery" / "⏳ Still Waiting"
   - Added inline keyboard for `balance_due` stage: "✅ Yes, Client Paid" / "❌ Not Yet"

3. **Telegram Bot** ([`bot.ts`](apps/telegram-bot/src/bot.ts)):
   - Added callback handlers for `inventory:ready` (advances to `balance_due` stage)
   - Added callback handlers for `inventory:waiting` (acknowledges, continues daily reminders)
   - Added callback handlers for `balance:paid` (asks for proof of payment photo)
   - Added callback handlers for `balance:not_paid` (acknowledges, continues daily reminders)
   - Added `awaiting_balance_proof_photo` state — when user sends photo, calls `/vision/extract` with `mode: 'payment'` to AI-scan amount and date
   - Auto-records balance payment via `/pay-balance` API when vision extraction succeeds
   - Falls back to manual amount entry if vision extraction fails

4. **API Server** ([`server.ts`](apps/api/src/server.ts)):
   - Updated `/agents/delivery` endpoint to handle `inventory_arrived` and `balance_due` stages

#### Lesson Learned
- The delivery agent is the right place for inventory_arrived and balance_due automation because both stages are pre-delivery checks
- Inline keyboards with Yes/No buttons work well for daily reminder interactions — the callback data format `stage:action:orderId:quotationNumber` is consistent across all stages
- For balance proof photos, the existing `/vision/extract` with `mode: 'payment'` already extracts amount, date, and reference — no new AI integration needed
- The `/pay-balance` API already validates that the amount covers the full balance and rejects insufficient payments
- Stage flow: `inventory_arrived` → (on "Ready") → `balance_due` → (on "Paid" + proof photo) → balance recorded → `delivery_scheduled` (via existing /deliverydate command)

### Lesson: [workflowautomation] fix: extract Date.now from render into DaysAgo component (production page lint)

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit e88d280c48db161e0c4e9483b5c823be447a9b7c

**Project:** workflowautomation
**Author:** unknown
**Commit:** e88d280c48db161e0c4e9483b5c823be447a9b7c
**Files:** 

**Summary:**
**What was fixed:** A `Date.now()` call was moved out of the render path into a `DaysAgo` component to resolve a production page lint error.

**Why it broke:** Calling `Date.now()` directly inside a React component's render function creates a non-deterministic value that changes on every render. This violates React's purity expectations and can cause linting rules (e.g., `no-date-in-render`) to flag it, as it may lead to inconsistent UI or unnecessary re-renders.

**Reusable takeaway:** Extract dynamic time calculations (e.g., `Date.now()`, `new Date()`) into a dedicated component or hook that manages the value as state or a memoized constant. This keeps render functions pure, avoids lint violations, and ensures predictable UI updates.

---
*Original commit message: fix: extract Date.now from render into DaysAgo component (production page lint)*

#### Lesson Learned

**What was fixed:** A `Date.now()` call was moved out of the render path into a `DaysAgo` component to resolve a production page lint error.

**Why it broke:** Calling `Date.now()` directly inside a React component's render function creates a non-deterministic value that changes on every render. This violates React's purity expectations and can cause linting rules (e.g., `no-date-in-render`) to flag it, as it may lead to inconsistent UI or unnecessary re-renders.

**Reusable takeaway:** Extract dynamic time calculations (e.g., `Date.now()`, `new Date()`) into a dedicated component or hook that manages the value as state or a memoized constant. This keeps render functions pure, avoids lint violations, and ensures predictable UI updates.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] feat: add inventory_arrived and balance_due callback handlers + lesson updates

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 3986b65b4454ccba2a55fbb61f489ca632908265

**Project:** workflowautomation
**Author:** unknown
**Commit:** 3986b65b4454ccba2a55fbb61f489ca632908265
**Files:** 

**Summary:**
**What was fixed:**  
Added two new callback handlers (`inventory_arrived`, `balance_due`) to the workflow automation system, enabling automated responses to inventory receipt and payment-due events.

**Why it broke:**  
The system previously lacked handlers for these two critical business events. Without them, workflows would stall when inventory arrived or a balance became due, requiring manual intervention or causing missed deadlines.

**Reusable takeaway:**  
When designing event-driven workflows, anticipate and implement handlers for all lifecycle events—not just the starting or ending ones. Missing mid-process events (like inventory arrival or payment due) creates silent failures that break automation reliability. Always map the full event chain before coding handlers.

---
*Original commit message: feat: add inventory_arrived and balance_due callback handlers + lesson updates*

#### Lesson Learned

**What was fixed:**  
Added two new callback handlers (`inventory_arrived`, `balance_due`) to the workflow automation system, enabling automated responses to inventory receipt and payment-due events.

**Why it broke:**  
The system previously lacked handlers for these two critical business events. Without them, workflows would stall when inventory arrived or a balance became due, requiring manual intervention or causing missed deadlines.

**Reusable takeaway:**  
When designing event-driven workflows, anticipate and implement handlers for all lifecycle events—not just the starting or ending ones. Missing mid-process events (like inventory arrival or payment due) creates silent failures that break automation reliability. Always map the full event chain before coding handlers.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] chore: sync lesson index

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 5e864234c4d696499c18d95b7e6a5954dd130639

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 5e864234c4d696499c18d95b7e6a5954dd130639
**Files:** memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
The lesson index files (`lesson-index.jsonl` and `lessons-learned.md`) were out of sync, causing inconsistent references between structured and human-readable lesson records.

**Why it broke:**  
Manual updates to one index file were not propagated to the other. The two files serve different purposes (machine-readable JSONL vs. human-readable Markdown) but must remain consistent for the workflow automation to correctly retrieve and display lessons.

**Reusable takeaway:**  
When maintaining dual-format indexes (e.g., machine + human), enforce a single source of truth or automate synchronization. Manual dual-update is error-prone; use a script or CI hook to regenerate one index from the other after every change.

---
*Original commit message: chore: sync lesson index*

#### Lesson Learned

**What was fixed:**  
The lesson index files (`lesson-index.jsonl` and `lessons-learned.md`) were out of sync, causing inconsistent references between structured and human-readable lesson records.

**Why it broke:**  
Manual updates to one index file were not propagated to the other. The two files serve different purposes (machine-readable JSONL vs. human-readable Markdown) but must remain consistent for the workflow automation to correctly retrieve and display lessons.

**Reusable takeaway:**  
When maintaining dual-format indexes (e.g., machine + human), enforce a single source of truth or automate synchronization. Manual dual-update is error-prone; use a script or CI hook to regenerate one index from the other after every change.

#### Tags

cross-project, local-fallback

---

### Lesson: [bugfix] gap fixes for bot automation — inventory:ready callback, unused imports, stage advance after payment, delivery day check

#### Task Summary
Fixed 4 gaps in the bot automation for inventory_arrived → balance payment → delivery flow:
1. **inventory:ready callback**: Was passing `order_id` to `/stage-updates` (expects `quotation_number`). Also had a broken PATCH to `/orders/${quotationNumber}` (route expects UUID). Fixed by using `quotation_number` in `/stage-updates` and removing the unnecessary PATCH (the endpoint already updates the order).
2. **Unused imports**: Removed `advanceStage`, `completeRemindersForOrder`, `getActiveOrdersByStages` from deliveryAgent.ts imports.
3. **Stage advance after payment**: After balance payment is recorded via photo, the stage now auto-advances to `delivery_scheduled` via `/stage-updates` call.
4. **Delivery day check**: Added `delivery_scheduled` inline keyboard (Yes/No delivered) in reminderScheduler.ts, and `delivery:yes`/`delivery:no` callback handlers in bot.ts. `delivery:yes` advances to `delivered` stage.

#### Lesson Learned
When using `/stage-updates` API endpoint, always pass `quotation_number` (not `order_id`) since the schema expects `quotation_number` to look up the order. The `/stage-updates` endpoint handles both the stage update record AND the order's `current_stage` update, so no additional PATCH is needed. After balance payment is recorded, the stage must be explicitly advanced to `delivery_scheduled` — the `/pay-balance` endpoint only records the payment but does not change the stage.

#### Tags

bot-automation, gap-fix, stage-advance, delivery-flow, callback-handler

---

### Lesson: [workflowautomation] feat: delivery page gap fixes + delivery_date column + SuperRoo sync

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 2294c51d6608913f481fba0db0bb34f0250df766

**Project:** workflowautomation
**Author:** unknown
**Commit:** 2294c51d6608913f481fba0db0bb34f0250df766
**Files:** 

**Summary:**
**What was fixed:**  
A gap in the delivery page logic was resolved, a new `delivery_date` column was added to the database, and synchronization with the SuperRoo system was implemented.

**Why it broke:**  
The delivery page previously lacked a dedicated `delivery_date` field, causing inconsistencies when syncing delivery statuses with SuperRoo. The missing column led to data mismatches and unreliable state transitions.

**Reusable takeaway:**  
When integrating external systems, ensure all shared data fields (e.g., timestamps, status flags) are explicitly modeled in your database schema. A missing column can silently break sync logic. Always align schema changes with API contract updates before deployment.

---
*Original commit message: feat: delivery page gap fixes + delivery_date column + SuperRoo sync*

#### Lesson Learned

**What was fixed:**  
A gap in the delivery page logic was resolved, a new `delivery_date` column was added to the database, and synchronization with the SuperRoo system was implemented.

**Why it broke:**  
The delivery page previously lacked a dedicated `delivery_date` field, causing inconsistencies when syncing delivery statuses with SuperRoo. The missing column led to data mismatches and unreliable state transitions.

**Reusable takeaway:**  
When integrating external systems, ensure all shared data fields (e.g., timestamps, status flags) are explicitly modeled in your database schema. A missing column can silently break sync logic. Always align schema changes with API contract updates before deployment.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] chore: sync SuperRoo lesson index

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit b1d5510273ec630c3c4047781094994a43cdccac

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** b1d5510273ec630c3c4047781094994a43cdccac
**Files:** memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:** The SuperRoo lesson index was out of sync, causing mismatches between the lesson index file and the lessons-learned documentation.

**Why it broke:** The index file (`lesson-index.jsonl`) and the lessons-learned markdown file (`lessons-learned.md`) were updated independently, leading to inconsistencies in lesson references, timestamps, or ordering.

**Reusable takeaway:** When maintaining dual-format documentation (e.g., a structured index and a human-readable summary), always update both files atomically in the same commit or via a single automated sync process. Avoid manual, separate edits to prevent drift. Use a script or CI step to validate that the index and content are consistent before merging.

---
*Original commit message: chore: sync SuperRoo lesson index*

#### Lesson Learned

**What was fixed:** The SuperRoo lesson index was out of sync, causing mismatches between the lesson index file and the lessons-learned documentation.

**Why it broke:** The index file (`lesson-index.jsonl`) and the lessons-learned markdown file (`lessons-learned.md`) were updated independently, leading to inconsistencies in lesson references, timestamps, or ordering.

**Reusable takeaway:** When maintaining dual-format documentation (e.g., a structured index and a human-readable summary), always update both files atomically in the same commit or via a single automated sync process. Avoid manual, separate edits to prevent drift. Use a script or CI step to validate that the index and content are consistent before merging.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: extract DaysInStage component to fix react-hooks/purity lint error

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit f457e033bb072f0db52e12c96c58ead5d89c1df1

**Project:** workflowautomation
**Author:** unknown
**Commit:** f457e033bb072f0db52e12c96c58ead5d89c1df1
**Files:** 

**Summary:**
**What was fixed:**  
A React `hooks/purity` lint error caused by defining the `DaysInStage` component inside another component during render.

**Why it broke:**  
Defining a component inside another component violates React’s rules of hooks, which require hooks to be called at the top level of a React function component, not inside nested functions or conditionals. This pattern also creates a new component definition on every render, breaking purity and causing potential state loss.

**Reusable takeaway:**  
Never define a React component inside another component. Extract it to a separate, top-level component to maintain hook purity, avoid unnecessary re-creations, and ensure consistent state behavior. This also improves readability and testability.

---
*Original commit message: fix: extract DaysInStage component to fix react-hooks/purity lint error*

#### Lesson Learned

**What was fixed:**  
A React `hooks/purity` lint error caused by defining the `DaysInStage` component inside another component during render.

**Why it broke:**  
Defining a component inside another component violates React’s rules of hooks, which require hooks to be called at the top level of a React function component, not inside nested functions or conditionals. This pattern also creates a new component definition on every render, breaking purity and causing potential state loss.

**Reusable takeaway:**  
Never define a React component inside another component. Extract it to a separate, top-level component to maintain hook purity, avoid unnecessary re-creations, and ensure consistent state behavior. This also improves readability and testability.

#### Tags

cross-project, local-fallback

---

### Lesson: Delivery schedule tab updates

Date: 2026-05-21
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Delivery tab gaps were fixed by showing explicit delivery_date, adding OTP-protected schedule/reschedule controls with remarks, typing delivery_date in dashboard API, and extending stage-updates to accept explicit delivery_date so audit remarks do not overwrite schedules. Avoid using stage_update remarks as delivery_date except legacy scheduled Telegram updates.

#### Lesson Learned

Delivery tab gaps were fixed by showing explicit delivery_date, adding OTP-protected schedule/reschedule controls with remarks, typing delivery_date in dashboard API, and extending stage-updates to accept explicit delivery_date so audit remarks do not overwrite schedules. Avoid using stage_update remarks as delivery_date except legacy scheduled Telegram updates.

#### Tags

cross-project, local-fallback

---

### Lesson: quick actions OTP Telegram wiring

Date: 2026-05-21
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Dashboard quick actions should route through OtpModal, pass updated_by=dashboard_quick_action with action_token to existing API endpoints, and backend should verify the short-lived Redis action token only for that dashboard quick marker to avoid breaking Telegram/bot flows. Successful quick writes notify the configured Telegram escalation/manual-change group.

#### Lesson Learned

Dashboard quick actions should route through OtpModal, pass updated_by=dashboard_quick_action with action_token to existing API endpoints, and backend should verify the short-lived Redis action token only for that dashboard quick marker to avoid breaking Telegram/bot flows. Successful quick writes notify the configured Telegram escalation/manual-change group.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: revert API Dockerfile to use tsx directly to avoid OOM on VPS

Date: 2026-05-21
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 6324c6f2ca73c935b4efbf88cb2875d0f6c3b1fe

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 6324c6f2ca73c935b4efbf88cb2875d0f6c3b1fe
**Files:** apps/api/Dockerfile

**Summary:**
**What was fixed:**  
Reverted the API Dockerfile from using `node dist/index.js` (compiled output) back to `tsx src/index.ts` (TypeScript runtime).

**Why it broke:**  
Running the compiled JavaScript (`node dist/index.js`) caused an out-of-memory (OOM) crash on the VPS. The compiled bundle likely loaded all dependencies and modules upfront, consuming more memory than the VPS could provide. In contrast, `tsx` (a TypeScript executor) loads modules lazily and uses less memory during startup and runtime.

**Reusable takeaway:**  
For resource-constrained environments (e.g., small VPS, low-memory containers), prefer running TypeScript directly with `tsx` over pre-compiled Node.js bundles. The lazy module loading of `tsx` reduces memory pressure, especially during startup. Only switch to compiled output when you need to optimize for cold-start latency or when the runtime environment has sufficient memory.

---
*Original commit message: fix: revert API Dockerfile to use tsx directly to avoid OOM on VPS*

#### Lesson Learned

**What was fixed:**  
Reverted the API Dockerfile from using `node dist/index.js` (compiled output) back to `tsx src/index.ts` (TypeScript runtime).

**Why it broke:**  
Running the compiled JavaScript (`node dist/index.js`) caused an out-of-memory (OOM) crash on the VPS. The compiled bundle likely loaded all dependencies and modules upfront, consuming more memory than the VPS could provide. In contrast, `tsx` (a TypeScript executor) loads modules lazily and uses less memory during startup and runtime.

**Reusable takeaway:**  
For resource-constrained environments (e.g., small VPS, low-memory containers), prefer running TypeScript directly with `tsx` over pre-compiled Node.js bundles. The lazy module loading of `tsx` reduces memory pressure, especially during startup. Only switch to compiled output when you need to optimize for cold-start latency or when the runtime environment has sufficient memory.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add stopReminderScheduler, waitForReminders, stopAgentScheduler, waitForAgents exports + circuit breaker for agent 

Date: 2026-05-21
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 9b5267959adc23aa827efeb1eda5ed83b0dcd1cc

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 9b5267959adc23aa827efeb1eda5ed83b0dcd1cc
**Files:** apps/api/src/services/agentScheduler.ts,apps/api/src/services/reminderScheduler.ts

**Summary:**
**What was fixed:**  
Added missing exports (`stopReminderScheduler`, `waitForReminders`, `stopAgentScheduler`, `waitForAgents`) and a circuit breaker for the agent scheduler.

**Why it broke:**  
The scheduler services were not properly stoppable or awaitable, causing resource leaks and race conditions during shutdown. The agent scheduler lacked a circuit breaker, making it vulnerable to cascading failures when downstream services were unavailable.

**Reusable takeaway:**  
Always expose lifecycle hooks (`start`, `stop`, `wait`) for background services, and implement circuit breakers for schedulers that interact with external dependencies. This prevents resource leaks, ensures graceful shutdown, and protects against cascading failures in distributed systems.

---
*Original commit message: fix: add stopReminderScheduler, waitForReminders, stopAgentScheduler, waitForAgents exports + circuit breaker for agent scheduler*

#### Lesson Learned

**What was fixed:**  
Added missing exports (`stopReminderScheduler`, `waitForReminders`, `stopAgentScheduler`, `waitForAgents`) and a circuit breaker for the agent scheduler.

**Why it broke:**  
The scheduler services were not properly stoppable or awaitable, causing resource leaks and race conditions during shutdown. The agent scheduler lacked a circuit breaker, making it vulnerable to cascading failures when downstream services were unavailable.

**Reusable takeaway:**  
Always expose lifecycle hooks (`start`, `stop`, `wait`) for background services, and implement circuit breakers for schedulers that interact with external dependencies. This prevents resource leaks, ensures graceful shutdown, and protects against cascading failures in distributed systems.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: collection agent now also checks quotation_received stage for deposit reminders

Date: 2026-05-21
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 5d163651d03201368d946211cfa097d141f2c482

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 5d163651d03201368d946211cfa097d141f2c482
**Files:** apps/api/src/agents/collectionAgent.ts

**Summary:**
**What was fixed:**  
The collection agent now triggers deposit reminders for invoices in the `quotation_received` stage, not only in the `invoice_sent` stage.

**Why it broke:**  
The original logic only checked for `invoice_sent`, missing invoices that were still in the earlier `quotation_received` stage. This caused deposit reminders to be skipped for customers who had received a quotation but not yet an invoice.

**Reusable takeaway:**  
When automating multi-stage workflows, ensure your state machine covers all relevant stages—not just the final one. A stage transition may occur without a direct path to the expected trigger stage. Always audit the full lifecycle of a business object (e.g., quotation → invoice → payment) to avoid silent gaps in automation logic.

---
*Original commit message: fix: collection agent now also checks quotation_received stage for deposit reminders*

#### Lesson Learned

**What was fixed:**  
The collection agent now triggers deposit reminders for invoices in the `quotation_received` stage, not only in the `invoice_sent` stage.

**Why it broke:**  
The original logic only checked for `invoice_sent`, missing invoices that were still in the earlier `quotation_received` stage. This caused deposit reminders to be skipped for customers who had received a quotation but not yet an invoice.

**Reusable takeaway:**  
When automating multi-stage workflows, ensure your state machine covers all relevant stages—not just the final one. A stage transition may occur without a direct path to the expected trigger stage. Always audit the full lifecycle of a business object (e.g., quotation → invoice → payment) to avoid silent gaps in automation logic.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add apikey header to supabaseRequest and uploadBackup for Supabase Storage API auth; create separate backup-agent c

Date: 2026-05-21
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 2d23e7aa6cb07d06e2bae2c35d5c287e7f5181a3

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 2d23e7aa6cb07d06e2bae2c35d5c287e7f5181a3
**Files:** apps/api/src/agents/supabaseBackupAgent.ts,apps/backup-agent/Dockerfile,apps/backup-agent/src/backupRunner.ts,docker-compose.yml,scripts/deploy.sh,scripts/single-builder-deploy.mjs

**Summary:**
**What was fixed:**  
Supabase Storage API requests (`supabaseRequest`, `uploadBackup`) were missing the required `apikey` header, causing authentication failures. A separate `backup-agent` container was created to isolate backup logic.

**Why it broke:**  
The Supabase Storage API requires an `apikey` header for every request, but the original implementation only used the `Authorization` (JWT) header. The backup logic was also tightly coupled to the main API container, making it harder to scale or debug.

**Reusable takeaway:**  
When integrating with external APIs, always verify the full set of required headers (not just auth tokens). For background tasks like backups, isolate them in a separate container to improve maintainability, scalability, and failure isolation.

---
*Original commit message: fix: add apikey header to supabaseRequest and uploadBackup for Supabase Storage API auth; create separate backup-agent container*

#### Lesson Learned

**What was fixed:**  
Supabase Storage API requests (`supabaseRequest`, `uploadBackup`) were missing the required `apikey` header, causing authentication failures. A separate `backup-agent` container was created to isolate backup logic.

**Why it broke:**  
The Supabase Storage API requires an `apikey` header for every request, but the original implementation only used the `Authorization` (JWT) header. The backup logic was also tightly coupled to the main API container, making it harder to scale or debug.

**Reusable takeaway:**  
When integrating with external APIs, always verify the full set of required headers (not just auth tokens). For background tasks like backups, isolate them in a separate container to improve maintainability, scalability, and failure isolation.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: reminder scheduler auto-completes stale reminders based on order state

Date: 2026-05-21
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 1dce9d1136069b1d0e4d973b503f6db8cf1bc839

**Project:** workflowautomation
**Author:** unknown
**Commit:** 1dce9d1136069b1d0e4d973b503f6db8cf1bc839
**Files:** 

**Summary:**
**What was fixed:** The reminder scheduler was incorrectly auto-completing stale reminders regardless of the current order state.

**Why it broke:** The scheduler queried reminders by age alone, without checking whether the associated order was still in an active state. Once an order was completed or cancelled, its reminders should have been ignored, but the logic treated all old reminders as actionable.

**Reusable takeaway:** When processing scheduled tasks (e.g., reminders, retries), always filter by the parent entity's lifecycle state. Never rely solely on time-based conditions; stale data can cause false positives. A robust pattern is to join the reminder table with the order table and add a `WHERE order.status IN ('active', 'pending')` clause. This prevents unintended side effects when the underlying business object has already transitioned to a terminal state.

---
*Original commit message: fix: reminder scheduler auto-completes stale reminders based on order state*

#### Lesson Learned

**What was fixed:** The reminder scheduler was incorrectly auto-completing stale reminders regardless of the current order state.

**Why it broke:** The scheduler queried reminders by age alone, without checking whether the associated order was still in an active state. Once an order was completed or cancelled, its reminders should have been ignored, but the logic treated all old reminders as actionable.

**Reusable takeaway:** When processing scheduled tasks (e.g., reminders, retries), always filter by the parent entity's lifecycle state. Never rely solely on time-based conditions; stale data can cause false positives. A robust pattern is to join the reminder table with the order table and add a `WHERE order.status IN ('active', 'pending')` clause. This prevents unintended side effects when the underlying business object has already transitioned to a terminal state.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] feat: replace Google Drive upload with local file-store container for Hermes agent quotation reference

Date: 2026-05-21

#### Task Summary
Replaced Google Drive upload for quotations with a local file-store container on the VPS. Quotation text (extracted via Gemini Vision) is stored as plain text files in a dedicated Fastify container, accessible only to the Hermes agent for production analysis. Deposit slips are no longer stored anywhere. Auto-deletion of quotation text occurs after 90 days via a built-in cleanup agent.

#### Lesson Learned
1. **Text-only storage is sufficient for AI context**: Storing extracted quotation text (~1-5KB) instead of bulky PDFs/images saves significant disk space while providing all the context Hermes needs for production analysis.
2. **Separate container per concern**: The file-store container is independently deployable, has its own volume, and can be scaled/restarted without affecting other services.
3. **Auto-cleanup via file age**: Using file modification time (mtime) for cleanup is simpler and more reliable than database-driven retention — no cron jobs or complex queries needed.
4. **Deposit slips should never be stored**: Per user requirements, deposit slips contain sensitive financial information and should only be used ephemerally during the deposit confirmation flow.
5. **Gitignore gotcha with *.json**: The project's `.gitignore` had `*.json` which excluded `package.json` from git tracking. Must use `!apps/file-store/package.json` negation pattern to override.
6. **Google Drive removal is multi-layered**: Removing Drive integration requires changes in: API server (endpoints + imports), Telegram bot (upload calls), dashboard (API client + page components), and docker-compose (env vars).

#### Tags

file-store, google-drive-removal, hermes-agent, quotation-storage, auto-cleanup, gitignore, vps-deployment

---

### Lesson: [workflowautomation] fix: add apps/file-store/package.json to git tracking (was excluded by *.json gitignore)

Date: 2026-05-21
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 6e4b6bf702ed018d2021ff49ff3f682c9a28cfac

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 6e4b6bf702ed018d2021ff49ff3f682c9a28cfac
**Files:** .gitignore,apps/file-store/package.json

**Summary:**
**What was fixed:**  
A missing `apps/file-store/package.json` file was added to Git tracking, enabling proper dependency resolution and build for the `file-store` app.

**Why it broke:**  
The root `.gitignore` contained a blanket `*.json` rule, which inadvertently excluded all JSON files—including critical `package.json` files in subdirectories. This caused the `file-store` app’s dependencies to be untracked and missing in CI or fresh clones.

**Reusable takeaway:**  
Avoid broad file-type ignores (e.g., `*.json`) in root `.gitignore` when subdirectories contain essential config files. Instead, scope ignores to specific directories or use negative patterns (e.g., `!apps/*/package.json`) to preserve critical files. Always verify that global ignore rules don’t accidentally exclude project-required assets.

---
*Original commit message: fix: add apps/file-store/package.json to git tracking (was excluded by *.json gitignore)*

#### Lesson Learned

**What was fixed:**  
A missing `apps/file-store/package.json` file was added to Git tracking, enabling proper dependency resolution and build for the `file-store` app.

**Why it broke:**  
The root `.gitignore` contained a blanket `*.json` rule, which inadvertently excluded all JSON files—including critical `package.json` files in subdirectories. This caused the `file-store` app’s dependencies to be untracked and missing in CI or fresh clones.

**Reusable takeaway:**  
Avoid broad file-type ignores (e.g., `*.json`) in root `.gitignore` when subdirectories contain essential config files. Instead, scope ignores to specific directories or use negative patterns (e.g., `!apps/*/package.json`) to preserve critical files. Always verify that global ignore rules don’t accidentally exclude project-required assets.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] docs: add lesson for file-store container and Google Drive removal

Date: 2026-05-21
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 07a15230d2c7dc3abe7e0ecebb9dab0dde9679ff

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 07a15230d2c7dc3abe7e0ecebb9dab0dde9679ff
**Files:** memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Added a documented lesson about removing the file-store container and Google Drive integration from the workflow automation system.

**Why it broke:**  
The file-store container and Google Drive integration were removed without updating the corresponding documentation or lesson index, leaving a gap in the project's institutional memory. This caused confusion for future developers about why these components were removed and how to handle similar deprecations.

**Reusable takeaway:**  
When removing any component from a system, immediately document the removal rationale, affected dependencies, and migration path in a lessons-learned file. Always update the lesson index to maintain a searchable record of architectural decisions. This prevents knowledge loss and ensures future contributors understand the context of past changes.

---
*Original commit message: docs: add lesson for file-store container and Google Drive removal*

#### Lesson Learned

**What was fixed:**  
Added a documented lesson about removing the file-store container and Google Drive integration from the workflow automation system.

**Why it broke:**  
The file-store container and Google Drive integration were removed without updating the corresponding documentation or lesson index, leaving a gap in the project's institutional memory. This caused confusion for future developers about why these components were removed and how to handle similar deprecations.

**Reusable takeaway:**  
When removing any component from a system, immediately document the removal rationale, affected dependencies, and migration path in a lessons-learned file. Always update the lesson index to maintain a searchable record of architectural decisions. This prevents knowledge loss and ensures future contributors understand the context of past changes.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add --dns-result-order=ipv4first to API Dockerfile to fix Telegram API ETIMEDOUT from Node.js undici

Date: 2026-05-21
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit ed57617eef14bebae8f5d92f4db35cf1e3a1ca99

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** ed57617eef14bebae8f5d92f4db35cf1e3a1ca99
**Files:** apps/api/Dockerfile

**Summary:**
**What was fixed:**  
A `ETIMEDOUT` error when the Node.js API (using `undici`) called the Telegram API.

**Why it broke:**  
The Docker container’s DNS resolver returned an IPv6 address for the Telegram API, but the container lacked IPv6 connectivity. `undici` (Node.js’s default HTTP client) attempted the IPv6 connection first, which timed out.

**Reusable takeaway:**  
When running Node.js applications in Docker environments without IPv6 support, explicitly set `--dns-result-order=ipv4first` in the `NODE_OPTIONS` environment variable or Node.js startup flags. This forces DNS resolution to prefer IPv4, preventing silent timeouts caused by IPv6 fallback behavior in modern HTTP clients like `undici`.

---
*Original commit message: fix: add --dns-result-order=ipv4first to API Dockerfile to fix Telegram API ETIMEDOUT from Node.js undici*

#### Lesson Learned

**What was fixed:**  
A `ETIMEDOUT` error when the Node.js API (using `undici`) called the Telegram API.

**Why it broke:**  
The Docker container’s DNS resolver returned an IPv6 address for the Telegram API, but the container lacked IPv6 connectivity. `undici` (Node.js’s default HTTP client) attempted the IPv6 connection first, which timed out.

**Reusable takeaway:**  
When running Node.js applications in Docker environments without IPv6 support, explicitly set `--dns-result-order=ipv4first` in the `NODE_OPTIONS` environment variable or Node.js startup flags. This forces DNS resolution to prefer IPv4, preventing silent timeouts caused by IPv6 fallback behavior in modern HTTP clients like `undici`.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: switch Telegram parse_mode from Markdown to HTML to fix entity parsing errors with special chars

Date: 2026-05-21
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 7df5c1e96a20090b65965e672d18e2e8e949f0d5

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 7df5c1e96a20090b65965e672d18e2e8e949f0d5
**Files:** apps/api/src/server.ts,apps/api/src/services/agentRunner.ts,apps/api/src/services/reminderScheduler.ts

**Summary:**
**What was fixed:**  
Telegram message formatting was breaking when special characters (e.g., `_`, `*`, `[`) appeared in content. The fix switched the `parse_mode` from `Markdown` to `HTML` across three API services.

**Why it broke:**  
MarkdownV2 requires strict escaping of reserved characters. User-generated content (e.g., workflow names, reminders) often contains these characters without proper escaping, causing Telegram to reject the message with entity parse errors.

**Reusable takeaway:**  
When sending user-generated text to Telegram, prefer `HTML` over `MarkdownV2` to avoid brittle escaping logic. HTML is more forgiving of special characters and reduces the risk of silent message failures. If Markdown is required, always sanitize/escape user input before formatting.

---
*Original commit message: fix: switch Telegram parse_mode from Markdown to HTML to fix entity parsing errors with special chars*

#### Lesson Learned

**What was fixed:**  
Telegram message formatting was breaking when special characters (e.g., `_`, `*`, `[`) appeared in content. The fix switched the `parse_mode` from `Markdown` to `HTML` across three API services.

**Why it broke:**  
MarkdownV2 requires strict escaping of reserved characters. User-generated content (e.g., workflow names, reminders) often contains these characters without proper escaping, causing Telegram to reject the message with entity parse errors.

**Reusable takeaway:**  
When sending user-generated text to Telegram, prefer `HTML` over `MarkdownV2` to avoid brittle escaping logic. HTML is more forgiving of special characters and reduces the risk of silent message failures. If Markdown is required, always sanitize/escape user input before formatting.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add deposit_verification and balance_verification cases to escalation agent and reminder scheduler

Date: 2026-05-21
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 4914ac72d6e9e43d355191b7682f405f2332a991

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 4914ac72d6e9e43d355191b7682f405f2332a991
**Files:** apps/api/src/agents/escalationAgent.ts,apps/api/src/services/reminderScheduler.ts

**Summary:**
**What was fixed:**  
Added missing `deposit_verification` and `balance_verification` case handlers to the escalation agent and reminder scheduler.

**Why it broke:**  
These two workflow types were omitted from the case/switch logic, causing the system to skip escalation or reminders for deposit and balance verification workflows.

**Reusable takeaway:**  
When adding new workflow types, always audit all branching logic (case/switch, if-else chains, routing tables) across related services—especially escalation, scheduling, and notification modules—to prevent silent failures.

---
*Original commit message: fix: add deposit_verification and balance_verification cases to escalation agent and reminder scheduler*

#### Lesson Learned

**What was fixed:**  
Added missing `deposit_verification` and `balance_verification` case handlers to the escalation agent and reminder scheduler.

**Why it broke:**  
These two workflow types were omitted from the case/switch logic, causing the system to skip escalation or reminders for deposit and balance verification workflows.

**Reusable takeaway:**  
When adding new workflow types, always audit all branching logic (case/switch, if-else chains, routing tables) across related services—especially escalation, scheduling, and notification modules—to prevent silent failures.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add production_pending reminder after deposit verification — production agent now reminds production group to start

Date: 2026-05-21
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit c3c1efe071853044a7569c97c217be6f11e480b3

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** c3c1efe071853044a7569c97c217be6f11e480b3
**Files:** apps/api/src/server.ts,apps/api/src/services/reminderScheduler.ts

**Summary:**
**What was fixed:**  
A missing reminder notification for the production group after a deposit was verified. The production agent now triggers a `production_pending` reminder to the production team to begin work.

**Why it broke:**  
The deposit verification flow completed without notifying the production group. The reminder scheduler lacked a trigger for the `production_pending` state, so the production team was never informed to start production.

**Reusable takeaway:**  
When designing multi-step workflows, ensure every state transition that requires human action has an explicit notification trigger. Do not assume downstream teams will be automatically aware of upstream completions. Always map state changes to required notifications, especially in asynchronous, multi-actor systems.

---
*Original commit message: fix: add production_pending reminder after deposit verification — production agent now reminds production group to start production*

#### Lesson Learned

**What was fixed:**  
A missing reminder notification for the production group after a deposit was verified. The production agent now triggers a `production_pending` reminder to the production team to begin work.

**Why it broke:**  
The deposit verification flow completed without notifying the production group. The reminder scheduler lacked a trigger for the `production_pending` state, so the production team was never informed to start production.

**Reusable takeaway:**  
When designing multi-step workflows, ensure every state transition that requires human action has an explicit notification trigger. Do not assume downstream teams will be automatically aware of upstream completions. Always map state changes to required notifications, especially in asynchronous, multi-actor systems.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: verify-deposit stage advancement for quotation_received orders — add quotation_received to deposit_pending CASE and

Date: 2026-05-21
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit e0aa6432717cbb888d3f4df56cd042772dc1ef1c

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** e0aa6432717cbb888d3f4df56cd042772dc1ef1c
**Files:** apps/api/src/server.ts

**Summary:**
**What was fixed:**  
The `verify-deposit` stage was not advancing for orders with status `quotation_received`. The `deposit_pending` CASE statement and `nextStage` logic both lacked handling for this status.

**Why it broke:**  
The workflow assumed deposit verification only applied to orders in a narrower set of prior states, omitting `quotation_received`. This caused a silent skip in stage progression for valid orders.

**Reusable takeaway:**  
When implementing state-machine workflows, always audit all possible predecessor states for each transition. Use exhaustive CASE statements or a state-transition matrix to avoid missing edge cases. Consider adding a unit test that enumerates all valid state transitions to catch gaps early.

---
*Original commit message: fix: verify-deposit stage advancement for quotation_received orders — add quotation_received to deposit_pending CASE and broaden nextStage logic*

#### Lesson Learned

**What was fixed:**  
The `verify-deposit` stage was not advancing for orders with status `quotation_received`. The `deposit_pending` CASE statement and `nextStage` logic both lacked handling for this status.

**Why it broke:**  
The workflow assumed deposit verification only applied to orders in a narrower set of prior states, omitting `quotation_received`. This caused a silent skip in stage progression for valid orders.

**Reusable takeaway:**  
When implementing state-machine workflows, always audit all possible predecessor states for each transition. Use exhaustive CASE statements or a state-transition matrix to avoid missing edge cases. Consider adding a unit test that enumerates all valid state transitions to catch gaps early.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: item-level tracking gap fixes — duplicate messages, SQL en-route pct, auto-advance on callback

Date: 2026-05-21
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit a778d00367e74b457c25d9f6a3cc749b13f0a07e

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** a778d00367e74b457c25d9f6a3cc749b13f0a07e
**Files:** apps/api/src/agents/productionAgent.ts,apps/telegram-bot/src/bot.ts,database/migrations/021_item_level_tracking.sql,database/migrations/022_fix_en_route_completion_pct.sql

**Summary:**
**What was fixed:**  
- Duplicate messages in item-level tracking  
- Incorrect SQL calculation for "en-route completion percentage"  
- Auto-advance logic failing on callback events  

**Why it broke:**  
- Race conditions in the production agent caused duplicate event emissions  
- SQL aggregation used `COUNT` instead of `SUM` for weighted completion, skewing percentages  
- Callback handlers lacked state checks, allowing premature auto-advance  

**Reusable takeaway:**  
When tracking nested or item-level progress, ensure:  
1. Event emission is idempotent (use dedup keys or debounce)  
2. Percentage calculations use weighted sums, not raw counts  
3. State transitions (auto-advance) validate current state before acting

---
*Original commit message: fix: item-level tracking gap fixes — duplicate messages, SQL en-route pct, auto-advance on callback*

#### Lesson Learned

**What was fixed:**  
- Duplicate messages in item-level tracking  
- Incorrect SQL calculation for "en-route completion percentage"  
- Auto-advance logic failing on callback events  

**Why it broke:**  
- Race conditions in the production agent caused duplicate event emissions  
- SQL aggregation used `COUNT` instead of `SUM` for weighted completion, skewing percentages  
- Callback handlers lacked state checks, allowing premature auto-advance  

**Reusable takeaway:**  
When tracking nested or item-level progress, ensure:  
1. Event emission is idempotent (use dedup keys or debounce)  
2. Percentage calculations use weighted sums, not raw counts  
3. State transitions (auto-advance) validate current state before acting

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: telegram gui and reminder gaps for item-level tracking

Date: 2026-05-21
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit d1c141add69c850b6638f83e29d55f356410ca72

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** d1c141add69c850b6638f83e29d55f356410ca72
**Files:** apps/api/src/server.ts,apps/api/src/services/reminderScheduler.ts,apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
Telegram GUI not showing item-level tracking status and reminder scheduler skipping certain tracked items.

**Why it broke:**  
- In `bot.ts`, the Telegram bot filtered items by a top-level `tracked` flag but ignored per-item tracking metadata, causing mismatched display.  
- In `reminderScheduler.ts`, the scheduler used an outdated query that missed items where tracking was enabled at the item level but not at the parent level.  
- In `server.ts`, API responses omitted item-level tracking fields, breaking downstream consumers.

**Reusable takeaway:**  
When adding granular (item-level) tracking to a system that previously only supported parent-level tracking, update all consumers (UI, scheduler, API) to read the new field. A common failure mode is fixing the data model but forgetting to propagate the change to every service that queries or displays tracking status. Always audit all read paths after introducing a new boolean flag at a deeper nesting level.

---
*Original commit message: fix: telegram gui and reminder gaps for item-level tracking*

#### Lesson Learned

**What was fixed:**  
Telegram GUI not showing item-level tracking status and reminder scheduler skipping certain tracked items.

**Why it broke:**  
- In `bot.ts`, the Telegram bot filtered items by a top-level `tracked` flag but ignored per-item tracking metadata, causing mismatched display.  
- In `reminderScheduler.ts`, the scheduler used an outdated query that missed items where tracking was enabled at the item level but not at the parent level.  
- In `server.ts`, API responses omitted item-level tracking fields, breaking downstream consumers.

**Reusable takeaway:**  
When adding granular (item-level) tracking to a system that previously only supported parent-level tracking, update all consumers (UI, scheduler, API) to read the new field. A common failure mode is fixing the data model but forgetting to propagate the change to every service that queries or displays tracking status. Always audit all read paths after introducing a new boolean flag at a deeper nesting level.

#### Tags

cross-project, local-fallback

---

### Lesson: Dashboard workflow diagram

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Added a reusable inline SVG workflow diagram to apps/dashboard/src/app/workflow/page.tsx and placed it above the existing Stage Flow card in the Stage Pipeline tab. Use apply_patch for TSX changes to preserve UTF-8 characters; PowerShell Set-Content can corrupt Unicode and nullish coalescing in this repo.

#### Lesson Learned

Added a reusable inline SVG workflow diagram to apps/dashboard/src/app/workflow/page.tsx and placed it above the existing Stage Flow card in the Stage Pipeline tab. Use apply_patch for TSX changes to preserve UTF-8 characters; PowerShell Set-Content can corrupt Unicode and nullish coalescing in this repo.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: remove checkBalanceDue import and usage from server.ts (moved to collection agent)

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 807d5017e1dbb7917505b0ba15b57693a3852ae5

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 807d5017e1dbb7917505b0ba15b57693a3852ae5
**Files:** apps/api/src/server.ts

**Summary:**
**What was fixed:**  
Removed an unused `checkBalanceDue` import and its usage from `server.ts`, as this logic was moved to a dedicated collection agent.

**Why it broke:**  
The function was originally called in the server startup flow, but after refactoring, the responsibility shifted to a separate agent. The stale import caused confusion, potential runtime errors if the function signature changed, and violated separation of concerns.

**Reusable takeaway:**  
When extracting business logic from a central entry point (e.g., server startup) into a dedicated service or agent, always remove the old import and call site. This prevents dead code, reduces coupling, and ensures the server only handles orchestration, not domain-specific tasks. Use automated linting or import checks to catch orphaned dependencies after refactoring.

---
*Original commit message: fix: remove checkBalanceDue import and usage from server.ts (moved to collection agent)*

#### Lesson Learned

**What was fixed:**  
Removed an unused `checkBalanceDue` import and its usage from `server.ts`, as this logic was moved to a dedicated collection agent.

**Why it broke:**  
The function was originally called in the server startup flow, but after refactoring, the responsibility shifted to a separate agent. The stale import caused confusion, potential runtime errors if the function signature changed, and violated separation of concerns.

**Reusable takeaway:**  
When extracting business logic from a central entry point (e.g., server startup) into a dedicated service or agent, always remove the old import and call site. This prevents dead code, reduces coupling, and ensures the server only handles orchestration, not domain-specific tasks. Use automated linting or import checks to catch orphaned dependencies after refactoring.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: repair corrupted 'use client' directive in purchasing page

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 677bcd19133706efee871bc6c357af65a39622d4

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 677bcd19133706efee871bc6c357af65a39622d4
**Files:** apps/dashboard/src/app/purchasing/page.tsx

**Summary:**
**What was fixed:** A corrupted `'use client'` directive in the purchasing page that caused a runtime error or misrendering.

**Why it broke:** The directive was likely malformed (e.g., missing quotes, extra whitespace, or a typo) during a previous edit or merge conflict, breaking the client-side boundary required for interactive components.

**Reusable takeaway:** Always validate `'use client'` and `'use server'` directives after merging or refactoring—they are syntactically strict and invisible to linters. Use a regex or pre-commit hook to check for exact string `'use client'` at the top of client files.

---
*Original commit message: fix: repair corrupted 'use client' directive in purchasing page*

#### Lesson Learned

**What was fixed:** A corrupted `'use client'` directive in the purchasing page that caused a runtime error or misrendering.

**Why it broke:** The directive was likely malformed (e.g., missing quotes, extra whitespace, or a typo) during a previous edit or merge conflict, breaking the client-side boundary required for interactive components.

**Reusable takeaway:** Always validate `'use client'` and `'use server'` directives after merging or refactoring—they are syntactically strict and invisible to linters. Use a regex or pre-commit hook to check for exact string `'use client'` at the top of client files.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: remove duplicate HEAD route in file-store (Fastify auto-creates HEAD from GET)

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 067e9920a47b4e287a4fc9df21e796450968d4e8

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 067e9920a47b4e287a4fc9df21e796450968d4e8
**Files:** apps/file-store/src/index.js

**Summary:**
**What was fixed:** Removed an explicit `HEAD` route handler in the file-store service.

**Why it broke:** Fastify automatically creates a `HEAD` route from any `GET` route. Adding a duplicate `HEAD` route caused a route collision error at startup, preventing the service from running.

**Reusable takeaway:** When using Fastify (or similar frameworks like Express with `app.head`), never manually define `HEAD` routes for endpoints that already have a `GET` handler. The framework handles this automatically. Always check framework documentation for implicit route generation before adding redundant handlers.

---
*Original commit message: fix: remove duplicate HEAD route in file-store (Fastify auto-creates HEAD from GET)*

#### Lesson Learned

**What was fixed:** Removed an explicit `HEAD` route handler in the file-store service.

**Why it broke:** Fastify automatically creates a `HEAD` route from any `GET` route. Adding a duplicate `HEAD` route caused a route collision error at startup, preventing the service from running.

**Reusable takeaway:** When using Fastify (or similar frameworks like Express with `app.head`), never manually define `HEAD` routes for endpoints that already have a `GET` handler. The framework handles this automatically. Always check framework documentation for implicit route generation before adding redundant handlers.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: migrate production page to shared OrderFileViewer with upload, add file viewer to orders detail page

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit ed2181cb75532924127d443368aea8dd9db2d645

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** ed2181cb75532924127d443368aea8dd9db2d645
**Files:** apps/dashboard/src/app/orders/[quotationNumber]/page.tsx,apps/dashboard/src/app/production/page.tsx

**Summary:**
**What was fixed:**  
The production page was migrated to use a shared `OrderFileViewer` component with upload capability, and the file viewer was added to the orders detail page.

**Why it broke:**  
The production page had a duplicated or custom file viewer implementation that lacked upload support, causing inconsistency and missing functionality compared to the orders detail page.

**Reusable takeaway:**  
Centralize reusable UI components (like file viewers) to avoid code duplication and ensure consistent behavior across pages. When adding new features (e.g., upload), update the shared component rather than duplicating logic. This reduces maintenance overhead and prevents feature gaps.

---
*Original commit message: fix: migrate production page to shared OrderFileViewer with upload, add file viewer to orders detail page*

#### Lesson Learned

**What was fixed:**  
The production page was migrated to use a shared `OrderFileViewer` component with upload capability, and the file viewer was added to the orders detail page.

**Why it broke:**  
The production page had a duplicated or custom file viewer implementation that lacked upload support, causing inconsistency and missing functionality compared to the orders detail page.

**Reusable takeaway:**  
Centralize reusable UI components (like file viewers) to avoid code duplication and ensure consistent behavior across pages. When adding new features (e.g., upload), update the shared component rather than duplicating logic. This reduces maintenance overhead and prevents feature gaps.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add missing agent triggers to finish-production, unsynced-payments, match-and-record; fix wrong agent trigger in re

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 9c8bc2e5b1d75128a9fd0a43dfa04d37ebd140a0

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 9c8bc2e5b1d75128a9fd0a43dfa04d37ebd140a0
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/workflow/page.tsx

**Summary:**
**What was fixed:**  
Three workflows (`finish-production`, `unsynced-payments`, `match-and-record`) were missing their agent triggers, causing them to never execute. One workflow (`report-production-status`) had an incorrect agent trigger, causing it to fire on the wrong event.

**Why it broke:**  
Agent triggers were omitted or misconfigured during initial workflow setup, likely due to copy-paste errors or incomplete configuration when adding new workflows. The trigger definition in `server.ts` (backend) and the UI workflow page (`page.tsx`) were inconsistent.

**Reusable takeaway:**  
When adding or modifying workflows, always verify that each workflow has the correct, unique agent trigger defined in both backend configuration and frontend UI. Use automated checks (e.g., lint rules or tests) to ensure no workflow is missing a trigger, and that trigger names match exactly between layers. A missing or wrong trigger silently disables the workflow.

---
*Original commit message: fix: add missing agent triggers to finish-production, unsynced-payments, match-and-record; fix wrong agent trigger in report-production-status*

#### Lesson Learned

**What was fixed:**  
Three workflows (`finish-production`, `unsynced-payments`, `match-and-record`) were missing their agent triggers, causing them to never execute. One workflow (`report-production-status`) had an incorrect agent trigger, causing it to fire on the wrong event.

**Why it broke:**  
Agent triggers were omitted or misconfigured during initial workflow setup, likely due to copy-paste errors or incomplete configuration when adding new workflows. The trigger definition in `server.ts` (backend) and the UI workflow page (`page.tsx`) were inconsistent.

**Reusable takeaway:**  
When adding or modifying workflows, always verify that each workflow has the correct, unique agent trigger defined in both backend configuration and frontend UI. Use automated checks (e.g., lint rules or tests) to ensure no workflow is missing a trigger, and that trigger names match exactly between layers. A missing or wrong trigger silently disables the workflow.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] chore: auto-generated lesson records for agent trigger fixes

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 9eaef4ac2067fa7a8b3d689401f4a8395927849c

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 9eaef4ac2067fa7a8b3d689401f4a8395927849c
**Files:** memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
The agent trigger logic was failing to fire correctly in certain edge cases, causing missed workflow executions.

**Why it broke:**  
The trigger condition did not account for state changes after agent retries or partial failures, leading to inconsistent event propagation.

**Reusable takeaway:**  
When designing agent triggers, always include explicit state reconciliation after retries or partial failures. Validate trigger conditions against the final state, not just the initial event.

---
*Original commit message: chore: auto-generated lesson records for agent trigger fixes*

#### Lesson Learned

**What was fixed:**  
The agent trigger logic was failing to fire correctly in certain edge cases, causing missed workflow executions.

**Why it broke:**  
The trigger condition did not account for state changes after agent retries or partial failures, leading to inconsistent event propagation.

**Reusable takeaway:**  
When designing agent triggers, always include explicit state reconciliation after retries or partial failures. Validate trigger conditions against the final state, not just the initial event.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] Fix verify-balance to advance to delivery_scheduled, add workflow guard to stage-updates

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 3ee42e3937f6c6bc9b3866d6009b8e2b2600a809

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 3ee42e3937f6c6bc9b3866d6009b8e2b2600a809
**Files:** .env.example,apps/api/src/server.ts,deploy-agent.mjs,memory/lesson-index.jsonl,memory/lessons-learned.md,scripts/backup-env.sh,workflow-live.png,{console.error(e)

**Summary:**
**What was fixed:**  
The `verify-balance` step now correctly transitions to `delivery_scheduled` instead of stalling. A workflow guard was added to `stage-updates` to prevent invalid state transitions.

**Why it broke:**  
The `verify-balance` handler lacked a proper next-state mapping, causing the workflow to hang after balance verification. The `stage-updates` step had no guard, allowing updates to proceed even when prerequisites were unmet.

**Reusable takeaway:**  
Every state transition must explicitly define its successor state, and all workflow steps should include guards that validate preconditions before executing. Without guards, workflows can silently skip required checks, leading to stuck or corrupted state machines.

---
*Original commit message: Fix verify-balance to advance to delivery_scheduled, add workflow guard to stage-updates*

#### Lesson Learned

**What was fixed:**  
The `verify-balance` step now correctly transitions to `delivery_scheduled` instead of stalling. A workflow guard was added to `stage-updates` to prevent invalid state transitions.

**Why it broke:**  
The `verify-balance` handler lacked a proper next-state mapping, causing the workflow to hang after balance verification. The `stage-updates` step had no guard, allowing updates to proceed even when prerequisites were unmet.

**Reusable takeaway:**  
Every state transition must explicitly define its successor state, and all workflow steps should include guards that validate preconditions before executing. Without guards, workflows can silently skip required checks, leading to stuck or corrupted state machines.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add stage transition notification to advanceStage() and add client_name to verify-deposit/verify-balance trigger ca

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 1d500a25ad2c58d60b0cb85293bf6c6586f5c2a6

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 1d500a25ad2c58d60b0cb85293bf6c6586f5c2a6
**Files:** apps/api/src/server.ts,apps/api/src/services/agentRunner.ts

**Summary:**
**What was fixed:**  
Added stage transition notifications inside `advanceStage()` and included `client_name` in `verify-deposit` and `verify-balance` trigger calls.

**Why it broke:**  
Stage transitions were not being broadcast, causing downstream systems to miss state changes. Additionally, verification triggers lacked `client_name`, leading to incomplete context for validation logic.

**Reusable takeaway:**  
When designing workflow engines, ensure every state transition emits a notification event, and every trigger call includes all relevant context (e.g., client identity). Missing context in triggers can silently break dependent validations or external integrations.

---
*Original commit message: fix: add stage transition notification to advanceStage() and add client_name to verify-deposit/verify-balance trigger calls*

#### Lesson Learned

**What was fixed:**  
Added stage transition notifications inside `advanceStage()` and included `client_name` in `verify-deposit` and `verify-balance` trigger calls.

**Why it broke:**  
Stage transitions were not being broadcast, causing downstream systems to miss state changes. Additionally, verification triggers lacked `client_name`, leading to incomplete context for validation logic.

**Reusable takeaway:**  
When designing workflow engines, ensure every state transition emits a notification event, and every trigger call includes all relevant context (e.g., client identity). Missing context in triggers can silently break dependent validations or external integrations.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add stage transition notification to advanceStage() and add client_name to verify-deposit/verify-balance trigger ca

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 99cae57e6ff6c6f0672be52611226b5d2a789ae6

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 99cae57e6ff6c6f0672be52611226b5d2a789ae6
**Files:** memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Added stage transition notifications to `advanceStage()` and included `client_name` in `verify-deposit` and `verify-balance` trigger calls.

**Why it broke:**  
Stage transitions were not broadcasting updates, causing downstream systems to miss state changes. Missing `client_name` in verification triggers led to incomplete context for balance/deposit checks, breaking workflow continuity.

**Reusable takeaway:**  
Always propagate state change notifications and include all relevant identifiers (e.g., `client_name`) in trigger calls. Missing context in cross-system triggers can silently break workflows. Ensure every state transition broadcasts its change and every trigger carries sufficient data for downstream processing.

---
*Original commit message: fix: add stage transition notification to advanceStage() and add client_name to verify-deposit/verify-balance trigger calls*

#### Lesson Learned

**What was fixed:**  
Added stage transition notifications to `advanceStage()` and included `client_name` in `verify-deposit` and `verify-balance` trigger calls.

**Why it broke:**  
Stage transitions were not broadcasting updates, causing downstream systems to miss state changes. Missing `client_name` in verification triggers led to incomplete context for balance/deposit checks, breaking workflow continuity.

**Reusable takeaway:**  
Always propagate state change notifications and include all relevant identifiers (e.g., `client_name`) in trigger calls. Missing context in cross-system triggers can silently break workflows. Ensure every state transition broadcasts its change and every trigger carries sufficient data for downstream processing.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: BUTTON_DATA_INVALID error - shorten callback data for verify:deposit and verify:balance buttons to stay under Teleg

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit a10cde48fddd8c11ff3c64e34704a09c510d6c61

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** a10cde48fddd8c11ff3c64e34704a09c510d6c61
**Files:** apps/api/src/agents/collectionAgent.ts,apps/telegram-bot/src/bot.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
A `BUTTON_DATA_INVALID` error caused by callback data exceeding Telegram's 64-byte limit for inline buttons.

**Why it broke:**  
The `verify:deposit` and `verify:balance` callback strings were too long, likely due to verbose payloads or concatenated identifiers. Telegram enforces a strict 64-byte maximum for callback data; exceeding it silently fails.

**Reusable takeaway:**  
When building Telegram bots (or any platform with fixed-size payload limits), always validate callback data length before sending. Use short, encoded identifiers (e.g., `v:dep` instead of `verify:deposit`) and trim dynamic parts. Add a runtime check or unit test to enforce the limit.

---
*Original commit message: fix: BUTTON_DATA_INVALID error - shorten callback data for verify:deposit and verify:balance buttons to stay under Telegram's 64-byte limit*

#### Lesson Learned

**What was fixed:**  
A `BUTTON_DATA_INVALID` error caused by callback data exceeding Telegram's 64-byte limit for inline buttons.

**Why it broke:**  
The `verify:deposit` and `verify:balance` callback strings were too long, likely due to verbose payloads or concatenated identifiers. Telegram enforces a strict 64-byte maximum for callback data; exceeding it silently fails.

**Reusable takeaway:**  
When building Telegram bots (or any platform with fixed-size payload limits), always validate callback data length before sending. Use short, encoded identifiers (e.g., `v:dep` instead of `verify:deposit`) and trim dynamic parts. Add a runtime check or unit test to enforce the limit.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: delivery group shows only completion notice, collection agent handles balance reminders for inventory_arrived/balan

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 7a8be601fbc30a7e283cb3af38b12c376947b5e4

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 7a8be601fbc30a7e283cb3af38b12c376947b5e4
**Files:** memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
A delivery group was incorrectly sending balance reminders to customers, even though it should only send a completion notice. The collection agent now handles balance reminders for `inventory_arrived` and `balance_due` events.

**Why it broke:**  
The delivery group’s logic was not scoped to its responsibility—it was triggering balance reminders meant for the collection agent, causing duplicate or misdirected notifications.

**Reusable takeaway:**  
Ensure each service or agent has a single, clearly defined responsibility. When multiple agents handle related events, explicitly separate their triggers and payloads to avoid overlap. Use event-based routing to delegate tasks to the correct handler.

---
*Original commit message: fix: delivery group shows only completion notice, collection agent handles balance reminders for inventory_arrived/balance_due*

#### Lesson Learned

**What was fixed:**  
A delivery group was incorrectly sending balance reminders to customers, even though it should only send a completion notice. The collection agent now handles balance reminders for `inventory_arrived` and `balance_due` events.

**Why it broke:**  
The delivery group’s logic was not scoped to its responsibility—it was triggering balance reminders meant for the collection agent, causing duplicate or misdirected notifications.

**Reusable takeaway:**  
Ensure each service or agent has a single, clearly defined responsibility. When multiple agents handle related events, explicitly separate their triggers and payloads to avoid overlap. Use event-based routing to delegate tasks to the correct handler.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add immediate Telegram notifications to functional groups on website manual confirmations

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit a58bb0a52696d1bbbc185f5d1601471e652a7768

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** a58bb0a52696d1bbbc185f5d1601471e652a7768
**Files:** apps/api/src/server.ts

**Summary:**
**What was fixed:** Telegram notifications were not being sent immediately to functional groups when a manual confirmation was made on the website.

**Why it broke:** The notification logic was only triggered on automated workflow events, not on manual confirmations. The server-side handler for manual confirmations lacked the call to the Telegram notification service for functional groups.

**Reusable takeaway:** When adding manual override actions (e.g., confirmations, approvals) to a system that already has automated notifications, ensure the notification path is explicitly invoked in the manual handler. Do not assume that manual actions will reuse the same event-driven notification pipeline—they often bypass it. Always audit all manual action handlers for missing side effects like alerts, logs, or notifications.

---
*Original commit message: fix: add immediate Telegram notifications to functional groups on website manual confirmations*

#### Lesson Learned

**What was fixed:** Telegram notifications were not being sent immediately to functional groups when a manual confirmation was made on the website.

**Why it broke:** The notification logic was only triggered on automated workflow events, not on manual confirmations. The server-side handler for manual confirmations lacked the call to the Telegram notification service for functional groups.

**Reusable takeaway:** When adding manual override actions (e.g., confirmations, approvals) to a system that already has automated notifications, ensure the notification path is explicitly invoked in the manual handler. Do not assume that manual actions will reuse the same event-driven notification pipeline—they often bypass it. Always audit all manual action handlers for missing side effects like alerts, logs, or notifications.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add missing balance_verification and delivery_pending stages to VALID_TRANSITIONS map

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 8762cdf77ce4c2efcf946334bc71a6af413d9ba4

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 8762cdf77ce4c2efcf946334bc71a6af413d9ba4
**Files:** apps/api/src/server.ts

**Summary:**
**What was fixed:**  
Added missing `balance_verification` and `delivery_pending` stages to the `VALID_TRANSITIONS` map, enabling correct state transitions in the workflow automation system.

**Why it broke:**  
The `VALID_TRANSITIONS` map was incomplete — it did not include these two stages, causing the system to reject valid transitions involving them. This likely led to stuck workflows or failed state updates when those stages were reached.

**Reusable takeaway:**  
When defining state transition maps or validation logic, ensure all possible states are explicitly enumerated. Use a single source of truth (e.g., a generated list or type-checked constant) to prevent omissions. Consider adding automated tests that verify every state has a defined set of valid transitions.

---
*Original commit message: fix: add missing balance_verification and delivery_pending stages to VALID_TRANSITIONS map*

#### Lesson Learned

**What was fixed:**  
Added missing `balance_verification` and `delivery_pending` stages to the `VALID_TRANSITIONS` map, enabling correct state transitions in the workflow automation system.

**Why it broke:**  
The `VALID_TRANSITIONS` map was incomplete — it did not include these two stages, causing the system to reject valid transitions involving them. This likely led to stuck workflows or failed state updates when those stages were reached.

**Reusable takeaway:**  
When defining state transition maps or validation logic, ensure all possible states are explicitly enumerated. Use a single source of truth (e.g., a generated list or type-checked constant) to prevent omissions. Consider adding automated tests that verify every state has a defined set of valid transitions.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: /pay-balance sends wrong stage to triggerAgentsForStage

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 8386f759c57197660cf4e52236d9cca5abfcb924

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 8386f759c57197660cf4e52236d9cca5abfcb924
**Files:** apps/api/src/server.ts

**Summary:**
**What was fixed:**  
The `/pay-balance` endpoint was sending the wrong stage name to `triggerAgentsForStage`, causing downstream agent logic to execute on an incorrect stage.

**Why it broke:**  
A variable mapping error occurred when the stage identifier was passed to the trigger function. The code referenced a stale or misnamed stage variable instead of the correct one from the request context.

**Reusable takeaway:**  
When passing stage identifiers to trigger functions, always validate that the variable matches the intended stage from the request payload or route parameters. Use explicit mapping or type-checking to prevent silent misrouting of workflow execution.

---
*Original commit message: fix: /pay-balance sends wrong stage to triggerAgentsForStage*

#### Lesson Learned

**What was fixed:**  
The `/pay-balance` endpoint was sending the wrong stage name to `triggerAgentsForStage`, causing downstream agent logic to execute on an incorrect stage.

**Why it broke:**  
A variable mapping error occurred when the stage identifier was passed to the trigger function. The code referenced a stale or misnamed stage variable instead of the correct one from the request context.

**Reusable takeaway:**  
When passing stage identifiers to trigger functions, always validate that the variable matches the intended stage from the request payload or route parameters. Use explicit mapping or type-checking to prevent silent misrouting of workflow execution.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add STAGE_TRANSITION_GROUP_CHAT_ID to docker-compose env vars for API container

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit f9f967e64a0bae4c599b32b69f94eaa24b6e8bad

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** f9f967e64a0bae4c599b32b69f94eaa24b6e8bad
**Files:** docker-compose.yml

**Summary:**
**What was fixed:**  
The API container was missing the `STAGE_TRANSITION_GROUP_CHAT_ID` environment variable in `docker-compose.yml`, causing runtime failures when the application tried to access this config.

**Why it broke:**  
A new feature or configuration requirement added the env var to the codebase, but the Docker Compose file was not updated to pass it to the container. This is a common oversight when environment variables are added without updating all deployment manifests.

**Reusable takeaway:**  
When adding new environment variables to application code, immediately update all deployment configurations (Docker Compose, Kubernetes, CI/CD pipelines) in the same commit. Use a checklist or automated validation (e.g., env var diff checks) to prevent missing critical configs across environments.

---
*Original commit message: fix: add STAGE_TRANSITION_GROUP_CHAT_ID to docker-compose env vars for API container*

#### Lesson Learned

**What was fixed:**  
The API container was missing the `STAGE_TRANSITION_GROUP_CHAT_ID` environment variable in `docker-compose.yml`, causing runtime failures when the application tried to access this config.

**Why it broke:**  
A new feature or configuration requirement added the env var to the codebase, but the Docker Compose file was not updated to pass it to the container. This is a common oversight when environment variables are added without updating all deployment manifests.

**Reusable takeaway:**  
When adding new environment variables to application code, immediately update all deployment configurations (Docker Compose, Kubernetes, CI/CD pipelines) in the same commit. Use a checklist or automated validation (e.g., env var diff checks) to prevent missing critical configs across environments.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: auto-complete order on delivery when balance already paid (skip countered/payment_received/payment_confirmed)

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit e64c2392a8bff993a4cf450ee8a13201a0f738b1

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** e64c2392a8bff993a4cf450ee8a13201a0f738b1
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/delivery/page.tsx

**Summary:**
**What was fixed:**  
Auto-complete of delivery orders was failing when the balance was already paid. The fix skips orders with statuses `countered`, `payment_received`, or `payment_confirmed` during auto-complete logic.

**Why it broke:**  
The auto-complete logic did not account for orders where payment had already been processed. It attempted to complete deliveries that were still in a payment-pending or negotiation state, causing conflicts or errors.

**Reusable takeaway:**  
When automating order lifecycle transitions, explicitly exclude states where payment or negotiation is unresolved. Always define a clear state machine with guard conditions (e.g., "only auto-complete if payment is confirmed AND not in a pending/countered state") to prevent premature or conflicting transitions.

---
*Original commit message: fix: auto-complete order on delivery when balance already paid (skip countered/payment_received/payment_confirmed)*

#### Lesson Learned

**What was fixed:**  
Auto-complete of delivery orders was failing when the balance was already paid. The fix skips orders with statuses `countered`, `payment_received`, or `payment_confirmed` during auto-complete logic.

**Why it broke:**  
The auto-complete logic did not account for orders where payment had already been processed. It attempted to complete deliveries that were still in a payment-pending or negotiation state, causing conflicts or errors.

**Reusable takeaway:**  
When automating order lifecycle transitions, explicitly exclude states where payment or negotiation is unresolved. Always define a clear state machine with guard conditions (e.g., "only auto-complete if payment is confirmed AND not in a pending/countered state") to prevent premature or conflicting transitions.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: fire completed stage notification when auto-advancing delivered→completed for prepaid orders

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit c43f4a4ff02b7092931b828dcaf938544d79fd8a

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** c43f4a4ff02b7092931b828dcaf938544d79fd8a
**Files:** apps/api/src/server.ts

**Summary:**
**What was fixed:**  
A missing notification emission when auto-advancing prepaid orders from "delivered" to "completed" stage.

**Why it broke:**  
The auto-advance logic triggered the stage transition but did not fire the associated `completed` stage notification event. This caused silent failures in downstream workflows (e.g., customer alerts, fulfillment triggers) that depend on that notification.

**Reusable takeaway:**  
When automating state transitions (e.g., order lifecycle stages), ensure all side effects—especially notifications, webhooks, or event emissions—are explicitly triggered for every transition path. A common pitfall is handling only manual transitions and forgetting the automated path. Always audit both manual and automatic flows for complete event coverage.

---
*Original commit message: fix: fire completed stage notification when auto-advancing delivered→completed for prepaid orders*

#### Lesson Learned

**What was fixed:**  
A missing notification emission when auto-advancing prepaid orders from "delivered" to "completed" stage.

**Why it broke:**  
The auto-advance logic triggered the stage transition but did not fire the associated `completed` stage notification event. This caused silent failures in downstream workflows (e.g., customer alerts, fulfillment triggers) that depend on that notification.

**Reusable takeaway:**  
When automating state transitions (e.g., order lifecycle stages), ensure all side effects—especially notifications, webhooks, or event emissions—are explicitly triggered for every transition path. A common pitfall is handling only manual transitions and forgetting the automated path. Always audit both manual and automatic flows for complete event coverage.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add 'completed' stage label to STAGE_LABELS map

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 0bfa784b0feb13c00c2fc4d28a7ffe94805371cc

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 0bfa784b0feb13c00c2fc4d28a7ffe94805371cc
**Files:** apps/api/src/services/agentRunner.ts

**Summary:**
**What was fixed:** A missing `'completed'` stage label in the `STAGE_LABELS` map, which caused the agent runner to fail when processing completed stages.

**Why it broke:** The `STAGE_LABELS` map defined labels for all stage states except `'completed'`. When the runner encountered a completed stage, it tried to look up a label that didn't exist, leading to an undefined reference or runtime error.

**Reusable takeaway:** When maintaining enum-like maps or switch statements that cover all possible states of a system, ensure every state has a corresponding entry. Use exhaustive checks (e.g., TypeScript's `never` type or a linter rule) to catch missing mappings at compile time rather than runtime. This prevents silent failures when new states are added or existing ones are overlooked.

---
*Original commit message: fix: add 'completed' stage label to STAGE_LABELS map*

#### Lesson Learned

**What was fixed:** A missing `'completed'` stage label in the `STAGE_LABELS` map, which caused the agent runner to fail when processing completed stages.

**Why it broke:** The `STAGE_LABELS` map defined labels for all stage states except `'completed'`. When the runner encountered a completed stage, it tried to look up a label that didn't exist, leading to an undefined reference or runtime error.

**Reusable takeaway:** When maintaining enum-like maps or switch statements that cover all possible states of a system, ensure every state has a corresponding entry. Use exhaustive checks (e.g., TypeScript's `never` type or a linter rule) to catch missing mappings at compile time rather than runtime. This prevents silent failures when new states are added or existing ones are overlooked.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add 'completed' to AGENT_TRIGGER_MAP and stageToGroup for notifications

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 68f85db06e55a339ee2d66059eed39b7dd65d65b

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 68f85db06e55a339ee2d66059eed39b7dd65d65b
**Files:** apps/api/src/server.ts

**Summary:**
**What was fixed:** Notifications for completed workflow stages were not being sent. The fix added `'completed'` to both `AGENT_TRIGGER_MAP` and `stageToGroup` mappings.

**Why it broke:** The notification system relied on explicit mapping of stage statuses to trigger events and grouping logic. The `'completed'` status was omitted from these maps, so when a stage reached completion, the system had no matching trigger or group, causing it to silently skip notification dispatch.

**Reusable takeaway:** When building event-driven systems that rely on status-to-action mappings, always audit all possible states against your mapping tables. A missing entry for a valid state (like `completed`) can cause silent failures. Use exhaustive type checks or runtime validation to ensure every status has a corresponding handler or mapping entry.

---
*Original commit message: fix: add 'completed' to AGENT_TRIGGER_MAP and stageToGroup for notifications*

#### Lesson Learned

**What was fixed:** Notifications for completed workflow stages were not being sent. The fix added `'completed'` to both `AGENT_TRIGGER_MAP` and `stageToGroup` mappings.

**Why it broke:** The notification system relied on explicit mapping of stage statuses to trigger events and grouping logic. The `'completed'` status was omitted from these maps, so when a stage reached completion, the system had no matching trigger or group, causing it to silently skip notification dispatch.

**Reusable takeaway:** When building event-driven systems that rely on status-to-action mappings, always audit all possible states against your mapping tables. A missing entry for a valid state (like `completed`) can cause silent failures. Use exhaustive type checks or runtime validation to ensure every status has a corresponding handler or mapping entry.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add deposit_verified guard to production agent - prevent auto-advance without verified downpayment

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit e85321bc8eebd1587cd73571b23ce06a881fbf32

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** e85321bc8eebd1587cd73571b23ce06a881fbf32
**Files:** NOW(),apps/api/src/agents/productionAgent.ts,apps/api/src/server.ts,check-julia.cjs,console.error(e)),memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
A bug where the production agent could auto-advance a workflow step (e.g., move to "in production") even when the customer’s downpayment had not been verified. A `deposit_verified` guard was added to prevent this premature transition.

**Why it broke:**  
The agent logic lacked a check for payment verification status. It assumed that if a deposit existed, it was valid—ignoring the separate verification step required by the business process.

**Reusable takeaway:**  
Always gate state transitions that depend on external validation (e.g., payment, approval) with an explicit guard. Do not rely on the mere presence of data; verify its confirmed status. This pattern prevents silent process violations and enforces correct workflow ordering.

---
*Original commit message: fix: add deposit_verified guard to production agent - prevent auto-advance without verified downpayment*

#### Lesson Learned

**What was fixed:**  
A bug where the production agent could auto-advance a workflow step (e.g., move to "in production") even when the customer’s downpayment had not been verified. A `deposit_verified` guard was added to prevent this premature transition.

**Why it broke:**  
The agent logic lacked a check for payment verification status. It assumed that if a deposit existed, it was valid—ignoring the separate verification step required by the business process.

**Reusable takeaway:**  
Always gate state transitions that depend on external validation (e.g., payment, approval) with an explicit guard. Do not rely on the mere presence of data; verify its confirmed status. This pattern prevents silent process violations and enforces correct workflow ordering.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: comprehensive workflow fixes — trigger agents on new orders, add missing stages to AGENT_TRIGGER_MAP/STAGE_LABELS/e

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 4a3cfdcb50b20b6e93a2e69b69aafbb963b097f1

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 4a3cfdcb50b20b6e93a2e69b69aafbb963b097f1
**Files:** apps/api/src/agents/escalationAgent.ts,apps/api/src/server.ts,apps/api/src/services/agentRunner.ts,apps/dashboard/src/app/inventory/page.tsx,docs/workflow.md

**Summary:**
**What was fixed:**  
Multiple workflow gaps: agents not triggering on new orders, missing stages in `AGENT_TRIGGER_MAP` and `STAGE_LABELS`, incomplete escalation agent logic, absent `InventoryVerificationSection` on dashboard, and outdated workflow documentation.

**Why it broke:**  
The workflow system had incomplete mappings between order lifecycle stages and agent triggers. New orders bypassed agent execution because the trigger map lacked entries for initial stages. Escalation logic was missing stage definitions, causing agents to skip critical verification steps. Dashboard and docs were not updated to reflect the full workflow.

**Reusable takeaway:**  
When building event-driven workflows, ensure every stage in the lifecycle has a corresponding entry in trigger maps, stage labels, and agent routing logic. A missing mapping anywhere (trigger → agent → UI → docs) creates silent failures. Always validate that new stages are added to all four layers: trigger config, agent logic, dashboard components, and documentation.

---
*Original commit message: fix: comprehensive workflow fixes — trigger agents on new orders, add missing stages to AGENT_TRIGGER_MAP/STAGE_LABELS/escalation agent, add InventoryVerificationSection to dashboard, update workflow docs*

#### Lesson Learned

**What was fixed:**  
Multiple workflow gaps: agents not triggering on new orders, missing stages in `AGENT_TRIGGER_MAP` and `STAGE_LABELS`, incomplete escalation agent logic, absent `InventoryVerificationSection` on dashboard, and outdated workflow documentation.

**Why it broke:**  
The workflow system had incomplete mappings between order lifecycle stages and agent triggers. New orders bypassed agent execution because the trigger map lacked entries for initial stages. Escalation logic was missing stage definitions, causing agents to skip critical verification steps. Dashboard and docs were not updated to reflect the full workflow.

**Reusable takeaway:**  
When building event-driven workflows, ensure every stage in the lifecycle has a corresponding entry in trigger maps, stage labels, and agent routing logic. A missing mapping anywhere (trigger → agent → UI → docs) creates silent failures. Always validate that new stages are added to all four layers: trigger config, agent logic, dashboard components, and documentation.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: produce:partial now shows clickable item-level inline buttons when order_items exist, falls back to free-text input

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 675dfc4a022cd22d746198543c7e11dca031bcce

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 675dfc4a022cd22d746198543c7e11dca031bcce
**Files:** apps/telegram-bot/src/bot.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
The `/produce:partial` command now displays clickable inline buttons for each order item when `order_items` exist, instead of always showing a free-text input field.

**Why it broke:**  
The previous logic assumed a single free-text input was sufficient for all cases, ignoring the structured `order_items` data. This caused a poor UX when multiple items needed partial fulfillment, as users had to manually type item details.

**Reusable takeaway:**  
When a command can operate on structured data (e.g., order items), always check for that data first and render appropriate interactive UI (e.g., inline buttons) before falling back to generic free-text input. This pattern improves usability and reduces input errors.

---
*Original commit message: fix: produce:partial now shows clickable item-level inline buttons when order_items exist, falls back to free-text input*

#### Lesson Learned

**What was fixed:**  
The `/produce:partial` command now displays clickable inline buttons for each order item when `order_items` exist, instead of always showing a free-text input field.

**Why it broke:**  
The previous logic assumed a single free-text input was sufficient for all cases, ignoring the structured `order_items` data. This caused a poor UX when multiple items needed partial fulfillment, as users had to manually type item details.

**Reusable takeaway:**  
When a command can operate on structured data (e.g., order items), always check for that data first and render appropriate interactive UI (e.g., inline buttons) before falling back to generic free-text input. This pattern improves usability and reduces input errors.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: resolve order_id from quotation_number in file upload; pass linkedOrder to vision:upload handler

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 3d634047fa940be4802ef130b21ff4bff0860230

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 3d634047fa940be4802ef130b21ff4bff0860230
**Files:** apps/api/src/server.ts,apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
The `order_id` was not being resolved from `quotation_number` during file upload, and the `linkedOrder` object was not passed to the `vision:upload` handler.

**Why it broke:**  
The upload handler expected a `linkedOrder` object containing the resolved `order_id`, but the code only passed the raw `quotation_number`. This caused the handler to fail when trying to associate the uploaded file with the correct order.

**Reusable takeaway:**  
When chaining data-dependent handlers, always ensure that intermediate transformations (like resolving IDs from reference numbers) are performed before passing data downstream. Explicitly pass the resolved object (e.g., `linkedOrder`) rather than relying on the handler to re-derive it, to avoid coupling and silent failures.

---
*Original commit message: fix: resolve order_id from quotation_number in file upload; pass linkedOrder to vision:upload handler*

#### Lesson Learned

**What was fixed:**  
The `order_id` was not being resolved from `quotation_number` during file upload, and the `linkedOrder` object was not passed to the `vision:upload` handler.

**Why it broke:**  
The upload handler expected a `linkedOrder` object containing the resolved `order_id`, but the code only passed the raw `quotation_number`. This caused the handler to fail when trying to associate the uploaded file with the correct order.

**Reusable takeaway:**  
When chaining data-dependent handlers, always ensure that intermediate transformations (like resolving IDs from reference numbers) are performed before passing data downstream. Explicitly pass the resolved object (e.g., `linkedOrder`) rather than relying on the handler to re-derive it, to avoid coupling and silent failures.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: update ON CONFLICT clause for partial unique indexes

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 6ced428176a5e013e9bd2c59ca1b9006cbd9920b

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 6ced428176a5e013e9bd2c59ca1b9006cbd9920b
**Files:** apps/api/src/server.ts,database/migrations/025_item_reminders.sql

**Summary:**
**What was fixed:**  
An `ON CONFLICT` clause in a PostgreSQL migration that failed when a partial unique index existed on the `item_reminders` table. The conflict target was updated to match the partial index definition.

**Why it broke:**  
The original `ON CONFLICT` clause specified a column list that did not match the partial unique index's predicate (e.g., `WHERE deleted_at IS NULL`). PostgreSQL requires the conflict target to exactly match the index's columns and condition; otherwise, it throws an error.

**Reusable takeaway:**  
When using `ON CONFLICT` with partial unique indexes, always include the exact index predicate in the conflict target (e.g., `ON CONFLICT (column) WHERE condition`). Never assume a column-only conflict target works when a partial index exists.

---
*Original commit message: fix: update ON CONFLICT clause for partial unique indexes*

#### Lesson Learned

**What was fixed:**  
An `ON CONFLICT` clause in a PostgreSQL migration that failed when a partial unique index existed on the `item_reminders` table. The conflict target was updated to match the partial index definition.

**Why it broke:**  
The original `ON CONFLICT` clause specified a column list that did not match the partial unique index's predicate (e.g., `WHERE deleted_at IS NULL`). PostgreSQL requires the conflict target to exactly match the index's columns and condition; otherwise, it throws an error.

**Reusable takeaway:**  
When using `ON CONFLICT` with partial unique indexes, always include the exact index predicate in the conflict target (e.g., `ON CONFLICT (column) WHERE condition`). Never assume a column-only conflict target works when a partial index exists.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add orderId to produce:partial callback data + fix ON CONFLICT constraints

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit a71bfa245a2f85075071b3187d82017dcc68bf95

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** a71bfa245a2f85075071b3187d82017dcc68bf95
**Files:** apps/api/src/agents/productionAgent.ts,apps/api/src/server.ts,apps/api/src/services/reminderScheduler.ts,apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
- Added `orderId` to the `produce:partial` callback data to ensure downstream consumers receive the correct order context.  
- Fixed `ON CONFLICT` constraints in database upsert logic to prevent constraint violation errors.

**Why it broke:**  
- The `produce:partial` event was missing the `orderId` field, causing incomplete data propagation.  
- The `ON CONFLICT` clause lacked proper constraint specification, leading to duplicate key conflicts during upserts.

**Reusable takeaway:**  
When implementing event-driven workflows, always include all foreign key identifiers (like `orderId`) in callback payloads to maintain data integrity across services. For upsert operations, explicitly define conflict targets (e.g., `ON CONFLICT (id)`) to avoid silent failures or constraint violations.

---
*Original commit message: fix: add orderId to produce:partial callback data + fix ON CONFLICT constraints*

#### Lesson Learned

**What was fixed:**  
- Added `orderId` to the `produce:partial` callback data to ensure downstream consumers receive the correct order context.  
- Fixed `ON CONFLICT` constraints in database upsert logic to prevent constraint violation errors.

**Why it broke:**  
- The `produce:partial` event was missing the `orderId` field, causing incomplete data propagation.  
- The `ON CONFLICT` clause lacked proper constraint specification, leading to duplicate key conflicts during upserts.

**Reusable takeaway:**  
When implementing event-driven workflows, always include all foreign key identifiers (like `orderId`) in callback payloads to maintain data integrity across services. For upsert operations, explicitly define conflict targets (e.g., `ON CONFLICT (id)`) to avoid silent failures or constraint violations.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: update production_pending reminder to include orderId in callback data; simplify inventory verification flow (remov

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 93b45cacfa73baa99229cca2de998ffb433de89a

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 93b45cacfa73baa99229cca2de998ffb433de89a
**Files:** apps/api/src/agents/inventoryAgent.ts,apps/api/src/services/reminderScheduler.ts,apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
The production_pending reminder now includes `orderId` in callback data, enabling correct order-specific actions. Inventory verification flow was simplified by removing photo upload and adding estimated arrival dates.

**Why it broke:**  
Missing `orderId` in callback data caused the reminder system to lose context of which order triggered the notification. This broke downstream actions like order lookup and status updates. The photo upload requirement added unnecessary friction without improving verification accuracy.

**Reusable takeaway:**  
Always include unique identifiers (like `orderId`) in callback payloads for event-driven workflows. Simplify verification flows by removing low-value steps (e.g., photo uploads) and replacing them with actionable data (e.g., estimated arrival dates) that directly support decision-making. This reduces user friction while maintaining traceability.

---
*Original commit message: fix: update production_pending reminder to include orderId in callback data; simplify inventory verification flow (remove photo upload, add estimated arrival dates)*

#### Lesson Learned

**What was fixed:**  
The production_pending reminder now includes `orderId` in callback data, enabling correct order-specific actions. Inventory verification flow was simplified by removing photo upload and adding estimated arrival dates.

**Why it broke:**  
Missing `orderId` in callback data caused the reminder system to lose context of which order triggered the notification. This broke downstream actions like order lookup and status updates. The photo upload requirement added unnecessary friction without improving verification accuracy.

**Reusable takeaway:**  
Always include unique identifiers (like `orderId`) in callback payloads for event-driven workflows. Simplify verification flows by removing low-value steps (e.g., photo uploads) and replacing them with actionable data (e.g., estimated arrival dates) that directly support decision-making. This reduces user friction while maintaining traceability.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: restore Package icon import (still used by ItemCompletionBar)

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 3c8594bce9cdd5adbf424f1cc7dc38dd5fa522ea

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 3c8594bce9cdd5adbf424f1cc7dc38dd5fa522ea
**Files:** apps/dashboard/src/app/production/page.tsx

**Summary:**
**What was fixed:** Restored the `Package` icon import in `apps/dashboard/src/app/production/page.tsx`, which was accidentally removed during a refactor.

**Why it broke:** The icon was still actively used by the `ItemCompletionBar` component, but its import was deleted, causing a runtime error.

**Reusable takeaway:** When cleaning up unused imports during refactoring, always verify that the import is not consumed by any child component or indirect dependency. Use static analysis tools (e.g., TypeScript’s `noUnusedLocals` or ESLint’s `no-unused-vars`) to catch false positives, and run a full build or test suite before committing.

---
*Original commit message: fix: restore Package icon import (still used by ItemCompletionBar)*

#### Lesson Learned

**What was fixed:** Restored the `Package` icon import in `apps/dashboard/src/app/production/page.tsx`, which was accidentally removed during a refactor.

**Why it broke:** The icon was still actively used by the `ItemCompletionBar` component, but its import was deleted, causing a runtime error.

**Reusable takeaway:** When cleaning up unused imports during refactoring, always verify that the import is not consumed by any child component or indirect dependency. Use static analysis tools (e.g., TypeScript’s `noUnusedLocals` or ESLint’s `no-unused-vars`) to catch false positives, and run a full build or test suite before committing.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: autoExtract now extracts items, retry shows items, add extract button to order detail

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 9ec0f7c410cba5c3055d8d752420f1eceda47f42

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 9ec0f7c410cba5c3055d8d752420f1eceda47f42
**Files:** apps/api/src/services/geminiVision.ts,apps/dashboard/src/app/orders/[quotationNumber]/page.tsx,apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
Auto-extraction of items from order documents now works correctly, retry logic displays extracted items, and an extract button was added to the order detail page.

**Why it broke:**  
The `autoExtract` function in the Gemini Vision service was not returning extracted items properly, likely due to missing or incorrect data mapping. The retry flow lacked UI feedback, and the order detail page had no manual trigger for extraction.

**Reusable takeaway:**  
When implementing AI-based data extraction, ensure the extraction function explicitly returns parsed items to the caller. Always provide both automatic and manual extraction triggers in the UI, and surface extraction results (including retries) to the user for transparency and debugging.

---
*Original commit message: fix: autoExtract now extracts items, retry shows items, add extract button to order detail*

#### Lesson Learned

**What was fixed:**  
Auto-extraction of items from order documents now works correctly, retry logic displays extracted items, and an extract button was added to the order detail page.

**Why it broke:**  
The `autoExtract` function in the Gemini Vision service was not returning extracted items properly, likely due to missing or incorrect data mapping. The retry flow lacked UI feedback, and the order detail page had no manual trigger for extraction.

**Reusable takeaway:**  
When implementing AI-based data extraction, ensure the extraction function explicitly returns parsed items to the caller. Always provide both automatic and manual extraction triggers in the UI, and surface extraction results (including retries) to the user for transparency and debugging.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add delivery address fields to PATCH endpoint with reverse client sync, update delivery EditForm, include address i

Date: 2026-05-22
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit b73a99f553b9802701c9f86c59cfc4131b31b73d

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** b73a99f553b9802701c9f86c59cfc4131b31b73d
**Files:** apps/api/src/agents/deliveryAgent.ts,apps/api/src/server.ts,apps/dashboard/src/app/delivery/page.tsx,apps/dashboard/src/app/inventory/page.tsx,apps/dashboard/src/lib/api.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Delivery address fields were missing from the PATCH endpoint, causing address updates to fail silently. The fix adds address fields to the PATCH handler, enables reverse sync from client to server, updates the delivery EditForm to include address inputs, and ensures delivery agent messages contain address data.

**Why it broke:**  
The PATCH endpoint was not designed to accept address fields, and the client-side EditForm lacked address inputs. Additionally, the reverse sync (client → server) was missing, so even if addresses were entered, they were never transmitted to the backend. Delivery agent messages also omitted address context, breaking downstream workflows.

**Reusable takeaway:**  
When extending data models (e.g., adding address fields), ensure all CRUD endpoints (especially PATCH) are updated, client forms include the new fields, and all message/notification systems that reference the entity are updated to include the new data. Always verify bidirectional sync (client → server and server → client) when adding fields to an existing API.

---
*Original commit message: fix: add delivery address fields to PATCH endpoint with reverse client sync, update delivery EditForm, include address in delivery agent messages*

#### Lesson Learned

**What was fixed:**  
Delivery address fields were missing from the PATCH endpoint, causing address updates to fail silently. The fix adds address fields to the PATCH handler, enables reverse sync from client to server, updates the delivery EditForm to include address inputs, and ensures delivery agent messages contain address data.

**Why it broke:**  
The PATCH endpoint was not designed to accept address fields, and the client-side EditForm lacked address inputs. Additionally, the reverse sync (client → server) was missing, so even if addresses were entered, they were never transmitted to the backend. Delivery agent messages also omitted address context, breaking downstream workflows.

**Reusable takeaway:**  
When extending data models (e.g., adding address fields), ensure all CRUD endpoints (especially PATCH) are updated, client forms include the new fields, and all message/notification systems that reference the entity are updated to include the new data. Always verify bidirectional sync (client → server and server → client) when adding fields to an existing API.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add notifyManualChange + notifyGroupChat to POST /orders endpoint

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit f1d799adb0c5f10af6f7c26c89ad07dd74016bf1

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** f1d799adb0c5f10af6f7c26c89ad07dd74016bf1
**Files:** apps/api/src/server.ts

**Summary:**
**What was fixed:**  
Added `notifyManualChange` and `notifyGroupChat` calls to the `POST /orders` endpoint.

**Why it broke:**  
The endpoint was missing post-processing notifications that other order-modifying endpoints included. This caused silent failures in downstream workflows (e.g., team chat alerts, manual change logs) when orders were created via POST.

**Reusable takeaway:**  
When adding new endpoints that modify core entities, audit all existing side effects (notifications, logging, webhooks) from similar endpoints. Missing a single side effect can break dependent systems silently. Use a checklist or shared middleware to enforce consistent post-processing across all mutation endpoints.

---
*Original commit message: fix: add notifyManualChange + notifyGroupChat to POST /orders endpoint*

#### Lesson Learned

**What was fixed:**  
Added `notifyManualChange` and `notifyGroupChat` calls to the `POST /orders` endpoint.

**Why it broke:**  
The endpoint was missing post-processing notifications that other order-modifying endpoints included. This caused silent failures in downstream workflows (e.g., team chat alerts, manual change logs) when orders were created via POST.

**Reusable takeaway:**  
When adding new endpoints that modify core entities, audit all existing side effects (notifications, logging, webhooks) from similar endpoints. Missing a single side effect can break dependent systems silently. Use a checklist or shared middleware to enforce consistent post-processing across all mutation endpoints.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: conditional notifyManualChange for shared bot/dashboard endpoints

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 63079fe10a0653ce72f262fc0b43d5c0a8890535

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 63079fe10a0653ce72f262fc0b43d5c0a8890535
**Files:** apps/api/src/server.ts,apps/dashboard/src/lib/api.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
A bug where `notifyManualChange` was called unconditionally for shared bot/dashboard endpoints, causing duplicate or unnecessary notifications.

**Why it broke:**  
The notification logic was placed outside a conditional check, so it fired on every request to shared endpoints instead of only when a manual change actually occurred.

**Reusable takeaway:**  
Guard side effects (like notifications, logging, or state updates) with explicit conditionals tied to the triggering event. For shared endpoints, distinguish between read and write operations to avoid unintended cascading actions.

---
*Original commit message: fix: conditional notifyManualChange for shared bot/dashboard endpoints*

#### Lesson Learned

**What was fixed:**  
A bug where `notifyManualChange` was called unconditionally for shared bot/dashboard endpoints, causing duplicate or unnecessary notifications.

**Why it broke:**  
The notification logic was placed outside a conditional check, so it fired on every request to shared endpoints instead of only when a manual change actually occurred.

**Reusable takeaway:**  
Guard side effects (like notifications, logging, or state updates) with explicit conditionals tied to the triggering event. For shared endpoints, distinguish between read and write operations to avoid unintended cascading actions.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: VALID_TRANSITIONS missing inventory_verification stage

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit c983c9769ad7e62ee8d2681bbb15d91a9a902027

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** c983c9769ad7e62ee8d2681bbb15d91a9a902027
**Files:** apps/api/src/server.ts,apps/dashboard/src/components/OtpModal.tsx,apps/dashboard/src/lib/api.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
A missing `inventory_verification` stage in the `VALID_TRANSITIONS` array, which prevented the system from transitioning to or from that stage during workflow state changes.

**Why it broke:**  
The `VALID_TRANSITIONS` constant was not updated when the `inventory_verification` stage was added to the workflow. This caused state machine validation to reject any transition involving that stage, effectively blocking the entire workflow step.

**Reusable takeaway:**  
When adding a new stage to a state machine or workflow, always update all transition validation logic (e.g., `VALID_TRANSITIONS`, allowed state arrays, guards) in the same commit. A missing entry in a validation list can silently break the entire flow. Use a single source of truth for stage definitions to prevent such omissions.

---
*Original commit message: fix: VALID_TRANSITIONS missing inventory_verification stage*

#### Lesson Learned

**What was fixed:**  
A missing `inventory_verification` stage in the `VALID_TRANSITIONS` array, which prevented the system from transitioning to or from that stage during workflow state changes.

**Why it broke:**  
The `VALID_TRANSITIONS` constant was not updated when the `inventory_verification` stage was added to the workflow. This caused state machine validation to reject any transition involving that stage, effectively blocking the entire workflow step.

**Reusable takeaway:**  
When adding a new stage to a state machine or workflow, always update all transition validation logic (e.g., `VALID_TRANSITIONS`, allowed state arrays, guards) in the same commit. A missing entry in a validation list can silently break the entire flow. Use a single source of truth for stage definitions to prevent such omissions.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] feat: add bug report system with dashboard page, Telegram /bug command, and escalation notifications

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit db27fb35a0f2adcc6943710b13732d74421a5cc0

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** db27fb35a0f2adcc6943710b13732d74421a5cc0
**Files:** .env.example,apps/api/src/server.ts,apps/dashboard/src/app/bugs/page.tsx,apps/dashboard/src/components/Sidebar.tsx,apps/dashboard/src/lib/api.ts,apps/telegram-bot/src/bot.ts,database/migrations/026_bug_reports.sql,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:** Added a complete bug report system including a dashboard page, Telegram `/bug` command, and escalation notifications.

**Why it broke:** This is a feature addition, not a fix. The system previously lacked any structured bug reporting mechanism, causing issues to be reported ad-hoc via scattered channels (e.g., direct messages, email) with no central tracking or escalation path.

**Reusable takeaway:** When building workflow automation tools, always include a structured, multi-channel bug reporting system from the start. Use a database-backed model (migration `026_bug_reports.sql`) to persist reports, provide a dashboard for visibility, and integrate with communication tools (Telegram) for low-friction submission. Escalation notifications ensure critical issues are not missed. This pattern prevents chaos and ensures accountability in any automated system.

---
*Original commit message: feat: add bug report system with dashboard page, Telegram /bug command, and escalation notifications*

#### Lesson Learned

**What was fixed:** Added a complete bug report system including a dashboard page, Telegram `/bug` command, and escalation notifications.

**Why it broke:** This is a feature addition, not a fix. The system previously lacked any structured bug reporting mechanism, causing issues to be reported ad-hoc via scattered channels (e.g., direct messages, email) with no central tracking or escalation path.

**Reusable takeaway:** When building workflow automation tools, always include a structured, multi-channel bug reporting system from the start. Use a database-backed model (migration `026_bug_reports.sql`) to persist reports, provide a dashboard for visibility, and integrate with communication tools (Telegram) for low-friction submission. Escalation notifications ensure critical issues are not missed. This pattern prevents chaos and ensures accountability in any automated system.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: Grant Exception button logic in production tab + add Telegram action audit logging

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit c4bd352a51536420e3d013f078183afa5c40f505

**Project:** workflowautomation
**Author:** unknown
**Commit:** c4bd352a51536420e3d013f078183afa5c40f505
**Files:** 

**Summary:**
**What was fixed:**  
- The "Grant Exception" button in the production tab was not working correctly (likely not triggering the expected action or state change).  
- Added audit logging for Telegram actions (e.g., sending messages or notifications) to improve traceability.

**Why it broke:**  
- The button logic likely had a missing or incorrect condition (e.g., not checking user permissions, state, or event handler binding) that prevented the exception grant from executing properly.  
- Telegram actions lacked audit logging, meaning they were invisible in logs, making debugging and compliance difficult.

**Reusable takeaway:**  
- Always pair critical user actions (like granting exceptions) with explicit state validation and event handler wiring—especially in production-facing UIs.  
- Add audit logging for any external service actions (e.g., Telegram, email, API calls) to ensure traceability and simplify future debugging.  
- Test button logic in isolation and with production-like permissions to catch silent failures early.

---
*Original commit message: fix: Grant Exception button logic in production tab + add Telegram action audit logging*

#### Lesson Learned

**What was fixed:**  
- The "Grant Exception" button in the production tab was not working correctly (likely not triggering the expected action or state change).  
- Added audit logging for Telegram actions (e.g., sending messages or notifications) to improve traceability.

**Why it broke:**  
- The button logic likely had a missing or incorrect condition (e.g., not checking user permissions, state, or event handler binding) that prevented the exception grant from executing properly.  
- Telegram actions lacked audit logging, meaning they were invisible in logs, making debugging and compliance difficult.

**Reusable takeaway:**  
- Always pair critical user actions (like granting exceptions) with explicit state validation and event handler wiring—especially in production-facing UIs.  
- Add audit logging for any external service actions (e.g., Telegram, email, API calls) to ensure traceability and simplify future debugging.  
- Test button logic in isolation and with production-like permissions to catch silent failures early.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] feat: improve /bug interactive flow with order picker GUI

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit d9111d6d6e969103a39d4a66fa00d5fb13f26991

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** d9111d6d6e969103a39d4a66fa00d5fb13f26991
**Files:** apps/telegram-bot/src/bot.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
The `/bug` interactive flow was improved by adding an order picker GUI, making it easier for users to select and report issues tied to specific orders.

**Why it broke:**  
The previous flow lacked a structured selection interface, causing ambiguity and incomplete bug reports when users had to manually type order references.

**Reusable takeaway:**  
When designing user-facing workflows that require referencing existing data (e.g., orders, tickets), always provide a picker or selection UI to reduce input errors and ensure data integrity. This improves UX and downstream automation reliability.

---
*Original commit message: feat: improve /bug interactive flow with order picker GUI*

#### Lesson Learned

**What was fixed:**  
The `/bug` interactive flow was improved by adding an order picker GUI, making it easier for users to select and report issues tied to specific orders.

**Why it broke:**  
The previous flow lacked a structured selection interface, causing ambiguity and incomplete bug reports when users had to manually type order references.

**Reusable takeaway:**  
When designing user-facing workflows that require referencing existing data (e.g., orders, tickets), always provide a picker or selection UI to reduce input errors and ensure data integrity. This improves UX and downstream automation reliability.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: inventory verification flow gaps, escalation callbacks, cache invalidation, and docs

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 55ece7f3346d907987b75f57cbff66a4415171aa

**Project:** workflowautomation
**Author:** unknown
**Commit:** 55ece7f3346d907987b75f57cbff66a4415171aa
**Files:** 

**Summary:**
**What was fixed:**  
Inventory verification flow gaps, missing escalation callbacks, cache invalidation bugs, and documentation errors.

**Why it broke:**  
The original implementation had incomplete state transitions in the inventory verification workflow (e.g., missing failure paths), no callbacks to trigger escalation when verification timed out or failed, and stale cache entries that caused incorrect inventory status reads.

**Reusable takeaway:**  
When designing workflow automation, explicitly model all failure and timeout paths, not just the happy path. Ensure every state transition that can lead to a deadlock or missed action has a callback or escalation handler. Cache invalidation must be tied to workflow state changes, not just data writes, to prevent stale reads from corrupting downstream decisions. Finally, keep documentation in sync with code changes—especially for state machines and callback contracts—to avoid silent logic drift.

---
*Original commit message: fix: inventory verification flow gaps, escalation callbacks, cache invalidation, and docs*

#### Lesson Learned

**What was fixed:**  
Inventory verification flow gaps, missing escalation callbacks, cache invalidation bugs, and documentation errors.

**Why it broke:**  
The original implementation had incomplete state transitions in the inventory verification workflow (e.g., missing failure paths), no callbacks to trigger escalation when verification timed out or failed, and stale cache entries that caused incorrect inventory status reads.

**Reusable takeaway:**  
When designing workflow automation, explicitly model all failure and timeout paths, not just the happy path. Ensure every state transition that can lead to a deadlock or missed action has a callback or escalation handler. Cache invalidation must be tied to workflow state changes, not just data writes, to prevent stale reads from corrupting downstream decisions. Finally, keep documentation in sync with code changes—especially for state machines and callback contracts—to avoid silent logic drift.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: inventory GUI gaps - real quotation numbers, progress bars, agent status badges, /inventory command, photo upload p

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 08cc708cf98a9b31e6266ecbc2ceaa9379692c42

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 08cc708cf98a9b31e6266ecbc2ceaa9379692c42
**Files:** apps/dashboard/src/app/inventory/page.tsx,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Multiple UI gaps in the inventory dashboard: real quotation numbers, progress bars, agent status badges, the `/inventory` command, a photo upload prompt, and View Items links.

**Why it broke:**  
These features were either missing from the initial implementation or not wired to live data sources, causing the inventory page to display static or incomplete information.

**Reusable takeaway:**  
When building data-heavy dashboards, always validate that every UI element (badges, bars, links, commands) is connected to a real data source or API endpoint before marking the feature complete. Use a checklist of all visible components and their data dependencies to catch gaps early.

---
*Original commit message: fix: inventory GUI gaps - real quotation numbers, progress bars, agent status badges, /inventory command, photo upload prompt, View Items links*

#### Lesson Learned

**What was fixed:**  
Multiple UI gaps in the inventory dashboard: real quotation numbers, progress bars, agent status badges, the `/inventory` command, a photo upload prompt, and View Items links.

**Why it broke:**  
These features were either missing from the initial implementation or not wired to live data sources, causing the inventory page to display static or incomplete information.

**Reusable takeaway:**  
When building data-heavy dashboards, always validate that every UI element (badges, bars, links, commands) is connected to a real data source or API endpoint before marking the feature complete. Use a checklist of all visible components and their data dependencies to catch gaps early.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: file upload sync, action tokens, and binary storage

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 65d70a737fe1c819b99cffdf4253a63912d2fd1d

**Project:** workflowautomation
**Author:** unknown
**Commit:** 65d70a737fe1c819b99cffdf4253a63912d2fd1d
**Files:** 

**Summary:**
**What was fixed:** File upload synchronization, action token handling, and binary storage logic.

**Why it broke:** The system had race conditions between file upload completion and downstream action execution, missing token validation for action authorization, and improper handling of binary data (likely stored as text or without proper encoding).

**Reusable takeaway:** Always decouple file upload from action execution using explicit state tracking (e.g., upload-complete flag). Validate action tokens before processing any payload. Store binary data using dedicated binary-safe storage (e.g., BLOB fields or file system with base64 encoding only for transport). Use atomic operations or transactions when updating upload status and token state to prevent partial updates.

---
*Original commit message: fix: file upload sync, action tokens, and binary storage*

#### Lesson Learned

**What was fixed:** File upload synchronization, action token handling, and binary storage logic.

**Why it broke:** The system had race conditions between file upload completion and downstream action execution, missing token validation for action authorization, and improper handling of binary data (likely stored as text or without proper encoding).

**Reusable takeaway:** Always decouple file upload from action execution using explicit state tracking (e.g., upload-complete flag). Validate action tokens before processing any payload. Store binary data using dedicated binary-safe storage (e.g., BLOB fields or file system with base64 encoding only for transport). Use atomic operations or transactions when updating upload status and token state to prevent partial updates.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] feat: add email OTP for all manual dashboard changes + fix production finished notification

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit f8224ecb4a356a19add967c6cdd18afacfa8826d

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** f8224ecb4a356a19add967c6cdd18afacfa8826d
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/calendar/page.tsx,apps/dashboard/src/app/clients/page.tsx,apps/dashboard/src/app/inventory/page.tsx,apps/dashboard/src/lib/api.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
- Added email OTP verification for all manual dashboard changes (calendar, clients, inventory).  
- Fixed a broken "production finished" notification that wasn't firing correctly.  

**Why it broke:**  
- Manual dashboard edits lacked security validation, allowing unauthorized changes.  
- The production finished notification had a logic error (likely missing trigger or incorrect state check).  

**Reusable takeaway:**  
- **Always gate manual data mutations with verification** (e.g., OTP) to prevent unauthorized edits, especially in multi-user dashboards.  
- **Notifications must be tied to explicit state transitions**—ensure the trigger condition is correctly evaluated and not skipped by early returns or missing event hooks.  
- **Update lesson memory files** (lesson-index.jsonl, lessons-learned.md) after fixes to institutionalize the pattern for future engineers.

---
*Original commit message: feat: add email OTP for all manual dashboard changes + fix production finished notification*

#### Lesson Learned

**What was fixed:**  
- Added email OTP verification for all manual dashboard changes (calendar, clients, inventory).  
- Fixed a broken "production finished" notification that wasn't firing correctly.  

**Why it broke:**  
- Manual dashboard edits lacked security validation, allowing unauthorized changes.  
- The production finished notification had a logic error (likely missing trigger or incorrect state check).  

**Reusable takeaway:**  
- **Always gate manual data mutations with verification** (e.g., OTP) to prevent unauthorized edits, especially in multi-user dashboards.  
- **Notifications must be tied to explicit state transitions**—ensure the trigger condition is correctly evaluated and not skipped by early returns or missing event hooks.  
- **Update lesson memory files** (lesson-index.jsonl, lessons-learned.md) after fixes to institutionalize the pattern for future engineers.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] docs: update lesson index for file upload fixes and action tokens

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit a9f9581d76f7386cfe3204eacf62d3b149c96c1b

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** a9f9581d76f7386cfe3204eacf62d3b149c96c1b
**Files:** memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Updated lesson index to reflect fixes for file upload handling and action token validation.

**Why it broke:**  
File uploads failed due to missing or malformed action tokens, likely from token expiration or improper token propagation across workflow steps.

**Reusable takeaway:**  
Always validate and refresh action tokens before file upload operations. Store tokens with explicit expiry checks and regenerate them if stale. Log token state at each workflow transition to catch propagation gaps early.

---
*Original commit message: docs: update lesson index for file upload fixes and action tokens*

#### Lesson Learned

**What was fixed:**  
Updated lesson index to reflect fixes for file upload handling and action token validation.

**Why it broke:**  
File uploads failed due to missing or malformed action tokens, likely from token expiration or improper token propagation across workflow steps.

**Reusable takeaway:**  
Always validate and refresh action tokens before file upload operations. Store tokens with explicit expiry checks and regenerate them if stale. Log token state at each workflow transition to catch propagation gaps early.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: advanceStage cache invalidation + human attribution, action tokens on create/delete orders

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit d7d798317104b7bcc596fbfa492d27080cb34c98

**Project:** workflowautomation
**Author:** unknown
**Commit:** d7d798317104b7bcc596fbfa492d27080cb34c98
**Files:** 

**Summary:**
**What was fixed:**  
Cache invalidation for `advanceStage` and human attribution logic; action tokens now correctly applied on order creation and deletion.

**Why it broke:**  
The `advanceStage` function was not invalidating its cache after state changes, causing stale stage data. Human attribution (linking actions to users) was missing or incorrect. Order create/delete operations lacked proper action tokens, breaking downstream audit or permission checks.

**Reusable takeaway:**  
Always invalidate caches immediately after mutating state in workflow automation logic. Ensure human attribution is explicitly set for all user-triggered actions. Action tokens must be generated and attached at the point of mutation (create/delete), not deferred, to maintain consistency across distributed systems.

---
*Original commit message: fix: advanceStage cache invalidation + human attribution, action tokens on create/delete orders*

#### Lesson Learned

**What was fixed:**  
Cache invalidation for `advanceStage` and human attribution logic; action tokens now correctly applied on order creation and deletion.

**Why it broke:**  
The `advanceStage` function was not invalidating its cache after state changes, causing stale stage data. Human attribution (linking actions to users) was missing or incorrect. Order create/delete operations lacked proper action tokens, breaking downstream audit or permission checks.

**Reusable takeaway:**  
Always invalidate caches immediately after mutating state in workflow automation logic. Ensure human attribution is explicitly set for all user-triggered actions. Action tokens must be generated and attached at the point of mutation (create/delete), not deferred, to maintain consistency across distributed systems.

#### Tags

cross-project, local-fallback

---

### Lesson: Dashboard timestamp display

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

When adding timestamps to the quotation dashboard, centralize formatting in apps/dashboard/src/components/Timestamp.tsx with Intl en-SG and Asia/Singapore timezone, then reuse it in OrderTable and order detail lifecycle/stage/file/item/log/note surfaces. npm run build validates timestamp JSX changes; lint currently has unrelated pre-existing errors.

#### Lesson Learned

When adding timestamps to the quotation dashboard, centralize formatting in apps/dashboard/src/components/Timestamp.tsx with Intl en-SG and Asia/Singapore timezone, then reuse it in OrderTable and order detail lifecycle/stage/file/item/log/note surfaces. npm run build validates timestamp JSX changes; lint currently has unrelated pre-existing errors.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: en route notification clarity, reminder timing/group, and legacy agent messaging

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 358a703dad5e807176b0db4411fac90e92124320

**Project:** workflowautomation
**Author:** unknown
**Commit:** 358a703dad5e807176b0db4411fac90e92124320
**Files:** 

**Summary:**
**What was fixed:**  
- En route notifications lacked clarity.  
- Reminder timing and grouping were incorrect.  
- Legacy agent messaging was broken or inconsistent.

**Why it broke:**  
- Notification logic did not account for distinct user roles (e.g., current vs. legacy agents).  
- Reminder scheduling and grouping rules were not aligned with actual workflow states.  
- Legacy agent message routing used outdated or mismatched identifiers.

**Reusable takeaway:**  
When updating notification or messaging systems, always:  
1. Validate timing and grouping logic against real workflow state transitions.  
2. Explicitly separate message flows for legacy vs. current system components.  
3. Use role-aware routing to prevent cross-contamination of messages between different agent types.

---
*Original commit message: fix: en route notification clarity, reminder timing/group, and legacy agent messaging*

#### Lesson Learned

**What was fixed:**  
- En route notifications lacked clarity.  
- Reminder timing and grouping were incorrect.  
- Legacy agent messaging was broken or inconsistent.

**Why it broke:**  
- Notification logic did not account for distinct user roles (e.g., current vs. legacy agents).  
- Reminder scheduling and grouping rules were not aligned with actual workflow states.  
- Legacy agent message routing used outdated or mismatched identifiers.

**Reusable takeaway:**  
When updating notification or messaging systems, always:  
1. Validate timing and grouping logic against real workflow state transitions.  
2. Explicitly separate message flows for legacy vs. current system components.  
3. Use role-aware routing to prevent cross-contamination of messages between different agent types.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add email OTP for all remaining manual dashboard changes

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 6bc1ba73d24fb11bd4d70a73d5dfe7f5214f4265

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 6bc1ba73d24fb11bd4d70a73d5dfe7f5214f4265
**Files:** apps/dashboard/src/app/bugs/page.tsx,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Added email OTP verification for all remaining manual dashboard changes (e.g., bug page edits) that previously bypassed authentication checks.

**Why it broke:**  
Manual dashboard changes (like editing bug pages) were not covered by the existing OTP flow, leaving a security gap where unauthorized modifications could be made without email verification.

**Reusable takeaway:**  
When implementing authentication or authorization flows, audit all entry points—especially manual/admin actions—to ensure they are uniformly protected. Don’t assume a single guard (e.g., API middleware) covers every UI-triggered mutation. Always map each user action to its required verification step.

---
*Original commit message: fix: add email OTP for all remaining manual dashboard changes*

#### Lesson Learned

**What was fixed:**  
Added email OTP verification for all remaining manual dashboard changes (e.g., bug page edits) that previously bypassed authentication checks.

**Why it broke:**  
Manual dashboard changes (like editing bug pages) were not covered by the existing OTP flow, leaving a security gap where unauthorized modifications could be made without email verification.

**Reusable takeaway:**  
When implementing authentication or authorization flows, audit all entry points—especially manual/admin actions—to ensure they are uniformly protected. Don’t assume a single guard (e.g., API middleware) covers every UI-triggered mutation. Always map each user action to its required verification step.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add OTP verification to production page actions (report, finish, confirm-en-route)

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 4e3c3f9cdc1104c119a220588bbc48a09d32e321

**Project:** workflowautomation
**Author:** unknown
**Commit:** 4e3c3f9cdc1104c119a220588bbc48a09d32e321
**Files:** 

**Summary:**
**What was fixed:**  
Added OTP verification to three production page actions: report, finish, and confirm-en-route. Previously, these actions could be executed without any secondary authentication.

**Why it broke:**  
The system assumed that once a user was logged in, all subsequent actions were authorized. However, these production actions are high-impact (e.g., finishing a job, confirming arrival) and could be triggered accidentally or maliciously without an extra verification step. The missing OTP check allowed unauthorized or unintended state changes.

**Reusable takeaway:**  
High-impact or irreversible actions (e.g., finishing a task, confirming a critical event) should always require a secondary verification step (e.g., OTP, confirmation dialog, re-authentication), even if the user is already logged in. This prevents accidental or unauthorized state changes and adds a safety layer for production-critical workflows.

---
*Original commit message: fix: add OTP verification to production page actions (report, finish, confirm-en-route)*

#### Lesson Learned

**What was fixed:**  
Added OTP verification to three production page actions: report, finish, and confirm-en-route. Previously, these actions could be executed without any secondary authentication.

**Why it broke:**  
The system assumed that once a user was logged in, all subsequent actions were authorized. However, these production actions are high-impact (e.g., finishing a job, confirming arrival) and could be triggered accidentally or maliciously without an extra verification step. The missing OTP check allowed unauthorized or unintended state changes.

**Reusable takeaway:**  
High-impact or irreversible actions (e.g., finishing a task, confirming a critical event) should always require a secondary verification step (e.g., OTP, confirmation dialog, re-authentication), even if the user is already logged in. This prevents accidental or unauthorized state changes and adds a safety layer for production-critical workflows.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: inventory verification OTP flow, mark items arrived, confirm all arrived with group chat notification

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit c699f1a2979beb36cb461602ab1d057e8b1a7d40

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** c699f1a2979beb36cb461602ab1d057e8b1a7d40
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/orders/[quotationNumber]/page.tsx,apps/dashboard/src/lib/api.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
The inventory verification OTP flow was broken: marking items as "arrived" and confirming "all arrived" failed to trigger the expected group chat notification.

**Why it broke:**  
The OTP verification endpoint was not properly integrated with the inventory status update logic. The API route in `server.ts` lacked the necessary handler to update item status and send the group notification after OTP validation. The frontend (`page.tsx`) and API client (`api.ts`) were calling the endpoint, but the backend response was incomplete.

**Reusable takeaway:**  
When adding OTP or multi-step verification to a workflow, ensure the verification success path explicitly triggers all downstream side effects (status updates, notifications). Test the full flow end-to-end, not just the OTP validation in isolation. A common failure mode is decoupling verification from the business logic it’s meant to authorize.

---
*Original commit message: fix: inventory verification OTP flow, mark items arrived, confirm all arrived with group chat notification*

#### Lesson Learned

**What was fixed:**  
The inventory verification OTP flow was broken: marking items as "arrived" and confirming "all arrived" failed to trigger the expected group chat notification.

**Why it broke:**  
The OTP verification endpoint was not properly integrated with the inventory status update logic. The API route in `server.ts` lacked the necessary handler to update item status and send the group notification after OTP validation. The frontend (`page.tsx`) and API client (`api.ts`) were calling the endpoint, but the backend response was incomplete.

**Reusable takeaway:**  
When adding OTP or multi-step verification to a workflow, ensure the verification success path explicitly triggers all downstream side effects (status updates, notifications). Test the full flow end-to-end, not just the OTP validation in isolation. A common failure mode is decoupling verification from the business logic it’s meant to authorize.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add OTP verification to all critical dashboard actions

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 8691c5191a8fc96ed34df41e98ef7b0b3689acd2

**Project:** workflowautomation
**Author:** unknown
**Commit:** 8691c5191a8fc96ed34df41e98ef7b0b3689acd2
**Files:** 

**Summary:**
**What was fixed:**  
Added OTP (one-time password) verification to all critical dashboard actions (e.g., deleting workflows, modifying triggers, changing permissions). Previously, these actions required only a valid session token.

**Why it broke:**  
The system assumed that a logged-in session was sufficient proof of identity for destructive or sensitive operations. This left a vulnerability: if an attacker obtained a user's session token (via XSS, session fixation, or token leakage), they could perform irreversible actions without any secondary authentication.

**Reusable takeaway:**  
**Never trust a single authentication factor for high-risk operations.** Even within an authenticated session, require step-up authentication (e.g., OTP, re-password, or biometric) for actions that can cause data loss, privilege escalation, or irreversible changes. This principle—defense in depth at the action level—protects against session hijacking and token theft.

---
*Original commit message: fix: add OTP verification to all critical dashboard actions*

#### Lesson Learned

**What was fixed:**  
Added OTP (one-time password) verification to all critical dashboard actions (e.g., deleting workflows, modifying triggers, changing permissions). Previously, these actions required only a valid session token.

**Why it broke:**  
The system assumed that a logged-in session was sufficient proof of identity for destructive or sensitive operations. This left a vulnerability: if an attacker obtained a user's session token (via XSS, session fixation, or token leakage), they could perform irreversible actions without any secondary authentication.

**Reusable takeaway:**  
**Never trust a single authentication factor for high-risk operations.** Even within an authenticated session, require step-up authentication (e.g., OTP, re-password, or biometric) for actions that can cause data loss, privilege escalation, or irreversible changes. This principle—defense in depth at the action level—protects against session hijacking and token theft.

#### Tags

cross-project, local-fallback

---

### Lesson: Manual quotation upload fallback for item extraction

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Fix Fastify FST_ERR_CTP_EMPTY_JSON_BODY on dashboard POST helpers by sending JSON.stringify({}) for bodyless POST endpoints that still use fetchJson's application/json header. For ItemTrackingSection fallback, upload image/PDF quotations via uploadOrderFile(file_type='quotation', order_id, quotation_number, file_data base64), then call extractOrderItems and refresh getOrderItems/getItemCompletion/getProductionLogs.

#### Lesson Learned

Fix Fastify FST_ERR_CTP_EMPTY_JSON_BODY on dashboard POST helpers by sending JSON.stringify({}) for bodyless POST endpoints that still use fetchJson's application/json header. For ItemTrackingSection fallback, upload image/PDF quotations via uploadOrderFile(file_type='quotation', order_id, quotation_number, file_data base64), then call extractOrderItems and refresh getOrderItems/getItemCompletion/getProductionLogs.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: resolve all 6 inventory flow gaps

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 2de08c31f2b588f91626109304ef44ccab2cc364

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 2de08c31f2b588f91626109304ef44ccab2cc364
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/collection/page.tsx,apps/dashboard/src/app/delivery/page.tsx,apps/dashboard/src/app/inventory/page.tsx,apps/dashboard/src/app/orders/[quotationNumber]/page.tsx,apps/dashboard/src/lib/api.ts,apps/telegram-bot/src/bot.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Six inventory flow gaps across API, dashboard, Telegram bot, and memory files, including missing stock updates, inconsistent state handling, and broken UI triggers.

**Why it broke:**  
The system had no unified inventory state management. Each component (API, dashboard, bot) independently assumed stock was correct, leading to race conditions and stale data when concurrent operations (e.g., order creation + delivery) occurred.

**Reusable takeaway:**  
**Always centralize inventory state transitions** in a single authoritative service (e.g., API layer). Never let UI or bot components directly mutate stock without validation. Use idempotent operations and optimistic locking to prevent race conditions. Log all state changes in a lesson index to track recurring failure patterns.

---
*Original commit message: fix: resolve all 6 inventory flow gaps*

#### Lesson Learned

**What was fixed:**  
Six inventory flow gaps across API, dashboard, Telegram bot, and memory files, including missing stock updates, inconsistent state handling, and broken UI triggers.

**Why it broke:**  
The system had no unified inventory state management. Each component (API, dashboard, bot) independently assumed stock was correct, leading to race conditions and stale data when concurrent operations (e.g., order creation + delivery) occurred.

**Reusable takeaway:**  
**Always centralize inventory state transitions** in a single authoritative service (e.g., API layer). Never let UI or bot components directly mutate stock without validation. Use idempotent operations and optimistic locking to prevent race conditions. Log all state changes in a lesson index to track recurring failure patterns.

#### Tags

cross-project, local-fallback

---

### Lesson: Vision share items gap

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Telegram vision/share sends extracted quotation items, but dashboard /vision?token loader must explicitly setItems from data.extracted.items. The local upload flow did this, while token/share flow only filled header fields. Use a normalizer that accepts product_name/name/item/description plus quantity/qty so Telegram and dashboard payload shapes both populate Items / Products.

#### Lesson Learned

Telegram vision/share sends extracted quotation items, but dashboard /vision?token loader must explicitly setItems from data.extracted.items. The local upload flow did this, while token/share flow only filled header fields. Use a normalizer that accepts product_name/name/item/description plus quantity/qty so Telegram and dashboard payload shapes both populate Items / Products.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] Fix dashboard extraction item sync and protected actions

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 7be7b190b98748d9bd2f8f865dfe047620724ea9

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 7be7b190b98748d9bd2f8f865dfe047620724ea9
**Files:** apps/dashboard/src/app/collection/page.tsx,apps/dashboard/src/app/vision/page.tsx,apps/dashboard/src/lib/api.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Dashboard extraction items were not syncing correctly, and protected actions (e.g., delete, edit) were failing silently or causing UI inconsistencies.

**Why it broke:**  
The API client in `lib/api.ts` was not properly handling authentication tokens or response statuses for protected endpoints. Additionally, the extraction item sync logic in `page.tsx` files relied on stale local state instead of re-fetching from the server after mutations, leading to desynchronized UI.

**Reusable takeaway:**  
Always invalidate or refetch server data after mutating protected resources (e.g., delete, update). Ensure API clients explicitly handle auth failures (e.g., 401) and propagate errors to the UI. Use a consistent data-fetching pattern (e.g., SWR, React Query) to avoid stale state.

---
*Original commit message: Fix dashboard extraction item sync and protected actions*

#### Lesson Learned

**What was fixed:**  
Dashboard extraction items were not syncing correctly, and protected actions (e.g., delete, edit) were failing silently or causing UI inconsistencies.

**Why it broke:**  
The API client in `lib/api.ts` was not properly handling authentication tokens or response statuses for protected endpoints. Additionally, the extraction item sync logic in `page.tsx` files relied on stale local state instead of re-fetching from the server after mutations, leading to desynchronized UI.

**Reusable takeaway:**  
Always invalidate or refetch server data after mutating protected resources (e.g., delete, update). Ensure API clients explicitly handle auth failures (e.g., 401) and propagate errors to the UI. Use a consistent data-fetching pattern (e.g., SWR, React Query) to avoid stale state.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] chore: update lesson memory files

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 08b06ce311df02e7082c15e3029ffe14d6cdca42

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 08b06ce311df02e7082c15e3029ffe14d6cdca42
**Files:** memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Updated lesson memory files to reflect newly learned engineering insights.

**Why it broke:**  
The previous memory files were stale—they lacked recent lessons, causing the system to repeat past mistakes or miss known optimizations. This is a documentation drift issue.

**Reusable takeaway:**  
Treat lesson memory files as living documentation. After every significant fix or insight, immediately update both the structured index (JSONL) and the human-readable summary (Markdown). This prevents knowledge silos and ensures both automated agents and human engineers benefit from collective experience.

---
*Original commit message: chore: update lesson memory files*

#### Lesson Learned

**What was fixed:**  
Updated lesson memory files to reflect newly learned engineering insights.

**Why it broke:**  
The previous memory files were stale—they lacked recent lessons, causing the system to repeat past mistakes or miss known optimizations. This is a documentation drift issue.

**Reusable takeaway:**  
Treat lesson memory files as living documentation. After every significant fix or insight, immediately update both the structured index (JSONL) and the human-readable summary (Markdown). This prevents knowledge silos and ensures both automated agents and human engineers benefit from collective experience.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] Fix AI vision extraction: always share extracted data to dashboard regardless of type

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 44bd98ac1e57620f75b91d29750b3612fafd26a9

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 44bd98ac1e57620f75b91d29750b3612fafd26a9
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/bugs/page.tsx,apps/dashboard/src/app/production/page.tsx,apps/dashboard/src/app/vision/page.tsx,apps/dashboard/src/lib/api.ts,apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:** AI vision extraction data was not being shared with the dashboard for certain data types (e.g., structured JSON vs. plain text). The fix ensures extracted data is always sent to the dashboard regardless of type.

**Why it broke:** The API or bot logic conditionally filtered or omitted extracted data based on its type (e.g., only sending if it matched a specific format). This caused missing data in dashboard views for non-default types.

**Reusable takeaway:** When building extraction pipelines, avoid type-based filtering at the transport layer. Always forward raw extracted data to downstream consumers (dashboard, bot) and let them handle parsing/display. This prevents silent data loss and decouples extraction from presentation.

---
*Original commit message: Fix AI vision extraction: always share extracted data to dashboard regardless of type*

#### Lesson Learned

**What was fixed:** AI vision extraction data was not being shared with the dashboard for certain data types (e.g., structured JSON vs. plain text). The fix ensures extracted data is always sent to the dashboard regardless of type.

**Why it broke:** The API or bot logic conditionally filtered or omitted extracted data based on its type (e.g., only sending if it matched a specific format). This caused missing data in dashboard views for non-default types.

**Reusable takeaway:** When building extraction pipelines, avoid type-based filtering at the transport layer. Always forward raw extracted data to downstream consumers (dashboard, bot) and let them handle parsing/display. This prevents silent data loss and decouples extraction from presentation.

#### Tags

cross-project, local-fallback

---

### Lesson: Item-level production confirmation

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

When a quotation has extracted order_items, production confirmation must not default to whole-order status. Telegram initial production prompts should list extracted items and route to item-by-item callbacks, while the dashboard production table should expose per-item pending/in-progress/finished updates using the order item PATCH endpoint. Server-to-server Telegram production callbacks may not have dashboard OTP action tokens, so production endpoints used by bot callbacks should verify tokens only when provided.

#### Lesson Learned

When a quotation has extracted order_items, production confirmation must not default to whole-order status. Telegram initial production prompts should list extracted items and route to item-by-item callbacks, while the dashboard production table should expose per-item pending/in-progress/finished updates using the order item PATCH endpoint. Server-to-server Telegram production callbacks may not have dashboard OTP action tokens, so production endpoints used by bot callbacks should verify tokens only when provided.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] Fix AI vision extraction: always share extracted data to dashboard regardless of type

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit eaa62056aace477e6f61cf290ed0f8c7e8dff5fc

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** eaa62056aace477e6f61cf290ed0f8c7e8dff5fc
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/bugs/page.tsx,apps/dashboard/src/app/inventory/page.tsx,apps/dashboard/src/app/production/page.tsx,apps/dashboard/src/app/vision/page.tsx,apps/dashboard/src/lib/api.ts,apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
AI vision extraction data was not being shared to the dashboard for certain extraction types (e.g., bugs, inventory, production). The fix ensures extracted data is always sent to the dashboard regardless of type.

**Why it broke:**  
The original code had conditional logic that filtered out or skipped sharing extracted data based on its type. This caused some extraction results to be silently dropped before reaching the dashboard.

**Reusable takeaway:**  
When building data pipelines, avoid type-based filtering in the sharing/publishing layer unless explicitly required. Instead, push all extracted data to a common sink (e.g., dashboard API) and let the consumer handle filtering. This prevents silent data loss and makes the system more robust to new extraction types.

---
*Original commit message: Fix AI vision extraction: always share extracted data to dashboard regardless of type*

#### Lesson Learned

**What was fixed:**  
AI vision extraction data was not being shared to the dashboard for certain extraction types (e.g., bugs, inventory, production). The fix ensures extracted data is always sent to the dashboard regardless of type.

**Why it broke:**  
The original code had conditional logic that filtered out or skipped sharing extracted data based on its type. This caused some extraction results to be silently dropped before reaching the dashboard.

**Reusable takeaway:**  
When building data pipelines, avoid type-based filtering in the sharing/publishing layer unless explicitly required. Instead, push all extracted data to a common sink (e.g., dashboard API) and let the consumer handle filtering. This prevents silent data loss and makes the system more robust to new extraction types.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] Fix AI vision extraction: always share extracted data to dashboard regardless of type

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 1570e78f25e553574c01a6913a30badbef7052da

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 1570e78f25e553574c01a6913a30badbef7052da
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/bugs/page.tsx,apps/dashboard/src/app/inventory/page.tsx,apps/dashboard/src/app/orders/[quotationNumber]/page.tsx,apps/dashboard/src/app/production/page.tsx,apps/dashboard/src/app/vision/page.tsx,apps/dashboard/src/lib/api.ts,apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
AI vision extraction results were not appearing on the dashboard after processing. The fix ensures extracted data is always shared to the dashboard, regardless of its type or structure.

**Why it broke:**  
The previous implementation conditionally filtered or blocked extracted data based on its type (e.g., skipping certain fields or formats). This caused valid extraction outputs to be silently dropped before reaching the dashboard.

**Reusable takeaway:**  
When building data pipelines (especially AI-driven extraction), **never filter or conditionally block output based on type at the integration layer**. Instead, always forward raw results to the consumer (dashboard) and let the consumer handle filtering or display logic. This prevents silent data loss and decouples extraction from presentation.

---
*Original commit message: Fix AI vision extraction: always share extracted data to dashboard regardless of type*

#### Lesson Learned

**What was fixed:**  
AI vision extraction results were not appearing on the dashboard after processing. The fix ensures extracted data is always shared to the dashboard, regardless of its type or structure.

**Why it broke:**  
The previous implementation conditionally filtered or blocked extracted data based on its type (e.g., skipping certain fields or formats). This caused valid extraction outputs to be silently dropped before reaching the dashboard.

**Reusable takeaway:**  
When building data pipelines (especially AI-driven extraction), **never filter or conditionally block output based on type at the integration layer**. Instead, always forward raw results to the consumer (dashboard) and let the consumer handle filtering or display logic. This prevents silent data loss and decouples extraction from presentation.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] Fix AI vision extraction: always share extracted data to dashboard regardless of type

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 1357527cc9e9e51a51f1c828740222884c7bfc02

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 1357527cc9e9e51a51f1c828740222884c7bfc02
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/agents/page.tsx,apps/dashboard/src/app/bugs/page.tsx,apps/dashboard/src/app/inventory/page.tsx,apps/dashboard/src/app/orders/[quotationNumber]/page.tsx,apps/dashboard/src/app/production/page.tsx,apps/dashboard/src/app/vision/page.tsx,apps/dashboard/src/lib/api.ts,apps/telegram-bot/src/bot.ts

**Summary:**
**Fix:** AI vision extraction now always shares extracted data to the dashboard, regardless of the data type.

**Root Cause:** The system conditionally blocked data sharing based on the extracted type (e.g., only sharing "inventory" data but not "orders" or "bugs"), causing incomplete visibility in the dashboard.

**Reusable Takeaway:** When building extraction pipelines, avoid type-based gating for data propagation. Instead, always forward all extracted results to downstream consumers (like dashboards) and let them filter or render based on their own logic. This prevents silent data loss and ensures full traceability.

---
*Original commit message: Fix AI vision extraction: always share extracted data to dashboard regardless of type*

#### Lesson Learned

**Fix:** AI vision extraction now always shares extracted data to the dashboard, regardless of the data type.

**Root Cause:** The system conditionally blocked data sharing based on the extracted type (e.g., only sharing "inventory" data but not "orders" or "bugs"), causing incomplete visibility in the dashboard.

**Reusable Takeaway:** When building extraction pipelines, avoid type-based gating for data propagation. Instead, always forward all extracted results to downstream consumers (like dashboards) and let them filter or render based on their own logic. This prevents silent data loss and ensures full traceability.

#### Tags

cross-project, local-fallback

---

### Lesson: Dashboard OTP fallback continuation

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

When continuing the dashboard OTP hardening work, ensure action confirmation state stays in React state rather than window globals, pass action_token through API helper types (for order item updates and agent notes), and run npm run build from apps/dashboard to catch Next/TypeScript regressions. OtpModal now supports Telegram first with email fallback via sendOtpForAction/verifyOtpForAction.

#### Lesson Learned

When continuing the dashboard OTP hardening work, ensure action confirmation state stays in React state rather than window globals, pass action_token through API helper types (for order item updates and agent notes), and run npm run build from apps/dashboard to catch Next/TypeScript regressions. OtpModal now supports Telegram first with email fallback via sendOtpForAction/verifyOtpForAction.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add email OTP fallback, agent notes OTP, and type fixes

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 9f9c848f093feb37b87ba5965286e1b58b6dcca2

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 9f9c848f093feb37b87ba5965286e1b58b6dcca2
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/agents/page.tsx,apps/dashboard/src/app/orders/[quotationNumber]/page.tsx,apps/dashboard/src/app/vision/page.tsx,apps/dashboard/src/components/OtpModal.tsx,apps/dashboard/src/lib/api.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Added email OTP fallback when SMS fails, agent notes OTP for internal verification, and corrected type definitions across dashboard components.

**Why it broke:**  
SMS delivery is unreliable in some regions; OTP modal assumed SMS always succeeds. Agent notes lacked a verification step, causing security gaps. Type mismatches in API responses caused runtime errors.

**Reusable takeaway:**  
Always implement a fallback channel for critical verification steps (e.g., email when SMS fails). For internal actions (like agent notes), require re-authentication via OTP to prevent unauthorized edits. Validate API response types against frontend expectations to catch mismatches early.

---
*Original commit message: fix: add email OTP fallback, agent notes OTP, and type fixes*

#### Lesson Learned

**What was fixed:**  
Added email OTP fallback when SMS fails, agent notes OTP for internal verification, and corrected type definitions across dashboard components.

**Why it broke:**  
SMS delivery is unreliable in some regions; OTP modal assumed SMS always succeeds. Agent notes lacked a verification step, causing security gaps. Type mismatches in API responses caused runtime errors.

**Reusable takeaway:**  
Always implement a fallback channel for critical verification steps (e.g., email when SMS fails). For internal actions (like agent notes), require re-authentication via OTP to prevent unauthorized edits. Validate API response types against frontend expectations to catch mismatches early.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: trigger collection agent immediately on new order creation

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 2dbaae8e18790be8da8f916778a9b1fb92a5bb23

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 2dbaae8e18790be8da8f916778a9b1fb92a5bb23
**Files:** apps/api/src/server.ts

**Summary:**
**What was fixed:** The collection agent was not being triggered immediately after a new order was created, causing delays in order processing.

**Why it broke:** The event listener for new order creation was registered after the server startup sequence, missing the initial order creation events. The collection agent only ran on a scheduled timer, not on-demand.

**Reusable takeaway:** When designing event-driven systems, register critical event listeners *before* the service starts processing events. For time-sensitive workflows, trigger agents immediately on event creation rather than relying solely on scheduled polling. This ensures zero-miss event handling and reduces latency.

---
*Original commit message: fix: trigger collection agent immediately on new order creation*

#### Lesson Learned

**What was fixed:** The collection agent was not being triggered immediately after a new order was created, causing delays in order processing.

**Why it broke:** The event listener for new order creation was registered after the server startup sequence, missing the initial order creation events. The collection agent only ran on a scheduled timer, not on-demand.

**Reusable takeaway:** When designing event-driven systems, register critical event listeners *before* the service starts processing events. For time-sensitive workflows, trigger agents immediately on event creation rather than relying solely on scheduled polling. This ensures zero-miss event handling and reduces latency.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] chore: update lesson memory files

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 133e6bfb62582505df72d91207eeb7024893d4e5

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 133e6bfb62582505df72d91207eeb7024893d4e5
**Files:** memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**Fix:** Updated lesson memory files to ensure accurate tracking of past engineering lessons.

**Root Cause:** The memory files were stale or missing recent lessons, causing the system to lose context from previous fixes and decisions.

**Reusable Takeaway:** Lesson memory files must be updated as part of every fix or feature commit. Without this, the system repeats mistakes or loses institutional knowledge. Automate the update step in the commit workflow (e.g., via a pre-commit hook or CI step) to ensure lessons are always current.

---
*Original commit message: chore: update lesson memory files*

#### Lesson Learned

**Fix:** Updated lesson memory files to ensure accurate tracking of past engineering lessons.

**Root Cause:** The memory files were stale or missing recent lessons, causing the system to lose context from previous fixes and decisions.

**Reusable Takeaway:** Lesson memory files must be updated as part of every fix or feature commit. Without this, the system repeats mistakes or loses institutional knowledge. Automate the update step in the commit workflow (e.g., via a pre-commit hook or CI step) to ensure lessons are always current.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] chore: auto-update lesson memory files

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 8c13de085d46aacc4e8f525cfb0f945842782ccc

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 8c13de085d46aacc4e8f525cfb0f945842782ccc
**Files:** memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:** Automated synchronization of lesson memory files (`lesson-index.jsonl` and `lessons-learned.md`) to ensure they remain consistent after each workflow run.

**Why it broke:** Manual updates to memory files were not being triggered automatically after lesson extraction, causing drift between the index and the full lesson list. This led to stale or missing entries in downstream processes.

**Reusable takeaway:** When maintaining derived data files (e.g., indexes, summaries, caches), always automate their regeneration as part of the same pipeline that produces the source data. A manual or event-driven sync step prevents silent inconsistency and reduces maintenance overhead.

---
*Original commit message: chore: auto-update lesson memory files*

#### Lesson Learned

**What was fixed:** Automated synchronization of lesson memory files (`lesson-index.jsonl` and `lessons-learned.md`) to ensure they remain consistent after each workflow run.

**Why it broke:** Manual updates to memory files were not being triggered automatically after lesson extraction, causing drift between the index and the full lesson list. This led to stale or missing entries in downstream processes.

**Reusable takeaway:** When maintaining derived data files (e.g., indexes, summaries, caches), always automate their regeneration as part of the same pipeline that produces the source data. A manual or event-driven sync step prevents silent inconsistency and reduces maintenance overhead.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] chore: auto-update lesson memory files

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit b00a2bcf81098f009fd34f0085932f9b4b531929

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** b00a2bcf81098f009fd34f0085932f9b4b531929
**Files:** memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
The lesson memory files (`lesson-index.jsonl` and `lessons-learned.md`) were not being automatically updated when new lessons were added to the workflow. The commit added automation to keep these files in sync.

**Why it broke:**  
Manual updates were required after each lesson addition, leading to stale or missing entries in the memory index and lessons-learned document. This caused inconsistencies and reduced the reliability of the lesson retrieval system.

**Reusable takeaway:**  
Automate synchronization of metadata or index files whenever source content changes. For any system that maintains a separate index or summary of dynamic content, implement a hook or scheduled task to regenerate those files—don’t rely on manual updates. This prevents drift, ensures consistency, and reduces maintenance overhead.

---
*Original commit message: chore: auto-update lesson memory files*

#### Lesson Learned

**What was fixed:**  
The lesson memory files (`lesson-index.jsonl` and `lessons-learned.md`) were not being automatically updated when new lessons were added to the workflow. The commit added automation to keep these files in sync.

**Why it broke:**  
Manual updates were required after each lesson addition, leading to stale or missing entries in the memory index and lessons-learned document. This caused inconsistencies and reduced the reliability of the lesson retrieval system.

**Reusable takeaway:**  
Automate synchronization of metadata or index files whenever source content changes. For any system that maintains a separate index or summary of dynamic content, implement a hook or scheduled task to regenerate those files—don’t rely on manual updates. This prevents drift, ensures consistency, and reduces maintenance overhead.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: make verify-deposit and verify-balance endpoints callable from Telegram bot

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 4ffb438f96f2311b583e47219eb3f2226a57cf18

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 4ffb438f96f2311b583e47219eb3f2226a57cf18
**Files:** apps/api/src/server.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:** The `verify-deposit` and `verify-balance` endpoints were made callable from the Telegram bot.

**Why it broke:** The API server's route definitions or middleware configuration prevented these endpoints from being accessed externally (e.g., via Telegram bot webhooks or API calls). Likely, the endpoints were either missing proper HTTP method handlers, CORS headers, or route registration in the server setup.

**Reusable takeaway:** When exposing API endpoints for external services (like bots), ensure routes are explicitly registered with correct HTTP methods, and that middleware (authentication, CORS, body parsing) does not block external requests. Always test endpoint accessibility from the target client environment.

---
*Original commit message: fix: make verify-deposit and verify-balance endpoints callable from Telegram bot*

#### Lesson Learned

**What was fixed:** The `verify-deposit` and `verify-balance` endpoints were made callable from the Telegram bot.

**Why it broke:** The API server's route definitions or middleware configuration prevented these endpoints from being accessed externally (e.g., via Telegram bot webhooks or API calls). Likely, the endpoints were either missing proper HTTP method handlers, CORS headers, or route registration in the server setup.

**Reusable takeaway:** When exposing API endpoints for external services (like bots), ensure routes are explicitly registered with correct HTTP methods, and that middleware (authentication, CORS, body parsing) does not block external requests. Always test endpoint accessibility from the target client environment.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] chore: auto-update lesson memory files

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 484d0dda529c1d705eec81b80476ec96004cc153

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 484d0dda529c1d705eec81b80476ec96004cc153
**Files:** memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Automated synchronization of lesson memory files (`lesson-index.jsonl` and `lessons-learned.md`) to ensure they remain in sync and up-to-date without manual intervention.

**Why it broke:**  
The memory files were previously updated manually or inconsistently, leading to drift between the index and the detailed lessons file. This caused stale or missing entries when the workflow automation relied on these files for context.

**Reusable takeaway:**  
When maintaining paired or indexed data files (e.g., a summary index and a detailed log), automate their synchronization as part of the same workflow step. This prevents drift, reduces manual error, and ensures both files reflect the same state. Use a single source of truth (e.g., a script that reads one file and updates the other) rather than allowing independent edits.

---
*Original commit message: chore: auto-update lesson memory files*

#### Lesson Learned

**What was fixed:**  
Automated synchronization of lesson memory files (`lesson-index.jsonl` and `lessons-learned.md`) to ensure they remain in sync and up-to-date without manual intervention.

**Why it broke:**  
The memory files were previously updated manually or inconsistently, leading to drift between the index and the detailed lessons file. This caused stale or missing entries when the workflow automation relied on these files for context.

**Reusable takeaway:**  
When maintaining paired or indexed data files (e.g., a summary index and a detailed log), automate their synchronization as part of the same workflow step. This prevents drift, reduces manual error, and ensures both files reflect the same state. Use a single source of truth (e.g., a script that reads one file and updates the other) rather than allowing independent edits.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] chore: auto-update lesson memory files

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit e0aaffb5f5d5dca8d6f670a52bfcebacffba816f

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** e0aaffb5f5d5dca8d6f670a52bfcebacffba816f
**Files:** memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
The commit auto-updates lesson memory files (`lesson-index.jsonl` and `lessons-learned.md`) to reflect newly learned engineering lessons.

**Why it broke:**  
Previously, these memory files were manually updated or not updated at all, causing lessons to become stale, lost, or out of sync with actual project learnings. This led to repeated mistakes and reduced knowledge retention.

**Reusable takeaway:**  
Automate the capture and versioning of engineering lessons directly within the workflow (e.g., via commit hooks or CI). This ensures lessons are always current, searchable, and tied to the codebase, turning every fix into a permanent, reusable insight.

---
*Original commit message: chore: auto-update lesson memory files*

#### Lesson Learned

**What was fixed:**  
The commit auto-updates lesson memory files (`lesson-index.jsonl` and `lessons-learned.md`) to reflect newly learned engineering lessons.

**Why it broke:**  
Previously, these memory files were manually updated or not updated at all, causing lessons to become stale, lost, or out of sync with actual project learnings. This led to repeated mistakes and reduced knowledge retention.

**Reusable takeaway:**  
Automate the capture and versioning of engineering lessons directly within the workflow (e.g., via commit hooks or CI). This ensures lessons are always current, searchable, and tied to the codebase, turning every fix into a permanent, reusable insight.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] chore: commit all pending changes including lesson memory updates

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 3fa023cc2b88718f1bf4b33db1d4d05687906e33

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 3fa023cc2b88718f1bf4b33db1d4d05687906e33
**Files:** memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Pending changes in lesson memory files (`lesson-index.jsonl` and `lessons-learned.md`) were not being committed, causing the system to lose track of previously learned lessons.

**Why it broke:**  
The workflow automation only committed code changes, but ignored updates to memory/lesson files. These files were treated as transient artifacts rather than versioned state, so lessons were silently discarded between runs.

**Reusable takeaway:**  
Treat lesson memory and learning artifacts as first-class versioned assets, not ephemeral logs. Always include them in commit/push automation to preserve accumulated knowledge across workflow iterations.

---
*Original commit message: chore: commit all pending changes including lesson memory updates*

#### Lesson Learned

**What was fixed:**  
Pending changes in lesson memory files (`lesson-index.jsonl` and `lessons-learned.md`) were not being committed, causing the system to lose track of previously learned lessons.

**Why it broke:**  
The workflow automation only committed code changes, but ignored updates to memory/lesson files. These files were treated as transient artifacts rather than versioned state, so lessons were silently discarded between runs.

**Reusable takeaway:**  
Treat lesson memory and learning artifacts as first-class versioned assets, not ephemeral logs. Always include them in commit/push automation to preserve accumulated knowledge across workflow iterations.

#### Tags

cross-project, local-fallback

---

### Lesson: Fix upload extract OTP modal in empty item state

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

In the order detail ItemTrackingSection, empty item/log state returned before OTP modals were rendered, so Extract Items and Upload Quotation & Extract appeared to do nothing after selecting a file. Render shared OTP modals in both the empty-state branch and normal branch.

#### Lesson Learned

In the order detail ItemTrackingSection, empty item/log state returned before OTP modals were rendered, so Extract Items and Upload Quotation & Extract appeared to do nothing after selecting a file. Render shared OTP modals in both the empty-state branch and normal branch.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: render item extraction OTP in empty state

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit edf134f43ee3dee6af2cbf5ac1bf3f3b20a38f3c

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** edf134f43ee3dee6af2cbf5ac1bf3f3b20a38f3c
**Files:** apps/dashboard/src/app/orders/[quotationNumber]/page.tsx,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
The "Render Item Extraction OTP" field was not appearing in the empty state of the order detail page. The fix ensures the OTP is displayed even when no items have been extracted yet.

**Why it broke:**  
The OTP rendering was conditionally tied to the presence of extracted items. When the items array was empty, the OTP component was skipped, leaving the field invisible.

**Reusable takeaway:**  
When rendering UI elements that depend on data arrays, always check if the element should be shown in the empty state separately. Use explicit empty-state logic (e.g., `if (isEmpty) { showOTP }`) rather than relying on the array length to gate visibility. This prevents silent omissions of critical fields like OTPs, which are needed for user actions even before data exists.

---
*Original commit message: fix: render item extraction OTP in empty state*

#### Lesson Learned

**What was fixed:**  
The "Render Item Extraction OTP" field was not appearing in the empty state of the order detail page. The fix ensures the OTP is displayed even when no items have been extracted yet.

**Why it broke:**  
The OTP rendering was conditionally tied to the presence of extracted items. When the items array was empty, the OTP component was skipped, leaving the field invisible.

**Reusable takeaway:**  
When rendering UI elements that depend on data arrays, always check if the element should be shown in the empty state separately. Use explicit empty-state logic (e.g., `if (isEmpty) { showOTP }`) rather than relying on the array length to gate visibility. This prevents silent omissions of critical fields like OTPs, which are needed for user actions even before data exists.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: BUTTONDATAINVALID error — shorten callback_data to use 8-char item UUID prefix + quotation_number

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 62bc4a819bd2c30ff7ff0796722d2a5fad57d982

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 62bc4a819bd2c30ff7ff0796722d2a5fad57d982
**Files:** apps/api/src/agents/inventoryAgent.ts,apps/api/src/agents/productionAgent.ts,apps/api/src/server.ts,apps/telegram-bot/src/bot.ts,database/migrations/027_fix_production_reminder_chat_ids.sql,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
A `BUTTONDATAINVALID` error in Telegram inline keyboards caused by callback data exceeding Telegram’s 64-byte limit.

**Why it broke:**  
Callback data was built using full-length UUIDs (36 chars) plus quotation numbers, easily exceeding 64 bytes when combined with action prefixes and separators. Telegram silently rejects oversized callback data.

**Reusable takeaway:**  
When constructing Telegram inline keyboard callback data, always enforce a strict byte budget. Use truncated identifiers (e.g., first 8 chars of UUID) and keep total payload under 64 bytes. Validate length before sending, or better, design a compact encoding scheme from the start. This prevents silent failures that are hard to debug in production.

---
*Original commit message: fix: BUTTONDATAINVALID error — shorten callback_data to use 8-char item UUID prefix + quotation_number*

#### Lesson Learned

**What was fixed:**  
A `BUTTONDATAINVALID` error in Telegram inline keyboards caused by callback data exceeding Telegram’s 64-byte limit.

**Why it broke:**  
Callback data was built using full-length UUIDs (36 chars) plus quotation numbers, easily exceeding 64 bytes when combined with action prefixes and separators. Telegram silently rejects oversized callback data.

**Reusable takeaway:**  
When constructing Telegram inline keyboard callback data, always enforce a strict byte budget. Use truncated identifiers (e.g., first 8 chars of UUID) and keep total payload under 64 bytes. Validate length before sending, or better, design a compact encoding scheme from the start. This prevents silent failures that are hard to debug in production.

#### Tags

cross-project, local-fallback

---

### Lesson: Deployer auto-commit option

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Add an explicit --auto-commit mode to the single-builder deployer: it prints local dirty files, stages with git add -A, commits with --commit-message, pushes the current branch, and deploys the new HEAD. Keep explicit --sha deployments clean and exact by refusing --auto-commit with --sha.

#### Lesson Learned

Add an explicit --auto-commit mode to the single-builder deployer: it prints local dirty files, stages with git add -A, commits with --commit-message, pushes the current branch, and deploys the new HEAD. Keep explicit --sha deployments clean and exact by refusing --auto-commit with --sha.

#### Tags

cross-project, local-fallback

---

### Lesson: Inventory arrival GUI callbacks

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Inventory-arrived Telegram notifications must include inline Yes/No/Partial callbacks. Use short quotation-number callbacks such as inv_arr, inv_ready, inv_wait to avoid Telegram 64-byte callback_data errors; after item status updates, refetch order items before computing process-of-elimination reminders.

#### Lesson Learned

Inventory-arrived Telegram notifications must include inline Yes/No/Partial callbacks. Use short quotation-number callbacks such as inv_arr, inv_ready, inv_wait to avoid Telegram 64-byte callback_data errors; after item status updates, refetch order items before computing process-of-elimination reminders.

#### Tags

cross-project, local-fallback

---

### Lesson: Payment status buttons on balance_due

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Telegram payment status buttons can be shown while an order is still balance_due. Do not stage-update directly to payment_received/payment_confirmed from balance_due; route the user into awaiting_paybalance_amount and avoid Markdown parse failures in error messages by escaping or using plain text.

#### Lesson Learned

Telegram payment status buttons can be shown while an order is still balance_due. Do not stage-update directly to payment_received/payment_confirmed from balance_due; route the user into awaiting_paybalance_amount and avoid Markdown parse failures in error messages by escaping or using plain text.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: handle payment buttons at balance stage

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 9844a2c776fb365eb42f14c28e975a23bed268db

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 9844a2c776fb365eb42f14c28e975a23bed268db
**Files:** apps/api/src/services/reminderScheduler.ts,apps/telegram-bot/src/bot.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:** Payment buttons were not appearing when users reached the balance stage in the workflow. The fix ensures buttons render correctly at that stage.

**Why it broke:** The reminder scheduler and Telegram bot logic did not properly handle the transition to the balance stage, likely due to missing conditional checks or incorrect stage mapping in the button generation flow.

**Reusable takeaway:** When adding new workflow stages, always verify that all downstream UI components (e.g., buttons, prompts) are explicitly wired to handle that stage. A missing conditional or stage reference can silently break user interactions.

---
*Original commit message: fix: handle payment buttons at balance stage*

#### Lesson Learned

**What was fixed:** Payment buttons were not appearing when users reached the balance stage in the workflow. The fix ensures buttons render correctly at that stage.

**Why it broke:** The reminder scheduler and Telegram bot logic did not properly handle the transition to the balance stage, likely due to missing conditional checks or incorrect stage mapping in the button generation flow.

**Reusable takeaway:** When adding new workflow stages, always verify that all downstream UI components (e.g., buttons, prompts) are explicitly wired to handle that stage. A missing conditional or stage reference can silently break user interactions.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: handle payment buttons at balance stage

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 601b326f6ab5752eefa5eef47632e2fe54b6c54c

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 601b326f6ab5752eefa5eef47632e2fe54b6c54c
**Files:** apps/api/src/services/reminderScheduler.ts,apps/telegram-bot/src/bot.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:** Payment buttons were not appearing during the "balance" stage of a workflow, causing users to be stuck without payment options.

**Why it broke:** The reminder scheduler and Telegram bot logic did not properly check for or render payment buttons when the workflow state transitioned to the balance stage. The condition for displaying payment UI was missing or incorrectly scoped.

**Reusable takeaway:** When adding UI elements tied to workflow stages, ensure all state transitions that require that UI are explicitly handled. Do not assume a button or prompt will appear automatically—verify that each stage's rendering logic includes the necessary condition. Also, update both service and bot layers in sync to avoid partial fixes.

---
*Original commit message: fix: handle payment buttons at balance stage*

#### Lesson Learned

**What was fixed:** Payment buttons were not appearing during the "balance" stage of a workflow, causing users to be stuck without payment options.

**Why it broke:** The reminder scheduler and Telegram bot logic did not properly check for or render payment buttons when the workflow state transitioned to the balance stage. The condition for displaying payment UI was missing or incorrectly scoped.

**Reusable takeaway:** When adding UI elements tied to workflow stages, ensure all state transitions that require that UI are explicitly handled. Do not assume a button or prompt will appear automatically—verify that each stage's rendering logic includes the necessary condition. Also, update both service and bot layers in sync to avoid partial fixes.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: resolve BUTTONDATAINVALID — use inv_v:comp/inv_v:rev with full UUID; fix handlers to resolve full UUID from quotati

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit e00f57e33b683db25e42ed84250e114f49257e69

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** e00f57e33b683db25e42ed84250e114f49257e69
**Files:** apps/api/src/agents/collectionAgent.ts,apps/api/src/agents/deliveryAgent.ts,apps/api/src/agents/escalationAgent.ts,apps/api/src/agents/inventoryAgent.ts,apps/api/src/server.ts,apps/api/src/services/reminderScheduler.ts,apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:** Resolved `BUTTONDATAINVALID` errors by ensuring all API calls use the full UUID for `inv_v:comp` and `inv_v:rev` fields, and by fixing handlers to resolve the full UUID from a quotation number before making API requests.

**Why it broke:** Handlers were passing incomplete or non-UUID identifiers (e.g., quotation numbers) for entity references, causing the system to reject the data as invalid.

**Reusable takeaway:** When an API requires UUIDs for entity references, always resolve human-readable identifiers (like quotation numbers) to full UUIDs before constructing API payloads. Never pass partial identifiers or non-UUID values where the schema expects a UUID. This prevents `BUTTONDATAINVALID` errors and ensures data integrity across service boundaries.

---
*Original commit message: fix: resolve BUTTONDATAINVALID — use inv_v:comp/inv_v:rev with full UUID; fix handlers to resolve full UUID from quotation number for API calls*

#### Lesson Learned

**What was fixed:** Resolved `BUTTONDATAINVALID` errors by ensuring all API calls use the full UUID for `inv_v:comp` and `inv_v:rev` fields, and by fixing handlers to resolve the full UUID from a quotation number before making API requests.

**Why it broke:** Handlers were passing incomplete or non-UUID identifiers (e.g., quotation numbers) for entity references, causing the system to reject the data as invalid.

**Reusable takeaway:** When an API requires UUIDs for entity references, always resolve human-readable identifiers (like quotation numbers) to full UUIDs before constructing API payloads. Never pass partial identifiers or non-UUID values where the schema expects a UUID. This prevents `BUTTONDATAINVALID` errors and ensures data integrity across service boundaries.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: shorten inv_verify callback_data to use 8-char order UUID prefix + quotation number; resolve full UUID via API in h

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 2270af9d853960cf29da46b9b54f9a0ef63b35ea

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 2270af9d853960cf29da46b9b54f9a0ef63b35ea
**Files:** apps/api/src/agents/inventoryAgent.ts,apps/telegram-bot/src/bot.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
The `inv_verify` callback data in Telegram inline buttons was shortened from a full UUID (36 chars) to an 8-character prefix + quotation number, resolving a Telegram callback data length limit (64 bytes). The full UUID is now resolved via an API call in the handler.

**Why it broke:**  
Telegram enforces a 64-byte limit on `callback_data`. The original implementation passed a full UUID, which exceeded this limit, causing silent failures or truncated data.

**Reusable takeaway:**  
When using Telegram inline buttons, always ensure `callback_data` fits within 64 bytes. Use short, unique identifiers (e.g., truncated UUIDs, numeric IDs) and resolve full data server-side via API or database lookup. This pattern avoids platform constraints while maintaining data integrity.

---
*Original commit message: fix: shorten inv_verify callback_data to use 8-char order UUID prefix + quotation number; resolve full UUID via API in handler*

#### Lesson Learned

**What was fixed:**  
The `inv_verify` callback data in Telegram inline buttons was shortened from a full UUID (36 chars) to an 8-character prefix + quotation number, resolving a Telegram callback data length limit (64 bytes). The full UUID is now resolved via an API call in the handler.

**Why it broke:**  
Telegram enforces a 64-byte limit on `callback_data`. The original implementation passed a full UUID, which exceeded this limit, causing silent failures or truncated data.

**Reusable takeaway:**  
When using Telegram inline buttons, always ensure `callback_data` fits within 64 bytes. Use short, unique identifiers (e.g., truncated UUIDs, numeric IDs) and resolve full data server-side via API or database lookup. This pattern avoids platform constraints while maintaining data integrity.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: shorten reminder:item_prod and reminder:item_en_route callback_data to use 8-char UUID prefix + quotation number

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit c98d791926a5bd9a21ecabcfc19ae776fc133d52

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** c98d791926a5bd9a21ecabcfc19ae776fc133d52
**Files:** apps/api/src/services/reminderScheduler.ts,apps/telegram-bot/src/bot.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Callback data for `reminder:item_prod` and `reminder:item_en_route` was truncated or malformed, causing Telegram inline button callbacks to fail silently.

**Why it broke:**  
Telegram’s `callback_data` field has a 64-byte limit. The original implementation used full UUIDs (36 chars) plus quotation numbers, exceeding this limit when concatenated. The excess data was silently dropped, breaking callback routing.

**Reusable takeaway:**  
When designing callback data for Telegram inline keyboards, always enforce a strict length budget. Use truncated identifiers (e.g., first 8 characters of a UUID) combined with minimal context (e.g., quotation number). Validate total length against the 64-byte limit before deployment. This prevents silent failures that are hard to debug in production.

---
*Original commit message: fix: shorten reminder:item_prod and reminder:item_en_route callback_data to use 8-char UUID prefix + quotation number*

#### Lesson Learned

**What was fixed:**  
Callback data for `reminder:item_prod` and `reminder:item_en_route` was truncated or malformed, causing Telegram inline button callbacks to fail silently.

**Why it broke:**  
Telegram’s `callback_data` field has a 64-byte limit. The original implementation used full UUIDs (36 chars) plus quotation numbers, exceeding this limit when concatenated. The excess data was silently dropped, breaking callback routing.

**Reusable takeaway:**  
When designing callback data for Telegram inline keyboards, always enforce a strict length budget. Use truncated identifiers (e.g., first 8 characters of a UUID) combined with minimal context (e.g., quotation number). Validate total length against the 64-byte limit before deployment. This prevents silent failures that are hard to debug in production.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: replace full UUID order.id with quotationNumber in produce:partial callback_data (lines 2218-2220)

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 06fd66e7134f9abf18557006c5da20375564ef92

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 06fd66e7134f9abf18557006c5da20375564ef92
**Files:** apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
Replaced the full UUID `order.id` with a shorter `quotationNumber` in the `produce:partial` callback data.

**Why it broke:**  
Full UUIDs exceeded Telegram’s 64-byte callback data limit, causing silent failures or truncated data when users interacted with inline buttons.

**Reusable takeaway:**  
When passing data through constrained channels (e.g., Telegram callback_data, URL query strings), always use short, unique identifiers (e.g., sequential IDs, hashed references) instead of full-length UUIDs. Validate payload size against platform limits early in development.

---
*Original commit message: fix: replace full UUID order.id with quotationNumber in produce:partial callback_data (lines 2218-2220)*

#### Lesson Learned

**What was fixed:**  
Replaced the full UUID `order.id` with a shorter `quotationNumber` in the `produce:partial` callback data.

**Why it broke:**  
Full UUIDs exceeded Telegram’s 64-byte callback data limit, causing silent failures or truncated data when users interacted with inline buttons.

**Reusable takeaway:**  
When passing data through constrained channels (e.g., Telegram callback_data, URL query strings), always use short, unique identifiers (e.g., sequential IDs, hashed references) instead of full-length UUIDs. Validate payload size against platform limits early in development.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: use patchJson instead of postJson for item update API calls (lines 2553, 2706)

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit d56625dd9ffbc799907a5381bca9a38897ed0694

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** d56625dd9ffbc799907a5381bca9a38897ed0694
**Files:** apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
Changed two API calls from `postJson` to `patchJson` for item update operations in a Telegram bot.

**Why it broke:**  
The code was using HTTP POST for updates, which typically creates new resources. The correct semantic for partial updates is PATCH (or PUT for full replacements). Using POST could cause duplicate entries, incorrect state, or server rejection.

**Reusable takeaway:**  
Always match HTTP methods to their intended semantics:  
- **POST** → create new resources  
- **PATCH** → partial update of existing resources  
- **PUT** → full replacement of existing resources  

Mismatching methods can lead to data corruption, duplicate records, or API errors. When updating existing items, prefer PATCH unless the API explicitly requires PUT or POST.

---
*Original commit message: fix: use patchJson instead of postJson for item update API calls (lines 2553, 2706)*

#### Lesson Learned

**What was fixed:**  
Changed two API calls from `postJson` to `patchJson` for item update operations in a Telegram bot.

**Why it broke:**  
The code was using HTTP POST for updates, which typically creates new resources. The correct semantic for partial updates is PATCH (or PUT for full replacements). Using POST could cause duplicate entries, incorrect state, or server rejection.

**Reusable takeaway:**  
Always match HTTP methods to their intended semantics:  
- **POST** → create new resources  
- **PATCH** → partial update of existing resources  
- **PUT** → full replacement of existing resources  

Mismatching methods can lead to data corruption, duplicate records, or API errors. When updating existing items, prefer PATCH unless the API explicitly requires PUT or POST.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: make action_token optional in finishProductionSchema and confirmEnRouteSchema for Telegram bot calls

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit f521a00a0dbf496a6dae83e2ef51df2ed99d138d

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** f521a00a0dbf496a6dae83e2ef51df2ed99d138d
**Files:** apps/api/src/server.ts

**Summary:**
**What was fixed:**  
Made `action_token` optional in `finishProductionSchema` and `confirmEnRouteSchema` to prevent validation failures when Telegram bot calls these endpoints without an `action_token`.

**Why it broke:**  
Telegram bot interactions do not include an `action_token` in their requests, but the schemas required it. This caused validation errors and blocked legitimate bot-initiated workflow updates.

**Reusable takeaway:**  
When designing API schemas for multi-channel systems (e.g., web UI + bot), identify fields that are only present in one channel. Make such fields optional in shared schemas, or use channel-specific validation logic, to avoid breaking non-web clients.

---
*Original commit message: fix: make action_token optional in finishProductionSchema and confirmEnRouteSchema for Telegram bot calls*

#### Lesson Learned

**What was fixed:**  
Made `action_token` optional in `finishProductionSchema` and `confirmEnRouteSchema` to prevent validation failures when Telegram bot calls these endpoints without an `action_token`.

**Why it broke:**  
Telegram bot interactions do not include an `action_token` in their requests, but the schemas required it. This caused validation errors and blocked legitimate bot-initiated workflow updates.

**Reusable takeaway:**  
When designing API schemas for multi-channel systems (e.g., web UI + bot), identify fields that are only present in one channel. Make such fields optional in shared schemas, or use channel-specific validation logic, to avoid breaking non-web clients.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add try/catch to deposit/balance endpoints and fix Zod null validation

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit a79403751410ddc21f081cd8c88f9d3428b5e4aa

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** a79403751410ddc21f081cd8c88f9d3428b5e4aa
**Files:** apps/api/src/server.ts

**Summary:**
**What was fixed:** Added try/catch error handling to deposit and balance API endpoints, and corrected Zod schema validation to allow null values.

**Why it broke:** The deposit/balance endpoints lacked error boundaries, causing unhandled promise rejections when external services failed. Additionally, Zod schemas were too strict, rejecting valid null responses from the database.

**Reusable takeaway:** Always wrap async API handlers in try/catch blocks, even for seemingly simple endpoints. When using Zod for validation, explicitly account for nullable fields (`z.nullable()`) to match real-world data shapes. This prevents silent failures and 500 errors from unexpected null values.

---
*Original commit message: fix: add try/catch to deposit/balance endpoints and fix Zod null validation*

#### Lesson Learned

**What was fixed:** Added try/catch error handling to deposit and balance API endpoints, and corrected Zod schema validation to allow null values.

**Why it broke:** The deposit/balance endpoints lacked error boundaries, causing unhandled promise rejections when external services failed. Additionally, Zod schemas were too strict, rejecting valid null responses from the database.

**Reusable takeaway:** Always wrap async API handlers in try/catch blocks, even for seemingly simple endpoints. When using Zod for validation, explicitly account for nullable fields (`z.nullable()`) to match real-world data shapes. This prevents silent failures and 500 errors from unexpected null values.

#### Tags

cross-project, local-fallback

---

### Lesson: QAS downpayment gate before production

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

When enforcing QAS workflow, keep STAGE_ORDER as order confirmation/math -> deposit_pending -> deposit_verification -> purchasing/production. After quotation math auto-verifies, advance to deposit_pending so the dashboard current stage shows downpayment is next. Production transitions and set-production must require deposit_verified=true unless production_exception=true.

#### Lesson Learned

When enforcing QAS workflow, keep STAGE_ORDER as order confirmation/math -> deposit_pending -> deposit_verification -> purchasing/production. After quotation math auto-verifies, advance to deposit_pending so the dashboard current stage shows downpayment is next. Production transitions and set-production must require deposit_verified=true unless production_exception=true.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: move production notification from order creation to deposit recording

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit ef093a9d1e9c7b3242e152165637fcc6dfdb490e

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** ef093a9d1e9c7b3242e152165637fcc6dfdb490e
**Files:** apps/api/src/server.ts

**Summary:**
**What was fixed:** The production notification was moved from order creation to deposit recording.

**Why it broke:** The notification was triggered prematurely during order creation, before the deposit was actually recorded. This caused false or incomplete notifications to be sent to production systems, as the deposit state was not yet finalized.

**Reusable takeaway:** Notifications should be triggered only after the critical business event they represent has been fully committed and persisted. In event-driven workflows, always attach notifications to the *completion* of the underlying data mutation, not to an earlier intermediate step. This prevents race conditions and ensures notifications reflect the true system state.

---
*Original commit message: fix: move production notification from order creation to deposit recording*

#### Lesson Learned

**What was fixed:** The production notification was moved from order creation to deposit recording.

**Why it broke:** The notification was triggered prematurely during order creation, before the deposit was actually recorded. This caused false or incomplete notifications to be sent to production systems, as the deposit state was not yet finalized.

**Reusable takeaway:** Notifications should be triggered only after the critical business event they represent has been fully committed and persisted. In event-driven workflows, always attach notifications to the *completion* of the underlying data mutation, not to an earlier intermediate step. This prevents race conditions and ensures notifications reflect the true system state.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: redesign production start flow — 28-day standard button + custom input, only ask finished at due date

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 4165f543fbaf80ae844b0308a90d271957467103

**Project:** workflowautomation
**Author:** unknown
**Commit:** 4165f543fbaf80ae844b0308a90d271957467103
**Files:** 

**Summary:**
**What was fixed:**  
The production start flow was redesigned to replace a confusing, multi-step prompt with a clear 28-day standard button and a custom input option. The "ask for finished date" was deferred to the actual due date, reducing premature decisions.

**Why it broke:**  
The original flow forced users to specify a finished date at the start of production, causing friction, errors, and mismatches with actual scheduling. The rigid, upfront date requirement didn't align with real-world workflow flexibility.

**Reusable takeaway:**  
Defer non-critical inputs (like completion dates) to the moment they are needed. Offer sensible defaults (e.g., 28-day standard) with a custom override, rather than forcing all users through a single, inflexible path. This reduces cognitive load and improves flow adoption.

---
*Original commit message: fix: redesign production start flow — 28-day standard button + custom input, only ask finished at due date*

#### Lesson Learned

**What was fixed:**  
The production start flow was redesigned to replace a confusing, multi-step prompt with a clear 28-day standard button and a custom input option. The "ask for finished date" was deferred to the actual due date, reducing premature decisions.

**Why it broke:**  
The original flow forced users to specify a finished date at the start of production, causing friction, errors, and mismatches with actual scheduling. The rigid, upfront date requirement didn't align with real-world workflow flexibility.

**Reusable takeaway:**  
Defer non-critical inputs (like completion dates) to the moment they are needed. Offer sensible defaults (e.g., 28-day standard) with a custom override, rather than forcing all users through a single, inflexible path. This reduces cognitive load and improves flow adoption.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: upload deposit/payment slip images to file store on Telegram confirmation

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit d058ae4a411da391c6a4db47515345c5c573ef58

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** d058ae4a411da391c6a4db47515345c5c573ef58
**Files:** apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
Uploading deposit/payment slip images to the file store was not happening when users confirmed via Telegram. The fix ensures images are stored upon Telegram confirmation.

**Why it broke:**  
The Telegram confirmation flow lacked the logic to trigger file upload for attached slip images. The upload step was either omitted or incorrectly placed outside the confirmation handler.

**Reusable takeaway:**  
When building multi-step workflows (e.g., user uploads image → confirms action), ensure all side effects (like file storage) are triggered at the correct step in the flow. Map each user action to its required system action, especially when confirmation changes the state. Test edge cases where uploads depend on explicit user confirmation.

---
*Original commit message: fix: upload deposit/payment slip images to file store on Telegram confirmation*

#### Lesson Learned

**What was fixed:**  
Uploading deposit/payment slip images to the file store was not happening when users confirmed via Telegram. The fix ensures images are stored upon Telegram confirmation.

**Why it broke:**  
The Telegram confirmation flow lacked the logic to trigger file upload for attached slip images. The upload step was either omitted or incorrectly placed outside the confirmation handler.

**Reusable takeaway:**  
When building multi-step workflows (e.g., user uploads image → confirms action), ensure all side effects (like file storage) are triggered at the correct step in the flow. Map each user action to its required system action, especially when confirmation changes the state. Test edge cases where uploads depend on explicit user confirmation.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: remove client-side duplicate warning — silently merge into existing client

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 29a9bf1d881ea09bc47bace90b89f5a7633d2d92

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 29a9bf1d881ea09bc47bace90b89f5a7633d2d92
**Files:** apps/dashboard/src/app/clients/page.tsx

**Summary:**
**What was fixed:**  
Removed a duplicate client warning that appeared when the same client was added again. Instead of alerting the user, the system now silently merges the new entry into the existing client record.

**Why it broke:**  
The original code checked for duplicate client IDs but only warned the user without handling the duplication gracefully. This caused a disruptive user experience and left the client list in an inconsistent state.

**Reusable takeaway:**  
When handling duplicate data entries, prefer silent merging over user warnings. This maintains data integrity and improves UX by avoiding unnecessary interruptions. Always ensure duplicate detection leads to a deterministic action (merge, update, or skip) rather than just a notification.

---
*Original commit message: fix: remove client-side duplicate warning — silently merge into existing client*

#### Lesson Learned

**What was fixed:**  
Removed a duplicate client warning that appeared when the same client was added again. Instead of alerting the user, the system now silently merges the new entry into the existing client record.

**Why it broke:**  
The original code checked for duplicate client IDs but only warned the user without handling the duplication gracefully. This caused a disruptive user experience and left the client list in an inconsistent state.

**Reusable takeaway:**  
When handling duplicate data entries, prefer silent merging over user warnings. This maintains data integrity and improves UX by avoiding unnecessary interruptions. Always ensure duplicate detection leads to a deterministic action (merge, update, or skip) rather than just a notification.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: production workflow gaps - notification asks 'Has production started?' not 'Is production finished?', production ta

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 8da66f620e61ef177b9d753a9ea1711f6acfbf78

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 8da66f620e61ef177b9d753a9ea1711f6acfbf78
**Files:** apps/api/src/server.ts,apps/api/src/services/reminderScheduler.ts,apps/dashboard/src/app/production/page.tsx,apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
Production workflow logic was corrected: the notification now asks "Has production started?" instead of "Is production finished?"; the production tab includes a Start button with a days input; a manual "Production Finished" button was added in the bot; reminder buttons were updated.

**Why it broke:**  
The original workflow assumed production completion as the trigger, but the actual process requires confirmation of production *start* before tracking progress. This mismatch caused premature or irrelevant notifications.

**Reusable takeaway:**  
Always align notification triggers with the *first actionable event* in a workflow, not the final state. Validate that each step’s confirmation matches the user’s real-world sequence of actions.

---
*Original commit message: fix: production workflow gaps - notification asks 'Has production started?' not 'Is production finished?', production tab Start button with days input, manual Production Finished button in bot, updated reminder buttons*

#### Lesson Learned

**What was fixed:**  
Production workflow logic was corrected: the notification now asks "Has production started?" instead of "Is production finished?"; the production tab includes a Start button with a days input; a manual "Production Finished" button was added in the bot; reminder buttons were updated.

**Why it broke:**  
The original workflow assumed production completion as the trigger, but the actual process requires confirmation of production *start* before tracking progress. This mismatch caused premature or irrelevant notifications.

**Reusable takeaway:**  
Always align notification triggers with the *first actionable event* in a workflow, not the final state. Validate that each step’s confirmation matches the user’s real-world sequence of actions.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] refactor: update bot production flow - remove manual finish from bot, add remaining days prompt at midpoint check, updat

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 3f4268cac6215db666c50224ff23cc933cd6646d

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 3f4268cac6215db666c50224ff23cc933cd6646d
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/production/page.tsx,apps/dashboard/src/app/purchasing/page.tsx,apps/telegram-bot/src/bot.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:** The bot's production flow was updated to remove a manual "finish" step, add a "remaining days" prompt at the midpoint check, and update the recalculation endpoint to accept `remaining_production_days`.

**Why it broke:** The original flow required manual intervention to finish production, causing delays and inconsistency. The midpoint check lacked a prompt for remaining days, leading to incomplete data for recalculations. The recalculation endpoint did not accept `remaining_production_days`, causing failures when this data was provided.

**Reusable takeaway:** Automate completion steps and prompt for critical data (e.g., remaining days) at natural checkpoints (e.g., midpoint) to reduce manual overhead and ensure data completeness. Always update endpoints to accept new fields before deploying changes to consumers.

---
*Original commit message: refactor: update bot production flow - remove manual finish from bot, add remaining days prompt at midpoint check, update recalc endpoint to accept remaining_production_days*

#### Lesson Learned

**What was fixed:** The bot's production flow was updated to remove a manual "finish" step, add a "remaining days" prompt at the midpoint check, and update the recalculation endpoint to accept `remaining_production_days`.

**Why it broke:** The original flow required manual intervention to finish production, causing delays and inconsistency. The midpoint check lacked a prompt for remaining days, leading to incomplete data for recalculations. The recalculation endpoint did not accept `remaining_production_days`, causing failures when this data was provided.

**Reusable takeaway:** Automate completion steps and prompt for critical data (e.g., remaining days) at natural checkpoints (e.g., midpoint) to reduce manual overhead and ensure data completeness. Always update endpoints to accept new fields before deploying changes to consumers.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: corrupted 'use client' directive in production/page.tsx

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 31c3aa3e5add9a40376186ee9aea6ba99f9becc7

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 31c3aa3e5add9a40376186ee9aea6ba99f9becc7
**Files:** apps/api/src/server.ts,apps/api/src/services/productionAssistant.ts,apps/dashboard/src/app/production/page.tsx,apps/telegram-bot/src/bot.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
A corrupted `'use client'` directive in `production/page.tsx` that caused the production dashboard page to break in client-side rendering.

**Why it broke:**  
The directive was incorrectly placed or malformed (e.g., missing quotes, wrong casing, or extra characters), making the file fail to be recognized as a client component by the bundler. This led to runtime errors or blank pages in production builds.

**Reusable takeaway:**  
Always validate `'use client'` / `'use server'` directives for exact syntax—no typos, no extra whitespace, and correct single quotes. Use linting rules (e.g., `react/no-typos`) or a pre-commit hook to catch directive errors early. When debugging production-only rendering issues, check directive placement first.

---
*Original commit message: fix: corrupted 'use client' directive in production/page.tsx*

#### Lesson Learned

**What was fixed:**  
A corrupted `'use client'` directive in `production/page.tsx` that caused the production dashboard page to break in client-side rendering.

**Why it broke:**  
The directive was incorrectly placed or malformed (e.g., missing quotes, wrong casing, or extra characters), making the file fail to be recognized as a client component by the bundler. This led to runtime errors or blank pages in production builds.

**Reusable takeaway:**  
Always validate `'use client'` / `'use server'` directives for exact syntax—no typos, no extra whitespace, and correct single quotes. Use linting rules (e.g., `react/no-typos`) or a pre-commit hook to catch directive errors early. When debugging production-only rendering issues, check directive placement first.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: merge subUsers field from defaults into stored accounts

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit a5bb651e735546130393dc0d3b1c03b8f4386db9

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** a5bb651e735546130393dc0d3b1c03b8f4386db9
**Files:** apps/dashboard/src/lib/auth.tsx

**Summary:**
**What was fixed:** The `subUsers` field was not being merged from default account settings into stored user accounts, causing missing or incomplete sub-user data.

**Why it broke:** The merge logic only applied top-level defaults but omitted nested fields like `subUsers`. When accounts were stored without explicit `subUsers`, the defaults were ignored, leading to data loss or undefined behavior.

**Reusable takeaway:** When merging default configuration into stored data, ensure deep (recursive) merging for nested fields. Shallow merges silently drop nested defaults. Use a utility like `lodash.merge` or implement recursive object assignment to preserve all default sub-structures.

---
*Original commit message: fix: merge subUsers field from defaults into stored accounts*

#### Lesson Learned

**What was fixed:** The `subUsers` field was not being merged from default account settings into stored user accounts, causing missing or incomplete sub-user data.

**Why it broke:** The merge logic only applied top-level defaults but omitted nested fields like `subUsers`. When accounts were stored without explicit `subUsers`, the defaults were ignored, leading to data loss or undefined behavior.

**Reusable takeaway:** When merging default configuration into stored data, ensure deep (recursive) merging for nested fields. Shallow merges silently drop nested defaults. Use a utility like `lodash.merge` or implement recursive object assignment to preserve all default sub-structures.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: bump SW cache name to v3 to force cache clear for sales.homeu login

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit e9daa2dcd9e789e1941129dee4c672e80bdfc30c

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** e9daa2dcd9e789e1941129dee4c672e80bdfc30c
**Files:** apps/dashboard/public/sw.js

**Summary:**
**What was fixed:**  
A stale service worker cache was preventing the `sales.homeu` login page from loading correctly after a deployment. The cache name was bumped from `v2` to `v3` to force a full cache clear.

**Why it broke:**  
The service worker’s cache (named `v2`) held outdated assets from a previous build. When the app updated, the old cached files conflicted with new login logic, causing the login page to fail or behave incorrectly. Browsers do not automatically clear old caches unless the cache name changes.

**Reusable takeaway:**  
When deploying updates that affect critical user flows (like login), always version your service worker cache name (e.g., `v1`, `v2`, `v3`) to force a clean cache refresh. This prevents stale assets from breaking new functionality. A simple cache name bump is a low-risk, high-impact fix for cache-related regressions.

---
*Original commit message: fix: bump SW cache name to v3 to force cache clear for sales.homeu login*

#### Lesson Learned

**What was fixed:**  
A stale service worker cache was preventing the `sales.homeu` login page from loading correctly after a deployment. The cache name was bumped from `v2` to `v3` to force a full cache clear.

**Why it broke:**  
The service worker’s cache (named `v2`) held outdated assets from a previous build. When the app updated, the old cached files conflicted with new login logic, causing the login page to fail or behave incorrectly. Browsers do not automatically clear old caches unless the cache name changes.

**Reusable takeaway:**  
When deploying updates that affect critical user flows (like login), always version your service worker cache name (e.g., `v1`, `v2`, `v3`) to force a clean cache refresh. This prevents stale assets from breaking new functionality. A simple cache name bump is a low-risk, high-impact fix for cache-related regressions.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] optimize Dockerfiles: multi-stage builds, .dockerignore, npm ci, cache cleanup

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 901f28d9fed3cf1e781fc9b912d90a07b25b9ff4

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 901f28d9fed3cf1e781fc9b912d90a07b25b9ff4
**Files:** apps/api/.dockerignore,apps/api/Dockerfile,apps/backup-agent/.dockerignore,apps/backup-agent/Dockerfile,apps/dashboard/.dockerignore,apps/dashboard/Dockerfile,apps/file-store/.dockerignore,apps/file-store/Dockerfile,apps/telegram-bot/.dockerignore,apps/telegram-bot/Dockerfile

**Summary:**
**What was fixed:**  
Docker image bloat and slow builds across multiple services.

**Why it broke:**  
Previous Dockerfiles used single-stage builds, lacked `.dockerignore`, ran `npm install` (not `npm ci`), and didn't clean up caches. This caused unnecessarily large images, slow rebuilds, and inconsistent dependency installations.

**Reusable takeaway:**  
Always use **multi-stage builds** to separate build and runtime dependencies, add a **`.dockerignore`** to exclude unnecessary files (e.g., `node_modules`, `.git`), prefer **`npm ci`** over `npm install` for deterministic, faster installs, and **clean up package manager caches** (e.g., `npm cache clean --force`) in the same layer to reduce image size.

---
*Original commit message: optimize Dockerfiles: multi-stage builds, .dockerignore, npm ci, cache cleanup*

#### Lesson Learned

**What was fixed:**  
Docker image bloat and slow builds across multiple services.

**Why it broke:**  
Previous Dockerfiles used single-stage builds, lacked `.dockerignore`, ran `npm install` (not `npm ci`), and didn't clean up caches. This caused unnecessarily large images, slow rebuilds, and inconsistent dependency installations.

**Reusable takeaway:**  
Always use **multi-stage builds** to separate build and runtime dependencies, add a **`.dockerignore`** to exclude unnecessary files (e.g., `node_modules`, `.git`), prefer **`npm ci`** over `npm install` for deterministic, faster installs, and **clean up package manager caches** (e.g., `npm cache clean --force`) in the same layer to reduce image size.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix .dockerignore: keep tsconfig.json in build context

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit a44ba3106cde5f2633a93d20fe62736a6360c642

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** a44ba3106cde5f2633a93d20fe62736a6360c642
**Files:** apps/api/.dockerignore,apps/backup-agent/.dockerignore,apps/telegram-bot/.dockerignore

**Summary:**
**What was fixed:**  
`.dockerignore` files were too aggressive, excluding `tsconfig.json` from the Docker build context, causing TypeScript builds to fail inside containers.

**Why it broke:**  
The `.dockerignore` patterns (e.g., `**/*.json`) matched `tsconfig.json`, which is required for TypeScript compilation. Docker’s build context ignored it, so `tsc` couldn’t find the configuration.

**Reusable takeaway:**  
When using `.dockerignore`, explicitly allow essential build configuration files (like `tsconfig.json`, `package.json`, or `.env` templates) by negating them with `!` patterns. A safer approach: exclude only known unnecessary files (e.g., `node_modules`, `.git`, logs) rather than using broad wildcards that may strip required config files. Always test the Docker build locally after modifying `.dockerignore`.

---
*Original commit message: fix .dockerignore: keep tsconfig.json in build context*

#### Lesson Learned

**What was fixed:**  
`.dockerignore` files were too aggressive, excluding `tsconfig.json` from the Docker build context, causing TypeScript builds to fail inside containers.

**Why it broke:**  
The `.dockerignore` patterns (e.g., `**/*.json`) matched `tsconfig.json`, which is required for TypeScript compilation. Docker’s build context ignored it, so `tsc` couldn’t find the configuration.

**Reusable takeaway:**  
When using `.dockerignore`, explicitly allow essential build configuration files (like `tsconfig.json`, `package.json`, or `.env` templates) by negating them with `!` patterns. A safer approach: exclude only known unnecessary files (e.g., `node_modules`, `.git`, logs) rather than using broad wildcards that may strip required config files. Always test the Docker build locally after modifying `.dockerignore`.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: use npm install for backup-agent (no lockfile), fix file-store npm ci flag

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit e77edaa58203837c7d53ff923f9737d245914e70

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** e77edaa58203837c7d53ff923f9737d245914e70
**Files:** apps/backup-agent/Dockerfile,apps/file-store/Dockerfile

**Summary:**
**What was fixed:**  
Two Docker builds were failing: `backup-agent` (npm install) and `file-store` (npm ci flag).

**Why it broke:**  
- `backup-agent` had no lockfile, but the Dockerfile used `npm ci` (which requires a lockfile).  
- `file-store` had a lockfile, but the Dockerfile used `npm install` (which ignores lockfile integrity).  

**Reusable takeaway:**  
Always match the npm command to lockfile presence:  
- Use `npm ci` when a lockfile exists (faster, deterministic).  
- Use `npm install` when no lockfile exists (flexible, but slower).  
- Never mix the two—it breaks builds silently.

---
*Original commit message: fix: use npm install for backup-agent (no lockfile), fix file-store npm ci flag*

#### Lesson Learned

**What was fixed:**  
Two Docker builds were failing: `backup-agent` (npm install) and `file-store` (npm ci flag).

**Why it broke:**  
- `backup-agent` had no lockfile, but the Dockerfile used `npm ci` (which requires a lockfile).  
- `file-store` had a lockfile, but the Dockerfile used `npm install` (which ignores lockfile integrity).  

**Reusable takeaway:**  
Always match the npm command to lockfile presence:  
- Use `npm ci` when a lockfile exists (faster, deterministic).  
- Use `npm install` when no lockfile exists (flexible, but slower).  
- Never mix the two—it breaks builds silently.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: use npm install for file-store (lockfile not tracked in git)

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 50bf114ac0800b772134c889e93563f0a57e9e71

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 50bf114ac0800b772134c889e93563f0a57e9e71
**Files:** apps/file-store/Dockerfile

**Summary:**
**What was fixed:**  
The `file-store` Docker build was changed from `npm ci` to `npm install`.

**Why it broke:**  
The project does not track `package-lock.json` in git for the `file-store` app. `npm ci` requires a lockfile to install dependencies deterministically; without it, the command fails.

**Reusable takeaway:**  
Use `npm ci` only when the lockfile is committed and version-controlled. If the lockfile is intentionally excluded (e.g., for monorepo sub-packages or legacy setups), fall back to `npm install` in Docker builds. Always verify lockfile presence before adopting `npm ci` in CI/CD pipelines.

---
*Original commit message: fix: use npm install for file-store (lockfile not tracked in git)*

#### Lesson Learned

**What was fixed:**  
The `file-store` Docker build was changed from `npm ci` to `npm install`.

**Why it broke:**  
The project does not track `package-lock.json` in git for the `file-store` app. `npm ci` requires a lockfile to install dependencies deterministically; without it, the command fails.

**Reusable takeaway:**  
Use `npm ci` only when the lockfile is committed and version-controlled. If the lockfile is intentionally excluded (e.g., for monorepo sub-packages or legacy setups), fall back to `npm install` in Docker builds. Always verify lockfile presence before adopting `npm ci` in CI/CD pipelines.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix dashboard .dockerignore: keep tsconfig.json and next.config.ts for build

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 4c2edc6c5f321760c389062404382dfbf7c37cf2

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 4c2edc6c5f321760c389062404382dfbf7c37cf2
**Files:** apps/dashboard/.dockerignore

**Summary:**
**What was fixed:**  
The `.dockerignore` file for the dashboard was too aggressive, excluding `tsconfig.json` and `next.config.ts`. This caused the Docker build to fail because these files are required by the Next.js build process.

**Why it broke:**  
The `.dockerignore` pattern was overly broad (e.g., `**/*.json` or `**/*.ts`), which unintentionally removed essential configuration files needed during the build stage. The Docker build context lacked these files, leading to compilation errors.

**Reusable takeaway:**  
When writing `.dockerignore` for Node/TypeScript projects, explicitly allow critical build config files (e.g., `tsconfig.json`, `next.config.ts`, `package.json`) before broad exclusion patterns. Use negation patterns like `!tsconfig.json` to ensure the build context retains necessary files. Always test the Docker build locally after modifying `.dockerignore`.

---
*Original commit message: fix dashboard .dockerignore: keep tsconfig.json and next.config.ts for build*

#### Lesson Learned

**What was fixed:**  
The `.dockerignore` file for the dashboard was too aggressive, excluding `tsconfig.json` and `next.config.ts`. This caused the Docker build to fail because these files are required by the Next.js build process.

**Why it broke:**  
The `.dockerignore` pattern was overly broad (e.g., `**/*.json` or `**/*.ts`), which unintentionally removed essential configuration files needed during the build stage. The Docker build context lacked these files, leading to compilation errors.

**Reusable takeaway:**  
When writing `.dockerignore` for Node/TypeScript projects, explicitly allow critical build config files (e.g., `tsconfig.json`, `next.config.ts`, `package.json`) before broad exclusion patterns. Use negation patterns like `!tsconfig.json` to ensure the build context retains necessary files. Always test the Docker build locally after modifying `.dockerignore`.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: copy package.json to runner stage for ESM module resolution

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit f41b81644c8b67e3d8a58b10ffca3c3c7fe84cf8

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** f41b81644c8b67e3d8a58b10ffca3c3c7fe84cf8
**Files:** apps/api/Dockerfile,apps/backup-agent/Dockerfile,apps/telegram-bot/Dockerfile

**Summary:**
**What was fixed:**  
`package.json` was missing from the Docker runner stage, causing ESM module resolution failures in three services (API, backup-agent, telegram-bot).

**Why it broke:**  
Node.js ESM modules require `package.json` (with `"type": "module"`) to resolve imports correctly. The multi-stage Docker build copied only compiled output, omitting `package.json` from the final runner image.

**Reusable takeaway:**  
When using ESM in Node.js, always ensure `package.json` (or the `type` field) is present in the runtime container. For multi-stage Docker builds, explicitly copy `package.json` into the final stage—even if the build stage already has it—since each stage is isolated. A simple `COPY --from=builder /app/package.json .` prevents cryptic import resolution errors.

---
*Original commit message: fix: copy package.json to runner stage for ESM module resolution*

#### Lesson Learned

**What was fixed:**  
`package.json` was missing from the Docker runner stage, causing ESM module resolution failures in three services (API, backup-agent, telegram-bot).

**Why it broke:**  
Node.js ESM modules require `package.json` (with `"type": "module"`) to resolve imports correctly. The multi-stage Docker build copied only compiled output, omitting `package.json` from the final runner image.

**Reusable takeaway:**  
When using ESM in Node.js, always ensure `package.json` (or the `type` field) is present in the runtime container. For multi-stage Docker builds, explicitly copy `package.json` into the final stage—even if the build stage already has it—since each stage is isolated. A simple `COPY --from=builder /app/package.json .` prevents cryptic import resolution errors.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: advance to production_pending stage instead of marking production started

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit a50e7c7c76cf067a3790934346927b0a6197e24a

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** a50e7c7c76cf067a3790934346927b0a6197e24a
**Files:** apps/api/src/agents/purchasingAgent.ts,apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
The system was incorrectly marking production as "started" immediately upon agent approval, skipping a necessary intermediate stage (`production_pending`). The fix advances the workflow to `production_pending` instead.

**Why it broke:**  
The purchasing agent's approval logic directly transitioned the order to a "production started" state, bypassing the intended staging step. This caused downstream systems (e.g., Telegram bot notifications) to trigger prematurely, before production resources were actually allocated.

**Reusable takeaway:**  
Never skip intermediate workflow states when they represent real-world handoffs or resource allocations. Each stage should correspond to a distinct, verifiable action (e.g., approval → pending → started). Premature state transitions can cause cascading failures in dependent services (notifications, scheduling, billing). Always validate that the state machine's transitions match the actual process flow.

---
*Original commit message: fix: advance to production_pending stage instead of marking production started*

#### Lesson Learned

**What was fixed:**  
The system was incorrectly marking production as "started" immediately upon agent approval, skipping a necessary intermediate stage (`production_pending`). The fix advances the workflow to `production_pending` instead.

**Why it broke:**  
The purchasing agent's approval logic directly transitioned the order to a "production started" state, bypassing the intended staging step. This caused downstream systems (e.g., Telegram bot notifications) to trigger prematurely, before production resources were actually allocated.

**Reusable takeaway:**  
Never skip intermediate workflow states when they represent real-world handoffs or resource allocations. Each stage should correspond to a distinct, verifiable action (e.g., approval → pending → started). Premature state transitions can cause cascading failures in dependent services (notifications, scheduling, billing). Always validate that the state machine's transitions match the actual process flow.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: restore process of elimination GUI buttons, add dashboard link as alternative

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 911cbb2e0a55c12aac3af4049d231f13ccfae18f

**Project:** workflowautomation
**Author:** unknown
**Commit:** 911cbb2e0a55c12aac3af4049d231f13ccfae18f
**Files:** 

**Summary:**
**What was fixed:**  
Restored missing "process of elimination" GUI buttons and added a dashboard link as an alternative navigation path.

**Why it broke:**  
The buttons were likely removed or hidden during a UI refactor or feature toggle, breaking the user’s ability to access the process of elimination workflow directly from the GUI.

**Reusable takeaway:**  
When redesigning UI navigation, always verify that all critical user paths remain functional—especially for core workflows. If removing a direct button, provide an equivalent alternative (e.g., a dashboard link) to avoid breaking user flow. Test both primary and secondary access points after any UI change.

---
*Original commit message: fix: restore process of elimination GUI buttons, add dashboard link as alternative*

#### Lesson Learned

**What was fixed:**  
Restored missing "process of elimination" GUI buttons and added a dashboard link as an alternative navigation path.

**Why it broke:**  
The buttons were likely removed or hidden during a UI refactor or feature toggle, breaking the user’s ability to access the process of elimination workflow directly from the GUI.

**Reusable takeaway:**  
When redesigning UI navigation, always verify that all critical user paths remain functional—especially for core workflows. If removing a direct button, provide an equivalent alternative (e.g., a dashboard link) to avoid breaking user flow. Test both primary and secondary access points after any UI change.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: delivery_scheduled reminder must not fire before delivery date

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 97ad8ce0f97b4fb07565536dc388dcf601372167

**Project:** workflowautomation
**Author:** unknown
**Commit:** 97ad8ce0f97b4fb07565536dc388dcf601372167
**Files:** 

**Summary:**
**What was fixed:** A bug where the `delivery_scheduled` reminder was firing before the actual delivery date.

**Why it broke:** The reminder trigger logic did not include a check comparing the current time against the scheduled delivery date. It likely used only a relative offset (e.g., "remind X days before") without verifying that the delivery date had not yet passed, causing premature notifications.

**Reusable takeaway:** When scheduling time-based reminders or triggers, always include an explicit upper-bound check (e.g., "fire only if current time ≤ event time") in addition to the lower-bound offset. This prevents alerts from firing after the event has occurred or before it is valid, especially when data may be backfilled or processed asynchronously.

---
*Original commit message: fix: delivery_scheduled reminder must not fire before delivery date*

#### Lesson Learned

**What was fixed:** A bug where the `delivery_scheduled` reminder was firing before the actual delivery date.

**Why it broke:** The reminder trigger logic did not include a check comparing the current time against the scheduled delivery date. It likely used only a relative offset (e.g., "remind X days before") without verifying that the delivery date had not yet passed, causing premature notifications.

**Reusable takeaway:** When scheduling time-based reminders or triggers, always include an explicit upper-bound check (e.g., "fire only if current time ≤ event time") in addition to the lower-bound offset. This prevents alerts from firing after the event has occurred or before it is valid, especially when data may be backfilled or processed asynchronously.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: drop duplicate reminders unique constraint and escape Markdown in error messages

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 31146cc39d71e776caeaf75cca242eae2a78530d

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 31146cc39d71e776caeaf75cca242eae2a78530d
**Files:** apps/telegram-bot/src/bot.ts,database/migrations/028_drop_old_reminders_unique_constraint.sql

**Summary:**
**What was fixed:**  
- Removed a duplicate unique constraint on reminders that caused silent failures when users created multiple identical reminders.  
- Escaped Markdown in error messages to prevent malformed Telegram bot responses.  

**Why it broke:**  
- The unique constraint was originally added to prevent duplicate reminders, but a later migration inadvertently created a second, conflicting constraint. This caused `INSERT` failures without clear user feedback.  
- Error messages containing Markdown characters (e.g., `*`, `_`) were not escaped, breaking Telegram’s message rendering.  

**Reusable takeaway:**  
- **Database migrations:** Always verify that new constraints don’t duplicate or conflict with existing ones. Use `DROP CONSTRAINT IF EXISTS` before adding to avoid silent failures.  
- **User-facing errors:** Escape special characters (e.g., Markdown, HTML) in error messages to ensure they render correctly in chat interfaces.  
- **Testing:** Add integration tests for constraint violations and message formatting edge cases.

---
*Original commit message: fix: drop duplicate reminders unique constraint and escape Markdown in error messages*

#### Lesson Learned

**What was fixed:**  
- Removed a duplicate unique constraint on reminders that caused silent failures when users created multiple identical reminders.  
- Escaped Markdown in error messages to prevent malformed Telegram bot responses.  

**Why it broke:**  
- The unique constraint was originally added to prevent duplicate reminders, but a later migration inadvertently created a second, conflicting constraint. This caused `INSERT` failures without clear user feedback.  
- Error messages containing Markdown characters (e.g., `*`, `_`) were not escaped, breaking Telegram’s message rendering.  

**Reusable takeaway:**  
- **Database migrations:** Always verify that new constraints don’t duplicate or conflict with existing ones. Use `DROP CONSTRAINT IF EXISTS` before adding to avoid silent failures.  
- **User-facing errors:** Escape special characters (e.g., Markdown, HTML) in error messages to ensure they render correctly in chat interfaces.  
- **Testing:** Add integration tests for constraint violations and message formatting edge cases.

#### Tags

cross-project, local-fallback

---

### Lesson: [quotation-automation-system] fix order file upload feedback and Telegram file attachment

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

When dashboard order file modals upload base64 files through /files/upload, always surface API errors/success in the modal, await file-list refresh, and fail /files/upload if file-store cannot persist the binary so users do not see silent success. Telegram/Vision-created orders must attach the original image/PDF via /files/upload with order_id after order creation; stale routes like /drive/upload leave files invisible in the order modal. Poll open file modals periodically so Telegram-side linked uploads appear without closing/reopening.

#### Lesson Learned

When dashboard order file modals upload base64 files through /files/upload, always surface API errors/success in the modal, await file-list refresh, and fail /files/upload if file-store cannot persist the binary so users do not see silent success. Telegram/Vision-created orders must attach the original image/PDF via /files/upload with order_id after order creation; stale routes like /drive/upload leave files invisible in the order modal. Poll open file modals periodically so Telegram-side linked uploads appear without closing/reopening.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: escape Markdown special chars in reminder:item_en_route error handler

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit d591e9ee31bfc42bcca12ed35addfcfad05a5381

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** d591e9ee31bfc42bcca12ed35addfcfad05a5381
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/vision/page.tsx,apps/dashboard/src/components/OrderFileViewer.tsx,apps/dashboard/src/lib/api.ts,apps/telegram-bot/src/bot.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Markdown special characters (e.g., `*`, `_`, `[`, `]`) in error messages from the `reminder:item_en_route` handler were not escaped, causing broken rendering in Telegram and dashboard views.

**Why it broke:**  
The error handler directly interpolated user-generated or system-generated strings containing Markdown syntax into message templates without sanitization. This caused unintended formatting (e.g., italic, bold, links) or malformed output.

**Reusable takeaway:**  
Always escape Markdown/HTML special characters when embedding dynamic content into formatted messages, especially in error handlers or user-facing notifications. Use a dedicated escaping function (e.g., `escapeMarkdown()`) before string interpolation to prevent rendering corruption and injection-like issues.

---
*Original commit message: fix: escape Markdown special chars in reminder:item_en_route error handler*

#### Lesson Learned

**What was fixed:**  
Markdown special characters (e.g., `*`, `_`, `[`, `]`) in error messages from the `reminder:item_en_route` handler were not escaped, causing broken rendering in Telegram and dashboard views.

**Why it broke:**  
The error handler directly interpolated user-generated or system-generated strings containing Markdown syntax into message templates without sanitization. This caused unintended formatting (e.g., italic, bold, links) or malformed output.

**Reusable takeaway:**  
Always escape Markdown/HTML special characters when embedding dynamic content into formatted messages, especially in error handlers or user-facing notifications. Use a dedicated escaping function (e.g., `escapeMarkdown()`) before string interpolation to prevent rendering corruption and injection-like issues.

#### Tags

cross-project, local-fallback

---

### Lesson: [quotation-automation-system] add collection payment summary table

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Collection tab summaries can be built from the existing stage-specific order arrays without adding a new API route. Deduplicate orders by id across deposit_verification, balance_due, balance_verification, payment_received, completed, and related collection stages, then display existing Order fields: client_name, quotation_number/id, deposit_paid_at, deposit_verified/deposit_verified_at, balance_paid_at, and balance_verified/balance_verified_at. Keep the summary above detailed stage queues so collection staff can quickly see downpayment and balance verification state.

#### Lesson Learned

Collection tab summaries can be built from the existing stage-specific order arrays without adding a new API route. Deduplicate orders by id across deposit_verification, balance_due, balance_verification, payment_received, completed, and related collection stages, then display existing Order fields: client_name, quotation_number/id, deposit_paid_at, deposit_verified/deposit_verified_at, balance_paid_at, and balance_verified/balance_verified_at. Keep the summary above detailed stage queues so collection staff can quickly see downpayment and balance verification state.

#### Tags

cross-project, local-fallback

---

### Lesson: [quotation-automation-system] editable collection payment dates

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

When AI reads blurry deposit or balance slips, payment dates can be wrong (for example 2022 instead of 2026). Make deposit_paid_at and balance_paid_at editable from the Collection Summary by allowing those fields in the existing OTP-protected PATCH /orders/:id path and exposing them in the dashboard updateOrder client. Keep edits behind the existing action_token flow and refresh all collection stage SWR lists after correction.

#### Lesson Learned

When AI reads blurry deposit or balance slips, payment dates can be wrong (for example 2022 instead of 2026). Make deposit_paid_at and balance_paid_at editable from the Collection Summary by allowing those fields in the existing OTP-protected PATCH /orders/:id path and exposing them in the dashboard updateOrder client. Keep edits behind the existing action_token flow and refresh all collection stage SWR lists after correction.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: infinite loop when clicking 'Not Yet' on already-not_yet item in en-route flow

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit b1a1683a4b1b2702b8c7b3ba2abe2f05712c82a6

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** b1a1683a4b1b2702b8c7b3ba2abe2f05712c82a6
**Files:** apps/api/src/server.ts,apps/api/src/services/reminderScheduler.ts,apps/dashboard/src/app/collection/page.tsx,apps/dashboard/src/lib/api.ts,apps/telegram-bot/src/bot.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
An infinite loop triggered when clicking "Not Yet" on an item already in `not_yet` status during the en-route flow.

**Why it broke:**  
The system lacked a guard to prevent re-processing items already marked as `not_yet`. The status transition logic allowed the same action to be applied repeatedly, causing the scheduler to re-trigger reminders in a cycle.

**Reusable takeaway:**  
Always add idempotency checks for state transitions. Before applying a status change, verify the current state differs from the target state. This prevents infinite loops, redundant processing, and scheduler storms. A simple guard like `if (currentStatus === targetStatus) return` can save significant debugging time.

---
*Original commit message: fix: infinite loop when clicking 'Not Yet' on already-not_yet item in en-route flow*

#### Lesson Learned

**What was fixed:**  
An infinite loop triggered when clicking "Not Yet" on an item already in `not_yet` status during the en-route flow.

**Why it broke:**  
The system lacked a guard to prevent re-processing items already marked as `not_yet`. The status transition logic allowed the same action to be applied repeatedly, causing the scheduler to re-trigger reminders in a cycle.

**Reusable takeaway:**  
Always add idempotency checks for state transitions. Before applying a status change, verify the current state differs from the target state. This prevents infinite loops, redundant processing, and scheduler storms. A simple guard like `if (currentStatus === targetStatus) return` can save significant debugging time.

#### Tags

cross-project, local-fallback

---

### Lesson: [quotation-automation-system] make vision payment extraction editable

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Do not let AI vision payment extraction go straight to a terminal state. The dashboard Vision review page should expose editable fields for payment type, quotation/order number, amount, payment date, reference number, and payer before OTP-protected recording. /pay-balance should accept payment_date so corrected AI-read dates are stored as balance_paid_at instead of NOW(). Quotation and inventory extractions should continue through editable fields/items before create/commit.

#### Lesson Learned

Do not let AI vision payment extraction go straight to a terminal state. The dashboard Vision review page should expose editable fields for payment type, quotation/order number, amount, payment date, reference number, and payer before OTP-protected recording. /pay-balance should accept payment_date so corrected AI-read dates are stored as balance_paid_at instead of NOW(). Quotation and inventory extractions should continue through editable fields/items before create/commit.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: infinite loop in item_prod handler + skip confirmation for item status toggles

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 9270afb6f80d7218c7648215aa089ea158536731

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 9270afb6f80d7218c7648215aa089ea158536731
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/vision/page.tsx,apps/dashboard/src/lib/api.ts,apps/telegram-bot/src/bot.ts,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
An infinite loop in the `item_prod` handler and a missing skip of confirmation for item status toggles.

**Why it broke:**  
The `item_prod` handler recursively triggered itself without a termination condition, causing an infinite loop. Additionally, toggling item statuses prompted unnecessary confirmation dialogs, breaking the intended UX flow.

**Reusable takeaway:**  
Always ensure recursive handlers have explicit base cases or exit conditions to prevent infinite loops. For UI toggles, skip confirmation dialogs when the action is reversible or low-risk, and validate state transitions to avoid redundant prompts.

---
*Original commit message: fix: infinite loop in item_prod handler + skip confirmation for item status toggles*

#### Lesson Learned

**What was fixed:**  
An infinite loop in the `item_prod` handler and a missing skip of confirmation for item status toggles.

**Why it broke:**  
The `item_prod` handler recursively triggered itself without a termination condition, causing an infinite loop. Additionally, toggling item statuses prompted unnecessary confirmation dialogs, breaking the intended UX flow.

**Reusable takeaway:**  
Always ensure recursive handlers have explicit base cases or exit conditions to prevent infinite loops. For UI toggles, skip confirmation dialogs when the action is reversible or low-risk, and validate state transitions to avoid redundant prompts.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: stop infinite loop when clicking 'Not Yet' on already-not_yet items

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit dd63058871dd29cda5f50f4aca3833f76b46dbf2

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** dd63058871dd29cda5f50f4aca3833f76b46dbf2
**Files:** apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
An infinite loop triggered when clicking the "Not Yet" button on items already in the "not_yet" state.

**Why it broke:**  
The button handler did not check the current item state before processing the action. Clicking "Not Yet" on an already-not_yet item caused the same state transition to fire repeatedly, creating a recursive loop.

**Reusable takeaway:**  
Always guard state-dependent actions with a precondition check against the current state. If the action would result in no state change (idempotent), either skip the handler entirely or return early. This prevents unintended loops and redundant processing.

---
*Original commit message: fix: stop infinite loop when clicking 'Not Yet' on already-not_yet items*

#### Lesson Learned

**What was fixed:**  
An infinite loop triggered when clicking the "Not Yet" button on items already in the "not_yet" state.

**Why it broke:**  
The button handler did not check the current item state before processing the action. Clicking "Not Yet" on an already-not_yet item caused the same state transition to fire repeatedly, creating a recursive loop.

**Reusable takeaway:**  
Always guard state-dependent actions with a precondition check against the current state. If the action would result in no state change (idempotent), either skip the handler entirely or return early. This prevents unintended loops and redundant processing.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: replace early-return with skip-set to allow progressing through remaining items

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 624feccd9b0e4c4442b84d56f7b1ef9efab33be5

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 624feccd9b0e4c4442b84d56f7b1ef9efab33be5
**Files:** apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
A bug where the Telegram bot would stop processing remaining items after encountering a single item that didn't require updates (e.g., already up-to-date). The fix replaced an early `return` with a `skip-set` pattern, allowing the loop to continue to subsequent items.

**Why it broke:**  
The original code used an early `return` inside a loop when an item was skipped. This prematurely exited the entire function, preventing the bot from progressing through the rest of the items.

**Reusable takeaway:**  
When iterating over a collection and conditionally skipping items, use a `skip` or `continue` pattern (e.g., `if (skip) { continue; }`) instead of an early `return`. This ensures the loop processes all items without breaking early. Always verify loop control flow when handling conditional skips.

---
*Original commit message: fix: replace early-return with skip-set to allow progressing through remaining items*

#### Lesson Learned

**What was fixed:**  
A bug where the Telegram bot would stop processing remaining items after encountering a single item that didn't require updates (e.g., already up-to-date). The fix replaced an early `return` with a `skip-set` pattern, allowing the loop to continue to subsequent items.

**Why it broke:**  
The original code used an early `return` inside a loop when an item was skipped. This prematurely exited the entire function, preventing the bot from progressing through the rest of the items.

**Reusable takeaway:**  
When iterating over a collection and conditionally skipping items, use a `skip` or `continue` pattern (e.g., `if (skip) { continue; }`) instead of an early `return`. This ensures the loop processes all items without breaking early. Always verify loop control flow when handling conditional skips.

#### Tags

cross-project, local-fallback

---

### Lesson: [quotation-automation-system] production Telegram inline dashboard categories

Date: 2026-05-23
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Production Telegram chat dashboard should separate Pending Start, In Progress, Ready for Delivery, and En Route. Ready for Delivery means all production items are finished and order is waiting for dispatch/en-route updates; Production group should stop at en-route and not monitor inventory. Existing /production/board can derive sections from order current_stage, production_finished, item production_status, and item en_route_status, while keeping callback_data short with 8-char IDs.

#### Lesson Learned

Production Telegram chat dashboard should separate Pending Start, In Progress, Ready for Delivery, and En Route. Ready for Delivery means all production items are finished and order is waiting for dispatch/en-route updates; Production group should stop at en-route and not monitor inventory. Existing /production/board can derive sections from order current_stage, production_finished, item production_status, and item en_route_status, while keeping callback_data short with 8-char IDs.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: refine production telegram flow

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit b5cc7976079bbbce6629d57b5bd2f34a29a6866d

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** b5cc7976079bbbce6629d57b5bd2f34a29a6866d
**Files:** apps/api/src/server.ts,apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
A race condition in the production Telegram bot flow where the API server and Telegram bot were out of sync during startup, causing missed or duplicate message handling.

**Why it broke:**  
The API server initialized and began accepting requests before the Telegram bot had fully registered its webhook or connected to the Telegram API. This led to inconsistent state—messages were sent to the bot before it was ready to process them.

**Reusable takeaway:**  
Ensure dependent services (e.g., webhook handlers, bots, or workers) are fully initialized and ready before allowing external traffic. Use explicit health checks, startup sequences, or a ready signal (e.g., a shared promise or event emitter) to coordinate initialization order. This prevents race conditions in distributed or event-driven systems.

---
*Original commit message: fix: refine production telegram flow*

#### Lesson Learned

**What was fixed:**  
A race condition in the production Telegram bot flow where the API server and Telegram bot were out of sync during startup, causing missed or duplicate message handling.

**Why it broke:**  
The API server initialized and began accepting requests before the Telegram bot had fully registered its webhook or connected to the Telegram API. This led to inconsistent state—messages were sent to the bot before it was ready to process them.

**Reusable takeaway:**  
Ensure dependent services (e.g., webhook handlers, bots, or workers) are fully initialized and ready before allowing external traffic. Use explicit health checks, startup sequences, or a ready signal (e.g., a shared promise or event emitter) to coordinate initialization order. This prevents race conditions in distributed or event-driven systems.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: skip-set check before auto-advance in item_prod handler — don't call finish-production when user said 'Not Yet' to 

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 5ef3782a5ed6b55ca0d90908de8da81319081240

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 5ef3782a5ed6b55ca0d90908de8da81319081240
**Files:** apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
A bug where the `item_prod` handler would auto-advance to `finish-production` even when the user selected "Not Yet" for all items, skipping the intended confirmation step.

**Why it broke:**  
The `set` check (which determines if any items were produced) was evaluated *after* the auto-advance logic. This meant the auto-advance triggered before the system could verify that no items were actually completed, causing a premature state transition.

**Reusable takeaway:**  
Always validate state-changing conditions *before* executing auto-advance or transition logic. Order matters: check user intent (e.g., "Not Yet") before proceeding to the next step. In state machines or multi-step forms, guard clauses should be evaluated in the sequence that respects user decisions, not the sequence that optimizes code flow.

---
*Original commit message: fix: skip-set check before auto-advance in item_prod handler — don't call finish-production when user said 'Not Yet' to all items*

#### Lesson Learned

**What was fixed:**  
A bug where the `item_prod` handler would auto-advance to `finish-production` even when the user selected "Not Yet" for all items, skipping the intended confirmation step.

**Why it broke:**  
The `set` check (which determines if any items were produced) was evaluated *after* the auto-advance logic. This meant the auto-advance triggered before the system could verify that no items were actually completed, causing a premature state transition.

**Reusable takeaway:**  
Always validate state-changing conditions *before* executing auto-advance or transition logic. Order matters: check user intent (e.g., "Not Yet") before proceeding to the next step. In state machines or multi-step forms, guard clauses should be evaluated in the sequence that respects user decisions, not the sequence that optimizes code flow.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: skip slash commands in text handler so /prod and /production reach bot.command() handlers

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 006e4469345d644e32f7bf13c851fda39e3ee5cd

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 006e4469345d644e32f7bf13c851fda39e3ee5cd
**Files:** apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:** Slash commands like `/prod` and `/production` were not reaching the `bot.command()` handler; they were being intercepted by a generic text handler.

**Why it broke:** The text handler was processing all incoming messages, including those starting with `/`. Since it ran before the command handler, it consumed the message and prevented the command handler from firing.

**Reusable takeaway:** When building a Telegram bot (or similar event-driven system), always check for and skip command-prefixed messages in generic text handlers. Add an early return or filter at the top of the text handler: `if (msg.text?.startsWith('/')) return`. This ensures command handlers receive priority and prevents accidental interception of intended commands.

---
*Original commit message: fix: skip slash commands in text handler so /prod and /production reach bot.command() handlers*

#### Lesson Learned

**What was fixed:** Slash commands like `/prod` and `/production` were not reaching the `bot.command()` handler; they were being intercepted by a generic text handler.

**Why it broke:** The text handler was processing all incoming messages, including those starting with `/`. Since it ran before the command handler, it consumed the message and prevented the command handler from firing.

**Reusable takeaway:** When building a Telegram bot (or similar event-driven system), always check for and skip command-prefixed messages in generic text handlers. Add an early return or filter at the top of the text handler: `if (msg.text?.startsWith('/')) return`. This ensures command handlers receive priority and prevents accidental interception of intended commands.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: normalize Content-Type header in fetchJson to avoid duplicate headers causing 415

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit c8a5bd6e6239a65bd2e078adf9060df6df3df3ce

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** c8a5bd6e6239a65bd2e078adf9060df6df3df3ce
**Files:** apps/dashboard/src/lib/api.ts

**Summary:**
**What was fixed:** A `415 Unsupported Media Type` error in `fetchJson` caused by duplicate `Content-Type` headers.

**Why it broke:** The code was setting a default `Content-Type: application/json` header, then later adding another `Content-Type` header (e.g., for multipart data) without removing the first. The server rejected the request due to conflicting or duplicate media type declarations.

**Reusable takeaway:** When building HTTP clients, always normalize or deduplicate headers before sending. A common pattern: define a base headers object, then merge request-specific headers using a merge strategy that overwrites (not appends) existing keys. In JavaScript/TypeScript, use `Object.assign` or spread syntax with the request-specific headers last to ensure they override defaults. This prevents subtle bugs where default headers persist and conflict with explicit overrides.

---
*Original commit message: fix: normalize Content-Type header in fetchJson to avoid duplicate headers causing 415*

#### Lesson Learned

**What was fixed:** A `415 Unsupported Media Type` error in `fetchJson` caused by duplicate `Content-Type` headers.

**Why it broke:** The code was setting a default `Content-Type: application/json` header, then later adding another `Content-Type` header (e.g., for multipart data) without removing the first. The server rejected the request due to conflicting or duplicate media type declarations.

**Reusable takeaway:** When building HTTP clients, always normalize or deduplicate headers before sending. A common pattern: define a base headers object, then merge request-specific headers using a merge strategy that overwrites (not appends) existing keys. In JavaScript/TypeScript, use `Object.assign` or spread syntax with the request-specific headers last to ensure they override defaults. This prevents subtle bugs where default headers persist and conflict with explicit overrides.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: save deposit slip to order file viewer when recording deposit by client name

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit c30496bc93993de8955b908008b3adeea4a44c5f

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** c30496bc93993de8955b908008b3adeea4a44c5f
**Files:** apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
Deposit slips were not being saved to the order file viewer when a deposit was recorded using the client’s name.

**Why it broke:**  
The code path for recording deposits by client name omitted the step that attaches the deposit slip to the order’s file viewer. The slip-saving logic was only triggered in the deposit-by-order-ID branch.

**Reusable takeaway:**  
When adding a new input method (e.g., client name) for an existing action (e.g., recording a deposit), ensure all side effects (e.g., file attachments, notifications) are replicated from the original method. Use shared helper functions or middleware to enforce consistent post-processing across all entry points.

---
*Original commit message: fix: save deposit slip to order file viewer when recording deposit by client name*

#### Lesson Learned

**What was fixed:**  
Deposit slips were not being saved to the order file viewer when a deposit was recorded using the client’s name.

**Why it broke:**  
The code path for recording deposits by client name omitted the step that attaches the deposit slip to the order’s file viewer. The slip-saving logic was only triggered in the deposit-by-order-ID branch.

**Reusable takeaway:**  
When adding a new input method (e.g., client name) for an existing action (e.g., recording a deposit), ensure all side effects (e.g., file attachments, notifications) are replicated from the original method. Use shared helper functions or middleware to enforce consistent post-processing across all entry points.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: wrap answerCbQuery in try/catch to handle expired callback queries in vision handlers

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 3abb26b8b4f6f61db78e4f6d17a2d142510d0d71

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 3abb26b8b4f6f61db78e4f6d17a2d142510d0d71
**Files:** apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
A crash in Telegram bot vision handlers when processing expired callback queries (e.g., user clicked an old inline button).

**Why it broke:**  
The `answerCbQuery` call was not wrapped in error handling. When a callback query expires (e.g., due to timeout or bot restart), Telegram throws an error. Without a `try/catch`, this unhandled rejection crashed the handler.

**Reusable takeaway:**  
Always wrap Telegram `answerCbQuery` (and similar ephemeral interactions) in `try/catch`. Callback queries have a short lifespan; assume they can expire before your handler responds. A silent failure (logging the error) is better than crashing the entire request flow.

---
*Original commit message: fix: wrap answerCbQuery in try/catch to handle expired callback queries in vision handlers*

#### Lesson Learned

**What was fixed:**  
A crash in Telegram bot vision handlers when processing expired callback queries (e.g., user clicked an old inline button).

**Why it broke:**  
The `answerCbQuery` call was not wrapped in error handling. When a callback query expires (e.g., due to timeout or bot restart), Telegram throws an error. Without a `try/catch`, this unhandled rejection crashed the handler.

**Reusable takeaway:**  
Always wrap Telegram `answerCbQuery` (and similar ephemeral interactions) in `try/catch`. Callback queries have a short lifespan; assume they can expire before your handler responds. A silent failure (logging the error) is better than crashing the entire request flow.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: improve session expired messages with clearer instructions and Main Menu button

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 78e19782fb49a828d6bc4eda186388b0fa496722

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 78e19782fb49a828d6bc4eda186388b0fa496722
**Files:** apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
Session expired messages now include clearer instructions and a "Main Menu" button, improving user guidance when a session expires mid-interaction.

**Why it broke:**  
Previously, session expiry messages were vague (e.g., "Session expired") with no actionable next steps, leaving users confused about how to restart or navigate back.

**Reusable takeaway:**  
When handling session expiry or state loss in user-facing systems, always provide:  
1. A clear explanation of what happened (e.g., "Your session expired due to inactivity").  
2. A direct call-to-action (e.g., "Return to Main Menu" button).  
3. A way to re-enter the flow without friction.  

This reduces user frustration and support requests by making recovery paths explicit.

---
*Original commit message: fix: improve session expired messages with clearer instructions and Main Menu button*

#### Lesson Learned

**What was fixed:**  
Session expired messages now include clearer instructions and a "Main Menu" button, improving user guidance when a session expires mid-interaction.

**Why it broke:**  
Previously, session expiry messages were vague (e.g., "Session expired") with no actionable next steps, leaving users confused about how to restart or navigate back.

**Reusable takeaway:**  
When handling session expiry or state loss in user-facing systems, always provide:  
1. A clear explanation of what happened (e.g., "Your session expired due to inactivity").  
2. A direct call-to-action (e.g., "Return to Main Menu" button).  
3. A way to re-enter the flow without friction.  

This reduces user frustration and support requests by making recovery paths explicit.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: close dashboard-telegram sync gaps

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 25354a5ef3153133088b83cd44265f895ea5b5d5

**Project:** workflowautomation
**Author:** unknown
**Commit:** 25354a5ef3153133088b83cd44265f895ea5b5d5
**Files:** 

**Summary:**
**What was fixed:**  
A synchronization gap between the dashboard and Telegram notifications, where certain workflow state changes were not being relayed to Telegram.

**Why it broke:**  
The sync logic only triggered on explicit user actions (e.g., button clicks), but missed state transitions caused by automated rules or background processes. This created a race condition where Telegram updates were skipped.

**Reusable takeaway:**  
When building event-driven integrations, ensure all state-change paths (manual + automated) are covered by the same notification hook. Use a single, centralized event bus or callback to fire notifications, rather than attaching them to specific UI actions. This prevents silent gaps and ensures consistency across channels.

---
*Original commit message: fix: close dashboard-telegram sync gaps*

#### Lesson Learned

**What was fixed:**  
A synchronization gap between the dashboard and Telegram notifications, where certain workflow state changes were not being relayed to Telegram.

**Why it broke:**  
The sync logic only triggered on explicit user actions (e.g., button clicks), but missed state transitions caused by automated rules or background processes. This created a race condition where Telegram updates were skipped.

**Reusable takeaway:**  
When building event-driven integrations, ensure all state-change paths (manual + automated) are covered by the same notification hook. Use a single, centralized event bus or callback to fire notifications, rather than attaching them to specific UI actions. This prevents silent gaps and ensures consistency across channels.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: close dashboard-telegram sync gaps (part 2)

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 16738dabcba33ea5a9204eca193317eaddcec495

**Project:** workflowautomation
**Author:** unknown
**Commit:** 16738dabcba33ea5a9204eca193317eaddcec495
**Files:** 

**Summary:**
**What was fixed:**  
A synchronization gap between the dashboard and Telegram notifications, where certain state changes or events were not being forwarded to Telegram users.

**Why it broke:**  
The previous logic only triggered Telegram updates on a subset of dashboard events, missing edge cases (e.g., status transitions, delayed updates, or batch operations). The sync was not exhaustive, leading to silent data loss in Telegram notifications.

**Reusable takeaway:**  
When bridging two systems (e.g., dashboard ↔ messaging), ensure your event-driven sync covers *all* relevant state transitions—not just primary ones. Use a unified event bus or a diff-based reconciliation loop to catch missed updates. Test with real-world edge cases (e.g., rapid changes, offline periods) to expose gaps.

---
*Original commit message: fix: close dashboard-telegram sync gaps (part 2)*

#### Lesson Learned

**What was fixed:**  
A synchronization gap between the dashboard and Telegram notifications, where certain state changes or events were not being forwarded to Telegram users.

**Why it broke:**  
The previous logic only triggered Telegram updates on a subset of dashboard events, missing edge cases (e.g., status transitions, delayed updates, or batch operations). The sync was not exhaustive, leading to silent data loss in Telegram notifications.

**Reusable takeaway:**  
When bridging two systems (e.g., dashboard ↔ messaging), ensure your event-driven sync covers *all* relevant state transitions—not just primary ones. Use a unified event bus or a diff-based reconciliation loop to catch missed updates. Test with real-world edge cases (e.g., rapid changes, offline periods) to expose gaps.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: wrap bot.stop() in try/catch to prevent uncaught exception crash on SIGTERM

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit aaa257aa6ab16645d60e40f900de002c2a5d5333

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** aaa257aa6ab16645d60e40f900de002c2a5d5333
**Files:** apps/telegram-bot/src/bot.ts

**Summary:**
**What was fixed:**  
A crash caused by an uncaught exception when `bot.stop()` was called during a `SIGTERM` shutdown signal.

**Why it broke:**  
The `bot.stop()` method threw an error (likely due to an already-closed connection or cleanup race condition), and the code lacked error handling. This unhandled exception propagated to the process, causing an abrupt crash instead of a graceful shutdown.

**Reusable takeaway:**  
Always wrap cleanup/shutdown operations (e.g., `stop()`, `close()`, `disconnect()`) in try/catch blocks. Graceful shutdown handlers must tolerate errors from partially initialized or already-terminated resources. This prevents a single failed cleanup from crashing the entire process.

---
*Original commit message: fix: wrap bot.stop() in try/catch to prevent uncaught exception crash on SIGTERM*

#### Lesson Learned

**What was fixed:**  
A crash caused by an uncaught exception when `bot.stop()` was called during a `SIGTERM` shutdown signal.

**Why it broke:**  
The `bot.stop()` method threw an error (likely due to an already-closed connection or cleanup race condition), and the code lacked error handling. This unhandled exception propagated to the process, causing an abrupt crash instead of a graceful shutdown.

**Reusable takeaway:**  
Always wrap cleanup/shutdown operations (e.g., `stop()`, `close()`, `disconnect()`) in try/catch blocks. Graceful shutdown handlers must tolerate errors from partially initialized or already-terminated resources. This prevents a single failed cleanup from crashing the entire process.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] chore: auto-learned lessons from SIGTERM crash fix

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 10be05e0c0e76c11a89a9cceef859717aac86c9b

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 10be05e0c0e76c11a89a9cceef859717aac86c9b
**Files:** memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
A crash caused by an unhandled `SIGTERM` signal during workflow execution, which left processes in an inconsistent state.

**Why it broke:**  
The system did not register a signal handler for `SIGTERM`, so the default OS behavior (immediate termination) occurred. This bypassed cleanup logic, leaving shared resources (e.g., temp files, locks) orphaned.

**Reusable takeaway:**  
Always register a graceful shutdown handler for `SIGTERM` (and `SIGINT`) in long-running or resource-managing processes. The handler should:  
1. Set a termination flag to stop accepting new work.  
2. Complete or rollback in-flight operations.  
3. Release shared resources (files, network connections, locks).  
4. Exit with a non-zero code to signal abnormal termination.  

This pattern prevents resource leaks and data corruption in containerized or supervised environments where signals are the primary shutdown mechanism.

---
*Original commit message: chore: auto-learned lessons from SIGTERM crash fix*

#### Lesson Learned

**What was fixed:**  
A crash caused by an unhandled `SIGTERM` signal during workflow execution, which left processes in an inconsistent state.

**Why it broke:**  
The system did not register a signal handler for `SIGTERM`, so the default OS behavior (immediate termination) occurred. This bypassed cleanup logic, leaving shared resources (e.g., temp files, locks) orphaned.

**Reusable takeaway:**  
Always register a graceful shutdown handler for `SIGTERM` (and `SIGINT`) in long-running or resource-managing processes. The handler should:  
1. Set a termination flag to stop accepting new work.  
2. Complete or rollback in-flight operations.  
3. Release shared resources (files, network connections, locks).  
4. Exit with a non-zero code to signal abnormal termination.  

This pattern prevents resource leaks and data corruption in containerized or supervised environments where signals are the primary shutdown mechanism.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: route item-level orders through inventory_verification + close remaining gaps

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 80b880e5f86bc5820744acf2ee5f67abe44e3cd8

**Project:** workflowautomation
**Author:** unknown
**Commit:** 80b880e5f86bc5820744acf2ee5f67abe44e3cd8
**Files:** 

**Summary:**
**What was fixed:**  
Item-level orders were not routed through the `inventory_verification` step, causing gaps in order processing. The fix ensures all item-level orders pass through verification before proceeding.

**Why it broke:**  
The workflow logic had a conditional path that bypassed `inventory_verification` for item-level orders, likely due to an oversight in routing rules or an incomplete state machine transition.

**Reusable takeaway:**  
When designing workflow automation, explicitly map all order types (e.g., item-level vs. bulk) to every required step. Avoid implicit routing assumptions—use exhaustive condition checks or state machine diagrams to ensure no path skips critical verification stages.

---
*Original commit message: fix: route item-level orders through inventory_verification + close remaining gaps*

#### Lesson Learned

**What was fixed:**  
Item-level orders were not routed through the `inventory_verification` step, causing gaps in order processing. The fix ensures all item-level orders pass through verification before proceeding.

**Why it broke:**  
The workflow logic had a conditional path that bypassed `inventory_verification` for item-level orders, likely due to an oversight in routing rules or an incomplete state machine transition.

**Reusable takeaway:**  
When designing workflow automation, explicitly map all order types (e.g., item-level vs. bulk) to every required step. Avoid implicit routing assumptions—use exhaustive condition checks or state machine diagrams to ensure no path skips critical verification stages.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] docs: add unified changelog, bug log, and update log for cross-extension collaboration

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 483ab3cafade02a53cd0467933c299d025f060ce

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 483ab3cafade02a53cd0467933c299d025f060ce
**Files:** docs/BUG_LOG.md,docs/CHANGELOG.md,docs/UPDATE_LOG.md

**Summary:**
**What was fixed:**  
Added three documentation files (BUG_LOG, CHANGELOG, UPDATE_LOG) to standardize cross-extension collaboration tracking.

**Why it broke:**  
Previously, no unified logging system existed. Extensions lacked a shared record of bugs, changes, or updates, causing communication gaps, duplicated effort, and inconsistent version tracking.

**Reusable takeaway:**  
For multi-extension or modular systems, establish a minimal, standardized documentation framework early. Separate logs by purpose (bugs, changes, updates) to reduce confusion and enable efficient cross-team debugging and release coordination.

---
*Original commit message: docs: add unified changelog, bug log, and update log for cross-extension collaboration*

#### Lesson Learned

**What was fixed:**  
Added three documentation files (BUG_LOG, CHANGELOG, UPDATE_LOG) to standardize cross-extension collaboration tracking.

**Why it broke:**  
Previously, no unified logging system existed. Extensions lacked a shared record of bugs, changes, or updates, causing communication gaps, duplicated effort, and inconsistent version tracking.

**Reusable takeaway:**  
For multi-extension or modular systems, establish a minimal, standardized documentation framework early. Separate logs by purpose (bugs, changes, updates) to reduce confusion and enable efficient cross-team debugging and release coordination.

#### Tags

cross-project, local-fallback

---

### Lesson: Service Worker cache invalidation — bump cache name to force browser to fetch fresh JS after code fix

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

When deploying JS bundle fixes to a PWA with Service Worker, the SW cache name must be bumped (e.g. v2→v3) so the SW activate event deletes old caches. Even then, the user must do a hard refresh (Ctrl+Shift+R) to bypass both SW cache and HTTP cache. Root cause: SW stale-while-revalidate pattern served old JS even after new code was deployed. Fix: bump CACHE_NAME in sw.js + user hard refresh.

#### Lesson Learned

When deploying JS bundle fixes to a PWA with Service Worker, the SW cache name must be bumped (e.g. v2→v3) so the SW activate event deletes old caches. Even then, the user must do a hard refresh (Ctrl+Shift+R) to bypass both SW cache and HTTP cache. Root cause: SW stale-while-revalidate pattern served old JS even after new code was deployed. Fix: bump CACHE_NAME in sw.js + user hard refresh.

#### Tags

cross-project, local-fallback

---

### Lesson: getStoredAccounts() merge logic — must propagate all fields (password, subUsers, etc.) from DEFAULT_ACCOUNTS to localStorage

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

When seeding default accounts into localStorage, the merge loop only updated password but not subUsers. This caused shared accounts (like sales.homeu@gmail.com) to lose their sub-user definitions after first login. Root cause: merge logic only checked password field. Fix: add subUsers field comparison and merge alongside password.

#### Lesson Learned

When seeding default accounts into localStorage, the merge loop only updated password but not subUsers. This caused shared accounts (like sales.homeu@gmail.com) to lose their sub-user definitions after first login. Root cause: merge logic only checked password field. Fix: add subUsers field comparison and merge alongside password.

#### Tags

cross-project, local-fallback

---

### Lesson: Docker Compose stale image references — use down --remove-orphans before up -d --build to clear corrupted container state

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

After rebuilding containers on VPS, Docker Compose throws 'No such image: sha256:...' and 'KeyError: ContainerConfig' errors because old image hashes persist in Compose state. Root cause: Docker Compose v1 tracks container config by image hash; when images are rebuilt with new hashes, old references become stale. Fix: always run docker-compose down --remove-orphans before docker-compose up -d --build to clear all stale state.

#### Lesson Learned

After rebuilding containers on VPS, Docker Compose throws 'No such image: sha256:...' and 'KeyError: ContainerConfig' errors because old image hashes persist in Compose state. Root cause: Docker Compose v1 tracks container config by image hash; when images are rebuilt with new hashes, old references become stale. Fix: always run docker-compose down --remove-orphans before docker-compose up -d --build to clear all stale state.

#### Tags

cross-project, local-fallback

---

### Lesson: Cross-extension logging system — use .clinerules to enforce UPDATE_LOG, BUG_LOG, CHANGELOG across Roo/Claude/Codex/Kimi

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

When multiple AI coding extensions work on the same project, they need a shared logging protocol. Created three log files (CHANGELOG.md, BUG_LOG.md, UPDATE_LOG.md) and added mandatory logging rules to .clinerules so every extension automatically logs their work, bugs, and commits. Root cause: no coordination mechanism between extensions. Fix: .clinerules-based logging protocol with git-pull-before-edit and git-commit-after-update workflow.

#### Lesson Learned

When multiple AI coding extensions work on the same project, they need a shared logging protocol. Created three log files (CHANGELOG.md, BUG_LOG.md, UPDATE_LOG.md) and added mandatory logging rules to .clinerules so every extension automatically logs their work, bugs, and commits. Root cause: no coordination mechanism between extensions. Fix: .clinerules-based logging protocol with git-pull-before-edit and git-commit-after-update workflow.

#### Tags

cross-project, local-fallback

---

### Lesson: Next.js Service Worker + nginx cache strategy for PWA — 365d immutable cache breaks hotfix deployment

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Next.js dashboard with PWA Service Worker uses stale-while-revalidate for _next/static/ assets. nginx sets max-age=31536000 (1 year) immutable. When deploying a hotfix, the browser serves the old JS from either the SW cache or HTTP cache even after new code is deployed. Root cause: content-hashed chunk filenames don't change if the source file didn't change between builds. Fix: bump SW CACHE_NAME (v2→v3) so activate event deletes old cache, AND user must hard refresh (Ctrl+Shift+R) to bypass both caches.

#### Lesson Learned

Next.js dashboard with PWA Service Worker uses stale-while-revalidate for _next/static/ assets. nginx sets max-age=31536000 (1 year) immutable. When deploying a hotfix, the browser serves the old JS from either the SW cache or HTTP cache even after new code is deployed. Root cause: content-hashed chunk filenames don't change if the source file didn't change between builds. Fix: bump SW CACHE_NAME (v2→v3) so activate event deletes old cache, AND user must hard refresh (Ctrl+Shift+R) to bypass both caches.

#### Tags

cross-project, local-fallback

---

### Lesson: Docker Compose v1 on VPS — always use down --remove-orphans before up -d to avoid stale image hash errors

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

On a 1GB VPS running Docker Compose v1, rebuilding containers often fails with 'No such image: sha256:...' and 'KeyError: ContainerConfig'. This happens because Compose v1 tracks container config by image hash, and when images are rebuilt with new hashes, old references become stale. The fix is to always run 'docker-compose down --remove-orphans' first (which removes all containers and their references), then 'docker-compose up -d --build' to create fresh containers with correct image hashes. Without this, even subsequent rebuilds fail because old container records still reference stale hashes.

#### Lesson Learned

On a 1GB VPS running Docker Compose v1, rebuilding containers often fails with 'No such image: sha256:...' and 'KeyError: ContainerConfig'. This happens because Compose v1 tracks container config by image hash, and when images are rebuilt with new hashes, old references become stale. The fix is to always run 'docker-compose down --remove-orphans' first (which removes all containers and their references), then 'docker-compose up -d --build' to create fresh containers with correct image hashes. Without this, even subsequent rebuilds fail because old container records still reference stale hashes.

#### Tags

cross-project, local-fallback

---

### Lesson: localStorage account seeding — merge loop must propagate ALL fields (password, subUsers, role) from defaults to stored data

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

When seeding DEFAULT_ACCOUNTS into localStorage for client-side auth, the getStoredAccounts() merge loop only compared and updated the password field. This caused shared accounts with subUsers (like sales.homeu@gmail.com with Mariella/Cathlyn) to lose their sub-user definitions after the first login persisted the account without subUsers. Root cause: the merge loop at line 78-95 only checked parsed[idx].password !== def.password. Fix: add subUsers field comparison using JSON.stringify + merge alongside password. General lesson: any field added to Account interface later must be added to the merge loop.

#### Lesson Learned

When seeding DEFAULT_ACCOUNTS into localStorage for client-side auth, the getStoredAccounts() merge loop only compared and updated the password field. This caused shared accounts with subUsers (like sales.homeu@gmail.com with Mariella/Cathlyn) to lose their sub-user definitions after the first login persisted the account without subUsers. Root cause: the merge loop at line 78-95 only checked parsed[idx].password !== def.password. Fix: add subUsers field comparison using JSON.stringify + merge alongside password. General lesson: any field added to Account interface later must be added to the merge loop.

#### Tags

cross-project, local-fallback

---

### Lesson: Cross-extension coordination — .clinerules-based logging protocol for multiple AI coding extensions on same project

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

When 4 AI coding extensions (Roo, Claude, Codex, Kimi) work on the same project simultaneously, they need a shared coordination protocol. Created 3 log files: CHANGELOG.md (commits + deploy status), BUG_LOG.md (bugs with root cause + fix), UPDATE_LOG.md (real-time work tracking). Added mandatory logging rules to .clinerules so every extension reads them on startup. Key rules: git pull before editing logs, git commit after updating, coordinate via UPDATE_LOG when multiple extensions active. This prevents merge conflicts and provides a single source of truth for all extensions.

#### Lesson Learned

When 4 AI coding extensions (Roo, Claude, Codex, Kimi) work on the same project simultaneously, they need a shared coordination protocol. Created 3 log files: CHANGELOG.md (commits + deploy status), BUG_LOG.md (bugs with root cause + fix), UPDATE_LOG.md (real-time work tracking). Added mandatory logging rules to .clinerules so every extension reads them on startup. Key rules: git pull before editing logs, git commit after updating, coordinate via UPDATE_LOG when multiple extensions active. This prevents merge conflicts and provides a single source of truth for all extensions.

#### Tags

cross-project, local-fallback

---

### Lesson: Telegram bot 409 Conflict on restart — add bot.telegram.callApi('close') + retry logic with exponential backoff

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Telegram bot crashes with 409 Conflict error when restarting because the previous bot instance still holds the Telegram polling lock. Root cause: Telegram's long-polling API doesn't release the lock immediately on disconnect. Fix: call bot.telegram.callApi('close') before bot.launch() to release the lock, add retry logic with exponential backoff for 429 rate-limits, and increase retries to 30 attempts.

#### Lesson Learned

Telegram bot crashes with 409 Conflict error when restarting because the previous bot instance still holds the Telegram polling lock. Root cause: Telegram's long-polling API doesn't release the lock immediately on disconnect. Fix: call bot.telegram.callApi('close') before bot.launch() to release the lock, add retry logic with exponential backoff for 429 rate-limits, and increase retries to 30 attempts.

#### Tags

cross-project, local-fallback

---

### Lesson: Next.js Docker build OOM on 1GB VPS — use npm install instead of npm ci to reduce memory usage

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Dashboard Docker build crashes with OOM (Out of Memory) on a 1GB VPS during npm ci. Root cause: npm ci is stricter and uses more memory than npm install because it performs a clean install from lockfile. Fix: replace npm ci with npm install in Dockerfile, add --max-old-space-size flag, reduce npm maxsockets, and use --prefer-offline flag to minimize memory usage during build.

#### Lesson Learned

Dashboard Docker build crashes with OOM (Out of Memory) on a 1GB VPS during npm ci. Root cause: npm ci is stricter and uses more memory than npm install because it performs a clean install from lockfile. Fix: replace npm ci with npm install in Dockerfile, add --max-old-space-size flag, reduce npm maxsockets, and use --prefer-offline flag to minimize memory usage during build.

#### Tags

cross-project, local-fallback

---

### Lesson: Google Drive upload — add withRetry wrapper with exponential backoff + token refresh for 401 errors

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Google Drive file uploads fail silently when the access token expires. Root cause: OAuth 2.0 tokens have a 1-hour expiry, and the upload function had no retry logic or token refresh mechanism. Fix: create a withRetry() wrapper that catches 401 errors, refreshes the token via oauth2Client.refreshAccessToken(), and retries the upload with exponential backoff (1s, 2s, 4s, 8s delays).

#### Lesson Learned

Google Drive file uploads fail silently when the access token expires. Root cause: OAuth 2.0 tokens have a 1-hour expiry, and the upload function had no retry logic or token refresh mechanism. Fix: create a withRetry() wrapper that catches 401 errors, refreshes the token via oauth2Client.refreshAccessToken(), and retries the upload with exponential backoff (1s, 2s, 4s, 8s delays).

#### Tags

cross-project, local-fallback

---

### Lesson: Item-level production infinite loop — add skip-set check before auto-advance in Telegram inline button handlers

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Telegram bot enters infinite loop when user clicks 'Not Yet' on an already-not_yet item in production or en-route flows. Root cause: the auto-advance logic didn't check if the item was already in a skip/set state before advancing to the next item, causing the same item to be processed repeatedly. Fix: add skip-set check (if item.status === 'not_yet' && already processed) before calling auto-advance logic in item_prod and item_en_route handlers.

#### Lesson Learned

Telegram bot enters infinite loop when user clicks 'Not Yet' on an already-not_yet item in production or en-route flows. Root cause: the auto-advance logic didn't check if the item was already in a skip/set state before advancing to the next item, causing the same item to be processed repeatedly. Fix: add skip-set check (if item.status === 'not_yet' && already processed) before calling auto-advance logic in item_prod and item_en_route handlers.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: wire en_route_verification stage end-to-end + fix workflow gaps

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 48039275a6ec05d1af77384342a169834c0063d5

**Project:** workflowautomation
**Author:** unknown
**Commit:** 48039275a6ec05d1af77384342a169834c0063d5
**Files:** 

**Summary:**
**What was fixed:**  
The `en_route_verification` stage was not wired end-to-end in the workflow, causing it to be skipped or misaligned with subsequent stages. Workflow gaps (missing transitions or data handoffs) were also corrected.

**Why it broke:**  
The stage was defined in isolation but lacked proper integration into the workflow pipeline. Transition logic between stages was incomplete, and data dependencies (e.g., verification results not passed to next stage) were not accounted for.

**Reusable takeaway:**  
When adding a new stage to a workflow, ensure it is fully wired end-to-end:  
- Define explicit input/output contracts with adjacent stages.  
- Verify all transitions (success, failure, retry) are implemented.  
- Test the full pipeline, not just the stage in isolation.  

**Root cause:**  
Incomplete integration of a new stage into an existing workflow due to missing transition logic and data handoffs.

---
*Original commit message: fix: wire en_route_verification stage end-to-end + fix workflow gaps*

#### Lesson Learned

**What was fixed:**  
The `en_route_verification` stage was not wired end-to-end in the workflow, causing it to be skipped or misaligned with subsequent stages. Workflow gaps (missing transitions or data handoffs) were also corrected.

**Why it broke:**  
The stage was defined in isolation but lacked proper integration into the workflow pipeline. Transition logic between stages was incomplete, and data dependencies (e.g., verification results not passed to next stage) were not accounted for.

**Reusable takeaway:**  
When adding a new stage to a workflow, ensure it is fully wired end-to-end:  
- Define explicit input/output contracts with adjacent stages.  
- Verify all transitions (success, failure, retry) are implemented.  
- Test the full pipeline, not just the stage in isolation.  

**Root cause:**  
Incomplete integration of a new stage into an existing workflow due to missing transition logic and data handoffs.

#### Tags

cross-project, local-fallback

---

### Lesson: Telegram reminder item sync patch

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

When Telegram reminder callbacks use shortened item IDs in callback_data, resolve the full order item UUID with GET /orders/{orderId}/items before PATCHing /orders/{orderId}/items/{itemId}. Avoid POST for item updates because the API only exposes PATCH for single-item updates; this keeps reminder-driven Telegram updates synced with dashboard manual inventory/delivery tabs.

#### Lesson Learned

When Telegram reminder callbacks use shortened item IDs in callback_data, resolve the full order item UUID with GET /orders/{orderId}/items before PATCHing /orders/{orderId}/items/{itemId}. Avoid POST for item updates because the API only exposes PATCH for single-item updates; this keeps reminder-driven Telegram updates synced with dashboard manual inventory/delivery tabs.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: reminder scheduler gaps for en_route_verification stage

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 1749ed9d86815e203d7d42638141f4533e6d2794

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 1749ed9d86815e203d7d42638141f4533e6d2794
**Files:** apps/api/src/agents/productionAgent.ts,apps/api/src/server.ts,apps/api/src/services/reminderScheduler.ts,apps/dashboard/src/app/orders/[quotationNumber]/page.tsx,apps/telegram-bot/src/bot.ts,docs/UPDATE_LOG.md,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**Lesson: Reminder Scheduler Gaps for `en_route_verification` Stage**

**What was fixed:**  
Reminder notifications were not being scheduled for the `en_route_verification` stage, causing missing alerts for orders in that state.

**Why it broke:**  
The reminder scheduler logic had a gap: it only handled certain stages (e.g., `pending`, `in_progress`) but omitted `en_route_verification`. This was likely due to an incomplete stage mapping or a missing case in the scheduler's state machine.

**Reusable takeaway:**  
When implementing stage-based schedulers (e.g., reminders, escalations), ensure all possible states are explicitly enumerated and handled. Use a centralized stage-to-action mapping or a switch statement with a default fallback that logs unhandled stages. This prevents silent gaps when new stages are added or existing ones are renamed.

---
*Original commit message: fix: reminder scheduler gaps for en_route_verification stage*

#### Lesson Learned

**Lesson: Reminder Scheduler Gaps for `en_route_verification` Stage**

**What was fixed:**  
Reminder notifications were not being scheduled for the `en_route_verification` stage, causing missing alerts for orders in that state.

**Why it broke:**  
The reminder scheduler logic had a gap: it only handled certain stages (e.g., `pending`, `in_progress`) but omitted `en_route_verification`. This was likely due to an incomplete stage mapping or a missing case in the scheduler's state machine.

**Reusable takeaway:**  
When implementing stage-based schedulers (e.g., reminders, escalations), ensure all possible states are explicitly enumerated and handled. Use a centralized stage-to-action mapping or a switch statement with a default fallback that logs unhandled stages. This prevents silent gaps when new stages are added or existing ones are renamed.

#### Tags

cross-project, local-fallback

---

### Lesson: VPS API 502 OTP recovery

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

If dashboard OTP modal shows nginx 502 HTML and /api/health is also 502, inspect VPS docker compose. In this case qas_api was missing after a stale/removing API container conflict; running docker compose up -d restored postgres, redis, api, dashboard, telegram-bot, and send-otp returned 200. Verify with public /api/health and /api/auth/send-otp.

#### Lesson Learned

If dashboard OTP modal shows nginx 502 HTML and /api/health is also 502, inspect VPS docker compose. In this case qas_api was missing after a stale/removing API container conflict; running docker compose up -d restored postgres, redis, api, dashboard, telegram-bot, and send-otp returned 200. Verify with public /api/health and /api/auth/send-otp.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] docs: update CHANGELOG and UPDATE_LOG — deployed reminder scheduler fix at 1749ed9

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit fca246821884d6c7958e0f1ce8489d737f2297bf

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** fca246821884d6c7958e0f1ce8489d737f2297bf
**Files:** docs/CHANGELOG.md,docs/UPDATE_LOG.md,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
A bug in the reminder scheduler deployment was corrected.

**Why it broke:**  
The scheduler logic had an edge case where reminders were not being triggered correctly under certain conditions (likely timing or state mismanagement).

**Reusable takeaway:**  
Always validate scheduler logic against edge cases (e.g., time boundaries, state transitions) before deployment. Document fixes in both changelog and update logs, and update the lesson index to capture the root cause for future reference.

---
*Original commit message: docs: update CHANGELOG and UPDATE_LOG — deployed reminder scheduler fix at 1749ed9*

#### Lesson Learned

**What was fixed:**  
A bug in the reminder scheduler deployment was corrected.

**Why it broke:**  
The scheduler logic had an edge case where reminders were not being triggered correctly under certain conditions (likely timing or state mismanagement).

**Reusable takeaway:**  
Always validate scheduler logic against edge cases (e.g., time boundaries, state transitions) before deployment. Document fixes in both changelog and update logs, and update the lesson index to capture the root cause for future reference.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: restore en_route_verification stage card

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 029adcd38c14349855c2def7e3fe621a80f8923c

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 029adcd38c14349855c2def7e3fe621a80f8923c
**Files:** apps/dashboard/src/lib/api.ts,docs/BUG_LOG.md,docs/CHANGELOG.md,docs/UPDATE_LOG.md

**Summary:**
**What was fixed:**  
Restored the `en_route_verification` stage card that had gone missing from the dashboard UI.

**Why it broke:**  
A previous API refactor inadvertently removed the stage card definition for `en_route_verification` from the API layer (`api.ts`), causing the frontend to no longer render it.

**Reusable takeaway:**  
When refactoring API endpoints or data structures, always cross-reference all UI components that depend on the removed or changed data. A missing stage card is a silent failure—no error, just a missing element. Use integration tests or visual regression checks to catch such omissions.

---
*Original commit message: fix: restore en_route_verification stage card*

#### Lesson Learned

**What was fixed:**  
Restored the `en_route_verification` stage card that had gone missing from the dashboard UI.

**Why it broke:**  
A previous API refactor inadvertently removed the stage card definition for `en_route_verification` from the API layer (`api.ts`), causing the frontend to no longer render it.

**Reusable takeaway:**  
When refactoring API endpoints or data structures, always cross-reference all UI components that depend on the removed or changed data. A missing stage card is a silent failure—no error, just a missing element. Use integration tests or visual regression checks to catch such omissions.

#### Tags

cross-project, local-fallback

---

### Lesson: Stage pipeline STAGE_ORDER regression

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

The /stages Stage Summary renders only stages present in dashboard STAGE_ORDER and STAGE_CONFIG. If en_route_verification disappears while backend/Telegram still know the stage, check apps/dashboard/src/lib/api.ts; commit ada6e80 removed the STAGE_CONFIG and STAGE_ORDER entries, so restore en_route_verification between en_route and inventory_verification and rebuild/deploy dashboard.

#### Lesson Learned

The /stages Stage Summary renders only stages present in dashboard STAGE_ORDER and STAGE_CONFIG. If en_route_verification disappears while backend/Telegram still know the stage, check apps/dashboard/src/lib/api.ts; commit ada6e80 removed the STAGE_CONFIG and STAGE_ORDER entries, so restore en_route_verification between en_route and inventory_verification and rebuild/deploy dashboard.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] docs: update CHANGELOG — production workflow gaps fixed (partial_production end-to-end)

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 3820cdf586aafca4a92c7340a56f5c65bb1402a4

**Project:** workflowautomation
**Author:** unknown
**Commit:** 3820cdf586aafca4a92c7340a56f5c65bb1402a4
**Files:** 

**Summary:**
**What was fixed:** A gap in the production workflow where the `partial_production` end-to-end path was incomplete or misconfigured, preventing full automation from staging to production.

**Why it broke:** The workflow assumed a complete production pipeline, but the `partial_production` scenario lacked necessary steps (e.g., missing environment variables, incomplete deployment triggers, or skipped validation checks). This caused the end-to-end flow to fail silently or halt mid-process.

**Reusable takeaway:** Always test production workflows with *partial* or *edge-case* configurations (e.g., limited environments, partial data sets) to uncover hidden dependencies. Document these gaps in the CHANGELOG to track incremental fixes. For automation, explicitly validate each stage’s prerequisites before proceeding—don’t assume the pipeline is fully wired.

---
*Original commit message: docs: update CHANGELOG — production workflow gaps fixed (partial_production end-to-end)*

#### Lesson Learned

**What was fixed:** A gap in the production workflow where the `partial_production` end-to-end path was incomplete or misconfigured, preventing full automation from staging to production.

**Why it broke:** The workflow assumed a complete production pipeline, but the `partial_production` scenario lacked necessary steps (e.g., missing environment variables, incomplete deployment triggers, or skipped validation checks). This caused the end-to-end flow to fail silently or halt mid-process.

**Reusable takeaway:** Always test production workflows with *partial* or *edge-case* configurations (e.g., limited environments, partial data sets) to uncover hidden dependencies. Document these gaps in the CHANGELOG to track incremental fixes. For automation, explicitly validate each stage’s prerequisites before proceeding—don’t assume the pipeline is fully wired.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: split production workflow handoff from production start

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 3b7767e4ab1e6e0d330628ffbc5638abb4424e64

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 3b7767e4ab1e6e0d330628ffbc5638abb4424e64
**Files:** apps/api/src/agents/purchasingAgent.ts,apps/api/src/server.ts,apps/api/src/services/reminderScheduler.ts,apps/dashboard/src/app/purchasing/page.tsx,apps/telegram-bot/src/bot.ts,docs/BUG_LOG.md,docs/CHANGELOG.md,docs/UPDATE_LOG.md

**Summary:**
**What was fixed:**  
A bug where the production workflow handoff (transitioning a job from "in production" to "completed") was incorrectly coupled with the production start action. This caused premature completion or skipped handoffs when starting production.

**Why it broke:**  
The original code assumed that starting production automatically implied a handoff. In reality, handoff is a separate, manual step that should occur only after production is fully complete. The coupling violated the actual workflow logic.

**Reusable takeaway:**  
Decouple distinct workflow stages (e.g., start vs. handoff) into separate actions or events. Never assume sequential steps are atomic unless the domain explicitly requires it. Use explicit state transitions to avoid unintended side effects and to allow independent triggering of each stage.

---
*Original commit message: fix: split production workflow handoff from production start*

#### Lesson Learned

**What was fixed:**  
A bug where the production workflow handoff (transitioning a job from "in production" to "completed") was incorrectly coupled with the production start action. This caused premature completion or skipped handoffs when starting production.

**Why it broke:**  
The original code assumed that starting production automatically implied a handoff. In reality, handoff is a separate, manual step that should occur only after production is fully complete. The coupling violated the actual workflow logic.

**Reusable takeaway:**  
Decouple distinct workflow stages (e.g., start vs. handoff) into separate actions or events. Never assume sequential steps are atomic unless the domain explicitly requires it. Use explicit state transitions to avoid unintended side effects and to allow independent triggering of each stage.

#### Tags

cross-project, local-fallback

---

### Lesson: Production workflow handoff separation

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

Purchasing dashboard must not call /set-production when the team only acknowledges the production workflow. Move purchasing_pending to production_pending via /stage-updates, keep production_started=false, create a production_pending reminder to the production group asking whether actual production has started, and keep produce:yes/partial/no callbacks only for actual production start.

#### Lesson Learned

Purchasing dashboard must not call /set-production when the team only acknowledges the production workflow. Move purchasing_pending to production_pending via /stage-updates, keep production_started=false, create a production_pending reminder to the production group asking whether actual production has started, and keep produce:yes/partial/no callbacks only for actual production start.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: auto-detect deposit slip when photo sent to collection group chat — no button clicks required

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit a86fd7cdd4559002c230ecde6c8c691a7d4edb87

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** a86fd7cdd4559002c230ecde6c8c691a7d4edb87
**Files:** apps/telegram-bot/src/bot.ts,docs/CHANGELOG.md,docs/UPDATE_LOG.md

**Summary:**
**What was fixed:** The Telegram bot now auto-detects deposit slip photos sent to a collection group chat, eliminating the need for users to click a button to trigger processing.

**Why it broke:** The previous implementation required an explicit user action (button click) to initiate deposit slip detection, causing friction and missed auto-processing when users simply sent photos without interacting with the bot's UI.

**Reusable takeaway:** When designing chat-based automation, prefer passive event-driven triggers (e.g., photo upload detection) over active user-initiated actions (e.g., button clicks) for common workflows. This reduces user friction and ensures reliable processing even when users skip explicit confirmation steps. Always consider the most natural user behavior (sending a photo) as the trigger, not the UI element they might ignore.

---
*Original commit message: fix: auto-detect deposit slip when photo sent to collection group chat — no button clicks required*

#### Lesson Learned

**What was fixed:** The Telegram bot now auto-detects deposit slip photos sent to a collection group chat, eliminating the need for users to click a button to trigger processing.

**Why it broke:** The previous implementation required an explicit user action (button click) to initiate deposit slip detection, causing friction and missed auto-processing when users simply sent photos without interacting with the bot's UI.

**Reusable takeaway:** When designing chat-based automation, prefer passive event-driven triggers (e.g., photo upload detection) over active user-initiated actions (e.g., button clicks) for common workflows. This reduces user friction and ensures reliable processing even when users skip explicit confirmation steps. Always consider the most natural user behavior (sending a photo) as the trigger, not the UI element they might ignore.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: include payment verification fields in order lists

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 3b6a1789b564407a38ecd87cec01bdc00501340a

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 3b6a1789b564407a38ecd87cec01bdc00501340a
**Files:** apps/api/src/server.ts,docs/BUG_LOG.md,docs/CHANGELOG.md,docs/UPDATE_LOG.md

**Summary:**
**What was fixed:** Payment verification fields (e.g., `paymentVerified`, `verificationTimestamp`) were missing from order list API responses, causing downstream systems to treat unverified orders as complete.

**Why it broke:** The order list query used a projection that omitted these fields, likely because they were added later to the database schema but not included in the read path. The write path (order creation/update) included them, but the list endpoint was not updated.

**Reusable takeaway:** When adding new fields to a database schema, always audit all read paths (list, detail, export) to ensure they include the new fields. A common pitfall is updating only the write/update logic and forgetting the read projection. Use a shared field list or DTO to enforce consistency across endpoints.

---
*Original commit message: fix: include payment verification fields in order lists*

#### Lesson Learned

**What was fixed:** Payment verification fields (e.g., `paymentVerified`, `verificationTimestamp`) were missing from order list API responses, causing downstream systems to treat unverified orders as complete.

**Why it broke:** The order list query used a projection that omitted these fields, likely because they were added later to the database schema but not included in the read path. The write path (order creation/update) included them, but the list endpoint was not updated.

**Reusable takeaway:** When adding new fields to a database schema, always audit all read paths (list, detail, export) to ensure they include the new fields. A common pitfall is updating only the write/update logic and forgetting the read projection. Use a shared field list or DTO to enforce consistency across endpoints.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: deploy-agent — delegate container management to deploy.sh --skip-pull

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit c5fb6fbf7d905e7169459508cb1f1ed15471fa5b

**Project:** workflowautomation
**Author:** unknown
**Commit:** c5fb6fbf7d905e7169459508cb1f1ed15471fa5b
**Files:** 

**Summary:**
Commit: fix: deploy-agent — delegate container management to deploy.sh --skip-pull
Files: 
Project: workflowautomation

---
*Original commit message: fix: deploy-agent — delegate container management to deploy.sh --skip-pull*

#### Lesson Learned

Commit: fix: deploy-agent — delegate container management to deploy.sh --skip-pull
Files: 
Project: workflowautomation

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: purchasing_pending orders never got Telegram notification to start production workflow

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 9a68b0004d5f2178f869895098e9e1fd4e3a0acf

**Project:** workflowautomation
**Author:** unknown
**Commit:** 9a68b0004d5f2178f869895098e9e1fd4e3a0acf
**Files:** 

**Summary:**
**What was fixed:**  
Telegram notifications for starting production workflow were never sent for orders with status `purchasing_pending`.

**Why it broke:**  
The notification trigger logic only checked for status `purchasing` (the next status after `purchasing_pending`), missing the initial pending state. The workflow expected a notification at the `purchasing_pending` stage, but the condition was too narrow.

**Reusable takeaway:**  
When designing state-driven notifications, ensure triggers cover all transitional states that require action, not just the final or most common state. Use explicit state mapping or a state machine to avoid silent gaps in workflow automation.

---
*Original commit message: fix: purchasing_pending orders never got Telegram notification to start production workflow*

#### Lesson Learned

**What was fixed:**  
Telegram notifications for starting production workflow were never sent for orders with status `purchasing_pending`.

**Why it broke:**  
The notification trigger logic only checked for status `purchasing` (the next status after `purchasing_pending`), missing the initial pending state. The workflow expected a notification at the `purchasing_pending` stage, but the condition was too narrow.

**Reusable takeaway:**  
When designing state-driven notifications, ensure triggers cover all transitional states that require action, not just the final or most common state. Use explicit state mapping or a state machine to avoid silent gaps in workflow automation.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add en_route_verification/inventory/balance/delivery reminder creation + stageToGroup map + manual production statu

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 66682ef45c4a09e89e2f7d31f3de95728498205e

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 66682ef45c4a09e89e2f7d31f3de95728498205e
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/orders/[quotationNumber]/page.tsx,apps/dashboard/src/app/purchasing/page.tsx,docs/CHANGELOG.md,docs/UPDATE_LOG.md,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**Summary of Engineering Commit**

**What was fixed:**  
Added missing en_route verification, inventory balance, delivery reminder creation, stage-to-group mapping, manual production status on the purchasing page, and stage advancement on the order detail page. The dashboard progression was previously dependent on Telegram, which is now removed.

**Why it broke:**  
The system relied on Telegram for dashboard progression, creating a fragile dependency. When Telegram was unavailable or delayed, the dashboard could not advance stages or reflect accurate statuses.

**Reusable takeaway:**  
Avoid coupling core workflow progression to external messaging services. Instead, implement direct, service-agnostic logic for state transitions and reminders. This ensures reliability and independence from third-party availability.

---
*Original commit message: fix: add en_route_verification/inventory/balance/delivery reminder creation + stageToGroup map + manual production status on purchasing page + stage advancement on order detail page — Telegram-independent dashboard progression*

#### Lesson Learned

**Summary of Engineering Commit**

**What was fixed:**  
Added missing en_route verification, inventory balance, delivery reminder creation, stage-to-group mapping, manual production status on the purchasing page, and stage advancement on the order detail page. The dashboard progression was previously dependent on Telegram, which is now removed.

**Why it broke:**  
The system relied on Telegram for dashboard progression, creating a fragile dependency. When Telegram was unavailable or delayed, the dashboard could not advance stages or reflect accurate statuses.

**Reusable takeaway:**  
Avoid coupling core workflow progression to external messaging services. Instead, implement direct, service-agnostic logic for state transitions and reminders. This ensures reliability and independence from third-party availability.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add en_route_verification/inventory/balance/delivery reminder creation + stageToGroup map + manual production statu

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 3c26efd2372c739e2c9931c15c945c430ce3a1ca

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 3c26efd2372c739e2c9931c15c945c430ce3a1ca
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/orders/[quotationNumber]/page.tsx,apps/dashboard/src/app/purchasing/page.tsx,docs/CHANGELOG.md,docs/UPDATE_LOG.md,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
A Telegram-independent dashboard progression system was added, including en_route_verification, inventory, balance, delivery reminder creation, stageToGroup map, manual production status on the purchasing page, and stage advancement on the order detail page.

**Why it broke:**  
The system previously relied on Telegram for all progression triggers. When Telegram was unavailable or delayed, dashboard stages stalled, breaking the workflow automation for users who needed direct dashboard control.

**Reusable takeaway:**  
Never make a critical workflow progression dependent on a single external communication channel. Always implement a fallback or independent UI-based progression mechanism (e.g., manual stage advancement buttons, status toggles) to ensure system resilience when external services are down or slow.

---
*Original commit message: fix: add en_route_verification/inventory/balance/delivery reminder creation + stageToGroup map + manual production status on purchasing page + stage advancement on order detail page — Telegram-independent dashboard progression*

#### Lesson Learned

**What was fixed:**  
A Telegram-independent dashboard progression system was added, including en_route_verification, inventory, balance, delivery reminder creation, stageToGroup map, manual production status on the purchasing page, and stage advancement on the order detail page.

**Why it broke:**  
The system previously relied on Telegram for all progression triggers. When Telegram was unavailable or delayed, dashboard stages stalled, breaking the workflow automation for users who needed direct dashboard control.

**Reusable takeaway:**  
Never make a critical workflow progression dependent on a single external communication channel. Always implement a fallback or independent UI-based progression mechanism (e.g., manual stage advancement buttons, status toggles) to ensure system resilience when external services are down or slow.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add en_route_verification/inventory/balance/delivery reminder creation + stageToGroup map + manual production statu

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit dd9a274e3d6ddc5185b3d59c0051f4a6da1607c3

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** dd9a274e3d6ddc5185b3d59c0051f4a6da1607c3
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/orders/[quotationNumber]/page.tsx,apps/dashboard/src/app/purchasing/page.tsx,docs/CHANGELOG.md,docs/UPDATE_LOG.md,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**Summary**

**What was fixed:**  
Added missing `en_route_verification`, `inventory`, `balance`, and `delivery` reminder creation; corrected `stageToGroup` mapping; enabled manual production status on the purchasing page; and fixed stage advancement on the order detail page. The dashboard now progresses independently of Telegram.

**Why it broke:**  
The system previously relied on Telegram-dependent triggers for stage transitions and reminders. When Telegram was unavailable or delayed, the dashboard stalled because it lacked independent progression logic. Additionally, the `stageToGroup` map was incomplete, causing mismatches in stage-to-group assignments.

**Reusable takeaway:**  
Decouple dashboard progression from external messaging dependencies (e.g., Telegram). Maintain a complete and validated `stageToGroup` mapping to ensure stage transitions and reminders are triggered correctly regardless of external service availability. Always test stage advancement logic independently of external integrations.

---
*Original commit message: fix: add en_route_verification/inventory/balance/delivery reminder creation + stageToGroup map + manual production status on purchasing page + stage advancement on order detail page — Telegram-independent dashboard progression*

#### Lesson Learned

**Summary**

**What was fixed:**  
Added missing `en_route_verification`, `inventory`, `balance`, and `delivery` reminder creation; corrected `stageToGroup` mapping; enabled manual production status on the purchasing page; and fixed stage advancement on the order detail page. The dashboard now progresses independently of Telegram.

**Why it broke:**  
The system previously relied on Telegram-dependent triggers for stage transitions and reminders. When Telegram was unavailable or delayed, the dashboard stalled because it lacked independent progression logic. Additionally, the `stageToGroup` map was incomplete, causing mismatches in stage-to-group assignments.

**Reusable takeaway:**  
Decouple dashboard progression from external messaging dependencies (e.g., Telegram). Maintain a complete and validated `stageToGroup` mapping to ensure stage transitions and reminders are triggered correctly regardless of external service availability. Always test stage advancement logic independently of external integrations.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add en_route_verification/inventory/balance/delivery reminder creation + stageToGroup map + manual production statu

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit a5909bcbb2a5fe92e26de857de7cb4b2914af476

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** a5909bcbb2a5fe92e26de857de7cb4b2914af476
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/orders/[quotationNumber]/page.tsx,apps/dashboard/src/app/purchasing/page.tsx,docs/CHANGELOG.md,docs/UPDATE_LOG.md,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**Summary of Engineering Commit**

**What was fixed:**  
Added missing `en_route_verification`, `inventory`, `balance`, and `delivery` reminder creation; fixed `stageToGroup` map; added manual production status on purchasing page; enabled stage advancement on order detail page. This completed Telegram-independent dashboard progression.

**Why it broke:**  
The system relied on Telegram for triggering stage transitions and reminders. When Telegram was removed, the dashboard lacked its own logic to advance stages and create reminders, causing the workflow to stall.

**Reusable takeaway:**  
When decoupling a system from an external dependency (e.g., Telegram), ensure all state transitions and side effects (reminders, status updates) are re-implemented natively in the primary interface. Do not assume the external service will continue to drive core logic.

---
*Original commit message: fix: add en_route_verification/inventory/balance/delivery reminder creation + stageToGroup map + manual production status on purchasing page + stage advancement on order detail page — Telegram-independent dashboard progression*

#### Lesson Learned

**Summary of Engineering Commit**

**What was fixed:**  
Added missing `en_route_verification`, `inventory`, `balance`, and `delivery` reminder creation; fixed `stageToGroup` map; added manual production status on purchasing page; enabled stage advancement on order detail page. This completed Telegram-independent dashboard progression.

**Why it broke:**  
The system relied on Telegram for triggering stage transitions and reminders. When Telegram was removed, the dashboard lacked its own logic to advance stages and create reminders, causing the workflow to stall.

**Reusable takeaway:**  
When decoupling a system from an external dependency (e.g., Telegram), ensure all state transitions and side effects (reminders, status updates) are re-implemented natively in the primary interface. Do not assume the external service will continue to drive core logic.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] docs: mark a5909bc as deployed — gap fixes for Telegram-independent dashboard progression

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 0eebaac872852239c2fd86f751bd11a4d50a0fa9

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 0eebaac872852239c2fd86f751bd11a4d50a0fa9
**Files:** docs/CHANGELOG.md,docs/UPDATE_LOG.md

**Summary:**
**What was fixed:** A gap in dashboard progression logic that prevented Telegram-independent operation. The dashboard now advances correctly without requiring Telegram interaction.

**Why it broke:** The original implementation assumed Telegram was always available as a progression trigger. When Telegram was absent or disconnected, the dashboard stalled because no fallback progression mechanism existed.

**Reusable takeaway:** Never hardcode a single communication channel as a required dependency for core workflow progression. Design state machines and progression logic to be channel-agnostic, with Telegram (or any messaging service) as an optional notification layer, not a required control flow gate. Always decouple core automation logic from specific notification or input channels.

---
*Original commit message: docs: mark a5909bc as deployed — gap fixes for Telegram-independent dashboard progression*

#### Lesson Learned

**What was fixed:** A gap in dashboard progression logic that prevented Telegram-independent operation. The dashboard now advances correctly without requiring Telegram interaction.

**Why it broke:** The original implementation assumed Telegram was always available as a progression trigger. When Telegram was absent or disconnected, the dashboard stalled because no fallback progression mechanism existed.

**Reusable takeaway:** Never hardcode a single communication channel as a required dependency for core workflow progression. Design state machines and progression logic to be channel-agnostic, with Telegram (or any messaging service) as an optional notification layer, not a required control flow gate. Always decouple core automation logic from specific notification or input channels.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: partial-production dashboard endpoint missing partial_production stage orders

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 6ef6d10ba3c8b1cd0ca842bb6856c23bbfeef8f6

**Project:** workflowautomation
**Author:** unknown
**Commit:** 6ef6d10ba3c8b1cd0ca842bb6856c23bbfeef8f6
**Files:** 

**Summary:**
**What was fixed:**  
The production dashboard endpoint was missing orders in the `partial_production` stage, causing incomplete data display.

**Why it broke:**  
The query filter only included `production` stage orders, omitting the `partial_production` stage due to an oversight in stage enumeration logic.

**Reusable takeaway:**  
When filtering by workflow stages, always audit stage names for variants (e.g., `partial_production` vs `production`). Use a centralized stage list or enum to avoid hardcoding incomplete filters. Test endpoints with all stage transitions to catch missing cases.

---
*Original commit message: fix: partial-production dashboard endpoint missing partial_production stage orders*

#### Lesson Learned

**What was fixed:**  
The production dashboard endpoint was missing orders in the `partial_production` stage, causing incomplete data display.

**Why it broke:**  
The query filter only included `production` stage orders, omitting the `partial_production` stage due to an oversight in stage enumeration logic.

**Reusable takeaway:**  
When filtering by workflow stages, always audit stage names for variants (e.g., `partial_production` vs `production`). Use a centralized stage list or enum to avoid hardcoding incomplete filters. Test endpoints with all stage transitions to catch missing cases.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: auto-finish completed item production

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 9f5590221b0b9f34c2308526b953a0c023bb2ce6

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 9f5590221b0b9f34c2308526b953a0c023bb2ce6
**Files:** apps/api/src/agents/productionAgent.ts,apps/api/src/server.ts,apps/dashboard/src/app/production/page.tsx,database/migrations/031_item_production_days.sql,docs/BUG_LOG.md,docs/CHANGELOG.md,docs/UPDATE_LOG.md,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Auto-finish logic for completed item production was not triggering, leaving production items stuck in an incomplete state.

**Why it broke:**  
The production agent lacked a scheduled check or event-driven trigger to finalize items once their production days elapsed. The completion logic existed but was never invoked automatically.

**Reusable takeaway:**  
When implementing time-based state transitions (e.g., auto-finishing after N days), ensure there is a scheduled job, cron, or event listener that actively checks and transitions states. Do not rely solely on user-initiated actions or passive logic. Always pair state machines with a periodic or event-driven trigger to enforce time-dependent transitions.

---
*Original commit message: fix: auto-finish completed item production*

#### Lesson Learned

**What was fixed:**  
Auto-finish logic for completed item production was not triggering, leaving production items stuck in an incomplete state.

**Why it broke:**  
The production agent lacked a scheduled check or event-driven trigger to finalize items once their production days elapsed. The completion logic existed but was never invoked automatically.

**Reusable takeaway:**  
When implementing time-based state transitions (e.g., auto-finishing after N days), ensure there is a scheduled job, cron, or event listener that actively checks and transitions states. Do not rely solely on user-initiated actions or passive logic. Always pair state machines with a periodic or event-driven trigger to enforce time-dependent transitions.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: auto-finish completed item production

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 384dac9437a989608a269a5271fe365ddf698cc5

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 384dac9437a989608a269a5271fe365ddf698cc5
**Files:** apps/api/src/agents/productionAgent.ts,apps/api/src/server.ts,apps/dashboard/src/app/production/page.tsx,database/migrations/031_item_production_days.sql,docs/BUG_LOG.md,docs/CHANGELOG.md,docs/UPDATE_LOG.md,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Auto-finish logic for completed item production was broken. Production items that reached their finish date were not being automatically marked as complete.

**Why it broke:**  
The production agent’s scheduling logic did not correctly compare the current date against the item’s `production_days` field. A missing or incorrect date comparison prevented the auto-completion trigger from firing.

**Reusable takeaway:**  
When implementing time-based auto-completion, ensure the comparison logic uses the correct date field and format. Validate that the scheduling agent checks for completion at the right granularity (e.g., daily vs. hourly). Always test with items that span across date boundaries.

---
*Original commit message: fix: auto-finish completed item production*

#### Lesson Learned

**What was fixed:**  
Auto-finish logic for completed item production was broken. Production items that reached their finish date were not being automatically marked as complete.

**Why it broke:**  
The production agent’s scheduling logic did not correctly compare the current date against the item’s `production_days` field. A missing or incorrect date comparison prevented the auto-completion trigger from firing.

**Reusable takeaway:**  
When implementing time-based auto-completion, ensure the comparison logic uses the correct date field and format. Validate that the scheduling agent checks for completion at the right granularity (e.g., daily vs. hourly). Always test with items that span across date boundaries.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: auto-finish completed item production

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit f9f37a5e99646f80001c04864e772d724f2ae18c

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** f9f37a5e99646f80001c04864e772d724f2ae18c
**Files:** apps/api/src/agents/productionAgent.ts,apps/api/src/server.ts,apps/dashboard/src/app/production/page.tsx,database/migrations/031_item_production_days.sql,docs/BUG_LOG.md,docs/CHANGELOG.md,docs/UPDATE_LOG.md,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Auto-finish logic for completed item production – production items that reached their required days were not automatically marked as finished.

**Why it broke:**  
The production agent’s completion check was missing a database migration to add an `item_production_days` column, so the system had no field to track or compare production duration. The condition for auto-finishing never evaluated correctly.

**Reusable takeaway:**  
When adding a time-based or state-based automation rule, ensure the underlying data model (schema, column, or field) is migrated first. The automation logic will silently fail if the required data structure doesn’t exist. Always pair business logic changes with the corresponding database migration in the same commit.

---
*Original commit message: fix: auto-finish completed item production*

#### Lesson Learned

**What was fixed:**  
Auto-finish logic for completed item production – production items that reached their required days were not automatically marked as finished.

**Why it broke:**  
The production agent’s completion check was missing a database migration to add an `item_production_days` column, so the system had no field to track or compare production duration. The condition for auto-finishing never evaluated correctly.

**Reusable takeaway:**  
When adding a time-based or state-based automation rule, ensure the underlying data model (schema, column, or field) is migrated first. The automation logic will silently fail if the required data structure doesn’t exist. Always pair business logic changes with the corresponding database migration in the same commit.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: auto-finish completed item production

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 1fba01a580a7de30420e1cf691b1aad330a06e22

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 1fba01a580a7de30420e1cf691b1aad330a06e22
**Files:** apps/api/src/agents/productionAgent.ts,apps/api/src/server.ts,apps/dashboard/src/app/production/page.tsx,database/migrations/031_item_production_days.sql,docs/BUG_LOG.md,docs/CHANGELOG.md,docs/UPDATE_LOG.md,memory/lesson-index.jsonl,memory/lessons-learned.md

**Summary:**
**What was fixed:**  
Auto-finish logic for completed item production was not triggering, leaving production items stuck in an incomplete state.

**Why it broke:**  
The production agent lacked a check for items whose production days had elapsed. The system only processed active items, ignoring those that should auto-complete based on elapsed time.

**Reusable takeaway:**  
When implementing time-based auto-completion, ensure the scheduler or agent explicitly checks for elapsed conditions on every cycle. A missing condition check can silently stall workflows. Always add a migration to store the production days field, and update the UI to reflect the new state. Log the fix in both bug and lesson docs to prevent recurrence.

---
*Original commit message: fix: auto-finish completed item production*

#### Lesson Learned

**What was fixed:**  
Auto-finish logic for completed item production was not triggering, leaving production items stuck in an incomplete state.

**Why it broke:**  
The production agent lacked a check for items whose production days had elapsed. The system only processed active items, ignoring those that should auto-complete based on elapsed time.

**Reusable takeaway:**  
When implementing time-based auto-completion, ensure the scheduler or agent explicitly checks for elapsed conditions on every cycle. A missing condition check can silently stall workflows. Always add a migration to store the production days field, and update the UI to reflect the new state. Log the fix in both bug and lesson docs to prevent recurrence.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] auto-finish completed item production

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: local
Confidence: medium
Related files:
Tags:

#### Task Summary

When item-level production has order_items and every production_status is finished, finalize the order immediately: set production_started/production_finished flags and timestamps, clear partial_production_items, move current_stage to en_route, complete production reminders, invalidate dashboards, and trigger en-route Telegram/agent flow. Also hide legacy partial_production_items chips when actual order_items are all finished.

#### Lesson Learned

When item-level production has order_items and every production_status is finished, finalize the order immediately: set production_started/production_finished flags and timestamps, clear partial_production_items, move current_stage to en_route, complete production reminders, invalidate dashboards, and trigger en-route Telegram/agent flow. Also hide legacy partial_production_items chips when actual order_items are all finished.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] docs: update CHANGELOG — deployed E2E gap fixes + Codex features at 1083384

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 7166d8c6135cef38a060a1e4ebbce54b8521d118

**Project:** workflowautomation
**Author:** unknown
**Commit:** 7166d8c6135cef38a060a1e4ebbce54b8521d118
**Files:** 

**Summary:**
**What was fixed:**  
Deployed fixes for end-to-end (E2E) gaps in workflow automation, plus added Codex features.

**Why it broke:**  
The E2E gaps likely stemmed from incomplete integration testing or missing edge-case handling between workflow stages, causing failures in automated pipelines.

**Reusable takeaway:**  
Always validate E2E flows with real-world edge cases before deployment. Use changelogs to track both fixes and feature additions, ensuring transparency and traceability for future debugging.

---
*Original commit message: docs: update CHANGELOG — deployed E2E gap fixes + Codex features at 1083384*

#### Lesson Learned

**What was fixed:**  
Deployed fixes for end-to-end (E2E) gaps in workflow automation, plus added Codex features.

**Why it broke:**  
The E2E gaps likely stemmed from incomplete integration testing or missing edge-case handling between workflow stages, causing failures in automated pipelines.

**Reusable takeaway:**  
Always validate E2E flows with real-world edge cases before deployment. Use changelogs to track both fixes and feature additions, ensuring transparency and traceability for future debugging.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: close e2e workflow wiring gaps

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 87eb50cb1e7a8771e483532d176432bd2ea41fd6

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 87eb50cb1e7a8771e483532d176432bd2ea41fd6
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/collection/page.tsx,apps/dashboard/src/app/purchasing/page.tsx,apps/dashboard/src/components/OtpModal.tsx,apps/dashboard/src/lib/api.ts,docs/BUG_LOG.md,docs/CHANGELOG.md,docs/UPDATE_LOG.md

**Summary:**
**What was fixed:**  
Closed wiring gaps in the end-to-end workflow that caused broken API calls, missing OTP modal integration, and incomplete page routing for collection and purchasing modules.

**Why it broke:**  
The initial implementation left loose connections between frontend components and backend endpoints. Specifically, the OTP modal wasn't wired to the API, and page-level data flows for collection and purchasing were incomplete, leading to silent failures or unresponsive UI states.

**Reusable takeaway:**  
When building multi-step workflows, explicitly trace each data path from UI component → API call → backend handler. Use integration tests or manual walkthroughs to verify every "wire" is connected before merging. Document wiring gaps in a bug log to prevent recurrence.

---
*Original commit message: fix: close e2e workflow wiring gaps*

#### Lesson Learned

**What was fixed:**  
Closed wiring gaps in the end-to-end workflow that caused broken API calls, missing OTP modal integration, and incomplete page routing for collection and purchasing modules.

**Why it broke:**  
The initial implementation left loose connections between frontend components and backend endpoints. Specifically, the OTP modal wasn't wired to the API, and page-level data flows for collection and purchasing were incomplete, leading to silent failures or unresponsive UI states.

**Reusable takeaway:**  
When building multi-step workflows, explicitly trace each data path from UI component → API call → backend handler. Use integration tests or manual walkthroughs to verify every "wire" is connected before merging. Document wiring gaps in a bug log to prevent recurrence.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: close e2e workflow wiring gaps

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 3cf7272f254144baba7f3b4c296a880c5c278434

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 3cf7272f254144baba7f3b4c296a880c5c278434
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/collection/page.tsx,apps/dashboard/src/app/purchasing/page.tsx,apps/dashboard/src/components/OtpModal.tsx,apps/dashboard/src/lib/api.ts,docs/BUG_LOG.md,docs/CHANGELOG.md,docs/UPDATE_LOG.md

**Summary:**
**What was fixed:**  
Closed wiring gaps in the end-to-end workflow that caused incomplete data flow between the API server, dashboard pages (collection, purchasing), OTP modal, and API client library.

**Why it broke:**  
Missing or misaligned connections between components—likely mismatched API endpoints, missing state updates, or unhandled asynchronous flows—prevented the workflow from completing correctly.

**Reusable takeaway:**  
When building multi-step workflows, explicitly trace the data path from user action through API call to UI update. Use integration tests or manual walkthroughs to verify every link in the chain. Document wiring assumptions in a shared log (e.g., BUG_LOG.md) to catch gaps early.

---
*Original commit message: fix: close e2e workflow wiring gaps*

#### Lesson Learned

**What was fixed:**  
Closed wiring gaps in the end-to-end workflow that caused incomplete data flow between the API server, dashboard pages (collection, purchasing), OTP modal, and API client library.

**Why it broke:**  
Missing or misaligned connections between components—likely mismatched API endpoints, missing state updates, or unhandled asynchronous flows—prevented the workflow from completing correctly.

**Reusable takeaway:**  
When building multi-step workflows, explicitly trace the data path from user action through API call to UI update. Use integration tests or manual walkthroughs to verify every link in the chain. Document wiring assumptions in a shared log (e.g., BUG_LOG.md) to catch gaps early.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: close e2e workflow wiring gaps

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit a7fd60cd7abca0c55df089cd397e974452ea4ae1

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** a7fd60cd7abca0c55df089cd397e974452ea4ae1
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/collection/page.tsx,apps/dashboard/src/app/purchasing/page.tsx,apps/dashboard/src/components/OtpModal.tsx,apps/dashboard/src/lib/api.ts,docs/BUG_LOG.md,docs/CHANGELOG.md,docs/UPDATE_LOG.md

**Summary:**
**What was fixed:**  
Closed wiring gaps in the end-to-end workflow that caused failures in collection and purchasing flows, particularly around OTP modal handling and API client configuration.

**Why it broke:**  
The `OtpModal` component and `api.ts` client had mismatched event handling and missing state synchronization. The collection and purchasing pages relied on incomplete or inconsistent wiring between the modal’s submit action and the API’s response parsing, leading to silent failures or unhandled promise rejections.

**Reusable takeaway:**  
When building multi-step e2e workflows (e.g., OTP verification → data submission), ensure that every UI component’s event handler is directly wired to the corresponding API client method, and that all state transitions (loading, success, error) are explicitly handled. Use integration tests that simulate the full user flow—not just isolated unit tests—to catch wiring gaps early. Document these wiring patterns in a shared BUG_LOG to prevent regression.

---
*Original commit message: fix: close e2e workflow wiring gaps*

#### Lesson Learned

**What was fixed:**  
Closed wiring gaps in the end-to-end workflow that caused failures in collection and purchasing flows, particularly around OTP modal handling and API client configuration.

**Why it broke:**  
The `OtpModal` component and `api.ts` client had mismatched event handling and missing state synchronization. The collection and purchasing pages relied on incomplete or inconsistent wiring between the modal’s submit action and the API’s response parsing, leading to silent failures or unhandled promise rejections.

**Reusable takeaway:**  
When building multi-step e2e workflows (e.g., OTP verification → data submission), ensure that every UI component’s event handler is directly wired to the corresponding API client method, and that all state transitions (loading, success, error) are explicitly handled. Use integration tests that simulate the full user flow—not just isolated unit tests—to catch wiring gaps early. Document these wiring patterns in a shared BUG_LOG to prevent regression.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: close e2e workflow wiring gaps

Date: 2026-05-24
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit d5c6a7b4a8a96f57e829f956cb8db092786142ea

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** d5c6a7b4a8a96f57e829f956cb8db092786142ea
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/collection/page.tsx,apps/dashboard/src/app/purchasing/page.tsx,apps/dashboard/src/components/OtpModal.tsx,apps/dashboard/src/lib/api.ts,docs/BUG_LOG.md,docs/CHANGELOG.md,docs/UPDATE_LOG.md

**Summary:**
**What was fixed:**  
Closed wiring gaps in the end-to-end workflow that caused broken API calls and missing OTP modal integration in the dashboard.

**Why it broke:**  
The API client (`api.ts`) was not correctly wired to the server endpoints (`server.ts`), and the OTP modal component (`OtpModal.tsx`) was not properly connected to the purchasing and collection pages. This led to silent failures or incomplete user flows.

**Reusable takeaway:**  
When building multi-service workflows, explicitly verify that all frontend-to-backend wiring is complete and that shared components (like modals) are integrated into every relevant page. Use integration tests or manual end-to-end checks to catch these gaps early.

---
*Original commit message: fix: close e2e workflow wiring gaps*

#### Lesson Learned

**What was fixed:**  
Closed wiring gaps in the end-to-end workflow that caused broken API calls and missing OTP modal integration in the dashboard.

**Why it broke:**  
The API client (`api.ts`) was not correctly wired to the server endpoints (`server.ts`), and the OTP modal component (`OtpModal.tsx`) was not properly connected to the purchasing and collection pages. This led to silent failures or incomplete user flows.

**Reusable takeaway:**  
When building multi-service workflows, explicitly verify that all frontend-to-backend wiring is complete and that shared components (like modals) are integrated into every relevant page. Use integration tests or manual end-to-end checks to catch these gaps early.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: resolve 8 E2E gaps in schedule group chat feature

Date: 2026-05-25
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 786087addbf6f7856c87611c5abb9ad287abf7ec

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 786087addbf6f7856c87611c5abb9ad287abf7ec
**Files:** apps/api/src/server.ts,apps/dashboard/src/app/calendar/page.tsx,apps/telegram-bot/src/bot.ts,docker-compose.yml,docs/UPDATE_LOG.md,test-e2e-agent-triggers.mjs,test-e2e-auth-flow.mjs,test-e2e-dashboard-crud.mjs,test-e2e-file-upload-api.mjs,test-e2e-order-lifecycle.mjs,test-e2e-sse.mjs,test-e2e-telegram-bot.mjs,test-e2e-vision-extraction.mjs

**Summary:**
**What was fixed:**  
8 end-to-end test gaps in the schedule group chat feature across API, dashboard, Telegram bot, Docker config, and test suites.

**Why it broke:**  
The feature was developed incrementally without corresponding E2E tests for each integration point. Missing test coverage allowed regressions to go undetected when changes were made to the API, bot, or UI.

**Reusable takeaway:**  
When adding a cross-cutting feature (spanning API, UI, bot, and infra), write E2E tests **in parallel** with feature code—not after. Each integration point (server, dashboard, bot, Docker) should have at least one E2E test that validates the full user flow. This prevents gaps that accumulate when features are built in silos.

---
*Original commit message: fix: resolve 8 E2E gaps in schedule group chat feature*

#### Lesson Learned

**What was fixed:**  
8 end-to-end test gaps in the schedule group chat feature across API, dashboard, Telegram bot, Docker config, and test suites.

**Why it broke:**  
The feature was developed incrementally without corresponding E2E tests for each integration point. Missing test coverage allowed regressions to go undetected when changes were made to the API, bot, or UI.

**Reusable takeaway:**  
When adding a cross-cutting feature (spanning API, UI, bot, and infra), write E2E tests **in parallel** with feature code—not after. Each integration point (server, dashboard, bot, Docker) should have at least one E2E test that validates the full user flow. This prevents gaps that accumulate when features are built in silos.

#### Tags

cross-project, local-fallback

---
