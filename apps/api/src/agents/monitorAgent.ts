import { query } from '../db.js';
import { logAgentAction, type AgentResult } from '../services/agentRunner.js';
import { cacheClient } from '../cache.js';

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

const MAX_AGENT_CONSECUTIVE_ERRORS = 3;
const MAX_STUCK_ORDER_DAYS = 7;
const MAX_SLOW_QUERY_MS = 500;
const MAX_RECENT_BUG_REPORTS_OPEN = 15;

// ── Main Entry Point ───────────────────────────────────────────────────

export async function runMonitorAgent(): Promise<AgentResult[]> {
  const results: AgentResult[] = [];
  const gaps: WiringGap[] = [];
  const startTime = Date.now();

  try {
    // ── Phase 1: Health Checks ────────────────────────────────────────
    const health = await checkSystemHealth();
    for (const check of health.checks) {
      if (check.status === 'fail' || check.status === 'warn') {
        gaps.push({
          type: 'system_health',
          severity: check.status === 'fail' ? 'critical' : 'warning',
          title: `System health check failed: ${check.name}`,
          description: check.detail,
          suggestion: `Investigate ${check.name}. ${check.detail}`,
        });
      }
    }

    // ── Phase 2: Agent Error Patterns ─────────────────────────────────
    const agentErrors = await checkAgentErrors();
    for (const err of agentErrors) {
      gaps.push(err);
    }

    // ── Phase 3: Stuck Orders ─────────────────────────────────────────
    const stuckOrders = await checkStuckOrders();
    for (const s of stuckOrders) {
      gaps.push(s);
    }

    // ── Phase 4: Wiring Gaps (data inconsistencies) ───────────────────
    const wiringIssues = await checkWiringGaps();
    for (const w of wiringIssues) {
      gaps.push(w);
    }

    // ── Phase 5: Client-Side Error Clustering ─────────────────────────
    const errorClusters = await checkErrorClusters();
    for (const ec of errorClusters) {
      gaps.push(ec);
    }

    // ── Phase 6: Create Bug Reports for Critical/Warning Issues ───────
    const gapIds = await reportGaps(gaps);

    // ── Phase 7: Record Snapshot ──────────────────────────────────────
    const snapshotId = await recordSnapshot(health, gaps);

    // ── Build Result ───────────────────────────────────────────────────
    const summary = buildSummary(health, gaps, startTime);
    const input = { gaps_found: gaps.length, health_score: health.score, snapshot_id: snapshotId, gap_ids: gapIds };

    await logAgentAction('monitor-agent', input, { summary, gaps, health }, 'success');

    results.push({
      status: gaps.length > 3 ? 'needs_review' : gaps.length > 0 ? 'ok' : 'ok',
      message: summary,
      next_stage: null,
      reminder_needed: false,
      escalation_level: gaps.some((g) => g.severity === 'critical') ? 2 : 0,
    });

    return results;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[MonitorAgent] Fatal error:', errorMsg);
    await logAgentAction('monitor-agent', { phase: 'fatal' }, { error: errorMsg }, 'error', undefined, errorMsg);
    throw err;
  }
}

// ── Phase 1: System Health ─────────────────────────────────────────────

