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
