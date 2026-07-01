import { chromium } from 'playwright';

const BASE_URL = 'https://track.homeatelier.ph';

async function capture(url, label) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // Capture console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000); // Wait for JS to hydrate

    await page.screenshot({ path: `screenshot-${label}.png`, fullPage: true });

    // Get page HTML structure
    const html = await page.content();
    const text = await page.innerText('body');

    console.log(`\n=== ${label} ===`);
    console.log(`URL: ${url}`);
    console.log(`Title: ${await page.title()}`);
    console.log(`Console errors: ${consoleErrors.length > 0 ? consoleErrors.join(' | ') : 'none'}`);
    console.log(`Body text (first 500 chars): ${text.substring(0, 500)}`);
    
    // Check for common issues
    const hasSpinner = await page.$('.animate-spin, .loading, [class*="spinner"]');
    const hasError = await page.$('[class*="error"], [class*="Error"]');
    const visibleText = text.trim();
    
    console.log(`Has spinner: ${!!hasSpinner}`);
    console.log(`Has error element: ${!!hasError}`);
    console.log(`Visible text length: ${visibleText.length}`);
    
    if (visibleText.length < 50) {
      console.log(`⚠️  Page appears mostly empty or loading`);
    }

  } catch (err) {
    console.log(`Error capturing ${label}: ${err.message}`);
    try {
      await page.screenshot({ path: `screenshot-${label}-error.png` });
    } catch {}
  } finally {
    await browser.close();
  }
}

async function main() {
  // Capture the main page
  await capture(BASE_URL, 'home');
  
  // Capture login page
  await capture(`${BASE_URL}/login`, 'login');
  
  // Capture an order page (might redirect to login)
  await capture(`${BASE_URL}/orders/qty-julia`, 'order');
}

main().catch(console.error);
