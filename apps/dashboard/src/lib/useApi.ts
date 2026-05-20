'use client';

import useSWR, { mutate } from 'swr';
import { useEffect, useRef } from 'react';
import {
  AgentLog,
  DashboardStats,
  Order,
  OrderDetail,
  CalendarEvent,
  MonthlySales,
  BackupsResponse,
  BotLogEntry,
  BotLogsQuery,
  Client,
  InventoryItem,
  InventoryDraft,
} from './api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

// ── Generic fetcher ───────────────────────────────────────────────────
async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'content-type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// ── SWR Configuration ────────────────────────────────────────────────
export const SWR_CONFIG = {
  // Revalidate every 15 seconds (auto-refetch)
  refreshInterval: 15_000,
  // Revalidate on window focus (user comes back to tab)
  revalidateOnFocus: true,
  // Deduplicate identical requests within 2s
  dedupingInterval: 2_000,
  // Keep previous data while revalidating (no loading flash)
  keepPreviousData: true,
  // Error retry
  errorRetryCount: 3,
  errorRetryInterval: 5_000,
};

// ── Hook: Dashboard Stats ────────────────────────────────────────────
export function useDashboardStats() {
  return useSWR<DashboardStats>(
    '/dashboard/stats',
    fetcher,
    SWR_CONFIG
  );
}

// ── Hook: All Orders ─────────────────────────────────────────────────
export function useOrders() {
  return useSWR<Order[]>('/orders', fetcher, SWR_CONFIG);
}

// ── Hook: Pending Orders ─────────────────────────────────────────────
export function usePendingOrders() {
  return useSWR<Order[]>('/orders/pending', fetcher, SWR_CONFIG);
}

// ── Hook: Orders by Stage ────────────────────────────────────────────
export function useOrdersByStage(stage: string) {
  return useSWR<Order[]>(
    `/orders/stage/${encodeURIComponent(stage)}`,
    fetcher,
    SWR_CONFIG
  );
}

export function usePartialProductionOrders() {
  return useSWR<Order[]>('/orders/partial-production', fetcher, SWR_CONFIG);
}

// ── Hook: Single Order Detail ────────────────────────────────────────
export function useOrder(quotationNumber: string | undefined) {
  return useSWR<OrderDetail>(
    quotationNumber ? `/orders/${encodeURIComponent(quotationNumber)}` : null,
    fetcher,
    SWR_CONFIG
  );
}

// ── Hook: Agent Logs ─────────────────────────────────────────────────
export function useAgentLogs() {
  return useSWR<AgentLog[]>('/agent-logs', fetcher, {
    ...SWR_CONFIG,
    refreshInterval: 10_000, // logs refresh more frequently
  });
}

// ── Hook: Calendar Events ────────────────────────────────────────────
export function useCalendarEvents() {
  return useSWR<CalendarEvent[]>('/calendar/events', fetcher, SWR_CONFIG);
}

