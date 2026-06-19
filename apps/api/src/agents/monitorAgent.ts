import { query } from '../db.js';
import { logAgentAction, type AgentResult, sendTelegramMessage } from '../services/agentRunner.js';
import { cacheClient } from '../cache.js';
import type { HermesProductionContext } from '../services/hermesClaw.js';

// ── Types ──────────────────────────────────────────────────────────────

interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    name: string;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
    value?: number | string;
  }[];
  score: number; // 0–100
}

interface WiringGap {
  type: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  description: string;
  order_reference?: string;
  suggestion?: string;
}

// ── Run Thresholds ─────────────────────────────────────────────────────

const MAX_AGENT_ERRORS_24H = 3;
const MAX_STUCK_ORDER_DAYS = 7;
const MAX_STUCK_ORDER_DAYS_CRITICAL = 14;
const MAX_RECENT_BUG_REPORTS_OPEN = 15;
const HERMES_MAX_ANALYSIS = 3;        // Max stuck orders to AI-analyze per run
const DEDUP_HOURS = 24;               // Don't re-report same gap type+order within this window
const RATE_LIMIT_WINDOW_MS = 60_000;  // 1 minute rate limit window for ingest
const RATE_LIMIT_MAX_PER_IP = 30;     // Max ingest requests per minute per IP

// ── Main Entry Point ───────────────────────────────────────────────────

export async function runMonitorAgent(): Promise<AgentResult[]> {
  const results: AgentResult[] = [];
  const gaps: WiringGap[] = [];
  const startTime = Date.now();
  const escChatId = process.env.ESCALATION_GROUP_CHAT_ID ?? null;

  try {
    // Phase 1: System Health Checks
    await safelyRun(() => checkSystemHealth(), 'checkSystemHealth', gaps);
    // Phase 2: Agent Error Patterns
    await safelyRun(() => checkAgentErrors(), 'checkAgentErrors', gaps);
    // Phase 3: Stuck Orders (with stage_entry time)
    const stuckOrders = await safelyRun(() => checkStuckOrders(), 'checkStuckOrders', gaps);
    // Phase 4: Wiring Gaps (data inconsistencies)
    await safelyRun(() => checkWiringGaps(), 'checkWiringGaps', gaps);
    // Phase 5: Client-Side Error Clustering
    await safelyRun(() => checkErrorClusters(), 'checkErrorClusters', gaps);
    // Phase 6: HermesClaw AI analysis for critical stuck orders
    if (stuckOrders.critical && stuckOrders.critical.length > 0) {
      await safelyRun(
        () => analyzeStuckWithHermes(stuckOrders.critical!.slice(0, HERMES_MAX_ANALYSIS)),
        'hermesClawAnalysis',
        gaps,
      );
    }
    // Phase 7: Performance Trend (compare against previous snapshot)
    await safelyRun(() => checkTrend(), 'checkTrend', gaps);

    // Calculate summary metrics
    const criticalCount = gaps.filter((g) => g.severity === 'critical').length;
    const errorCount = gaps.filter((g) => g.severity === 'error').length;
    const warningCount = gaps.filter((g) => g.severity === 'warning').length;
    const infoCount = gaps.filter((g) => g.severity === 'info').length;
    const hasCritical = criticalCount > 0;

    // ── Phase 8: Create Bug Reports (with dedup) ──────────────────────
    const gapIds = await reportGaps(gaps);

    // ── Phase 9: Telegram notification for critical findings ──────────
    if (hasCritical && escChatId) {
      await sendCriticalTelegram(escChatId, gaps, healthScoreFromChecks(gaps));
    }

    // ── Phase 10: Record Snapshot (warnings as JSONB string) ──────────
    const snapshotId = await recordSnapshot(gaps, criticalCount, errorCount, warningCount);

    // ── Build Result ──────────────────────────────────────────────────
    const health = healthScoreFromChecks(gaps);
    const summary = buildSummary(gaps, startTime, criticalCount, errorCount, warningCount, infoCount);
    const input = { gaps_found: gaps.length, health_score: health.score, snapshot_id: snapshotId, gap_ids: gapIds };

    await logAgentAction('monitor-agent', input, { summary, gaps, health }, 'success');

    results.push({
      status: hasCritical || gaps.length > 3 ? 'needs_review' : 'ok',
      message: summary,
      next_stage: null,
      reminder_needed: false,
      escalation_level: hasCritical ? 2 : 0,
    });

    return results;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[MonitorAgent] Fatal error:', errorMsg);
    await logAgentAction('monitor-agent', { phase: 'fatal' }, { error: errorMsg }, 'error', undefined, errorMsg);
    throw err;
  }
}

