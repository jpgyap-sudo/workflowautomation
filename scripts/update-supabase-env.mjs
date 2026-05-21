#!/usr/bin/env node
/**
 * Update Supabase credentials in .env on the VPS
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *     node scripts/update-supabase-env.mjs [vps-host]
 */
import { execSync } from 'child_process';
import { resolve } from 'path';
import { homedir } from 'os';

const SSH_KEY = process.env.QAS_DEPLOY_KEY ?? resolve(homedir(), '.ssh', 'id_rsa');
const SSH_HOST = process.argv[2] || process.env.QAS_VPS_HOST;
const SSH_USER = process.env.QAS_SSH_USER || 'deploy';
const VPS_PATH = '/opt/quotation-automation';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SSH_HOST) { console.error('Set QAS_VPS_HOST or pass host as argument'); process.exit(1); }
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars');
  process.exit(1);
}

function ssh(cmd) {
  const fullCmd = `ssh -i "${SSH_KEY}" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new ${SSH_USER}@${SSH_HOST} "${cmd}"`;
  console.log(`$ ${fullCmd}`);
  const out = execSync(fullCmd, { stdio: 'inherit', timeout: 30000 });
  return out?.toString().trim();
}

console.log('=== Updating Supabase credentials on VPS ===\n');

console.log('── Step 1: Updating SUPABASE_URL ──');
ssh(`sed -i 's|^SUPABASE_URL=.*|SUPABASE_URL=${SUPABASE_URL}|' ${VPS_PATH}/.env`);

console.log('── Step 2: Updating SUPABASE_SERVICE_ROLE_KEY ──');
ssh(`sed -i 's|^SUPABASE_SERVICE_ROLE_KEY=.*|SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}|' ${VPS_PATH}/.env`);

console.log('\n── Step 3: Verification ──');
const verifyCmd = `ssh -i "${SSH_KEY}" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new ${SSH_USER}@${SSH_HOST} "grep -E 'SUPABASE_|BACKUP' ${VPS_PATH}/.env"`;
const out = execSync(verifyCmd, { timeout: 15000 });
console.log(out.toString());

console.log('=== Supabase credentials updated successfully ===');
