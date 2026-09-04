const { db } = require('../../src/utils/firebase');

async function checkTest57() {
    const doc = await db.collection('entranceTests').doc('5726ca5178ece2a551cbd2709366e02dcfd73cad19bd3b81d3db4c44ef685740').get();
    const data = doc.data();
    for (const qId of ['speaking_q1', 'speaking_q2', 'speaking_q3']) {
        const words = data.speaking?.[qId]?.words || [];
        console.log('\n---', qId, 'words:');
        words.forEach((w, i) => {
            const next = words[i + 1];
            const gap = next ? next.startMs - w.endMs : null;
            console.log(`  [#${i}] "${w.word}" (${w.startMs}ms - ${w.endMs}ms, dur=${w.endMs - w.startMs}ms) score=${w.accuracyScore} errorType=${w.errorType} | GAP to next: ${gap}ms`);
        });
    }
}

checkTest57().then(() => process.exit(0)).catch(console.error);
