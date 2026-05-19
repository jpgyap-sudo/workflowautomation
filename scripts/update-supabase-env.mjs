#!/usr/bin/env node
/**
 * Update Supabase credentials in .env on the VPS
 */
import { execSync } from 'child_process';
import { resolve, join } from 'path';
import { homedir } from 'os';

const SSH_KEY = resolve(homedir(), '.ssh', 'id_ed25519_roo');
const SSH_HOST = '100.86.182.7';
const SSH_USER = 'root';
const VPS_PATH = '/opt/quotation-automation';

function ssh(cmd) {
  const fullCmd = `ssh -i "${SSH_KEY}" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new ${SSH_USER}@${SSH_HOST} "${cmd}"`;
  console.log(`$ ${fullCmd}`);
  const out = execSync(fullCmd, { stdio: 'inherit', timeout: 30000 });
  return out?.toString().trim();
}

// Step 1: Update SUPABASE_URL
ssh(`sed -i 's|<your-project>|rbhfkwwnpmytmwueajje|' ${VPS_PATH}/.env`);

// Step 2: Update SUPABASE_SERVICE_ROLE_KEY
ssh(`sed -i 's|<your-service-role-key>|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJiaGZrd3ducG15dG13dWVhamplIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Nzk3MzMyMSwiZXhwIjoyMDkzNTQ5MzIxfQ.MiEQFI3JGd8swPOuyQXlxj6vWjMS3gl44140pNe6Dig|' ${VPS_PATH}/.env`);

// Step 3: Verify
const verifyCmd = `ssh -i "${SSH_KEY}" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new ${SSH_USER}@${SSH_HOST} "grep -E 'SUPABASE_|BACKUP' ${VPS_PATH}/.env"`;
console.log('\n--- Verification ---');
const out = execSync(verifyCmd, { timeout: 15000 });
console.log(out.toString());
