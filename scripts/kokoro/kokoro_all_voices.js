/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(ROOT_DIR, '_tmp_kokoro_all_voices');
const TEST_PHRASE = "Hello, welcome to the P T E practice platform. This is a sample recording to test my voice and pausing cadence.";

async function generateAllVoices() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  try {
    // 1. Fetch all voices
    const voicesRes = await fetch('http://localhost:8880/v1/audio/voices');
    const voicesData = await voicesRes.json();
    const voiceIds = voicesData.voices;

    console.log(`Found ${voiceIds.length} voices. Generating samples...`);

    for (let i = 0; i < voiceIds.length; i++) {
      const voice = voiceIds[i];
      console.log(`[${i+1}/${voiceIds.length}] Generating ${voice}...`);

      const response = await fetch('http://localhost:8880/v1/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: TEST_PHRASE,
          voice: voice,
          response_format: 'mp3',
          speed: 1.0 // Standard speed for comparison
        })
      });

      if (!response.ok) {
        console.error(`-> Failed ${voice}: ${response.status}`);
        continue;
      }

      const buffer = await response.arrayBuffer();
      const outputPath = path.join(OUTPUT_DIR, `${voice}_sample.mp3`);

      fs.writeFileSync(outputPath, Buffer.from(buffer));
    }

    console.log('\nAll voice samples generated successfully!');
  } catch (error) {
    console.error("Error:", error.message);
  }
}

generateAllVoices();
