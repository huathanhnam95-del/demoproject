const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function searchDDG(page, query, filename) {
  console.log('Searching DuckDuckGo for:', query);
  await page.goto(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Take screenshot of first image tile
  const tile = await page.$('.tile--img__media, .tile--img, img.tile--img__img');
  if (tile) {
    const dest = path.resolve('c:/Cursor AI/assets/speaker_portraits', filename);
    await tile.screenshot({ path: dest });
    console.log(`Saved ${filename} screenshot!`);
    return true;
  } else {
    console.log(`No tile found for ${query}`);
    await page.screenshot({ path: `c:/Cursor AI/assets/speaker_portraits/debug_${filename}.png` });
    return false;
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 }
  });

  await searchDDG(page, 'Ken Birdwell Valve Half-Life', 'ken_birdwell.jpg');
  await searchDDG(page, 'Frederic Laloux author Reinventing Organizations', 'frederic_laloux.jpg');
  await searchDDG(page, 'Rich Geldreich Valve', 'rich_geldreich.jpg');

  await browser.close();
}

main().catch(console.error);
