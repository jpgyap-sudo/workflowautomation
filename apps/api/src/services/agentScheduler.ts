import { runQuotationChecker } from '../agents/quotationChecker.js';
import { runPurchasingAgent } from '../agents/purchasingAgent.js';
import { runProductionAgent } from '../agents/productionAgent.js';
import { runInventoryAgent } from '../agents/inventoryAgent.js';
import { runDeliveryAgent } from '../agents/deliveryAgent.js';
import { runCollectionAgent } from '../agents/collectionAgent.js';
import { runEscalationAgent } from '../agents/escalationAgent.js';
import { runSupabaseBackup } from '../agents/supabaseBackupAgent.js';
import { runMonitorAgent } from '../agents/monitorAgent.js';

// ── Agent Schedule Configuration ──────────────────────────────────────

interface AgentSchedule {
  name: string;
  run: () => Promise<any[]>;
  intervalMs: number;
  description: string;
  /** Optional PHT hours at which to run (e.g., [2, 14] for 2 AM / 2 PM PHT).
   *  When set, overrides intervalMs for scheduling — the agent runs only
   *  at these specific hours. intervalMs is still used for circuit breaker
   *  backoff fallback. */
  runHours?: number[];
}

const AGENTS: AgentSchedule[] = [
  {
    name: 'quotation-checker',
    run: runQuotationChecker,
    intervalMs: 5 * 60 * 1000,
    description: 'Checks quotation math for new orders',
  },
  {
    name: 'purchasing-agent',
    run: runPurchasingAgent,
    intervalMs: 60 * 60 * 1000,
    description: 'Tracks purchasing status for orders waiting to start production',
  },
  {
    name: 'production-agent',
    run: runProductionAgent,
    intervalMs: 30 * 60 * 1000,
    description: 'Monitors production progress with adaptive reminders',
  },
  {
    name: 'inventory-agent',
    run: runInventoryAgent,
    intervalMs: 60 * 60 * 1000,
    description: 'Tracks inventory arrival',
  },
  {
    name: 'delivery-agent',
    run: runDeliveryAgent,
    intervalMs: 60 * 60 * 1000,
    description: 'Tracks delivery scheduling and status',
  },
  {
    name: 'collection-agent',
    run: runCollectionAgent,
    intervalMs: 60 * 60 * 1000,
    description: 'Tracks payment collection',
  },
  {
    name: 'escalation-agent',
    run: runEscalationAgent,
    intervalMs: 4 * 60 * 60 * 1000,
    description: 'Monitors stalled orders and escalates',
  },
  {
    name: 'supabase-backup',
    run: runSupabaseBackup,
    intervalMs: 24 * 60 * 60 * 1000,
    description: 'Dumps PostgreSQL database and uploads to Supabase Storage',
  },
  {
    name: 'monitor-agent',
    run: runMonitorAgent,
    intervalMs: 12 * 60 * 60 * 1000,
    description: 'System health monitor — checks for wiring gaps, agent errors, stuck orders, and auto-creates bug reports (runs twice daily)',
    runHours: [2, 14], // 2 AM and 2 PM PHT
  },
];

// ── Circuit Breaker / Scheduler State ─────────────────────────────────

const lastRun: Record<string, number> = {};
const consecutiveErrors: Record<string, number> = {};
const runningAgents = new Set<string>();
let schedulerTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_MAX_MULTIPLIER = 10;
const AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max per agent

// ── Helpers ───────────────────────────────────────────────────────────

const PHT_OFFSET_MS = 8 * 60 * 60 * 1000; // UTC+8

/**
 * For agents with runHours[] set, calculate the next scheduled run time
 * as a UTC timestamp. Falls back to interval-based scheduling if no runHours.
 */
