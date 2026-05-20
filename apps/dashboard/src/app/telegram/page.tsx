'use client';

import { useOrders, useReminders, useAgents, useAgentHealth, type AgentInfo, type AgentHealth } from '@/lib/useApi';
import { STAGE_CONFIG, STAGE_ORDER } from '@/lib/api';
import {
  ArrowRight, Bot, Search, ShoppingCart, Factory, Package, Truck, DollarSign, TrendingUp,
  CheckCircle, AlertCircle, RefreshCw, MessageSquare, Smartphone, Bell, Keyboard, Users, AlertTriangle,
} from 'lucide-react';
import { useState } from 'react';

interface TelegramGroup {
  name: string; envVar: string; agents: string[]; stages: string[]; color: string; icon: typeof MessageSquare;
}
const TELEGRAM_GROUPS: TelegramGroup[] = [
  { name: 'Quotation Group', envVar: 'QUOTATION_GROUP_CHAT_ID', agents: ['quotation-checker'], stages: ['order_confirmation_received', 'math_verified'], color: 'border-blue-200 bg-blue-50', icon: Search },
  { name: 'Purchasing Group', envVar: 'PURCHASING_GROUP_CHAT_ID', agents: ['purchasing-agent'], stages: ['purchasing_pending'], color: 'border-amber-200 bg-amber-50', icon: ShoppingCart },
  { name: 'Production Group', envVar: 'PRODUCTION_GROUP_CHAT_ID', agents: ['production-agent'], stages: ['production_confirmed', 'en_route'], color: 'border-indigo-200 bg-indigo-50', icon: Factory },
  { name: 'Inventory Group', envVar: 'INVENTORY_GROUP_CHAT_ID', agents: ['inventory-agent'], stages: ['inventory_arrived'], color: 'border-cyan-200 bg-cyan-50', icon: Package },
  { name: 'Delivery Group', envVar: 'DELIVERY_GROUP_CHAT_ID', agents: ['delivery-agent'], stages: ['balance_due', 'delivery_scheduled', 'delivered'], color: 'border-purple-200 bg-purple-50', icon: Truck },
  { name: 'Collection Group', envVar: 'COLLECTION_GROUP_CHAT_ID', agents: ['collection-agent'], stages: ['deposit_pending', 'countered', 'payment_received', 'payment_confirmed'], color: 'border-emerald-200 bg-emerald-50', icon: DollarSign },
  { name: 'Escalation Group', envVar: 'ESCALATION_GROUP_CHAT_ID', agents: ['escalation-agent'], stages: ['*'], color: 'border-rose-200 bg-rose-50', icon: TrendingUp },
];

