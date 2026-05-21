/**
 * File Store — Hermes Agent Quotation Reference Storage
 *
 * Stores extracted quotation text as .txt files organized by YYYY-MM/QTN-XXXX.txt
 * Auto-deletes files 3 months after order delivery completion.
 * No bulky files (PDFs/images) — only extracted text for Hermes agent analysis.
 */

import Fastify from 'fastify';
import { readFile, writeFile, unlink, readdir, mkdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';

// ── Configuration ──────────────────────────────────────────────────────

const PORT = parseInt(process.env.FILE_STORE_PORT ?? '8090', 10);
const HOST = process.env.FILE_STORE_HOST ?? '0.0.0.0';
const DATA_DIR = process.env.FILE_STORE_DATA_DIR ?? '/data/files';
const RETENTION_DAYS = parseInt(process.env.FILE_STORE_RETENTION_DAYS ?? '90', 10); // 3 months
const CLEANUP_INTERVAL_MS = parseInt(process.env.FILE_STORE_CLEANUP_INTERVAL_MS ?? '3600000', 10); // 1 hour

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Get the file path for a given order's quotation text.
 * Structure: /data/files/YYYY-MM/QTN-XXXX.txt
 */
function getFilePath(quotationNumber) {
  const now = new Date();
  const monthDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return join(DATA_DIR, monthDir, `${quotationNumber}.txt`);
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
async function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

// ── Fastify App ────────────────────────────────────────────────────────

const app = Fastify({ logger: true });

// Health check
app.get('/health', async () => ({ ok: true, uptime: process.uptime() }));

/**
 * POST /files/store
 * Store extracted quotation text for an order.
 * Body: { order_id, quotation_number, extracted_text, file_type }
 * The text is stored as a .txt file organized by month.
 */
app.post('/files/store', async (request, reply) => {
  const body = request.body || {};
  const orderId = String(body.order_id ?? '');
  const quotationNumber = String(body.quotation_number ?? '');
  const extractedText = String(body.extracted_text ?? '');
  const fileType = String(body.file_type ?? 'quotation');

  if (!orderId || !quotationNumber || !extractedText) {
    return reply.code(400).send({ error: 'order_id, quotation_number, and extracted_text are required' });
  }

  // Only store quotation files — deposit slips are NOT stored
  if (fileType !== 'quotation') {
    return reply.send({ ok: true, skipped: true, reason: `file_type '${fileType}' is not stored (only quotations)` });
  }

  const filePath = getFilePath(quotationNumber);
  await ensureDir(filePath);

  // Store the extracted text with metadata header
  const content = [
    `---`,
    `order_id: ${orderId}`,
    `quotation_number: ${quotationNumber}`,
    `file_type: ${fileType}`,
    `stored_at: ${new Date().toISOString()}`,
    `---`,
    '',
    extractedText,
  ].join('\n');

  await writeFile(filePath, content, 'utf-8');

  app.log.info(`Stored quotation text for ${quotationNumber} at ${filePath}`);

  return reply.send({
    ok: true,
    path: filePath,
    size_bytes: Buffer.byteLength(content, 'utf-8'),
  });
});

/**
 * GET /files/:quotation_number
 * Retrieve the stored quotation text for a given quotation number.
 * Returns the extracted text content (without metadata header).
 */
app.get('/files/:quotation_number', async (request, reply) => {
  const params = request.params || {};
  const quotationNumber = params.quotation_number;

  if (!quotationNumber) {
    return reply.code(400).send({ error: 'quotation_number is required' });
  }

  // Search across all month directories
  const dirs = await readdir(DATA_DIR).catch(() => []);
  for (const dir of dirs) {
    const filePath = join(DATA_DIR, dir, `${quotationNumber}.txt`);
    try {
      const content = await readFile(filePath, 'utf-8');
      // Strip metadata header (between --- markers)
      const text = content.replace(/^---[\s\S]*?---\n*/, '').trim();
      return reply.send({ ok: true, quotation_number: quotationNumber, text });
    } catch {
      continue; // Not found in this directory
    }
  }

  return reply.code(404).send({ error: 'File not found', quotation_number: quotationNumber });
});

/**
 * DELETE /files/:quotation_number
 * Manually delete a stored quotation text file.
 */
app.delete('/files/:quotation_number', async (request, reply) => {
  const params = request.params || {};
  const quotationNumber = params.quotation_number;

  if (!quotationNumber) {
    return reply.code(400).send({ error: 'quotation_number is required' });
  }

  const dirs = await readdir(DATA_DIR).catch(() => []);
  for (const dir of dirs) {
    const filePath = join(DATA_DIR, dir, `${quotationNumber}.txt`);
    try {
      await unlink(filePath);
      app.log.info(`Deleted quotation text for ${quotationNumber}`);
      return reply.send({ ok: true, deleted: true, quotation_number: quotationNumber });
    } catch {
      continue;
    }
  }

  return reply.code(404).send({ error: 'File not found', quotation_number: quotationNumber });
});

/**
 * GET /files/list
 * List all stored quotation files with metadata.
 */
app.get('/files/list', async (request, reply) => {
  const dirs = await readdir(DATA_DIR).catch(() => []);
  const files = [];

  for (const dir of dirs) {
    const dirPath = join(DATA_DIR, dir);
    try {
      const entries = await readdir(dirPath);
      for (const entry of entries) {
        if (!entry.endsWith('.txt')) continue;
        const filePath = join(dirPath, entry);
        const stats = await stat(filePath);
        files.push({
          quotation_number: entry.replace('.txt', ''),
          path: filePath,
          size_bytes: stats.size,
          stored_at: stats.mtime.toISOString(),
        });
      }
    } catch {
      continue;
    }
  }

  // Sort by stored_at descending (newest first)
  files.sort((a, b) => b.stored_at.localeCompare(a.stored_at));

  return reply.send({ ok: true, count: files.length, files });
});

// ── Cleanup Agent ──────────────────────────────────────────────────────

/**
 * Delete quotation text files that are older than RETENTION_DAYS.
 * This is a simple time-based cleanup based on file modification time.
 */
async function runCleanup() {
  const now = Date.now();
  const maxAgeMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;

  const dirs = await readdir(DATA_DIR).catch(() => []);
  for (const dir of dirs) {
    const dirPath = join(DATA_DIR, dir);
    try {
      const entries = await readdir(dirPath);
      for (const entry of entries) {
        if (!entry.endsWith('.txt')) continue;
        const filePath = join(dirPath, entry);
        try {
          const stats = await stat(filePath);
          if (now - stats.mtimeMs > maxAgeMs) {
            await unlink(filePath);
            app.log.info(`[cleanup] Deleted expired file: ${filePath}`);
            deleted++;
          }
        } catch {
          continue;
        }
      }
      // Remove empty directories
      const remaining = await readdir(dirPath).catch(() => []);
      if (remaining.length === 0) {
        await unlink(dirPath).catch(() => {});
      }
    } catch {
      continue;
    }
  }

  return deleted;
}

// Run cleanup periodically
setInterval(async () => {
  try {
    const deleted = await runCleanup();
    if (deleted > 0) {
      app.log.info(`[cleanup] Deleted ${deleted} expired file(s)`);
    }
  } catch (err) {
    app.log.error(`[cleanup] Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}, CLEANUP_INTERVAL_MS);

// ── Start ──────────────────────────────────────────────────────────────

async function start() {
  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
    app.log.info(`Created data directory: ${DATA_DIR}`);
  }

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`File Store listening on ${HOST}:${PORT}`);
  app.log.info(`Data directory: ${DATA_DIR}`);
  app.log.info(`Retention: ${RETENTION_DAYS} days`);
  app.log.info(`Cleanup interval: ${CLEANUP_INTERVAL_MS}ms`);
}

start().catch((err) => {
  console.error('Failed to start file-store:', err);
  process.exit(1);
});