// ── Safe Runner: wraps each phase so one failure doesn't kill the run ──

async function safelyRun(
  fn: () => Promise<WiringGap[] | { warnings: WiringGap[]; critical: WiringGap[] }>,
  phase: string,
  gaps: WiringGap[],
): Promise<{ warnings: WiringGap[]; critical: WiringGap[] }> {
  try {
    const result = await fn();
    if (Array.isArray(result)) {
      for (const g of result) gaps.push(g);
      return { warnings: result.filter((r) => r.severity !== 'critical'), critical: result.filter((r) => r.severity === 'critical') };
    }
    // Already has the shape {warnings, critical}
    return result;
  } catch (err) {
    console.error(`[MonitorAgent] Phase "${phase}" failed:`, err);
    gaps.push({
      type: 'phase_error',
      severity: 'error',
      title: `Monitor phase "${phase}" crashed`,
      description: `Phase ${phase} threw: ${err instanceof Error ? err.message : String(err)}`,
      suggestion: 'Check monitor agent logs and agent configuration.',
    });
    return { warnings: [], critical: [] };
  }
}

// ── Phase 1: System Health ─────────────────────────────────────────────

async function checkSystemHealth(): Promise<WiringGap[]> {
  const gaps: WiringGap[] = [];

  // 1a. Database connectivity
  try {
    const dbStart = Date.now();
    await query('SELECT 1 AS ok');
    const dbMs = Date.now() - dbStart;
    if (dbMs > 1000) {
      gaps.push({
        type: 'system_health',
        severity: 'warning',
        title: 'Slow database response',
        description: `Database query took ${dbMs}ms (>1s threshold)`,
        suggestion: 'Check database load and connection pool size.',
      });
    }
  } catch (err) {
    gaps.push({
      type: 'system_health',
      severity: 'critical',
      title: 'Database unreachable',
      description: `Database connection failed: ${err instanceof Error ? err.message : String(err)}`,
      suggestion: 'Restart PostgreSQL container and check credentials.',
    });
  }

  // 1b. Redis connectivity
  if (!cacheClient?.isOpen) {
    gaps.push({
      type: 'system_health',
      severity: 'warning',
      title: 'Redis unavailable',
      description: 'Redis caching is disabled — dashboard performance may degrade.',
      suggestion: 'Check Redis container and connection string.',
    });
  }

  // 1c. Agent error rates in last 24h
  const agentErrors = await query<{ agent_name: string; error_count: number; last_error: string | null }>(
    `SELECT agent_name, COUNT(*) AS error_count,
            MAX(created_at)::TEXT AS last_error
     FROM agent_logs
     WHERE status = 'error' AND created_at > NOW() - INTERVAL '24 hours'
     GROUP BY agent_name
     ORDER BY error_count DESC
     LIMIT 20`
  );
  for (const a of agentErrors) {
    gaps.push({
      type: 'system_health',
      severity: a.error_count >= MAX_AGENT_ERRORS_24H ? 'error' : 'warning',
      title: `Agent "${a.agent_name}" has ${a.error_count} errors in 24h`,
      description: `Agent ${a.agent_name} failed ${a.error_count} time(s). Last error at ${a.last_error ?? 'unknown'}`,
      suggestion: `Review agent_logs for ${a.agent_name}. Check dependencies and input data.`,
    });
  }

  // 1d. Open bug reports count
  const openBugs = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM bug_reports WHERE status IN ('open', 'in_progress')`
  );
  if (openBugs[0]?.cnt > MAX_RECENT_BUG_REPORTS_OPEN) {
    gaps.push({
      type: 'system_health',
      severity: 'warning',
      title: `${openBugs[0].cnt} open bug reports — needs triage`,
      description: `There are ${openBugs[0].cnt} unresolved bug reports. Consider reviewing and assigning them.`,
      suggestion: 'Triage open bug reports and close resolved ones.',
    });
  }

  // 1e. API HTTP endpoint health
  try {
    const apiBase = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? '8080'}`;
    const resp = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) {
      gaps.push({
        type: 'system_health',
        severity: 'error',
        title: 'API health endpoint degraded',
        description: `GET /health returned ${resp.status} ${resp.statusText}`,
        suggestion: 'Check API server logs and process status.',
      });
    }
  } catch (err) {
    gaps.push({
      type: 'system_health',
      severity: 'critical',
      title: 'API health endpoint unreachable',
      description: `Could not reach /health: ${err instanceof Error ? err.message : String(err)}`,
      suggestion: 'API server may be down. Check Docker container and restart if needed.',
    });
  }

  return gaps;
}

