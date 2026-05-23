'use client';

import { useState } from 'react';
import { useAgents, useAgentHealth, type AgentInfo, type AgentHealth } from '@/lib/useApi';
import { runAgent } from '@/lib/api';
import OtpModal from '@/components/OtpModal';
import {
  Activity,
  Play,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
  Brain,
  Bot,
  Search,
  ShoppingCart,
  Package,
  Truck,
  DollarSign,
  TrendingUp,
} from 'lucide-react';

const AGENT_ICONS: Record<string, typeof Bot> = {
  'quotation-checker': Search,
  'purchasing-agent': ShoppingCart,
  'inventory-agent': Package,
  'delivery-agent': Truck,
  'collection-agent': DollarSign,
  'escalation-agent': TrendingUp,
};

const AGENT_COLORS: Record<string, string> = {
  'quotation-checker': 'border-blue-200 bg-blue-50',
  'purchasing-agent': 'border-amber-200 bg-amber-50',
  'inventory-agent': 'border-cyan-200 bg-cyan-50',
  'delivery-agent': 'border-purple-200 bg-purple-50',
  'collection-agent': 'border-emerald-200 bg-emerald-50',
  'escalation-agent': 'border-rose-200 bg-rose-50',
};

const AGENT_HEADING_COLORS: Record<string, string> = {
  'quotation-checker': 'text-blue-700',
  'purchasing-agent': 'text-amber-700',
  'inventory-agent': 'text-cyan-700',
  'delivery-agent': 'text-purple-700',
  'collection-agent': 'text-emerald-700',
  'escalation-agent': 'text-rose-700',
};

function formatInterval(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `Every ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `Every ${hours} hour${hours > 1 ? 's' : ''}`;
}

function formatLastRun(ts: number): string {
  if (!ts) return 'Never';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hour${Math.floor(diff / 3_600_000) > 1 ? 's' : ''} ago`;
  return `${Math.floor(diff / 86_400_000)} day${Math.floor(diff / 86_400_000) > 1 ? 's' : ''} ago`;
}

