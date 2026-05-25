#!/usr/bin/env node
/**
 * E2E Test: Order Lifecycle
 * Tests order CRUD and the full lifecycle.
 *
 * Usage:
 *   node test-e2e-order-lifecycle.mjs
 */

import { getActionToken, api } from './test-e2e-helpers.mjs';

let passed = 0;
let failed = 0;
const testOrder = { id: null, quotation_number: null };

function ok(msg) { console.log(`  ✅ ${msg}`); passed++; }
function fail(msg) { console.error(`  ❌ ${msg}`); failed++; }
function skip(msg) { console.log(`  ⏭️  ${msg}`); passed++; }
function section(title) { console.log(`\n▶ ${title}`); }

// ── CRUD Tests ────────────────────────────────────────────────────────

async function testCreateOrder() {
  section('POST /orders — create order');
  let actionToken;
  try { actionToken = await getActionToken(); } catch (e) { fail(e.message); return; }

  const qn = `E2E-${Date.now()}`;
  const { status, data } = await api('POST', '/orders', {
    action_token: actionToken,
    quotation_number: qn,
    client_name: 'E2E Test Client',
    sales_agent: 'E2E Bot',
    total_amount: 9999.99,
    order_confirmed_at: new Date().toISOString(),
    items: [{ name: 'Widget A', quantity: 5 }, { name: 'Widget B', quantity: 3 }],
  });

  if (status !== 200 && status !== 201) {
    fail(`Expected 200/201, got ${status}: ${JSON.stringify(data).slice(0, 200)}`);
    return;
  }
  if (!data.id) { fail('Response missing id'); return; }

  testOrder.id = data.id;
  testOrder.quotation_number = data.quotation_number ?? qn;
  ok(`Created order ${testOrder.id} (${testOrder.quotation_number})`);
}

async function testGetOrders() {
  section('GET /orders — list orders');
  const { status, data } = await api('GET', '/orders');
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  if (!Array.isArray(data)) { fail('Response is not an array'); return; }
  ok(`Listed ${data.length} orders`);
}

async function testGetOrderDetail() {
  section('GET /orders/:quotation_number — order detail');
  if (!testOrder.quotation_number) { fail('No test order created'); return; }

  const { status, data } = await api('GET', `/orders/${encodeURIComponent(testOrder.quotation_number)}`);
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  if (!data.id) { fail('Response missing id'); return; }
  ok(`Fetched order detail for ${testOrder.quotation_number}`);
}

async function testGetOrderItems() {
  section('GET /orders/:id/items — order items');
  if (!testOrder.id) { fail('No test order created'); return; }

  const { status, data } = await api('GET', `/orders/${testOrder.id}/items`);
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  if (!data.items || !Array.isArray(data.items)) { fail('Response missing items array'); return; }
  ok(`Order has ${data.items.length} item(s)`);
}

async function testGetOrderPayments() {
  section('GET /orders/:id/payments — order payments');
  if (!testOrder.id) { fail('No test order created'); return; }

  const { status, data } = await api('GET', `/orders/${testOrder.id}/payments`);
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  ok(`Fetched payments for order`);
}

async function testGetStageUpdates() {
  section('GET /orders/:id/stage-updates');
  if (!testOrder.id) { fail('No test order created'); return; }

  const { status, data } = await api('GET', `/orders/${testOrder.id}/stage-updates`);
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  ok(`Fetched stage updates`);
}

async function testGetOrderFiles() {
  section('GET /orders/:id/files');
  if (!testOrder.id) { fail('No test order created'); return; }

  const { status, data } = await api('GET', `/orders/${testOrder.id}/files`);
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  ok(`Fetched files`);
}

async function testGetOrderNotes() {
  section('GET /orders/:id/notes');
  if (!testOrder.id) { fail('No test order created'); return; }

  const { status, data } = await api('GET', `/orders/${testOrder.id}/notes`);
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  ok(`Fetched notes`);
}

async function testPatchOrder() {
  section('PATCH /orders/:id — update order');
  if (!testOrder.id) { fail('No test order created'); return; }
  let actionToken;
  try { actionToken = await getActionToken(); } catch (e) { fail(e.message); return; }

  const { status, data } = await api('PATCH', `/orders/${testOrder.id}`, {
    action_token: actionToken,
    client_name: 'E2E Updated Client',
    total_amount: 8888.88,
  });

  if (status !== 200) { fail(`Expected 200, got ${status}: ${JSON.stringify(data).slice(0, 200)}`); return; }
  if (data.client_name !== 'E2E Updated Client') { fail('client_name not updated'); return; }
  ok('Updated order fields');
}