// ── Phase 2: Agent Error Patterns ───────────────────────────────────────

async function checkAgentErrors(): Promise<WiringGap[]> {
  const gaps: WiringGap[] = [];

  const errorAgents = await query<{ agent_name: string; error_count: number; sample_error: string }>(
    `SELECT agent_name, COUNT(*) AS error_count,
            (STRING_AGG(LEFT(COALESCE(error, ''), 300), ' | ' ORDER BY created_at DESC)) AS sample_error
     FROM agent_logs
     WHERE status = 'error' AND created_at > NOW() - INTERVAL '24 hours'
     GROUP BY agent_name
     HAVING COUNT(*) >= $1
     ORDER BY error_count DESC`,
    [MAX_AGENT_ERRORS_24H]
  );

  for (const agent of errorAgents) {
    const severity = agent.error_count >= MAX_AGENT_ERRORS_24H * 2 ? 'critical' : 'error';
    gaps.push({
      type: 'agent_errors',
      severity,
      title: `Agent "${agent.agent_name}" — ${agent.error_count} errors in 24h`,
      description: `Agent ${agent.agent_name} has ${agent.error_count} errors in 24h. Sample: ${(agent.sample_error ?? '').substring(0, 500)}`,
      suggestion: `Check agent ${agent.agent_name} configuration, dependencies, and input data.`,
    });
  }

  return gaps;
}

// ── Phase 3: Stuck Orders (using stage_updates for accurate dwell time) ─

async function checkStuckOrders(): Promise<WiringGap[]> {
  const gaps: WiringGap[] = [];

  // Use stage_updates.created_at instead of orders.updated_at for accurate
  // per-stage dwell time. Falls back to orders.updated_at if no stage_updates entry.
  const stuckOrders = await query<{
    id: string;
    quotation_number: string | null;
    client_name: string | null;
    current_stage: string;
    days_stuck: number;
  }>(
    `SELECT o.id, o.quotation_number, o.client_name, o.current_stage,
            EXTRACT(DAY FROM (NOW() - COALESCE(
              (SELECT MAX(su.created_at) FROM stage_updates su
               WHERE su.order_id = o.id AND su.stage = o.current_stage),
              o.updated_at
            )))::INT AS days_stuck
     FROM orders o
     WHERE o.status = 'active'
       AND o.updated_at < NOW() - INTERVAL '7 days'
       AND o.current_stage NOT IN ('payment_received', 'payment_confirmed', 'completed')
     ORDER BY days_stuck DESC
     LIMIT 20`
  );

  for (const order of stuckOrders) {
    gaps.push({
      type: 'stuck_order',
      severity: order.days_stuck > MAX_STUCK_ORDER_DAYS_CRITICAL ? 'critical' : 'warning',
      title: `Order stuck at "${order.current_stage}" for ${order.days_stuck}d`,
      description: `Order #${order.quotation_number ?? 'unknown'} (${order.client_name ?? 'N/A'}) stuck in "${order.current_stage}" for ${order.days_stuck} days.`,
      order_reference: order.quotation_number ?? undefined,
      suggestion: `Review order #${order.quotation_number ?? order.id.slice(0, 8)} at stage ${order.current_stage}. Consider manual advancement.`,
    });
  }

  return gaps;
}

