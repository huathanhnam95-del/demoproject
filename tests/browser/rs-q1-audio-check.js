/* eslint-disable no-console */
const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const fs = require('fs');

async function checkRepeatSentenceQ1() {
  console.log('--- Testing Repeat Sentence Q1 Audio Match ---');
  
  // 1. Verify file exists on disk
  const audioFilePath = path.join(__dirname, '..', '..', 'public', 'database', 'speak', 'audio', '1.mp3');
  if (!fs.existsSync(audioFilePath)) {
    console.error('❌ FAIL: public/database/speak/audio/1.mp3 does not exist');
    process.exit(1);
  }
  const stat = fs.statSync(audioFilePath);
  console.log(`✅ Audio file 1.mp3 exists on disk (size: ${stat.size} bytes)`);

  // 2. Verify index.json entry
  const indexPath = path.join(__dirname, '..', '..', 'public', 'database', 'speak', 'index.json');
  const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const q1 = indexData.items.find(i => i.id === 1);
  console.log('Index Q1 entry:', q1);
  
  if (q1.correctSentence !== "Next time, we'll discuss the influence of the media on public policy.") {
    console.error('❌ FAIL: Q1 text mismatch in index.json');
    process.exit(1);
  }
  console.log('✅ Index Q1 text matches expected sentence');

  console.log('✅ All checks passed successfully!');
}

checkRepeatSentenceQ1().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