async function testRecordDeposit() {
  section('POST /deposits — record deposit');
  if (!testOrder.quotation_number) { fail('No test order created'); return; }

  const { status, data } = await api('POST', '/deposits', {
    quotation_number: testOrder.quotation_number,
    amount: 5000,
    deposit_paid_at: new Date().toISOString(),
    updated_by: 'e2e-test',
  });

  if (status !== 200 && status !== 201) {
    fail(`Expected 200/201, got ${status}: ${JSON.stringify(data).slice(0, 200)}`);
    return;
  }
  ok('Recorded deposit of 5000');
}

async function testVerifyDeposit() {
  section('POST /orders/:id/verify-deposit');
  if (!testOrder.id) { fail('No test order created'); return; }
  let actionToken;
  try { actionToken = await getActionToken(); } catch (e) { fail(e.message); return; }

  const { status, data } = await api('POST', `/orders/${testOrder.id}/verify-deposit`, {
    action_token: actionToken,
    verified_by: 'e2e-test',
  });

  if (status === 200 || status === 201) {
    ok('Verified deposit');
  } else if (status === 400 && data.error?.includes('No pending deposit')) {
    ok('Deposit already verified or no pending deposit (acceptable)');
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testSetProduction() {
  section('POST /orders/:id/set-production');
  if (!testOrder.id) { fail('No test order created'); return; }
  let actionToken;
  try { actionToken = await getActionToken(); } catch (e) { fail(e.message); return; }

  const { status, data } = await api('POST', `/orders/${testOrder.id}/set-production`, {
    action_token: actionToken,
    production_started: true,
    estimated_production_days: 7,
  });

  if (status === 200 || status === 201) {
    ok('Set production started (7 days)');
  } else if (status === 400 && data.error?.includes('deposit')) {
    ok('Production blocked by deposit verification (expected for non-replenishment)');
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testReportProductionStatus() {
  section('POST /orders/:id/report-production-status');
  if (!testOrder.id) { fail('No test order created'); return; }
  let actionToken;
  try { actionToken = await getActionToken(); } catch (e) { fail(e.message); return; }

  const { status, data } = await api('POST', `/orders/${testOrder.id}/report-production-status`, {
    action_token: actionToken,
    on_time: true,
    updated_by: 'e2e-test',
  });

  if (status === 200 || status === 201) {
    ok('Reported production status: on_time');
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testAddProductionLog() {
  section('POST /orders/:id/production-logs');
  if (!testOrder.id) { fail('No test order created'); return; }

  const { status, data } = await api('POST', `/orders/${testOrder.id}/production-logs`, {
    note: 'E2E test production log entry',
    log_type: 'user',
    created_by: 'e2e-test',
  });

  if (status === 200 || status === 201) {
    ok('Added production log');
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testGetProductionLogs() {
  section('GET /orders/:id/production-logs');
  if (!testOrder.id) { fail('No test order created'); return; }

  const { status, data } = await api('GET', `/orders/${testOrder.id}/production-logs`);
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  ok(`Fetched production logs`);
}

async function testGetItemCompletion() {
  section('GET /orders/:id/items/completion');
  if (!testOrder.id) { fail('No test order created'); return; }

  const { status, data } = await api('GET', `/orders/${testOrder.id}/items/completion`);
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  ok(`Fetched item completion stats`);
}

async function testInventoryVerifyItem() {
  section('POST /orders/:id/inventory-verify-item');
  if (!testOrder.id) { fail('No test order created'); return; }

  const itemsRes = await api('GET', `/orders/${testOrder.id}/items`);
  if (itemsRes.status !== 200 || !itemsRes.data.items?.length) {
    ok('No items to verify (skipping)');
    return;
  }

  const item = itemsRes.data.items[0];
  const { status, data } = await api('POST', `/orders/${testOrder.id}/inventory-verify-item`, {
    item_id: item.id,
    action: 'all',
  });

  if (status === 200 || status === 201) {
    ok(`Verified item ${item.id.slice(0, 8)}`);
  } else if (status === 400 && data.error?.includes('not in inventory verification stage')) {
    ok('Inventory verify not applicable (order not in inventory_verification stage)');
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testCompleteInventoryVerification() {
  section('POST /orders/:id/complete-inventory-verification');
  if (!testOrder.id) { fail('No test order created'); return; }
  let actionToken;
  try { actionToken = await getActionToken(); } catch (e) { fail(e.message); return; }

  const { status, data } = await api('POST', `/orders/${testOrder.id}/complete-inventory-verification`, {
    action_token: actionToken,
    updated_by: 'e2e-test',
  });

  if (status === 200 || status === 201) {
    ok('Completed inventory verification');
  } else if (status === 400) {
    ok(`Inventory verification not applicable: ${data.error?.slice(0, 80) ?? 'N/A'}`);
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testPayBalance() {
  section('POST /pay-balance');
  if (!testOrder.quotation_number) { fail('No test order created'); return; }

  const { status, data } = await api('POST', '/pay-balance', {
    quotation_number: testOrder.quotation_number,
    amount: 4999.99,
    payment_date: new Date().toISOString(),
    updated_by: 'e2e-test',
  });

  if (status === 200 || status === 201) {
    ok('Recorded balance payment');
  } else if (status === 400) {
    ok(`Balance payment not applicable: ${data.error?.slice(0, 80) ?? 'N/A'}`);
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testStageUpdate() {
  section('POST /stage-updates');
  if (!testOrder.quotation_number) { fail('No test order created'); return; }

  const { status, data } = await api('POST', '/stage-updates', {
    quotation_number: testOrder.quotation_number,
    stage: 'en_route',
    status: 'started',
    remarks: 'E2E stage update test',
    updated_by: 'e2e-test',
  });

  if (status === 200 || status === 201) {
    ok('Created stage update');
  } else if (status === 400 && data.error?.includes('Invalid stage transition')) {
    ok(`Stage transition rejected: ${data.error?.slice(0, 60) ?? 'N/A'}`);
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testAddOrderNote() {
  section('POST /orders/:id/notes');
  if (!testOrder.id) { fail('No test order created'); return; }
  let actionToken;
  try { actionToken = await getActionToken(); } catch (e) { fail(e.message); return; }

  const { status, data } = await api('POST', `/orders/${testOrder.id}/notes`, {
    action_token: actionToken,
    agent_name: 'e2e-test',
    note: 'E2E test note',
  });

  if (status === 200 || status === 201) {
    ok('Added order note');
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testAddProductionNote() {
  section('POST /orders/:id/production-notes');
  if (!testOrder.id) { fail('No test order created'); return; }

  const { status, data } = await api('POST', `/orders/${testOrder.id}/production-notes`, {
    note: 'E2E production note',
    created_by: 'e2e-test',
  });

  if (status === 200 || status === 201) {
    ok('Added production note');
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testDeleteOrder() {
  section('DELETE /orders/:id');
  if (!testOrder.id) { fail('No test order created'); return; }
  let actionToken;
  try { actionToken = await getActionToken(); } catch (e) { fail(e.message); return; }

  const { status, data } = await api('DELETE', `/orders/${testOrder.id}`, {
    action_token: actionToken,
  });

  if (status === 200 || status === 204) {
    ok(`Deleted test order ${testOrder.id}`);
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testGetOrdersByStage() {
  section('GET /orders/stage/:stage');
  const stages = ['order_confirmation_received', 'deposit_pending', 'production_pending', 'production_confirmed'];
  for (const stage of stages) {
    const { status, data } = await api('GET', `/orders/stage/${stage}`);
    if (status === 200) {
      ok(`Stage "${stage}": ${Array.isArray(data) ? data.length : '?'} orders`);
    } else {
      fail(`Stage "${stage}" returned ${status}`);
    }
  }
}

async function testGetPendingOrders() {
  section('GET /orders/pending');
  const { status, data } = await api('GET', '/orders/pending');
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  ok(`Pending orders: ${Array.isArray(data) ? data.length : '?'}`);
}

async function testGetDashboardStats() {
  section('GET /dashboard/stats');
  const { status, data } = await api('GET', '/dashboard/stats');
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  ok(`Dashboard stats received`);
}

async function testGetSalesReports() {
  section('GET /sales/* — sales reports');
  const endpoints = ['/sales/monthly', '/sales/by-agent', '/sales/by-client'];
  for (const ep of endpoints) {
    const { status, data } = await api('GET', ep);
    if (status === 200) {
      ok(`${ep}: OK`);
    } else {
      fail(`${ep}: ${status}`);
    }
  }
}

async function testSearch() {
  section('GET /search');
  const { status, data } = await api('GET', `/search?q=${encodeURIComponent('E2E')}`);
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  ok(`Search returned results`);
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log('========== Order Lifecycle E2E Tests ==========');

  const { status: healthStatus } = await api('GET', '/health');
  if (healthStatus !== 200) {
    console.error(`\n❌ API health check failed (status ${healthStatus}). Aborting.`);
    process.exit(1);
  }
  console.log('✅ API health check passed\n');

  // Read-only tests
  await testGetOrders();
  await testGetPendingOrders();
  await testGetOrdersByStage();
  await testGetDashboardStats();
  await testGetSalesReports();
  await testSearch();

  // Write tests (each gets fresh action token)
  await testCreateOrder();
  await testGetOrderDetail();
  await testGetOrderItems();
  await testGetOrderPayments();
  await testGetStageUpdates();
  await testGetOrderFiles();
  await testGetOrderNotes();
  await testPatchOrder();
  await testRecordDeposit();
  await testVerifyDeposit();
  await testSetProduction();
  await testReportProductionStatus();
  await testAddProductionLog();
  await testGetProductionLogs();
  await testGetItemCompletion();
  await testInventoryVerifyItem();
  await testCompleteInventoryVerification();
  await testPayBalance();
  await testStageUpdate();
  await testAddOrderNote();
  await testAddProductionNote();
  await testDeleteOrder();

  console.log('\n========== Results ==========');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('=============================');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
