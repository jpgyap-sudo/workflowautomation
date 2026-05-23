#!/usr/bin/env node
/**
 * E2E Test: File Upload Flow
 * Tests the file-store binary storage + API upload logic end-to-end.
 * Since DB/Redis aren't available, we test the file-store service directly
 * and verify the API code paths via a lightweight simulation.
 */

import { spawn } from 'child_process';
import { mkdir, rm, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const TEST_DATA_DIR = join(PROJECT_ROOT, '.test-data');
const TEST_PORT = 18090;

let fileStoreProcess = null;
let passed = 0;
let failed = 0;

function log(msg) { console.log(`[TEST] ${msg}`); }
function ok(msg) { console.log(`\x1b[32m[PASS]\x1b[0m ${msg}`); passed++; }
function fail(msg) { console.error(`\x1b[31m[FAIL]\x1b[0m ${msg}`); failed++; }

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function startFileStore() {
  log('Starting file-store service on test port...');
  await rm(TEST_DATA_DIR, { recursive: true, force: true });
  await mkdir(TEST_DATA_DIR, { recursive: true });

  const env = {
    ...process.env,
    FILE_STORE_PORT: String(TEST_PORT),
    FILE_STORE_HOST: '127.0.0.1',
    FILE_STORE_DATA_DIR: TEST_DATA_DIR,
  };

  fileStoreProcess = spawn('node', ['apps/file-store/src/index.js'], {
    cwd: PROJECT_ROOT,
    env,
    stdio: 'pipe',
  });

  fileStoreProcess.stdout.on('data', d => {});
  fileStoreProcess.stderr.on('data', d => {});

  // Wait for health check
  for (let i = 0; i < 30; i++) {
    await delay(200);
    try {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
      if (res.ok) {
        log('File-store is ready');
        return;
      }
    } catch { /* retry */ }
  }
  throw new Error('File-store failed to start');
}

async function stopFileStore() {
  if (fileStoreProcess) {
    fileStoreProcess.kill('SIGTERM');
    await delay(500);
    fileStoreProcess = null;
  }
  await rm(TEST_DATA_DIR, { recursive: true, force: true });
}

async function testStoreBinary() {
  log('--- Test: store-binary endpoint ---');
  const base64 = Buffer.from('Hello, this is a test file!').toString('base64');

  const res = await fetch(`http://127.0.0.1:${TEST_PORT}/files/store-binary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_id: 'test-order-123',
      quotation_number: 'QTN-2026-001',
      file_data: base64,
      mime_type: 'image/jpeg',
      original_filename: 'test.jpg',
    }),
  });

  if (!res.ok) {
    fail(`store-binary returned ${res.status}: ${await res.text()}`);
    return;
  }
  const data = await res.json();
  if (!data.ok || !data.path) {
    fail('store-binary did not return ok + path');
    return;
  }

  // Verify filename includes timestamp
  if (!data.path.includes('QTN-2026-001_')) {
    fail(`Filename missing timestamp prefix: ${data.path}`);
    return;
  }
  if (!data.path.endsWith('.jpg')) {
    fail(`Filename has wrong extension: ${data.path}`);
    return;
  }

  // Verify file exists on disk
  if (!existsSync(data.path)) {
    fail(`File not found on disk: ${data.path}`);
    return;
  }

  const content = await readFile(data.path);
  if (content.toString() !== 'Hello, this is a test file!') {
    fail('File content mismatch');
    return;
  }

  ok('store-binary stores file with unique timestamped name');

  // Test 2: store another file for same order — should NOT overwrite
  const base64_2 = Buffer.from('Second upload content').toString('base64');
  const res2 = await fetch(`http://127.0.0.1:${TEST_PORT}/files/store-binary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_id: 'test-order-123',
      quotation_number: 'QTN-2026-001',
      file_data: base64_2,
      mime_type: 'image/png',
      original_filename: 'test2.png',
    }),
  });

  const data2 = await res2.json();
  if (!data2.ok || !data2.path) {
    fail('Second store-binary failed');
    return;
  }

  // Both files should exist
  if (!existsSync(data.path)) {
    fail('First file was overwritten!');
    return;
  }
  if (!existsSync(data2.path)) {
    fail('Second file not found!');
    return;
  }

  const content2 = await readFile(data2.path);
  if (content2.toString() !== 'Second upload content') {
    fail('Second file content mismatch');
    return;
  }

  ok('Multiple uploads for same order do not overwrite each other');
}

