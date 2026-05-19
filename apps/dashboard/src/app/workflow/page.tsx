'use client';

import { useOrders, useAgents, useAgentHealth, type AgentInfo, type AgentHealth } from '@/lib/useApi';
import { STAGE_CONFIG, STAGE_ORDER } from '@/lib/api';
import {
  ArrowRight,
  Bot,
  Search,
  ShoppingCart,
  Package,
  Truck,
  DollarSign,
  TrendingUp,
  CheckCircle,
  AlertCircle,
  Clock,
  RefreshCw,
  FileText,
  UserCheck,
  CreditCard,
  ClipboardList,
  MapPin,
  Smartphone,
  MessageSquare,
} from 'lucide-react';
import { useState } from 'react';

// ── Agent-to-Stage Mapping ──────────────────────────────────────────
interface AgentMapping {
  name: string;
  icon: typeof Bot;
  color: string;
  headingColor: string;
  description: string;
  monitors: string[];
  triggers: { from: string; to: string; condition: string }[];
  notificationGroup: string;
}

const AGENT_MAPPINGS: AgentMapping[] = [
  {
    name: 'quotation-checker',
    icon: Search,
    color: 'border-blue-200 bg-blue-50',
    headingColor: 'text-blue-700',
    description: 'Verifies quotation math and checks for discrepancies',
    monitors: ['quotation_received'],
    triggers: [
      { from: 'quotation_received', to: 'math_verified', condition: 'Math matches (auto)' },
      { from: 'quotation_received', to: 'purchasing_pending', condition: 'Math verified → auto-advance' },
    ],
    notificationGroup: 'Sales / Purchasing',
  },
  {
    name: 'purchasing-agent',
    icon: ShoppingCart,
    color: 'border-amber-200 bg-amber-50',
    headingColor: 'text-amber-700',
    description: 'Monitors purchasing progress and sends reminders',
    monitors: ['purchasing_pending', 'production_confirmed'],
    triggers: [
      { from: 'purchasing_pending', to: 'production_confirmed', condition: 'Team replies /produce yes' },
    ],
    notificationGroup: 'Purchasing',
  },
  {
    name: 'inventory-agent',
    icon: Package,
    color: 'border-cyan-200 bg-cyan-50',
    headingColor: 'text-cyan-700',
    description: 'Detects inventory arrival files and auto-advances',
    monitors: ['inventory_arrived'],
    triggers: [
      { from: 'inventory_arrived', to: 'balance_due', condition: 'Inventory files uploaded (auto)' },
    ],
    notificationGroup: 'Inventory',
  },
  {
    name: 'delivery-agent',
    icon: Truck,
    color: 'border-purple-200 bg-purple-50',
    headingColor: 'text-purple-700',
    description: 'Tracks delivery scheduling and delivery confirmation',
    monitors: ['delivery_scheduled', 'delivered'],
    triggers: [
      { from: 'delivery_scheduled', to: 'delivered', condition: 'Team replies /delivered yes' },
      { from: 'delivered', to: 'countered', condition: 'Delivery countered (auto)' },
    ],
    notificationGroup: 'Delivery',
  },
  {
    name: 'collection-agent',
    icon: DollarSign,
    color: 'border-emerald-200 bg-emerald-50',
    headingColor: 'text-emerald-700',
    description: 'Monitors payment collection and confirmation',
    monitors: ['countered', 'payment_received'],
    triggers: [
      { from: 'countered', to: 'payment_received', condition: 'Team replies /payment confirmed' },
      { from: 'payment_received', to: 'payment_confirmed', condition: 'Payment verified' },
    ],
    notificationGroup: 'Collection',
  },
  {
    name: 'escalation-agent',
    icon: TrendingUp,
    color: 'border-rose-200 bg-rose-50',
    headingColor: 'text-rose-700',
    description: 'Escalates stale orders that have not progressed',
    monitors: ['purchasing_pending', 'deposit_pending', 'balance_due', 'delivery_scheduled', 'countered'],
    triggers: [
      { from: '*', to: '*', condition: 'Escalation level increases per missed reminder' },
    ],
    notificationGroup: 'All Groups',
  },
];

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

// ── Stage transition rules (manual / auto) ─────────────────────────
interface StageInfo {
  stage: string;
  entryAction: string;
  exitCondition: string;
  triggeredBy: string;
  responsibleParty: string;
  autoAdvance: boolean;
}

