'use client';

import { useOrders, useAgents, useAgentHealth, type AgentInfo, type AgentHealth } from '@/lib/useApi';
import { STAGE_CONFIG, STAGE_ORDER } from '@/lib/api';
import {
  ArrowRight,
  Bot,
  Search,
  ShoppingCart,
  Factory,
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
import { useState, useEffect } from 'react';

// â”€â”€ Agent-to-Stage Mapping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    color: 'border-emerald-200 bg-emerald-50',
    headingColor: 'text-emerald-700',
    description: 'Verifies quotation math and checks for discrepancies',
    monitors: ['order_confirmation_received'],
    triggers: [
      { from: 'order_confirmation_received', to: 'math_verified', condition: 'Math matches (auto)' },
      { from: 'order_confirmation_received', to: 'production_pending', condition: 'Math verified â†’ auto-advance' },
    ],
    notificationGroup: 'Sales / Purchasing',
  },
  {
    name: 'purchasing-agent',
    icon: ShoppingCart,
    color: 'border-amber-200 bg-amber-50',
    headingColor: 'text-amber-700',
    description: 'Monitors production pending orders and sends daily reminders to production group until production starts',
    monitors: ['production_pending'],
    triggers: [
      { from: 'production_pending', to: 'production_in_progress', condition: 'Team replies /produce yes' },
    ],
    notificationGroup: 'Production',
  },
  {
    name: 'production-agent',
    icon: Factory,
    color: 'border-indigo-200 bg-indigo-50',
    headingColor: 'text-indigo-700',
    description: 'Hermes Claw â€” adaptive-frequency reminders that tighten as production deadlines approach (daily â†’ 12h â†’ 4h â†’ 2h)',
    monitors: ['production_in_progress', 'en_route', 'partial_production'],
    triggers: [
      { from: 'production_in_progress', to: 'en_route', condition: 'Production finished via /finish-production' },
      { from: 'en_route', to: 'inventory_verification', condition: 'All items arrived (production agent auto-advance)' },
    ],
    notificationGroup: 'Production',
  },
  {
    name: 'inventory-agent',
    icon: Package,
    color: 'border-cyan-200 bg-cyan-50',
    headingColor: 'text-cyan-700',
    description: 'Confirms inventory arrival via item-level tracking, then notifies delivery group',
    monitors: ['inventory_arrived'],
    triggers: [
      { from: 'inventory_arrived', to: 'balance_due', condition: 'All items confirmed arrived → Ready for Delivery' },
    ],
    notificationGroup: 'Inventory',
  },
  {
    name: 'delivery-agent',
    icon: Truck,
    color: 'border-purple-200 bg-purple-50',
    headingColor: 'text-purple-700',
    description: 'Tracks delivery scheduling and delivery confirmation (inventory arrival handled by Inventory Agent)',
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
    description: 'Monitors payment collection, verification, and confirmation (starts at balance_due after inventory confirmed)',
    monitors: ['balance_due', 'deposit_verification', 'balance_verification', 'countered', 'payment_received'],
    triggers: [
      { from: 'deposit_verification', to: 'production_pending', condition: 'Deposit verified via dashboard or API' },
      { from: 'balance_due', to: 'delivery_scheduled', condition: 'Balance paid via dashboard or API' },
      { from: 'balance_verification', to: 'payment_received', condition: 'Balance verified via dashboard or API' },
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
    monitors: ['purchasing_pending', 'production_pending', 'production_in_progress', 'en_route', 'deposit_pending', 'inventory_arrived', 'balance_due', 'delivery_scheduled', 'delivered', 'countered'],
    triggers: [
      { from: '*', to: '*', condition: 'Escalation level increases per missed reminder' },
    ],
    notificationGroup: 'All Groups',
  },
];

const AGENT_ICONS: Record<string, typeof Bot> = {
  'quotation-checker': Search,
  'purchasing-agent': ShoppingCart,
  'production-agent': Factory,
  'inventory-agent': Package,
  'delivery-agent': Truck,
  'collection-agent': DollarSign,
  'escalation-agent': TrendingUp,
};

const AGENT_COLORS: Record<string, string> = {
  'quotation-checker': 'border-emerald-200 bg-emerald-50',
  'purchasing-agent': 'border-amber-200 bg-amber-50',
  'production-agent': 'border-indigo-200 bg-indigo-50',
  'inventory-agent': 'border-cyan-200 bg-cyan-50',
  'delivery-agent': 'border-purple-200 bg-purple-50',
  'collection-agent': 'border-emerald-200 bg-emerald-50',
  'escalation-agent': 'border-rose-200 bg-rose-50',
};

const AGENT_HEADING_COLORS: Record<string, string> = {
  'quotation-checker': 'text-emerald-700',
  'purchasing-agent': 'text-amber-700',
  'inventory-agent': 'text-cyan-700',
  'delivery-agent': 'text-purple-700',
  'collection-agent': 'text-emerald-700',
  'escalation-agent': 'text-rose-700',
};

