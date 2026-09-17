const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('Navigating to Combine OverWiki Ken Birdwell...');
  try {
    await page.goto('https://combineoverwiki.net/wiki/Ken_Birdwell', { waitUntil: 'domcontentloaded', timeout: 20000 });
    console.log('Page loaded!');
    
    // Find image element
    const imgEl = await page.$('.infobox img, .thumbimage, img[alt*="Birdwell"]');
    if (imgEl) {
      const src = await imgEl.getAttribute('src');
      console.log('Found image src:', src);
      await imgEl.screenshot({ path: 'c:/Cursor AI/assets/speaker_portraits/ken_birdwell.jpg' });
      console.log('Saved Ken Birdwell screenshot!');
    } else {
      console.log('No img element found, looking for all imgs:');
      const imgs = await page.$$eval('img', els => els.map(e => e.src));
      console.log(imgs);
    }
  } catch (e) {
    console.error('Error:', e.message);
  }

  await browser.close();
}

run();
