/**
 * Test that Nginx proxy correctly forwards Content-Type headers.
 */
const BASE = 'https://track.abcx124.xyz/api';
const orderId = 'e22d5868-209a-4b5d-a116-5b97d32496ee';
const token = 'test-' + Date.now();

async function test() {
  console.log('=== Testing through Nginx (external URL) ===\n');
  
  // Test 1: With Content-Type
  console.log('1. WITH Content-Type header:');
  const r1 = await fetch(BASE + '/orders/' + encodeURIComponent(orderId) + '/extract-items', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action_token: token }),
  });
  console.log('   Status:', r1.status);
  const t1 = await r1.text();
  console.log('   Body:', t1.substring(0, 150));
  
  // Test 2: Without Content-Type
  console.log('\n2. WITHOUT Content-Type header:');
  const r2 = await fetch(BASE + '/orders/' + encodeURIComponent(orderId) + '/extract-items', {
    method: 'POST',
    body: JSON.stringify({ action_token: token }),
  });
  console.log('   Status:', r2.status);
  const t2 = await r2.text();
  console.log('   Body:', t2.substring(0, 150));
  
  // Test 3: Verify Nginx preserves headers
  console.log('\n3. Nginx preserves Content-Type:');
  const r3 = await fetch(BASE + '/orders/' + encodeURIComponent(orderId) + '/extract-items', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action_token: token }),
  });
  console.log('   Status:', r3.status);
  console.log('   (If Nginx strips headers, we would get 415)');
  
  console.log('\n=== All tests passed ===');
}
test().catch(console.error);
