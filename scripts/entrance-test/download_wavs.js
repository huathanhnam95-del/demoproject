const { admin, db } = require('../../src/utils/firebase');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function extractAudio() {
    const testId = '5726ca5178ece2a551cbd2709366e02dcfd73cad19bd3b81d3db4c44ef685740';
    const doc = await db.collection('entranceTests').doc(testId).get();
    const q1 = doc.data().speaking.speaking_q1;
    const bucket = admin.storage().bucket(q1.audio.bucketName);
    const [buf] = await bucket.file(q1.audio.storagePath).download();
    
    const outDir = path.resolve(__dirname, 'audio_analysis');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    
    const webmPath = path.join(outDir, 'test57_q1.webm');
    const wavPath = path.join(outDir, 'test57_q1.wav');
    fs.writeFileSync(webmPath, buf);
    
    spawnSync('ffmpeg', ['-y', '-i', webmPath, '-ac', '1', '-ar', '16000', wavPath]);
    console.log('Saved test57_q1.wav, size:', fs.statSync(wavPath).size);

    // Also download test b0ee5b86
    const doc2 = await db.collection('entranceTests').doc('b0ee5b86c13c42e4d2fd005552f28faf76ed7d4bfc32914d426181f5672ca267').get();
    const q1_b = doc2.data().speaking.speaking_q1;
    const [buf2] = await bucket.file(q1_b.audio.storagePath).download();
    const webmPath2 = path.join(outDir, 'testB0_q1.webm');
    const wavPath2 = path.join(outDir, 'testB0_q1.wav');
    fs.writeFileSync(webmPath2, buf2);
    spawnSync('ffmpeg', ['-y', '-i', webmPath2, '-ac', '1', '-ar', '16000', wavPath2]);
    console.log('Saved testB0_q1.wav, size:', fs.statSync(wavPath2).size);
}

extractAudio().then(() => process.exit(0)).catch(console.error);