const STAGE_INFO: Record<string, StageInfo> = {
  quotation_received: {
    stage: 'quotation_received',
    entryAction: 'Sales forwards approved quotation to Purchasing group',
    exitCondition: 'Quotation math verified (auto)',
    triggeredBy: 'Telegram Bot / Sales',
    responsibleParty: 'Sales Team',
    autoAdvance: true,
  },
  math_verified: {
    stage: 'math_verified',
    entryAction: 'System checks quotation math against computed_amount',
    exitCondition: 'Auto-advance to purchasing_pending',
    triggeredBy: 'Quotation Checker Agent',
    responsibleParty: 'System (Auto)',
    autoAdvance: true,
  },
  purchasing_pending: {
    stage: 'purchasing_pending',
    entryAction: 'Reminder sent to Purchasing group daily',
    exitCondition: 'Team confirms production started (/produce yes)',
    triggeredBy: 'Purchasing Agent / Team',
    responsibleParty: 'Purchasing Team',
    autoAdvance: false,
  },
  production_confirmed: {
    stage: 'production_confirmed',
    entryAction: 'Production timeline recorded',
    exitCondition: 'Deposit payment recorded (/deposit)',
    triggeredBy: 'Team',
    responsibleParty: 'Purchasing Team',
    autoAdvance: false,
  },
  deposit_pending: {
    stage: 'deposit_pending',
    entryAction: 'Reminder sent for deposit payment',
    exitCondition: 'Deposit amount recorded via bot or image upload',
    triggeredBy: 'Team / Telegram Bot',
    responsibleParty: 'Sales / Finance',
    autoAdvance: false,
  },
  inventory_arrived: {
    stage: 'inventory_arrived',
    entryAction: 'Inventory sends arrival photos/files to bot',
    exitCondition: 'Files detected → auto-advance to balance_due',
    triggeredBy: 'Inventory Agent (Auto)',
    responsibleParty: 'Inventory Team',
    autoAdvance: true,
  },
  balance_due: {
    stage: 'balance_due',
    entryAction: 'Reminder sent for remaining balance payment',
    exitCondition: 'Balance paid via /paybalance',
    triggeredBy: 'Team',
    responsibleParty: 'Sales / Finance',
    autoAdvance: false,
  },
  delivery_scheduled: {
    stage: 'delivery_scheduled',
    entryAction: 'Delivery date set via /deliverydate',
    exitCondition: 'Delivery confirmed via /delivered',
    triggeredBy: 'Team',
    responsibleParty: 'Delivery Team',
    autoAdvance: false,
  },
  delivered: {
    stage: 'delivered',
    entryAction: 'Delivery photos/receipt uploaded',
    exitCondition: 'Marked as countered or not',
    triggeredBy: 'Delivery Agent / Team',
    responsibleParty: 'Delivery Team',
    autoAdvance: false,
  },
  countered: {
    stage: 'countered',
    entryAction: 'Delivery countered — collection reminder starts',
    exitCondition: 'Payment confirmed via /payment confirmed',
    triggeredBy: 'Delivery Agent (Auto)',
    responsibleParty: 'Collection Team',
    autoAdvance: false,
  },
  payment_received: {
    stage: 'payment_received',
    entryAction: 'Payment proof uploaded',
    exitCondition: 'Payment verified and confirmed',
    triggeredBy: 'Team',
    responsibleParty: 'Finance Team',
    autoAdvance: false,
  },
  payment_confirmed: {
    stage: 'payment_confirmed',
    entryAction: 'Payment verified',
    exitCondition: 'Order marked completed',
    triggeredBy: 'System (Auto)',
    responsibleParty: 'System (Auto)',
    autoAdvance: true,
  },
  completed: {
    stage: 'completed',
    entryAction: 'Order finalized — all reminders disabled',
    exitCondition: '—',
    triggeredBy: 'System (Auto)',
    responsibleParty: '—',
    autoAdvance: false,
  },
};