function AgentCard({
  agent,
  health,
  onRun,
  running,
}: {
  agent: AgentInfo;
  health: AgentHealth | undefined;
  onRun: () => void;
  running: boolean;
}) {
  const Icon = AGENT_ICONS[agent.name] ?? Bot;
  const colorClass = AGENT_COLORS[agent.name] ?? 'border-gray-200 bg-gray-50';
  const headingColor = AGENT_HEADING_COLORS[agent.name] ?? 'text-gray-700';

  return (
    <div className={`rounded-xl border-2 ${colorClass} p-5 transition-shadow hover:shadow-md`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-sm">
            <Icon className={`h-5 w-5 ${headingColor}`} />
          </div>
          <div>
            <h3 className={`text-sm font-semibold ${headingColor}`}>
              {agent.name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </h3>
            <p className="text-xs text-gray-500">{agent.description}</p>
          </div>
        </div>

        {/* Health indicator */}
        <div className="flex items-center gap-1.5">
          {health ? (
            health.healthy ? (
              <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                <CheckCircle className="h-3.5 w-3.5" />
                Healthy
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-medium text-red-600">
                <AlertCircle className="h-3.5 w-3.5" />
                {health.consecutiveErrors} errors
              </span>
            )
          ) : (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Clock className="h-3.5 w-3.5" />
              Unknown
            </span>
          )}
        </div>
      </div>

      {/* Details */}
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-gray-500">
        <div>
          <span className="font-medium text-gray-700">Schedule:</span>{' '}
          {formatInterval(agent.intervalMs)}
        </div>
        <div>
          <span className="font-medium text-gray-700">Last Run:</span>{' '}
          {health ? formatLastRun(health.lastRun) : '—'}
        </div>
        {health && health.consecutiveErrors > 0 && (
          <div className="col-span-2">
            <span className="font-medium text-red-600">Errors:</span>{' '}
            <span className="text-red-500">{health.consecutiveErrors} consecutive</span>
          </div>
        )}
      </div>

      {/* Run button */}
      <div className="mt-4 flex justify-end">
        <button
          onClick={onRun}
          disabled={running}
          className="flex items-center gap-1.5 rounded-lg bg-white border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {running ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {running ? 'Running…' : 'Run Now'}
        </button>
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const { data: agents, error: agentsError, isLoading: agentsLoading } = useAgents();
  const { data: healthData, mutate: refreshHealth } = useAgentHealth();
  const [runningAgents, setRunningAgents] = useState<Record<string, boolean>>({});
  const [runResult, setRunResult] = useState<{ name: string; ok: boolean; message: string } | null>(null);
  const [otpModal, setOtpModal] = useState<{ open: boolean; agentName: string }>({ open: false, agentName: '' });

  // Parse health data — the /health endpoint returns { agents: [...] }
  const healthMap: Record<string, AgentHealth> = {};
  const healthPayload = healthData as AgentHealth[] | { agents?: AgentHealth[] } | undefined;
  if (Array.isArray(healthPayload)) {
    // If /health returns array directly (unlikely but handle)
    for (const h of healthPayload) {
      if (h.name) healthMap[h.name] = h;
    }
  } else if (healthPayload?.agents) {
    for (const h of healthPayload.agents) {
      if (h.name) healthMap[h.name] = h;
    }
  }

  function handleRunAgent(name: string) {
    setOtpModal({ open: true, agentName: name });
  }

  async function executeRunAgent(actionToken: string) {
    const name = otpModal.agentName;
    if (!name) return;
    setOtpModal({ open: false, agentName: '' });
    setRunningAgents((prev) => ({ ...prev, [name]: true }));
    setRunResult(null);
    try {
      const data = await runAgent(name, actionToken);
      setRunResult({ name, ok: data.ok, message: data.message ?? (data.ok ? 'Completed' : 'Failed') });
      refreshHealth();
    } catch (err) {
      setRunResult({
        name,
        ok: false,
        message: err instanceof Error ? err.message : 'Network error',
      });
    } finally {
      setRunningAgents((prev) => ({ ...prev, [name]: false }));
    }
  }

  if (agentsLoading && !agents) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
      </div>
    );
  }

  if (agentsError && !agents) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-red-500">Failed to load agents. Retrying...</p>
      </div>
    );
  }

  const agentList = agents ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agent Management</h1>
          <p className="mt-1 text-sm text-gray-500">
            Monitor and manually trigger automated agents
          </p>
        </div>
        <button
          onClick={() => refreshHealth()}
          className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Run result toast */}
      {runResult && (
        <div
          className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
            runResult.ok
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {runResult.ok ? (
            <CheckCircle className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span>
            <strong>{runResult.name}:</strong> {runResult.message}
          </span>
          <button
            onClick={() => setRunResult(null)}
            className="ml-auto text-xs underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Agent Cards */}
      {agentList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Brain className="mb-3 h-12 w-12" />
          <p className="text-sm">No agents configured</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agentList.map((agent) => (
            <AgentCard
              key={agent.name}
              agent={agent}
              health={healthMap[agent.name]}
              onRun={() => handleRunAgent(agent.name)}
              running={!!runningAgents[agent.name]}
            />
          ))}
        </div>
      )}

      {/* Summary */}
      {agentList.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-gray-800">System Overview</h2>
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <p className="text-xs text-gray-500">Total Agents</p>
              <p className="text-lg font-bold text-gray-900">{agentList.length}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Healthy</p>
              <p className="text-lg font-bold text-green-600">
                {Object.values(healthMap).filter((h) => h.healthy).length}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Unhealthy</p>
              <p className="text-lg font-bold text-red-600">
                {Object.values(healthMap).filter((h) => !h.healthy).length}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Total Errors</p>
              <p className="text-lg font-bold text-amber-600">
                {Object.values(healthMap).reduce((sum, h) => sum + h.consecutiveErrors, 0)}
              </p>
            </div>
          </div>
        </div>
      )}

      <OtpModal
        open={otpModal.open}
        title="Run Agent"
        description={`Confirm manually running agent "${otpModal.agentName.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}". Enter the OTP sent to your email to confirm.`}
        onVerified={executeRunAgent}
        onClose={() => setOtpModal({ open: false, agentName: '' })}
      />
    </div>
  );
}
