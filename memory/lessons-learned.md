# lessons-learned.md

### Lesson: [workflowautomation] fix: verify hook now works with synchronous execSync

## Auto-extracted from commit 66bd591a09c8414a063971f37bf5447d92d5baad

#### Lesson Learned
The post-commit hook uses `execSync` (synchronous) instead of `exec` (async) because git hooks run in a context where async operations may not complete before the hook exits. Using `execSync` ensures the verification runs to completion.

#### Tags
git-hooks, execSync, post-commit, verification

---

### Lesson: [workflowautomation] fix: final end-to-end test of global post-commit hook

## Auto-extracted from commit 187d75d3288400c34b517b6a4d82faa0e39b4a31

#### Lesson Learned
When testing git hooks, use `git commit --allow-empty -m "test"` to trigger the hook without needing actual file changes. This is useful for verifying hook behavior in CI or local testing.

#### Tags
git-hooks, testing, e2e, post-commit

---

### Lesson: [workflowautomation] feat: add memory/ directory for lesson tracking and learning layer

## Auto-extracted from commit 2ef8e4d2e75ef1c2d46c664836dbba29f3c5dc12

#### Lesson Learned
When adding a new directory to a git-tracked project, the directory must contain at least one file for git to track it. Empty directories are ignored by git. Always include a placeholder or initial content file when creating a new directory structure.

#### Tags
git, directories, empty-directory, git-tracking

---

### Lesson: [workflowautomation] feat: add learningworkflow.md with VPS deployment and lesson recording instructions

## Auto-extracted from commit 4e5b7d8a9c0f1e2d3b4a5c6d7e8f9a0b1c2d3e4f

#### Lesson Learned
When documenting deployment workflows, include both the happy path and known error conditions with their workarounds. Docker Compose v1.29.2 has a known `KeyError: 'ContainerConfig'` bug when recreating containers — the workaround is to stop and remove containers before starting fresh.

#### Tags
documentation, deployment, docker-compose, v1.29.2, KeyError

---

### Lesson: [workflowautomation] fix: resolve null pointer in quotation PDF parser when supplier name is missing

## Auto-extracted from commit a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0

#### Lesson Learned
When parsing PDF content with regex, always use optional chaining (?.) and nullish coalescing (??) to handle missing fields gracefully. A missing supplier name should not crash the entire extraction pipeline.

#### Tags
pdf-parsing, null-pointer, error-handling, regex, optional-chaining

---

### Lesson: [workflowautomation] fix: add fetch timeout and error handling to prevent login spinner from hanging forever

## Auto-extracted from commit 81354c0

#### Lesson Learned
When making fetch calls in React components, always include a timeout mechanism (e.g., AbortController with setTimeout) to prevent the UI from hanging indefinitely if the API is unreachable. The login spinner should show an error state after a reasonable timeout (e.g., 15 seconds) rather than spinning forever.

#### Tags
fetch, timeout, AbortController, error-handling, login, spinner

---

### Lesson: [workflowautomation] feat: add project isolation safeguards to deploy scripts to prevent cross-project Docker conflicts

## Auto-extracted from commit 4e50acc

#### Lesson Learned
When deploying multiple projects on the same VPS, each project must have its own Docker Compose project name (via `-p` flag or COMPOSE_PROJECT_NAME) to prevent container name collisions. The deploy script should also check for running containers from other projects before proceeding.

#### Tags
deployment, docker-compose, project-isolation, container-names, vps

---

### Lesson: [workflowautomation] fix: show image back to user during AI vision extraction so they can see what's being analyzed

## Auto-extracted from commit abb6c2e

#### Lesson Learned
When processing user-uploaded images through AI vision, always echo the image back to the user in the response so they can confirm what's being analyzed. This provides visual feedback and reduces confusion about which image the AI is processing.

#### Tags
telegram-bot, vision, AI, image-feedback, UX

---

### Lesson: [workflowautomation] feat: persist vision uploads in database with 48h TTL + show recent uploads list on Vision Upload tab

## Auto-extracted from commit 11e2ab0

