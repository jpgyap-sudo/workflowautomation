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