// ── Phase 4: Wiring Gaps (Data Inconsistencies) ────────────────────────

async function checkWiringGaps(): Promise<WiringGap[]> {
  const gaps: WiringGap[] = [];

  // 4a. production_started=true but still in early stages
  const prodMismatch = await query<{ quotation_number: string; client_name: string; current_stage: string }>(
    `SELECT quotation_number, client_name, current_stage
     FROM orders WHERE production_started = true
     AND current_stage IN ('order_confirmation_received','math_verified','purchasing_pending')
     AND status = 'active' LIMIT 10`
  );
  for (const o of prodMismatch) {
    gaps.push({
      type: 'wiring_production_started_mismatch',
      severity: 'error',
      title: `Production started but stage is "${o.current_stage}"`,
      description: `Order #${o.quotation_number ?? 'unknown'}: production_started=true but still in "${o.current_stage}".`,
      order_reference: o.quotation_number ?? undefined,
      suggestion: `Advance order #${o.quotation_number} to production_in_progress or reset the flag.`,
    });
  }

  // 4b. deposit_paid=true but no amount
  const depositNoAmt = await query<{ quotation_number: string }>(
    `SELECT quotation_number FROM orders
     WHERE deposit_paid = true AND (deposit_amount IS NULL OR deposit_amount <= 0)
     AND status = 'active' LIMIT 10`
  );
  for (const o of depositNoAmt) {
    gaps.push({
      type: 'wiring_deposit_no_amount',
      severity: 'warning',
      title: 'Deposit paid but no amount recorded',
      description: `Order #${o.quotation_number ?? 'unknown'} marked deposit_paid but amount is missing.`,
      order_reference: o.quotation_number ?? undefined,
      suggestion: `Update deposit amount for #${o.quotation_number}.`,
    });
  }

  // 4c. en_route_confirmed but stage not updated
  const enRouteMismatch = await query<{ quotation_number: string; current_stage: string }>(
    `SELECT quotation_number, current_stage FROM orders
     WHERE en_route_confirmed = true
     AND current_stage NOT IN ('en_route','en_route_verification','inventory_verification','inventory_arrived')
     AND status = 'active' LIMIT 10`
  );
  for (const o of enRouteMismatch) {
    gaps.push({
      type: 'wiring_en_route_mismatch',
      severity: 'warning',
      title: `En route confirmed but stage is "${o.current_stage}"`,
      description: `Order #${o.quotation_number ?? 'unknown'} en_route_confirmed but in "${o.current_stage}".`,
      order_reference: o.quotation_number ?? undefined,
      suggestion: `Advance order #${o.quotation_number} to en_route stage.`,
    });
  }

  // 4d. delivery_estimated_days but no delivery_date
  const estNoDate = await query<{ quotation_number: string; delivery_estimated_days: number }>(
    `SELECT quotation_number, delivery_estimated_days FROM orders
     WHERE delivery_estimated_days IS NOT NULL AND delivery_date IS NULL
     AND status = 'active' LIMIT 10`
  );
  for (const o of estNoDate) {
    gaps.push({
      type: 'wiring_delivery_estimate_no_date',
      severity: 'info',
      title: `Delivery estimated ${o.delivery_estimated_days}d but no date set`,
      description: `Order #${o.quotation_number ?? 'unknown'}: ${o.delivery_estimated_days}d estimate but delivery_date is null.`,
      order_reference: o.quotation_number ?? undefined,
      suggestion: `Set delivery_date based on the ${o.delivery_estimated_days}d estimate.`,
    });
  }

  // 4e. Items missing production_status in en_route+ stages
  const itemsNoStatus = await query<{ order_ref: string; item_count: number }>(
    `SELECT o.quotation_number AS order_ref, COUNT(oi.id)::INT AS item_count
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.current_stage IN ('en_route','en_route_verification','inventory_verification')
     AND (oi.production_status IS NULL OR oi.production_status = '') AND o.status = 'active'
     GROUP BY o.quotation_number LIMIT 10`
  );
  for (const i of itemsNoStatus) {
    gaps.push({
      type: 'wiring_items_no_production_status',
      severity: 'warning',
      title: `${i.item_count} items missing production_status in order`,
      description: `Order #${i.order_ref ?? 'unknown'}: ${i.item_count} items without production_status.`,
      order_reference: i.order_ref ?? undefined,
      suggestion: `Update item-level production_status for #${i.order_ref}.`,
    });
  }

  return gaps;
}

