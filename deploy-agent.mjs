#!/usr/bin/env node

/**
 * Deploy Agent — Quotation Automation System
 *
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  VPS: 165.22.110.111  (Tailscale: 100.86.182.7)            ║
 * ║  Website: https://track.abcx124.xyz                        ║
 * ║  Repo: /opt/quotation-automation                           ║
 * ║  SSH: root@165.22.110.111 (key: id_ed25519_roo)            ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   node deploy-agent.mjs              # Full deploy (sync + build + up)
 *   node deploy-agent.mjs --sync-only  # Only sync files
 *   node deploy-agent.mjs --build-only # Only rebuild and restart
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ──────────────────────────────────────────────
const CONFIG = {
  // Tailscale IP of the VPS (ubuntu-s-1vcpu-1gb-sgp1)
  sshHost: '100.86.182.7',
  // SSH user (root works because we use root's key)
  sshUser: 'root',
  // Path to SSH identity file
  sshIdentityFile: resolve(process.env.HOME || 'C:\\Users\\User', '.ssh', 'id_ed25519_roo'),
  // Target directory on VPS
  vpsPath: '/opt/quotation-automation',
  // Health check endpoint
  healthEndpoint: 'http://localhost:8080/health',
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
  const envPath = resolve(CONFIG.projectRoot, '.env');
  if (existsSync(envPath)) {
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

  // Check if docker-compose (v1) or docker compose (v2) is available
  const composeCheck = runCapture('Checking Docker Compose',
    sshCmd(`docker-compose --version 2>/dev/null || docker compose version 2>/dev/null || echo "none"`),
    { ignoreError: true, timeout: 10_000 });

  const isV1 = composeCheck?.includes('docker-compose');
  const composeBin = isV1 ? 'docker-compose' : 'docker compose';
  console.log(`Using: ${composeBin}`);

  // ── Isolation safeguard: verify we're in the right project ──
  // Ensure docker-compose only manages containers defined in THIS project's compose file.
  // The compose project name is derived from the directory name ("quotation-automation"),
  // so running compose from /opt/quotation-automation will only affect our containers.
  const projectCheck = runCapture('Verifying project isolation',
    sshCmd(`cd ${CONFIG.vpsPath} && ${composeBin} ps --services 2>/dev/null`),
    { ignoreError: true, timeout: 15_000 });

  if (projectCheck) {
    const expectedServices = ['api', 'dashboard', 'telegram-bot', 'postgres', 'redis'];
    const actualServices = projectCheck.split('\n').map(s => s.trim()).filter(Boolean);
    const missing = expectedServices.filter(s => !actualServices.includes(s));
    if (missing.length > 0) {
      console.log(`⚠  Some expected services not found by compose: ${missing.join(', ')}`);
      console.log('   This may be a first-time deploy or the project directory is wrong.');
    }
    // Warn if we see services that don't belong to this project
    const unexpected = actualServices.filter(s => !expectedServices.includes(s));
    if (unexpected.length > 0) {
      console.log(`⚠  Unexpected services detected: ${unexpected.join(', ')}`);
      console.log('   These belong to another project sharing this Docker daemon.');
    }
  }

  // ── Build and start (scoped to this project's compose file) ──
  // docker-compose up -d --build only affects services defined in the local docker-compose.yml.
  // Other projects' containers, images, and networks are NOT touched.
  run('Building and starting containers',
    sshCmd(`cd ${CONFIG.vpsPath} && ${composeBin} up -d --build`),
    { timeout: 600_000 });

  console.log('✓ Containers started');
}

function verifyDeployment() {
  console.log('\n═══════════════════════════════════════════');
  console.log('  Step 4: Verify deployment');
  console.log('═══════════════════════════════════════════');

  // Wait a moment for containers to start
  console.log('Waiting 10 seconds for services to initialize...');
  execSync('timeout /t 10 /nobreak 2>nul || sleep 10', { stdio: 'inherit' });

  // Check running containers
  const ps = runCapture('Container status',
    sshCmd(`cd ${CONFIG.vpsPath} && docker-compose ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'`),
    { ignoreError: true, timeout: 15_000 });

  if (ps) {
    console.log(ps);
  }

  // Health check
  const health = runCapture('API health check',
    sshCmd(`curl -s ${CONFIG.healthEndpoint}`),
    { ignoreError: true, timeout: 15_000 });

  if (health) {
    try {
      const parsed = JSON.parse(health);
      if (parsed.ok) {
        console.log('✓ API health check passed');
      } else {
        console.log('⚠  API health check returned unexpected response:', health);
      }
    } catch {
      console.log('⚠  API health check response:', health);
    }
  } else {
    console.log('⚠  Health check failed — API may still be starting');
  }
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
      verifyDeployment();
    } else if (syncOnly) {
      syncFiles();
      syncCredentials();
    } else {
      syncFiles();
      syncCredentials();
      deployContainers();
      verifyDeployment();
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✓ Deployment completed in ${elapsed}s`);
  } catch (err) {
    console.error('\n✗ Deployment failed:', err.message);
    process.exit(1);
  }
}

main();