interface InlineKeyboardMapping {
  stage: string; buttons: { text: string; action: string }[]; frequency: string; escalation: boolean; description: string;
}
const INLINE_KEYBOARD_MAPPINGS: InlineKeyboardMapping[] = [
  { stage: 'purchasing_pending', buttons: [{ text: '✅ Yes', action: 'Ask production days → advance to production_confirmed' }, { text: '❌ No', action: 'Acknowledge, continue daily reminders' }], frequency: 'daily', escalation: true, description: 'Has production or purchasing started?' },
  { stage: 'production_midpoint', buttons: [{ text: '✅ On Time', action: 'Continue adaptive reminders' }, { text: '⚠️ Delayed', action: 'Ask delay days, update production_delayed flag' }], frequency: 'once (adaptive)', escalation: false, description: 'Midpoint check — is production on time?' },
  { stage: 'production_due', buttons: [{ text: '✅ Finished', action: 'Ask delivery timeline → advance to en_route' }, { text: '❌ Not Yet', action: 'Acknowledge, continue adaptive reminders' }], frequency: 'once (adaptive)', escalation: false, description: 'Production due — is production finished?' },
  { stage: 'en_route_reminder', buttons: [{ text: '✅ Yes', action: 'Ask estimated arrival days → advance to inventory_arrived' }, { text: '❌ No', action: 'Acknowledge, continue adaptive reminders' }], frequency: 'adaptive (24h→12h→4h→2h)', escalation: false, description: 'Is the order en route to inventory?' },
  { stage: 'partial_production', buttons: [{ text: '📝 Update Items Produced', action: 'Prompt to list which items are now produced' }], frequency: 'daily (24h)', escalation: false, description: 'Partial production — update which items have been produced' },
  { stage: 'deposit_pending', buttons: [{ text: '✅ Yes, Upload Deposit Slip', action: 'Ask for deposit slip image → AI extract amount → record deposit' }, { text: '❌ Not Yet', action: 'Acknowledge, continue daily reminders' }], frequency: 'daily', escalation: true, description: 'Has the deposit been collected?' },
  { stage: 'inventory_arrived', buttons: [{ text: '✅ Ready for Delivery', action: 'Advance to balance_due, complete inventory reminders' }, { text: '⏳ Still Waiting', action: 'Acknowledge, continue daily reminders' }], frequency: 'daily', escalation: true, description: 'Have all products arrived? Ready for delivery?' },
  { stage: 'balance_due', buttons: [{ text: '✅ Yes, Client Paid', action: 'Ask proof photo → AI extract amount → record balance → advance to delivery_scheduled' }, { text: '❌ Not Yet', action: 'Acknowledge, continue daily reminders' }], frequency: 'daily', escalation: true, description: 'Has the client paid the remaining balance?' },
  { stage: 'delivery_scheduled', buttons: [{ text: '✅ Yes, Delivered', action: 'Advance to delivered' }, { text: '❌ Not Yet', action: 'Acknowledge, continue daily reminders' }], frequency: 'daily', escalation: true, description: 'Has the item been delivered?' },
  { stage: 'countered', buttons: [{ text: '💰 Payment Received', action: 'Advance to payment_received' }, { text: '⏳ Still Waiting', action: 'Acknowledge, continue daily reminders' }], frequency: 'daily', escalation: true, description: 'Has payment been received for the countered delivery?' },
  { stage: 'payment_received', buttons: [{ text: '✅ Confirm Payment', action: 'Advance to payment_confirmed → completed, disable all reminders' }, { text: '⏳ Still Pending', action: 'Acknowledge, continue daily reminders' }], frequency: 'daily', escalation: true, description: 'Has the payment been confirmed?' },
];

interface AgentGroupMapping { agentName: string; groupName: string; envVar: string; stages: string[]; }
const AGENT_GROUP_MAPPINGS: AgentGroupMapping[] = [
  { agentName: 'quotation-checker', groupName: 'Quotation Group', envVar: 'QUOTATION_GROUP_CHAT_ID', stages: ['order_confirmation_received', 'math_verified'] },
  { agentName: 'purchasing-agent', groupName: 'Purchasing Group', envVar: 'PURCHASING_GROUP_CHAT_ID', stages: ['purchasing_pending'] },
  { agentName: 'production-agent', groupName: 'Production Group', envVar: 'PRODUCTION_GROUP_CHAT_ID', stages: ['production_confirmed', 'en_route'] },
  { agentName: 'inventory-agent', groupName: 'Inventory Group', envVar: 'INVENTORY_GROUP_CHAT_ID', stages: ['inventory_arrived'] },
  { agentName: 'delivery-agent', groupName: 'Delivery Group', envVar: 'DELIVERY_GROUP_CHAT_ID', stages: ['balance_due', 'delivery_scheduled', 'delivered'] },
  { agentName: 'collection-agent', groupName: 'Collection Group', envVar: 'COLLECTION_GROUP_CHAT_ID', stages: ['deposit_pending', 'countered', 'payment_received', 'payment_confirmed'] },
  { agentName: 'escalation-agent', groupName: 'Escalation Group', envVar: 'ESCALATION_GROUP_CHAT_ID', stages: ['*'] },
];

const REMINDER_STAGE_LABELS: Record<string, string> = {
  order_confirmation_received: '📄 Order Confirmation Received', math_verified: '✅ Math Verified',
  purchasing_pending: '🛒 Purchasing Pending', production_confirmed: '🏭 Production Confirmed',
  production_midpoint: '🏭 Production Midpoint Check', production_due: '🏭 Production Due',
  deposit_pending: '💳 Deposit Pending', en_route: '🚚 En Route', en_route_reminder: '🚚 En Route',
  inventory_arrived: '📦 Inventory Arrived', balance_due: '⚖️ Balance Due',
  delivery_scheduled: '🚚 Delivery Scheduled', delivered: '✅ Delivered', countered: '🔄 Countered',
  payment_received: '💰 Payment Received', payment_confirmed: '💵 Payment Confirmed', partial_production: '🏭 Partial Production',
};

