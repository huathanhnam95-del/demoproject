const { chromium } = require('playwright');

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log('Chromium launched successfully!');
  await browser.close();
}

test().catch(console.error);
