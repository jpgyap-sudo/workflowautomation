import { runQuotationChecker } from '../agents/quotationChecker.js';
import { runPurchasingAgent } from '../agents/purchasingAgent.js';
import { runProductionAgent } from '../agents/productionAgent.js';
import { runInventoryAgent } from '../agents/inventoryAgent.js';
import { runDeliveryAgent } from '../agents/deliveryAgent.js';
import { runCollectionAgent } from '../agents/collectionAgent.js';
import { runEscalationAgent } from '../agents/escalationAgent.js';
import { runSupabaseBackup } from '../agents/supabaseBackupAgent.js';

// ── Agent Schedule Configuration ──────────────────────────────────────

interface AgentSchedule {
  name: string;
  run: () => Promise<any[]>;
  intervalMs: number;        // How often to run
  description: string;
}

const AGENTS: AgentSchedule[] = [
  {
    name: 'quotation-checker',
    run: runQuotationChecker,
    intervalMs: 5 * 60 * 1000,      // Every 5 minutes (runs on order creation too)
    description: 'Checks quotation math for new orders',
  },
  {
    name: 'purchasing-agent',
    run: runPurchasingAgent,
    intervalMs: 60 * 60 * 1000,     // Every hour
    description: 'Tracks purchasing status for orders waiting to start production',
  },
  {
    name: 'production-agent',
    run: runProductionAgent,
    intervalMs: 30 * 60 * 1000,     // Every 30 minutes — Hermes Claw adaptive frequency
    description: 'Monitors production progress with adaptive reminders that tighten as deadlines approach',
  },
  {
    name: 'inventory-agent',
    run: runInventoryAgent,
    intervalMs: 60 * 60 * 1000,     // Every hour
    description: 'Tracks inventory arrival',
  },
  {
    name: 'delivery-agent',
    run: runDeliveryAgent,
    intervalMs: 60 * 60 * 1000,     // Every hour
    description: 'Tracks delivery scheduling and status',
  },
  {
    name: 'collection-agent',
    run: runCollectionAgent,
    intervalMs: 60 * 60 * 1000,     // Every hour
    description: 'Tracks payment collection',
  },
  {
    name: 'escalation-agent',
    run: runEscalationAgent,
    intervalMs: 4 * 60 * 60 * 1000, // Every 4 hours
    description: 'Monitors stalled orders and escalates',
  },
  {
    name: 'supabase-backup',
    run: runSupabaseBackup,
    intervalMs: 24 * 60 * 60 * 1000, // Every 24 hours
    description: 'Dumps PostgreSQL database and uploads to Supabase Storage for off-site backup',
  },
];

// ── Scheduler State ───────────────────────────────────────────────────

const lastRun: Record<string, number> = {};
const consecutiveErrors: Record<string, number> = {};
let schedulerTimer: NodeJS.Timeout | null = null;

// ── Run All Agents ────────────────────────────────────────────────────

async function runAgent(agent: AgentSchedule): Promise<void> {
  const start = Date.now();
  try {
    console.log(`[AgentScheduler] Running ${agent.name}...`);
    const results = await agent.run();
    const duration = Date.now() - start;

    // Reset consecutive errors on success
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

    // Exponential backoff: skip next run if too many consecutive errors
    if (errCount >= 5) {
      console.warn(`[AgentScheduler] ${agent.name} has ${errCount} consecutive errors — extending interval by ${Math.min(errCount, 10)}x`);
      // Reset lastRun to now so it won't retry for a longer period
      lastRun[agent.name] = Date.now();
    }
  }
}

function checkAndRunAgents(): void {
  const now = Date.now();

  for (const agent of AGENTS) {
    const last = lastRun[agent.name] ?? 0;
    const errCount = consecutiveErrors[agent.name] ?? 0;

    // Apply exponential backoff multiplier for agents with errors
    let effectiveInterval = agent.intervalMs;
    if (errCount >= 5) {
      effectiveInterval = agent.intervalMs * Math.min(errCount, 10);
    }

    if (now - last >= effectiveInterval) {
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

  console.log(`[AgentScheduler] Starting — checking every ${checkIntervalMs / 1000}s`);

  // Run all agents immediately on startup
  for (const agent of AGENTS) {
    lastRun[agent.name] = 0; // Force immediate run
  }
  checkAndRunAgents();

  // Then check on interval
  schedulerTimer = setInterval(checkAndRunAgents, checkIntervalMs);
}

export function stopAgentScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log('[AgentScheduler] Stopped');
  }
}

// ── Manual Trigger (for API endpoint) ─────────────────────────────────

export async function runAgentByName(name: string): Promise<{ ok: boolean; message: string; results?: any[] }> {
  const agent = AGENTS.find((a) => a.name === name);
  if (!agent) {
    return { ok: false, message: `Unknown agent: ${name}. Available: ${AGENTS.map((a) => a.name).join(', ')}` };
  }

  lastRun[agent.name] = Date.now();
  consecutiveErrors[agent.name] = 0; // Reset errors on manual trigger
  try {
    const results = await agent.run();
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

export function getAgentHealth(): { name: string; lastRun: number; consecutiveErrors: number; healthy: boolean }[] {
  return AGENTS.map((a) => ({
    name: a.name,
    lastRun: lastRun[a.name] ?? 0,
    consecutiveErrors: consecutiveErrors[a.name] ?? 0,
    healthy: (consecutiveErrors[a.name] ?? 0) < 5,
  }));
}
