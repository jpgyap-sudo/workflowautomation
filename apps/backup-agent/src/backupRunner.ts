/**
 * Backup Runner — runs in a separate container, independent of the API.
 *
 * This container:
 * 1. Has Docker CLI access (to run `docker exec pg_dump` on the postgres container)
 * 2. Runs pg_dump → gzip → upload to Supabase Storage on a configurable schedule
 * 3. Sends Telegram alerts on failure (if BACKUP_ALERT_CHAT_ID is set)
 * 4. Is completely independent of the API container — survives quarantine/restarts
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdtempSync, readdirSync, statSync, existsSync, rmdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── Configuration ──────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SUPABASE_BACKUP_BUCKET = process.env.SUPABASE_BACKUP_BUCKET ?? 'db-backups';
const CONTAINER_HINT = process.env.CONTAINER ?? 'postgres';
const DB_USER = process.env.POSTGRES_USER ?? 'n8n';
const DB_NAME = process.env.POSTGRES_DB ?? 'quotation_automation';
const BACKUP_INTERVAL_MS = parseInt(process.env.BACKUP_INTERVAL_MS ?? '21600000', 10); // default: 6 hours
const BACKUP_ALERT_CHAT_ID = process.env.BACKUP_ALERT_CHAT_ID ?? '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';

// ── Helper: Execute Command ────────────────────────────────────────────

function exec(cmd: string): { stdout: string; stderr: string } {
  try {
    const stdout = execSync(cmd, { timeout: 120_000, encoding: 'utf-8' });
    return { stdout: stdout.trim(), stderr: '' };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString().trim() ?? '',
      stderr: err.stderr?.toString().trim() ?? err.message ?? String(err),
    };
  }
}

// ── Helper: Auto-detect Postgres Container ─────────────────────────────

function findPostgresContainer(): string {
  // List all running containers and find the one running postgres image
  const psResult = exec(
    `docker ps --format '{{.Names}}|{{.Image}}' 2>/dev/null || true`,
  );
  if (psResult.stdout) {
    const lines = psResult.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    // Match any container whose image name contains 'postgres'
    const pg = lines.find((line) => {
      const [, image] = line.split('|');
      return image && image.toLowerCase().includes('postgres');
    });
    if (pg) {
      const [name] = pg.split('|');
      return name;
    }
  }

  // Last resort: use the hint from env
  return CONTAINER_HINT;
}

// ── Helper: HTTP Request ───────────────────────────────────────────────

async function supabaseRequest(
  method: string,
  path: string,
  body?: string,
): Promise<{ status: number; data: any }> {
  try {
    const url = `${SUPABASE_URL}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ?? undefined,
    });

    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return { status: res.status, data };
  } catch (err) {
    return { status: 0, data: { error: String(err) } };
  }
}

// ── Helper: Ensure Bucket Exists ───────────────────────────────────────

async function ensureBucket(): Promise<boolean> {
  // NOTE: Supabase Storage API uses singular /bucket (not /buckets)
  const check = await supabaseRequest(
    'GET',
    `/storage/v1/bucket/${SUPABASE_BACKUP_BUCKET}`,
  );

  if (check.status === 200) {
    return true;
  }

  if (check.status === 404) {
    const create = await supabaseRequest(
      'POST',
      '/storage/v1/bucket',
      JSON.stringify({ name: SUPABASE_BACKUP_BUCKET, public: false }),
    );
    return create.status === 200 || create.status === 409;
  }

  return false;
}

// ── Helper: Upload File ────────────────────────────────────────────────

async function uploadBackup(filePath: string, filename: string): Promise<boolean> {
  const fileBuffer = readFileSync(filePath);

  try {
    const url = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BACKUP_BUCKET}/${filename}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/gzip',
      },
      body: fileBuffer,
    });

    return res.ok;
  } catch {
    return false;
  }
}

// ── Helper: Send Telegram Alert ────────────────────────────────────────

async function sendTelegramAlert(message: string): Promise<void> {
  if (!BACKUP_ALERT_CHAT_ID || !TELEGRAM_BOT_TOKEN) return;

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: BACKUP_ALERT_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
      }),
    });
  } catch (err) {
    console.error('[BackupRunner] Failed to send Telegram alert:', err);
  }
}

// ── Main Backup Function ───────────────────────────────────────────────

async function runBackup(): Promise<{ ok: boolean; message: string }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupFilename = `db_${stamp}.sql.gz`;
  const tempDir = mkdtempSync(join(tmpdir(), 'supabase-backup-'));
  const tempBackupPath = join(tempDir, backupFilename);

  // Auto-detect postgres container on each run (handles container recreation/rename)
  const container = findPostgresContainer();
  console.log(`[BackupRunner] Resolved postgres container: ${container}`);

  try {
    console.log(`[BackupRunner] Dumping database ${DB_NAME} from container ${container}...`);

    // Pipe pg_dump directly through gzip
    exec(
      `docker exec "${container}" pg_dump -U "${DB_USER}" "${DB_NAME}" | gzip > "${tempBackupPath}"`,
    );

    if (!existsSync(tempBackupPath)) {
      throw new Error('Backup file was not created');
    }

    const fileSize = statSync(tempBackupPath).size;
    if (fileSize === 0) {
      throw new Error('Backup file is empty');
    }

    console.log(`[BackupRunner] Backup size: ${fileSize} bytes`);

    // Ensure bucket exists
    console.log(`[BackupRunner] Ensuring bucket ${SUPABASE_BACKUP_BUCKET} exists...`);
    const bucketReady = await ensureBucket();
    if (!bucketReady) {
      throw new Error(`Failed to create or verify bucket ${SUPABASE_BACKUP_BUCKET}`);
    }

    // Upload backup
    console.log(`[BackupRunner] Uploading ${backupFilename}...`);
    const uploaded = await uploadBackup(tempBackupPath, backupFilename);
    if (!uploaded) {
      throw new Error(`Failed to upload backup ${backupFilename}`);
    }

    console.log(`[BackupRunner] Upload successful: ${backupFilename}`);
    return { ok: true, message: `Backup uploaded: ${backupFilename} (${fileSize} bytes)` };

  } catch (err) {
    const msg = `Backup failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[BackupRunner] ${msg}`);
    return { ok: false, message: msg };

  } finally {
    // Cleanup temp files
    try {
      const files = readdirSync(tempDir);
      for (const file of files) {
        try { unlinkSync(join(tempDir, file)); } catch { /* ignore */ }
      }
      try { rmdirSync(tempDir); } catch { /* ignore */ }
    } catch { /* ignore */ }
  }
}

