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
}

// ── Configuration ──────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SUPABASE_BACKUP_BUCKET = process.env.SUPABASE_BACKUP_BUCKET ?? 'db-backups';
const CONTAINER_HINT = process.env.CONTAINER ?? 'postgres';
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

// ── Helper: HTTP Request (uses curl instead of fetch to work around
//     Node.js 20 HTTP client mangling JWT in Alpine containers) ─────────

function supabaseRequest(
  method: string,
  path: string,
  body?: string,
): { status: number; data: any } {
  try {
    const url = `${SUPABASE_URL}${path}`;
    const authHeader = `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
    const apiKeyHeader = `apikey: ${SUPABASE_SERVICE_ROLE_KEY}`;

    let curlCmd = `curl -s -w '\\n%{http_code}' -X ${method} '${url}' -H '${authHeader}' -H '${apiKeyHeader}'`;

    if (body) {
      // Write body to a temp file to avoid shell escaping issues
      const tmpBody = join(tmpdir(), `supa-req-body-${Date.now()}.json`);
      writeFileSync(tmpBody, body, 'utf-8');
      curlCmd += ` -H 'Content-Type: application/json' --data-binary '@${tmpBody}'`;
      const result = exec(curlCmd);
      try { unlinkSync(tmpBody); } catch { /* ignore */ }
      return parseCurlResponse(result);
    }

    const result = exec(curlCmd);
    return parseCurlResponse(result);
  } catch (err) {
    return { status: 0, data: { error: String(err) } };
  }
}

function parseCurlResponse(result: { stdout: string; stderr: string }): { status: number; data: any } {
  const lines = result.stdout.split('\n').filter(Boolean);
  if (lines.length === 0) {
    return { status: 0, data: { error: result.stderr || 'Empty response from curl' } };
  }
  const httpCode = parseInt(lines[lines.length - 1], 10);
  const bodyRaw = lines.slice(0, -1).join('\n');
  let data: any;
  try {
    data = JSON.parse(bodyRaw);
  } catch {
    data = bodyRaw;
  }
  return { status: isNaN(httpCode) ? 0 : httpCode, data };
}

// ── Helper: Ensure Bucket Exists ───────────────────────────────────────

function ensureBucket(): boolean {
  // NOTE: Supabase Storage API uses singular /bucket (not /buckets)
  const check = supabaseRequest(
    'GET',
    `/storage/v1/bucket/${SUPABASE_BACKUP_BUCKET}`,
  );

  if (check.status === 200) {
    return true;
  }

  if (check.status === 404) {
    // Create the bucket
    const create = supabaseRequest(
      'POST',
      '/storage/v1/bucket',
      JSON.stringify({ name: SUPABASE_BACKUP_BUCKET, public: false }),
    );
    return create.status === 200 || create.status === 409;
  }

  return false;
}

// ── Helper: Upload File (uses curl instead of fetch) ───────────────────

function uploadBackup(filePath: string, filename: string): boolean {
  try {
    const url = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BACKUP_BUCKET}/${filename}`;
    const authHeader = `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
    const apiKeyHeader = `apikey: ${SUPABASE_SERVICE_ROLE_KEY}`;

    const curlCmd = `curl -s -w '\\n%{http_code}' -X POST '${url}' -H '${authHeader}' -H '${apiKeyHeader}' -H 'Content-Type: application/gzip' --data-binary '@${filePath}'`;
    const result = exec(curlCmd);
    const parsed = parseCurlResponse(result);
    return parsed.status >= 200 && parsed.status < 300;
  } catch {
    return false;
  }
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

  // Auto-detect postgres container on each run
  const container = findPostgresContainer();

  try {
    console.log(`[SupabaseBackupAgent] Dumping database ${DB_NAME} from container ${container}...`);

    // Pipe pg_dump directly through gzip — single step, no intermediate uncompressed file
    exec(
      `docker exec "${container}" pg_dump -U "${DB_USER}" "${DB_NAME}" | gzip > "${tempBackupPath}"`,
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
    const bucketReady = ensureBucket();
    if (!bucketReady) {
      throw new Error(`Failed to create or verify bucket ${SUPABASE_BACKUP_BUCKET}`);
    }

    // ── Step 3: Upload backup ────────────────────────────────────────
    console.log(`[SupabaseBackupAgent] Uploading ${backupFilename}...`);
    const uploaded = uploadBackup(tempBackupPath, backupFilename);
    if (!uploaded) {
      throw new Error(`Failed to upload backup ${backupFilename}`);
    }

    console.log(`[SupabaseBackupAgent] Upload successful: ${backupFilename}`);

    // ── Success ──────────────────────────────────────────────────────
    result.status = 'ok';
    result.message = `Backup uploaded successfully to ${SUPABASE_BACKUP_BUCKET}/${backupFilename}`;
    result.backup_file = backupFilename;
    result.file_size_bytes = fileSize;
    result.bucket = SUPABASE_BACKUP_BUCKET;

    await logAgentAction('supabase-backup', { db: DB_NAME, container }, result, 'ok');

  } catch (err) {
    result.status = 'error';
    result.message = `Backup failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[SupabaseBackupAgent] ${result.message}`);

    await logAgentAction('supabase-backup', { db: DB_NAME, container }, result, 'error', undefined, result.message);

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
