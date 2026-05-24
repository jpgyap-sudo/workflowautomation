#!/usr/bin/env node

/**
 * Deploy Agent — Quotation Automation System
 *
 * Configure via env vars: QAS_VPS_HOST, QAS_SSH_USER, QAS_DEPLOY_KEY
 *
 * Usage:
 *   node deploy-agent.mjs              # Full deploy (sync + build + up)
 *   node deploy-agent.mjs --sync-only  # Only sync files
 *   node deploy-agent.mjs --build-only # Only rebuild and restart
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ──────────────────────────────────────────────
const CONFIG = {
  sshHost: process.env.QAS_VPS_HOST ?? '127.0.0.1',
  sshUser: process.env.QAS_SSH_USER ?? 'deploy',
  sshIdentityFile: process.env.QAS_DEPLOY_KEY ?? resolve(process.env.HOME || process.env.USERPROFILE || '.', '.ssh', 'id_rsa'),
  // Target directory on VPS
  vpsPath: '/opt/quotation-automation',
  // Project root (this file's directory)
  projectRoot: __dirname,
};

// ── Helpers ────────────────────────────────────────────────────

function sshCmd(cmd) {
  const identityArg = CONFIG.sshIdentityFile
    ? `-i "${CONFIG.sshIdentityFile}"`
    : '';
  return `ssh ${identityArg} -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new ${CONFIG.sshUser}@${CONFIG.sshHost} "${cmd}"`;
}

function run(label, command, options = {}) {
  console.log(`\n── ${label} ──`);
  console.log(`$ ${command}`);
  try {
    const output = execSync(command, {
      cwd: CONFIG.projectRoot,
      stdio: 'inherit',
      timeout: options.timeout || 300_000,
      ...options,
    });
    return output?.toString().trim();
  } catch (err) {
    if (options.ignoreError) {
      console.error(`⚠  Warning: ${err.message}`);
      return null;
    }
    throw err;
  }
}

function runCapture(label, command, options = {}) {
  console.log(`\n── ${label} ──`);
  console.log(`$ ${command}`);
  try {
    const output = execSync(command, {
      cwd: CONFIG.projectRoot,
      timeout: options.timeout || 120_000,
      ...options,
    });
    const result = output.toString().trim();
    console.log(result);
    return result;
  } catch (err) {
    if (options.ignoreError) {
      console.error(`⚠  Warning: ${err.message}`);
      return null;
    }
    throw err;
  }
}

// ── Steps ──────────────────────────────────────────────────────

function syncFiles() {
  console.log('\n═══════════════════════════════════════════');
  console.log('  Step 1: Sync project files to VPS');
  console.log('═══════════════════════════════════════════');

  // Use git archive + tar over SSH to sync files
  // Files in /opt/... are owned by root, so we use sudo tar on the remote side
  const archiveCmd =
    `git archive --format=tar HEAD | ${sshCmd(`mkdir -p ${CONFIG.vpsPath} && sudo tar -xf - -C ${CONFIG.vpsPath}`)}`;

  run('Syncing via git archive + SSH tar', archiveCmd, { timeout: 120_000 });
  console.log('✓ Files synced');
}

function syncCredentials() {
  console.log('\n═══════════════════════════════════════════');
  console.log('  Step 2: Sync credentials & .env');
  console.log('═══════════════════════════════════════════');

  const credsDir = resolve(CONFIG.projectRoot, 'credentials');
  if (existsSync(credsDir)) {
    const files = execSync(`dir "${credsDir}" /b 2>nul || ls -1 "${credsDir}" 2>/dev/null`, {
      cwd: CONFIG.projectRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    if (files) {
      run('Creating credentials directory on VPS',
        sshCmd(`mkdir -p ${CONFIG.vpsPath}/credentials`));

      // Copy individual files (not the directory itself) to avoid nested credentials/credentials/
      // Split by newline and trim \r characters (Windows cmd.exe outputs \r\n)
      const credFiles = files.split('\n').map(f => f.trim()).filter(Boolean);
      for (const file of credFiles) {
        const localFile = resolve(credsDir, file);
        const scpCmd =
          `scp -i "${CONFIG.sshIdentityFile}" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "${localFile}" "${CONFIG.sshUser}@${CONFIG.sshHost}:${CONFIG.vpsPath}/credentials/"`;
        run(`Copying ${file} via SCP`, scpCmd, { timeout: 30_000 });
      }
      console.log('✓ Credentials synced');
    } else {
      console.log('⚠  No credential files found, skipping');
    }
  } else {
    console.log('⚠  No credentials directory found locally, skipping');
  }

  // Sync .env file (gitignored, so not in git archive)
  // ⚠️ IMPORTANT: Only sync .env if it DOESN'T already exist on the VPS.
  // This prevents overwriting production secrets (real Telegram chat IDs, etc.)
  // with local placeholder values during deployment.
  const envPath = resolve(CONFIG.projectRoot, '.env');
  const remoteEnvExists = runCapture('Checking if .env exists on VPS',
    sshCmd(`test -f ${CONFIG.vpsPath}/.env && echo 'EXISTS' || echo 'MISSING'`),
    { ignoreError: true, timeout: 10_000 }
  );
  if (remoteEnvExists?.trim() === 'EXISTS') {
    console.log('⚠  .env already exists on VPS — skipping overwrite to preserve production secrets');
    console.log('   To force sync, delete .env on VPS first or use --force-env flag');
  } else if (existsSync(envPath)) {
    const scpEnvCmd =
      `scp -i "${CONFIG.sshIdentityFile}" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "${envPath}" "${CONFIG.sshUser}@${CONFIG.sshHost}:${CONFIG.vpsPath}/.env"`;
    run('Copying .env via SCP', scpEnvCmd, { timeout: 30_000 });
    console.log('✓ .env synced');
  } else {
    console.log('⚠  No .env file found locally, skipping');
  }
}

function deployContainers() {
  console.log('\n═══════════════════════════════════════════');
  console.log('  Step 3: Build and start containers');
  console.log('═══════════════════════════════════════════');

  // ── Delegate to deploy.sh --skip-pull ──
  // deploy.sh recreates services one-at-a-time (stop → rm → up --no-deps) to avoid
  // the Docker Compose v1 ContainerConfig / stale image hash interactive [yN] prompt bug.
  // It also handles rollback tagging, DB backup, health checks, and image cleanup.
  // --skip-pull: files were already synced via git archive in Step 1.
  run('Running deploy.sh --skip-pull on VPS',
    sshCmd(`cd ${CONFIG.vpsPath} && bash scripts/deploy.sh --skip-pull`),
    { timeout: 600_000 });

  console.log('✓ deploy.sh completed');
}

// ── Main ───────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const syncOnly = args.includes('--sync-only');
  const buildOnly = args.includes('--build-only');

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   Quotation Automation System — Deploy Agent ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`Target: ${CONFIG.sshUser}@${CONFIG.sshHost}:${CONFIG.vpsPath}`);

  const startTime = Date.now();

  try {
    if (buildOnly) {
      deployContainers();
    } else if (syncOnly) {
      syncFiles();
      syncCredentials();
    } else {
      syncFiles();
      syncCredentials();
      deployContainers();
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✓ Deployment completed in ${elapsed}s`);
  } catch (err) {
    console.error('\n✗ Deployment failed:', err.message);
    process.exit(1);
  }
}

main();
