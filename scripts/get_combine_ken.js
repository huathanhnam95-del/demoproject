const https = require('https');
const fs = require('fs');

https.get('https://combineoverwiki.net/wiki/Ken_Birdwell', {
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
}, res => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    fs.writeFileSync('c:/Cursor AI/assets/ken_page.html', data);
    console.log('Saved ken_page.html, size:', data.length);
  });
}).on('error', e => console.error(e));
