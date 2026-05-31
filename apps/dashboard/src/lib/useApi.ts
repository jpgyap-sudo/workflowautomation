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
  SalesByAgent,
  SalesByClient,
  CalendarNote,
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

// Fetch partial-delivery orders at later stages that still have items pending verification.
export function usePartialDeliveryVerificationOrders() {
  return useSWR<Order[]>('/orders/partial-delivery-verification', fetcher, SWR_CONFIG);
}

export function usePartialProductionOrders() {
  return useSWR<Order[]>('/orders/partial-production', fetcher, SWR_CONFIG);
}

// Returns early-stage orders (quotation_received → deposit_pending) with no deposit paid yet
// and no production exception granted. Used in Purchasing → "Downpayment Pending" section.
export function useAwaitingDownpayment() {
  return useSWR<Order[]>('/orders/awaiting-downpayment', fetcher, SWR_CONFIG);
}

// Returns ALL orders with production_exception=TRUE, shown until 60 days post-delivery.
// Includes full payment/delivery tracking. Used in Purchasing → "Production Exception" section.
export function useProductionExceptionOrders() {
  return useSWR<Order[]>('/orders/production-exception-active', fetcher, SWR_CONFIG);
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

        // Server sends Redis-style patterns like 'orders:*', 'dashboard:*', etc.
        // Map these to SWR cache URL keys used by hooks in this file.
        const swrKeys: string[] = [];
        for (const key of keys) {
          // Dashboard stats
          if (key.includes('dashboard')) swrKeys.push('/dashboard/stats');

          // All orders-related hooks — server uses 'orders:*' Redis pattern
          if (key.includes('orders')) {
            swrKeys.push('/orders');
            swrKeys.push('/orders/awaiting-downpayment');
            swrKeys.push('/orders/production-exception-active');
            swrKeys.push('/orders/partial-production');
          }

          // Stage-specific — server may send 'orders:stage:X'
          if (key.includes('orders:stage:')) {
            const stage = key.replace('orders:stage:', '').replace(':*', '').replace('*', '');
            if (stage) swrKeys.push(`/orders/stage/${stage}`);
          }

          // Sales
          if (key.includes('sales')) {
            swrKeys.push('/sales/monthly');
            swrKeys.push('/sales/by-agent');
            swrKeys.push('/sales/by-client');
          }

          // Calendar
          if (key.includes('calendar')) {
            swrKeys.push('/calendar/events');
            swrKeys.push('/calendar/notes');
          }

          // Reminders
          if (key.includes('reminders')) swrKeys.push('/reminders');

          // Agent logs
          if (key.includes('agent-logs')) swrKeys.push('/agent-logs');

          // Backups
          if (key.includes('backup')) swrKeys.push('/backups');

          // Bot logs
          if (key.includes('bot-log')) swrKeys.push('/bot-logs');

          // Clients
          if (key.includes('clients')) swrKeys.push('/clients');

          // Inventory
          if (key.includes('inventory')) {
            swrKeys.push('/inventory');
            swrKeys.push('/inventory/drafts');
          }
        }

        // Trigger SWR revalidation for all matched keys (deduplicated)
        const seen = new Set<string>();
        for (const swrKey of swrKeys) {
          if (!seen.has(swrKey)) { seen.add(swrKey); mutate(swrKey); }
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

export function useSalesByAgent() {
  return useSWR<SalesByAgent[]>('/sales/by-agent', fetcher, SWR_CONFIG);
}

export function useSalesByClient() {
  return useSWR<SalesByClient[]>('/sales/by-client', fetcher, SWR_CONFIG);
}

export function useCalendarNotes() {
  return useSWR<CalendarNote[]>('/calendar/notes', fetcher, SWR_CONFIG);
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
