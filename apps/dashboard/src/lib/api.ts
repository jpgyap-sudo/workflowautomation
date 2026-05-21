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
  deposit_verified: boolean;
  deposit_verified_at: string | null;
  deposit_verified_by: string | null;
  balance_paid: boolean;
  balance_paid_at: string | null;
  balance_verified: boolean;
  balance_verified_at: string | null;
  balance_verified_by: string | null;
  order_confirmed_at: string | null;
  production_started: boolean | null;
  production_started_at: string | null;
  estimated_production_days: number | null;
  production_delayed: boolean | null;
  production_delay_days: number | null;
  production_finished: boolean | null;
  production_finished_at: string | null;
  delivery_estimated_days: number | null;
  en_route_confirmed: boolean | null;
  en_route_confirmed_at: string | null;
  estimated_arrival_days: number | null;
  client_id: string | null;
  delivery_address: string | null;
  contact_number: string | null;
  authorized_receiver_name: string | null;
  authorized_receiver_contact: string | null;
  partial_production_items: string[] | null;
  delivery_date: string | null;
  delivery_exception: boolean | null;
  delivery_exception_notes: string | null;
  delivery_exception_granted_at: string | null;
  delivery_exception_granted_by: string | null;
  created_at: string;
  updated_at: string;
  escalation_level: number;
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
  order_id?: string;
  original_filename: string | null;
  file_type: string | null;
  google_drive_file_id: string | null;
  google_drive_url?: string | null;
  storage_backend?: string | null;
  local_file_path?: string | null;
  mime_type?: string | null;
  extracted_text?: string | null;
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

export interface SalesByAgent {
  agent: string;
  order_count: number;
  total_sales: number;
  computed_sales: number;
}