// â”€â”€ Stage transition rules (manual / auto) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface StageInfo {
  stage: string;
  entryAction: string;
  exitCondition: string;
  triggeredBy: string;
  responsibleParty: string;
  autoAdvance: boolean;
}

const STAGE_INFO: Record<string, StageInfo> = {
  order_confirmation_received: {
    stage: 'order_confirmation_received',
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
    exitCondition: 'Downpayment recorded (/deposit)',
    triggeredBy: 'Purchasing Agent / Team',
    responsibleParty: 'Purchasing Team',
    autoAdvance: false,
  },
  production_pending: {
    stage: 'production_pending',
    entryAction: 'Reminder sent to Production group asking if production started',
    exitCondition: 'Team confirms production started (/produce yes)',
    triggeredBy: 'Purchasing Agent / Team',
    responsibleParty: 'Production Team',
    autoAdvance: false,
  },
  production_in_progress: {
    stage: 'production_in_progress',
    entryAction: 'Production timeline recorded',
    exitCondition: 'Production finished',
    triggeredBy: 'Team',
    responsibleParty: 'Production Team',
    autoAdvance: false,
  },
  en_route: {
    stage: 'en_route',
    entryAction: 'Production finished — bot asks if order is en route',
    exitCondition: 'En route confirmed with estimated arrival days',
    triggeredBy: 'Telegram Bot / Team',
    responsibleParty: 'Purchasing Team',
    autoAdvance: false,
  },
  deposit_pending: {
    stage: 'deposit_pending',
    entryAction: 'Reminder sent for downpayment',
    exitCondition: 'Downpayment amount recorded via bot or image upload',
    triggeredBy: 'Team / Telegram Bot',
    responsibleParty: 'Sales / Finance',
    autoAdvance: false,
  },
  deposit_verification: {
    stage: 'deposit_verification',
    entryAction: 'Deposit recorded â€” collection agent reminds team to verify',
    exitCondition: 'Team verifies deposit via dashboard or API',
    triggeredBy: 'Collection Agent / Team',
    responsibleParty: 'Finance Team',
    autoAdvance: false,
  },
  delivery_pending: {
    stage: 'delivery_pending',
    entryAction: 'Balance paid and balance verified — awaiting delivery scheduling',
    exitCondition: 'Delivery date set and order moves to delivery_scheduled',
    triggeredBy: 'Delivery Agent / Team',
    responsibleParty: 'Delivery Team',
    autoAdvance: false,
  },
  inventory_arrived: {
    stage: 'inventory_arrived',
    entryAction: 'Inventory Agent checks item-level arrival — asks about each item via process of elimination',
    exitCondition: 'All items confirmed arrived â†’ Ready for Delivery clicked â†’ advances to balance_due',
    triggeredBy: 'Inventory Agent',
    responsibleParty: 'Inventory Team',
    autoAdvance: false,
  },
  balance_due: {
    stage: 'balance_due',
    entryAction: 'Collection Agent sends balance payment reminders',
    exitCondition: 'Balance paid via /paybalance → advances to delivery_scheduled',
    triggeredBy: 'Collection Agent / Team',
    responsibleParty: 'Sales / Finance',
    autoAdvance: false,
  },
  balance_verification: {
    stage: 'balance_verification',
    entryAction: 'Balance recorded â€” collection agent reminds team to verify',
    exitCondition: 'Team verifies balance via dashboard or API',
    triggeredBy: 'Collection Agent / Team',
    responsibleParty: 'Finance Team',
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
    entryAction: 'Delivery countered â€” collection reminder starts',
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
    entryAction: 'Order finalized â€” all reminders disabled',
    exitCondition: 'â€”',
    triggeredBy: 'System (Auto)',
    responsibleParty: 'â€”',
    autoAdvance: false,
  },
};

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function formatInterval(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `Every ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `Every ${hours} hour${hours > 1 ? 's' : ''}`;
}

// â”€â”€ Components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function StageNode({
  stage,
  index,
  count,
  isLast,
  onJump,
}: {
  stage: string;
  index: number;
  count: number;
  isLast: boolean;
  onJump: (stage: string) => void;
}) {
  const config = STAGE_CONFIG[stage];
  const info = STAGE_INFO[stage];
  return (
    <div className="flex items-start gap-0">
      {/* Stage card â€” clickable to jump to Working Tree filtered by this stage */}
      <button
        onClick={() => onJump(stage)}
        className={`min-w-[180px] flex-1 rounded-xl border-2 p-4 text-left transition-shadow hover:shadow-md ${
          count > 0 ? 'cursor-pointer hover:border-[var(--primary)]/40' : 'cursor-default'
        } ${info?.autoAdvance ? 'border-green-300 bg-green-50/30' : 'border-gray-200 bg-white'}`}
        title={count > 0 ? `View ${count} order(s) at this stage` : 'No orders here'}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">{config?.icon ?? 'ðŸ“‹'}</span>
            <div>
              <p className="text-xs font-semibold text-gray-800">{config?.label ?? stage}</p>
              <p className="text-[10px] text-gray-400">
                {info?.autoAdvance ? 'ðŸ¤– Auto' : 'ðŸ‘¤ Manual'}
              </p>
            </div>
          </div>
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${count > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
            {count}
          </span>
        </div>

        {/* Responsible party */}
        <div className="mt-2 flex items-center gap-1 text-[10px] text-gray-500">
          <UserCheck className="h-3 w-3" />
          <span>{info?.responsibleParty ?? 'â€”'}</span>
        </div>

        {/* Exit condition */}
        {info && !isLast && (
          <div className="mt-1.5 text-[9px] leading-tight text-gray-400">
            <span className="font-medium text-gray-500">â†’ </span>
            {info.exitCondition}
          </div>
        )}
      </button>

      {/* Arrow connector */}
      {!isLast && (
        <div className="flex items-center px-1 pt-5">
          <ArrowRight className="h-4 w-4 text-gray-300" />
        </div>
      )}
    </div>
  );
}

function AgentMappingCard({
  mapping,
  health,
  stageGroups,
}: {
  mapping: AgentMapping;
  health?: AgentHealth;
  stageGroups: Record<string, { id: string }[]>;
}) {
  const Icon = mapping.icon;
  const totalMonitored = mapping.monitors.reduce(
    (sum, s) => sum + (stageGroups[s]?.length ?? 0),
    0,
  );
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
        <div className="flex items-center gap-2">
          {totalMonitored > 0 && (
            <span className="rounded-full bg-white/80 px-2 py-0.5 text-[9px] font-bold text-gray-700">
              {totalMonitored} active
            </span>
          )}
          {health && (
            health.healthy ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-500" />
            )
          )}
        </div>
      </div>

      {/* Monitored stages with live counts */}
      <div className="mt-3">
        <p className="mb-1 text-[10px] font-medium text-gray-600">Monitors:</p>
        <div className="flex flex-wrap gap-1">
          {mapping.monitors.map((s) => {
            const cnt = stageGroups[s]?.length ?? 0;
            return (
              <span
                key={s}
                className={`rounded-md px-2 py-0.5 text-[9px] font-medium ${cnt > 0 ? 'bg-white text-gray-800 ring-1 ring-inset ring-gray-200' : 'bg-white/50 text-gray-400'}`}
              >
                {STAGE_CONFIG[s]?.icon} {STAGE_CONFIG[s]?.label ?? s}
                {cnt > 0 && (
                  <span className="ml-1 rounded-full bg-emerald-100 px-1 text-[8px] font-bold text-emerald-700">
                    {cnt}
                  </span>
                )}
              </span>
            );
          })}
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
                {' â†’ '}
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

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function daysInStage(updatedAt: string): number {
  return Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86_400_000);
}

function EscalationDots({ level }: { level: number }) {
  if (!level) return null;
  const dots = Math.min(level, 3);
  return (
    <span className="flex items-center gap-0.5" title={`Escalation level ${level}`}>
      {Array.from({ length: dots }).map((_, i) => (
        <span key={i} className="h-2 w-2 rounded-full bg-red-500" />
      ))}
    </span>
  );
}

function FlowNodeLabel({
  x,
  y,
  lines,
  className = 'fill-gray-800',
  size = 12,
}: {
  x: number;
  y: number;
  lines: string[];
  className?: string;
  size?: number;
}) {
  return (
    <text x={x} y={y} textAnchor="middle" className={`${className} font-semibold`} fontSize={size}>
      {lines.map((line, index) => (
        <tspan key={`${line}-${index}`} x={x} dy={index === 0 ? 0 : size + 2}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function FlowArrowLabel({ x, y, children }: { x: number; y: number; children: string }) {
  return (
    <text x={x} y={y} textAnchor="middle" className="fill-gray-500 font-semibold" fontSize="11">
      {children}
    </text>
  );
}

function ProcurementFlowDiagram() {
  const nodeWidth = 138;
  const nodeHeight = 58;
  const decisionSize = 92;
  const nodes = [
    { id: 'start', x: 24, y: 164, type: 'terminator', lines: ['Start'] },
    { id: 'sales', x: 188, y: 154, type: 'process', lines: ['Sales Sends', 'Approved Quote'] },
    { id: 'received', x: 352, y: 154, type: 'process', lines: ['Order Confirmation', 'Received'] },
    { id: 'mathCheck', x: 516, y: 154, type: 'agent', lines: ['Quotation Checker', 'Verifies Math'] },
    { id: 'mathVerified', x: 680, y: 154, type: 'auto', lines: ['Math', 'Verified'] },
    { id: 'purchasing', x: 844, y: 154, type: 'stage', lines: ['Purchasing', 'Pending'] },
    { id: 'depositReceived', x: 1016, y: 137, type: 'decision', lines: ['Deposit', 'Received?'] },
    { id: 'depositReminder', x: 996, y: 302, type: 'reminder', lines: ['Deposit Pending', 'Reminder'] },
    { id: 'depositVerification', x: 1188, y: 154, type: 'stage', lines: ['Deposit', 'Verification'] },
    { id: 'depositVerified', x: 1360, y: 137, type: 'decision', lines: ['Deposit', 'Verified?'] },
    { id: 'productionPending', x: 1532, y: 154, type: 'stage', lines: ['Production', 'Pending'] },
    { id: 'productionReminder', x: 1696, y: 154, type: 'agent', lines: ['Purchasing Agent', 'Reminds Production'] },
    { id: 'productionStarted', x: 1868, y: 137, type: 'decision', lines: ['Production', 'Started?'] },
    { id: 'productionConfirmed', x: 2040, y: 154, type: 'stage', lines: ['Production', 'Confirmed'] },
    { id: 'itemTracking', x: 2204, y: 154, type: 'agent', lines: ['Production Agent', 'Tracks Items'] },
    { id: 'itemsFinished', x: 2376, y: 137, type: 'decision', lines: ['All Items', 'Finished?'] },
    { id: 'enRoute', x: 2548, y: 154, type: 'stage', lines: ['En', 'Route'] },
    { id: 'enRouteVerif', x: 2720, y: 154, type: 'stage', lines: ['En Route', 'Verification'] },
    { id: 'inventoryArrivedDecision', x: 2892, y: 137, type: 'decision', lines: ['Inventory', 'Arrived?'] },
    { id: 'inventoryArrived', x: 3064, y: 154, type: 'stage', lines: ['Inventory', 'Arrived'] },
    { id: 'inventoryCheck', x: 3228, y: 154, type: 'agent', lines: ['Inventory Agent', 'Checks Arrival'] },
    { id: 'balanceDue', x: 3392, y: 154, type: 'stage', lines: ['Balance', 'Due'] },
    { id: 'balanceReceived', x: 3564, y: 137, type: 'decision', lines: ['Balance Paid', 'Received?'] },
    { id: 'balanceReminder', x: 3544, y: 302, type: 'reminder', lines: ['Balance Payment', 'Reminder'] },
    { id: 'balanceVerification', x: 3736, y: 154, type: 'stage', lines: ['Balance', 'Verification'] },
    { id: 'balanceVerified', x: 3908, y: 137, type: 'decision', lines: ['Balance', 'Verified?'] },
    { id: 'deliveryScheduled', x: 4080, y: 154, type: 'stage', lines: ['Delivery', 'Scheduled'] },
    { id: 'deliveryTracking', x: 4244, y: 154, type: 'agent', lines: ['Delivery Agent', 'Tracks Date'] },
    { id: 'deliveredDecision', x: 4416, y: 137, type: 'decision', lines: ['Delivered?'] },
    { id: 'delivered', x: 4588, y: 154, type: 'stage', lines: ['Delivered'] },
    { id: 'deliveryProof', x: 4752, y: 154, type: 'process', lines: ['Delivery Photos', 'Receipt Uploaded'] },
    { id: 'countered', x: 4916, y: 154, type: 'stage', lines: ['Countered'] },
    { id: 'collectionRequest', x: 5080, y: 154, type: 'agent', lines: ['Collection Agent', 'Requests Payment'] },
    { id: 'finalPaymentConfirmed', x: 5252, y: 137, type: 'decision', lines: ['Payment', 'Confirmed?'] },
    { id: 'paymentReceived', x: 5424, y: 154, type: 'stage', lines: ['Payment', 'Received'] },
    { id: 'paymentConfirmed', x: 5588, y: 154, type: 'auto', lines: ['Payment', 'Confirmed'] },
    { id: 'completed', x: 5752, y: 154, type: 'stage', lines: ['Completed'] },
    { id: 'end', x: 5916, y: 164, type: 'terminator', lines: ['End'] },
  ];
  const nodeMap = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const straightEdges = [
    ['start', 'sales'], ['sales', 'received'], ['received', 'mathCheck'], ['mathCheck', 'mathVerified'], ['mathVerified', 'purchasing'], ['purchasing', 'depositReceived'], ['depositReceived', 'depositVerification', 'Yes'], ['depositVerification', 'depositVerified'], ['depositVerified', 'productionPending', 'Yes'], ['productionPending', 'productionReminder'], ['productionReminder', 'productionStarted'], ['productionStarted', 'productionConfirmed', 'Yes'], ['productionConfirmed', 'itemTracking'], ['itemTracking', 'itemsFinished'], ['itemsFinished', 'enRoute', 'Yes'], ['enRoute', 'enRouteVerif'], ['enRouteVerif', 'inventoryArrivedDecision'], ['inventoryArrivedDecision', 'inventoryArrived', 'Yes'], ['inventoryArrived', 'inventoryCheck'], ['inventoryCheck', 'balanceDue'], ['balanceDue', 'balanceReceived'], ['balanceReceived', 'balanceVerification', 'Yes'], ['balanceVerification', 'balanceVerified'], ['balanceVerified', 'deliveryScheduled', 'Yes'], ['deliveryScheduled', 'deliveryTracking'], ['deliveryTracking', 'deliveredDecision'], ['deliveredDecision', 'delivered', 'Yes'], ['delivered', 'deliveryProof'], ['deliveryProof', 'countered'], ['countered', 'collectionRequest'], ['collectionRequest', 'finalPaymentConfirmed'], ['finalPaymentConfirmed', 'paymentReceived', 'Yes'], ['paymentReceived', 'paymentConfirmed'], ['paymentConfirmed', 'completed'], ['completed', 'end'],
  ] as const;
  function nodeCenter(node: (typeof nodes)[number]) {
    const width = node.type === 'decision' ? decisionSize : nodeWidth;
    const height = node.type === 'decision' ? decisionSize : nodeHeight;
    return { x: node.x + width / 2, y: node.y + height / 2, width, height };
  }
  function nodeColors(type: string) {
    switch (type) {
      case 'terminator': return 'fill-pink-200 stroke-pink-300';
      case 'decision': return 'fill-amber-100 stroke-amber-300';
      case 'agent': return 'fill-purple-200 stroke-purple-300';
      case 'auto': return 'fill-emerald-200 stroke-emerald-300';
      case 'reminder': return 'fill-orange-100 stroke-orange-300';
      case 'stage': return 'fill-blue-100 stroke-blue-300';
      default: return 'fill-gray-100 stroke-gray-300';
    }
  }
  function textColor(type: string) {
    switch (type) {
      case 'decision': return 'fill-amber-950';
      case 'agent': return 'fill-purple-950';
      case 'auto': return 'fill-emerald-950';
      case 'reminder': return 'fill-orange-950';
      case 'terminator': return 'fill-pink-900';
      case 'stage': return 'fill-blue-950';
      default: return 'fill-gray-800';
    }
  }
  function edgePath(fromId: string, toId: string) {
    const from = nodeCenter(nodeMap[fromId]);
    const to = nodeCenter(nodeMap[toId]);
    return `M ${from.x + from.width / 2} ${from.y} L ${to.x - to.width / 2} ${to.y}`;
  }
  function loopPath(fromId: string, toId: string, y: number) {
    const from = nodeCenter(nodeMap[fromId]);
    const to = nodeCenter(nodeMap[toId]);
    return `M ${from.x} ${from.y + from.height / 2} L ${from.x} ${y} L ${to.x} ${y} L ${to.x} ${to.y + to.height / 2}`;
  }
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  function toggleFullscreen() {
    const element = document.getElementById('full-app-workflow-diagram');
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void element?.requestFullscreen?.();
    }
  }

  const svgContent = (
    <>
      <defs><marker id="workflow-arrowhead" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 10 4 L 0 8 z" className="fill-gray-500" /></marker></defs>
      {straightEdges.map(([from, to, label]) => {
        const source = nodeCenter(nodeMap[from]);
        const target = nodeCenter(nodeMap[to]);
        return <g key={`${from}-${to}`}><path d={edgePath(from, to)} fill="none" className="stroke-gray-500" strokeWidth="2" markerEnd="url(#workflow-arrowhead)" />{label && <FlowArrowLabel x={(source.x + target.x) / 2} y={source.y - 12}>{label}</FlowArrowLabel>}</g>;
      })}
      <path d={loopPath('depositReceived', 'depositReminder', 278)} fill="none" className="stroke-orange-400" strokeWidth="2" markerEnd="url(#workflow-arrowhead)" /><path d={loopPath('depositReminder', 'depositReceived', 410)} fill="none" className="stroke-orange-400" strokeWidth="2" strokeDasharray="5 5" markerEnd="url(#workflow-arrowhead)" /><FlowArrowLabel x={1042} y={270}>No</FlowArrowLabel><FlowArrowLabel x={1042} y={432}>remind</FlowArrowLabel>
      <path d={loopPath('depositVerified', 'depositVerification', 78)} fill="none" className="stroke-rose-400" strokeWidth="2" strokeDasharray="5 5" markerEnd="url(#workflow-arrowhead)" /><FlowArrowLabel x={1274} y={68}>No</FlowArrowLabel>
      <path d={loopPath('productionStarted', 'productionReminder', 78)} fill="none" className="stroke-orange-400" strokeWidth="2" strokeDasharray="5 5" markerEnd="url(#workflow-arrowhead)" /><FlowArrowLabel x={1810} y={68}>No</FlowArrowLabel>
      <path d={loopPath('itemsFinished', 'itemTracking', 78)} fill="none" className="stroke-orange-400" strokeWidth="2" strokeDasharray="5 5" markerEnd="url(#workflow-arrowhead)" /><FlowArrowLabel x={2310} y={68}>No / Partial</FlowArrowLabel>
      <path d={loopPath('inventoryArrivedDecision', 'enRouteVerif', 78)} fill="none" className="stroke-orange-400" strokeWidth="2" strokeDasharray="5 5" markerEnd="url(#workflow-arrowhead)" /><FlowArrowLabel x={2820} y={68}>No</FlowArrowLabel>
      <path d={loopPath('balanceReceived', 'balanceReminder', 278)} fill="none" className="stroke-orange-400" strokeWidth="2" markerEnd="url(#workflow-arrowhead)" /><path d={loopPath('balanceReminder', 'balanceReceived', 410)} fill="none" className="stroke-orange-400" strokeWidth="2" strokeDasharray="5 5" markerEnd="url(#workflow-arrowhead)" /><FlowArrowLabel x={3590} y={270}>No</FlowArrowLabel><FlowArrowLabel x={3590} y={432}>remind</FlowArrowLabel>
      <path d={loopPath('balanceVerified', 'balanceVerification', 78)} fill="none" className="stroke-rose-400" strokeWidth="2" strokeDasharray="5 5" markerEnd="url(#workflow-arrowhead)" /><FlowArrowLabel x={3822} y={68}>No</FlowArrowLabel>
      <path d={loopPath('deliveredDecision', 'deliveryTracking', 78)} fill="none" className="stroke-orange-400" strokeWidth="2" strokeDasharray="5 5" markerEnd="url(#workflow-arrowhead)" /><FlowArrowLabel x={4332} y={68}>No</FlowArrowLabel>
      <path d={loopPath('finalPaymentConfirmed', 'collectionRequest', 78)} fill="none" className="stroke-orange-400" strokeWidth="2" strokeDasharray="5 5" markerEnd="url(#workflow-arrowhead)" /><FlowArrowLabel x={5172} y={68}>No</FlowArrowLabel>
      {nodes.map((node) => {
        const { x, y, width, height } = nodeCenter(node);
        if (node.type === 'decision') return <g key={node.id}><path d={`M ${x} ${y - height / 2} L ${x + width / 2} ${y} L ${x} ${y + height / 2} L ${x - width / 2} ${y} Z`} className={nodeColors(node.type)} /><FlowNodeLabel x={x} y={y - 4} lines={node.lines} className={textColor(node.type)} size={11} /></g>;
        return <g key={node.id}><rect x={node.x} y={node.y} width={width} height={height} rx={node.type === 'terminator' ? 29 : 10} className={nodeColors(node.type)} /><FlowNodeLabel x={x} y={y - (node.lines.length > 1 ? 6 : -4)} lines={node.lines} className={textColor(node.type)} size={11} /></g>;
      })}
    </>
  );

  const legend = (
    <div className="flex flex-wrap gap-3 text-[11px] text-gray-500">
      <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded bg-emerald-100 ring-1 ring-emerald-300" /> Stage</span>
      <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded bg-purple-100 ring-1 ring-purple-300" /> Agent action</span>
      <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded bg-emerald-100 ring-1 ring-emerald-300" /> Auto/system step</span>
      <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rotate-45 bg-amber-100 ring-1 ring-amber-300" /> Decision</span>
      <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded bg-orange-100 ring-1 ring-orange-300" /> Reminder loop</span>
    </div>
  );

  return (
    <div
      id="full-app-workflow-diagram"
      className={isFullscreen
        ? 'fixed inset-0 z-50 flex flex-col bg-white p-5'
        : 'rounded-xl border border-gray-200 bg-white p-6'
      }
    >
      {/* Header */}
      <div className={`flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between ${isFullscreen ? 'mb-3 shrink-0' : 'mb-4'}`}>
        <div>
          <h2 className={`font-semibold text-gray-800 ${isFullscreen ? 'text-base' : 'text-sm'}`}>Full App Workflow Diagram</h2>
          {!isFullscreen && (
            <p className="text-xs text-gray-500">Complete quotation lifecycle from sales intake through production, inventory, delivery, collection, and completion.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isFullscreen && <span className="text-[10px] text-gray-400">Scroll sideways to see the whole flow</span>}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[11px] font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Open fullscreen'}
          >
            {isFullscreen ? '✕ Exit Fullscreen' : '⛶ Fullscreen'}
          </button>
        </div>
      </div>

      {/* SVG canvas */}
      {isFullscreen ? (
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden rounded-lg border border-dashed border-gray-200 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:18px_18px]">
          <svg
            role="img"
            aria-labelledby="workflow-diagram-title workflow-diagram-desc"
            viewBox="0 0 6090 500"
            preserveAspectRatio="xMinYMid meet"
            style={{ height: '100%', width: 'auto', minWidth: '100%', display: 'block' }}
          >
            <title id="workflow-diagram-title">Full quotation automation app workflow</title>
            <desc id="workflow-diagram-desc">Landscape diagram showing the full app workflow.</desc>
            {svgContent}
          </svg>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-dashed border-gray-200 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] p-4 [background-size:18px_18px]">
          <svg
            role="img"
            aria-labelledby="workflow-diagram-title workflow-diagram-desc"
            viewBox="0 0 6090 500"
            className="h-auto min-w-[2200px] max-w-none"
          >
            <title id="workflow-diagram-title">Full quotation automation app workflow</title>
            <desc id="workflow-diagram-desc">Landscape diagram showing the full app workflow.</desc>
            {svgContent}
          </svg>
        </div>
      )}

      {/* Legend */}
      <div className={isFullscreen ? 'mt-3 shrink-0' : 'mt-3'}>
        {legend}
      </div>
    </div>
  );
}

export default function WorkflowPage() {
  const { data: orders = [], isLoading: ordersLoading } = useOrders();
  const { data: agents } = useAgents();
  const { data: healthData, mutate: refreshHealth } = useAgentHealth();
  const [activeTab, setActiveTab] = useState<'pipeline' | 'agents' | 'orders'>('pipeline');
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Parse health data
  const healthMap: Record<string, AgentHealth> = {};
  const healthPayload = healthData as AgentHealth[] | { agents?: AgentHealth[] } | undefined;
  if (Array.isArray(healthPayload)) {
    for (const h of healthPayload) {
      if (h.name) healthMap[h.name] = h;
    }
  } else if (healthPayload?.agents) {
    for (const h of healthPayload.agents) {
      if (h.name) healthMap[h.name] = h;
    }
  }

  // Group orders by stage, sorted by urgency (escalation desc, then oldest first)
  const stageGroups: Record<string, typeof orders> = {};
  STAGE_ORDER.forEach((stage) => {
    stageGroups[stage] = orders
      .filter((o) => o.current_stage === stage)
      .sort((a, b) =>
        (b.escalation_level ?? 0) - (a.escalation_level ?? 0) ||
        new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
      );
  });

  const activeOrders = orders.filter((o) => o.status === 'active');
  const completedOrders = orders.filter((o) => o.status === 'completed');

  function jumpToStage(stage: string) {
    setStageFilter(stage);
    setSearch('');
    setActiveTab('orders');
  }

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
            End-to-end order lifecycle â€” stages, agents, and transition rules
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

      {/* â”€â”€ Tab: Stage Pipeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {activeTab === 'pipeline' && (
        <div className="space-y-6">
          <ProcurementFlowDiagram />

          {/* Pipeline visualization */}
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">Stage Flow</h2>
              <span className="text-[10px] text-gray-400">â† scroll to see all stages â†’</span>
            </div>
            <div className="overflow-x-auto">
              <div className="flex gap-0" style={{ minWidth: '1100px' }}>
                {STAGE_ORDER.map((stage, index) => (
                  <StageNode
                    key={stage}
                    stage={stage}
                    index={index}
                    count={stageGroups[stage]?.length ?? 0}
                    isLast={index === STAGE_ORDER.length - 1}
                    onJump={jumpToStage}
                  />
                ))}
              </div>
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
              <span className="flex items-center gap-1 text-[var(--primary)]">
                Click any stage node to jump to its orders â†’
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
                      <tr
                        key={stage}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => count > 0 && jumpToStage(stage)}
                        title={count > 0 ? `View ${count} order(s) at this stage` : undefined}
                      >
                        <td className="py-2.5 pr-4 font-medium text-gray-800">
                          <span className="mr-1">{config?.icon}</span>
                          {config?.label ?? stage}
                        </td>
                        <td className="py-2.5 pr-4 text-gray-600">{info?.entryAction ?? 'â€”'}</td>
                        <td className="py-2.5 pr-4 text-gray-600">{info?.exitCondition ?? 'â€”'}</td>
                        <td className="py-2.5 pr-4 text-gray-600">{info?.triggeredBy ?? 'â€”'}</td>
                        <td className="py-2.5 pr-4 text-gray-600">{info?.responsibleParty ?? 'â€”'}</td>
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
                          <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${count > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
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

      {/* â”€â”€ Tab: Agent Mapping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {activeTab === 'agents' && (
        <div className="space-y-6">
          {/* Agent cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {AGENT_MAPPINGS.map((mapping) => (
              <AgentMappingCard
                key={mapping.name}
                mapping={mapping}
                health={healthMap[mapping.name]}
                stageGroups={stageGroups}
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
                    <td className="py-2.5 pr-4 text-gray-500">â€”</td>
                    <td className="py-2.5 pr-4 text-gray-600">Normal reminder</td>
                  </tr>
                  <tr className="hover:bg-gray-50">
                    <td className="py-2.5 pr-4 font-medium text-gray-800">2nd</td>
                    <td className="py-2.5 pr-4 text-gray-600">Level 1</td>
                    <td className="py-2.5 pr-4 text-red-500">ðŸ”´</td>
                    <td className="py-2.5 pr-4 text-gray-600">Slight urgency</td>
                  </tr>
                  <tr className="hover:bg-gray-50">
                    <td className="py-2.5 pr-4 font-medium text-gray-800">3rd</td>
                    <td className="py-2.5 pr-4 text-gray-600">Level 2</td>
                    <td className="py-2.5 pr-4 text-red-500">ðŸ”´ðŸ”´</td>
                    <td className="py-2.5 pr-4 text-gray-600">Higher urgency</td>
                  </tr>
                  <tr className="hover:bg-gray-50">
                    <td className="py-2.5 pr-4 font-medium text-gray-800">4th+</td>
                    <td className="py-2.5 pr-4 text-gray-600">Level 3+</td>
                    <td className="py-2.5 pr-4 text-red-500">ðŸ”´ðŸ”´ðŸ”´</td>
                    <td className="py-2.5 pr-4 text-gray-600">Critical â€” escalated</td>
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

      {/* â”€â”€ Tab: Working Tree â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {activeTab === 'orders' && (
        <div className="space-y-6">
          {/* Summary cards + search */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="grid flex-1 grid-cols-3 gap-3">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs text-gray-500">Total</p>
                <p className="text-2xl font-bold text-gray-900">{orders.length}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs text-gray-500">Active</p>
                <p className="text-2xl font-bold text-emerald-600">{activeOrders.length}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs text-gray-500">Completed</p>
                <p className="text-2xl font-bold text-green-600">{completedOrders.length}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Search ordersâ€¦"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setStageFilter(null); }}
                className="w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
              />
              {(stageFilter || search) && (
                <button
                  onClick={() => { setStageFilter(null); setSearch(''); }}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-500 hover:bg-gray-50"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Active stage filter pill */}
          {stageFilter && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
                {STAGE_CONFIG[stageFilter]?.icon} {STAGE_CONFIG[stageFilter]?.label ?? stageFilter}
              </span>
              <button onClick={() => setStageFilter(null)} className="text-xs text-gray-400 hover:text-gray-600">
                Ã— show all
              </button>
            </div>
          )}

          {/* Orders grouped by stage */}
          {ordersLoading && orders.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[var(--primary)]" />
            </div>
          ) : (
            STAGE_ORDER.filter((stage) => !stageFilter || stage === stageFilter).map((stage) => {
              const config = STAGE_CONFIG[stage];
              let stageOrders = stageGroups[stage] ?? [];

              // Apply search filter across all visible stages
              if (search.trim()) {
                const q = search.toLowerCase();
                stageOrders = stageOrders.filter(
                  (o) =>
                    o.quotation_number?.toLowerCase().includes(q) ||
                    o.client_name?.toLowerCase().includes(q) ||
                    o.sales_agent?.toLowerCase().includes(q),
                );
              }

              if (stageOrders.length === 0) return null;

              const hasEscalated = stageOrders.some((o) => (o.escalation_level ?? 0) > 0);

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
                    {hasEscalated && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-medium text-red-700">
                        escalated
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {stageOrders.map((order) => {
                      const days = daysInStage(order.updated_at);
                      const escalation = order.escalation_level ?? 0;
                      const isStale = days >= 3 && escalation === 0;
                      return (
                        <a
                          key={order.id}
                          href={`/orders/${encodeURIComponent(order.quotation_number ?? order.id)}`}
                          className={`block rounded-lg border p-3 transition-colors hover:bg-white ${
                            escalation > 0
                              ? 'border-red-200 bg-red-50/40 hover:border-red-300'
                              : isStale
                                ? 'border-amber-200 bg-amber-50/30 hover:border-amber-300'
                                : 'border-gray-100 bg-gray-50 hover:border-gray-200'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <p className="text-xs font-medium text-gray-900">
                              {order.quotation_number ?? 'â€”'}
                            </p>
                            <EscalationDots level={escalation} />
                          </div>
                          <p className="mt-0.5 text-[10px] text-gray-500">
                            {order.client_name ?? 'Unknown'}
                          </p>
                          {order.total_amount != null && (
                            <p className="mt-0.5 text-[10px] font-medium text-gray-600">
                              â‚±{Number(order.total_amount).toLocaleString()}
                            </p>
                          )}
                          <div className="mt-1.5 flex items-center justify-between text-[9px]">
                            <span className={`flex items-center gap-1 ${days >= 7 ? 'font-semibold text-red-500' : days >= 3 ? 'text-amber-500' : 'text-gray-400'}`}>
                              <Clock className="h-3 w-3" />
                              {days === 0 ? 'Today' : `${days}d in stage`}
                            </span>
                            {order.sales_agent && (
                              <span className="text-gray-400">{order.sales_agent}</span>
                            )}
                          </div>
                        </a>
                      );
                    })}
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

          {/* No search results */}
          {!ordersLoading && orders.length > 0 && search.trim() &&
            STAGE_ORDER.every((stage) => {
              const q = search.toLowerCase();
              return (stageGroups[stage] ?? []).filter(
                (o) =>
                  o.quotation_number?.toLowerCase().includes(q) ||
                  o.client_name?.toLowerCase().includes(q) ||
                  o.sales_agent?.toLowerCase().includes(q),
              ).length === 0;
            }) && (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <MapPin className="mb-3 h-12 w-12" />
                <p className="text-sm">No orders match &quot;{search}&quot;</p>
              </div>
            )
          }
        </div>
      )}
    </div>
  );
}