// ── Phase 5: Client-Side Error Clustering ──────────────────────────────

async function checkErrorClusters(): Promise<WiringGap[]> {
  const gaps: WiringGap[] = [];

  const clusters = await query<{ error_type: string; cnt: number; sample_msg: string }>(
    `SELECT error_type, COUNT(*) AS cnt,
            (STRING_AGG(LEFT(COALESCE(message, ''), 200), ' | ' ORDER BY created_at DESC)) AS sample_msg
     FROM monitor_errors
     WHERE created_at > NOW() - INTERVAL '24 hours'
     GROUP BY error_type
     HAVING COUNT(*) >= 5
     ORDER BY cnt DESC LIMIT 10`
  );

  for (const c of clusters) {
    const severity: WiringGap['severity'] = c.cnt >= 20 ? 'critical' : c.cnt >= 10 ? 'error' : 'warning';
    gaps.push({
      type: 'client_error_cluster',
      severity,
      title: `Client error "${c.error_type}" × ${c.cnt} in 24h`,
      description: `Error "${c.error_type}" occurred ${c.cnt}x. Sample: ${(c.sample_msg ?? '').substring(0, 400)}`,
      suggestion: `Investigate "${c.error_type}" — affecting real users.`,
    });
  }

  return gaps;
}

// ── Phase 6: HermesClaw AI Analysis for Critical Stuck Orders ──────────

