const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outDir = path.resolve('c:/Cursor AI/assets/speaker_portraits');

async function getGoogleImage(page, query, filename) {
  console.log('Searching Google Images for:', query);
  const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Check for consent buttons
  const buttons = await page.$$('button');
  for (const b of buttons) {
    const text = await b.innerText();
    if (text.includes('Accept') || text.includes('I agree') || text.includes('Alle akzeptieren')) {
      await b.click();
      await page.waitForTimeout(1000);
      break;
    }
  }

  // Find image results: on modern google images, the thumbnails are in divs with img tags
  // Let's get the first few img elements with src starting with data:image or https:
  const imgs = await page.$$('div[data-ri="0"] img, div[data-ri="1"] img, div[data-ri="2"] img, c-wiz img');
  console.log(`Found ${imgs.length} candidate images for ${query}`);
  
  for (let i = 0; i < Math.min(imgs.length, 5); i++) {
    const img = imgs[i];
    const box = await img.boundingBox();
    if (box && box.width > 80 && box.height > 80) {
      const dest = path.join(outDir, filename);
      await img.screenshot({ path: dest });
      console.log(`Successfully captured ${filename} (${Math.round(box.width)}x${Math.round(box.height)})`);
      return true;
    }
  }

  // Fallback: take screenshot of the first result container
  const firstResult = await page.$('div[data-ri="0"]');
  if (firstResult) {
    const dest = path.join(outDir, filename);
    await firstResult.screenshot({ path: dest });
    console.log(`Fallback captured ${filename}`);
    return true;
  }
  return false;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  await getGoogleImage(page, 'Ken Birdwell Valve software developer', 'ken_birdwell.jpg');
  await getGoogleImage(page, 'Frederic Laloux author Reinventing Organizations portrait', 'frederic_laloux.jpg');
  await getGoogleImage(page, 'Rich Geldreich Valve developer photo', 'rich_geldreich.jpg');

  await browser.close();
  console.log('All Google searches complete!');
}

main().catch(console.error);
