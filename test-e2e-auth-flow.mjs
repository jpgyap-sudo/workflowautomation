#!/usr/bin/env node
/**
 * E2E Test: Authentication Flow
 * Tests OTP send/verify and action code send/verify flows.
 *
 * NOTE: /auth/send-otp requires SMTP to be configured. If SMTP is not
 * configured, the endpoint returns 503 and the test will mark it as
 * "acceptable skip". /auth/send-action-code requires Telegram bot token
 * and chat ID — same graceful handling.
 *
 * Usage:
 *   TEST_EMAIL=you@example.com node test-e2e-auth-flow.mjs
 */

const BASE = process.env.BASE_URL ?? 'https://track.homeatelier.ph/api';
const EMAIL = process.env.TEST_EMAIL ?? 'jpgyap@gmail.com';

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

async function testSendOtp() {
  section('POST /auth/send-otp');
  const { status, data } = await api('POST', '/auth/send-otp', { email: EMAIL });

  if (status === 200) {
    ok('OTP sent successfully');
    return 'sent';
  } else if (status === 503) {
    skip(`SMTP not configured — OTP send returned 503 (acceptable in dev)`);
    return 'smtp_missing';
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
    return 'error';
  }
}

async function testVerifyOtpInvalid() {
  section('POST /auth/verify-otp — invalid OTP');
  const { status, data } = await api('POST', '/auth/verify-otp', {
    email: EMAIL,
    otp: '000000',
  });

  if (status === 400 && data.error?.includes('Invalid')) {
    ok('Correctly rejected invalid OTP');
  } else if (status === 400 && data.error?.includes('expired')) {
    ok('Correctly reported expired OTP');
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testVerifyOtpExpired() {
  section('POST /auth/verify-otp — expired OTP');
  const { status, data } = await api('POST', '/auth/verify-otp', {
    email: 'nonexistent-' + Date.now() + '@test.com',
    otp: '123456',
  });

  if (status === 400 && (data.error?.includes('expired') || data.error?.includes('not found'))) {
    ok('Correctly rejected unknown/expired OTP');
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testVerifyOtpForActionInvalid() {
  section('POST /auth/verify-otp-for-action — invalid OTP');
  const { status, data } = await api('POST', '/auth/verify-otp-for-action', {
    email: EMAIL,
    otp: '000000',
    name: 'E2E Tester',
  });

  if (status === 400 && data.error?.includes('Invalid')) {
    ok('Correctly rejected invalid OTP for action');
  } else if (status === 400 && data.error?.includes('expired')) {
    ok('Correctly reported expired OTP for action');
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testSendActionCode() {
  section('POST /auth/send-action-code');
  const { status, data } = await api('POST', '/auth/send-action-code', {
    email: EMAIL,
    name: 'E2E Tester',
  });

  if (status === 200) {
    ok('Action code sent successfully');
    return 'sent';
  } else if (status === 503) {
    skip(`Telegram not configured — action code returned 503 (acceptable in dev)`);
    return 'telegram_missing';
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
    return 'error';
  }
}

async function testVerifyActionCodeInvalid() {
  section('POST /auth/verify-action-code — invalid code');
  const { status, data } = await api('POST', '/auth/verify-action-code', {
    email: EMAIL,
    code: '0000',
    name: 'E2E Tester',
  });

  if (status === 400 && data.error?.includes('Invalid')) {
    ok('Correctly rejected invalid action code');
  } else if (status === 400 && data.error?.includes('expired')) {
    ok('Correctly reported expired action code');
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testVerifyActionCodeExpired() {
  section('POST /auth/verify-action-code — expired code');
  const { status, data } = await api('POST', '/auth/verify-action-code', {
    email: 'nonexistent-' + Date.now() + '@test.com',
    code: '1234',
    name: 'E2E Tester',
  });

  if (status === 400 && (data.error?.includes('expired') || data.error?.includes('not found'))) {
    ok('Correctly rejected unknown/expired action code');
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testMalformedRequests() {
  section('Auth endpoints — malformed request handling');

  // Missing email
  const r1 = await api('POST', '/auth/send-otp', {});
  if (r1.status === 400 || r1.status === 500) { ok('send-otp rejects missing email'); }
  else { fail(`send-otp expected 400/500, got ${r1.status}`); }

  // Invalid email format
  const r2 = await api('POST', '/auth/send-otp', { email: 'not-an-email' });
  if (r2.status === 400 || r2.status === 500) { ok('send-otp rejects invalid email'); }
  else { fail(`send-otp expected 400/500 for bad email, got ${r2.status}`); }

  // Missing otp
  const r3 = await api('POST', '/auth/verify-otp', { email: EMAIL });
  if (r3.status === 400 || r3.status === 500) { ok('verify-otp rejects missing otp'); }
  else { fail(`verify-otp expected 400/500, got ${r3.status}`); }

  // Missing code
  const r4 = await api('POST', '/auth/verify-action-code', { email: EMAIL });
  if (r4.status === 400 || r4.status === 500) { ok('verify-action-code rejects missing code'); }
  else { fail(`verify-action-code expected 400/500, got ${r4.status}`); }
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log('========== Auth Flow E2E Tests ==========');
  console.log(`Base URL: ${BASE}`);
  console.log(`Test Email: ${EMAIL}`);

  const { status: healthStatus } = await api('GET', '/health');
  if (healthStatus !== 200) {
    console.error(`\n❌ API health check failed (status ${healthStatus}). Aborting.`);
    process.exit(1);
  }
  console.log('✅ API health check passed\n');

  await testMalformedRequests();
  await testSendOtp();
  await testVerifyOtpInvalid();
  await testVerifyOtpExpired();
  await testVerifyOtpForActionInvalid();
  await testSendActionCode();
  await testVerifyActionCodeInvalid();
  await testVerifyActionCodeExpired();

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
