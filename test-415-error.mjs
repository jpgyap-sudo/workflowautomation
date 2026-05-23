/**
 * Test script for the 415 Unsupported Media Type error
 * on POST /orders/:id/extract-items
 *
 * Tests:
 * 1. Direct API call with Content-Type: application/json
 * 2. Direct API call without Content-Type
 * 3. Via Nginx proxy with Content-Type
 * 4. Via Nginx proxy without Content-Type
 * 5. Check if the dashboard's compiled JS has the fix
 */

const API_DIRECT = 'http://165.22.110.111:8080';
const API_VIA_NGINX = 'https://track.abcx124.xyz/api';

// Use a known order ID from the system
const ORDER_ID = 'test-order-id';

async function testDirect() {
  console.log('\n=== Test 1: Direct API with Content-Type ===');
  try {
    const res = await fetch(`${API_DIRECT}/orders/${ORDER_ID}/extract-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action_token: 'invalid-test-token' }),
    });
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Response: ${text}`);
    // Expected: 401 (invalid token) — means route works with correct Content-Type
    if (res.status === 401) {
      console.log('✅ PASS: Route accepts JSON body with Content-Type header');
    } else if (res.status === 415) {
      console.log('❌ FAIL: Still getting 415 even with Content-Type');
    }
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }

  console.log('\n=== Test 2: Direct API without Content-Type ===');
  try {
    const res = await fetch(`${API_DIRECT}/orders/${ORDER_ID}/extract-items`, {
      method: 'POST',
      body: JSON.stringify({ action_token: 'invalid-test-token' }),
    });
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Response: ${text}`);
    if (res.status === 415) {
      console.log('✅ CONFIRMED: Without Content-Type, Fastify returns 415');
    }
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

async function testViaNginx() {
  console.log('\n=== Test 3: Via Nginx with Content-Type ===');
  try {
    const res = await fetch(`${API_VIA_NGINX}/orders/${ORDER_ID}/extract-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action_token: 'invalid-test-token' }),
    });
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Response: ${text}`);
    if (res.status === 401) {
      console.log('✅ PASS: Via Nginx, route accepts JSON with Content-Type');
    } else if (res.status === 415) {
      console.log('❌ FAIL: Via Nginx, still 415 even with Content-Type — Nginx might be stripping headers');
    }
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }

  console.log('\n=== Test 4: Via Nginx without Content-Type ===');
  try {
    const res = await fetch(`${API_VIA_NGINX}/orders/${ORDER_ID}/extract-items`, {
      method: 'POST',
      body: JSON.stringify({ action_token: 'invalid-test-token' }),
    });
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Response: ${text}`);
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

async function testHealth() {
  console.log('\n=== Test 5: Health check ===');
  try {
    const res = await fetch(`${API_DIRECT}/health`);
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Response: ${text}`);
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

async function main() {
  console.log('🔍 415 Error Diagnostic Tests');
  console.log('==============================');
  
  await testHealth();
  await testDirect();
  await testViaNginx();
  
  console.log('\n==============================');
  console.log('📋 Summary:');
  console.log('- If Test 1 returns 401: API works fine with correct Content-Type');
  console.log('- If Test 1 returns 415: API has a problem even with correct headers');
  console.log('- If Test 3 returns 401 but user still gets 415: Browser caching or extension issue');
  console.log('- If Test 3 returns 415: Nginx might be stripping Content-Type header');
}

main().catch(console.error);