// ── Helpers ─────────────────────────────────────────────────────────
function formatInterval(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `Every ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `Every ${hours} hour${hours > 1 ? 's' : ''}`;
}

// ── Components ──────────────────────────────────────────────────────

function StageNode({
  stage,
  index,
  count,
  isLast,
}: {
  stage: string;
  index: number;
  count: number;
  isLast: boolean;
}) {
  const config = STAGE_CONFIG[stage];
  const info = STAGE_INFO[stage];
  return (
    <div className="flex items-start gap-0">
      {/* Stage card */}
      <div className={`min-w-[180px] flex-1 rounded-xl border-2 p-4 transition-shadow hover:shadow-md ${
        info?.autoAdvance ? 'border-green-300 bg-green-50/30' : 'border-gray-200 bg-white'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">{config?.icon ?? '📋'}</span>
            <div>
              <p className="text-xs font-semibold text-gray-800">{config?.label ?? stage}</p>
              <p className="text-[10px] text-gray-400">
                {info?.autoAdvance ? '🤖 Auto' : '👤 Manual'}
              </p>
            </div>
          </div>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-600">
            {count}
          </span>
        </div>

        {/* Responsible party */}
        <div className="mt-2 flex items-center gap-1 text-[10px] text-gray-500">
          <UserCheck className="h-3 w-3" />
          <span>{info?.responsibleParty ?? '—'}</span>
        </div>

        {/* Exit condition */}
        {info && !isLast && (
          <div className="mt-1.5 text-[9px] leading-tight text-gray-400">
            <span className="font-medium text-gray-500">→ </span>
            {info.exitCondition}
          </div>
        )}
      </div>

      {/* Arrow connector */}
      {!isLast && (
        <div className="flex items-center px-1 pt-5">
          <ArrowRight className="h-4 w-4 text-gray-300" />
        </div>
      )}
    </div>
  );
}