async function checkSystemHealth(): Promise<HealthCheckResult> {
  const checks: HealthCheckResult['checks'] = [];

  // 1a. Database connectivity
  try {
    const dbStart = Date.now();
    const dbResult = await query('SELECT 1 AS ok');
    const dbMs = Date.now() - dbStart;
    checks.push({
      name: 'database',
      status: dbMs > 1000 ? 'warn' : 'pass',
      detail: `Query responded in ${dbMs}ms`,
      value: dbMs,
    });
  } catch (err) {
    checks.push({
      name: 'database',
      status: 'fail',
      detail: `Database unreachable: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 1b. Redis connectivity
  if (cacheClient?.isOpen) {
    checks.push({ name: 'redis', status: 'pass', detail: 'Redis connected' });
  } else {
    checks.push({ name: 'redis', status: 'warn', detail: 'Redis unavailable — caching disabled' });
  }

  // 1c. Agent health — check for consecutive errors
  const agentHealthRaw = await query<{ agent_name: string; error_count: number; last_error: string | null }>(
    `SELECT agent_name, COUNT(*) AS error_count,
            MAX(created_at)::TEXT AS last_error
     FROM agent_logs
     WHERE status = 'error' AND created_at > NOW() - INTERVAL '24 hours'
     GROUP BY agent_name
     ORDER BY error_count DESC
     LIMIT 20`
  );
  for (const a of agentHealthRaw) {
    checks.push({
      name: `agent:${a.agent_name}`,
      status: a.error_count >= MAX_AGENT_CONSECUTIVE_ERRORS ? 'fail' : 'warn',
      detail: `${a.error_count} error(s) in last 24h${a.last_error ? `. Last: ${a.last_error}` : ''}`,
      value: a.error_count,
    });
  }

  // 1d. Slow queries in last hour
  const slowQueryCount = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM agent_logs
     WHERE status = 'success' AND created_at > NOW() - INTERVAL '1 hour'
       AND (output->>'duration_ms')::int > $1`,
    [MAX_SLOW_QUERY_MS]
  );
  if (slowQueryCount[0]?.cnt > 0) {
    checks.push({
      name: 'slow_queries',
      status: slowQueryCount[0].cnt > 10 ? 'warn' : 'pass',
      detail: `${slowQueryCount[0].cnt} slow operations (>${MAX_SLOW_QUERY_MS}ms) in last hour`,
      value: slowQueryCount[0].cnt,
    });
  }

  // 1e. Open bug reports count
  const openBugs = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM bug_reports WHERE status IN ('open', 'in_progress')`
  );
  if (openBugs[0]?.cnt > 0) {
    checks.push({
      name: 'open_bugs',
      status: openBugs[0].cnt > MAX_RECENT_BUG_REPORTS_OPEN ? 'warn' : 'pass',
      detail: `${openBugs[0].cnt} open bug reports`,
      value: openBugs[0].cnt,
    });
  }

  // Calculate score (pass=100, each warn=-15, each fail=-30)
  let score = 100;
  for (const c of checks) {
    if (c.status === 'fail') score -= 30;
    else if (c.status === 'warn') score -= 15;
  }
  score = Math.max(0, Math.min(100, score));

  return {
    status: score >= 80 ? 'healthy' : score >= 50 ? 'degraded' : 'unhealthy',
    checks,
    score,
  };
}

// ── Phase 2: Agent Error Patterns ───────────────────────────────────────

async function checkAgentErrors(): Promise<WiringGap[]> {
  const gaps: WiringGap[] = [];

  const errorAgents = await query<{ agent_name: string; error_count: number; sample_error: string }>(
    `SELECT agent_name, COUNT(*) AS error_count,
            (STRING_AGG(LEFT(error, 300), ' | ' ORDER BY created_at DESC)) AS sample_error
     FROM agent_logs
     WHERE status = 'error' AND created_at > NOW() - INTERVAL '24 hours'
     GROUP BY agent_name
     HAVING COUNT(*) >= $1
     ORDER BY error_count DESC`,
    [MAX_AGENT_CONSECUTIVE_ERRORS]
  );

  for (const agent of errorAgents) {
    gaps.push({
      type: 'agent_errors',
      severity: agent.error_count >= MAX_AGENT_CONSECUTIVE_ERRORS * 2 ? 'critical' : 'error',
      title: `Agent "${agent.agent_name}" failing — ${agent.error_count} errors in 24h`,
      description: `Agent ${agent.agent_name} has ${agent.error_count} consecutive errors in the last 24 hours. Sample error: ${agent.sample_error?.substring(0, 500)}`,
      suggestion: `Check agent ${agent.agent_name} configuration, dependencies, and input data. Review recent agent_logs entries.`,
    });
  }

  return gaps;
}

// ── Phase 3: Stuck Orders ───────────────────────────────────────────────

async function checkStuckOrders(): Promise<WiringGap[]> {
  const gaps: WiringGap[] = [];

  const stuckOrders = await query<{ id: string; quotation_number: string | null; client_name: string | null; current_stage: string; days_stuck: number }>(
    `SELECT id, quotation_number, client_name, current_stage,
            EXTRACT(DAY FROM (NOW() - updated_at))::INT AS days_stuck
     FROM orders
     WHERE status = 'active'
       AND updated_at < NOW() - INTERVAL '7 days'
       AND current_stage NOT IN ('payment_received', 'payment_confirmed', 'completed')
     ORDER BY days_stuck DESC
     LIMIT 20`
  );

  for (const order of stuckOrders) {
    gaps.push({
      type: 'stuck_order',
      severity: order.days_stuck > 14 ? 'critical' : 'warning',
      title: `Order stuck at "${order.current_stage}" for ${order.days_stuck} days`,
      description: `Order #${order.quotation_number ?? 'unknown'} (${order.client_name ?? 'N/A'}) has been in stage "${order.current_stage}" for ${order.days_stuck} days without progress.`,
      order_reference: order.quotation_number ?? undefined,
      suggestion: `Review order #${order.quotation_number ?? order.id.slice(0, 8)} at stage ${order.current_stage}. Consider manual stage advancement or contacting the responsible team.`,
    });
  }

  return gaps;
}

// ── Phase 4: Wiring Gaps (Data Inconsistencies) ────────────────────────