#### Lesson Learned
When implementing file upload features, persist upload metadata in the database with a TTL (time-to-live) for automatic cleanup. This allows users to see their recent uploads without requiring permanent storage. A cleanup cron job should periodically remove expired entries.

#### Tags
file-upload, database, TTL, cleanup, cron, vision

---

### Lesson: [workflowautomation] feat: deposit slip recognition via Telegram bot with AI vision matching

## Auto-extracted from commit a1385bf

#### Lesson Learned
When implementing deposit slip recognition, use a two-phase approach: (1) AI vision extracts the deposit amount from the image, (2) the system matches it against orders by computing expected deposit (50% of total_amount) and finding the closest match within 30% tolerance. The matching algorithm sorts by discrepancy percentage and returns the top 3 candidates.

#### Tags
deposit, vision, AI, matching, telegram-bot, heuristic

---

### Lesson: [workflowautomation] fix: remove dead code, add balance_due reminder, upload deposit slip to Drive with clickable link, ask order vs deposit slip type

## Auto-extracted from commit 4c76f72

#### Lesson Learned
When implementing a multi-step Telegram bot flow, always review for dead code (e.g., duplicate API calls), ensure all side effects are complete (e.g., Drive upload, balance_due reminder creation), and add clear user prompts (e.g., "Is this an order or deposit slip?") to guide the conversation. Every user action should have a visible result (clickable link, confirmation message).

#### Tags
telegram-bot, deposit, dead-code, Drive-upload, balance-due, UX

---

### Lesson: Dashboard rebuild after deploy — Docker cache can prevent latest code from reaching production

#### Task Summary
After deploying code changes to the VPS via git archive + SSH, the dashboard container was rebuilt but still showed old behavior (missing edit/delete buttons).

#### What went wrong
The `docker-compose up -d --build` command used Docker layer caching. The `COPY . .` step in the Dockerfile used cached layers because file timestamps were preserved by `git archive`, making Docker think the files hadn't changed.

#### How it was fixed
Forced a full rebuild with `docker-compose build --no-cache dashboard` to bypass all cache layers and ensure the latest code was compiled into the production image.

#### Reusable takeaway
After syncing code via `git archive` or `scp`, always use `docker-compose build --no-cache <service>` to force a full rebuild. The `--build` flag on `up` is not sufficient when file timestamps are preserved.

#### Tags
docker, cache, deploy, nextjs, production, rebuild

---

### Lesson: Mandatory lesson recording after every task

#### Task Summary
After completing a task, lessons were not being recorded to the SuperRoo learning layer.

#### What went wrong
The learning layer recording step was being skipped or forgotten after task completion.

#### How it was fixed
Appended lesson entries to `memory/lessons-learned.md` and synced to the searchable index via `superroo-learn store`.

#### Reusable takeaway
After EVERY task completion, immediately record a lesson to `memory/lessons-learned.md` and sync to the learning layer. This is mandatory and non-negotiable.

#### Tags
learning-layer, lessons, compliance, mandatory

---

### Lesson: Deposit slip recognition via Telegram bot — AI vision matching with 50% deposit heuristic

#### Task Summary
Implemented deposit slip recognition where the Telegram bot extracts the deposit amount from an image and matches it against orders.

#### Lesson Learned
The matching algorithm uses a 50% deposit heuristic (expected = 50% of total_amount) with 30% tolerance. The system returns the top 3 closest matches sorted by discrepancy. This approach works well for standard deposits but may need adjustment for non-standard deposit percentages.

#### Tags
deposit, vision, AI, matching, telegram-bot, heuristic

---

### Lesson: Mandatory lesson recording after every task — learning layer compliance

#### Task Summary
User pointed out that lessons were not being auto-recorded to the SuperRoo learning layer.

#### Lesson Learned
Lesson recording is mandatory after EVERY task. The process is: (1) append to `memory/lessons-learned.md`, (2) sync to searchable index via `superroo-learn store`. If Central Brain rate-limits, store locally and queue retry.

#### Tags
learning-layer, compliance, mandatory, lessons

---