// ── WebSocket / SSE for Real-Time Updates ────────────────────────────
// This hook subscribes to Server-Sent Events from the API and
// triggers SWR mutations so all pages update instantly.
export function useRealtimeSubscription() {
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Only connect in browser
    if (typeof window === 'undefined') return;

    const es = new EventSource(`${API_BASE}/events`);
    eventSourceRef.current = es;

    es.onopen = () => {
      console.log('[realtime] SSE connection opened');
    };

    es.addEventListener('invalidate', (event) => {
      try {
        const { keys } = JSON.parse(event.data);
        console.log('[realtime] Invalidation event:', keys);

        // Map API path patterns to SWR cache keys and revalidate them
        const swrKeys: string[] = [];
        for (const key of keys) {
          if (key.includes('dashboard/stats')) swrKeys.push('/dashboard/stats');
          if (key.includes('/orders/')) swrKeys.push('/orders');
          if (key.includes('/orders')) swrKeys.push('/orders');
          if (key.includes('/sales/')) swrKeys.push('/sales/monthly');
          if (key.includes('/reminders')) swrKeys.push('/reminders');
          if (key.includes('/agent-logs')) swrKeys.push('/agent-logs');
          if (key.includes('/calendar/')) {
            swrKeys.push('/calendar/events');
            swrKeys.push('/calendar/notes');
          }
          if (key.includes('/backups') || key.includes('supabase-backup')) swrKeys.push('/backups');
          if (key.includes('/bot-logs')) swrKeys.push('/bot-logs');
          if (key.includes('/clients')) swrKeys.push('/clients');
          if (key.includes('/inventory')) {
            swrKeys.push('/inventory');
            swrKeys.push('/inventory/drafts');
          }
        }

        // Also revalidate any stage-specific keys
        const stageMatch = keys.find((k: string) => k.includes('/orders/stage/'));
        if (stageMatch) {
          swrKeys.push(stageMatch);
        }

        // Trigger SWR revalidation for all matched keys
        for (const swrKey of swrKeys) {
          mutate(swrKey);
        }
      } catch (e) {
        console.error('[realtime] Failed to parse invalidation event', e);
      }
    });

    es.onerror = () => {
      console.warn('[realtime] SSE connection error — will auto-reconnect');
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);
}

// ── Hook: Monthly Sales ──────────────────────────────────────────────
export function useMonthlySales() {
  return useSWR<MonthlySales>('/sales/monthly', fetcher, SWR_CONFIG);
}

// ── Hook: Agent List ─────────────────────────────────────────────────
export interface AgentInfo {
  name: string;
  description: string;
  intervalMs: number;
}

export function useAgents() {
  return useSWR<AgentInfo[]>('/agents', fetcher, SWR_CONFIG);
}

// ── Hook: Agent Health ───────────────────────────────────────────────
export interface AgentHealth {
  name: string;
  lastRun: number;
  consecutiveErrors: number;
  healthy: boolean;
}

export function useAgentHealth() {
  return useSWR<AgentHealth[]>('/health', fetcher, {
    ...SWR_CONFIG,
    refreshInterval: 30_000, // health refreshes every 30s
  });
}

// ── Hook: Backups ───────────────────────────────────────────────────
export function useBackups() {
  return useSWR<BackupsResponse>('/backups', fetcher, {
    ...SWR_CONFIG,
    refreshInterval: 30_000, // backups refresh every 30s
  });
}

// ── Hook: Bot Logs ──────────────────────────────────────────────────
export function useBotLogs(query?: BotLogsQuery) {
  const params = new URLSearchParams();
  if (query?.limit) params.set('limit', String(query.limit));
  if (query?.offset) params.set('offset', String(query.offset));
  if (query?.chat_id) params.set('chat_id', query.chat_id);
  if (query?.message_type) params.set('message_type', query.message_type);
  if (query?.status) params.set('status', query.status);
  const qs = params.toString();
  const key = `/bot-logs${qs ? `?${qs}` : ''}`;
  return useSWR<BotLogEntry[]>(key, fetcher, {
    ...SWR_CONFIG,
    refreshInterval: 15_000, // bot logs refresh every 15s
  });
}

// ── Hook: Clients ────────────────────────────────────────────────────
export function useClients() {
  return useSWR<Client[]>('/clients', fetcher, SWR_CONFIG);
}

// ── Hook: Inventory ──────────────────────────────────────────────────
export function useInventory() {
  return useSWR<InventoryItem[]>('/inventory', fetcher, SWR_CONFIG);
}

export function useInventoryDrafts() {
  return useSWR<InventoryDraft[]>('/inventory/drafts', fetcher, {
    ...SWR_CONFIG,
    refreshInterval: 10_000,
  });
}

// ── Hook: Reminders ──────────────────────────────────────────────────
export function useReminders() {
  return useSWR<any[]>('/reminders', fetcher, {
    ...SWR_CONFIG,
    refreshInterval: 15_000,
  });
}
