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
| 2026-05-20 | DELETE /orders/:id uses wrong table name | SQL references `order_files` instead of `files`. | [`4f4f380`](https://github.com/jpgyap-sudo/workflowautomation/commit/4f4f380) — correct table name. | Roo (Code) | ✅ Verified |
