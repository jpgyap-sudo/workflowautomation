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
  inventory_en_route_at: string | null;
  estimated_inventory_arrival_days: number | null;
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
  production_exception: boolean | null;
  production_exception_notes: string | null;
  production_exception_granted_at: string | null;
  production_exception_granted_by: string | null;
  inventory_verified_at: string | null;
  inventory_verification_pct: number | null;
  total_amount_changed: boolean | null;
  previous_total_amount: number | null;
  amount_change_reason: string | null;
  amount_changed_at: string | null;
  amount_changed_by: string | null;
  order_type: string | null;
  stock_prep_days: number | null;
  stock_prep_ready_at: string | null;
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
  // Build headers: start with Content-Type for POST/PATCH/PUT with body,
  // then merge any caller-supplied headers (e.g. Content-Type, Authorization)
  const headers: Record<string, string> = {
    ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options?.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string; detail?: string };
      message = parsed.error || parsed.message || parsed.detail || text;
    } catch {
      // Keep raw response text.
    }
    throw new Error(`API error ${res.status}: ${message}`);
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
  items?: Array<{ name: string; quantity: number }>;
  action_token?: string;
  order_type?: 'from_stock';
  stock_prep_days?: number;
}): Promise<Order> {
  return fetchJson<Order>('/orders', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function markStockReady(
  orderId: string,
  opts: { deduct_inventory?: boolean; updated_by?: string } = {},
): Promise<{ ok: boolean; next_stage: string }> {
  return fetchJson<{ ok: boolean; next_stage: string }>(`/orders/${orderId}/stock-ready`, {
    method: 'POST',
    body: JSON.stringify({ deduct_inventory: opts.deduct_inventory ?? true, updated_by: opts.updated_by }),
  });
}

export async function setStockPrep(
  orderId: string,
  stock_prep_days: number,
): Promise<{ ok: boolean; stock_prep_ready_at: string }> {
  return fetchJson<{ ok: boolean; stock_prep_ready_at: string }>(`/orders/${orderId}/set-stock-prep`, {
    method: 'POST',
    body: JSON.stringify({ stock_prep_days }),
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
    body: JSON.stringify({ updated_by: 'dashboard_quick_action', ...data }),
  });
}

export interface VisionExtractResult {
  ok: boolean;
  type: 'quotation' | 'payment' | 'inventory' | 'unknown';
  payment?: {
    amount?: number;
    type?: 'deposit' | 'balance' | 'full' | 'unknown';
    reference_number?: string;
    paid_by?: string;
    payment_date?: string;
  };
  quotation?: {
    quotation_number?: string;
    client_name?: string;
    sales_agent?: string;
    total_amount?: number;
    order_date?: string;
    items?: { product_name?: string; quantity?: number }[];
  };
  raw_text: string;
  confidence: 'high' | 'medium' | 'low';
  error?: string;
}

export async function visionExtract(data: {
  image_base64: string;
  mime_type: string;
  mode?: 'auto' | 'quotation' | 'payment';
}): Promise<VisionExtractResult> {
  return fetchJson<VisionExtractResult>('/vision/extract', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function recordDepositWithFile(data: {
  quotation_number: string;
  amount: number;
  deposit_paid_at?: string;
  updated_by?: string;
  image_base64?: string;
  mime_type?: string;
  original_filename?: string;
  action_token?: string;
}): Promise<{ ok: boolean; quotation_number: string; amount: number }> {
  // First upload the file if provided
  if (data.image_base64 && data.original_filename) {
    await uploadOrderFile({
      quotation_number: data.quotation_number,
      file_type: 'deposit',
      original_filename: data.original_filename,
      mime_type: data.mime_type ?? 'image/jpeg',
      file_data: data.image_base64,
    }).catch((err) => {
      console.warn('[recordDepositWithFile] File upload failed (non-fatal):', err);
    });
  }

  // Then record the deposit
  // action_token is optional — API accepts it for audit logging but does not require it
  return fetchJson<{ ok: boolean; quotation_number: string; amount: number }>('/deposits', {
    method: 'POST',
    body: JSON.stringify({
      quotation_number: data.quotation_number,
      amount: data.amount,
      deposit_paid_at: data.deposit_paid_at,
      updated_by: data.updated_by ?? 'dashboard_quick_action',
      image_url: null,
      ...(data.action_token ? { action_token: data.action_token } : {}),
    }),
  });
}

export async function recordFullPaymentWithFile(data: {
  quotation_number: string;
  amount: number;
  payment_date?: string;
  reference_number?: string;
  paid_by?: string;
  updated_by?: string;
  image_base64?: string;
  mime_type?: string;
  original_filename?: string;
  action_token?: string;
}): Promise<{ ok: boolean; quotation_number: string; amount: number; is_fully_paid: boolean; depositPortion?: number; balancePortion?: number; overpayment?: number }> {
  if (data.image_base64 && data.original_filename) {
    await uploadOrderFile({
      quotation_number: data.quotation_number,
      file_type: 'full_payment',
      original_filename: data.original_filename,
      mime_type: data.mime_type ?? 'image/jpeg',
      file_data: data.image_base64,
    }).catch((err) => {
      console.warn('[recordFullPaymentWithFile] File upload failed (non-fatal):', err);
    });
  }

  return fetchJson<{ ok: boolean; quotation_number: string; amount: number; is_fully_paid: boolean; depositPortion?: number; balancePortion?: number; overpayment?: number }>('/full-payment', {
    method: 'POST',
    body: JSON.stringify({
      quotation_number: data.quotation_number,
      amount: data.amount,
      payment_date: data.payment_date,
      reference_number: data.reference_number,
      paid_by: data.paid_by ?? 'new_order',
      updated_by: data.updated_by ?? 'new_order_full_payment',
      ...(data.action_token ? { action_token: data.action_token } : {}),
    }),
  });
}

export async function payBalance(data: {
  quotation_number: string;
  amount: number;
  payment_date?: string;
  reference_number?: string;
  updated_by?: string;
  action_token?: string;
}): Promise<{ ok: boolean; expected_balance?: number; balance_total?: number; remaining_balance?: number; is_fully_paid?: boolean; overpayment?: number }> {
  return fetchJson<{ ok: boolean; expected_balance?: number; balance_total?: number; remaining_balance?: number; is_fully_paid?: boolean; overpayment?: number }>('/pay-balance', {
    method: 'POST',
    body: JSON.stringify({ updated_by: 'dashboard_quick_action', ...data }),
  });
}

export async function payBalanceWithFile(data: {
  quotation_number: string;
  amount: number;
  payment_date?: string;
  reference_number?: string;
  updated_by?: string;
  action_token?: string;
  image_base64?: string;
  mime_type?: string;
  original_filename?: string;
}): Promise<{ ok: boolean; expected_balance?: number; balance_total?: number; remaining_balance?: number; is_fully_paid?: boolean; overpayment?: number }> {
  // Upload the proof file first if provided
  if (data.image_base64 && data.original_filename) {
    await uploadOrderFile({
      quotation_number: data.quotation_number,
      file_type: 'balance_proof',
      original_filename: data.original_filename,
      mime_type: data.mime_type ?? 'image/jpeg',
      file_data: data.image_base64,
    });
  }

  return fetchJson<{ ok: boolean; expected_balance?: number; balance_total?: number; remaining_balance?: number; is_fully_paid?: boolean; overpayment?: number }>('/pay-balance', {
    method: 'POST',
    body: JSON.stringify({
      quotation_number: data.quotation_number,
      amount: data.amount,
      payment_date: data.payment_date,
      reference_number: data.reference_number,
      updated_by: data.updated_by ?? 'dashboard_quick_action',
      action_token: data.action_token,
    }),
  });
}

export async function verifyDeposit(
  id: string,
  data: { verified_by?: string; action_token: string },
): Promise<{ ok: boolean; quotation_number: string; next_stage: string }> {
  return fetchJson<{ ok: boolean; quotation_number: string; next_stage: string }>(
    `/orders/${encodeURIComponent(id)}/verify-deposit`,
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export async function verifyBalance(
  id: string,
  data: { verified_by?: string; action_token: string },
): Promise<{ ok: boolean; quotation_number: string; next_stage: string }> {
  return fetchJson<{ ok: boolean; quotation_number: string; next_stage: string }>(
    `/orders/${encodeURIComponent(id)}/verify-balance`,
    { method: 'POST', body: JSON.stringify(data) },
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
    body: JSON.stringify({ updated_by: 'dashboard_quick_action', ...data }),
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
  delivery_address?: string | null;
  contact_number?: string | null;
  authorized_receiver_name?: string | null;
  authorized_receiver_contact?: string | null;
  deposit_paid_at?: string | null;
  balance_paid_at?: string | null;
  total_amount_change_reason?: string;
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
  data: { production_started: boolean; estimated_production_days?: number; action_token: string }
): Promise<{ ok: boolean; order: Order }> {
  return fetchJson<{ ok: boolean; order: Order }>(`/orders/${encodeURIComponent(id)}/set-production`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function reportProductionStatus(
  id: string,
  data: { on_time: boolean; delay_days?: number; updated_by?: string; action_token: string }
): Promise<{ ok: boolean; order: Order }> {
  return fetchJson<{ ok: boolean; order: Order }>(`/orders/${encodeURIComponent(id)}/report-production-status`, {
    method: 'POST',
    body: JSON.stringify({ ...data, updated_by: 'dashboard_quick_action' }),
  });
}

export async function finishProduction(
  id: string,
  data: { delivery_estimated_days: number; updated_by?: string; action_token: string }
): Promise<{ ok: boolean; order: Order }> {
  return fetchJson<{ ok: boolean; order: Order }>(`/orders/${encodeURIComponent(id)}/finish-production`, {
    method: 'POST',
    body: JSON.stringify({ ...data, updated_by: 'dashboard_quick_action' }),
  });
}

export async function recalcProductionReminders(
  id: string,
  data: { estimated_production_days: number; action_token?: string }
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
  data: { estimated_arrival_days: number; updated_by?: string; action_token: string }
): Promise<{ ok: boolean; order: Order }> {
  return fetchJson<{ ok: boolean; order: Order }>(
    `/orders/${encodeURIComponent(id)}/confirm-en-route`,
    {
      method: 'POST',
      body: JSON.stringify({ ...data, updated_by: 'dashboard_quick_action' }),
    }
  );
}

// ── Inventory Verification ────────────────────────────────────────────

export async function inventoryVerifyItem(
  id: string,
  data: { item_id: string; action: 'all' | 'partial' | 'not_yet'; verified_qty?: number; action_token: string }
): Promise<{ ok: boolean; item_id: string; verified_qty: number; verification_pct: number }> {
  return fetchJson(
    `/orders/${encodeURIComponent(id)}/inventory-verify-item`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  );
}

export async function completeInventoryVerification(
  id: string,
  actionToken: string
): Promise<{ ok: boolean; message: string }> {
  return fetchJson(
    `/orders/${encodeURIComponent(id)}/complete-inventory-verification`,
    {
      method: 'POST',
      body: JSON.stringify({ action_token: actionToken }),
    }
  );
}

export async function confirmInventoryArrived(
  id: string,
  actionToken: string
): Promise<{ ok: boolean; message: string }> {
  return fetchJson(
    `/orders/${encodeURIComponent(id)}/confirm-inventory-arrived`,
    {
      method: 'POST',
      body: JSON.stringify({ action_token: actionToken }),
    }
  );
}

// ── Order Items (Item-Level Production Tracking) ─────────────────────

export interface OrderItem {
  id: string;
  order_id: string;
  name: string;
  quantity: number;
  production_status: 'pending' | 'in_progress' | 'finished';
  en_route_status: 'not_yet' | 'en_route' | 'arrived';
  estimated_arrival_days: number | null;
  estimated_production_days?: number | null;
  production_finished_at: string | null;
  inventory_verified_at: string | null;
  verified_qty: number;
  delivered_qty: number;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductionUpdateLog {
  id: string;
  order_item_id: string | null;
  order_id: string;
  note: string;
  log_type: 'user' | 'agent' | 'system';
  created_by: string | null;
  created_at: string;
  item_name: string | null;
}

export interface ItemCompletion {
  order_id: string;
  production_completion_pct: number;
  en_route_completion_pct: number;
  inventory_completion_pct: number;
}

export async function getOrderItems(orderId: string): Promise<{ ok: boolean; items: OrderItem[] }> {
  return fetchJson<{ ok: boolean; items: OrderItem[] }>(`/orders/${encodeURIComponent(orderId)}/items`);
}

export async function upsertOrderItems(
  orderId: string,
  items: { name: string; quantity: number; production_status?: string; en_route_status?: string; estimated_arrival_days?: number | null }[]
): Promise<{ ok: boolean; items: OrderItem[] }> {
  return fetchJson<{ ok: boolean; items: OrderItem[] }>(
    `/orders/${encodeURIComponent(orderId)}/items`,
    {
      method: 'POST',
      body: JSON.stringify({ items }),
    }
  );
}

export async function createOrderItem(
  orderId: string,
  data: {
    name: string;
    quantity: number;
    production_status?: string;
    en_route_status?: string;
    estimated_arrival_days?: number | null;
    estimated_production_days?: number | null;
    edit_reason?: string;
    updated_by?: string;
  }
): Promise<{ ok: boolean; item: OrderItem }> {
  return fetchJson<{ ok: boolean; item: OrderItem }>(
    `/orders/${encodeURIComponent(orderId)}/items/manual`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  );
}

export async function updateOrderItem(
  orderId: string,
  itemId: string,
  data: {
    name?: string;
    quantity?: number;
    production_status?: string;
    en_route_status?: string;
    estimated_arrival_days?: number | null;
    estimated_production_days?: number | null;
    action_token?: string;
    edit_reason?: string;
    require_reason?: boolean;
    updated_by?: string;
  }
): Promise<{ ok: boolean; item: OrderItem }> {
  return fetchJson<{ ok: boolean; item: OrderItem }>(
    `/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(data),
    }
  );
}

export async function getItemCompletion(orderId: string): Promise<{ ok: boolean } & ItemCompletion> {
  return fetchJson<{ ok: boolean } & ItemCompletion>(
    `/orders/${encodeURIComponent(orderId)}/items/completion`
  );
}

export async function getProductionLogs(orderId: string): Promise<{ ok: boolean; logs: ProductionUpdateLog[] }> {
  return fetchJson<{ ok: boolean; logs: ProductionUpdateLog[] }>(
    `/orders/${encodeURIComponent(orderId)}/production-logs`
  );
}

export async function addProductionLog(
  orderId: string,
  data: {
    order_item_id?: string | null;
    note: string;
    log_type?: string;
    created_by?: string;
  }
): Promise<{ ok: boolean; log: ProductionUpdateLog }> {
  return fetchJson<{ ok: boolean; log: ProductionUpdateLog }>(
    `/orders/${encodeURIComponent(orderId)}/production-logs`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  );
}

// ── Item Extraction ──────────────────────────────────────────────────

export async function extractOrderItems(
  orderId: string,
  actionToken: string,
): Promise<{ ok: boolean; items: OrderItem[]; extracted: { name: string; quantity: number }[]; raw_text: string }> {
  return fetchJson<{ ok: boolean; items: OrderItem[]; extracted: { name: string; quantity: number }[]; raw_text: string }>(
    `/orders/${encodeURIComponent(orderId)}/extract-items`,
    {
      method: 'POST',
      body: JSON.stringify({ action_token: actionToken }),
    }
  );
}

export async function sendOtpForAction(email: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>('/auth/send-otp', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function verifyOtpForAction(email: string, otp: string, name?: string): Promise<{ ok: boolean; actionToken: string }> {
  return fetchJson<{ ok: boolean; actionToken: string }>('/auth/verify-otp-for-action', {
    method: 'POST',
    body: JSON.stringify({ email, otp, name }),
  });
}

// ── Telegram 4-digit action verification ──────────────────────────────
export async function sendTelegramActionCode(email: string, name?: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>('/auth/send-action-code', {
    method: 'POST',
    body: JSON.stringify({ email, name }),
  });
}

export async function verifyTelegramActionCode(email: string, code: string, name?: string): Promise<{ ok: boolean; actionToken: string }> {
  return fetchJson<{ ok: boolean; actionToken: string }>('/auth/verify-action-code', {
    method: 'POST',
    body: JSON.stringify({ email, code, name }),
  });
}

export async function getStageUpdates(orderId: string): Promise<StageUpdate[]> {
  return fetchJson<StageUpdate[]>(`/orders/${orderId}/stage-updates`);
}

export async function grantDeliveryException(
  orderId: string,
  data: { notes?: string; granted_by?: string; action_token: string },
): Promise<{ ok: boolean; order: Order }> {
  return fetchJson<{ ok: boolean; order: Order }>('/orders/delivery-exception', {
    method: 'POST',
    body: JSON.stringify({ order_id: orderId, ...data }),
  });
}

export async function revokeDeliveryException(
  orderId: string,
  actionToken: string,
): Promise<{ ok: boolean; order: Order }> {
  return fetchJson<{ ok: boolean; order: Order }>('/orders/revoke-delivery-exception', {
    method: 'POST',
    body: JSON.stringify({ order_id: orderId, action_token: actionToken }),
  });
}

export async function grantProductionException(
  orderId: string,
  data: { notes?: string; granted_by?: string; action_token: string },
): Promise<{ ok: boolean; order: Order }> {
  return fetchJson<{ ok: boolean; order: Order }>('/orders/production-exception', {
    method: 'POST',
    body: JSON.stringify({ order_id: orderId, ...data }),
  });
}

export async function revokeProductionException(
  orderId: string,
  actionToken: string,
): Promise<{ ok: boolean; order: Order }> {
  return fetchJson<{ ok: boolean; order: Order }>('/orders/revoke-production-exception', {
    method: 'POST',
    body: JSON.stringify({ order_id: orderId, action_token: actionToken }),
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
  en_route_verification: { label: 'En Route Verification', color: 'bg-blue-100 text-blue-800',        icon: '🔎' },
  inventory_verification: { label: 'Inventory Verification', color: 'bg-teal-100 text-teal-800',       icon: '🔍' },
  inventory_arrived:     { label: 'Inventory Arrived',     color: 'bg-cyan-100 text-cyan-800',       icon: '📦' },
  stock_preparation:     { label: 'Stock Preparation',      color: 'bg-lime-100 text-lime-800',       icon: '📦' },
  balance_due:           { label: 'Balance Due',            color: 'bg-violet-100 text-violet-800',   icon: '⚖️' },
  balance_verification:  { label: 'Balance Verification',  color: 'bg-fuchsia-100 text-fuchsia-800', icon: '🔍' },
  delivery_pending:      { label: 'Delivery Pending',      color: 'bg-amber-100 text-amber-800',     icon: '⏳' },
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
  action_token?: string;
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
  action_token?: string;
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

export async function bulkDeleteClients(
  ids: string[],
  force = false,
  actionToken: string,
): Promise<{ ok: boolean; deleted: number; active_order_count: number; forced: boolean }> {
  return fetchJson<{ ok: boolean; deleted: number; active_order_count: number; forced: boolean }>('/clients/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids, force, action_token: actionToken }),
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
    category?: string;
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
  action_token?: string;
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

export async function bulkUploadInventory(file_data: string, mime_type: string, original_filename: string, action_token?: string): Promise<{
  ok: boolean;
  drafts_created: number;
  drafts: InventoryDraft[];
}> {
  return fetchJson('/inventory/bulk-upload', {
    method: 'POST',
    body: JSON.stringify({ file_data, mime_type, original_filename, action_token }),
  });
}

export async function createStockReplenishmentOrder(
  file_data: string,
  mime_type: string,
  original_filename: string,
  action_token: string,
  label?: string,
): Promise<{ ok: boolean; order: Order; items_created: number; items: Array<{ name: string; quantity: number }> }> {
  return fetchJson('/orders/stock-replenishment', {
    method: 'POST',
    body: JSON.stringify({ file_data, mime_type, original_filename, action_token, label }),
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

export async function approveInventoryDraft(id: string, actionToken?: string): Promise<{ ok: boolean; item: InventoryItem }> {
  return fetchJson<{ ok: boolean; item: InventoryItem }>(`/inventory/drafts/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: actionToken ? JSON.stringify({ action_token: actionToken }) : undefined,
  });
}

export async function approveAllInventoryDrafts(actionToken?: string): Promise<{ ok: boolean; approved_count: number; items: InventoryItem[] }> {
  return fetchJson('/inventory/drafts/approve-all', {
    method: 'POST',
    body: actionToken ? JSON.stringify({ action_token: actionToken }) : undefined,
  });
}

export async function rejectInventoryDraft(id: string, actionToken: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(`/inventory/drafts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ action_token: actionToken }),
  });
}

export async function clearProcessedDrafts(actionToken: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>('/inventory/drafts/clear', {
    method: 'POST',
    body: JSON.stringify({ action_token: actionToken }),
  });
}

// ── Bug Reports ────────────────────────────────────────────────────────

export interface BugReport {
  id: string;
  title: string;
  description: string;
  source: 'dashboard' | 'telegram';
  reporter_name: string | null;
  reporter_contact: string | null;
  order_reference: string | null;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  created_at: string;
  updated_at: string;
}

export async function getBugReports(): Promise<{ ok: boolean; reports: BugReport[] }> {
  return fetchJson<{ ok: boolean; reports: BugReport[] }>('/bug-reports');
}

export async function reportBug(data: {
  title: string;
  description: string;
  source?: 'dashboard' | 'telegram';
  reporter_name?: string;
  reporter_contact?: string;
  order_reference?: string;
  action_token?: string;
}): Promise<{ ok: boolean; report: BugReport }> {
  return fetchJson<{ ok: boolean; report: BugReport }>('/bug-reports', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateBugReportStatus(
  id: string,
  status: 'open' | 'in_progress' | 'resolved' | 'closed',
  actionToken: string,
): Promise<{ ok: boolean; report: BugReport }> {
  return fetchJson<{ ok: boolean; report: BugReport }>(`/bug-reports/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, action_token: actionToken }),
  });
}

// ── Order Files ────────────────────────────────────────────────────────

export async function getOrderFiles(orderId: string): Promise<{ ok: boolean; files: OrderFile[] }> {
  return fetchJson<{ ok: boolean; files: OrderFile[] }>(`/orders/${encodeURIComponent(orderId)}/files`);
}

export function getOrderFileDownloadUrl(orderId: string, fileId: string): string {
  return `${API_BASE}/orders/${encodeURIComponent(orderId)}/files/${encodeURIComponent(fileId)}/download`;
}

export async function uploadOrderFile(data: {
  order_id?: string;
  quotation_number?: string;
  file_type: string;
  original_filename: string;
  mime_type: string;
  file_data: string; // base64
}): Promise<{ ok: boolean; file: OrderFile }> {
  return fetchJson<{ ok: boolean; file: OrderFile }>('/files/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export interface Payment {
  id: string;
  type: 'deposit' | 'balance';
  amount: number;
  reference_number: string | null;
  paid_by: string | null;
  payment_date: string | null;
  image_url: string | null;
  source: string;
  verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
}

export async function getOrderPayments(orderId: string): Promise<{ ok: boolean; payments: Payment[]; totals: { deposit: number; balance: number; expected_balance: number | null; remaining_balance: number | null } }> {
  return fetchJson(`/orders/${encodeURIComponent(orderId)}/payments`);
}

export async function verifyPayment(paymentId: string, verifiedBy: string, actionToken: string): Promise<{ ok: boolean; payment?: Payment }> {
  return fetchJson(`/payments/${encodeURIComponent(paymentId)}/verify`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verified_by: verifiedBy, action_token: actionToken }),
  });
}

export async function runAgent(name: string, actionToken: string): Promise<{ ok: boolean; message?: string }> {
  return fetchJson<{ ok: boolean; message?: string }>(`/agents/run/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: JSON.stringify({ action_token: actionToken }),
  });
}

export async function postAgentNote(orderId: string, data: {
  agent_name: string;
  note: string;
  action_token: string;
}): Promise<{ ok: boolean; id: string; order_id: string; agent_name: string; note: string; created_at: string }> {
  return fetchJson(`/orders/${encodeURIComponent(orderId)}/notes`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getOrderNotes(orderId: string): Promise<{ id: string; order_id: string; agent_name: string; note: string; created_at: string }[]> {
  return fetchJson(`/orders/${encodeURIComponent(orderId)}/notes`);
}

export async function postProductionNote(orderId: string, note: string, createdBy?: string): Promise<{ id: string; order_id: string; agent_name: string; note: string; created_at: string }> {
  return fetchJson(`/orders/${encodeURIComponent(orderId)}/production-notes`, {
    method: 'POST',
    body: JSON.stringify({ note, created_by: createdBy ?? 'production-user' }),
  });
}

// ── Reminders ──────────────────────────────────────────────────────────

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

export async function createReminder(data: {
  order_id: string;
  stage: string;
  group_chat_id: string;
  message: string;
  frequency: 'hourly' | 'daily' | 'once';
  next_run_at?: string;
}): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>('/reminders', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function sendTelegramNotification(message: string, actionToken?: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>('/telegram/notify', {
    method: 'POST',
    body: JSON.stringify({ message, action_token: actionToken }),
  });
}

// ── Calendar Schedules ──────────────────────────────────────────────

export interface CalendarSchedule {
  id: string;
  title: string;
  description: string;
  schedule_date: string;
  schedule_time: string | null;
  end_time: string | null;
  is_all_day: boolean;
  color: string;
  category: string;
  created_by: string | null;
  created_by_chat_id: string | null;
  telegram_message_id: string | null;
  reminder_at: string | null;
  reminder_sent: boolean;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function getCalendarSchedules(): Promise<CalendarSchedule[]> {
  return fetchJson<CalendarSchedule[]>('/calendar/schedules');
}

export async function getCalendarSchedulesByDate(date: string): Promise<CalendarSchedule[]> {
  return fetchJson<CalendarSchedule[]>(`/calendar/schedules/by-date/${date}`);
}

export async function createCalendarSchedule(data: {
  title: string;
  description?: string;
  schedule_date: string;
  schedule_time?: string;
  end_time?: string;
  is_all_day?: boolean;
  color?: string;
  category?: string;
  reminder_at?: string;
  action_token?: string;
}): Promise<CalendarSchedule> {
  return fetchJson<CalendarSchedule>('/calendar/schedules', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateCalendarSchedule(
  id: string,
  data: {
    title?: string;
    description?: string;
    schedule_date?: string;
    schedule_time?: string | null;
    end_time?: string | null;
    is_all_day?: boolean;
    color?: string;
    category?: string;
    reminder_at?: string | null;
    status?: string;
    action_token: string;
  }
): Promise<CalendarSchedule> {
  return fetchJson<CalendarSchedule>(`/calendar/schedules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteCalendarSchedule(id: string, actionToken: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(`/calendar/schedules/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ action_token: actionToken }),
  });
}

export const STAGE_ORDER = [
  'order_confirmation_received',
  'math_verified',
  'deposit_pending',
  'deposit_verification',
  'purchasing_pending',
  'production_pending',
  'production_confirmed',
  'production_in_progress',
  'en_route',
  'en_route_verification',
  'inventory_verification',
  'inventory_arrived',
  'balance_due',
  'balance_verification',
  'delivery_pending',
  'delivery_scheduled',
  'delivered',
  'countered',
  'payment_received',
  'payment_confirmed',
  'completed',
];