async function checkWiringGaps(): Promise<WiringGap[]> {
  const gaps: WiringGap[] = [];

  // 4a. Orders marked production_started but still in earlier stages
  const prodStartedNoStage = await query<{ quotation_number: string; client_name: string; current_stage: string }>(
    `SELECT quotation_number, client_name, current_stage
     FROM orders
     WHERE production_started = true
       AND current_stage IN ('order_confirmation_received', 'math_verified', 'purchasing_pending')
       AND status = 'active'
     LIMIT 10`
  );
  for (const o of prodStartedNoStage) {
    gaps.push({
      type: 'wiring_production_started_mismatch',
      severity: 'error',
      title: `Production started but stage is "${o.current_stage}"`,
      description: `Order #${o.quotation_number ?? 'unknown'} has production_started=true but is still in "${o.current_stage}" stage. The stage was likely not advanced when production began.`,
      order_reference: o.quotation_number ?? undefined,
      suggestion: `Advance order #${o.quotation_number} to "production_in_progress" or reset the production_started flag if production hasn't actually started.`,
    });
  }

  // 4b. Orders with deposit_paid=true but no deposit_amount
  const depositNoAmount = await query<{ quotation_number: string; client_name: string; deposit_paid_at: string | null }>(
    `SELECT quotation_number, client_name, deposit_paid_at
     FROM orders
     WHERE deposit_paid = true
       AND (deposit_amount IS NULL OR deposit_amount <= 0)
       AND status = 'active'
     LIMIT 10`
  );
  for (const o of depositNoAmount) {
    gaps.push({
      type: 'wiring_deposit_no_amount',
      severity: 'warning',
      title: `Deposit marked paid but no amount recorded`,
      description: `Order #${o.quotation_number ?? 'unknown'} has deposit_paid=true but no deposit amount was recorded.`,
      order_reference: o.quotation_number ?? undefined,
      suggestion: `Update deposit amount for order #${o.quotation_number} or verify if the deposit was actually paid.`,
    });
  }

  // 4c. Orders with en_route_confirmed=true but current_stage hasn't been updated
  const enRouteNoStage = await query<{ quotation_number: string; client_name: string; current_stage: string }>(
    `SELECT quotation_number, client_name, current_stage
     FROM orders
     WHERE en_route_confirmed = true
       AND current_stage NOT IN ('en_route', 'en_route_verification', 'inventory_verification', 'inventory_arrived')
       AND status = 'active'
     LIMIT 10`
  );
  for (const o of enRouteNoStage) {
    gaps.push({
      type: 'wiring_en_route_mismatch',
      severity: 'warning',
      title: `En route confirmed but stage is "${o.current_stage}"`,
      description: `Order #${o.quotation_number ?? 'unknown'} has en_route_confirmed=true but is still in "${o.current_stage}" stage.`,
      order_reference: o.quotation_number ?? undefined,
      suggestion: `Advance order #${o.quotation_number} to the "en_route" stage to reflect its actual status.`,
    });
  }

  // 4d. Orders with delivery_estimated_days but no delivery_date set
  const deliveryEstimatedNoDate = await query<{ quotation_number: string; client_name: string; delivery_estimated_days: number }>(
    `SELECT quotation_number, client_name, delivery_estimated_days
     FROM orders
     WHERE delivery_estimated_days IS NOT NULL
       AND delivery_date IS NULL
       AND status = 'active'
     LIMIT 10`
  );
  for (const o of deliveryEstimatedNoDate) {
    gaps.push({
      type: 'wiring_delivery_estimate_no_date',
      severity: 'info',
      title: `Delivery estimated (${o.delivery_estimated_days}d) but no delivery date set`,
      description: `Order #${o.quotation_number ?? 'unknown'} has delivery_estimated_days=${o.delivery_estimated_days} but delivery_date is null.`,
      order_reference: o.quotation_number ?? undefined,
      suggestion: `Set a delivery_date for order #${o.quotation_number} based on the estimated ${o.delivery_estimated_days} days.`,
    });
  }

  // 4e. Items in "en_route" or "inventory_verification" with no production items status
  const itemsNoStatus = await query<{ order_ref: string; item_count: number }>(
    `SELECT o.quotation_number AS order_ref, COUNT(oi.id)::INT AS item_count
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.current_stage IN ('en_route', 'en_route_verification', 'inventory_verification')
       AND (oi.production_status IS NULL OR oi.production_status = '')
       AND o.status = 'active'
     GROUP BY o.quotation_number
     LIMIT 10`
  );
  for (const i of itemsNoStatus) {
    gaps.push({
      type: 'wiring_items_no_production_status',
      severity: 'warning',
      title: `${i.item_count} items missing production status in order`,
      description: `Order #${i.order_ref ?? 'unknown'} has ${i.item_count} items in en_route/inventory stage with no production_status set.`,
      order_reference: i.order_ref ?? undefined,
      suggestion: `Update item-level production_status for order #${i.order_ref} to track each item's actual status.`,
    });
  }

  return gaps;
}

