const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const outDir = path.resolve('c:/Cursor AI/assets/speaker_portraits');

async function downloadUrl(url, dest) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadUrl(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error('Status ' + res.statusCode));
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });
}

async function searchAndSave(page, query, targetFilename) {
  console.log(`Searching for: ${query}`);
  const searchUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&qft=+filterui:photo-photo+filterui:aspect-square`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Get the first few image results
  const imgUrls = await page.evaluate(() => {
    const results = [];
    const elements = document.querySelectorAll('a.iusc');
    for (let el of elements) {
      const m = el.getAttribute('m');
      if (m) {
        try {
          const parsed = JSON.parse(m);
          if (parsed.murl) results.push(parsed.murl);
        } catch (e) {}
      }
    }
    return results;
  });

  console.log(`Found ${imgUrls.length} images for ${query}`);
  const destPath = path.join(outDir, targetFilename);

  for (let url of imgUrls.slice(0, 5)) {
    try {
      console.log(`Trying to download: ${url}`);
      await downloadUrl(url, destPath);
      const stats = fs.statSync(destPath);
      if (stats.size > 5000) {
        console.log(`Successfully saved ${targetFilename} (${stats.size} bytes)`);
        return true;
      }
    } catch (e) {
      console.log(`Failed download from ${url}: ${e.message}`);
    }
  }

  // Fallback: take a screenshot of the first result element
  try {
    const firstImg = await page.$('.mimg');
    if (firstImg) {
      await firstImg.screenshot({ path: destPath });
      console.log(`Saved screenshot fallback for ${targetFilename}`);
      return true;
    }
  } catch (e) {
    console.error(`Screenshot fallback failed: ${e.message}`);
  }
  return false;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  // 1. Ken Birdwell Valve
  await searchAndSave(page, 'Ken Birdwell Valve', 'ken_birdwell.jpg');

  // 2. Frédéric Laloux Reinventing Organizations
  await searchAndSave(page, 'Frederic Laloux Reinventing Organizations portrait', 'frederic_laloux.jpg');

  // 3. Rich Geldreich Valve
  await searchAndSave(page, 'Rich Geldreich Valve developer portrait', 'rich_geldreich.jpg');

  await browser.close();
  console.log('Finished image search.');
}

main().catch(console.error);