export interface SalesByClient {
  client: string;
  order_count: number;
  total_sales: number;
  computed_sales: number;
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

export async function createOrder(data: {
  quotation_number?: string;
  client_name?: string;
  sales_agent?: string;
  total_amount?: number;
}): Promise<Order> {
  return fetchJson<Order>('/orders', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function recordDeposit(data: {
  quotation_number: string;
  amount: number;
  deposit_paid_at?: string;
  updated_by?: string;
  action_token?: string;
}): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>('/deposits', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function payBalance(data: {
  quotation_number: string;
  amount: number;
  updated_by?: string;
  action_token?: string;
}): Promise<{ ok: boolean; overpayment?: number }> {
  return fetchJson<{ ok: boolean; overpayment?: number }>('/pay-balance', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function verifyDeposit(
  id: string,
  verified_by?: string,
): Promise<{ ok: boolean; quotation_number: string; next_stage: string }> {
  return fetchJson<{ ok: boolean; quotation_number: string; next_stage: string }>(
    `/orders/${encodeURIComponent(id)}/verify-deposit`,
    { method: 'POST', body: JSON.stringify({ verified_by }) },
  );
}

export async function verifyBalance(
  id: string,
  verified_by?: string,
): Promise<{ ok: boolean; quotation_number: string; next_stage: string }> {
  return fetchJson<{ ok: boolean; quotation_number: string; next_stage: string }>(
    `/orders/${encodeURIComponent(id)}/verify-balance`,
    { method: 'POST', body: JSON.stringify({ verified_by }) },
  );
}

export async function recordStageUpdate(data: {
  quotation_number: string;
  stage: string;
  status: string;
  remarks?: string;
  delivery_date?: string | null;
  updated_by?: string;
  action_token?: string;
}): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>('/stage-updates', {
    method: 'POST',
    body: JSON.stringify(data),
  });
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

export async function getOrdersPartialProduction(): Promise<Order[]> {
  return fetchJson<Order[]>('/orders/partial-production');
}

export async function updateOrder(id: string, data: {
  client_name?: string;
  sales_agent?: string;
  total_amount?: number;
  quotation_number?: string;
  delivery_date?: string | null;
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

export async function bulkDeleteOrders(ids: string[], actionToken: string): Promise<{ ok: boolean; deleted: number }> {
  return fetchJson<{ ok: boolean; deleted: number }>('/orders/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids, action_token: actionToken }),
  });
}

export async function setProduction(
  id: string,
  data: { production_started: boolean; estimated_production_days?: number }
): Promise<{ ok: boolean; order: Order }> {
  return fetchJson<{ ok: boolean; order: Order }>(`/orders/${encodeURIComponent(id)}/set-production`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function reportProductionStatus(
  id: string,
  data: { on_time: boolean; delay_days?: number }
): Promise<{ ok: boolean; order: Order }> {
  return fetchJson<{ ok: boolean; order: Order }>(`/orders/${encodeURIComponent(id)}/report-production-status`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function finishProduction(
  id: string,
  data: { delivery_estimated_days: number }
): Promise<{ ok: boolean; order: Order }> {
  return fetchJson<{ ok: boolean; order: Order }>(`/orders/${encodeURIComponent(id)}/finish-production`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function recalcProductionReminders(
  id: string,
  data: { estimated_production_days: number }
): Promise<{ ok: boolean; message: string; midpoint_date: string; finish_date: string }> {
  return fetchJson<{ ok: boolean; message: string; midpoint_date: string; finish_date: string }>(
    `/orders/${encodeURIComponent(id)}/recalc-production-reminders`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  );
}

export async function confirmEnRoute(
  id: string,
  data: { estimated_arrival_days: number }
): Promise<{ ok: boolean; order: Order }> {
  return fetchJson<{ ok: boolean; order: Order }>(
    `/orders/${encodeURIComponent(id)}/confirm-en-route`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  );
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

export async function grantDeliveryException(
  orderId: string,
  notes?: string,
  grantedBy?: string,
): Promise<{ ok: boolean; order: Order }> {
  return fetchJson<{ ok: boolean; order: Order }>('/orders/delivery-exception', {
    method: 'POST',
    body: JSON.stringify({ order_id: orderId, notes, granted_by: grantedBy }),
  });
}

export async function revokeDeliveryException(
  orderId: string,
): Promise<{ ok: boolean; order: Order }> {
  return fetchJson<{ ok: boolean; order: Order }>('/orders/revoke-delivery-exception', {
    method: 'POST',
    body: JSON.stringify({ order_id: orderId }),
  });
}

// Stage display configuration
export const STAGE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  order_confirmation_received: { label: 'Order Confirmation Received', color: 'bg-blue-100 text-blue-800', icon: '📄' },
  math_verified:         { label: 'Math Verified',         color: 'bg-teal-100 text-teal-800',       icon: '✅' },
  purchasing_pending:    { label: 'Purchasing Pending',    color: 'bg-amber-100 text-amber-800',     icon: '🛒' },
  production_pending:    { label: 'Production Pending',    color: 'bg-yellow-100 text-yellow-800',   icon: '🏗️' },
  production_confirmed:  { label: 'Production Confirmed',  color: 'bg-indigo-100 text-indigo-800',   icon: '🏭' },
  deposit_pending:       { label: 'Downpayment Pending',   color: 'bg-pink-100 text-pink-800',       icon: '💳' },
  deposit_verification:  { label: 'Deposit Verification',  color: 'bg-rose-100 text-rose-800',       icon: '🔍' },
  en_route:              { label: 'En Route',               color: 'bg-sky-100 text-sky-800',         icon: '🚚' },
  inventory_arrived:     { label: 'Inventory Arrived',     color: 'bg-cyan-100 text-cyan-800',       icon: '📦' },
  balance_due:           { label: 'Balance Due',            color: 'bg-violet-100 text-violet-800',   icon: '⚖️' },
  balance_verification:  { label: 'Balance Verification',  color: 'bg-fuchsia-100 text-fuchsia-800', icon: '🔍' },
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
  data: { title?: string; content?: string; color?: string; action_token?: string }
): Promise<CalendarNote> {
  return fetchJson<CalendarNote>(`/calendar/notes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteCalendarNote(id: string, actionToken?: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(`/calendar/notes/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ action_token: actionToken }),
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
  order_count?: number;
  active_order_count?: number;
  latest_order_at?: string | null;
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
  delivery_address?: string | null;
  contact_number?: string | null;
  authorized_receiver_name?: string | null;
  authorized_receiver_contact?: string | null;
  notes?: string | null;
  propagate_to_orders?: boolean;
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
    delivery_address?: string | null;
    contact_number?: string | null;
    authorized_receiver_name?: string | null;
    authorized_receiver_contact?: string | null;
    notes?: string | null;
    propagate_to_orders?: boolean;
    action_token?: string;
  }
): Promise<Client> {
  return fetchJson<Client>(`/clients/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function getClientOrders(id: string): Promise<Order[]> {
  return fetchJson<Order[]>(`/clients/${encodeURIComponent(id)}/orders`);
}

export async function deleteClient(
  id: string,
  force = false,
  actionToken?: string,
): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(`/clients/${encodeURIComponent(id)}${force ? '?force=true' : ''}`, {
    method: 'DELETE',
    body: JSON.stringify({ force, action_token: actionToken }),
  });
}

// ── Inventory ─────────────────────────────────────────────────────────

export interface InventoryItem {
  id: string;
  product_name: string;
  description: string | null;
  dimension: string | null;
  category: string | null;
  quantity: number;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryDraft {
  id: string;
  product_name: string | null;
  description: string | null;
  dimension: string | null;
  category: string | null;
  quantity: number | null;
  image_url: string | null;
  source_type: string;
  source_filename: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface InventoryExtractResult {
  type: 'inventory' | 'unknown';
  inventory?: Array<{
    product_name?: string;
    description?: string;
    dimension?: string;
    quantity?: number;
  }>;
  raw_text: string;
  confidence: 'high' | 'medium' | 'low';
}

export async function getInventory(): Promise<InventoryItem[]> {
  return fetchJson<InventoryItem[]>('/inventory');
}

export async function getInventoryItem(id: string): Promise<InventoryItem> {
  return fetchJson<InventoryItem>(`/inventory/${encodeURIComponent(id)}`);
}

export async function getInventoryCount(): Promise<{ total: number }> {
  return fetchJson<{ total: number }>('/inventory/count');
}

/** Returns the URL to fetch an inventory item's image from the API */
export function getInventoryImageUrl(id: string): string {
  return `${API_BASE}/inventory/${encodeURIComponent(id)}/image`;
}

export async function createInventoryItem(data: {
  product_name: string;
  description?: string | null;
  dimension?: string | null;
  category?: string | null;
  quantity?: number;
  image_url?: string | null;
}): Promise<InventoryItem> {
  return fetchJson<InventoryItem>('/inventory', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateInventoryItem(
  id: string,
  data: {
    product_name?: string;
    description?: string | null;
    dimension?: string | null;
    category?: string | null;
    quantity?: number;
    image_url?: string | null;
    action_token?: string;
  }
): Promise<InventoryItem> {
  return fetchJson<InventoryItem>(`/inventory/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteInventoryItem(id: string, actionToken?: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(`/inventory/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ action_token: actionToken }),
  });
}

export async function extractInventoryImage(image_base64: string, mime_type: string): Promise<InventoryExtractResult> {
  return fetchJson<InventoryExtractResult>('/inventory/extract-image', {
    method: 'POST',
    body: JSON.stringify({ image_base64, mime_type }),
  });
}

export async function bulkUploadInventory(file_data: string, mime_type: string, original_filename: string): Promise<{
  ok: boolean;
  drafts_created: number;
  drafts: InventoryDraft[];
}> {
  return fetchJson('/inventory/bulk-upload', {
    method: 'POST',
    body: JSON.stringify({ file_data, mime_type, original_filename }),
  });
}

export async function getInventoryDrafts(): Promise<InventoryDraft[]> {
  return fetchJson<InventoryDraft[]>('/inventory/drafts');
}

export async function updateInventoryDraft(
  id: string,
  data: {
    product_name?: string;
    description?: string | null;
    dimension?: string | null;
    category?: string | null;
    quantity?: number;
  }
): Promise<InventoryDraft> {
  return fetchJson<InventoryDraft>(`/inventory/drafts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function approveInventoryDraft(id: string): Promise<{ ok: boolean; item: InventoryItem }> {
  return fetchJson<{ ok: boolean; item: InventoryItem }>(`/inventory/drafts/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
  });
}

export async function approveAllInventoryDrafts(): Promise<{ ok: boolean; approved_count: number; items: InventoryItem[] }> {
  return fetchJson('/inventory/drafts/approve-all', {
    method: 'POST',
  });
}

export async function rejectInventoryDraft(id: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(`/inventory/drafts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function clearProcessedDrafts(): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>('/inventory/drafts/clear', {
    method: 'POST',
  });
}

// ── Order Files ────────────────────────────────────────────────────────

export async function getOrderFiles(orderId: string): Promise<{ ok: boolean; files: OrderFile[] }> {
  return fetchJson<{ ok: boolean; files: OrderFile[] }>(`/orders/${encodeURIComponent(orderId)}/files`);
}

export function getOrderFileDownloadUrl(orderId: string, fileId: string): string {
  return `${API_BASE}/orders/${encodeURIComponent(orderId)}/files/${encodeURIComponent(fileId)}/download`;
}

// ── Google Drive Upload ────────────────────────────────────────────────

export interface Reminder {
  id: string;
  order_id: string;
  stage: string;
  group_chat_id: string;
  message: string;
  frequency: string;
  next_run_at: string;
  escalation_level: number;
  status: string;
  quotation_number: string | null;
  client_name: string | null;
  created_at: string;
  updated_at: string;
}

export async function getReminders(): Promise<Reminder[]> {
  return fetchJson<Reminder[]>('/reminders');
}

export const STAGE_ORDER = [
  'order_confirmation_received',
  'math_verified',
  'purchasing_pending',
  'production_pending',
  'production_confirmed',
  'en_route',
  'deposit_pending',
  'deposit_verification',
  'inventory_arrived',
  'balance_due',
  'balance_verification',
  'delivery_scheduled',
  'delivered',
  'countered',
  'payment_received',
  'payment_confirmed',
  'completed',
];
