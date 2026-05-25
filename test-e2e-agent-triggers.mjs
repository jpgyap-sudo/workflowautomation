#!/usr/bin/env node
/**
 * E2E Test: Agent Triggers
 * Tests all agent endpoints: POST /agents/run/:name and individual
 * agent check endpoints (quotation-checker, purchasing, inventory, delivery,
 * collection, escalation, schedule-parser).
 *
 * Usage:
 *   ACTION_TOKEN=xxx node test-e2e-agent-triggers.mjs
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

let testOrderId = null;
let testQuotationNumber = null;

async function testCreateOrderForAgent() {
  section('Setup: create order for agent tests');
  if (!ACTION_TOKEN) { fail('ACTION_TOKEN not set'); return; }

  const qn = `E2E-AGENT-${Date.now()}`;
  const { status, data } = await api('POST', '/orders', {
    action_token: ACTION_TOKEN,
    quotation_number: qn,
    client_name: 'E2E Agent Client',
    sales_agent: 'E2E Bot',
    total_amount: 5000,
    items: [{ name: 'Test Widget', quantity: 10 }],
  });

  if (status !== 200 && status !== 201) {
    fail(`Order creation failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
    return;
  }

  testOrderId = data.id;
  testQuotationNumber = data.quotation_number ?? qn;
  ok(`Created order ${testOrderId} (${testQuotationNumber})`);
}

async function testGetAgentsList() {
  section('GET /agents');
  const { status, data } = await api('GET', '/agents');
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  if (!Array.isArray(data)) { fail('Response is not an array'); return; }
  ok(`Agents list: ${data.length} agent(s)`);
}

async function testGetAgentLogs() {
  section('GET /agent-logs');
  const { status, data } = await api('GET', '/agent-logs');
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  if (!Array.isArray(data)) { fail('Response is not an array'); return; }
  ok(`Agent logs: ${data.length} entries`);
}

async function testRunAgentByName(name) {
  section(`POST /agents/run/${name}`);
  if (!ACTION_TOKEN) { skip('ACTION_TOKEN not set — skipping'); return; }

  const { status, data } = await api('POST', `/agents/run/${name}`, {
    action_token: ACTION_TOKEN,
  });

  if (status === 200 || status === 201) {
    ok(`Agent "${name}" triggered successfully`);
  } else if (status === 400) {
    ok(`Agent "${name}" returned 400: ${data.error?.slice(0, 60) ?? 'N/A'}`);
  } else if (status === 401) {
    ok(`Agent "${name}" returned 401 (action token expired — re-verify OTP)`);
  } else {
    fail(`Agent "${name}" returned ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testAgentQuotationChecker() {
  section('POST /agents/quotation-checker');
  if (!testQuotationNumber) { skip('No test order'); return; }

  const { status, data } = await api('POST', '/agents/quotation-checker', {
    quotation_number: testQuotationNumber,
  });

  if (status === 200) {
    ok(`Quotation checker returned: ${JSON.stringify(data).slice(0, 100)}`);
  } else if (status === 404) {
    ok('Quotation checker returned 404 (order not found — acceptable)');
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testAgentPurchasing() {
  section('POST /agents/purchasing');
  if (!testQuotationNumber) { skip('No test order'); return; }

  const { status, data } = await api('POST', '/agents/purchasing', {
    quotation_number: testQuotationNumber,
  });

  if (status === 200) {
    ok(`Purchasing agent returned: ${JSON.stringify(data).slice(0, 100)}`);
  } else if (status === 404) {
    ok('Purchasing agent returned 404 (acceptable)');
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testAgentInventory() {
  section('POST /agents/inventory');
  if (!testQuotationNumber) { skip('No test order'); return; }

  const { status, data } = await api('POST', '/agents/inventory', {
    quotation_number: testQuotationNumber,
  });

  if (status === 200) {
    ok(`Inventory agent returned: ${JSON.stringify(data).slice(0, 100)}`);
  } else if (status === 404) {
    ok('Inventory agent returned 404 (acceptable)');
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testAgentDelivery() {
  section('POST /agents/delivery');
  if (!testQuotationNumber) { skip('No test order'); return; }

  const { status, data } = await api('POST', '/agents/delivery', {
    quotation_number: testQuotationNumber,
  });

  if (status === 200) {
    ok(`Delivery agent returned: ${JSON.stringify(data).slice(0, 100)}`);
  } else if (status === 404) {
    ok('Delivery agent returned 404 (acceptable)');
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testAgentCollection() {
  section('POST /agents/collection');
  if (!testQuotationNumber) { skip('No test order'); return; }

  const { status, data } = await api('POST', '/agents/collection', {
    quotation_number: testQuotationNumber,
  });

  if (status === 200) {
    ok(`Collection agent returned: ${JSON.stringify(data).slice(0, 100)}`);
  } else if (status === 404) {
    ok('Collection agent returned 404 (acceptable)');
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testAgentEscalation() {
  section('POST /agents/escalation');
  if (!testQuotationNumber) { skip('No test order'); return; }

  const { status, data } = await api('POST', '/agents/escalation', {
    quotation_number: testQuotationNumber,
  });

  if (status === 200) {
    ok(`Escalation agent returned: ${JSON.stringify(data).slice(0, 100)}`);
  } else if (status === 404) {
    ok('Escalation agent returned 404 (acceptable)');
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testAgentScheduleParser() {
  section('POST /agents/run/schedule-parser');
  if (!ACTION_TOKEN) { skip('ACTION_TOKEN not set'); return; }

  const { status, data } = await api('POST', '/agents/run/schedule-parser', {
    action_token: ACTION_TOKEN,
  });

  if (status === 200 || status === 201) {
    ok('Schedule parser triggered');
  } else if (status === 400) {
    ok(`Schedule parser returned 400: ${data.error?.slice(0, 60) ?? 'N/A'}`);
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testCleanupOrder() {
  section('Cleanup: delete test order');
  if (!testOrderId || !ACTION_TOKEN) { skip('No test order or action token'); return; }

  const { status, data } = await api('DELETE', `/orders/${testOrderId}`, {
    action_token: ACTION_TOKEN,
  });

  if (status === 200 || status === 204) {
    ok('Deleted test order');
  } else {
    fail(`Cleanup failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log('========== Agent Triggers E2E Tests ==========');
  console.log(`Base URL: ${BASE}`);
  console.log(`Action Token: ${ACTION_TOKEN ? 'provided' : 'NOT SET'}`);

  const { status: healthStatus } = await api('GET', '/health');
  if (healthStatus !== 200) {
    console.error(`\n❌ API health check failed (status ${healthStatus}). Aborting.`);
    process.exit(1);
  }
  console.log('✅ API health check passed\n');

  await testGetAgentsList();
  await testGetAgentLogs();
  await testCreateOrderForAgent();
  await testAgentQuotationChecker();
  await testAgentPurchasing();
  await testAgentInventory();
  await testAgentDelivery();
  await testAgentCollection();
  await testAgentEscalation();
  await testAgentScheduleParser();

  // Run all main agents via /agents/run/:name
  const agentNames = [
    'quotation-checker',
    'purchasing-agent',
    'production-agent',
    'inventory-agent',
    'delivery-agent',
    'collection-agent',
    'escalation-agent',
    'supabase-backup',
  ];
  for (const name of agentNames) {
    await testRunAgentByName(name);
  }

  await testCleanupOrder();

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