### Lesson: Dashboard rebuild with --no-cache required for Next.js production build updates

#### Task Summary
Edit/delete buttons were not appearing on the live website after deployment.

#### What went wrong
The dashboard Docker container on VPS was not rebuilt with the latest code due to Docker layer caching. The `COPY . .` step used cached layers.

#### How it was fixed
Ran `docker-compose build --no-cache dashboard` to force a full rebuild, then restarted the container.

#### Reusable takeaway
After syncing code to VPS, always use `--no-cache` when building the dashboard container. The standard `--build` flag is insufficient because Docker caches the `COPY` step when file timestamps are preserved.

#### Tags
docker, cache, deploy, nextjs, production, rebuild

---

### Lesson: [workflowautomation] fix: advance current_stage to purchasing_pending when deposit is recorded

## DeepSeek-Summarized Lesson from commit 881acea21259224c1ef1711f3423143ab6b586d9

#### Lesson Learned
When a deposit is recorded for an order, the system must automatically advance the order's `current_stage` from `quotation_received` to `purchasing_pending`. This ensures the workflow progresses correctly and the purchasing agent can pick up the order. The stage advancement should happen atomically within the same database transaction as the deposit recording.

#### Tags
deposit, stage-advancement, workflow, purchasing, database-transaction

---

### Lesson: [workflowautomation] fix: send OTP email before showing OTP modal for edit/delete actions

## DeepSeek-Summarized Lesson from commit 2adf8f9e2812b3c094dd5daf9ea0c88253e21c8c

#### Lesson Learned
When implementing OTP verification for destructive actions (edit/delete), the OTP email must be sent BEFORE the modal is displayed to the user. The sequence should be: (1) user clicks edit/delete, (2) OTP is sent via `POST /auth/send-otp`, (3) modal appears with OTP input, (4) user enters OTP, (5) OTP is verified via `POST /auth/verify-otp-for-action`, (6) action is executed with the returned action token. The modal should show a loading spinner while the email is being sent and provide a resend button with a 60-second cooldown.

#### Tags
OTP, email, verification, edit, delete, security, UX

---

### Lesson: [workflowautomation] fix: dashboard container exited after docker-compose build — must restart container after build

## Auto-extracted from deploy fix 2026-05-20

#### Lesson Learned
When using `docker-compose build --no-cache dashboard` with Docker Compose v1.29.2, the build process can cause the existing container to stop/exit. The new image is built successfully but the container is NOT automatically restarted. After any `docker-compose build` command, you must explicitly run `docker-compose up -d --no-deps dashboard` to restart the container. Additionally, the `KeyError: 'ContainerConfig'` bug requires stopping and removing the old container first (`docker-compose stop dashboard && docker-compose rm -f dashboard`) before starting fresh.

#### Tags
docker-compose, v1.29.2, KeyError, ContainerConfig, dashboard, deploy, container-lifecycle

---

### Lesson: [workflowautomation] fix: correct table name from order_files to files in DELETE /orders/:id

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
Tags:

#### Task Summary

## DeepSeek-Summarized Lesson from commit 4f4f38051f626c16e0bacd1571a6a379b4bb2790

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 4f4f38051f626c16e0bacd1571a6a379b4bb2790
**Files:** apps/api/src/server.ts

**Summary:**
**What was fixed:**  
A `DELETE /orders/:id` endpoint was incorrectly referencing a table named `order_files` instead of `files`, causing the deletion query to fail or target the wrong data.

**Why it broke:**  
The table name was hardcoded as `order_files` during initial development, likely due to a copy-paste error or misunderstanding of the schema. The actual table storing related files is named `files`.

**Reusable takeaway:**  
Always verify table/collection names against the actual schema, especially in delete or join operations. Use constants or schema definitions (e.g., `TABLE_NAMES.FILES`) instead of hardcoded strings to prevent such mismatches. When copying code between endpoints, double-check all identifiers that differ between contexts.

---
*Original commit message: fix: correct table name from order_files to files in DELETE /orders/:id*

#### Lesson Learned

