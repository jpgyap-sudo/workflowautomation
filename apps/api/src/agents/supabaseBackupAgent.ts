import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdtempSync, readdirSync, statSync, existsSync, rmdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { logAgentAction, sendTelegramMessage } from '../services/agentRunner.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface SupabaseBackupResult {
  status: 'ok' | 'error';
  message: string;
  backup_file?: string;
  file_size_bytes?: number;
  bucket?: string;
  retention_days?: number;
  deleted_old_backups?: number;
}

// ── Configuration ──────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SUPABASE_BACKUP_BUCKET = process.env.SUPABASE_BACKUP_BUCKET ?? 'db-backups';
const BACKUP_RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
const CONTAINER = process.env.CONTAINER ?? 'qas_postgres';
const DB_USER = process.env.POSTGRES_USER ?? 'n8n';
const DB_NAME = process.env.POSTGRES_DB ?? 'quotation_automation';

// Telegram notification chat ID (optional — set env var to enable alerts)
const BACKUP_ALERT_CHAT_ID = process.env.BACKUP_ALERT_CHAT_ID ?? '';

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
  // Check if bucket exists
  const check = await supabaseRequest(
    'GET',
    `/storage/v1/buckets/${SUPABASE_BACKUP_BUCKET}`,
  );

  if (check.status === 200) {
    return true;
  }

  if (check.status === 404) {
    // Create the bucket
    const create = await supabaseRequest(
      'POST',
      '/storage/v1/buckets',
      JSON.stringify({ name: SUPABASE_BACKUP_BUCKET, public: false }),
    );
    return create.status === 200;
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
        'Content-Type': 'application/gzip',
      },
      body: fileBuffer,
    });

    return res.ok;
  } catch {
    return false;
  }
}

// ── Helper: Cleanup Old Backups ────────────────────────────────────────

async function cleanupOldBackups(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - BACKUP_RETENTION_DAYS);

  // List all objects in the bucket
  const list = await supabaseRequest(
    'POST',
    `/storage/v1/object/list/${SUPABASE_BACKUP_BUCKET}`,
    JSON.stringify({ prefix: '' }),
  );

  if (list.status !== 200 || !Array.isArray(list.data)) {
    return 0;
  }

  let deleted = 0;
  for (const obj of list.data) {
    if (!obj.name || !obj.created_at) continue;

    const created = new Date(obj.created_at);
    if (created < cutoff) {
      const del = await supabaseRequest(
        'DELETE',
        `/storage/v1/object/${SUPABASE_BACKUP_BUCKET}/${obj.name}`,
      );
      if (del.status === 200) {
        deleted++;
      }
    }
  }

  return deleted;
}

// ── Main Backup Function ───────────────────────────────────────────────

export async function runSupabaseBackup(): Promise<SupabaseBackupResult[]> {
  const result: SupabaseBackupResult = {
    status: 'ok',
    message: '',
  };

  // ── Validation ─────────────────────────────────────────────────────
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    result.status = 'error';
    result.message = 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment';
    await logAgentAction('supabase-backup', {}, result, 'error', undefined, result.message);
    return [result];
  }

  // ── Step 1: Dump database (pipe directly to gzip) ──────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupFilename = `db_${stamp}.sql.gz`;
  const tempDir = mkdtempSync(join(tmpdir(), 'supabase-backup-'));
  const tempBackupPath = join(tempDir, backupFilename);

  try {
    console.log(`[SupabaseBackupAgent] Dumping database ${DB_NAME} from container ${CONTAINER}...`);

    // Pipe pg_dump directly through gzip — single step, no intermediate uncompressed file
    exec(
      `docker exec "${CONTAINER}" pg_dump -U "${DB_USER}" "${DB_NAME}" | gzip > "${tempBackupPath}"`,
    );

    // Verify the gzipped file was created and has content
    if (!existsSync(tempBackupPath)) {
      throw new Error('Backup file was not created');
    }

    const fileSize = statSync(tempBackupPath).size;
    if (fileSize === 0) {
      throw new Error('Backup file is empty');
    }

    console.log(`[SupabaseBackupAgent] Backup size: ${fileSize} bytes`);

    // ── Step 2: Ensure bucket exists ─────────────────────────────────
    console.log(`[SupabaseBackupAgent] Ensuring bucket ${SUPABASE_BACKUP_BUCKET} exists...`);
    const bucketReady = await ensureBucket();
    if (!bucketReady) {
      throw new Error(`Failed to create or verify bucket ${SUPABASE_BACKUP_BUCKET}`);
    }

    // ── Step 3: Upload backup ────────────────────────────────────────
    console.log(`[SupabaseBackupAgent] Uploading ${backupFilename}...`);
    const uploaded = await uploadBackup(tempBackupPath, backupFilename);
    if (!uploaded) {
      throw new Error(`Failed to upload backup ${backupFilename}`);
    }

    console.log(`[SupabaseBackupAgent] Upload successful: ${backupFilename}`);

    // ── Step 4: Cleanup old backups ──────────────────────────────────
    console.log(`[SupabaseBackupAgent] Cleaning backups older than ${BACKUP_RETENTION_DAYS} days...`);
    const deletedCount = await cleanupOldBackups();

    // ── Success ──────────────────────────────────────────────────────
    result.status = 'ok';
    result.message = `Backup uploaded successfully to ${SUPABASE_BACKUP_BUCKET}/${backupFilename}`;
    result.backup_file = backupFilename;
    result.file_size_bytes = fileSize;
    result.bucket = SUPABASE_BACKUP_BUCKET;
    result.retention_days = BACKUP_RETENTION_DAYS;
    result.deleted_old_backups = deletedCount;

    await logAgentAction('supabase-backup', { db: DB_NAME, container: CONTAINER }, result, 'ok');

  } catch (err) {
    result.status = 'error';
    result.message = `Backup failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[SupabaseBackupAgent] ${result.message}`);

    await logAgentAction('supabase-backup', { db: DB_NAME, container: CONTAINER }, result, 'error', undefined, result.message);

    // Send Telegram alert if configured
    if (BACKUP_ALERT_CHAT_ID) {
      await sendTelegramMessage(
        BACKUP_ALERT_CHAT_ID,
        `🚨 *Supabase Backup Failed*\n\n${result.message}`,
      );
    }
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

  return [result];
}
