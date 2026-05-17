/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const RA_JSON_PATH = path.join(ROOT_DIR, 'RA_rechunked.json');
const OUTPUT_DIR = path.join(ROOT_DIR, '_tmp_kokoro_samples');

const VOICES = [
  'am_adam',
  'am_michael',
  'am_eric',
  'am_onyx',
  'bm_daniel',
  'bm_george',
  'bm_lewis'
];

async function generateSample() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const rawData = fs.readFileSync(RA_JSON_PATH, 'utf-8');
  const prompts = JSON.parse(rawData);

  // Take the first 5 prompts
  const samplePrompts = prompts.slice(0, 5);

  console.log(`Generating samples for 5 prompts...`);

  for (let i = 0; i < samplePrompts.length; i++) {
    const prompt = samplePrompts[i];

    // Check for pausing rules (convert / and // to Kokoro-friendly punctuation)
    let chunkedText = prompt.new_chunked || prompt.current_chunked || prompt.text;

    // Replace // with ellipsis (long pause) and / with comma (short pause)
    const textWithPauses = chunkedText
      .replace(/\s*\/\/\s*/g, '... ')
      .replace(/\s*\/\s*/g, ', ');

    // Randomize voice
    const selectedVoice = VOICES[Math.floor(Math.random() * VOICES.length)];

    console.log(`\n[${i+1}/5] ID: ${prompt.id}`);
    console.log(`Voice: ${selectedVoice}`);
    console.log(`Original: ${chunkedText}`);
    console.log(`Parsed  : ${textWithPauses}`);

    try {
      const response = await fetch('http://localhost:8880/v1/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: textWithPauses,
          voice: selectedVoice,
          response_format: 'mp3',
          speed: 0.9 // Slower speed for Beg_M_80 feel
        })
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const outputPath = path.join(OUTPUT_DIR, `ID_${prompt.id}_${selectedVoice}_Beg_M_80.mp3`);

      fs.writeFileSync(outputPath, Buffer.from(buffer));
      console.log(`-> Saved to ${outputPath}`);

    } catch (error) {
      console.error(`-> Failed to generate audio for ID ${prompt.id}:`, error.message);
    }
  }
  console.log('\nSample generation complete!');
}

generateSample();