function getNextRunTime(agent: AgentSchedule): number | null {
  if (!agent.runHours || agent.runHours.length === 0) return null;

  const now = Date.now();
  const phtNow = new Date(now + PHT_OFFSET_MS);
  const phtCurrentHour = phtNow.getUTCHours();
  const phtTodayMidnight = new Date(Date.UTC(phtNow.getUTCFullYear(), phtNow.getUTCMonth(), phtNow.getUTCDate()));

  // Sort hours ascending
  const sorted = [...agent.runHours].sort((a, b) => a - b);

  // Find next hour today
  for (const hour of sorted) {
    if (hour > phtCurrentHour) {
      // Schedule for this hour today
      const targetPHT = new Date(phtTodayMidnight.getTime() + hour * 60 * 60 * 1000);
      return targetPHT.getTime() - PHT_OFFSET_MS;
    }
  }

  // All hours passed — schedule for first hour tomorrow
  const tomorrowPHT = new Date(phtTodayMidnight.getTime() + 24 * 60 * 60 * 1000 + sorted[0] * 60 * 60 * 1000);
  return tomorrowPHT.getTime() - PHT_OFFSET_MS;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]);
}

// ── Run Single Agent ──────────────────────────────────────────────────

async function runAgent(agent: AgentSchedule): Promise<void> {
  // Prevent concurrent runs of the same agent
  if (runningAgents.has(agent.name)) {
    console.warn(`[AgentScheduler] ${agent.name} is already running — skipping`);
    return;
  }

  if (isShuttingDown) {
    console.log(`[AgentScheduler] ${agent.name} skipped — shutdown in progress`);
    return;
  }

  runningAgents.add(agent.name);
  const start = Date.now();

  try {
    console.log(`[AgentScheduler] Running ${agent.name}...`);
    const results = await withTimeout(agent.run(), AGENT_TIMEOUT_MS, agent.name);
    const duration = Date.now() - start;

    consecutiveErrors[agent.name] = 0;

    const okCount = results.filter((r) => r.status === 'ok' || r.status === 'complete').length;
    const reviewCount = results.filter((r) => r.status === 'needs_review').length;
    const blockedCount = results.filter((r) => r.status === 'blocked').length;
    const errorCount = results.filter((r) => r.status === 'error').length;

    console.log(
      `[AgentScheduler] ${agent.name} completed in ${duration}ms — ` +
      `${results.length} orders: ${okCount} ok, ${reviewCount} needs_review, ${blockedCount} blocked, ${errorCount} errors`,
    );
  } catch (err) {
    consecutiveErrors[agent.name] = (consecutiveErrors[agent.name] ?? 0) + 1;
    const errCount = consecutiveErrors[agent.name];
    console.error(`[AgentScheduler] ${agent.name} failed (${errCount}x consecutive):`, err);

    // Circuit breaker: after threshold, double the cooldown each time up to max
    if (errCount >= CIRCUIT_BREAKER_THRESHOLD) {
      const multiplier = Math.min(errCount, CIRCUIT_BREAKER_MAX_MULTIPLIER);
      const cooldownMs = agent.intervalMs * multiplier;
      console.warn(
        `[AgentScheduler] CIRCUIT BREAKER — ${agent.name} has ${errCount} consecutive errors. ` +
        `Cooling down for ${Math.round(cooldownMs / 1000 / 60)} minutes`
      );
      // Reset lastRun so it won't retry until cooldown passes
      lastRun[agent.name] = Date.now();
    }
  } finally {
    runningAgents.delete(agent.name);
  }
}

// ── Main Scheduler Loop ───────────────────────────────────────────────