async function testRetrieveBinary() {
  log('--- Test: retrieve-binary endpoint ---');

  // Store a file first
  const base64 = Buffer.from('Retrieve me!').toString('base64');
  await fetch(`http://127.0.0.1:${TEST_PORT}/files/store-binary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_id: 'test-order-456',
      quotation_number: 'QTN-2026-002',
      file_data: base64,
      mime_type: 'application/pdf',
      original_filename: 'doc.pdf',
    }),
  });

  const res = await fetch(`http://127.0.0.1:${TEST_PORT}/files/binary/QTN-2026-002`);
  if (!res.ok) {
    fail(`retrieve-binary returned ${res.status}`);
    return;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.toString() !== 'Retrieve me!') {
    fail('Retrieved content mismatch');
    return;
  }
  const ct = res.headers.get('content-type');
  if (ct !== 'application/pdf') {
    fail(`Wrong content-type: ${ct}`);
    return;
  }

  ok('retrieve-binary returns correct file with correct mime type');

  // Test 404 for non-existent
  const res404 = await fetch(`http://127.0.0.1:${TEST_PORT}/files/binary/NON-EXISTENT`);
  if (res404.status !== 404) {
    fail(`Expected 404 for missing file, got ${res404.status}`);
    return;
  }
  ok('retrieve-binary returns 404 for non-existent order');
}

async function testMultipleFilesSameOrder() {
  log('--- Test: multiple files same order, retrieve returns most recent ---');

  const qn = 'QTN-2026-003';

  // Upload 3 files with slight delays
  for (let i = 0; i < 3; i++) {
    const content = `File version ${i}`;
    await fetch(`http://127.0.0.1:${TEST_PORT}/files/store-binary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: 'test-order-789',
        quotation_number: qn,
        file_data: Buffer.from(content).toString('base64'),
        mime_type: 'image/jpeg',
        original_filename: `v${i}.jpg`,
      }),
    });
    await delay(50);
  }

  // Retrieve should return the MOST RECENT file
  const res = await fetch(`http://127.0.0.1:${TEST_PORT}/files/binary/${qn}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.toString() !== 'File version 2') {
    fail(`Expected most recent file, got: ${buffer.toString()}`);
    return;
  }

  ok('retrieve-binary returns most recent file when multiple exist');
}

async function testApiOrderDetailQuery() {
  log('--- Test: API order detail query includes files + stage_updates ---');

  // We can't run the API without Postgres, so we verify the SQL by parsing the source file
  const serverTs = await readFile(join(PROJECT_ROOT, 'apps/api/src/server.ts'), 'utf-8');

  if (!serverTs.includes('FROM files WHERE order_id = $1 ORDER BY created_at DESC')) {
    fail('Order detail endpoint missing files query');
    return;
  }
  if (!serverTs.includes('FROM stage_updates WHERE order_id = $1 ORDER BY created_at DESC')) {
    fail('Order detail endpoint missing stage_updates query');
    return;
  }
  if (!serverTs.includes("files: files ?? []")) {
    fail('Order detail response missing files field');
    return;
  }
  if (!serverTs.includes("stage_updates: stageUpdates ?? []")) {
    fail('Order detail response missing stage_updates field');
    return;
  }

  ok('API order detail query fetches files and stage_updates');
}

async function testApiUploadCacheInvalidation() {
  log('--- Test: API /files/upload invalidates cache ---');

  const serverTs = await readFile(join(PROJECT_ROOT, 'apps/api/src/server.ts'), 'utf-8');

  const uploadSection = serverTs.slice(
    serverTs.indexOf("POST /files/upload"),
    serverTs.indexOf("return reply.send({", serverTs.indexOf("POST /files/upload")) + 200
  );

  if (!uploadSection.includes('invalidateCache')) {
    fail('/files/upload endpoint missing cache invalidation');
    return;
  }
  if (!uploadSection.includes("broadcastSSE('order_updated'")) {
    fail('/files/upload endpoint missing SSE broadcast');
    return;
  }

  ok('API /files/upload invalidates cache and broadcasts SSE');
}

async function testBotUploadBypass() {
  log('--- Test: Telegram bot bypasses vision for awaiting_file_upload ---');

  const botTs = await readFile(join(PROJECT_ROOT, 'apps/telegram-bot/src/bot.ts'), 'utf-8');

  if (!botTs.includes("session.step.action === 'awaiting_file_upload'")) {
    fail('Bot missing awaiting_file_upload bypass check');
    return;
  }
  if (!botTs.includes('uploadFileAndRecord({') || !botTs.includes("awaiting_file_upload'")) {
    fail('Bot does not call uploadFileAndRecord in awaiting_file_upload path');
    return;
  }

  // Verify the bypass happens BEFORE the vision workflow
  const docHandlerIdx = botTs.indexOf("bot.on(['document', 'photo']");
  const bypassIdx = botTs.indexOf("session.step.action === 'awaiting_file_upload'", docHandlerIdx);
  const visionIdx = botTs.indexOf("awaiting_vision_document_type", docHandlerIdx);

  if (bypassIdx === -1 || visionIdx === -1) {
    fail('Could not locate handler positions');
    return;
  }
  if (bypassIdx > visionIdx) {
    fail('Vision workflow comes before awaiting_file_upload bypass');
    return;
  }

  ok('Bot bypasses vision workflow when in awaiting_file_upload step');
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log('\n========== File Upload E2E Tests ==========\n');

  try {
    await startFileStore();

    await testStoreBinary();
    await testRetrieveBinary();
    await testMultipleFilesSameOrder();
    await testApiOrderDetailQuery();
    await testApiUploadCacheInvalidation();
    await testBotUploadBypass();

  } catch (err) {
    console.error('\n[ERROR]', err.message);
    failed++;
  } finally {
    await stopFileStore();
  }

  console.log('\n==========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('==========================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

main();
