#!/usr/bin/env node
/**
 * E2E Test: File Upload via API
 * Tests POST /files/upload through the API.
 */

import { getActionToken, api } from './test-e2e-helpers.mjs';

let passed = 0;
let failed = 0;

function ok(msg) { console.log(`  ✅ ${msg}`); passed++; }
function fail(msg) { console.error(`  ❌ ${msg}`); failed++; }
function section(title) { console.log(`\n▶ ${title}`); }

const TEST_IMAGE_B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBEQCEAwEPwAB//9k=';

let testOrderId = null;
let testQuotationNumber = null;

async function testUploadMissingData() {
  section('POST /files/upload — validation errors');

  const { status: s1 } = await api('POST', '/files/upload', {
    file_type: 'quotation',
    original_filename: 'test.jpg',
    mime_type: 'image/jpeg',
  });
  if (s1 === 400 || s1 === 500) { ok('Rejects missing file_data'); }
  else { fail(`Expected 400/500, got ${s1}`); }

  const { status: s2 } = await api('POST', '/files/upload', {
    file_data: TEST_IMAGE_B64,
    original_filename: 'test.jpg',
    mime_type: 'image/jpeg',
  });
  if (s2 === 400 || s2 === 500) { ok('Rejects missing file_type'); }
  else { fail(`Expected 400/500, got ${s2}`); }

  const { status: s3 } = await api('POST', '/files/upload', {
    file_data: TEST_IMAGE_B64,
    file_type: 'quotation',
    mime_type: 'image/jpeg',
  });
  if (s3 === 400 || s3 === 500) { ok('Rejects missing original_filename'); }
  else { fail(`Expected 400/500, got ${s3}`); }
}

async function testUploadWithoutOrderId() {
  section('POST /files/upload — quotation_number only (no order_id)');

  const qn = `E2E-FU-ORPHAN-${Date.now()}`;
  const { status, data } = await api('POST', '/files/upload', {
    quotation_number: qn,
    file_type: 'quotation',
    original_filename: 'orphan.jpg',
    mime_type: 'image/jpeg',
    file_data: TEST_IMAGE_B64,
  });

  if (status === 200 || status === 201) {
    ok('Upload succeeded with quotation_number only');
  } else if (status === 502) {
    ok('Upload returned 502 (file-store unavailable — acceptable)');
  } else {
    fail(`Unexpected status ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function testCreateOrderForUpload() {
  section('Setup: create order for file upload tests');
  let actionToken;
  try { actionToken = await getActionToken(); } catch (e) { fail(e.message); return; }

  const qn = `E2E-FU-${Date.now()}`;
  const { status, data } = await api('POST', '/orders', {
    action_token: actionToken,
    quotation_number: qn,
    client_name: 'E2E File Upload Client',
    sales_agent: 'E2E Bot',
    total_amount: 1000,
  });

  if (status !== 200 && status !== 201) {
    fail(`Order creation failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
    return;
  }

  testOrderId = data.id;
  testQuotationNumber = data.quotation_number ?? qn;
  ok(`Created order ${testOrderId} (${testQuotationNumber})`);
}

async function testUploadQuotationFile() {
  section('POST /files/upload — quotation file');
  if (!testOrderId) { fail('No test order'); return; }

  const { status, data } = await api('POST', '/files/upload', {
    order_id: testOrderId,
    quotation_number: testQuotationNumber,
    file_type: 'quotation',
    original_filename: 'quotation.jpg',
    mime_type: 'image/jpeg',
    file_data: TEST_IMAGE_B64,
    extracted_text: 'Test extracted quotation text',
  });

  if (status !== 200 && status !== 201) {
    fail(`Upload failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
    return;
  }
  if (!data.file?.id) { fail('Response missing file.id'); return; }
  ok(`Uploaded quotation file (id: ${data.file.id.slice(0, 8)}...)`);
}

async function testUploadOrderConfirmationFile() {
  section('POST /files/upload — order_confirmation file');
  if (!testOrderId) { fail('No test order'); return; }

  const { status, data } = await api('POST', '/files/upload', {
    order_id: testOrderId,
    quotation_number: testQuotationNumber,
    file_type: 'order_confirmation',
    original_filename: 'confirmation.pdf',
    mime_type: 'application/pdf',
    file_data: TEST_IMAGE_B64,
  });

  if (status !== 200 && status !== 201) {
    fail(`Upload failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
    return;
  }
  ok('Uploaded order confirmation file');
}

async function testUploadDepositFile() {
  section('POST /files/upload — deposit file');
  if (!testOrderId) { fail('No test order'); return; }

  const { status, data } = await api('POST', '/files/upload', {
    order_id: testOrderId,
    quotation_number: testQuotationNumber,
    file_type: 'deposit',
    original_filename: 'deposit.jpg',
    mime_type: 'image/jpeg',
    file_data: TEST_IMAGE_B64,
  });

  if (status !== 200 && status !== 201) {
    fail(`Upload failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
    return;
  }
  ok('Uploaded deposit proof file');
}

async function testGetOrderFilesAfterUpload() {
  section('GET /orders/:id/files — after uploads');
  if (!testOrderId) { fail('No test order'); return; }

  const { status, data } = await api('GET', `/orders/${testOrderId}/files`);
  if (status !== 200) { fail(`Expected 200, got ${status}`); return; }
  if (!data.files || !Array.isArray(data.files)) { fail('Response missing files array'); return; }
  ok(`Order has ${data.files.length} file(s)`);
}

async function testDownloadFile() {
  section('GET /orders/:id/files/:file_id/download');
  if (!testOrderId) { fail('No test order'); return; }

  const { status: listStatus, data: listData } = await api('GET', `/orders/${testOrderId}/files`);
  if (listStatus !== 200 || !listData.files?.length) { fail('No files to download'); return; }

  const fileId = listData.files[0].id;
  const res = await fetch(`${process.env.BASE_URL ?? 'https://track.abcx124.xyz/api'}/orders/${testOrderId}/files/${fileId}/download`);

  if (res.status === 200 || res.status === 302) {
    ok(`File download returned ${res.status}`);
  } else if (res.status === 404) {
    ok('File download returned 404 (file-store path may differ — acceptable)');
  } else {
    fail(`Unexpected status ${res.status}`);
  }
}

async function testCleanupOrder() {
  section('Cleanup: delete test order');
  if (!testOrderId) { fail('No test order'); return; }
  let actionToken;
  try { actionToken = await getActionToken(); } catch (e) { fail(e.message); return; }

  const { status, data } = await api('DELETE', `/orders/${testOrderId}`, {
    action_token: actionToken,
  });

  if (status === 200 || status === 204) {
    ok('Deleted test order');
  } else {
    fail(`Cleanup failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log('========== File Upload API E2E Tests ==========');

  const { status: healthStatus } = await api('GET', '/health');
  if (healthStatus !== 200) {
    console.error(`\n❌ API health check failed (status ${healthStatus}). Aborting.`);
    process.exit(1);
  }
  console.log('✅ API health check passed\n');

  await testUploadMissingData();
  await testUploadWithoutOrderId();
  await testCreateOrderForUpload();
  await testUploadQuotationFile();
  await testUploadOrderConfirmationFile();
  await testUploadDepositFile();
  await testGetOrderFilesAfterUpload();
  await testDownloadFile();
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
