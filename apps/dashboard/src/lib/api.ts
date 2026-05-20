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
  deposit_paid_at: string | null;
  balance_paid: boolean;
  balance_paid_at: string | null;
  order_confirmed_at: string | null;
  production_started: boolean | null;
  production_started_at: string | null;
  estimated_production_days: number | null;
  production_delayed: boolean | null;
  production_delay_days: number | null;
  production_finished: boolean | null;
  production_finished_at: string | null;
  delivery_estimated_days: number | null;
  client_id: string | null;
  delivery_address: string | null;
  contact_number: string | null;
  authorized_receiver_name: string | null;
  authorized_receiver_contact: string | null;
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

export async function updateOrder(id: string, data: {
  client_name?: string;
  sales_agent?: string;
  total_amount?: number;
  quotation_number?: string;
  action_token: string;
}): Promise<Order> {
  return fetchJson<Order>(`/orders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteOrder(id: string, actionToken: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(`/orders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ action_token: actionToken }),
  });
}

export async function sendOtpForAction(email: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>('/auth/send-otp', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function verifyOtpForAction(email: string, otp: string): Promise<{ ok: boolean; actionToken: string }> {
  return fetchJson<{ ok: boolean; actionToken: string }>('/auth/verify-otp-for-action', {
    method: 'POST',
    body: JSON.stringify({ email, otp }),
  });
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

export interface SearchResult {
  orders: Order[];
}

export async function searchOrders(query: string): Promise<SearchResult> {
  return fetchJson<SearchResult>(`/search?q=${encodeURIComponent(query)}`);
}

export interface CalendarNote {
  id: string;
  note_date: string;
  title: string;
  content: string;
  color: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function getCalendarNotes(): Promise<CalendarNote[]> {
  return fetchJson<CalendarNote[]>('/calendar/notes');
}

export async function getCalendarNotesByDate(date: string): Promise<CalendarNote[]> {
  return fetchJson<CalendarNote[]>(`/calendar/notes/${date}`);
}

export async function createCalendarNote(note: {
  note_date: string;
  title: string;
  content?: string;
  color?: string;
}): Promise<CalendarNote> {
  return fetchJson<CalendarNote>('/calendar/notes', {
    method: 'POST',
    body: JSON.stringify(note),
  });
}

export async function updateCalendarNote(
  id: string,
  data: { title?: string; content?: string; color?: string }
): Promise<CalendarNote> {
  return fetchJson<CalendarNote>(`/calendar/notes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteCalendarNote(id: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(`/calendar/notes/${id}`, {
    method: 'DELETE',
  });
}

// ── Bot Logs ──────────────────────────────────────────────────────────

export interface BotLogEntry {
  id: string;
  chat_id: string;
  user_id: string | null;
  username: string | null;
  message_type: string;
  direction: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
  created_at: string;
}

export interface BotLogsQuery {
  limit?: number;
  offset?: number;
  chat_id?: string;
  message_type?: string;
  status?: string;
}

export async function getBotLogs(query?: BotLogsQuery): Promise<BotLogEntry[]> {
  const params = new URLSearchParams();
  if (query?.limit) params.set('limit', String(query.limit));
  if (query?.offset) params.set('offset', String(query.offset));
  if (query?.chat_id) params.set('chat_id', query.chat_id);
  if (query?.message_type) params.set('message_type', query.message_type);
  if (query?.status) params.set('status', query.status);
  const qs = params.toString();
  return fetchJson<BotLogEntry[]>(`/bot-logs${qs ? `?${qs}` : ''}`);
}

// ── Clients ───────────────────────────────────────────────────────────

export interface Client {
  id: string;
  client_name: string;
  delivery_address: string | null;
  contact_number: string | null;
  authorized_receiver_name: string | null;
  authorized_receiver_contact: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function getClients(): Promise<Client[]> {
  return fetchJson<Client[]>('/clients');
}

export async function searchClients(q: string): Promise<Client[]> {
  return fetchJson<Client[]>(`/clients/search?q=${encodeURIComponent(q)}`);
}

export async function lookupClientByName(name: string): Promise<Client> {
  return fetchJson<Client>(`/clients/lookup/${encodeURIComponent(name)}`);
}

export async function createClient(data: {
  client_name: string;
  delivery_address?: string;
  contact_number?: string;
  authorized_receiver_name?: string;
  authorized_receiver_contact?: string;
  notes?: string;
}): Promise<Client> {
  return fetchJson<Client>('/clients', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateClient(
  id: string,
  data: {
    client_name?: string;
    delivery_address?: string;
    contact_number?: string;
    authorized_receiver_name?: string;
    authorized_receiver_contact?: string;
    notes?: string;
  }
): Promise<Client> {
  return fetchJson<Client>(`/clients/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteClient(id: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(`/clients/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
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
