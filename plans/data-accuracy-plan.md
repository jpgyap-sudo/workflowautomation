# Date Accuracy Plan — Complete Risk-Free Implementation

## Core Principle: The date field is ALWAYS optional

Users who click buttons immediately = no change (uses NOW())
Users who input late = can back-date (uses chosen date)

**NO BREAKING CHANGES TO ANY WORKFLOW.**

---

## Phase 1: All Touchpoints Mapped

Here is every single place a date gets recorded. Each one gets an optional date field:

### A. `production_started_at` — 3 touchpoints

| # | Where | Current Code | Change |
|---|-------|-------------|--------|
| 1 | `POST /orders/:id/set-production?production_started=true` | `COALESCE(production_started_at, NOW())` | Accept optional `started_at` body param |
| 2 | `produce:yes` Telegram callback → calls same API | Sends `{production_started:true}` | Bot asks date first, sends `started_at` |
| 3 | Dashboard "Start Production" button → calls same API | Sends action_token | Dashboard date picker added |

### B. `production_finished_at` — 2 touchpoints

| # | Where | Current Code | Change |
|---|-------|-------------|--------|
| 1 | `POST /orders/:id/finish-production` | `production_finished_at = NOW()` | Accept optional `finished_at` body param |
| 2 | `finish-all-items` & `finish-selected-items` endpoints | `COALESCE(production_finished_at, NOW())` | Accept optional `finished_at` body param |

### C. `en_route_confirmed_at` — 2 touchpoints

| # | Where | Current Code | Change |
|---|-------|-------------|--------|
| 1 | `POST /orders/:id/confirm-en-route` | `en_route_confirmed_at = NOW()` | Accept optional `confirmed_at` body param |
| 2 | `en_route:yes` Telegram callback → calls same API | Just asks for arrival days | Bot asks date first (optional) |

### D. `delivery_date` — 1 touchpoint

| # | Where | Current Code | Change |
|---|-------|-------------|--------|
| 1 | Dashboard delivery scheduling | Separate date field already | Already has date picker — no change needed |

---

## Phase 2: Telegram Bot Flow (No Breaking Changes)

### Current flow:
```
User taps "Yes, started"
  → Bot asks "How many days?"
  → User picks 28 or custom
  → API: production_started=true, estimated_production_days=X
  → production_started_at = NOW()  ← THE PROBLEM
```

### New flow (optional date):
```
User taps "Yes, started"
  → Bot asks "How many days?"  ← SAME AS BEFORE
  → User picks 28 or custom
  → Bot asks "When did it start?"  ← NEW, OPTIONAL
     [📅 Today] [📅 Yesterday] [📅 Custom...] [Skip]
  → If skipped: production_started_at = NOW()  ← ORIGINAL BEHAVIOR
  → If picked:  production_started_at = chosen_date
```

**Key:** The "Skip" button preserves exact original behavior. Nobody is forced to use this.

---

## Phase 3: No Backend Changes Needed (Minimal)

The backend already uses `COALESCE(production_started_at, NOW())` which means:
- If `started_at` is provided → use it
- If `started_at` is null → default to NOW()

We just need to add ONE line per endpoint:

```diff
// server.ts line 2192
- setClauses.push(`production_started_at = COALESCE(production_started_at, NOW())`);
+ if (body.started_at) {
+   setClauses.push(`production_started_at = $${idx++}`);
+   values.push(body.started_at);
+ } else {
+   setClauses.push(`production_started_at = COALESCE(production_started_at, NOW())`);
+ }
```

That's it. Same pattern for finish-production, confirm-en-route.

---

## Phase 4: Risk Assessment — NOTHING WILL BREAK

| Concern | Why it's safe |
|---------|--------------|
| Existing reminders | Reminders use `next_run_at`, not `production_started_at`. No change. |
| Gantt chart | Uses `projected_lead_time_started_at`, not production dates. No change. |
| Dashboard views | Already date-agnostic — shows whatever date is stored. |
| Calendar events | Uses `production_started_at` directly — will show corrected date. |
| Agent scheduler | Checks `current_stage` boolean, not timestamps. No change. |
| Escalation logic | Checks escalation_level counter, not dates. No change. |
| Stage-updates audit | Records `updated_at` = API call time (correct). Date override only affects order table. |
| existing data | `COALESCE` preserves existing dates — cannot overwrite. |
| Users who skip date | `started_at` is null → falls through to `NOW()` = current behavior. |

---

## Phase 5: Implementation Plan

```
Phase 1 (~30 min): Backend
  └─ Add optional started_at to set-production endpoint (1 line change)
  └─ Add optional finished_at to finish-production endpoint (1 line change)
  └─ Add optional confirmed_at to confirm-en-route endpoint (1 line change)

Phase 2 (~45 min): Telegram Bot
  └─ After user picks production days → ask "When did it start?"
  └─ Store choice in session → pass to API call
  └─ Same for en_route confirmation

Phase 3 (~30 min): Dashboard
  └─ Add date input to production start modal
  └─ Add date input to en route confirmation
  └─ Add date input to finish production

Total: ~2 hours. Zero breaking changes.
```
