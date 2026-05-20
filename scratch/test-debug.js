const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function main() {
  console.log('Test start');
  const productionManifestUrl = 'https://betterenglishlearning.com/database/RA/Voice/audio/manifest.json';
  console.log('Fetching...');
  const res = await axios.get(productionManifestUrl);
  console.log('Fetched manifest, keys:', Object.keys(res.data).length);
  console.log('Checking a single HEAD request...');
  const headRes = await axios.head('https://betterenglishlearning.com/database/RA/Voice/audio/RA_1237_bm_george_80.mp3');
  console.log('HEAD response status:', headRes.status);
}

main().catch(err => console.error('Error:', err));
