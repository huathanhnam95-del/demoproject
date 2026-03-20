const { generateThumbnailImage } = require('../src/services/reading-journey/thumbnail-generator');

async function test() {
    const isDryRun = process.argv.includes('--dry-run');
    if (isDryRun) {
        process.env.DRY_RUN = 'true';
    }

    try {
        const res = await generateThumbnailImage({
            promptSpec: { promptText: 'A cute robot learning to read.' }
        });

        console.log('Smoke test completed. Normalized Response:');
        console.log(JSON.stringify({
            model: res.model,
            attempt: res.attempt,
            hasImageBytes: !!res.imageBytes,
            meta: res.rawResponseMeta.payload
        }, null, 2));
    } catch (e) {
        console.error('Smoke test failed:', e.message);
        process.exit(1);
    }
}

test();