function checkAndRunAgents(): void {
  if (isShuttingDown) return;

  const now = Date.now();

  for (const agent of AGENTS) {
    const last = lastRun[agent.name] ?? 0;
    const errCount = consecutiveErrors[agent.name] ?? 0;

    // Determine if this agent should run now
    let shouldRun = false;

    if (agent.runHours && agent.runHours.length > 0) {
      // Time-of-day scheduling with circuit breaker
      let effectiveInterval: number | null = null;
      if (errCount >= CIRCUIT_BREAKER_THRESHOLD) {
        // Circuit breaker: skip this scheduled slot, try next one
        effectiveInterval = agent.intervalMs * Math.min(errCount, CIRCUIT_BREAKER_MAX_MULTIPLIER);
        console.warn(
          `[AgentScheduler] CIRCUIT BREAKER — ${agent.name} has ${errCount} consecutive errors. ` +
          `Cooling down for ${Math.round(effectiveInterval / 1000 / 60)} minutes`
        );
      }

      if (effectiveInterval === null || now - last >= effectiveInterval) {
        const nextRun = getNextRunTime(agent);
        if (nextRun !== null) {
          // Allow a 5-minute window after the scheduled time
          const windowStart = nextRun;
          const windowEnd = nextRun + 5 * 60 * 1000;
          if (now >= windowStart && now <= windowEnd && last < windowStart) {
            shouldRun = true;
          }
        }
      }
    } else {
      // Standard interval-based scheduling
      let effectiveInterval = agent.intervalMs;
      if (errCount >= CIRCUIT_BREAKER_THRESHOLD) {
        effectiveInterval = agent.intervalMs * Math.min(errCount, CIRCUIT_BREAKER_MAX_MULTIPLIER);
      }
      if (now - last >= effectiveInterval) {
        shouldRun = true;
      }
    }

    if (shouldRun) {
      lastRun[agent.name] = now;
      // Run asynchronously — don't block the scheduler loop
      runAgent(agent);
    }
  }
}

// ── Start / Stop ──────────────────────────────────────────────────────

export function startAgentScheduler(checkIntervalMs: number = 60_000): void {
  if (schedulerTimer) {
    console.warn('[AgentScheduler] Already running — stopping first');
    stopAgentScheduler();
  }

  isShuttingDown = false;
  console.log(`[AgentScheduler] Starting — checking every ${checkIntervalMs / 1000}s`);

  // Run agents immediately on startup (skip time-scheduled ones — they wait for their hour)
  for (const agent of AGENTS) {
    if (agent.runHours && agent.runHours.length > 0) {
      // Time-scheduled agent: set lastRun to now so it doesn't fire immediately
      lastRun[agent.name] = Date.now();
    } else {
      lastRun[agent.name] = 0; // Force immediate run
    }
  }
  checkAndRunAgents();

  // Then check on interval
  schedulerTimer = setInterval(checkAndRunAgents, checkIntervalMs);
}

export function stopAgentScheduler(): void {
  isShuttingDown = true;
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log('[AgentScheduler] Stopped');
  }
}

export function waitForAgents(timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (runningAgents.size === 0 || Date.now() - start > timeoutMs) {
        if (runningAgents.size > 0) {
          console.warn(`[AgentScheduler] ${runningAgents.size} agent(s) still running after timeout: ${[...runningAgents].join(', ')}`);
        }
        resolve();
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });
}

// ── Manual Trigger (for API endpoint) ─────────────────────────────────

export async function runAgentByName(name: string): Promise<{ ok: boolean; message: string; results?: any[] }> {
  const agent = AGENTS.find((a) => a.name === name);
  if (!agent) {
    return { ok: false, message: `Unknown agent: ${name}. Available: ${AGENTS.map((a) => a.name).join(', ')}` };
  }

  if (runningAgents.has(agent.name)) {
    return { ok: false, message: `${agent.name} is already running` };
  }

  lastRun[agent.name] = Date.now();
  consecutiveErrors[agent.name] = 0;

  try {
    const results = await withTimeout(agent.run(), AGENT_TIMEOUT_MS, agent.name);
    return {
      ok: true,
      message: `${agent.name} ran successfully — ${results.length} orders processed`,
      results,
    };
  } catch (err) {
    return {
      ok: false,
      message: `${agent.name} failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function listAgents(): { name: string; description: string; intervalMs: number }[] {
  return AGENTS.map((a) => ({
    name: a.name,
    description: a.description,
    intervalMs: a.intervalMs,
  }));
}

// ── Agent Health ──────────────────────────────────────────────────────

export function getAgentHealth(): { name: string; lastRun: number; consecutiveErrors: number; healthy: boolean; running: boolean }[] {
  return AGENTS.map((a) => ({
    name: a.name,
    lastRun: lastRun[a.name] ?? 0,
    consecutiveErrors: consecutiveErrors[a.name] ?? 0,
    healthy: (consecutiveErrors[a.name] ?? 0) < CIRCUIT_BREAKER_THRESHOLD,
    running: runningAgents.has(a.name),
  }));
}
