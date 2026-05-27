/**
 * capture-screenshots.mjs
 *
 * Playwright script that captures guide screenshots for every major dashboard page.
 *
 * Auth strategy (two-phase, race-condition-proof):
 *  1. addInitScript → sets localStorage before every React hydration
 *  2. After navigation, if still on /login (rare timing race), force-set
 *     localStorage via evaluate() and reload — guaranteed to work.
 *
 * Usage:
 *   npm run screenshots                  # default: http://localhost:3000
 *   SCREENSHOT_URL=http://localhost:3001 npm run screenshots
 *
 * Output: public/screenshots/*.png
 */

import { chromium } from '@playwright/test';
import { mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const SCREENSHOTS_DIR = join(__dirname, '..', 'public', 'screenshots');
const BASE_URL        = process.env.SCREENSHOT_URL ?? 'http://localhost:3000';

// ─── Auth state ───────────────────────────────────────────────────────────────
const AUTH_STATE     = JSON.stringify({ email: 'jpgyap@gmail.com', name: 'Admin', role: 'admin' });
const ACCOUNTS_STATE = JSON.stringify([
  { email: 'jpgyap@gmail.com', password: 'Purchasing888', name: 'Admin', role: 'admin', createdAt: '2025-01-01T00:00:00.000Z' },
]);

async function injectAuth(page) {
  await page.evaluate(([auth, accounts]) => {
    localStorage.setItem('qas_auth',     auth);
    localStorage.setItem('qas_accounts', accounts);
  }, [AUTH_STATE, ACCOUNTS_STATE]);
}

// ─── Pages ────────────────────────────────────────────────────────────────────
const PAGES = [
  { url: '/orders',     file: 'orders-list.png' },
  { url: '/actions',    file: 'actions-main.png' },
  { url: '/clients',    file: 'clients-list.png' },
  { url: '/purchasing', file: 'purchasing-main.png' },
  { url: '/production', file: 'production-main.png' },
  { url: '/inventory',  file: 'inventory-list.png' },
  { url: '/stock-prep', file: 'stock-prep-main.png' },
  { url: '/delivery',   file: 'delivery-main.png' },
  { url: '/collection', file: 'collection-main.png' },
  { url: '/calendar',   file: 'calendar-main.png' },
  { url: '/workflow',   file: 'workflow-main.png' },
];

// ─── Capture helper ───────────────────────────────────────────────────────────
async function capturePage(page, { url, file }) {
  const target = `${BASE_URL}${url}`;
  console.log(`  📸  ${url}`);

  // Phase 1: navigate
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 40_000 });

  // Phase 2: if AuthGuard raced and redirected to /login, re-inject and reload
  if (page.url().includes('/login')) {
    await injectAuth(page);
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 40_000 });
    await page.waitForTimeout(600);

    // Still on login? bail.
    if (page.url().includes('/login')) {
      console.warn(`  ⚠️   ${file}: still on /login after re-inject — skipping`);
      return false;
    }
  }

  // Phase 3: wait for React hydration + skeleton loaders + CSS transitions
  await page.waitForTimeout(1800);

  await page.screenshot({
    path:       join(SCREENSHOTS_DIR, file),
    fullPage:   false,
    animations: 'disabled',
  });

  console.log(`  ✅  saved → public/screenshots/${file}`);
  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  await mkdir(SCREENSHOTS_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport:          { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
  });

  const page = await context.newPage();

  // Phase-1 injection: runs before every navigation's JS bundle
  await page.addInitScript(() => {
    const AUTH     = '{"email":"jpgyap@gmail.com","name":"Admin","role":"admin"}';
    const ACCOUNTS = '[{"email":"jpgyap@gmail.com","password":"Purchasing888","name":"Admin","role":"admin","createdAt":"2025-01-01T00:00:00.000Z"}]';
    localStorage.setItem('qas_auth',     AUTH);
    localStorage.setItem('qas_accounts', ACCOUNTS);
  });

  // Suppress noisy API errors from the app (backend not required for screenshots)
  page.on('console', (msg) => {
    if (msg.type() === 'error') process.stdout.write('');
  });

  let ok = 0; let failed = 0;
  console.log(`\n🎬  Capturing ${PAGES.length} screenshots → ${SCREENSHOTS_DIR}\n`);

  for (const entry of PAGES) {
    try {
      const saved = await capturePage(page, entry);
      if (saved) ok++; else failed++;
    } catch (err) {
      console.error(`  ❌  ${entry.file}: ${err.message}`);
      failed++;
    }
  }

  await browser.close();
  console.log(`\n✨  Done — ${ok} captured, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
