require('dotenv').config();
const gemini = require('../src/services/reading-journey/gemini');

(async () => {
  try {
    const keywords = ['forest', 'magic'];
    const level = 'B1';
    
    console.log('Generating outline...');
    const outline = await gemini.generateOutline({ keywords, level, language: 'en' });
    console.log(`Outline created: ${outline.title}`);
    
    console.log('Generating Beat 1...');
    const b1 = await gemini.generateBeat({
      outline, beatNumber: 1, path: [], questionType: 'mcq', storySoFar: '', level, language: 'en'
    });
    
    console.log('Beat 1:', b1.segment);
    
    const storySoFar1 = `Most recent scene: ${b1.segment}`;
    
    console.log('\nGenerating Beat 2...');
    const b2 = await gemini.generateBeat({
      outline, beatNumber: 2, path: ['investigate'], questionType: 'mcq', storySoFar: storySoFar1, level, language: 'en'
    });
    console.log('Beat 2:', b2.segment);
    
    const storySoFar2 = `Most recent scene: ${b2.segment}`;
    
    console.log('\nGenerating Beat 3...');
    const b3 = await gemini.generateBeat({
      outline, beatNumber: 3, path: ['investigate', 'investigate'], questionType: 'open', storySoFar: storySoFar2, level, language: 'en'
    });
    console.log('Beat 3:', b3.segment);
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
