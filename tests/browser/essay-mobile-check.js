/**
 * Mobile viewport screenshot test for Write Essay mode.
 * Captures the essay UI at 375×812 (iPhone-like) to verify mobile layout.
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = 'https://localhost:8443';
const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'screenshots');

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors']
  });
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });
  const page = await context.newPage();

  console.log('1. Navigating to app...');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000); // Let JS settle


  // Login
  console.log('2. Logging in...');
  // Wait for the login modal or auth prompt
  try {
    await page.waitForSelector('#login-btn, .login-button, [data-action="login"]', { timeout: 5000 });
    const loginBtn = page.locator('#login-btn, .login-button, [data-action="login"]').first();
    await loginBtn.click();
    await page.waitForTimeout(1500);
    
    // Fill login form
    const emailField = page.locator('input[type="email"], #email');
    const passwordField = page.locator('input[type="password"], #password');
    
    if (await emailField.isVisible()) {
      await emailField.fill('huathanhnam95@gmail.com');
      await passwordField.fill('Alphaein@1new');
      
      const submitBtn = page.locator('button[type="submit"], .firebaseui-id-submit');
      await submitBtn.click();
      await page.waitForTimeout(3000);
    }
  } catch (e) {
    console.log('   Login prompt not found or already logged in, continuing...');
  }

  // Navigate to PTE Writing tab
  console.log('3. Navigating to Writing tab...');
  try {
    // Click PTE Practice tab first if needed
    const pteTab = page.locator('text=PTE Practice').first();
    if (await pteTab.isVisible()) {
      await pteTab.click();
      await page.waitForTimeout(1000);
    }
    
    // Click Writing tab
    const writingTab = page.locator('[data-skill="writing"], text=Writing').first();
    if (await writingTab.isVisible()) {
      await writingTab.click();
      await page.waitForTimeout(1000);
    }

    // Click Write Essay mode
    const essayMode = page.locator('text=Write Essay').first();
    if (await essayMode.isVisible()) {
      await essayMode.click();
      await page.waitForTimeout(1500);
    }
  } catch (e) {
    console.log('   Navigation error:', e.message);
  }

  // Screenshot 1: Prompt display
  console.log('4. Capturing prompt display...');
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'essay-mobile-prompt.png'),
    fullPage: true
  });
  console.log('   → essay-mobile-prompt.png saved');

  // Screenshot 2: Writing area (if visible after clicking Start)
  try {
    const startBtn = page.locator('text=Start Writing, text=Begin, .essay-start-btn').first();
    if (await startBtn.isVisible()) {
      await startBtn.click();
      await page.waitForTimeout(1000);
    }
    
    console.log('5. Capturing writing area...');
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'essay-mobile-writing.png'),
      fullPage: true
    });
    console.log('   → essay-mobile-writing.png saved');
  } catch (e) {
    console.log('   Writing area not visible:', e.message);
  }

  // Screenshot 3: Full page scroll
  console.log('6. Capturing full page state...');
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'essay-mobile-full.png'),
    fullPage: true
  });
  console.log('   → essay-mobile-full.png saved');

  await browser.close();
  console.log('\nDone. Screenshots saved to:', SCREENSHOT_DIR);
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