// ── Phase 5: Client-Side Error Clustering ──────────────────────────────

async function checkErrorClusters(): Promise<WiringGap[]> {
  const gaps: WiringGap[] = [];

  // Look for error types that appear frequently
  const errorClusters = await query<{ error_type: string; cnt: number; sample_msg: string }>(
    `SELECT error_type, COUNT(*) AS cnt,
            (STRING_AGG(LEFT(message, 200), ' | ' ORDER BY created_at DESC)) AS sample_msg
     FROM monitor_errors
     WHERE created_at > NOW() - INTERVAL '24 hours'
     GROUP BY error_type
     HAVING COUNT(*) >= 5
     ORDER BY cnt DESC
     LIMIT 10`
  );

  for (const cluster of errorClusters) {
    const severity: WiringGap['severity'] = cluster.cnt >= 20 ? 'critical' : cluster.cnt >= 10 ? 'error' : 'warning';
    gaps.push({
      type: 'client_error_cluster',
      severity,
      title: `Client error "${cluster.error_type}" × ${cluster.cnt} in 24h`,
      description: `Error type "${cluster.error_type}" occurred ${cluster.cnt} times in the last 24 hours. Sample: ${cluster.sample_msg?.substring(0, 400)}`,
      suggestion: `Investigate error "${cluster.error_type}" which is affecting users. Check the affected pages and API endpoints.`,
    });
  }

  return gaps;
}

// ── Phase 6: Auto-Create Bug Reports ───────────────────────────────────

async function reportGaps(gaps: WiringGap[]): Promise<string[]> {
  const gapIds: string[] = [];

  for (const gap of gaps) {
    if (gap.severity === 'info') continue; // Don't auto-report info-level issues

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
      console.error(`[MonitorAgent] Failed to create bug report for gap "${gap.title}":`, err);
    }
  }

  return gapIds;
}

// ── Phase 7: Record Snapshot ──────────────────────────────────────────

async function recordSnapshot(
  health: HealthCheckResult,
  gaps: WiringGap[],
): Promise<string | null> {
  try {
    const warningCount = gaps.filter((g) => g.severity === 'warning').length;
    const errorCount = gaps.filter((g) => g.severity === 'error' || g.severity === 'critical').length;

    const rows = await query<{ id: string }>(
      `INSERT INTO monitor_snapshots (snapshot_type, summary, details, health_score,
        agent_error_count, stuck_order_count, bug_report_count, error_count, warnings)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        'periodic',
        `Health score: ${health.score}/100 — ${gaps.length} gap(s) found (${errorCount} errors, ${warningCount} warnings)`,
        JSON.stringify({
          checks: health.checks,
          gaps: gaps.map((g) => ({ type: g.type, severity: g.severity, title: g.title })),
          agent_errors: health.checks.filter((c) => c.name.startsWith('agent:') && c.status !== 'pass').length,
        }),
        health.score,
        health.checks.filter((c) => c.name.startsWith('agent:') && c.status !== 'pass').length,
        gaps.filter((g) => g.type === 'stuck_order').length,
        gaps.filter((g) => g.type !== 'system_health' && g.severity !== 'info').length,
        errorCount,
        gaps.filter((g) => g.severity === 'warning' || g.severity === 'error').map((g) => g.title),
      ]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.error('[MonitorAgent] Failed to record snapshot:', err);
    return null;
  }
}

// ── Summary Builder ─────────────────────────────────────────────────────

function buildSummary(health: HealthCheckResult, gaps: WiringGap[], startTime: number): string {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const errorCount = gaps.filter((g) => g.severity === 'error' || g.severity === 'critical').length;
  const warningCount = gaps.filter((g) => g.severity === 'warning').length;
  const infoCount = gaps.filter((g) => g.severity === 'info').length;
  const criticalCount = gaps.filter((g) => g.severity === 'critical').length;

  let summary = `[MonitorAgent] System scan completed in ${elapsed}s — `;
  summary += `Health: ${health.score}/100 (${health.status}), `;
  summary += `Gaps: ${gaps.length} total (${criticalCount} critical, ${errorCount} errors, ${warningCount} warnings, ${infoCount} info)`;

  if (gaps.length > 0) {
    summary += `\n  Top issues:`;
    gaps.slice(0, 5).forEach((g) => {
      summary += `\n    [${g.severity.toUpperCase()}] ${g.title}`;
    });
  }

  console.log(summary);
  return summary;
}