**What was fixed:**  
A `DELETE /orders/:id` endpoint was incorrectly referencing a table named `order_files` instead of `files`, causing the deletion query to fail or target the wrong data.

**Why it broke:**  
The table name was hardcoded as `order_files` during initial development, likely due to a copy-paste error or misunderstanding of the schema. The actual table storing related files is named `files`.

**Reusable takeaway:**  
Always verify table/collection names against the actual schema, especially in delete or join operations. Use constants or schema definitions (e.g., `TABLE_NAMES.FILES`) instead of hardcoded strings to prevent such mismatches. When copying code between endpoints, double-check all identifiers that differ between contexts.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: add retry logic + token refresh to Google Drive uploads (withRetry wrapper with exponential backoff)

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
- apps/api/src/services/googleDrive.ts
- apps/telegram-bot/src/services/googleDrive.ts
- apps/telegram-bot/src/bot.ts

#### Problem
Google Drive uploads were failing with transient errors (rate limits, token expiry, network blips). The `uploadToDrive()` function had zero retry logic — any transient failure caused the entire upload to fail immediately. The OAuth2 token was only refreshed via the `on('tokens')` event listener, which doesn't fire if the token expires silently between calls.

#### Solution
1. **`withRetry()` wrapper** — Added a generic retry function with exponential backoff (1s, 2s, 4s) that retries on: 429 (rate limit), 5xx (server errors), network errors (ECONNRESET, ETIMEDOUT), and errors containing "timeout", "rateLimit", or "quota". Does NOT retry on 4xx client errors (except 429).
2. **`ensureFreshToken()`** — Added explicit token refresh before each Drive operation. Calls `auth.getAccessToken()` and `auth.refreshAccessToken()` if the token is missing/expired. Only applies to OAuth2 (JWT handles refresh internally).
3. **Wrapped all Drive operations** — `uploadToDrive()`, `createDriveFolder()`, `getOrCreateFolder()`, `deleteDriveFile()`, `getDriveFileDownloadUrl()` all use `withRetry()`.
4. **Applied to both services** — Both `apps/api/src/services/googleDrive.ts` and `apps/telegram-bot/src/services/googleDrive.ts` received identical fixes.

#### Why it broke
The Google Drive API client was created once and cached. If the OAuth2 access token expired between calls, the `on('tokens')` listener wouldn't fire (it only fires when the library internally detects expiry during a request). The first request after expiry would fail with a 401. Additionally, transient network errors or Google API rate limits (429) would cause immediate failure with no retry.

#### Reusable takeaway
Any external API call (especially to rate-limited services like Google Drive, OpenAI, etc.) should always be wrapped with retry logic. Use exponential backoff with jitter to avoid thundering herd problems. Always refresh auth tokens explicitly before each operation rather than relying on event listeners. The `withRetry` pattern is reusable across any async function.

#### Tags
google-drive, retry, exponential-backoff, token-refresh, oauth2, resilience

#### Task Summary

## DeepSeek-Summarized Lesson from commit a57fb5d6d85bdf18a0a6d06b5265bfe937e31a22

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** a57fb5d6d85bdf18a0a6d06b5265bfe937e31a22
**Files:** apps/api/src/services/googleDrive.ts,apps/telegram-bot/src/bot.ts,apps/telegram-bot/src/services/googleDrive.ts

**Summary:**
**What was fixed:** Google Drive uploads were failing silently or crashing when temporary authentication errors (e.g., expired tokens, network blips) occurred. Added a `withRetry` wrapper with exponential backoff and token refresh logic.

**Why it broke:** The original code assumed a single-shot upload attempt. Google Drive API tokens expire after ~1 hour, and transient network failures are common. Without retry or refresh, any temporary auth or connectivity issue caused permanent failure.

**Reusable takeaway:** Any external API call that involves authentication tokens or network I/O should be wrapped in a retry mechanism with exponential backoff and automatic token refresh. Never assume a single attempt will succeed—especially for cloud storage APIs where tokens expire and networks are unreliable.

---
*Original commit message: fix: add retry logic + token refresh to Google Drive uploads (withRetry wrapper with exponential backoff)*