// ── Scheduler ──────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  console.log(`[BackupRunner] Running backup at ${new Date().toISOString()}...`);
  const result = await runBackup();

  if (result.ok) {
    console.log(`[BackupRunner] ✓ ${result.message}`);
  } else {
    console.error(`[BackupRunner] ✗ ${result.message}`);
    await sendTelegramAlert(`🚨 *Supabase Backup Failed*\n\n${result.message}`);
  }
}

// ── Startup ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════');
  console.log('  Supabase Backup Runner (separate container)');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Container:    ${CONTAINER_HINT} (auto-detected at runtime)`);
  console.log(`  Database:     ${DB_NAME}`);
  console.log(`  Bucket:       ${SUPABASE_BACKUP_BUCKET}`);
  console.log(`  Interval:     ${BACKUP_INTERVAL_MS}ms (${BACKUP_INTERVAL_MS / 60000} min)`);
  console.log(`  Supabase URL: ${SUPABASE_URL ? '✓ configured' : '✗ MISSING'}`);
  console.log(`  Service Key:  ${SUPABASE_SERVICE_ROLE_KEY ? '✓ configured' : '✗ MISSING'}`);
  console.log('═══════════════════════════════════════════════\n');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[BackupRunner] FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    process.exit(1);
  }

  // Run immediately on startup
  await tick();

  // Then run on schedule
  console.log(`[BackupRunner] Next backup in ${BACKUP_INTERVAL_MS / 60000} minutes`);
  setInterval(tick, BACKUP_INTERVAL_MS);
}

main().catch((err) => {
  console.error('[BackupRunner] Fatal error:', err);
  process.exit(1);
});