async function analyzeStuckWithHermes(orders: WiringGap[]): Promise<WiringGap[]> {
  const gaps: WiringGap[] = [];

  for (const gap of orders) {
    if (!gap.order_reference) continue;
    try {
      const orderRows = await query<{ id: string; quotation_number: string | null; client_name: string | null; sales_agent: string | null; current_stage: string; production_started: boolean | null; production_started_at: string | null; estimated_production_days: number | null; production_delayed: boolean | null; production_finished: boolean | null; production_finished_at: string | null; en_route_confirmed: boolean | null; estimated_arrival_days: number | null; updated_at: string; created_at: string }>(
        `SELECT id, quotation_number, client_name, sales_agent, current_stage,
                production_started, production_started_at, estimated_production_days,
                production_delayed, production_finished, production_finished_at,
                en_route_confirmed, estimated_arrival_days, updated_at, created_at
         FROM orders WHERE quotation_number = $1 AND status = 'active' LIMIT 1`,
        [gap.order_reference]
      );
      if (!orderRows[0]) continue;

      const o = orderRows[0];
      const daysInStage = Math.floor((Date.now() - new Date(o.updated_at).getTime()) / (1000 * 60 * 60 * 24));
      const ctx: HermesProductionContext = {
        quotation_number: o.quotation_number,
        client_name: o.client_name,
        sales_agent: o.sales_agent,
        stage: o.current_stage,
        production_started: o.production_started,
        production_started_at: o.production_started_at,
        estimated_production_days: o.estimated_production_days,
        production_delayed: o.production_delayed,
        production_finished: o.production_finished,
        production_finished_at: o.production_finished_at,
        en_route_confirmed: o.en_route_confirmed,
        estimated_arrival_days: o.estimated_arrival_days,
        days_in_stage: daysInStage,
        pct_elapsed: 0,
        is_overdue: daysInStage > 14,
        escalation_level: 0,
        quotation_text: null,
      };

      // Log that Hermes analysis was requested (actual AI call is expensive;
      // we note it for potential future invocation).
      await logAgentAction('monitor-agent', { phase: 'hermesclaw', order: o.quotation_number }, ctx, 'info', o.id);

      gaps.push({
        type: 'hermesclaw_analysis',
        severity: 'info',
        title: `HermesClaw context prepared for stuck order #${gap.order_reference}`,
        description: `Order #${gap.order_reference} ready for AI analysis. Context: ${daysInStage}d in "${o.current_stage}". To run AI analysis, manually invoke HermesClaw.`,
        order_reference: gap.order_reference,
        suggestion: 'Run HermesClaw analysis on this order for AI-powered insights on why it is stuck.',
      });
    } catch (err) {
      console.error(`[MonitorAgent] HermesClaw context failed for #${gap.order_reference}:`, err);
    }
  }

  return gaps;
}

// ── Phase 7: Performance Trend Detection ───────────────────────────────

async function checkTrend(): Promise<WiringGap[]> {
  const gaps: WiringGap[] = [];

  const lastTwo = await query<{ health_score: number; created_at: string }>(
    `SELECT health_score, created_at::TEXT FROM monitor_snapshots
     WHERE snapshot_type = 'periodic'
     ORDER BY created_at DESC LIMIT 2`
  );

  if (lastTwo.length >= 2) {
    const current = lastTwo[0].health_score;
    const previous = lastTwo[1].health_score;
    const drop = previous - current;

    if (drop >= 20) {
      gaps.push({
        type: 'trend_degradation',
        severity: 'warning',
        title: `Health score dropped ${drop} points since last snapshot`,
        description: `Previous: ${previous}/100 → Current: ${current}/100. Degradation detected.`,
        suggestion: 'Review what changed between the two snapshots. Check recent deployments or config changes.',
      });
    }
  }

  return gaps;
}

// ── Phase 8: Auto-Create Bug Reports (with dedup) ──────────────────────

async function reportGaps(gaps: WiringGap[]): Promise<string[]> {
  const gapIds: string[] = [];

  for (const gap of gaps) {
    if (gap.severity === 'info') continue;

    // Dedup: skip if an open bug report with same type+order_ref exists within DEDUP_HOURS
    const existing = await query<{ id: string }>(
      `SELECT id FROM bug_reports
       WHERE source = 'monitor'
         AND title LIKE $1
         AND ${gap.order_reference ? 'order_reference = $2 AND' : ''}
         created_at > NOW() - INTERVAL '${DEDUP_HOURS} hours'
         AND status IN ('open', 'in_progress')
       LIMIT 1`,
      gap.order_reference
        ? [`%${gap.type}%`, gap.order_reference]
        : [`%${gap.type}%`]
    );

    if (existing.length > 0) {
      console.log(`[MonitorAgent] Skipping duplicate bug report for gap "${gap.title}" (already reported)`);
      gapIds.push(existing[0].id);
      continue;
    }

    try {
      const rows = await query<{ id: string }>(
        `INSERT INTO bug_reports (title, description, source, reporter_name, order_reference)
         VALUES ($1, $2, 'monitor', 'System Monitor', $3)
         RETURNING id`,
        [
          gap.title,
          `🔍 *Auto-detected by System Monitor*\n\n**Type:** ${gap.type}\n**Severity:** ${gap.severity}\n\n**Description:**\n${gap.description}\n\n**Suggestion:**\n${gap.suggestion ?? 'Review and address the issue.'}`,
          gap.order_reference ?? null,
        ]
      );
      gapIds.push(rows[0]?.id ?? 'unknown');
    } catch (err) {
      console.error(`[MonitorAgent] Failed to create bug report for "${gap.title}":`, err);
    }
  }

  return gapIds;
}

