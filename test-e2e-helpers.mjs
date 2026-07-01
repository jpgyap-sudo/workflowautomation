#!/usr/bin/env node
/**
 * Shared helpers for E2E tests.
 * Provides getActionToken() which fetches a fresh OTP from Redis via SSH
 * and exchanges it for an action token.
 */

import { execSync } from 'child_process';

const BASE = process.env.BASE_URL ?? 'https://track.homeatelier.ph/api';
const EMAIL = process.env.TEST_EMAIL ?? 'jpgyap@gmail.com';
const SSH_KEY = process.env.SSH_KEY ?? 'C:\\Users\\User\\.ssh\\id_ed25519_roo';
const VPS_HOST = process.env.VPS_HOST ?? 'root@100.86.182.7';

/**
 * Get a fresh action token by:
 * 1. Sending OTP via /auth/send-otp
 * 2. Reading OTP from Redis on the VPS via SSH
 * 3. Verifying OTP via /auth/verify-otp-for-action
 */
export async function getActionToken() {
  // Step 1: Send OTP
  const sendRes = await fetch(`${BASE}/auth/send-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL }),
  });

  if (!sendRes.ok) {
    const body = await sendRes.text();
    throw new Error(`send-otp failed: ${sendRes.status} ${body.slice(0, 200)}`);
  }

  // Step 2: Wait briefly for Redis write, then read OTP via SSH
  await new Promise(r => setTimeout(r, 500));

  let otp;
  try {
    // First, find the Redis container ID
    const containerId = execSync(
      `ssh -i "${SSH_KEY}" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new ${VPS_HOST} "docker ps -q -f name=redis"`,
      { encoding: 'utf-8', timeout: 15000 }
    ).trim();

    if (!containerId) {
      throw new Error('Redis container not found');
    }

    // Then, read the OTP from Redis
    const redisOutput = execSync(
      `ssh -i "${SSH_KEY}" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new ${VPS_HOST} "docker exec ${containerId} redis-cli GET 'otp:${EMAIL.toLowerCase()}'"`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    const parsed = JSON.parse(redisOutput.trim());
    otp = parsed.otp;
  } catch (err) {
    throw new Error(`Failed to read OTP from Redis: ${err.message}`);
  }

  if (!otp) {
    throw new Error('OTP not found in Redis');
  }

  // Step 3: Verify OTP for action
  const verifyRes = await fetch(`${BASE}/auth/verify-otp-for-action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, otp, name: 'E2E Test' }),
  });

  const verifyData = await verifyRes.json();
  if (!verifyRes.ok || !verifyData.actionToken) {
    throw new Error(`verify-otp-for-action failed: ${verifyRes.status} ${JSON.stringify(verifyData).slice(0, 200)}`);
  }

  return verifyData.actionToken;
}

export async function api(method, path, body) {
  const opts = { method, headers: { 'content-type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { status: res.status, data };
}
