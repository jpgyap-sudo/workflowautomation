#!/usr/bin/env node
/**
 * Test the Supabase backup by running it on the VPS
 *
 * Usage:
 *   node scripts/test-supabase-backup.mjs              # Default VPS
 *   node scripts/test-supabase-backup.mjs <host>       # Custom VPS IP
 */
import { execSync } from 'child_process';
import { resolve } from 'path';
import { homedir } from 'os';

const SSH_KEY = process.env.QAS_DEPLOY_KEY ?? resolve(homedir(), '.ssh', 'id_rsa');
const SSH_HOST = process.argv[2] || process.env.QAS_VPS_HOST;
const SSH_USER = process.env.QAS_SSH_USER || 'deploy';

if (!SSH_HOST) { console.error('Set QAS_VPS_HOST or pass host as argument'); process.exit(1); }

function runRemote(cmd) {
  const fullCmd = `ssh -i "${SSH_KEY}" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new ${SSH_USER}@${SSH_HOST} "${cmd}"`;
  console.log(`$ ${fullCmd}`);
  const out = execSync(fullCmd, { stdio: 'inherit', timeout: 120000 });
  return out?.toString().trim();
}

console.log('=== Running Supabase Backup Test ===\n');
console.log(`Target VPS: ${SSH_USER}@${SSH_HOST}`);
console.log('');

// First verify the .env has Supabase credentials
console.log('── Pre-check: Verifying Supabase credentials in .env ──');
const envCheck = runRemote(`grep -E '^SUPABASE_URL=|^SUPABASE_SERVICE_ROLE_KEY=' /opt/quotation-automation/.env`);
console.log('');

// Run the backup
console.log('── Running backup-to-supabase.sh ──');
runRemote('cd /opt/quotation-automation && sh scripts/backup-to-supabase.sh');
console.log('\n=== Backup test complete ===');
