const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const outDir = path.resolve('c:/Cursor AI/assets/speaker_portraits');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://en.wikipedia.org/'
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          const u = new URL(url);
          redirectUrl = u.protocol + '//' + u.host + redirectUrl;
        }
        return downloadFile(redirectUrl, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Status ${res.statusCode} for ${url}`));
      }
      const stream = fs.createWriteStream(dest);
      res.pipe(stream);
      stream.on('finish', () => { stream.close(); resolve(); });
    });
    req.on('error', reject);
  });
}

function fetchText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...headers
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          const u = new URL(url);
          redirectUrl = u.protocol + '//' + u.host + redirectUrl;
        }
        return fetchText(redirectUrl, headers).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

async function run() {
  console.log('--- 1. Jo Freeman ---');
  try {
    const joWiki = await fetchText('https://en.wikipedia.org/wiki/Jo_Freeman');
    const m = joWiki.match(/src="(\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/[^"]+JoFreeman[^"]+\.(?:jpg|JPG|png))\/[^"]+"/);
    let joUrl = 'https://upload.wikimedia.org/wikipedia/commons/3/39/JoFreeman-09-26-06_crop.JPG';
    console.log('Downloading Jo Freeman from', joUrl);
    await downloadFile(joUrl, path.join(outDir, 'jo_freeman.jpg'));
    console.log('Jo Freeman saved successfully!');
  } catch (e) {
    console.error('Jo Freeman error:', e.message);
  }

  console.log('--- 2. Ken Birdwell ---');
  try {
    const kbWiki = await fetchText('https://combineoverwiki.net/wiki/Ken_Birdwell');
    const matches = kbWiki.match(/\/images\/[a-z0-9\/%_-]+Birdwell[a-z0-9\/%_-]*\.(?:jpg|png|jpeg)/gi) || [];
    console.log('Ken Birdwell matches:', matches);
    if (matches.length > 0) {
      const kbUrl = 'https://combineoverwiki.net' + matches[0];
      console.log('Downloading Ken Birdwell from', kbUrl);
      await downloadFile(kbUrl, path.join(outDir, 'ken_birdwell.jpg'));
      console.log('Ken Birdwell saved successfully!');
    }
  } catch (e) {
    console.error('Ken Birdwell error:', e.message);
  }

  console.log('--- 3. Frederic Laloux ---');
  try {
    // Let's check reinventing organizations website
    const roHtml = await fetchText('https://thejourney.reinventingorganizations.com/');
    const roMatches = roHtml.match(/src="([^"]*(?:frederic|laloux)[^"]*\.(?:jpg|png|jpeg))"/gi) || [];
    console.log('Laloux matches in Journey:', roMatches);
  } catch (e) {
    console.error('Laloux Journey error:', e.message);
  }

  console.log('--- 4. Rich Geldreich ---');
  try {
    const richBlog = await fetchText('https://richg42.blogspot.com/');
    const richMatches = richBlog.match(/src="([^"]*(?:rich|geldreich|author|profile)[^"]*\.(?:jpg|png|jpeg))"/gi) || [];
    console.log('Rich blog matches:', richMatches);
  } catch (e) {
    console.error('Rich blog error:', e.message);
  }
}

run();