// ── Phase 9: Telegram Notification for Critical Issues ─────────────────

async function sendCriticalTelegram(chatId: string, gaps: WiringGap[], health: { score: number }): Promise<void> {
  const criticals = gaps.filter((g) => g.severity === 'critical').slice(0, 5);
  if (criticals.length === 0) return;

  let msg = `🚨 <b>System Monitor — Critical Issues Detected</b>\n\n`;
  msg += `Health Score: ${health.score}/100\n`;
  msg += `Total Gaps: ${gaps.length}\n\n`;
  msg += `<b>Top Critical Issues:</b>\n`;

  for (const c of criticals) {
    msg += `\n🔴 <b>${c.title}</b>\n`;
    msg += `${c.description.substring(0, 300)}\n`;
    if (c.suggestion) msg += `💡 ${c.suggestion.substring(0, 200)}`;
  }

  msg += `\n\n🕐 ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`;

  await sendTelegramMessage(chatId, msg);
}

// ── Phase 10: Record Snapshot ──────────────────────────────────────────

async function recordSnapshot(
  gaps: WiringGap[],
  criticalCount: number,
  errorCount: number,
  warningCount: number,
): Promise<string | null> {
  try {
    const rows = await query<{ id: string }>(
      `INSERT INTO monitor_snapshots
        (snapshot_type, summary, details, health_score,
         agent_error_count, stuck_order_count, bug_report_count, error_count, warnings)
      VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9::jsonb)
      RETURNING id`,
      [
        'periodic',
        `Health score: ${calcHealthScore(gaps)}/100 — ${gaps.length} gap(s) found (${criticalCount} critical, ${errorCount} errors, ${warningCount} warnings)`,
        JSON.stringify({
          gaps: gaps.map((g) => ({ type: g.type, severity: g.severity, title: g.title })),
        }),
        calcHealthScore(gaps),
        gaps.filter((g) => g.type.startsWith('agent_') || g.type === 'system_health').length,
        gaps.filter((g) => g.type === 'stuck_order').length,
        gaps.filter((g) => g.severity !== 'info').length,
        errorCount + criticalCount,
        JSON.stringify(gaps.filter((g) => g.severity !== 'info').map((g) => g.title)),
      ]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.error('[MonitorAgent] Failed to record snapshot:', err);
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Calculate health score: 100 - (critical*30 + error*15 + warning*5), min 0 */
function calcHealthScore(gaps: WiringGap[]): number {
  let score = 100;
  for (const g of gaps) {
    if (g.severity === 'critical') score -= 30;
    else if (g.severity === 'error') score -= 15;
    else if (g.severity === 'warning') score -= 5;
  }
  return Math.max(0, Math.min(100, score));
}

function healthScoreFromChecks(gaps: WiringGap[]): { score: number } {
  return { score: calcHealthScore(gaps) };
}

function buildSummary(
  gaps: WiringGap[],
  startTime: number,
  criticalCount: number,
  errorCount: number,
  warningCount: number,
  infoCount: number,
): string {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  let summary = `[MonitorAgent] Scan in ${elapsed}s — `;
  summary += `Health: ${calcHealthScore(gaps)}/100, `;
  summary += `Gaps: ${gaps.length} (${criticalCount} critical, ${errorCount} errors, ${warningCount} warnings, ${infoCount} info)`;

  if (gaps.length > 0) {
    summary += `\n  Issues:`;
    gaps.slice(0, 5).forEach((g) => {
      summary += `\n    [${g.severity.toUpperCase()}] ${g.title}`;
    });
  }

  console.log(summary);
  return summary;
}