function AgentMappingCard({ mapping, health }: { mapping: AgentMapping; health?: AgentHealth }) {
  const Icon = mapping.icon;
  return (
    <div className={`rounded-xl border-2 ${mapping.color} p-4 transition-shadow hover:shadow-md`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm">
            <Icon className={`h-4 w-4 ${mapping.headingColor}`} />
          </div>
          <div>
            <h4 className={`text-xs font-semibold ${mapping.headingColor}`}>
              {mapping.name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </h4>
            <p className="text-[10px] text-gray-500">{mapping.description}</p>
          </div>
        </div>
        {health && (
          health.healthy ? (
            <CheckCircle className="h-4 w-4 text-green-500" />
          ) : (
            <AlertCircle className="h-4 w-4 text-red-500" />
          )
        )}
      </div>

      {/* Monitored stages */}
      <div className="mt-3">
        <p className="mb-1 text-[10px] font-medium text-gray-600">Monitors:</p>
        <div className="flex flex-wrap gap-1">
          {mapping.monitors.map((s) => (
            <span
              key={s}
              className="rounded-md bg-white/70 px-2 py-0.5 text-[9px] font-medium text-gray-600"
            >
              {STAGE_CONFIG[s]?.icon} {STAGE_CONFIG[s]?.label ?? s}
            </span>
          ))}
        </div>
      </div>

      {/* Triggers */}
      <div className="mt-2">
        <p className="mb-1 text-[10px] font-medium text-gray-600">Triggers:</p>
        <ul className="space-y-0.5">
          {mapping.triggers.map((t, i) => (
            <li key={i} className="flex items-start gap-1 text-[9px] text-gray-500">
              <ArrowRight className="mt-0.5 h-2.5 w-2.5 shrink-0 text-gray-400" />
              <span>
                <span className="font-medium text-gray-600">
                  {STAGE_CONFIG[t.from]?.icon} {STAGE_CONFIG[t.from]?.label ?? t.from}
                </span>
                {' → '}
                <span className="font-medium text-gray-600">
                  {STAGE_CONFIG[t.to]?.icon} {STAGE_CONFIG[t.to]?.label ?? t.to}
                </span>
                <br />
                <span className="italic">{t.condition}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Notification group */}
      <div className="mt-2 flex items-center gap-1 text-[9px] text-gray-400">
        <MessageSquare className="h-3 w-3" />
        <span>Notifies: {mapping.notificationGroup}</span>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────
export default function WorkflowPage() {
  const { data: orders = [], isLoading: ordersLoading } = useOrders();
  const { data: agents } = useAgents();
  const { data: healthData, mutate: refreshHealth } = useAgentHealth();
  const [activeTab, setActiveTab] = useState<'pipeline' | 'agents' | 'orders'>('pipeline');

  // Parse health data
  const healthMap: Record<string, AgentHealth> = {};
  if (healthData && Array.isArray(healthData)) {
    for (const h of healthData as any) {
      if (h.name) healthMap[h.name] = h;
    }
  } else if (healthData && (healthData as any).agents) {
    for (const h of (healthData as any).agents) {
      if (h.name) healthMap[h.name] = h;
    }
  }

  // Group orders by stage
  const stageGroups: Record<string, typeof orders> = {};
  STAGE_ORDER.forEach((stage) => {
    stageGroups[stage] = orders.filter((o) => o.current_stage === stage);
  });

  const activeOrders = orders.filter((o) => o.status === 'active');
  const completedOrders = orders.filter((o) => o.status === 'completed');

  const TABS = [
    { key: 'pipeline' as const, label: 'Stage Pipeline', icon: ClipboardList },
    { key: 'agents' as const, label: 'Agent Mapping', icon: Bot },
    { key: 'orders' as const, label: 'Working Tree', icon: FileText },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Working Tree & Workflow</h1>
          <p className="mt-1 text-sm text-gray-500">
            End-to-end order lifecycle — stages, agents, and transition rules
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

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Tab: Stage Pipeline ─────────────────────────────────── */}
      {activeTab === 'pipeline' && (
        <div className="space-y-6">
          {/* Pipeline visualization */}
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-800">Stage Flow</h2>
            <div className="flex gap-0" style={{ minWidth: '1100px' }}>
              {STAGE_ORDER.map((stage, index) => (
                <StageNode
                  key={stage}
                  stage={stage}
                  index={index}
                  count={stageGroups[stage]?.length ?? 0}
                  isLast={index === STAGE_ORDER.length - 1}
                />
              ))}
            </div>
            <div className="mt-4 flex items-center gap-4 text-[10px] text-gray-400">
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded border-2 border-green-300 bg-green-50" />
                Auto-advance (agent-driven)
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded border-2 border-gray-200 bg-white" />
                Manual (team action required)
              </span>
            </div>
          </div>

          {/* Stage detail table */}
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-800">Stage Details</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-100 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    <th className="pb-2 pr-4">Stage</th>
                    <th className="pb-2 pr-4">Entry Action</th>
                    <th className="pb-2 pr-4">Exit Condition</th>
                    <th className="pb-2 pr-4">Triggered By</th>
                    <th className="pb-2 pr-4">Responsible</th>
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2 pr-4">Orders</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {STAGE_ORDER.map((stage) => {
                    const config = STAGE_CONFIG[stage];
                    const info = STAGE_INFO[stage];
                    const count = stageGroups[stage]?.length ?? 0;
                    return (
                      <tr key={stage} className="hover:bg-gray-50">
                        <td className="py-2.5 pr-4 font-medium text-gray-800">
                          <span className="mr-1">{config?.icon}</span>
                          {config?.label ?? stage}
                        </td>
                        <td className="py-2.5 pr-4 text-gray-600">{info?.entryAction ?? '—'}</td>
                        <td className="py-2.5 pr-4 text-gray-600">{info?.exitCondition ?? '—'}</td>
                        <td className="py-2.5 pr-4 text-gray-600">{info?.triggeredBy ?? '—'}</td>
                        <td className="py-2.5 pr-4 text-gray-600">{info?.responsibleParty ?? '—'}</td>
                        <td className="py-2.5 pr-4">
                          {info?.autoAdvance ? (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[9px] font-medium text-green-700">
                              Auto
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-medium text-amber-700">
                              Manual
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-medium text-gray-600">
                            {count}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Agent Mapping ──────────────────────────────────── */}
      {activeTab === 'agents' && (
        <div className="space-y-6">
          {/* Agent cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {AGENT_MAPPINGS.map((mapping) => (
              <AgentMappingCard
                key={mapping.name}
                mapping={mapping}
                health={healthMap[mapping.name]}
              />
            ))}
          </div>

          {/* Escalation reference */}
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-3 text-sm font-semibold text-gray-800">Escalation Levels</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-100 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    <th className="pb-2 pr-4">Reminder #</th>
                    <th className="pb-2 pr-4">Level</th>
                    <th className="pb-2 pr-4">Indicator</th>
                    <th className="pb-2 pr-4">Message</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  <tr className="hover:bg-gray-50">
                    <td className="py-2.5 pr-4 font-medium text-gray-800">1st</td>
                    <td className="py-2.5 pr-4 text-gray-600">Level 0</td>
                    <td className="py-2.5 pr-4 text-gray-500">—</td>
                    <td className="py-2.5 pr-4 text-gray-600">Normal reminder</td>
                  </tr>
                  <tr className="hover:bg-gray-50">
                    <td className="py-2.5 pr-4 font-medium text-gray-800">2nd</td>
                    <td className="py-2.5 pr-4 text-gray-600">Level 1</td>
                    <td className="py-2.5 pr-4 text-red-500">🔴</td>
                    <td className="py-2.5 pr-4 text-gray-600">Slight urgency</td>
                  </tr>
                  <tr className="hover:bg-gray-50">
                    <td className="py-2.5 pr-4 font-medium text-gray-800">3rd</td>
                    <td className="py-2.5 pr-4 text-gray-600">Level 2</td>
                    <td className="py-2.5 pr-4 text-red-500">🔴🔴</td>
                    <td className="py-2.5 pr-4 text-gray-600">Higher urgency</td>
                  </tr>
                  <tr className="hover:bg-gray-50">
                    <td className="py-2.5 pr-4 font-medium text-gray-800">4th+</td>
                    <td className="py-2.5 pr-4 text-gray-600">Level 3+</td>
                    <td className="py-2.5 pr-4 text-red-500">🔴🔴🔴</td>
                    <td className="py-2.5 pr-4 text-gray-600">Critical — escalated</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Agent schedule summary */}
          {agents && agents.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <h2 className="mb-3 text-sm font-semibold text-gray-800">Agent Schedule</h2>
              <div className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-3 lg:grid-cols-6">
                {agents.map((agent: AgentInfo) => (
                  <div key={agent.name} className="rounded-lg border border-gray-100 p-3 text-center">
                    <p className="font-medium text-gray-700">
                      {agent.name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    </p>
                    <p className="mt-1 text-[10px] text-gray-400">{formatInterval(agent.intervalMs)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Working Tree ───────────────────────────────────── */}
      {activeTab === 'orders' && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-500">Total Orders</p>
              <p className="text-2xl font-bold text-gray-900">{orders.length}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-500">Active</p>
              <p className="text-2xl font-bold text-blue-600">{activeOrders.length}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-500">Completed</p>
              <p className="text-2xl font-bold text-green-600">{completedOrders.length}</p>
            </div>
          </div>

          {/* Orders grouped by stage */}
          {ordersLoading && orders.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2490ef]" />
            </div>
          ) : (
            STAGE_ORDER.map((stage) => {
              const config = STAGE_CONFIG[stage];
              const stageOrders = stageGroups[stage] ?? [];
              if (stageOrders.length === 0) return null;
              return (
                <div key={stage} className="rounded-xl border border-gray-200 bg-white p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-base">{config?.icon}</span>
                    <h3 className="text-sm font-semibold text-gray-800">
                      {config?.label ?? stage}
                    </h3>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                      {stageOrders.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {stageOrders.map((order) => (
                      <a
                        key={order.id}
                        href={`/orders/${encodeURIComponent(order.quotation_number ?? order.id)}`}
                        className="block rounded-lg border border-gray-100 bg-gray-50 p-3 transition-colors hover:border-gray-200 hover:bg-white"
                      >
                        <p className="text-xs font-medium text-gray-900">
                          {order.quotation_number ?? '—'}
                        </p>
                        <p className="mt-0.5 text-[10px] text-gray-500">
                          {order.client_name ?? 'Unknown'}
                        </p>
                        {order.total_amount != null && (
                          <p className="mt-0.5 text-[10px] font-medium text-gray-600">
                            ₱{Number(order.total_amount).toLocaleString()}
                          </p>
                        )}
                        <div className="mt-1 flex items-center gap-2 text-[9px] text-gray-400">
                          <Clock className="h-3 w-3" />
                          <span>
                            {new Date(order.created_at).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              );
            })
          )}

          {/* Empty state */}
          {!ordersLoading && orders.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <FileText className="mb-3 h-12 w-12" />
              <p className="text-sm">No orders in the system yet</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
