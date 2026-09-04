const { db } = require('../../src/utils/firebase');

async function check() {
    for (const testId of [
        '5726ca5178ece2a551cbd2709366e02dcfd73cad19bd3b81d3db4c44ef685740',
        'b0ee5b86c13c42e4d2fd005552f28faf76ed7d4bfc32914d426181f5672ca267'
    ]) {
        const doc = await db.collection('entranceTests').doc(testId).get();
        const data = doc.data();
        console.log('\n===============================================================');
        console.log('Test:', testId);
        console.log('===============================================================');
        for (const qId of ['speaking_q1', 'speaking_q2', 'speaking_q3']) {
            const words = data.speaking?.[qId]?.words || [];
            console.log('\n---', qId, 'total words:', words.length);
            for (let i = 0; i < words.length - 1; i++) {
                const curr = words[i];
                const next = words[i + 1];
                const gap = next.startMs - curr.endMs;
                const dur = curr.endMs - curr.startMs;
                console.log(
                    `[#${i}] "${curr.word}" (${curr.startMs}ms - ${curr.endMs}ms, dur=${dur}ms) -> next "${next.word}" (starts ${next.startMs}ms) | GAP: ${gap}ms | errorType: ${curr.errorType || 'None'}`
                );
            }
        }
    }
}

check().then(() => process.exit(0)).catch((e) => {
    console.error(e);
    process.exit(1);
});
