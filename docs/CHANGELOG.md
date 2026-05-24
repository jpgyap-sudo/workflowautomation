# Changelog

> Unified commit & deployment log for all coding extensions working on this project.
> Each entry records: **commit hash**, **date**, **authoring extension**, **description**, and **deployment status**.

---

## 2026-05-24

| Commit | Extension | Description | Deployed |
|--------|-----------|-------------|----------|
| `pending` | Codex | chore: record OTP 502 recovery lessons and logs | ✅ Not deployed (docs/memory only; VPS recovery already verified) |
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
