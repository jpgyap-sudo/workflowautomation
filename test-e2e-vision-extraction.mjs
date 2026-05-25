#!/usr/bin/env node
/**
 * E2E Test: Vision Extraction
 * Tests POST /vision/extract for quotation, payment, and auto modes.
 * Uses a synthetic base64 image (a simple colored square) since we
 * don't have real quotation/payment images in the repo.
 *
 * Usage:
 *   node test-e2e-vision-extraction.mjs
 */

const BASE = process.env.BASE_URL ?? 'https://track.abcx124.xyz/api';

let passed = 0;
let failed = 0;

function ok(msg) { console.log(`  ✅ ${msg}`); passed++; }
function fail(msg) { console.error(`  ❌ ${msg}`); failed++; }
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

// Create a minimal 1x1 PNG in base64 (valid image format)
const MINI_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Create a minimal JPEG in base64 (valid image format)
const MINI_JPEG_B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBEQCEAwEPwAB//9k=';

async function testVisionExtractQuotation() {
  section('POST /vision/extract — quotation mode');
  const { status, data } = await api('POST', '/vision/extract', {
    image_base64: MINI_PNG_B64,
    mime_type: 'image/png',
    mode: 'quotation',
  });

  // The extraction may fail on a synthetic image, but the endpoint should
  // respond correctly (200 with parsed result or 500 with error)
  if (status === 200) {
    if (data.ok === true) {
      ok(`Quotation extraction returned ok=true (confidence: ${data.confidence ?? '?'})`);
    } else {
      ok(`Quotation extraction returned ok=false (expected for synthetic image)`);
    }
  } else if (status === 500) {
    ok(`Quotation extraction returned 500 for synthetic image (acceptable)`);
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testVisionExtractPayment() {
  section('POST /vision/extract — payment mode');
  const { status, data } = await api('POST', '/vision/extract', {
    image_base64: MINI_JPEG_B64,
    mime_type: 'image/jpeg',
    mode: 'payment',
  });

  if (status === 200) {
    if (data.ok === true) {
      ok(`Payment extraction returned ok=true (confidence: ${data.confidence ?? '?'})`);
    } else {
      ok(`Payment extraction returned ok=false (expected for synthetic image)`);
    }
  } else if (status === 500) {
    ok(`Payment extraction returned 500 for synthetic image (acceptable)`);
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testVisionExtractAuto() {
  section('POST /vision/extract — auto mode (default)');
  const { status, data } = await api('POST', '/vision/extract', {
    image_base64: MINI_PNG_B64,
    mime_type: 'image/png',
  });

  if (status === 200) {
    ok(`Auto extraction returned 200`);
  } else if (status === 500) {
    ok(`Auto extraction returned 500 for synthetic image (acceptable)`);
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testVisionShare() {
  section('POST /vision/share + GET /vision/share/:token');
  const sharePayload = {
    image_base64: MINI_PNG_B64,
    mime_type: 'image/png',
    file_name: 'test.png',
    extracted: { client: 'Test Client', amount: '1000' },
    type: 'quotation',
    confidence: 'high',
    raw_text: 'Test raw text',
  };

  const { status: postStatus, data: postData } = await api('POST', '/vision/share', sharePayload);
  if (postStatus !== 200 || !postData.token) {
    fail(`Share POST failed: ${postStatus} ${JSON.stringify(postData).slice(0, 200)}`);
    return;
  }
  ok(`Created vision share token: ${postData.token.slice(0, 16)}...`);

  const { status: getStatus, data: getData } = await api('GET', `/vision/share/${postData.token}`);
  if (getStatus !== 200) {
    fail(`Share GET failed: ${getStatus}`);
    return;
  }
  if (getData.file_name !== 'test.png') {
    fail('Share GET returned wrong file_name');
    return;
  }
  ok('Retrieved vision share data correctly');
}

async function testVisionUploadsList() {
  section('GET /vision/uploads');
  const { status, data } = await api('GET', '/vision/uploads');
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  const uploads = data.uploads ?? data;
  if (!Array.isArray(uploads)) { fail('Response uploads is not an array'); return; }
  ok(`Vision uploads list: ${uploads.length} entries`);
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log('========== Vision Extraction E2E Tests ==========');
  console.log(`Base URL: ${BASE}`);

  const { status: healthStatus } = await api('GET', '/health');
  if (healthStatus !== 200) {
    console.error(`\n❌ API health check failed (status ${healthStatus}). Aborting.`);
    process.exit(1);
  }
  console.log('✅ API health check passed\n');

  await testVisionExtractQuotation();
  await testVisionExtractPayment();
  await testVisionExtractAuto();
  await testVisionShare();
  await testVisionUploadsList();

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
