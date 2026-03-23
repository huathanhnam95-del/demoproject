const fs = require('fs');
const path = require('path');
const { auditThumbnail } = require('../../src/services/reading-journey/thumbnail-audit');

async function run() {
    const isSampleReport = process.argv.includes('--sample-report');
    if (isSampleReport) {
        process.env.DRY_RUN = 'true';
    }

    try {
        const spec = {
            universalCriteria: [{ id: 'u1', question: 'Clear?' }],
            storyCriteria: [{ id: 's1', question: 'Hero?' }],
            blockingFailures: ['u1']
        };

        const result = await auditThumbnail(Buffer.from('dummy'), spec);
        
        const today = new Date().toISOString().split('T')[0];
        const outDir = path.join(__dirname, `../../docs/audits/reading-journey-thumbnails/${today}`);
        fs.mkdirSync(outDir, { recursive: true });
        
        const filePath = path.join(outDir, 'sample-report.json');
        fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
        console.log(`Report written to ${filePath}`);
    } catch (e) {
        console.error('Audit failed:', e.message);
        process.exit(1);
    }
}

run();
