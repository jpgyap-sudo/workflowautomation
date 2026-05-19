#!/usr/bin/env node
/**
 * SMTP Setup Script — run once to configure Gmail OTP credentials
 * Usage: node setup-smtp.mjs
 */

import { createInterface } from 'readline';
import { readFileSync, writeFileSync } from 'fs';
import { createTransport } from './apps/api/node_modules/nodemailer/lib/nodemailer.js';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dir, '.env');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` :
              process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
}

console.log('\n─────────────────────────────────────────');
console.log('  SMTP / Gmail OTP Setup');
console.log('─────────────────────────────────────────\n');
console.log('Step 1: Create a Gmail App Password');
console.log('  • You need 2-Step Verification turned on for your Google account.');
console.log('  • Go to: https://myaccount.google.com/apppasswords');
console.log('  • App name: "Quotation System" → click Create → copy the 16-char password.\n');

const open = await ask('Open that page in your browser now? (y/n): ');
if (open.trim().toLowerCase() !== 'n') {
  openBrowser('https://myaccount.google.com/apppasswords');
  console.log('Browser opened. Come back when you have the App Password.\n');
}

const gmailUser = (await ask('Your Gmail address: ')).trim();
const appPass   = (await ask('App Password (16 chars, no spaces): ')).trim().replace(/\s/g, '');

if (!gmailUser.includes('@') || appPass.length < 16) {
  console.error('\n❌  Invalid input. Gmail must contain "@" and App Password must be 16 characters.');
  process.exit(1);
}

console.log('\nTesting SMTP connection…');
const transporter = createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: { user: gmailUser, pass: appPass },
});

try {
  await transporter.verify();
  console.log('✅  SMTP connection OK\n');
} catch (err) {
  console.error('❌  SMTP test failed:', err.message);
  console.error('    Double-check your Gmail address and App Password, then try again.');
  rl.close();
  process.exit(1);
}

// Write to .env
let env = readFileSync(ENV_PATH, 'utf8');
env = env
  .replace(/^SMTP_USER=.*$/m, `SMTP_USER=${gmailUser}`)
  .replace(/^SMTP_PASS=.*$/m, `SMTP_PASS=${appPass}`);
writeFileSync(ENV_PATH, env, 'utf8');

console.log(`✅  .env updated with SMTP credentials.`);
console.log('\nNext steps:');
console.log('  • Redeploy the API:  docker compose up -d --build api');
console.log('  • Or locally:        cd apps/api && npm run dev\n');

rl.close();
