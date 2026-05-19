#!/usr/bin/env node
/**
 * Test the Supabase backup by running it on the VPS
 */
import { execSync } from 'child_process';
import { resolve } from 'path';
import { homedir } from 'os';

const SSH_KEY = resolve(homedir(), '.ssh', 'id_ed25519_roo');
const SSH_HOST = '100.86.182.7';
const SSH_USER = 'root';

function runRemote(cmd) {
  const fullCmd = `ssh -i "${SSH_KEY}" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new ${SSH_USER}@${SSH_HOST} "${cmd}"`;
  console.log(`$ ${fullCmd}`);
  const out = execSync(fullCmd, { stdio: 'inherit', timeout: 120000 });
  return out?.toString().trim();
}

console.log('=== Running Supabase Backup Test ===\n');
runRemote('cd /opt/quotation-automation && sh scripts/backup-to-supabase.sh');
console.log('\n=== Backup test complete ===');
