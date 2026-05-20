#!/usr/bin/env node

/**
 * Single Builder Deploy Agent
 *
 * Purpose:
 * - All AI coding tools may edit code, but only this deploy agent should release production.
 * - Deploys one exact, pushed git SHA to the VPS.
 * - Uses a remote deployment lock so concurrent agents cannot mix image/container state.
 * - Rebuilds/recreates app services one at a time to avoid docker-compose v1 ContainerConfig issues.
 *
 * Usage:
 *   node scripts/single-builder-deploy.mjs
 *   node scripts/single-builder-deploy.mjs --sha <commit-sha>
 *   node scripts/single-builder-deploy.mjs --skip-local-checks
 *   node scripts/single-builder-deploy.mjs --sync-secrets
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const config = {
  sshHost: process.env.QAS_DEPLOY_HOST ?? '100.86.182.7',
  sshUser: process.env.QAS_DEPLOY_USER ?? 'root',
  sshKey: process.env.QAS_DEPLOY_KEY ?? resolve(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.ssh', 'id_ed25519_roo'),
  remotePath: process.env.QAS_DEPLOY_PATH ?? '/opt/quotation-automation',
  healthEndpoint: 'http://127.0.0.1:8080/health',
  dashboardEndpoint: 'http://127.0.0.1:3001/',
};

const args = new Set(process.argv.slice(2));
const argValue = (name) => {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

if (args.has('--help') || args.has('-h')) {
  console.log(`
Single Builder Deploy Agent

Options:
  --sha <sha>            Commit SHA to deploy (default: HEAD)
  --skip-local-checks    Skip npm build/lint checks before deploy
  --sync-secrets         Copy local .env and credentials/* to VPS before deploy
  --help                 Show this help

Environment overrides:
  QAS_DEPLOY_HOST, QAS_DEPLOY_USER, QAS_DEPLOY_KEY, QAS_DEPLOY_PATH
`);
  process.exit(0);
}

const requestedSha = argValue('--sha') ?? 'HEAD';
const skipLocalChecks = args.has('--skip-local-checks');
const syncSecrets = args.has('--sync-secrets');

function run(label, command, options = {}) {
  console.log(`\n==> ${label}`);
  console.log(`$ ${command}`);
  execSync(command, {
    cwd: projectRoot,
    stdio: 'inherit',
    timeout: options.timeout ?? 300_000,
    shell: true,
  });
}

function capture(label, command, options = {}) {
  console.log(`\n==> ${label}`);
  console.log(`$ ${command}`);
  return execSync(command, {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: options.timeout ?? 120_000,
    shell: true,
  }).trim();
}

function sshBaseArgs() {
  return [
    '-i',
    config.sshKey,
    '-o',
    'ConnectTimeout=10',
    '-o',
    'StrictHostKeyChecking=accept-new',
    `${config.sshUser}@${config.sshHost}`,
  ];
}

function ssh(command, options = {}) {
  console.log(`\n==> Remote: ${options.label ?? 'command'}`);
  console.log(`ssh ${config.sshUser}@${config.sshHost} ${command}`);
  execFileSync('ssh', [...sshBaseArgs(), command], {
    cwd: projectRoot,
    stdio: 'inherit',
    timeout: options.timeout ?? 300_000,
  });
}

function scp(localPath, remotePath, options = {}) {
  console.log(`\n==> Copy: ${localPath} -> ${remotePath}`);
  execFileSync('scp', [
    '-i',
    config.sshKey,
    '-o',
    'ConnectTimeout=10',
    '-o',
    'StrictHostKeyChecking=accept-new',
    localPath,
    `${config.sshUser}@${config.sshHost}:${remotePath}`,
  ], {
    cwd: projectRoot,
    stdio: 'inherit',
    timeout: options.timeout ?? 120_000,
  });
}

function assertCleanAndPushed(sha) {
  const status = capture('Checking local working tree', 'git status --porcelain --untracked-files=all');
  if (status) {
    throw new Error(`Refusing to deploy with uncommitted/untracked files:\n${status}`);
  }

  run('Fetching origin', 'git fetch origin', { timeout: 120_000 });

  const remoteBranches = capture('Verifying commit exists on a remote branch', `git branch -r --contains ${sha}`);
  if (!remoteBranches) {
    throw new Error(`Refusing to deploy ${sha}: commit is not present on any remote branch. Push it first.`);
  }
}

function runChecks() {
  // Use npm --prefix instead of shell-specific "cd &&" so this works in PowerShell and bash.
  run('API build', 'npm --prefix apps/api run build', { timeout: 180_000 });
  run('Telegram bot build', 'npm --prefix apps/telegram-bot run build', { timeout: 180_000 });
  run('Dashboard lint', 'npm --prefix apps/dashboard run lint', { timeout: 180_000 });
  run('Dashboard build', 'npm --prefix apps/dashboard run build', { timeout: 240_000 });
}

function syncArchive(sha) {
  const remoteCommand = `mkdir -p ${config.remotePath} && tar -xf - -C ${config.remotePath}`;
  run(
    `Syncing exact git archive ${sha}`,
    `git archive --format=tar ${sha} | ssh -i "${config.sshKey}" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new ${config.sshUser}@${config.sshHost} "${remoteCommand}"`,
    { timeout: 180_000 },
  );
}

function maybeSyncSecrets() {
  if (!syncSecrets) {
    console.log('\n==> Secret sync skipped (use --sync-secrets only when .env/credentials changed)');
    return;
  }

  const envPath = resolve(projectRoot, '.env');
  if (existsSync(envPath)) {
    scp(envPath, `${config.remotePath}/.env`);
  }

  const credsDir = resolve(projectRoot, 'credentials');
  if (existsSync(credsDir)) {
    ssh(`mkdir -p ${config.remotePath}/credentials`, { label: 'ensure credentials directory' });
    const files = execSync(`dir "${credsDir}" /b`, { encoding: 'utf8', shell: true })
      .split(/\r?\n/)
      .map((f) => f.trim())
      .filter(Boolean);
    for (const file of files) {
      scp(resolve(credsDir, file), `${config.remotePath}/credentials/`);
    }
  }
}

function remoteDeploy(sha) {
  const tempDir = mkdtempSync(join(tmpdir(), 'qas-builder-'));
  const localScript = join(tempDir, 'remote-single-builder-deploy.sh');

  const remoteScript = `#!/usr/bin/env bash
set -euo pipefail

DEPLOY_PATH="${config.remotePath}"
SHA="${sha}"
LOCK_DIR="$DEPLOY_PATH/.deploy.lock"
LOCK_INFO="$LOCK_DIR/info"
SERVICES=(api dashboard telegram-bot)

cd "$DEPLOY_PATH"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Deployment lock is already held:"
  cat "$LOCK_INFO" 2>/dev/null || true
  exit 70
fi

cleanup() {
  rm -rf "$LOCK_DIR"
}
trap cleanup EXIT

{
  echo "sha=$SHA"
  echo "started_at=$(date -Iseconds)"
  echo "host=$(hostname)"
  echo "pid=$$"
} > "$LOCK_INFO"

echo "$SHA" > .deployed-sha

compose() {
  docker-compose "$@"
}

deploy_service() {
  local service="$1"
  echo
  echo "---- Building $service for $SHA ----"
  compose build "$service"

  case "$service" in
    api) docker tag ghcr.io/jpgyap-sudo/workflowautomation/api:latest "ghcr.io/jpgyap-sudo/workflowautomation/api:$SHA" || true ;;
    dashboard) docker tag ghcr.io/jpgyap-sudo/workflowautomation/dashboard:latest "ghcr.io/jpgyap-sudo/workflowautomation/dashboard:$SHA" || true ;;
    telegram-bot) docker tag ghcr.io/jpgyap-sudo/workflowautomation/telegram-bot:latest "ghcr.io/jpgyap-sudo/workflowautomation/telegram-bot:$SHA" || true ;;
  esac

  echo "---- Recreating $service ----"
  # docker-compose v1 can hit KeyError: ContainerConfig when recreating from newer images.
  # Removing the old container before up avoids merging old volume metadata.
  compose stop "$service" || true
  compose rm -f "$service" || true
  compose up -d --no-deps "$service"
}

for service in "\${SERVICES[@]}"; do
  deploy_service "$service"
done

echo
echo "---- Waiting for API health ----"
for i in {1..30}; do
  if curl -fsS "${config.healthEndpoint}" >/tmp/qas-health.json; then
    cat /tmp/qas-health.json
    echo
    break
  fi
  if [ "$i" = "30" ]; then
    echo "API health check failed after 30 attempts"
    compose ps
    exit 71
  fi
  sleep 2
done

echo "---- Dashboard check ----"
curl -fsS -o /dev/null "${config.dashboardEndpoint}"

echo "---- Container status ----"
compose ps api dashboard telegram-bot

echo "Single-builder deployment completed for $SHA"
`;

  writeFileSync(localScript, remoteScript, { encoding: 'utf8', mode: 0o700 });
  const remoteScriptPath = `/tmp/qas-single-builder-${sha}.sh`;

  try {
    scp(localScript, remoteScriptPath);
    ssh(`bash ${remoteScriptPath}`, { label: 'single-builder deploy', timeout: 900_000 });
  } finally {
    try {
      ssh(`rm -f ${remoteScriptPath}`, { label: 'cleanup remote script', timeout: 30_000 });
    } catch {
      // Ignore cleanup errors; deployment status has already been reported.
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function main() {
  const sha = capture('Resolving deployment SHA', `git rev-parse --verify ${requestedSha}`);
  console.log(`
Single Builder Deploy
  SHA:         ${sha}
  Target:      ${config.sshUser}@${config.sshHost}:${config.remotePath}
  Local tests: ${skipLocalChecks ? 'skipped' : 'enabled'}
  Secrets:     ${syncSecrets ? 'sync enabled' : 'not synced'}
`);

  assertCleanAndPushed(sha);

  if (!skipLocalChecks) {
    runChecks();
  }

  syncArchive(sha);
  maybeSyncSecrets();
  remoteDeploy(sha);

  console.log(`\nDeployment complete: ${sha}`);
}

try {
  main();
} catch (error) {
  console.error(`\nDeployment failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
