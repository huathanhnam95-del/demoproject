const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => {
        if (typeof port === 'number') {
          resolve(port);
          return;
        }
        reject(new Error('Failed to allocate free port'));
      });
    });
    server.on('error', reject);
  });
}

async function waitForServer(url, timeoutMs = 45000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_) {
      // Retry until ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready: ${url}`);
}

async function assertSharedHeader(page, expectedActiveLabel) {
  const header = page.locator('[data-site-header]');
  await header.waitFor({ state: 'visible', timeout: 3000 });

  const activeLink = header.locator('[aria-current="page"]');
  await activeLink.waitFor({ state: 'visible', timeout: 3000 });

  const activeText = (await activeLink.innerText()).trim();
  if (activeText !== expectedActiveLabel) {
    throw new Error(`Expected active header link "${expectedActiveLabel}", got "${activeText}"`);
  }
}

async function assertHomeDesktop(page, baseUrl) {
  await page.goto(`${baseUrl}/landing/en/index.html`, { waitUntil: 'domcontentloaded' });

  // Hero heading
  await page.getByRole('heading', { name: /Stay in the/i }).waitFor({ state: 'visible', timeout: 3000 });

  // Nav links
  await page.getByRole('link', { name: 'Try Free Demo', exact: true }).first().waitFor({ state: 'visible', timeout: 3000 });
  await page.getByRole('link', { name: 'How It Works', exact: true }).waitFor({ state: 'visible', timeout: 3000 });
  await page.getByRole('link', { name: 'Your Journey', exact: true }).waitFor({ state: 'visible', timeout: 3000 });
  await page.getByRole('link', { name: 'Features', exact: true }).waitFor({ state: 'visible', timeout: 3000 });
  await page.getByRole('link', { name: 'FAQ', exact: true }).waitFor({ state: 'visible', timeout: 3000 });

  // Key section headings — scoped to their section IDs + regex (copy-change resilient)
  await page.locator('#how-it-works').getByRole('heading', { name: /three steps/i }).waitFor({ state: 'visible', timeout: 3000 });
  await page.locator('#your-journey').getByRole('heading', { name: /first session/i }).waitFor({ state: 'visible', timeout: 3000 });
  await page.locator('#personalization').getByRole('heading', { name: /personalization/i }).waitFor({ state: 'visible', timeout: 3000 });
}

async function assertHomeMobile(page, baseUrl) {
  await page.goto(`${baseUrl}/landing/en/index.html`, { waitUntil: 'domcontentloaded' });

  // Hero heading visible on mobile
  await page.getByRole('heading', { name: /Stay in the/i }).waitFor({ state: 'visible', timeout: 3000 });

  // Primary CTA visible on mobile
  await page.getByRole('link', { name: /Start Free Demo/i }).first().waitFor({ state: 'visible', timeout: 3000 });
}

async function assertAboutDesktop(page, baseUrl) {
  await page.goto(`${baseUrl}/about/index.html`, { waitUntil: 'domcontentloaded' });

  await assertSharedHeader(page, 'About Us');

  // About hero — scoped assertions
  await page.locator('#about-hero').getByRole('heading', { name: /master english output/i }).waitFor({ state: 'visible', timeout: 3000 });
  await page.locator('#about-hero').getByRole('link', { name: /Explore the Product/i }).waitFor({ state: 'visible', timeout: 3000 });

  // Key section headings — scoped to their section IDs
  await page.locator('#mission').getByRole('heading', { name: /mission/i }).waitFor({ state: 'visible', timeout: 3000 });
  await page.locator('#problem').getByRole('heading', { name: /passive consumption isn't enough/i }).waitFor({ state: 'visible', timeout: 3000 });
  await page.locator('#product').getByRole('heading', { name: /what bel builds/i }).waitFor({ state: 'visible', timeout: 3000 });
  await page.locator('#audience').getByRole('heading', { name: /who we serve/i }).waitFor({ state: 'visible', timeout: 3000 });
  await page.locator('#impact').getByRole('heading', { name: /why bel matters/i }).waitFor({ state: 'visible', timeout: 3000 });
  await page.locator('#team').getByRole('heading', { name: /team/i }).waitFor({ state: 'visible', timeout: 3000 });
}

async function assertAboutMobile(page, baseUrl) {
  await page.goto(`${baseUrl}/about/index.html`, { waitUntil: 'domcontentloaded' });
  await assertSharedHeader(page, 'About Us');

  // Hero still visible on mobile
  await page.locator('#about-hero').getByRole('heading', { name: /master english output/i }).waitFor({ state: 'visible', timeout: 3000 });

  // Team section reachable
  await page.locator('#team').getByRole('heading', { name: /team/i }).waitFor({ state: 'visible', timeout: 3000 });
}

(async () => {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverLogs = '';
  server.stdout.on('data', (chunk) => { serverLogs += String(chunk); });
  server.stderr.on('data', (chunk) => { serverLogs += String(chunk); });

  const browser = await chromium.launch({ headless: true });

  try {
    await waitForServer(`${baseUrl}/api/health`);
    const desktopContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const desktopPage = await desktopContext.newPage();

    await assertHomeDesktop(desktopPage, baseUrl);
    await assertAboutDesktop(desktopPage, baseUrl);
    fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
    await desktopPage.screenshot({ path: 'tmp/site-header-about-check.png', fullPage: true });
    await desktopContext.close();

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await mobileContext.newPage();

    await assertHomeMobile(mobilePage, baseUrl);
    await assertAboutMobile(mobilePage, baseUrl);
    await mobileContext.close();

    console.log('Home/About browser verification complete.');
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
