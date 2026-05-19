#!/usr/bin/env node
/**
 * Update Supabase credentials in .env on the VPS
 *
 * Usage:
 *   node scripts/update-supabase-env.mjs          # Uses default VPS
 *   node scripts/update-supabase-env.mjs <host>   # Custom VPS IP
 */
import { execSync } from 'child_process';
import { resolve } from 'path';
import { homedir } from 'os';

const SSH_KEY = resolve(homedir(), '.ssh', 'id_ed25519_roo');
const SSH_HOST = process.argv[2] || '100.86.182.7';
const SSH_USER = 'root';
const VPS_PATH = '/opt/quotation-automation';

// ═══════════════════════════════════════════════════════════════
// Supabase Project: zetmxacmioodgxxmursa
// Dashboard: https://supabase.com/dashboard/project/zetmxacmioodgxxmursa
// ═══════════════════════════════════════════════════════════════
const SUPABASE_URL = 'https://zetmxacmioodgxxmursa.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpldG14YWNtaW9vZGd4eG11cnNhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTIwMDM0MSwiZXhwIjoyMDk0Nzc2MzQxfQ.cz8caUo2RBCjK-2c7vdf5ls_rtlFIdkt5DcNyi372Lk';

function ssh(cmd) {
  const fullCmd = `ssh -i "${SSH_KEY}" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new ${SSH_USER}@${SSH_HOST} "${cmd}"`;
  console.log(`$ ${fullCmd}`);
  const out = execSync(fullCmd, { stdio: 'inherit', timeout: 30000 });
  return out?.toString().trim();
}

console.log('=== Updating Supabase credentials on VPS ===\n');

// Step 1: Update SUPABASE_URL
console.log('── Step 1: Updating SUPABASE_URL ──');
ssh(`sed -i 's|^SUPABASE_URL=.*|SUPABASE_URL=${SUPABASE_URL}|' ${VPS_PATH}/.env`);

// Step 2: Update SUPABASE_SERVICE_ROLE_KEY
console.log('── Step 2: Updating SUPABASE_SERVICE_ROLE_KEY ──');
ssh(`sed -i 's|^SUPABASE_SERVICE_ROLE_KEY=.*|SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}|' ${VPS_PATH}/.env`);

// Step 3: Verify
console.log('\n── Step 3: Verification ──');
const verifyCmd = `ssh -i "${SSH_KEY}" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new ${SSH_USER}@${SSH_HOST} "grep -E 'SUPABASE_|BACKUP' ${VPS_PATH}/.env"`;
const out = execSync(verifyCmd, { timeout: 15000 });
console.log(out.toString());

console.log('=== Supabase credentials updated successfully ===');
