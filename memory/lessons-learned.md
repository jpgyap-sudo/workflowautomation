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