function formatInterval(ms: number): string {
  const m = Math.round(ms / 60_000); return m < 60 ? `Every ${m} min` : `Every ${Math.round(m / 60)}h`;
}

function StageFlowDiagram() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold text-gray-800">📋 Stage Flow with Telegram Group Assignment</h2>
      <div className="overflow-x-auto">
        <div className="flex gap-0" style={{ minWidth: '1200px' }}>
          {STAGE_ORDER.map((stage, index) => {
            const config = STAGE_CONFIG[stage];
            const group = TELEGRAM_GROUPS.find((g) => g.stages.includes(stage));
            const isLast = index === STAGE_ORDER.length - 1;
            return (
              <div key={stage} className="flex items-start gap-0">
                <div className={`min-w-[160px] flex-1 rounded-xl border-2 p-3 ${group ? group.color : 'border-gray-200 bg-white'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{config?.icon ?? '📋'}</span>
                    <div>
                      <p className="text-[10px] font-semibold text-gray-800 leading-tight">{config?.label ?? stage}</p>
                      {group && <p className="text-[8px] text-gray-500 mt-0.5 flex items-center gap-0.5"><MessageSquare className="h-2.5 w-2.5" />{group.name}</p>}
                    </div>
                  </div>
                </div>
                {!isLast && <div className="flex items-center px-1 pt-4"><ArrowRight className="h-3.5 w-3.5 text-gray-300" /></div>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] text-gray-400">
        {TELEGRAM_GROUPS.map((g) => (
          <span key={g.name} className={`flex items-center gap-1 rounded-md px-2 py-0.5 ${g.color}`}><MessageSquare className="h-3 w-3" />{g.name}</span>
        ))}
      </div>
    </div>
  );
}

function TelegramGroupCard({ group, stageCounts }: { group: TelegramGroup; stageCounts: Record<string, number> }) {
  const Icon = group.icon;
  const totalOrders = group.stages.includes('*')
    ? Object.values(stageCounts).reduce((s, c) => s + c, 0)
    : group.stages.reduce((s, st) => s + (stageCounts[st] ?? 0), 0);
  return (
    <div className={`rounded-xl border-2 ${group.color} p-4 transition-shadow hover:shadow-md`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm"><Icon className="h-4 w-4 text-gray-600" /></div>
          <div><h4 className="text-xs font-semibold text-gray-800">{group.name}</h4><p className="text-[10px] text-gray-500 font-mono">{group.envVar}</p></div>
        </div>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-[9px] font-bold text-gray-700">{totalOrders} orders</span>
      </div>
      <div className="mt-3">
        <p className="mb-1 text-[9px] font-medium text-gray-500 uppercase tracking-wider">Agents</p>
        <div className="flex flex-wrap gap-1">{group.agents.map((a) => <span key={a} className="rounded-md bg-white/80 px-2 py-0.5 text-[9px] font-medium text-gray-700 ring-1 ring-inset ring-gray-200">{a.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</span>)}</div>
      </div>
      <div className="mt-2">
        <p className="mb-1 text-[9px] font-medium text-gray-500 uppercase tracking-wider">{group.stages.includes('*') ? 'Monitors All Stages' : 'Stages'}</p>
        <div className="flex flex-wrap gap-1">
          {group.stages.includes('*') ? (
            <span className="rounded-md bg-white/80 px-2 py-0.5 text-[9px] font-medium text-gray-700">🌐 All non-terminal stages</span>
          ) : group.stages.map((s) => {
            const cfg = STAGE_CONFIG[s]; const cnt = stageCounts[s] ?? 0;
            return <span key={s} className={`rounded-md px-2 py-0.5 text-[9px] font-medium ${cnt > 0 ? 'bg-white text-gray-800 ring-1 ring-inset ring-gray-200' : 'bg-white/50 text-gray-400'}`}>{cfg?.icon} {cfg?.label ?? s}{cnt > 0 && <span className="ml-1 rounded-full bg-blue-100 px-1 text-[8px] font-bold text-blue-700">{cnt}</span>}</span>;
          })}
        </div>
      </div>
    </div>
  );
}

function InlineKeyboardCard({ mapping, stageCount }: { mapping: InlineKeyboardMapping; stageCount: number }) {
  const config = STAGE_CONFIG[mapping.stage];
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{config?.icon ?? '📋'}</span>
          <div><p className="text-xs font-semibold text-gray-800">{config?.label ?? mapping.stage}</p><p className="text-[9px] text-gray-400">{mapping.description}</p></div>
        </div>
        <div className="flex items-center gap-1">
          {stageCount > 0 && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-bold text-blue-700">{stageCount}</span>}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[8px] font-medium text-gray-500">{mapping.frequency}</span>
        </div>
      </div>
      <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-2">
        <p className="mb-1.5 text-[8px] font-medium text-gray-400 uppercase tracking-wider">Inline Keyboard</p>
        <div className="flex flex-wrap gap-1">
          {mapping.buttons.map((btn, i) => (
            <span key={i} className={`rounded-md px-2 py-1 text-[9px] font-medium ${btn.text.includes('✅') || btn.text.includes('💰') ? 'bg-green-100 text-green-700' : btn.text.includes('⚠️') || btn.text.includes('❌') || btn.text.includes('⏳') ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{btn.text}</span>
          ))}
        </div>
      </div>
      <div className="mt-2 space-y-1">
        {mapping.buttons.map((btn, i) => (
          <div key={i} className="flex items-start gap-1 text-[9px] text-gray-500">
            <ArrowRight className="mt-0.5 h-2.5 w-2.5 shrink-0 text-gray-400" />
            <span><span className="font-medium text-gray-600">{btn.text}</span> → {btn.action}</span>
          </div>
        ))}
      </div>
      {mapping.escalation && <div className="mt-2 flex items-center gap-1 text-[9px] text-amber-600"><AlertTriangle className="h-3 w-3" /><span>Escalation enabled — level increases after 3 missed reminders</span></div>}
    </div>
  );
}

function ReminderTable({ reminders }: { reminders: any[] }) {
  if (!reminders || reminders.length === 0) return <div className="flex flex-col items-center justify-center py-10 text-gray-400"><Bell className="mb-2 h-8 w-8" /><p className="text-xs">No active reminders</p></div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead><tr className="border-b border-gray-100 text-[9px] font-semibold uppercase tracking-wider text-gray-500">
          <th className="pb-2 pr-3">Order</th><th className="pb-2 pr-3">Client</th><th className="pb-2 pr-3">Stage</th><th className="pb-2 pr-3">Freq</th><th className="pb-2 pr-3">Next Run</th><th className="pb-2 pr-3">Esc</th><th className="pb-2 pr-3">Status</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-50">
          {reminders.map((r: any) => {
            const overdue = new Date(r.next_run_at) < new Date();
            return (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="py-2 pr-3 font-medium text-gray-800">{r.quotation_number ?? '—'}</td>
                <td className="py-2 pr-3 text-gray-600">{r.client_name ?? '—'}</td>
                <td className="py-2 pr-3"><span className="text-[10px]">{REMINDER_STAGE_LABELS[r.stage] ?? r.stage}</span></td>
                <td className="py-2 pr-3 text-gray-500">{r.frequency}</td>
                <td className={`py-2 pr-3 ${overdue ? 'text-red-500 font-medium' : 'text-gray-500'}`}>{new Date(r.next_run_at).toLocaleString()}{overdue && ' 🔴'}</td>
                <td className="py-2 pr-3">{r.escalation_level > 0 ? <span className="flex items-center gap-0.5">{'🔴'.repeat(Math.min(r.escalation_level, 3))}<span className="text-[9px] text-gray-500">Lv.{r.escalation_level}</span></span> : <span className="text-gray-400">—</span>}</td>
                <td className="py-2 pr-3"><span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${r.status === 'active' ? 'bg-green-100 text-green-700' : r.status === 'completed' ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-700'}`}>{r.status}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function TelegramPage() {
  const { data: orders = [] } = useOrders();
  const { data: reminders, mutate: refreshReminders } = useReminders();
  const { data: agents } = useAgents();
  const { data: healthData, mutate: refreshHealth } = useAgentHealth();
  const [activeTab, setActiveTab] = useState<'overview' | 'keyboards' | 'reminders' | 'groups'>('overview');

  const healthMap: Record<string, AgentHealth> = {};
  const hp = healthData as AgentHealth[] | { agents?: AgentHealth[] } | undefined;
  if (Array.isArray(hp)) { for (const h of hp) { if (h.name) healthMap[h.name] = h; } }
  else if (hp?.agents) { for (const h of hp.agents) { if (h.name) healthMap[h.name] = h; } }

  const stageCounts: Record<string, number> = {};
  STAGE_ORDER.forEach((s) => { stageCounts[s] = orders.filter((o) => o.current_stage === s).length; });

  const reminderCounts: Record<string, number> = {};
  if (reminders) { for (const r of reminders) { if (r.status === 'active') reminderCounts[r.stage] = (reminderCounts[r.stage] ?? 0) + 1; } }

  const TABS = [
    { key: 'overview' as const, label: 'Workflow Overview', icon: Smartphone },
    { key: 'keyboards' as const, label: 'Inline Keyboards', icon: Keyboard },
    { key: 'reminders' as const, label: 'Active Reminders', icon: Bell },
    { key: 'groups' as const, label: 'Telegram Groups', icon: Users },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">📱 Telegram Workflow Mapping</h1>
          <p className="mt-1 text-sm text-gray-500">Complete mapping of Telegram groups, inline keyboards, reminders, and agent assignments</p>
        </div>
        <button onClick={() => { refreshReminders(); refreshHealth(); }} className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><RefreshCw className="h-4 w-4" />Refresh</button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-blue-500" /><p className="text-xs text-gray-500">Telegram Groups</p></div>
          <p className="mt-1 text-2xl font-bold text-gray-900">{TELEGRAM_GROUPS.length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2"><Keyboard className="h-4 w-4 text-indigo-500" /><p className="text-xs text-gray-500">Inline Keyboards</p></div>
          <p className="mt-1 text-2xl font-bold text-gray-900">{INLINE_KEYBOARD_MAPPINGS.length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2"><Bell className="h-4 w-4 text-amber-500" /><p className="text-xs text-gray-500">Active Reminders</p></div>
          <p className="mt-1 text-2xl font-bold text-gray-900">{reminders ? reminders.filter((r: any) => r.status === 'active').length : '—'}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2"><Bot className="h-4 w-4 text-emerald-500" /><p className="text-xs text-gray-500">Automation Agents</p></div>
          <p className="mt-1 text-2xl font-bold text-gray-900">{agents?.length ?? '—'}</p>
        </div>
      </div>

      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Icon className="h-4 w-4" />{tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Tab: Workflow Overview ─────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <StageFlowDiagram />

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-800">Agent → Telegram Group → Stage Mapping</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-gray-100 text-[9px] font-semibold uppercase tracking-wider text-gray-500">
                  <th className="pb-2 pr-4">Agent</th><th className="pb-2 pr-4">Telegram Group</th><th className="pb-2 pr-4">Env Variable</th><th className="pb-2 pr-4">Monitored Stages</th><th className="pb-2 pr-4">Interval</th><th className="pb-2 pr-4">Health</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {AGENT_GROUP_MAPPINGS.map((m) => {
                    const agent = agents?.find((a: AgentInfo) => a.name === m.agentName);
                    const health = healthMap[m.agentName];
                    return (
                      <tr key={m.agentName} className="hover:bg-gray-50">
                        <td className="py-2.5 pr-4 font-medium text-gray-800">{m.agentName.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</td>
                        <td className="py-2.5 pr-4 text-gray-600">{m.groupName}</td>
                        <td className="py-2.5 pr-4"><code className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] text-gray-600">{m.envVar}</code></td>
                        <td className="py-2.5 pr-4">
                          <div className="flex flex-wrap gap-1">
                            {m.stages.includes('*') ? <span className="text-gray-500">All non-terminal stages</span>
                            : m.stages.map((s) => {
                              const cfg = STAGE_CONFIG[s]; const cnt = stageCounts[s] ?? 0;
                              return <span key={s} className={`rounded-md px-1.5 py-0.5 text-[9px] ${cnt > 0 ? 'bg-blue-50 text-blue-700' : 'text-gray-400'}`}>{cfg?.icon} {cfg?.label ?? s}{cnt > 0 && <span className="ml-0.5 font-bold">({cnt})</span>}</span>;
                            })}
                          </div>
                        </td>
                        <td className="py-2.5 pr-4 text-gray-500">{agent ? formatInterval(agent.intervalMs) : '—'}</td>
                        <td className="py-2.5 pr-4">
                          {health ? (health.healthy
                            ? <span className="flex items-center gap-1 text-green-600"><CheckCircle className="h-3 w-3" /> Healthy</span>
                            : <span className="flex items-center gap-1 text-red-600"><AlertCircle className="h-3 w-3" /> {health.consecutiveErrors} errors</span>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-3 text-sm font-semibold text-gray-800">⚠️ Reminder Escalation Rules</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-gray-100 text-[9px] font-semibold uppercase tracking-wider text-gray-500">
                  <th className="pb-2 pr-4">Reminder #</th><th className="pb-2 pr-4">Level</th><th className="pb-2 pr-4">Indicator</th><th className="pb-2 pr-4">Message</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  <tr className="hover:bg-gray-50"><td className="py-2.5 pr-4 font-medium text-gray-800">1st</td><td className="py-2.5 pr-4 text-gray-600">Level 0</td><td className="py-2.5 pr-4 text-gray-500">—</td><td className="py-2.5 pr-4 text-gray-600">Normal reminder</td></tr>
                  <tr className="hover:bg-gray-50"><td className="py-2.5 pr-4 font-medium text-gray-800">2nd</td><td className="py-2.5 pr-4 text-gray-600">Level 1</td><td className="py-2.5 pr-4 text-red-500">🔴</td><td className="py-2.5 pr-4 text-gray-600">Slight urgency</td></tr>
                  <tr className="hover:bg-gray-50"><td className="py-2.5 pr-4 font-medium text-gray-800">3rd</td><td className="py-2.5 pr-4 text-gray-600">Level 2</td><td className="py-2.5 pr-4 text-red-500">🔴🔴</td><td className="py-2.5 pr-4 text-gray-600">Higher urgency</td></tr>
                  <tr className="hover:bg-gray-50"><td className="py-2.5 pr-4 font-medium text-gray-800">4th+</td><td className="py-2.5 pr-4 text-gray-600">Level 3+</td><td className="py-2.5 pr-4 text-red-500">🔴🔴🔴</td><td className="py-2.5 pr-4 text-gray-600">Critical — escalated</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Inline Keyboards ──────────────────────────────── */}
      {activeTab === 'keyboards' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-800">⌨️ Inline Keyboard Mapping</h2>
            <p className="mb-4 text-[11px] text-gray-500">Every inline keyboard sent by the reminder scheduler, with the action taken when each button is pressed.</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {INLINE_KEYBOARD_MAPPINGS.map((m) => (
                <InlineKeyboardCard key={m.stage} mapping={m} stageCount={reminderCounts[m.stage] ?? 0} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Active Reminders ──────────────────────────────── */}
      {activeTab === 'reminders' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-800">🔔 Active Reminders</h2>
            <p className="mb-4 text-[11px] text-gray-500">All reminders currently in the system. Overdue reminders are highlighted in red.</p>
            <ReminderTable reminders={reminders ?? []} />
          </div>
        </div>
      )}

      {/* ── Tab: Telegram Groups ───────────────────────────────── */}
      {activeTab === 'groups' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-800">👥 Telegram Group Configuration</h2>
            <p className="mb-4 text-[11px] text-gray-500">Each Telegram group is configured via environment variables. Agents send notifications and reminders to their assigned groups.</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {TELEGRAM_GROUPS.map((g) => (
                <TelegramGroupCard key={g.name} group={g} stageCounts={stageCounts} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
