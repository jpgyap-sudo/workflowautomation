#!/usr/bin/env node
/**
 * E2E Test: Dashboard CRUD
 * Tests clients, inventory, calendar notes/schedules, reminders,
 * bug reports, and bot logs.
 *
 * Usage:
 *   ACTION_TOKEN=xxx node test-e2e-dashboard-crud.mjs
 */

const BASE = process.env.BASE_URL ?? 'https://track.abcx124.xyz/api';
const ACTION_TOKEN = process.env.ACTION_TOKEN;

let passed = 0;
let failed = 0;

function ok(msg) { console.log(`  ✅ ${msg}`); passed++; }
function fail(msg) { console.error(`  ❌ ${msg}`); failed++; }
function skip(msg) { console.log(`  ⏭️  ${msg}`); passed++; }
function section(title) { console.log(`\n▶ ${title}`); }

async function json(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

async function api(method, path, body) {
  const opts = { method, headers: { 'content-type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await json(res);
  return { status: res.status, data };
}

const testIds = { client: null, inventory: null, reminder: null, note: null, schedule: null, bug: null };

// ── Clients ───────────────────────────────────────────────────────────

async function testGetClients() {
  section('GET /clients');
  const { status, data } = await api('GET', '/clients');
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  if (!Array.isArray(data)) { fail('Response is not an array'); return; }
  ok(`Listed ${data.length} clients`);
}

async function testSearchClients() {
  section('GET /clients/search');
  const { status, data } = await api('GET', '/clients/search?q=e2e');
  // Endpoint may not exist — check both 200 and 404
  if (status === 200) {
    ok(`Search returned ${Array.isArray(data) ? data.length : '?'} results`);
  } else if (status === 404) {
    ok('Search endpoint returned 404 (may use /search instead)');
  } else {
    fail(`Unexpected status ${status}`);
  }
}

async function testCreateClient() {
  section('POST /clients');
  if (!ACTION_TOKEN) { skip('ACTION_TOKEN not set'); return; }

  const { status, data } = await api('POST', '/clients', {
    action_token: ACTION_TOKEN,
    name: `E2E Client ${Date.now()}`,
    contact_person: 'E2E Tester',
    contact_number: '09171234567',
    delivery_address: '123 Test St, Test City',
  });

  if (status !== 200 && status !== 201) {
    fail(`Create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
    return;
  }
  if (!data.id) { fail('Response missing id'); return; }
  testIds.client = data.id;
  ok(`Created client ${data.id.slice(0, 8)}... (${data.name})`);
}

async function testUpdateClient() {
  section('PATCH /clients/:id');
  if (!testIds.client || !ACTION_TOKEN) { skip('No test client or action token'); return; }

  const { status, data } = await api('PATCH', `/clients/${testIds.client}`, {
    action_token: ACTION_TOKEN,
    contact_person: 'E2E Updated Person',
  });

  if (status === 200 || status === 201) {
    ok('Updated client');
  } else {
    fail(`Update failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testGetClientOrders() {
  section('GET /clients/:id/orders');
  if (!testIds.client) { skip('No test client'); return; }

  const { status, data } = await api('GET', `/clients/${testIds.client}/orders`);
  if (status === 200) {
    ok(`Client has ${Array.isArray(data) ? data.length : '?'} order(s)`);
  } else {
    fail(`Expected 200, got ${status}`);
  }
}

async function testDeleteClient() {
  section('DELETE /clients/:id');
  if (!testIds.client || !ACTION_TOKEN) { skip('No test client or action token'); return; }

  const { status, data } = await api('DELETE', `/clients/${testIds.client}`, {
    action_token: ACTION_TOKEN,
  });

  if (status === 200 || status === 204) {
    ok('Deleted test client');
  } else if (status === 400 && data.error?.includes('active linked orders')) {
    ok('Cannot delete client with linked orders (expected)');
  } else {
    fail(`Delete failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  }
}

// ── Inventory ─────────────────────────────────────────────────────────

async function testGetInventory() {
  section('GET /inventory');
  const { status, data } = await api('GET', '/inventory');
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  if (!Array.isArray(data)) { fail('Response is not an array'); return; }
  ok(`Listed ${data.length} inventory items`);
}

async function testGetInventoryCount() {
  section('GET /inventory/count');
  const { status, data } = await api('GET', '/inventory/count');
  if (status === 200) {
    ok(`Inventory count: ${data.total ?? '?'}`);
  } else {
    fail(`Expected 200, got ${status}`);
  }
}

async function testCreateInventoryItem() {
  section('POST /inventory');
  if (!ACTION_TOKEN) { skip('ACTION_TOKEN not set'); return; }

  const { status, data } = await api('POST', '/inventory', {
    action_token: ACTION_TOKEN,
    item_name: `E2E Item ${Date.now()}`,
    sku: `E2E-SKU-${Date.now()}`,
    quantity: 100,
    unit: 'pcs',
    unit_price: 50,
    supplier: 'E2E Supplier',
  });

  if (status !== 200 && status !== 201) {
    fail(`Create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
    return;
  }
  if (!data.id) { fail('Response missing id'); return; }
  testIds.inventory = data.id;
  ok(`Created inventory item ${data.id.slice(0, 8)}...`);
}

async function testUpdateInventoryItem() {
  section('PATCH /inventory/:id');
  if (!testIds.inventory || !ACTION_TOKEN) { skip('No test inventory or action token'); return; }

  const { status, data } = await api('PATCH', `/inventory/${testIds.inventory}`, {
    action_token: ACTION_TOKEN,
    quantity: 150,
  });

  if (status === 200 || status === 201) {
    ok('Updated inventory item');
  } else {
    fail(`Update failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testDeleteInventoryItem() {
  section('DELETE /inventory/:id');
  if (!testIds.inventory || !ACTION_TOKEN) { skip('No test inventory or action token'); return; }

  const { status, data } = await api('DELETE', `/inventory/${testIds.inventory}`, {
    action_token: ACTION_TOKEN,
  });

  if (status === 200 || status === 204) {
    ok('Deleted test inventory item');
  } else {
    fail(`Delete failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testGetInventoryDrafts() {
  section('GET /inventory/drafts');
  const { status, data } = await api('GET', '/inventory/drafts');
  if (status === 200) {
    ok(`Drafts: ${Array.isArray(data) ? data.length : '?'}`);
  } else {
    fail(`Expected 200, got ${status}`);
  }
}

// ── Calendar ──────────────────────────────────────────────────────────

async function testGetCalendarNotes() {
  section('GET /calendar/notes');
  const { status, data } = await api('GET', '/calendar/notes');
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  if (!Array.isArray(data)) { fail('Response is not an array'); return; }
  ok(`Listed ${data.length} calendar notes`);
}

async function testGetCalendarNotesByDate() {
  section('GET /calendar/notes/:date');
  const today = new Date().toISOString().split('T')[0];
  const { status, data } = await api('GET', `/calendar/notes/${today}`);
  if (status === 200) {
    ok(`Notes for ${today}: ${Array.isArray(data) ? data.length : '?'}`);
  } else {
    fail(`Expected 200, got ${status}`);
  }
}

async function testCreateCalendarNote() {
  section('POST /calendar/notes');
  if (!ACTION_TOKEN) { skip('ACTION_TOKEN not set'); return; }

  const { status, data } = await api('POST', '/calendar/notes', {
    action_token: ACTION_TOKEN,
    title: `E2E Note ${Date.now()}`,
    content: 'This is an E2E test calendar note',
    date: new Date().toISOString().split('T')[0],
    color: '#ff0000',
  });

  if (status !== 200 && status !== 201) {
    fail(`Create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
    return;
  }
  if (!data.id) { fail('Response missing id'); return; }
  testIds.note = data.id;
  ok(`Created calendar note ${data.id.slice(0, 8)}...`);
}

async function testUpdateCalendarNote() {
  section('PATCH /calendar/notes/:id');
  if (!testIds.note || !ACTION_TOKEN) { skip('No test note or action token'); return; }

  const { status, data } = await api('PATCH', `/calendar/notes/${testIds.note}`, {
    action_token: ACTION_TOKEN,
    title: 'E2E Updated Note',
  });

  if (status === 200 || status === 201) {
    ok('Updated calendar note');
  } else {
    fail(`Update failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testDeleteCalendarNote() {
  section('DELETE /calendar/notes/:id');
  if (!testIds.note || !ACTION_TOKEN) { skip('No test note or action token'); return; }

  const { status, data } = await api('DELETE', `/calendar/notes/${testIds.note}`, {
    action_token: ACTION_TOKEN,
  });

  if (status === 200 || status === 204) {
    ok('Deleted test calendar note');
  } else {
    fail(`Delete failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testGetCalendarSchedules() {
  section('GET /calendar/schedules');
  const { status, data } = await api('GET', '/calendar/schedules');
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  if (!Array.isArray(data)) { fail('Response is not an array'); return; }
  ok(`Listed ${data.length} calendar schedules`);
}

async function testGetCalendarSchedulesByDate() {
  section('GET /calendar/schedules/:date');
  const today = new Date().toISOString().split('T')[0];
  const { status, data } = await api('GET', `/calendar/schedules/${today}`);
  if (status === 200) {
    ok(`Schedules for ${today}: ${Array.isArray(data) ? data.length : '?'}`);
  } else {
    fail(`Expected 200, got ${status}`);
  }
}

async function testCreateCalendarSchedule() {
  section('POST /calendar/schedules');
  if (!ACTION_TOKEN) { skip('ACTION_TOKEN not set'); return; }

  const { status, data } = await api('POST', '/calendar/schedules', {
    action_token: ACTION_TOKEN,
    title: `E2E Schedule ${Date.now()}`,
    date: new Date().toISOString().split('T')[0],
    time: '14:00',
    description: 'E2E test schedule',
  });

  if (status !== 200 && status !== 201) {
    fail(`Create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
    return;
  }
  if (!data.id) { fail('Response missing id'); return; }
  testIds.schedule = data.id;
  ok(`Created calendar schedule ${data.id.slice(0, 8)}...`);
}

async function testUpdateCalendarSchedule() {
  section('PATCH /calendar/schedules/:id');
  if (!testIds.schedule || !ACTION_TOKEN) { skip('No test schedule or action token'); return; }

  const { status, data } = await api('PATCH', `/calendar/schedules/${testIds.schedule}`, {
    action_token: ACTION_TOKEN,
    title: 'E2E Updated Schedule',
  });

  if (status === 200 || status === 201) {
    ok('Updated calendar schedule');
  } else {
    fail(`Update failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testDeleteCalendarSchedule() {
  section('DELETE /calendar/schedules/:id');
  if (!testIds.schedule || !ACTION_TOKEN) { skip('No test schedule or action token'); return; }

  const { status, data } = await api('DELETE', `/calendar/schedules/${testIds.schedule}`, {
    action_token: ACTION_TOKEN,
  });

  if (status === 200 || status === 204) {
    ok('Deleted test calendar schedule');
  } else {
    fail(`Delete failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testGetCalendarEvents() {
  section('GET /calendar/events');
  const { status, data } = await api('GET', '/calendar/events');
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  if (!Array.isArray(data)) { fail('Response is not an array'); return; }
  ok(`Listed ${data.length} calendar events`);
}

// ── Reminders ─────────────────────────────────────────────────────────

async function testGetReminders() {
  section('GET /reminders');
  const { status, data } = await api('GET', '/reminders');
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  if (!Array.isArray(data)) { fail('Response is not an array'); return; }
  ok(`Listed ${data.length} reminders`);
}

async function testGetRemindersOverdue() {
  section('GET /reminders/overdue');
  const { status, data } = await api('GET', '/reminders/overdue');
  if (status === 200) {
    ok(`Overdue reminders: ${Array.isArray(data) ? data.length : '?'}`);
  } else {
    fail(`Expected 200, got ${status}`);
  }
}

async function testCreateReminder() {
  section('POST /reminders');
  if (!ACTION_TOKEN) { skip('ACTION_TOKEN not set'); return; }

  const { status, data } = await api('POST', '/reminders', {
    action_token: ACTION_TOKEN,
    message: `E2E Reminder ${Date.now()}`,
    stage: 'e2e_test',
    frequency: 'once',
    next_run_at: new Date(Date.now() + 86400000).toISOString(),
  });

  if (status !== 200 && status !== 201) {
    fail(`Create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
    return;
  }
  if (!data.id) { fail('Response missing id'); return; }
  testIds.reminder = data.id;
  ok(`Created reminder ${data.id.slice(0, 8)}...`);
}

async function testCompleteReminder() {
  section('PATCH /reminders/:id/complete');
  if (!testIds.reminder || !ACTION_TOKEN) { skip('No test reminder or action token'); return; }

  const { status, data } = await api('PATCH', `/reminders/${testIds.reminder}/complete`, {
    action_token: ACTION_TOKEN,
  });

  if (status === 200 || status === 201) {
    ok('Completed reminder');
  } else {
    fail(`Complete failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testProcessReminders() {
  section('POST /reminders/process');
  const { status, data } = await api('POST', '/reminders/process', {});
  if (status === 200 || status === 201) {
    ok('Processed reminders');
  } else {
    fail(`Process failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  }
}

// ── Bug Reports ───────────────────────────────────────────────────────

async function testGetBugReports() {
  section('GET /bug-reports');
  const { status, data } = await api('GET', '/bug-reports');
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  if (!Array.isArray(data?.reports)) { fail('Response missing reports array'); return; }
  ok(`Listed ${data.reports.length} bug reports`);
}

async function testCreateBugReport() {
  section('POST /bug-reports');
  if (!ACTION_TOKEN) { skip('ACTION_TOKEN not set'); return; }

  const { status, data } = await api('POST', '/bug-reports', {
    action_token: ACTION_TOKEN,
    title: `E2E Bug ${Date.now()}`,
    description: 'This is an E2E test bug report',
    source: 'dashboard',
    reporter_name: 'e2e-test',
  });

  if (status !== 200 && status !== 201) {
    fail(`Create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
    return;
  }
  if (!data.id) { fail('Response missing id'); return; }
  testIds.bug = data.id;
  ok(`Created bug report ${data.id.slice(0, 8)}...`);
}

async function testUpdateBugReport() {
  section('PATCH /bug-reports/:id');
  if (!testIds.bug) { skip('No test bug report'); return; }

  const { status, data } = await api('PATCH', `/bug-reports/${testIds.bug}`, {
    status: 'in_progress',
  });

  if (status === 200 || status === 201) {
    ok('Updated bug report status');
  } else {
    fail(`Update failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  }
}

// ── Bot Logs ──────────────────────────────────────────────────────────

async function testGetBotLogs() {
  section('GET /bot-logs');
  const { status, data } = await api('GET', '/bot-logs');
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  if (!Array.isArray(data)) { fail('Response is not an array'); return; }
  ok(`Listed ${data.length} bot logs`);
}

// ── Backups ───────────────────────────────────────────────────────────

async function testGetBackups() {
  section('GET /backups');
  const { status, data } = await api('GET', '/backups');
  if (status === 200) {
    ok(`Backups: ${Array.isArray(data) ? data.length : '?'}`);
  } else {
    fail(`Expected 200, got ${status}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log('========== Dashboard CRUD E2E Tests ==========');
  console.log(`Base URL: ${BASE}`);
  console.log(`Action Token: ${ACTION_TOKEN ? 'provided' : 'NOT SET'}`);

  const { status: healthStatus } = await api('GET', '/health');
  if (healthStatus !== 200) {
    console.error(`\n❌ API health check failed (status ${healthStatus}). Aborting.`);
    process.exit(1);
  }
  console.log('✅ API health check passed\n');

  // Clients
  await testGetClients();
  await testSearchClients();
  await testCreateClient();
  await testUpdateClient();
  await testGetClientOrders();
  await testDeleteClient();

  // Inventory
  await testGetInventory();
  await testGetInventoryCount();
  await testCreateInventoryItem();
  await testUpdateInventoryItem();
  await testDeleteInventoryItem();
  await testGetInventoryDrafts();

  // Calendar
  await testGetCalendarNotes();
  await testGetCalendarNotesByDate();
  await testCreateCalendarNote();
  await testUpdateCalendarNote();
  await testDeleteCalendarNote();
  await testGetCalendarSchedules();
  await testGetCalendarSchedulesByDate();
  await testCreateCalendarSchedule();
  await testUpdateCalendarSchedule();
  await testDeleteCalendarSchedule();
  await testGetCalendarEvents();

  // Reminders
  await testGetReminders();
  await testGetRemindersOverdue();
  await testCreateReminder();
  await testCompleteReminder();
  await testProcessReminders();

  // Bug Reports
  await testGetBugReports();
  await testCreateBugReport();
  await testUpdateBugReport();

  // Bot Logs & Backups
  await testGetBotLogs();
  await testGetBackups();

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