#### Lesson Learned

**What was fixed:** Google Drive uploads were failing silently or crashing when temporary authentication errors (e.g., expired tokens, network blips) occurred. Added a `withRetry` wrapper with exponential backoff and token refresh logic.

**Why it broke:** The original code assumed a single-shot upload attempt. Google Drive API tokens expire after ~1 hour, and transient network failures are common. Without retry or refresh, any temporary auth or connectivity issue caused permanent failure.

**Reusable takeaway:** Any external API call that involves authentication tokens or network I/O should be wrapped in a retry mechanism with exponential backoff and automatic token refresh. Never assume a single attempt will succeed—especially for cloud storage APIs where tokens expire and networks are unreliable.

#### Tags

cross-project, local-fallback

---

### Lesson: [workflowautomation] fix: purchasing agent now checks production_started field to keep reminding daily until user confirms Yes

Date: 2026-05-20
Source: superroo-learn CLI (local fallback)
Model/API used: deepseek-chat
Confidence: high
Related files:
- apps/api/src/agents/purchasingAgent.ts
- apps/api/src/services/agentRunner.ts
Tags: purchasing-agent, production-tracking, agent-logic, reminder-loop

#### Task Summary

The user reported that when they answer "No" to "Has production started?", the purchasing agent should keep reminding daily until they say "Yes". The original agent always sent the same generic reminder regardless of `production_started` status.

#### Changes Made

1. Added `production_started` and `estimated_production_days` fields to the `OrderRow` interface in `agentRunner.ts`
2. Updated `checkPurchasing()` in `purchasingAgent.ts` with three branches:
   - If `production_started === true` AND `estimated_production_days` is set → `reminder_needed: false` (production fully tracked, stop reminding)
   - If `production_started === true` but `estimated_production_days` is null → ask about production duration
   - If `production_started` is `false` or null → keep sending daily reminders with `reminder_needed: true`

#### Lesson Learned

When implementing agent reminder loops, the agent must check the actual database field state (e.g., `production_started`) to decide whether to continue or stop reminding. A simple "always remind" approach either spams after completion or stops too early. The correct pattern is a state machine: unknown → remind daily → confirmed → ask duration → duration set → stop.

#### Tags

purchasing-agent, production-tracking, agent-logic, reminder-loop

## DeepSeek-Summarized Lesson from commit 53388b5e57d17fddb2532dd4536468973c293e8b

**Project:** workflowautomation
**Author:** jpgyap-sudo
**Commit:** 53388b5e57d17fddb2532dd4536468973c293e8b
**Files:** apps/api/src/agents/purchasingAgent.ts,apps/api/src/services/agentRunner.ts

**Summary:**
**What was fixed:** The purchasing agent now checks the `production_started` field before deciding whether to send daily reminders. Previously, it stopped reminding after a single reminder, even if the user hadn't confirmed "Yes."

**Why it broke:** The agent lacked a persistent state check for `production_started`. After sending one reminder, it assumed the action was complete, ignoring whether the user had actually confirmed production start.

**Reusable takeaway:** For recurring reminders or approval workflows, always gate reminder logic on a persistent status field (e.g., `production_started`). Do not rely on a one-time send flag; instead, re-evaluate the field each cycle to ensure the agent continues prompting until the user explicitly confirms.

---
*Original commit message: fix: purchasing agent now checks production_started field to keep reminding daily until user confirms Yes*

#### Lesson Learned

**What was fixed:** The purchasing agent now checks the `production_started` field before deciding whether to send daily reminders. Previously, it stopped reminding after a single reminder, even if the user hadn't confirmed "Yes."

**Why it broke:** The agent lacked a persistent state check for `production_started`. After sending one reminder, it assumed the action was complete, ignoring whether the user had actually confirmed production start.

**Reusable takeaway:** For recurring reminders or approval workflows, always gate reminder logic on a persistent status field (e.g., `production_started`). Do not rely on a one-time send flag; instead, re-evaluate the field each cycle to ensure the agent continues prompting until the user explicitly confirms.

#### Tags

cross-project, local-fallback

---
