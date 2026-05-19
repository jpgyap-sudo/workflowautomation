const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export interface Order {
  id: string;
  quotation_number: string | null;
  client_name: string | null;
  sales_agent: string | null;
  total_amount: number | null;
  computed_amount: number | null;
  math_status: string;
  current_stage: string;
  status: string;
  google_drive_folder_id: string | null;
  deposit_paid: boolean;
  deposit_amount: number | null;
  deposit_image_url: string | null;
  balance_paid: boolean;
  balance_paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StageUpdate {
  id: string;
  order_id: string;
  stage: string;
  status: string;
  remarks: string | null;
  updated_by: string | null;
  created_at: string;
}

export interface OrderFile {
  id: string;
  original_filename: string | null;
  file_type: string | null;
  google_drive_file_id: string | null;
  google_drive_url?: string | null;
  created_at?: string;
}

export interface DashboardStats {
  total_orders: number;
  active_orders: number;
  completed_orders: number;
  pending_purchasing: number;
  pending_delivery: number;
  pending_collection: number;
  pending_deposit: number;
  pending_balance: number;
  overdue_reminders: number;
  stage_breakdown: { stage: string; count: number }[];
  recent_orders: Order[];
}

export interface MonthlySalesRow {
  month: string;
  order_count: number;
  total_sales: number;
  computed_sales: number;
}

export interface MonthlySales {
  monthly: MonthlySalesRow[];
}

export interface OrderDetail extends Order {
  stage_updates: StageUpdate[];
  files: OrderFile[];
}

export interface AgentLog {
  id: string;
  agent_name: string;
  status: string;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export async function getDashboardStats(): Promise<DashboardStats> {
  return fetchJson<DashboardStats>('/dashboard/stats');
}

export async function getOrders(): Promise<Order[]> {
  return fetchJson<Order[]>('/orders');
}

export async function getPendingOrders(): Promise<Order[]> {
  return fetchJson<Order[]>('/orders/pending');
}

export async function getOrder(quotationNumber: string): Promise<OrderDetail> {
  return fetchJson<OrderDetail>(`/orders/${encodeURIComponent(quotationNumber)}`);
}

export async function getOrdersByStage(stage: string): Promise<Order[]> {
  return fetchJson<Order[]>(`/orders/stage/${encodeURIComponent(stage)}`);
}

export async function getStageUpdates(orderId: string): Promise<StageUpdate[]> {
  return fetchJson<StageUpdate[]>(`/orders/${orderId}/stage-updates`);
}

// Stage display configuration
export const STAGE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  order_confirmation_received: { label: 'Order Confirmation Received', color: 'bg-blue-100 text-blue-800', icon: '📄' },
  math_verified:         { label: 'Math Verified',         color: 'bg-teal-100 text-teal-800',       icon: '✅' },
  purchasing_pending:    { label: 'Purchasing Pending',    color: 'bg-amber-100 text-amber-800',     icon: '🛒' },
  production_confirmed:  { label: 'Production Confirmed',  color: 'bg-indigo-100 text-indigo-800',   icon: '🏭' },
  deposit_pending:       { label: 'Deposit Pending',       color: 'bg-pink-100 text-pink-800',       icon: '💳' },
  inventory_arrived:     { label: 'Inventory Arrived',     color: 'bg-cyan-100 text-cyan-800',       icon: '📦' },
  balance_due:           { label: 'Balance Due',            color: 'bg-violet-100 text-violet-800',   icon: '⚖️' },
  delivery_scheduled:    { label: 'Delivery Scheduled',    color: 'bg-purple-100 text-purple-800',   icon: '📅' },
  delivered:             { label: 'Delivered',              color: 'bg-orange-100 text-orange-800',   icon: '🚚' },
  countered:             { label: 'Countered',              color: 'bg-rose-100 text-rose-800',       icon: '📋' },
  payment_received:      { label: 'Payment Received',      color: 'bg-emerald-100 text-emerald-800', icon: '💰' },
  payment_confirmed:     { label: 'Payment Confirmed',     color: 'bg-green-100 text-green-800',     icon: '✅' },
  completed:             { label: 'Completed',              color: 'bg-gray-100 text-gray-800',       icon: '🏁' },
};

export interface CalendarEvent {
  event_id: string;
  type: 'order' | 'stage_update' | 'reminder' | 'delivery';
  category: string;
  title: string;
  subtitle: string | null;
  event_date: string;
  metadata: string | null;
  color: string;
}

export async function getCalendarEvents(): Promise<CalendarEvent[]> {
  return fetchJson<CalendarEvent[]>('/calendar/events');
}

export interface BackupFile {
  name: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface BackupLogEntry {
  id: string;
  agent_name: string;
  status: string;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
}

export interface BackupsResponse {
  files: BackupFile[];
  latestLog: BackupLogEntry | null;
  error?: string;
}

export const STAGE_ORDER = [
  'order_confirmation_received',
  'math_verified',
  'purchasing_pending',
  'production_confirmed',
  'deposit_pending',
  'inventory_arrived',
  'balance_due',
  'delivery_scheduled',
  'delivered',
  'countered',
  'payment_received',
  'payment_confirmed',
  'completed',
];
