const https = require('https');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Ignore self-signed cert for local dev

async function testProgression() {
    // Outline ID for "Linh's Healthy Recipe Blog"
    const outlineId = '6a18660457ed10a9cdd7cf77d9c95caca3a9a6b38423837a58a9d0bde2784fba';

    console.log(`[1] Starting pre-generated story for ${outlineId}...`);
    const startRes = await fetch('https://localhost:8443/api/reading-journey/start-pre-generated', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outlineId })
    });
    const startData = await startRes.json();

    if (!startData.success) {
        console.error("Failed to start:", startData);
        return;
    }

    console.log("✅ Story started successfully. Title:", startData.data?.setup?.title);

    let currentBeat = 1;
    let history = [startData.data.beat.content];
    let path = [];

    // Try to advance 4 times to reach the end (assuming 5 beats max)
    for (let i = 0; i < 4; i++) {
        console.log(`\n[${i + 2}] Advancing from beat ${currentBeat} to ${currentBeat + 1}...`);

        // Simulate what the UI does: push the previous choice and clear the choice payload property
        path.push("next");

        const payload = {
            outlineId,
            currentBeatNumber: currentBeat,
            choiceId: 'next',
            userResponse: '',
            path: path,
            history: history
        };

        const advanceRes = await fetch('https://localhost:8443/api/reading-journey/advance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const advanceData = await advanceRes.json();

        if (!advanceData.success) {
            console.error("❌ Failed to advance:", advanceData);
            break;
        }

        if (advanceData.data.isComplete) {
            console.log("✅ Story completed successfully!");
            break;
        }

        console.log(`✅ Advanced to Beat ${currentBeat + 1}. isLast: ${advanceData.data.beat.isLast}`);
        currentBeat++;
        history.push(advanceData.data.beat.content);
    }
}

testProgression().catch(console.error);
