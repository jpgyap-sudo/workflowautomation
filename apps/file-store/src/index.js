/**
 * File Store — Hermes Agent Quotation Reference Storage + Binary File Storage
 *
 * Stores extracted quotation text as .txt files organized by YYYY-MM/QTN-XXXX.txt
 * Also stores binary files (images, PDFs) for dashboard viewing.
 * Auto-deletes files 3 months after order delivery completion.
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
 * Get the binary file path for a given order's uploaded file.
 * Structure: /data/files/binaries/YYYY-MM/QTN-XXXX_{timestamp}.{ext}
 * Includes a timestamp suffix to prevent overwriting previous uploads.
 */
function getBinaryFilePath(quotationNumber, mimeType, originalFilename) {
  const now = new Date();
  const monthDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  // Determine extension from mime type or original filename
  let ext = 'bin';
  if (mimeType) {
    if (mimeType.includes('pdf')) ext = 'pdf';
    else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
    else if (mimeType.includes('png')) ext = 'png';
    else if (mimeType.includes('gif')) ext = 'gif';
    else if (mimeType.includes('webp')) ext = 'webp';
  }
  if (originalFilename && originalFilename.includes('.')) {
    const parts = originalFilename.split('.');
    ext = parts[parts.length - 1];
  }
  const ts = Date.now();
  return join(DATA_DIR, 'binaries', monthDir, `${quotationNumber}_${ts}.${ext}`);
}

/**
 * Search for any binary file matching a quotation number across all month dirs.
 * Returns the most recently modified file if multiple exist.
 */
async function findBinaryFile(quotationNumber) {
  const binaryDir = join(DATA_DIR, 'binaries');
  if (!existsSync(binaryDir)) return null;
  const dirs = await readdir(binaryDir).catch(() => []);
  let bestMatch = null;
  let bestMtime = 0;
  for (const dir of dirs) {
    const dirPath = join(binaryDir, dir);
    try {
      const entries = await readdir(dirPath);
      for (const entry of entries) {
        if (entry.startsWith(`${quotationNumber}_`)) {
          const filePath = join(dirPath, entry);
          try {
            const stats = await stat(filePath);
            if (stats.mtimeMs > bestMtime) {
              bestMtime = stats.mtimeMs;
              bestMatch = filePath;
            }
          } catch { continue; }
        }
      }
    } catch { continue; }
  }
  return bestMatch;
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
    if (dir === 'binaries') continue;
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

/**
 * POST /files/store-binary
 * Store a binary file (image, PDF) for an order.
 * Body: { order_id, quotation_number, file_data (base64), mime_type, original_filename }
 */
app.post('/files/store-binary', async (request, reply) => {
  const body = request.body || {};
  const orderId = String(body.order_id ?? '');
  const quotationNumber = String(body.quotation_number ?? '');
  const fileData = String(body.file_data ?? '');
  const mimeType = String(body.mime_type ?? '');
  const originalFilename = String(body.original_filename ?? '');

  if ((!orderId && !quotationNumber) || !fileData) {
    return reply.code(400).send({ error: 'file_data and at least one of order_id or quotation_number are required' });
  }

  // Use quotation_number if available, fall back to order_id as the file key
  const fileKey = quotationNumber || orderId;
  const filePath = getBinaryFilePath(fileKey, mimeType, originalFilename);
  await ensureDir(filePath);

  const buffer = Buffer.from(fileData, 'base64');
  await writeFile(filePath, buffer);

  app.log.info(`Stored binary file for ${fileKey} at ${filePath} (${buffer.length} bytes)`);

  return reply.send({
    ok: true,
    path: filePath,
    size_bytes: buffer.length,
    mime_type: mimeType,
  });
});

/**
 * GET /files/binary/:quotation_number
 * Retrieve a stored binary file for a given quotation number.
 */
app.get('/files/binary/:quotation_number', async (request, reply) => {
  const params = request.params || {};
  const quotationNumber = params.quotation_number;

  if (!quotationNumber) {
    return reply.code(400).send({ error: 'quotation_number is required' });
  }

  const filePath = await findBinaryFile(quotationNumber);
  if (!filePath) {
    return reply.code(404).send({ error: 'File not found', quotation_number: quotationNumber });
  }

  // Determine mime type from extension
  let mimeType = 'application/octet-stream';
  if (filePath.endsWith('.pdf')) mimeType = 'application/pdf';
  else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) mimeType = 'image/jpeg';
  else if (filePath.endsWith('.png')) mimeType = 'image/png';
  else if (filePath.endsWith('.gif')) mimeType = 'image/gif';
  else if (filePath.endsWith('.webp')) mimeType = 'image/webp';

  const buffer = await readFile(filePath);
  reply.header('Content-Type', mimeType);
  reply.header('Content-Length', buffer.length);
  reply.header('Cache-Control', 'public, max-age=3600');
  return reply.send(buffer);
});

/**
 * GET /files/binary-by-path
 * Retrieve a stored binary file by its exact filesystem path.
 * Used by the API download endpoint for per-file retrieval when local_file_path is known.
 * Query param: path (absolute path on this server)
 */
app.get('/files/binary-by-path', async (request, reply) => {
  const query = request.query || {};
  const filePath = query.path;

  if (!filePath) {
    return reply.code(400).send({ error: 'path query parameter is required' });
  }

  // Security: only allow paths inside DATA_DIR
  const resolvedPath = filePath;
  if (!resolvedPath.startsWith(DATA_DIR)) {
    return reply.code(403).send({ error: 'Access denied' });
  }

  try {
    const buffer = await readFile(resolvedPath);

    let mimeType = 'application/octet-stream';
    if (resolvedPath.endsWith('.pdf')) mimeType = 'application/pdf';
    else if (resolvedPath.endsWith('.jpg') || resolvedPath.endsWith('.jpeg')) mimeType = 'image/jpeg';
    else if (resolvedPath.endsWith('.png')) mimeType = 'image/png';
    else if (resolvedPath.endsWith('.gif')) mimeType = 'image/gif';
    else if (resolvedPath.endsWith('.webp')) mimeType = 'image/webp';

    reply.header('Content-Type', mimeType);
    reply.header('Content-Length', buffer.length);
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.send(buffer);
  } catch (err) {
    return reply.code(404).send({ error: 'File not found at path' });
  }
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

  // Cleanup text files
  const dirs = await readdir(DATA_DIR).catch(() => []);
  for (const dir of dirs) {
    if (dir === 'binaries') continue;
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

  // Cleanup binary files
  const binaryDir = join(DATA_DIR, 'binaries');
  if (existsSync(binaryDir)) {
    const binaryMonthDirs = await readdir(binaryDir).catch(() => []);
    for (const dir of binaryMonthDirs) {
      const dirPath = join(binaryDir, dir);
      try {
        const entries = await readdir(dirPath);
        for (const entry of entries) {
          const filePath = join(dirPath, entry);
          try {
            const stats = await stat(filePath);
            if (now - stats.mtimeMs > maxAgeMs) {
              await unlink(filePath);
              app.log.info(`[cleanup] Deleted expired binary: ${filePath}`);
              deleted++;
            }
          } catch {
            continue;
          }
        }
        const remaining = await readdir(dirPath).catch(() => []);
        if (remaining.length === 0) {
          await unlink(dirPath).catch(() => {});
        }
      } catch {
        continue;
      }
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
